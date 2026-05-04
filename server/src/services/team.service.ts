import bcrypt from 'bcrypt';
import { getPool } from '../config/database';
import {
  Team,
  CreateTeamDto,
  UpdateTeamDto,
  ValidationResult,
  Match,
  TeamCredentialsReceipt,
} from '../types';
import { NotFoundError, AppError } from '../middleware/errorHandler';
import { validate, validateHexColor } from '../middleware/validation';
import { BCRYPT_ROUNDS } from './password';
import { encryptPassword, decryptPassword } from './passwordRecovery';
import { generatePassword, generateCaptainUsername } from '../lib/passwordGen';

function normalizeIsoDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function mapRow(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    name: row.name as string,
    initials: row.initials as string,
    logo: row.logo as string | undefined,
    primaryColor: row.primary_color as string,
    secondaryColor: row.secondary_color as string,
    city: row.city as string | undefined,
    department: row.department as string | undefined,
    category: row.category as string | undefined,
    captainUsername: (row.captain_username as string | null) ?? undefined,
    credentialsGeneratedAt: normalizeIsoDate(row.credentials_generated_at),
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

// Columns that the public listing returns. We deliberately omit `logo`
// from the bulk SELECT because logos are stored as base64 data URLs
// (often 50–500 KB each) — including them in `/teams` ballooned the
// response to ~9 MB for a midsize tournament, which dominated the
// response time of the public client's initial fetch and also blew
// past the in-memory cache's serialization cost.
//
// Consumers that need the logo (admin team form, public team detail)
// fetch `GET /teams/:id` which still returns the full row. The match
// card / bracket / standings views in the React app render team
// chips with `initials + colors`, so dropping the logo here doesn't
// change the visible UI.
const TEAM_LIST_COLUMNS = `
  id, name, initials, primary_color, secondary_color, city, department,
  category, captain_username, credentials_generated_at, owner_id,
  created_at, updated_at
`;

export class TeamService {
  async getAll(): Promise<Team[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT ${TEAM_LIST_COLUMNS} FROM teams ORDER BY name`,
    );
    return result.rows.map(mapRow);
  }

  async getById(id: string): Promise<Team> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('Equipo');
    }
    return mapRow(result.rows[0]);
  }

  async create(data: CreateTeamDto): Promise<Team> {
    this.validateData(data);
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO teams (name, initials, logo, primary_color, secondary_color, city, department, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.name,
        data.initials,
        data.logo || null,
        data.primaryColor,
        data.secondaryColor,
        data.city || null,
        data.department || null,
        data.category || null,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async update(id: string, data: UpdateTeamDto): Promise<Team> {
    // Ensure team exists
    await this.getById(id);

    // Validate fields if provided
    if (data.initials !== undefined || data.primaryColor !== undefined || data.secondaryColor !== undefined) {
      const existing = await this.getById(id);
      const merged = { ...existing, ...data } as CreateTeamDto;
      this.validateData(merged);
    }

    const pool = getPool();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const columnMap: Record<string, string> = {
      name: 'name',
      initials: 'initials',
      logo: 'logo',
      primaryColor: 'primary_color',
      secondaryColor: 'secondary_color',
      city: 'city',
      department: 'department',
      category: 'category',
    };

    for (const [key, column] of Object.entries(columnMap)) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push((data as Record<string, unknown>)[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `UPDATE teams SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await pool.query(query, values);
    return mapRow(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    // Ensure team exists
    await this.getById(id);

    const pool = getPool();

    // Block deletion if the team has any active matches (live or upcoming).
    // Completed matches are retained via ON DELETE CASCADE cleanup in migration 005.
    const activeMatches = await pool.query(
      `SELECT COUNT(*) as count FROM matches
       WHERE (team1_id = $1 OR team2_id = $1)
       AND status IN ('live', 'upcoming')`,
      [id]
    );

    if (parseInt(activeMatches.rows[0].count, 10) > 0) {
      throw new AppError(
        400,
        'No se puede eliminar el equipo porque tiene partidos activos'
      );
    }

    // DB handles cascade cleanup:
    //   matches, standings, tournament_teams → CASCADE
    //   bracket_matches team*_id / winner_id → SET NULL
    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
  }

  /**
   * Generate (or regenerate) a captain's login credentials for the team.
   *
   * Returns the plaintext password exactly once — the caller shows it in
   * a show-once modal and then it's gone. The stored artifacts are:
   *   · captain_username           (plaintext, UNIQUE)
   *   · captain_password_hash      (bcrypt, 12 rounds)
   *   · captain_password_recovery  (AES-256-GCM ciphertext, null if
   *                                 PLATFORM_RECOVERY_KEY is unset)
   *   · credentials_generated_at   (NOW())
   *
   * Regeneration overwrites the previous set — any existing captain session
   * tied to the old password becomes unusable on next bcrypt compare. The
   * captain_username is also regenerated so an old leaked handle is also
   * retired; callers who want a stable username can switch to a "reset
   * password only" variant later.
   *
   * Collision handling: captain_username has UNIQUE constraint. We retry
   * up to 5 times before giving up — at 9000 suffixes per initials prefix
   * that's a >1-in-10^15 chance of hitting the cap.
   */
  async generateCaptainCredentials(teamId: string): Promise<TeamCredentialsReceipt> {
    const team = await this.getById(teamId);
    const pool = getPool();

    const password = generatePassword();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recovery = encryptPassword(password);
    const recoveryEnabled = recovery !== null;

    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const username = generateCaptainUsername(team.initials);
      try {
        const result = await pool.query(
          `UPDATE teams
           SET captain_username = $1,
               captain_password_hash = $2,
               captain_password_recovery = $3,
               credentials_generated_at = NOW(),
               updated_at = NOW()
           WHERE id = $4
           RETURNING credentials_generated_at`,
          [username, hash, recovery, teamId]
        );
        const generatedAt = normalizeIsoDate(result.rows[0].credentials_generated_at)
          ?? new Date().toISOString();
        return {
          teamId,
          username,
          password,
          generatedAt,
          recoveryEnabled,
        };
      } catch (err) {
        // 23505 = unique_violation. Anything else bubbles up.
        const code = (err as { code?: string })?.code;
        if (code !== '23505') throw err;
        // Collision on captain_username — retry with a fresh suffix.
      }
    }

    throw new AppError(
      500,
      'No se pudo generar un usuario único para el capitán. Probá de nuevo.'
    );
  }

  /**
   * Look up the captain credentials that already live on the teams row.
   *
   * The password is only recoverable when PLATFORM_RECOVERY_KEY is set
   * AND the stored AES-256-GCM blob decrypts cleanly. Otherwise the
   * caller sees `password: null` + `recoveryEnabled` tells them which
   * of "feature off" vs "nothing stored yet" is the case.
   *
   * Returns null when no credentials have been generated for this team,
   * so the controller can send a 404.
   */
  async getCaptainCredentials(teamId: string): Promise<TeamCredentialsReceipt | null> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, captain_username, captain_password_recovery, credentials_generated_at
       FROM teams
       WHERE id = $1`,
      [teamId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Equipo');
    }
    const row = result.rows[0];
    const username = row.captain_username as string | null;
    if (!username) return null;

    const stored = row.captain_password_recovery as string | null;
    const password = decryptPassword(stored);
    return {
      teamId: row.id as string,
      username,
      password,
      generatedAt: normalizeIsoDate(row.credentials_generated_at) ?? '',
      recoveryEnabled: stored !== null && password !== null,
    };
  }

  async getMatches(teamId: string): Promise<Match[]> {
    // Ensure team exists
    await this.getById(teamId);
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM matches
       WHERE team1_id = $1 OR team2_id = $1
       ORDER BY date, time`,
      [teamId]
    );
    const matches: Match[] = result.rows.map(mapMatchRow);
    if (matches.length === 0) return matches;

    // Attach per-set scores so the public team-detail page can compute
    // sets-for / sets-against and the rally-point totals. Without this
    // the "Sets a favor/contra" card on /team/:id always rendered 0/0
    // even after games were played, because mapMatchRow only reads the
    // aggregate score columns. One follow-up query for every match
    // touching this team.
    const matchIds = matches.map((m) => m.id);
    const setsRes = await pool.query(
      `SELECT id, match_id, set_number, team1_points, team2_points
       FROM set_scores
       WHERE match_id = ANY($1)
       ORDER BY set_number`,
      [matchIds],
    );
    const setsByMatch = new Map<string, Match['sets']>();
    for (const row of setsRes.rows as Array<Record<string, unknown>>) {
      const matchId = row.match_id as string;
      const list = setsByMatch.get(matchId) ?? [];
      list!.push({
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

  validateData(data: CreateTeamDto): ValidationResult {
    validate(data as unknown as Record<string, unknown>, [
      { field: 'name', label: 'Nombre', required: true, type: 'string' },
      {
        field: 'initials',
        label: 'Iniciales',
        required: true,
        type: 'string',
        minLength: 1,
        maxLength: 3,
        pattern: /^[A-Z]{1,3}$/,
        patternMessage: 'Las iniciales deben ser de 1 a 3 letras mayúsculas',
      },
      { field: 'primaryColor', label: 'Color primario', required: true, type: 'string' },
      { field: 'secondaryColor', label: 'Color secundario', required: true, type: 'string' },
    ]);

    validateHexColor(data.primaryColor, 'Color primario');
    validateHexColor(data.secondaryColor, 'Color secundario');

    return { valid: true, errors: [] };
  }
}

export const teamService = new TeamService();
