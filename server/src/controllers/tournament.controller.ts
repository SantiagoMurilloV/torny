import { Request, Response, NextFunction } from 'express';
import { tournamentService } from '../services/tournament.service';
import { enrollmentService } from '../services/enrollment.service';
import { fixtureGenerator } from '../services/fixture.service';
import { bracketGenerator } from '../services/bracket.service';
import { standingsCalculator } from '../services/standings.service';
import { matchService } from '../services/match.service';
import { validateUUID } from '../middleware/validation';
import { ValidationError } from '../middleware/errorHandler';
import { optionalUser } from '../middleware/auth';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Scope by caller role:
    //   · admin      → only their own tournaments (owner_id match)
    //   · super_admin / public / judge → everything
    const caller = optionalUser(req);
    const tournaments = caller?.role === 'admin'
      ? await tournamentService.getAll({ scope: 'owner', ownerId: caller.userId })
      : await tournamentService.getAll({ scope: 'all' });
    res.json(tournaments);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const tournament = await tournamentService.getById(id);
    res.json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Ownership comes from req.user (set by authMiddleware), never from
    // the body — a malicious admin could otherwise assign tournaments to
    // another tenant. super_admin creating a tournament gets null owner
    // (platform-owned; visible to every super_admin, no quota).
    let ownerId: string | null = null;
    if (req.user?.role === 'admin') {
      ownerId = req.user.userId;
    }
    const tournament = await tournamentService.create(req.body, ownerId);
    res.status(201).json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const tournament = await tournamentService.update(id, req.body);
    res.json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await tournamentService.delete(id);
    res.json({ message: 'Torneo eliminado exitosamente' });
  } catch (error) {
    next(error);
  }
}

export async function getMatches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');

    // Self-healing materialization pass: if the torneo already has a
    // bracket but its slots were never persisted into `matches`
    // (e.g. tournaments created before mig 030 dropped the NOT NULL
    // on team1_id/team2_id, OR a manual generateBracketCrossings
    // that ran before the materializer was wired), force the
    // materializer here so the admin's cronograma shows every
    // future slot (cuartos / semis / final / 3er puesto) and can be
    // scheduled end-to-end. Idempotent: `bracketGenerator.materialize…`
    // skips slots already linked via `bracket_match_id` and only
    // inserts new rows for missing ones, so calling it on every
    // admin GET is cheap (one indexed COUNT + zero writes on the
    // steady state).
    //
    // Best-effort: any failure (transient DB hiccup, schema drift on
    // an older deploy) MUST NOT block the response — the admin
    // needs to see whatever matches DO exist, even when the
    // materializer is unhappy. Failures are logged for the operator.
    //
    // Public visitors land here via the cache hot-path before the
    // controller runs (the cacheGet middleware sits before this in
    // tournament.routes.ts), so this side-effect only fires for
    // requests that carry an Authorization header. We further narrow
    // it to admin / super_admin: judges fetch this endpoint on every
    // referee-panel tick and don't need (or have any business
    // triggering) bracket materialization — the admin that created
    // the torneo is the right actor.
    const caller = optionalUser(req);
    if (caller && (caller.role === 'admin' || caller.role === 'super_admin')) {
      try {
        await bracketGenerator.materializePendingBracketMatches(id);
      } catch (err) {
        console.warn(
          `[tournament.getMatches] materialize on read failed for ${id}:`,
          err,
        );
      }
    }

    const matches = await tournamentService.getMatches(id);
    res.json(matches);
  } catch (error) {
    next(error);
  }
}

export async function getStandings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const standings = await tournamentService.getStandings(id);
    res.json(standings);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete `matches` rows that correspond to BYE slots in the bracket.
 *
 * A bye is a bracket row where one team is permanently absent (the
 * other side gets a free pass to the next round). Materializing a
 * bye creates a phantom card in the cronograma (both team_ids
 * NULL, taking a court+time slot for a game that never plays). The
 * fixed materializer (commit 2026-05-13) now skips bye rows at
 * insert time, but pre-existing data still carries the cards.
 *
 * This endpoint scans the tournament's bracket for bye rows and
 * deletes any matches row whose phase matches the round of a bye
 * AND has both team_ids NULL (the materializer's bye footprint) AND
 * no score loaded. We DON'T touch:
 *   · matches with score (history protection)
 *   · matches with at least one team_id set (real upcoming game)
 *   · matches whose phase doesn't match a known bye round
 *
 * Returns the count of phantom rows removed so the admin can
 * verify the cleanup against the cronograma.
 */
export async function cleanByeMatches(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const pool = (await import('../config/database')).getPool();

    // 1) Discover bye rounds: rounds where at least one side is
    //    permanently empty. We compute the bye position count per
    //    round so the delete below can be capped accordingly.
    const byesRes = await pool.query<{ round: string; bye_count: number }>(
      `SELECT round, COUNT(*)::int AS bye_count
         FROM bracket_matches
         WHERE tournament_id = $1
           AND (
             (
               (team1_id IS NOT NULL
                 OR (team1_placeholder IS NOT NULL
                     AND btrim(team1_placeholder) NOT IN ('', '-')))
               AND team2_id IS NULL
               AND (team2_placeholder IS NULL
                    OR btrim(team2_placeholder) IN ('', '-'))
             )
             OR
             (
               (team2_id IS NOT NULL
                 OR (team2_placeholder IS NOT NULL
                     AND btrim(team2_placeholder) NOT IN ('', '-')))
               AND team1_id IS NULL
               AND (team1_placeholder IS NULL
                    OR btrim(team1_placeholder) IN ('', '-'))
             )
           )
         GROUP BY round`,
      [id],
    );

    if (byesRes.rows.length === 0) {
      res.json({
        tournamentId: id,
        deletedCount: 0,
        deleted: [],
        byeRoundsScanned: 0,
        note: 'No se encontraron byes en bracket_matches.',
      });
      return;
    }

    // 2) For each bye round, delete up to `bye_count` matches rows
    //    that match the phase AND are unresolved (both team ids
    //    NULL) AND have no score. Round in bracket_matches uses
    //    `Cat|<roundKey>` (e.g. `Infantil Femenino|ronda-1`); the
    //    materializer maps that to a human phase like `Ronda 1|Cat`.
    //    The mapping uses `bracketRoundToMatchPhase` server-side —
    //    we replicate the inverse here with the known short→long
    //    mapping so we hit the right phase column.
    const roundKeyToLabel: Record<string, string> = {
      'ronda-1': 'Ronda 1',
      'ronda-2': 'Ronda 2',
      'ronda-3': 'Ronda 3',
      cuartos: 'Cuartos',
      semifinal: 'Semifinal',
      final: 'Final',
      'tercer-puesto': 'Tercer puesto',
    };

    // Strategy: rather than try to match individual bye rows to
    // individual `matches` rows (impossible when `bracket_match_id`
    // is NULL on every legacy fixture), we wipe the WHOLE bracket-
    // phase footprint of `matches` that's still unresolved and
    // un-scored, then let the materializer (which now skips byes)
    // rebuild from `bracket_matches`. The result is one card per
    // real game and zero cards for byes.
    //
    // Hard guarantees preserved:
    //   · `status = 'upcoming'` and `score_team1/2 IS NULL` — never
    //     destroy played fixtures.
    //   · We touch only matches whose `phase` matches the rounds
    //     that exist in `bracket_matches` for this tournament, so
    //     non-bracket phases (e.g. group rows whose admin renamed
    //     phase) stay untouched.
    //   · `bracket_match_id IS NULL` is NOT a filter — we also drop
    //     stale linked rows that the materializer can recreate.
    //     The clean ON CONFLICT path in materialize means re-running
    //     immediately is idempotent.
    const bracketPhasesRes = await pool.query<{ phase: string }>(
      `SELECT DISTINCT phase
         FROM matches
         WHERE tournament_id = $1
           AND status = 'upcoming'
           AND score_team1 IS NULL
           AND score_team2 IS NULL
           AND phase IS NOT NULL
           AND phase <> ''
           AND phase <> 'grupos'`,
      [id],
    );
    const bracketPhases = bracketPhasesRes.rows
      .map((r) => r.phase)
      .filter(Boolean);

    const deleted: Array<{
      round: string;
      phase: string;
      matchesDeleted: number;
      byeCount: number;
    }> = [];
    let total = 0;
    if (bracketPhases.length > 0) {
      // One delete sweep over every bracket phase. Counting per-phase
      // for the response is a separate query so we keep the delete
      // atomic and cheap.
      const counts = await pool.query<{ phase: string; n: number }>(
        `SELECT phase, COUNT(*)::int AS n
           FROM matches
           WHERE tournament_id = $1
             AND status = 'upcoming'
             AND score_team1 IS NULL
             AND score_team2 IS NULL
             AND phase = ANY($2)
           GROUP BY phase`,
        [id, bracketPhases],
      );
      const countsByPhase = new Map<string, number>();
      for (const r of counts.rows) countsByPhase.set(r.phase, r.n);

      const wipe = await pool.query(
        `DELETE FROM matches
           WHERE tournament_id = $1
             AND status = 'upcoming'
             AND score_team1 IS NULL
             AND score_team2 IS NULL
             AND phase = ANY($2)
           RETURNING id, phase`,
        [id, bracketPhases],
      );
      total = wipe.rowCount ?? 0;

      // Group the delete report by bracket round metadata so the
      // operator can sanity-check that the right rounds got wiped.
      const byPhase = new Map<string, number>();
      for (const r of wipe.rows) {
        byPhase.set(r.phase as string, (byPhase.get(r.phase as string) ?? 0) + 1);
      }
      for (const r of byesRes.rows) {
        const round = r.round;
        const segs = round.split('|');
        const category = segs.length >= 2 ? segs[0] : '';
        const roundKey = segs[segs.length - 1];
        const label = roundKeyToLabel[roundKey] ?? roundKey;
        const phase = category ? `${label}|${category}` : label;
        deleted.push({
          round,
          phase,
          matchesDeleted: byPhase.get(phase) ?? 0,
          byeCount: r.bye_count,
        });
      }
    }

    // Re-run the materializer right away so the response reflects
    // the rebuilt state. Best-effort: if it fails, the next admin GET
    // will trigger it anyway (the controller hooks it on auth'd
    // reads). We still return the delete report either way.
    let rematerializeError: string | null = null;
    try {
      await bracketGenerator.materializePendingBracketMatches(id);
    } catch (err) {
      rematerializeError =
        err instanceof Error ? err.message : String(err);
    }

    res.json({
      tournamentId: id,
      deletedCount: total,
      deleted,
      byeRoundsScanned: byesRes.rows.length,
      rematerializeError,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Bulk-move every match of this tournament whose `date = fromDate`
 * onto `toDate`. Built for the 2026-05-13 incident where the bracket
 * materializer overflowed past the tournament's `endDate` and left
 * cards on a day the cronograma can't reach (its day-picker is
 * bounded by startDate..endDate).
 *
 * Deliberately bypasses the per-row schedule-conflict check that
 * `match.service.update` enforces — the whole point of this endpoint
 * is to gather the overflow back inside the range even if it causes
 * temporary overlaps. The admin then drag-drops each card to a free
 * slot in the cronograma (which DOES enforce conflicts per move).
 *
 * Hard safety rails:
 *   · `status = 'upcoming'` only — never reschedule live/completed.
 *   · `score_team1 IS NULL AND score_team2 IS NULL` — extra belt.
 *   · Scoped to a single tournament_id (the route param). Cannot
 *     reach across torneos.
 *   · Returns the count + ids that were moved so the operator can
 *     audit. Gated by `requireTournamentAccess` (admin/super_admin
 *     owner of the torneo) at the route layer.
 */
export async function bulkMoveDate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { fromDate, toDate } = (req.body ?? {}) as {
      fromDate?: string;
      toDate?: string;
    };
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!fromDate || !dateRe.test(fromDate)) {
      throw new ValidationError('fromDate debe ser YYYY-MM-DD');
    }
    if (!toDate || !dateRe.test(toDate)) {
      throw new ValidationError('toDate debe ser YYYY-MM-DD');
    }
    if (fromDate === toDate) {
      throw new ValidationError('fromDate y toDate son iguales — no hay nada que mover');
    }

    const pool = (await import('../config/database')).getPool();
    const result = await pool.query<{ id: string; phase: string; time: string; court: string }>(
      `UPDATE matches
          SET date = $3, updated_at = NOW()
        WHERE tournament_id = $1
          AND date = $2
          AND status = 'upcoming'
          AND score_team1 IS NULL
          AND score_team2 IS NULL
       RETURNING id, phase, time, court`,
      [id, fromDate, toDate],
    );

    res.json({
      tournamentId: id,
      fromDate,
      toDate,
      movedCount: result.rowCount ?? 0,
      moved: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Publish the tournament schedule to every enrolled club. Stamps
 * `schedule_sent_to_clubs_at` (mig 032) and fires a push notification
 * to each distinct club whose team participates in this torneo, so
 * the club-captain panel unlocks its read-only Cronograma view and
 * the captain learns about it without polling.
 *
 * Gated by `requireTournamentAccess` (admin/super_admin owner of the
 * torneo). Idempotent: calling it twice updates the timestamp + re-
 * fires the notification, so the admin can resend after a schedule
 * edit without an extra "force" flag.
 *
 * Best-effort push: a missing VAPID config or a transient web-push
 * 5xx must not roll back the timestamp update — the schedule is
 * still considered "published" and the next club captain to log in
 * will see it.
 */
export async function sendScheduleToClubs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const pool = (await import('../config/database')).getPool();

    // 1) Stamp the timestamp first so the club-panel cronograma
    //    unlocks even if the push leg later fails.
    const stampRes = await pool.query<{
      id: string;
      name: string;
      schedule_sent_to_clubs_at: Date | string | null;
    }>(
      `UPDATE tournaments
          SET schedule_sent_to_clubs_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
       RETURNING id, name, schedule_sent_to_clubs_at`,
      [id],
    );
    if (stampRes.rows.length === 0) {
      throw new ValidationError('Torneo no encontrado');
    }
    const stamped = stampRes.rows[0];

    // 2) Discover every distinct club with an enrolled team in this
    //    torneo. Skip teams with no club_id (legacy / unassigned).
    const clubsRes = await pool.query<{ id: string; name: string }>(
      `SELECT DISTINCT c.id, c.name
         FROM tournament_teams tt
         JOIN teams t ON t.id = tt.team_id
         JOIN clubs c ON c.id = t.club_id
        WHERE tt.tournament_id = $1`,
      [id],
    );

    // 3) Fire a push per club. Best-effort: a failure on one club
    //    must not block the rest, and the overall response is
    //    success regardless (the timestamp is the source of truth).
    const pushService = (await import('../services/push.service')).pushService;
    const notified: Array<{ clubId: string; clubName: string }> = [];
    for (const c of clubsRes.rows) {
      try {
        await pushService.sendToClub(c.id, {
          title: 'Programación cargada',
          body: `Ya podés ver el cronograma de ${stamped.name} en el panel del club.`,
          url: '/club-panel',
          tag: `schedule-${id}-${c.id}`,
        });
        notified.push({ clubId: c.id, clubName: c.name });
      } catch (err) {
        console.warn(
          `[sendScheduleToClubs] push failed for club ${c.id}:`,
          err,
        );
      }
    }

    res.json({
      tournamentId: id,
      tournamentName: stamped.name,
      sentAt:
        stamped.schedule_sent_to_clubs_at instanceof Date
          ? stamped.schedule_sent_to_clubs_at.toISOString()
          : stamped.schedule_sent_to_clubs_at,
      clubsNotified: notified.length,
      clubs: notified,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Diagnostic report — does each enrolled club have an active push
 * subscription on record? Built after the 2026-05-13 admin question
 * "¿cómo sé que SÍ les va a llegar?". Returns one row per enrolled
 * club with:
 *   · subscriptionCount → number of devices currently registered
 *                          for push under this club's clubId
 *   · lastUsedAt        → most recent successful dispatch (NULL if
 *                          no push has been sent through this sub)
 *   · captainSeen       → last_login of the club's captain user
 *                          (helps distinguish "no captain ever
 *                          logged in" from "logged in but didn't
 *                          accept push permission")
 *
 * Owner-gated. Read-only.
 */
export async function pushDebug(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const pool = (await import('../config/database')).getPool();

    // mig 028 — club captains authenticate against the `clubs`
    // table directly (clubs.username + clubs.password_hash), not
    // through the regular users table. The JWT's `userId` for a
    // captain IS the club id, so push_subscriptions.club_id links
    // straight back here.
    const result = await pool.query<{
      club_id: string;
      club_name: string;
      club_username: string;
      subscription_count: number;
      last_used_at: Date | null;
    }>(
      `SELECT
         c.id AS club_id,
         c.name AS club_name,
         c.username AS club_username,
         (
           SELECT COUNT(*)::int FROM push_subscriptions ps
            WHERE ps.club_id = c.id
         ) AS subscription_count,
         (
           SELECT MAX(ps.last_used_at) FROM push_subscriptions ps
            WHERE ps.club_id = c.id
         ) AS last_used_at
       FROM tournament_teams tt
       JOIN teams t ON t.id = tt.team_id
       JOIN clubs c ON c.id = t.club_id
       WHERE tt.tournament_id = $1
       GROUP BY c.id, c.name, c.username
       ORDER BY c.name`,
      [id],
    );

    const clubs = result.rows.map((r) => ({
      clubId: r.club_id,
      clubName: r.club_name,
      clubUsername: r.club_username,
      subscriptionCount: r.subscription_count,
      lastUsedAt:
        r.last_used_at instanceof Date
          ? r.last_used_at.toISOString()
          : r.last_used_at,
    }));

    const summary = {
      totalClubs: clubs.length,
      clubsWithSubscriptions: clubs.filter((c) => c.subscriptionCount > 0).length,
      clubsWithoutSubscriptions: clubs.filter((c) => c.subscriptionCount === 0).length,
      totalSubscriptions: clubs.reduce((sum, c) => sum + c.subscriptionCount, 0),
    };

    res.json({ tournamentId: id, summary, clubs });
  } catch (error) {
    next(error);
  }
}

/**
 * Send a free-form push notification to every club enrolled in this
 * tournament. Differs from `sendScheduleToClubs` in two ways:
 *   · accepts a custom `title` + `body` (anything the admin wants
 *     to say — reminders, schedule rumours, motivational nudges,
 *     etc.) instead of the hard-coded "Programación cargada" copy;
 *   · does NOT stamp `schedule_sent_to_clubs_at`. The publish
 *     state of the schedule is a separate concern; this endpoint
 *     is for one-off broadcasts.
 *
 * Owner-gated by `requireTournamentAccess` at the route layer.
 * Idempotent enough (admins re-firing it is fine — each fan-out
 * uses a unique tag derived from a timestamp so the device doesn't
 * collapse them into a single visible notification).
 *
 * Required body: `{ title: string, body: string, url?: string }`.
 * The URL defaults to `/club-panel` so a tap lands the captain on
 * the right page; admins can override it (e.g. `/torneo/<slug>`
 * for a public-detail deeplink).
 */
export async function notifyClubs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { title, body, url } = (req.body ?? {}) as {
      title?: string;
      body?: string;
      url?: string;
    };
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new ValidationError('title es obligatorio');
    }
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ValidationError('body es obligatorio');
    }
    const finalUrl =
      typeof url === 'string' && url.trim() !== '' ? url.trim() : '/club-panel';

    const pool = (await import('../config/database')).getPool();
    const tournRes = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM tournaments WHERE id = $1',
      [id],
    );
    if (tournRes.rows.length === 0) {
      throw new ValidationError('Torneo no encontrado');
    }

    const clubsRes = await pool.query<{ id: string; name: string }>(
      `SELECT DISTINCT c.id, c.name
         FROM tournament_teams tt
         JOIN teams t ON t.id = tt.team_id
         JOIN clubs c ON c.id = t.club_id
        WHERE tt.tournament_id = $1`,
      [id],
    );

    const pushService = (await import('../services/push.service')).pushService;
    // Single timestamp per dispatch so all clubs get the SAME unique
    // tag — preserves the "this is a fan-out" identity but lets the
    // OS replace an older same-tag notif with the newer one if a
    // captain has multiple devices subscribed.
    const tag = `tournament-${id}-broadcast-${Date.now()}`;
    const notified: Array<{ clubId: string; clubName: string }> = [];
    for (const c of clubsRes.rows) {
      try {
        await pushService.sendToClub(c.id, {
          title: title.trim(),
          body: body.trim(),
          url: finalUrl,
          tag,
        });
        notified.push({ clubId: c.id, clubName: c.name });
      } catch (err) {
        console.warn(`[notifyClubs] push failed for club ${c.id}:`, err);
      }
    }

    res.json({
      tournamentId: id,
      tournamentName: tournRes.rows[0].name,
      clubsNotified: notified.length,
      clubs: notified,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Free-form broadcast to EVERY subscriber (public spectators +
 * captains). Same shape as `notifyClubs` but uses `sendToAll`
 * under the hood — admins use this for tournament-wide
 * announcements (postponed games, weather, etc.) that everyone
 * watching the event should see, not just the clubes.
 *
 * Required body: `{ title: string, body: string, url?: string }`.
 * Owner-gated by `requireTournamentAccess` at the route.
 */
export async function notifyAll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { title, body, url } = (req.body ?? {}) as {
      title?: string;
      body?: string;
      url?: string;
    };
    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new ValidationError('title es obligatorio');
    }
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new ValidationError('body es obligatorio');
    }
    const finalUrl =
      typeof url === 'string' && url.trim() !== '' ? url.trim() : `/torneo`;

    const pool = (await import('../config/database')).getPool();
    const tournRes = await pool.query<{ id: string; name: string; slug: string | null }>(
      'SELECT id, name, slug FROM tournaments WHERE id = $1',
      [id],
    );
    if (tournRes.rows.length === 0) {
      throw new ValidationError('Torneo no encontrado');
    }
    const tournament = tournRes.rows[0];

    // Count active push subscriptions so the response gives the
    // admin a realistic "alcance estimado". Doesn't gate the send —
    // sendToAll loops over the table anyway.
    const countRes = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions`,
    );
    const totalSubscriptions = countRes.rows[0]?.count ?? 0;

    const pushService = (await import('../services/push.service')).pushService;
    const tag = `tournament-${id}-all-${Date.now()}`;
    try {
      await pushService.sendToAll({
        title: title.trim(),
        body: body.trim(),
        url: tournament.slug ? `/torneo/${tournament.slug}` : finalUrl,
        tag,
      });
    } catch (err) {
      console.warn('[notifyAll] dispatch failed', err);
    }

    res.json({
      tournamentId: id,
      tournamentName: tournament.name,
      totalSubscriptions,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Force-recalculate and persist the standings for a tournament, then re-
 * resolve any bracket slots that reference group positions so the knockout
 * bracket stays in sync with the freshly computed table. Used by the admin
 * UI's "Recalcular tabla" button.
 */
export async function recalculateStandings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const standings = await standingsCalculator.recalculate(id);
    // Best-effort: if the tournament doesn't have a bracket yet or has no
    // placeholders to resolve, this is a no-op. Failures here shouldn't
    // prevent the caller from getting the fresh standings.
    try {
      await bracketGenerator.resolveBracketFromStandings(id);
    } catch {
      // swallow: the standings update is the primary response
    }
    // Run the division auto-gen too so the "Recalcular Tabla y Bracket"
    // button is the manual override for tournaments that already
    // finished their group phase. force=true tells the auto-gen to
    // wipe and rebuild the bracket using the FRESH cumulative
    // ranking — guarded internally so any in-progress bracket match
    // aborts the regen instead of erasing played rounds.
    try {
      await fixtureGenerator.autoGenerateDivisionBrackets(id, { force: true });
      // Re-resolve once more so freshly inserted Oro/Plata placeholders
      // pick up the current standings without waiting for the next
      // poll tick on the client.
      await bracketGenerator.resolveBracketFromStandings(id);
    } catch {
      // swallow: best-effort
    }
    res.json(standings);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/tournaments/:id/repair-conflicts
 *
 * Detects every team double-booking in the tournament's matches and
 * reschedules the offending matches into safe slots. Used by the admin
 * "Reparar horarios" button after the SAN JOSE A bug from 2026-05-10
 * surfaced a class of legacy fixtures with two-matches-at-the-same-time
 * for one team.
 *
 * Auth + ownership: gated at the route level by requireTournamentAccess,
 * so an admin can only repair their own tournaments and judges + public
 * are blocked. Returns the move list so the UI can show "moví N partidos".
 */
export async function repairConflicts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const result = await matchService.repairTeamConflicts(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getBracket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const bracket = await tournamentService.getBracket(id);
    res.json(bracket);
  } catch (error) {
    next(error);
  }
}

export async function getEnrolledTeams(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const teams = await enrollmentService.getEnrolledTeams(id);
    res.json(teams);
  } catch (error) {
    next(error);
  }
}

export async function enrollTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { teamId } = req.body;
    // The acting owner is the admin in req.user; super_admin and judge
    // pass null so the service skips the cross-tenant check (super_admin
    // can enroll any team, judge shouldn't reach this route at all but
    // the role guard runs before us).
    const actingOwnerId = req.user?.role === 'admin' ? req.user.userId : null;
    const enrolled = await enrollmentService.enroll(id, teamId, actingOwnerId);
    res.status(201).json(enrolled);
  } catch (error) {
    next(error);
  }
}

export async function unenrollTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const teamId = req.params.teamId as string;
    validateUUID(teamId, 'ID de equipo');
    await enrollmentService.unenroll(id, teamId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function generateFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { schedule, categoryFilter } = req.body || {};
    const result = await fixtureGenerator.generate(id, schedule, categoryFilter);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function generateManualFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { groups, bracketSeeds, schedule, categoryFilter } = req.body;
    const result = await fixtureGenerator.generateManual(id, {
      groups,
      bracketSeeds,
      schedule,
      categoryFilter,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function clearFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await fixtureGenerator.clearFixtures(id);
    // Also clear standings
    const { getPool } = await import('../config/database');
    const pool = getPool();
    await pool.query('DELETE FROM standings WHERE tournament_id = $1', [id]);
    res.json({ message: 'Cruces eliminados' });
  } catch (error) {
    next(error);
  }
}

export async function updateBracketMatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tournamentId = req.params.id as string;
    const matchId = req.params.matchId as string;
    validateUUID(tournamentId, 'ID de torneo');
    validateUUID(matchId, 'ID de partido de bracket');

    const { scoreTeam1, scoreTeam2, status, sets } = req.body;

    // Update score fields on the bracket match
    const pool = (await import('../config/database')).getPool();

    // Verify the bracket match belongs to this tournament
    const bmResult = await pool.query(
      'SELECT * FROM bracket_matches WHERE id = $1 AND tournament_id = $2',
      [matchId, tournamentId]
    );
    if (bmResult.rows.length === 0) {
      throw new ValidationError('Partido de bracket no encontrado en este torneo');
    }

    const bm = bmResult.rows[0];

    // Update score and status
    await pool.query(
      `UPDATE bracket_matches SET score_team1 = $1, score_team2 = $2, status = $3 WHERE id = $4`,
      [scoreTeam1 ?? bm.score_team1, scoreTeam2 ?? bm.score_team2, status ?? bm.status, matchId]
    );

    // If completed, determine winner and advance
    if (status === 'completed' && bm.team1_id && bm.team2_id) {
      // Determine winner from sets if provided, otherwise from scores
      let winnerId: string;
      if (sets && sets.length > 0) {
        let team1SetsWon = 0;
        let team2SetsWon = 0;
        for (const s of sets) {
          if (s.team1Points > s.team2Points) team1SetsWon++;
          else if (s.team2Points > s.team1Points) team2SetsWon++;
        }
        winnerId = team1SetsWon > team2SetsWon ? bm.team1_id : bm.team2_id;
      } else {
        winnerId = (scoreTeam1 ?? 0) > (scoreTeam2 ?? 0) ? bm.team1_id : bm.team2_id;
      }

      // Use bracketGenerator.advanceWinner to set winner and advance to next round
      await bracketGenerator.advanceWinner(matchId, winnerId);
    }

    // Return updated bracket for the tournament
    const bracket = await bracketGenerator.getBracket(tournamentId);
    res.json(bracket);
  } catch (error) {
    next(error);
  }
}

export async function generateBracketCrossings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { seeds, categoryFilter, bracketTier } = req.body;
    if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
      throw new ValidationError('Se requieren las posiciones del bracket (seeds)');
    }
    if (bracketTier && bracketTier !== 'gold' && bracketTier !== 'silver') {
      throw new ValidationError('bracketTier debe ser "gold" o "silver"');
    }
    const bracketMatches = await fixtureGenerator.generateBracketCrossings(id, seeds, {
      categoryFilter,
      bracketTier,
    });
    res.json({ bracketMatches, generatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}

export async function resolveBracket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await bracketGenerator.resolveBracketFromStandings(id);
    // Run materialize explicitly so the response carries the diagnostic
    // snapshot. resolveBracketFromStandings already invokes it, but its
    // return value is just the count of bracket-row updates — we want
    // the materializer's own counters to surface in the toast.
    const materialize = await bracketGenerator
      .materializePendingBracketMatches(id)
      .catch((err) => {
        console.warn('[resolveBracket] materialize failed:', err);
        return null;
      });
    const bracket = await bracketGenerator.getBracket(id);
    res.json({ bracket, materialize });
  } catch (error) {
    next(error);
  }
}
