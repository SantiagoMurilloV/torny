import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { Tournament } from '../types';
import { tournamentService } from './tournament.service';
import { playerService, Player } from './player.service';
import { pushService } from './push.service';

/**
 * Postgres DATE columns can come back as a real `Date` object (pg
 * driver default) or as a 'YYYY-MM-DD' string depending on the driver
 * version — `tournament.service.mapRow` doesn't normalise startDate /
 * endDate so by the time they reach this layer the runtime type is a
 * coin flip. Comparing a Date against a `'YYYY-MM-DD'` string via the
 * `<` operator silently coerces the Date to its ms timestamp and the
 * string to NaN → every comparison is false, which means
 * `isOpen` would always read "cerrado". Force both sides to the same
 * 'YYYY-MM-DD' shape before any comparison.
 */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

/**
 * Server-side surface for the public parent-registration flow
 * (`/torneo/:slug/inscripcion`). Wraps:
 *
 *   · The lookup of "what does a parent see when they open the link"
 *     — i.e. tournament metadata + the clubs/teams they can choose
 *     from. Filters down to clubs that have AT LEAST ONE team
 *     enrolled in the torneo, and to teams whose `club_id` is set
 *     (legacy null-club teams are intentionally invisible — the
 *     admin's setup step of assigning teams to clubs is a
 *     prerequisite for this flow).
 *
 *   · The submission itself, enforcing the same-tournament guard,
 *     the roster cap, and the cutoff (now < start_date midnight).
 *     On success it fires a push notification back to the club
 *     captain (mig 028) so they see the new player without polling.
 *
 * Lives outside player.service / tournament.service because the
 * logic crosses both resources and shouldn't bloat either one. The
 * public *.routes.ts file simply delegates here.
 */

export interface PublicTeamSummary {
  id: string;
  name: string;
  initials: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  category?: string;
  city?: string;
  /** Current player count — for the cap UI. */
  rosterCount: number;
  /** True when rosterCount >= tournament.playersPerTeam. */
  isFull: boolean;
}

export interface PublicClubSummary {
  id: string;
  name: string;
  teams: PublicTeamSummary[];
}

export interface PublicTournamentView {
  tournament: {
    id: string;
    slug: string;
    name: string;
    club: string;
    logo?: string;
    coverImage?: string;
    startDate: string;
    endDate: string;
    status: Tournament['status'];
    playersPerTeam: number;
  };
  /**
   * True while now < tournament.start_date (in UTC). The cutoff is
   * the midnight that opens the start day, so an acudiente loading
   * the form at 11:59 PM the night before the tournament still gets
   * through; at 00:00 of the start day it stops accepting.
   */
  isOpen: boolean;
  /**
   * True when `registrationOpensAt` is set and is still in the future.
   * The frontend renders a "todavía no abiertas" screen in this case.
   */
  notOpenYet: boolean;
  /**
   * ISO timestamp (or date) when the link closes. Equal to
   * `registrationClosesAt` when set, otherwise `startDate`.
   * Frontend renders "Las inscripciones cerraron el …".
   */
  closedAt: string;
  /**
   * ISO timestamp when the link opens. Only present when
   * `notOpenYet` is true so the frontend can show "Disponible desde …".
   */
  opensAt?: string;
  clubs: PublicClubSummary[];
}

/**
 * Tournament + nested clubs + their teams. The frontend renders this
 * directly into the form's two dependent dropdowns. We compute the
 * roster count per team here so the FE can disable a team that's
 * already at its cap WITHOUT hitting a "team full" 422 after the
 * parent already filled the form.
 */
export async function getPublicView(slug: string): Promise<PublicTournamentView> {
  const tournament = await tournamentService.getBySlug(slug);
  const pool = getPool();

  // One query to fetch every (club, team, rosterCount) tuple for the
  // torneo. Joining clubs ensures teams without a club_id are
  // excluded (parents can't reach orphaned teams). The COUNT
  // subquery is cheap — players.team_id is indexed.
  const result = await pool.query<{
    club_id: string;
    club_name: string;
    team_id: string;
    team_name: string;
    initials: string;
    logo: string | null;
    primary_color: string;
    secondary_color: string;
    category: string | null;
    city: string | null;
    roster_count: number;
  }>(
    `SELECT
        c.id   AS club_id,
        c.name AS club_name,
        t.id   AS team_id,
        t.name AS team_name,
        t.initials,
        t.logo,
        t.primary_color,
        t.secondary_color,
        t.category,
        t.city,
        (SELECT COUNT(*)::int FROM players p WHERE p.team_id = t.id) AS roster_count
       FROM tournament_teams tt
       JOIN teams t ON t.id = tt.team_id
       JOIN clubs c ON c.id = t.club_id
      WHERE tt.tournament_id = $1
      ORDER BY c.name ASC, t.name ASC`,
    [tournament.id],
  );

  const playersPerTeam = tournament.playersPerTeam ?? 12;
  const clubsMap = new Map<string, PublicClubSummary>();
  for (const row of result.rows) {
    let club = clubsMap.get(row.club_id);
    if (!club) {
      club = { id: row.club_id, name: row.club_name, teams: [] };
      clubsMap.set(row.club_id, club);
    }
    club.teams.push({
      id: row.team_id,
      name: row.team_name,
      initials: row.initials,
      logo: row.logo ?? undefined,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      category: row.category ?? undefined,
      city: row.city ?? undefined,
      rosterCount: row.roster_count,
      isFull: row.roster_count >= playersPerTeam,
    });
  }

  // ── Registration window ──────────────────────────────────────────
  // Priority: explicit registrationOpensAt / registrationClosesAt fields
  // (mig 035) take precedence over the legacy "close at start_date
  // midnight" rule. Both are optional — when absent we fall back to the
  // original behaviour so old tournaments keep working.
  const startIso = toIsoDate(tournament.startDate);
  const endIso   = toIsoDate(tournament.endDate);
  const nowMs    = Date.now();

  // Opening gate
  let notOpenYet = false;
  let opensAt: string | undefined;
  if (tournament.registrationOpensAt) {
    const opensMs = new Date(tournament.registrationOpensAt).getTime();
    if (nowMs < opensMs) {
      notOpenYet = true;
      opensAt    = tournament.registrationOpensAt;
    }
  }

  // Closing gate
  let isOpen: boolean;
  let closedAt: string;
  if (tournament.registrationClosesAt) {
    const closesMs = new Date(tournament.registrationClosesAt).getTime();
    isOpen   = !notOpenYet && nowMs < closesMs;
    closedAt = tournament.registrationClosesAt;
  } else {
    // Legacy: compare ISO date strings (no timezone math).
    const todayIso = new Date().toISOString().slice(0, 10);
    isOpen   = !notOpenYet && todayIso < startIso;
    closedAt = startIso;
  }

  return {
    tournament: {
      id: tournament.id,
      slug: tournament.slug ?? slug,
      name: tournament.name,
      club: tournament.club,
      logo: tournament.logo,
      coverImage: tournament.coverImage,
      startDate: startIso,
      endDate: endIso,
      status: tournament.status,
      playersPerTeam,
    },
    isOpen,
    notOpenYet,
    opensAt,
    closedAt,
    clubs: Array.from(clubsMap.values()),
  };
}

export interface RegisterPlayerInput {
  teamId: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  documentType?: string;
  documentNumber?: string;
  photo?: string;
  documentFile?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
}

/**
 * Validate + create a jugadora from the public parent form. Tagged
 * with `registered_via_public = true` for auditing. Fires a push to
 * the club captain on success — failure of the push doesn't roll
 * back the player insert (notifications are best-effort).
 */
export async function registerPlayer(
  slug: string,
  data: RegisterPlayerInput,
): Promise<Player> {
  // Hydrate the tournament + sanity-check the cutoff. Same Date-vs-
  // string coercion gotcha as `getPublicView` (see toIsoDate's docs).
  const tournament = await tournamentService.getBySlug(slug);
  const nowMs = Date.now();

  // Opening gate check (mig 035)
  if (tournament.registrationOpensAt) {
    const opensMs = new Date(tournament.registrationOpensAt).getTime();
    if (nowMs < opensMs) {
      throw new ValidationError(
        'Las inscripciones para este torneo aún no han comenzado',
      );
    }
  }

  // Closing gate check (mig 035)
  if (tournament.registrationClosesAt) {
    const closesMs = new Date(tournament.registrationClosesAt).getTime();
    if (nowMs >= closesMs) {
      throw new ValidationError(
        'Las inscripciones para este torneo han cerrado',
      );
    }
  } else {
    // Legacy: close at midnight of startDate
    const todayIso = new Date().toISOString().slice(0, 10);
    const startIso = toIsoDate(tournament.startDate);
    if (todayIso >= startIso) {
      throw new ValidationError(
        'Las inscripciones para este torneo cerraron el día antes del inicio',
      );
    }
  }

  const pool = getPool();
  // Confirm the team is enrolled in this tournament AND belongs to a
  // club. We need the club id later for the push notification.
  const teamRes = await pool.query<{
    id: string;
    club_id: string | null;
    name: string;
    enrolled: boolean;
  }>(
    `SELECT
       t.id,
       t.club_id,
       t.name,
       EXISTS (
         SELECT 1 FROM tournament_teams tt
         WHERE tt.team_id = t.id AND tt.tournament_id = $1
       ) AS enrolled
     FROM teams t
     WHERE t.id = $2`,
    [tournament.id, data.teamId],
  );
  if (teamRes.rows.length === 0) {
    throw new NotFoundError('Equipo');
  }
  const team = teamRes.rows[0];
  if (!team.enrolled || !team.club_id) {
    // Either the team isn't in this torneo or it has no club. Same
    // 404 in both cases so we don't leak which one.
    throw new NotFoundError('Equipo');
  }

  // Hard roster cap (decision #4 with the product owner). The
  // playersPerTeam value is "recommended" everywhere else in the app
  // but ENFORCED here — the public flow shouldn't let a team blow
  // past its cap because the admin can't gate every submission.
  const playersPerTeam = tournament.playersPerTeam ?? 12;
  const countRes = await pool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM players WHERE team_id = $1',
    [data.teamId],
  );
  if ((countRes.rows[0]?.n ?? 0) >= playersPerTeam) {
    throw new ValidationError(
      `Este equipo ya completó su plantel (${playersPerTeam} jugadoras). Contactá al club.`,
    );
  }

  // Now let the regular player.create do the rest of the validation +
  // the actual insert. The audit flag lets the admin UI badge these
  // rows differently if it ever needs to.
  const player = await playerService.create({
    teamId: data.teamId,
    firstName: data.firstName,
    lastName: data.lastName,
    birthDate: data.birthDate,
    documentType: data.documentType,
    documentNumber: data.documentNumber,
    photo: data.photo,
    documentFile: data.documentFile,
    emergencyContactName: data.emergencyContactName,
    emergencyContactPhone: data.emergencyContactPhone,
    emergencyContactRelationship: data.emergencyContactRelationship,
    registeredViaPublic: true,
  });

  // Notify the club captain in the background. Failures (no
  // subscription, VAPID not configured, transient web-push 5xx) MUST
  // NOT roll back the player insert — the parent's submission is the
  // contract here. Best-effort.
  pushService
    .sendToClub(team.club_id, {
      title: 'Nueva inscripción',
      body: `${player.firstName} ${player.lastName} se inscribió en ${team.name}.`,
      url: '/club-panel',
      tag: `enrolled-${team.club_id}-${player.id}`,
    })
    .catch((err) => {
      console.warn('[publicRegistration] push notification failed:', err);
    });

  return player;
}
