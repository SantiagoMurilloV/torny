import { getPool } from '../config/database';
import {
  Tournament,
  CreateTournamentDto,
  UpdateTournamentDto,
  ValidationResult,
  Match,
  StandingsRow,
  BracketMatch,
} from '../types';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { validate, validateDateRange } from '../middleware/validation';

/**
 * Context for listing tournaments. Matches caller roles:
 *   · public (no token)  → { scope: 'all' }
 *   · admin              → { scope: 'owner', ownerId: userId }
 *   · super_admin        → { scope: 'all' }
 */
export type ListScope =
  | { scope: 'all' }
  | { scope: 'owner'; ownerId: string };

/**
 * Postgres DATE columns come back from `pg` either as a Date instance
 * or a YYYY-MM-DD string depending on the driver version. Normalise to
 * a plain ISO date (no time component) so the frontend can bind it
 * straight into an `<input type="date">`.
 */
function normalizeDate(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return undefined;
}

/**
 * Clamp a possibly-undefined integer to a valid range with a default
 * fallback. Used by the classifiers-per-group fields so an admin can't
 * post 0 or 999 even if the frontend lets them type it. The CHECK
 * constraints at the DB layer also reject out-of-range values, but
 * doing it here surfaces a clean default instead of an SQL error.
 */
function clampInt(
  value: number | undefined | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function mapRow(row: Record<string, unknown>): Tournament {
  // court_locations may come as object (jsonb parsed by pg) or null/undefined
  const rawLocations = row.court_locations as Record<string, string> | null | undefined;
  // enrolled_count / matches_count are populated by the LIST/GET-by-id
  // queries via correlated subqueries. Fallback to undefined when the
  // row came from a SELECT that didn't include them (legacy callers /
  // internal helpers) so the public API always exposes a number.
  const enrolledRaw = row.enrolled_count;
  const matchesRaw = row.matches_count;
  return {
    id: row.id as string,
    name: row.name as string,
    sport: row.sport as string,
    club: row.club as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    description: row.description as string | undefined,
    coverImage: row.cover_image as string | undefined,
    logo: row.logo as string | undefined,
    status: row.status as Tournament['status'],
    teamsCount: row.teams_count as number,
    format: row.format as Tournament['format'],
    courts: row.courts as string[],
    courtLocations: rawLocations && typeof rawLocations === 'object' ? rawLocations : {},
    categories: (row.categories as string[] | null | undefined) ?? [],
    ownerId: (row.owner_id as string | null) ?? undefined,
    enrollmentDeadline: normalizeDate(row.enrollment_deadline),
    playersPerTeam: (row.players_per_team as number | null) ?? undefined,
    bracketMode:
      ((row.bracket_mode as string | null) === 'divisions'
        ? 'divisions'
        : 'manual') as Tournament['bracketMode'],
    goldClassifiersPerGroup:
      (row.gold_classifiers_per_group as number | null) ?? undefined,
    silverClassifiersPerGroup:
      (row.silver_classifiers_per_group as number | null) ?? undefined,
    regulationText: (row.regulation_text as string | null) ?? undefined,
    regulationPdf: (row.regulation_pdf as string | null) ?? undefined,
    enrolledCount:
      typeof enrolledRaw === 'number'
        ? enrolledRaw
        : enrolledRaw != null
          ? Number(enrolledRaw)
          : undefined,
    matchesCount:
      typeof matchesRaw === 'number'
        ? matchesRaw
        : matchesRaw != null
          ? Number(matchesRaw)
          : undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

function mapMatchRow(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    team1Id: row.team1_id as string,
    team2Id: row.team2_id as string,
    date: row.date as string,
    time: row.time as string,
    court: row.court as string,
    referee: row.referee as string | undefined,
    status: row.status as Match['status'],
    scoreTeam1: row.score_team1 as number | undefined,
    scoreTeam2: row.score_team2 as number | undefined,
    phase: row.phase as string,
    groupName: row.group_name as string | undefined,
    duration: row.duration as number | undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

function mapStandingsRow(row: Record<string, unknown>): StandingsRow {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    teamId: row.team_id as string,
    groupName: row.group_name as string | undefined,
    position: row.position as number,
    played: row.played as number,
    wins: row.wins as number,
    losses: row.losses as number,
    setsFor: row.sets_for as number,
    setsAgainst: row.sets_against as number,
    pointsFor: (row.points_for as number | null) ?? 0,
    pointsAgainst: (row.points_against as number | null) ?? 0,
    points: row.points as number,
    isQualified: row.is_qualified as boolean,
    team: row.team_name
      ? {
          id: row.team_id as string,
          name: row.team_name as string,
          initials: row.team_initials as string,
          logo: row.team_logo as string | undefined,
          primaryColor: row.team_primary_color as string,
          secondaryColor: row.team_secondary_color as string,
          city: row.team_city as string | undefined,
          department: row.team_department as string | undefined,
          category: row.team_category as string | undefined,
        }
      : undefined,
  };
}

function mapBracketRow(row: Record<string, unknown>): BracketMatch {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    team1Id: row.team1_id as string | undefined,
    team2Id: row.team2_id as string | undefined,
    winnerId: row.winner_id as string | undefined,
    scoreTeam1: row.score_team1 as number | undefined,
    scoreTeam2: row.score_team2 as number | undefined,
    status: row.status as BracketMatch['status'],
    round: row.round as string,
    position: row.position as number,
    team1Placeholder: row.team1_placeholder as string | undefined,
    team2Placeholder: row.team2_placeholder as string | undefined,
  };
}

export class TournamentService {
  /**
   * List tournaments filtered by the caller's scope.
   *   · `{ scope: 'all' }`            → every tournament (public pages + super_admin)
   *   · `{ scope: 'owner', ownerId }` → only rows belonging to that admin
   */
  /**
   * SELECT clause used by every public-facing tournament read. We
   * decorate each row with two correlated counts so the home cards and
   * the detail hero can show real enrollment + scheduled-matches
   * numbers instead of the configured cap (`teams_count`).
   *   · enrolled_count → equipos efectivamente inscritos (tournament_teams)
   *   · matches_count  → partidos generados (matches)
   * Both stay cheap because tournament_teams.tournament_id and
   * matches.tournament_id are indexed.
   */
  private static readonly LIST_SELECT = `
    SELECT
      t.*,
      (SELECT COUNT(*)::int FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS enrolled_count,
      (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = t.id) AS matches_count
    FROM tournaments t
  `;

  async getAll(scope: ListScope = { scope: 'all' }): Promise<Tournament[]> {
    const pool = getPool();
    if (scope.scope === 'owner') {
      const result = await pool.query(
        `${TournamentService.LIST_SELECT} WHERE t.owner_id = $1 ORDER BY t.start_date DESC`,
        [scope.ownerId],
      );
      return result.rows.map(mapRow);
    }
    const result = await pool.query(
      `${TournamentService.LIST_SELECT} ORDER BY t.start_date DESC`,
    );
    return result.rows.map(mapRow);
  }

  async getById(id: string): Promise<Tournament> {
    const pool = getPool();
    const result = await pool.query(
      `${TournamentService.LIST_SELECT} WHERE t.id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Torneo');
    }
    return mapRow(result.rows[0]);
  }

  /**
   * List the tournaments a given team is currently enrolled in. Drives the
   * captain panel's "Plantel (X / Y)" counter — the captain needs to know
   * the strictest `playersPerTeam` cap across their inscriptions, plus the
   * enrollment_deadline of each tournament so the UI can hint when edits
   * are about to lock.
   *
   * Reuses LIST_SELECT so the response is the same shape every other
   * tournament read returns; the frontend transformer (`toFrontendTournament`)
   * works without changes. Sorted with active tournaments first
   * (upcoming/ongoing before completed), then by start date so the most
   * relevant ones land at the top of the captain's view.
   */
  async getByTeamId(teamId: string): Promise<Tournament[]> {
    const pool = getPool();
    const result = await pool.query(
      `${TournamentService.LIST_SELECT}
       JOIN tournament_teams tt ON tt.tournament_id = t.id
       WHERE tt.team_id = $1
       ORDER BY
         CASE t.status
           WHEN 'ongoing' THEN 0
           WHEN 'upcoming' THEN 1
           WHEN 'completed' THEN 2
           ELSE 3
         END,
         t.start_date DESC`,
      [teamId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * Enforce the admin's tournament creation cap. No-op for super_admin or
   * when ownerId is null (legacy / platform-owned). Throws a ValidationError
   * with a human-readable message so the frontend can surface it directly.
   */
  async assertQuota(ownerId: string | null): Promise<void> {
    if (!ownerId) return;
    const pool = getPool();
    const userResult = await pool.query(
      'SELECT role, tournament_quota FROM users WHERE id = $1',
      [ownerId],
    );
    if (userResult.rows.length === 0) return;
    const user = userResult.rows[0] as { role: string; tournament_quota: number };
    if (user.role !== 'admin') return; // super_admin has no quota
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS n FROM tournaments WHERE owner_id = $1',
      [ownerId],
    );
    const n = (countResult.rows[0] as { n: number }).n;
    if (n >= user.tournament_quota) {
      throw new ValidationError(
        `Alcanzaste el límite de tu plan (${user.tournament_quota} torneo${
          user.tournament_quota === 1 ? '' : 's'
        }). Contactá al super administrador para ampliarlo.`,
      );
    }
  }

  /**
   * Create a tournament. `ownerId` is set by the controller from
   * `req.user` — never trust a client-provided value — so admins can only
   * ever create tournaments under their own name. Super_admin may pass
   * null (platform-owned).
   */
  async create(
    data: CreateTournamentDto,
    ownerId: string | null = null,
  ): Promise<Tournament> {
    this.validateData(data);
    await this.assertQuota(ownerId);
    const pool = getPool();
    const bracketMode = data.bracketMode === 'divisions' ? 'divisions' : 'manual';
    // Clamp classifier counts so admins can't create a bracket of 0 or
    // a >8-team-per-group monster. The CHECK constraint at the DB
    // would also reject these but we want a friendlier path.
    const goldClassifiers = clampInt(data.goldClassifiersPerGroup, 1, 8, 2);
    const silverClassifiers = clampInt(data.silverClassifiersPerGroup, 0, 8, 2);
    const result = await pool.query(
      `INSERT INTO tournaments (name, sport, club, start_date, end_date, description, cover_image, logo, status, teams_count, format, courts, court_locations, categories, owner_id, enrollment_deadline, players_per_team, bracket_mode, gold_classifiers_per_group, silver_classifiers_per_group, regulation_text, regulation_pdf)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [
        data.name,
        data.sport,
        data.club,
        data.startDate,
        data.endDate,
        data.description || null,
        data.coverImage || null,
        data.logo || null,
        data.status,
        data.teamsCount,
        data.format,
        data.courts || [],
        JSON.stringify(data.courtLocations || {}),
        data.categories ?? [],
        ownerId,
        data.enrollmentDeadline || null,
        data.playersPerTeam ?? 12,
        bracketMode,
        goldClassifiers,
        silverClassifiers,
        data.regulationText || null,
        data.regulationPdf || null,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async update(id: string, data: UpdateTournamentDto): Promise<Tournament> {
    // Ensure tournament exists
    await this.getById(id);

    // If updating dates or name, validate them
    if (data.name !== undefined || data.startDate !== undefined || data.endDate !== undefined || data.teamsCount !== undefined) {
      const existing = await this.getById(id);
      const merged = { ...existing, ...data } as CreateTournamentDto;
      this.validateData(merged);
    }

    const pool = getPool();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const columnMap: Record<string, string> = {
      name: 'name',
      sport: 'sport',
      club: 'club',
      startDate: 'start_date',
      endDate: 'end_date',
      description: 'description',
      coverImage: 'cover_image',
      logo: 'logo',
      status: 'status',
      teamsCount: 'teams_count',
      format: 'format',
      courts: 'courts',
      courtLocations: 'court_locations',
      categories: 'categories',
      enrollmentDeadline: 'enrollment_deadline',
      playersPerTeam: 'players_per_team',
      bracketMode: 'bracket_mode',
      goldClassifiersPerGroup: 'gold_classifiers_per_group',
      silverClassifiersPerGroup: 'silver_classifiers_per_group',
      regulationText: 'regulation_text',
      regulationPdf: 'regulation_pdf',
    };

    for (const [key, column] of Object.entries(columnMap)) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        fields.push(column + ' = $' + idx);
        // jsonb column requires stringified JSON; bracketMode is clamped
        // to the two supported enum values so a client cannot smuggle an
        // arbitrary string in. Classifier counts go through clampInt so
        // an out-of-range value silently snaps to the safe default.
        const rawValue = (data as Record<string, unknown>)[key];
        let stored: unknown = rawValue;
        if (key === 'courtLocations') {
          stored = JSON.stringify(rawValue ?? {});
        } else if (key === 'bracketMode') {
          stored = rawValue === 'divisions' ? 'divisions' : 'manual';
        } else if (key === 'goldClassifiersPerGroup') {
          stored = clampInt(rawValue as number | null | undefined, 1, 8, 2);
        } else if (key === 'silverClassifiersPerGroup') {
          stored = clampInt(rawValue as number | null | undefined, 0, 8, 2);
        } else if (key === 'regulationText' || key === 'regulationPdf') {
          // Normaliza '' → null para que "limpiar" desde el form deje
          // la columna realmente vacía en vez de un string vacío. El
          // frontend manda undefined cuando el campo no cambia (no entra
          // al loop) y null cuando lo borró explícitamente.
          stored = rawValue === '' || rawValue == null ? null : rawValue;
        }
        values.push(stored);
        idx++;
      }
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = 'UPDATE tournaments SET ' + fields.join(', ') + ' WHERE id = $' + idx + ' RETURNING *';
    const result = await pool.query(query, values);
    return mapRow(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    // Ensure tournament exists
    await this.getById(id);
    const pool = getPool();
    // CASCADE is handled by FK constraints on matches, standings, bracket_matches, tournament_teams
    await pool.query('DELETE FROM tournaments WHERE id = $1', [id]);
  }

  async getMatches(tournamentId: string): Promise<Match[]> {
    // Ensure tournament exists
    await this.getById(tournamentId);
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM matches WHERE tournament_id = $1 ORDER BY date, time',
      [tournamentId]
    );
    const matches: Match[] = result.rows.map(mapMatchRow);
    if (matches.length === 0) return matches;

    // Attach per-set scores so the public clasificación tab can compute
    // rally-point totals (`pointsFor` / `pointsAgainst`). Without this
    // the column always renders 0/0 even after matches were played,
    // because mapMatchRow only carries the aggregate score, not the
    // individual sets. One query for every match in the tournament.
    const matchIds = matches.map((m) => m.id);
    const setsRes = await pool.query(
      `SELECT id, match_id, set_number, team1_points, team2_points
       FROM set_scores
       WHERE match_id = ANY($1)
       ORDER BY set_number`,
      [matchIds],
    );
    const setsByMatch = new Map<string, Array<Match['sets'] extends Array<infer U> | undefined ? U : never>>();
    for (const row of setsRes.rows as Array<Record<string, unknown>>) {
      const matchId = row.match_id as string;
      const list = setsByMatch.get(matchId) ?? [];
      list.push({
        id: row.id as string,
        matchId,
        setNumber: row.set_number as number,
        team1Points: row.team1_points as number,
        team2Points: row.team2_points as number,
      });
      setsByMatch.set(matchId, list);
    }
    for (const m of matches) {
      m.sets = setsByMatch.get(m.id) ?? [];
    }
    return matches;
  }

  async getStandings(tournamentId: string): Promise<StandingsRow[]> {
    // Ensure tournament exists
    await this.getById(tournamentId);
    const pool = getPool();
    const result = await pool.query(
      `SELECT s.*, t.name AS team_name, t.initials AS team_initials, t.logo AS team_logo,
              t.primary_color AS team_primary_color, t.secondary_color AS team_secondary_color,
              t.city AS team_city, t.department AS team_department, t.category AS team_category
       FROM standings s
       LEFT JOIN teams t ON s.team_id = t.id
       WHERE s.tournament_id = $1
       ORDER BY s.group_name, s.position`,
      [tournamentId]
    );
    return result.rows.map(mapStandingsRow);
  }

  async getBracket(tournamentId: string): Promise<BracketMatch[]> {
    // Ensure tournament exists
    await this.getById(tournamentId);
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM bracket_matches WHERE tournament_id = $1 ORDER BY round, position',
      [tournamentId]
    );
    return result.rows.map(mapBracketRow);
  }

  validateData(data: CreateTournamentDto): ValidationResult {
    validate(data as unknown as Record<string, unknown>, [
      { field: 'name', label: 'Nombre', required: true, type: 'string', minLength: 3, maxLength: 100 },
      { field: 'sport', label: 'Deporte', required: true, type: 'string' },
      { field: 'club', label: 'Club', required: true, type: 'string' },
      { field: 'startDate', label: 'Fecha de inicio', required: true, type: 'string' },
      { field: 'endDate', label: 'Fecha de fin', required: true, type: 'string' },
      { field: 'status', label: 'Estado', required: true, type: 'string' },
      // Upper bound relaxed from 32 to 9999 (effectively unlimited for
      // any real volleyball tournament). The cap is kept high purely as
      // a typo safeguard — a literal "0 falla" is a 4-zero typo away
      // from looking like a tournament with 200000 equipos. Migration
      // 023 widens the matching DB CHECK constraint.
      { field: 'teamsCount', label: 'Cantidad de equipos', required: true, type: 'number', min: 2, max: 9999 },
      { field: 'format', label: 'Formato', required: true, type: 'string' },
    ]);

    validateDateRange(data.startDate, data.endDate);

    return { valid: true, errors: [] };
  }
}

export const tournamentService = new TournamentService();
