import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  /** ISO 'YYYY-MM-DD'. Replaces the legacy birthYear column (mig 029). */
  birthDate?: string;
  documentType?: string;   // TI, CC, CE, RC, PA
  documentNumber?: string;
  category?: string;
  position?: string;
  photo?: string;          // data URL
  documentFile?: string;   // data URL (PDF)
  shirtNumber?: number;
  /** Single emergency contact captured in the public parent form. */
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  /** Audit flag — TRUE when the row landed via the public /inscripcion form. */
  registeredViaPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePlayerDto {
  teamId: string;
  firstName: string;
  lastName: string;
  birthDate?: string;       // ISO 'YYYY-MM-DD'
  documentType?: string;
  documentNumber?: string;
  category?: string;
  position?: string;
  photo?: string;
  documentFile?: string;
  shirtNumber?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  /** Internal flag — only the public registration controller sets this. */
  registeredViaPublic?: boolean;
}

export type UpdatePlayerDto = Partial<Omit<CreatePlayerDto, 'teamId' | 'registeredViaPublic'>>;

/**
 * Postgres DATE columns come back as a Date instance (driver-default) or
 * a 'YYYY-MM-DD' string depending on the version. Normalise to a plain
 * ISO date so the frontend can bind it into <input type="date"> without
 * a Date roundtrip that risks timezone shifts (see the equivalent
 * normalizeDate in tournament.service).
 */
function normalizeDate(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return undefined;
}

function mapRow(row: Record<string, unknown>): Player {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    birthDate: normalizeDate(row.birth_date),
    documentType: (row.document_type as string | null) ?? undefined,
    documentNumber: (row.document_number as string | null) ?? undefined,
    category: (row.category as string | null) ?? undefined,
    position: (row.position as string | null) ?? undefined,
    photo: (row.photo as string | null) ?? undefined,
    documentFile: (row.document_file as string | null) ?? undefined,
    shirtNumber: (row.shirt_number as number | null) ?? undefined,
    emergencyContactName: (row.emergency_contact_name as string | null) ?? undefined,
    emergencyContactPhone: (row.emergency_contact_phone as string | null) ?? undefined,
    emergencyContactRelationship:
      (row.emergency_contact_relationship as string | null) ?? undefined,
    registeredViaPublic: (row.registered_via_public as boolean | null) ?? false,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

function validateCommon(data: CreatePlayerDto | UpdatePlayerDto): void {
  if ('firstName' in data && !data.firstName?.trim()) {
    throw new ValidationError('El nombre es obligatorio');
  }
  if ('lastName' in data && !data.lastName?.trim()) {
    throw new ValidationError('El apellido es obligatorio');
  }
  if (data.birthDate !== undefined && data.birthDate !== null && data.birthDate !== '') {
    // 'YYYY-MM-DD' lexicographic check is enough: pg's DATE column does
    // the real parsing on insert. We just want to reject obvious junk
    // ("2026-13-40") and dates outside 1900..today so the form can't
    // accept "2099-05-09" as a jugadora's birthday.
    const iso = String(data.birthDate);
    const isShape = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    if (!isShape) {
      throw new ValidationError('Fecha de nacimiento inválida');
    }
    if (iso < '1900-01-01' || iso > TODAY_ISO()) {
      throw new ValidationError('Fecha de nacimiento fuera de rango');
    }
  }
  if (data.documentType && !['TI', 'CC', 'CE', 'RC', 'PA'].includes(data.documentType)) {
    throw new ValidationError('Tipo de documento inválido');
  }
  if (data.shirtNumber !== undefined && data.shirtNumber !== null) {
    const n = Number(data.shirtNumber);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      throw new ValidationError('Número de camiseta inválido (0–99)');
    }
  }
  // Soft cap on emergency contact phone — Colombia mobile is 10 digits;
  // we accept any non-empty string up to the column width (40) so the
  // parent can type "+57 316 627 5710" with spaces if they want.
  if (data.emergencyContactPhone && data.emergencyContactPhone.length > 40) {
    throw new ValidationError('Teléfono de contacto demasiado largo');
  }
}

export class PlayerService {
  /**
   * List the team's roster, optionally filtered by a free-text search.
   * The search is partial (ILIKE) and matches against first/last name,
   * shirt number (cast to text), document number and position. Used by
   * the team panel + admin roster card to filter big rosters quickly.
   * Empty/whitespace search returns the full roster.
   */
  async listByTeam(teamId: string, search?: string): Promise<Player[]> {
    const pool = getPool();
    const check = await pool.query('SELECT id FROM teams WHERE id = $1', [teamId]);
    if (check.rows.length === 0) throw new NotFoundError('Equipo');

    const term = (search ?? '').trim();
    if (term.length === 0) {
      const result = await pool.query(
        `SELECT * FROM players
         WHERE team_id = $1
         ORDER BY last_name ASC, first_name ASC`,
        [teamId],
      );
      return result.rows.map(mapRow);
    }
    const like = `%${term}%`;
    const result = await pool.query(
      `SELECT * FROM players
       WHERE team_id = $1
         AND (
           first_name ILIKE $2
           OR last_name ILIKE $2
           OR (first_name || ' ' || last_name) ILIKE $2
           OR position ILIKE $2
           OR document_number ILIKE $2
           OR CAST(shirt_number AS TEXT) = $3
         )
       ORDER BY last_name ASC, first_name ASC`,
      [teamId, like, term],
    );
    return result.rows.map(mapRow);
  }

  async getById(id: string): Promise<Player> {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Jugador@');
    return mapRow(result.rows[0]);
  }

  async create(data: CreatePlayerDto): Promise<Player> {
    validateCommon(data);
    const pool = getPool();
    const check = await pool.query('SELECT id FROM teams WHERE id = $1', [data.teamId]);
    if (check.rows.length === 0) throw new NotFoundError('Equipo');
    const result = await pool.query(
      `INSERT INTO players
        (team_id, first_name, last_name, birth_date, document_type, document_number,
         category, position, photo, document_file, shirt_number,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
         registered_via_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        data.teamId,
        data.firstName.trim(),
        data.lastName.trim(),
        data.birthDate || null,
        data.documentType ?? null,
        data.documentNumber?.trim() ?? null,
        data.category?.trim() ?? null,
        data.position?.trim() ?? null,
        data.photo ?? null,
        data.documentFile ?? null,
        data.shirtNumber ?? null,
        data.emergencyContactName?.trim() || null,
        data.emergencyContactPhone?.trim() || null,
        data.emergencyContactRelationship?.trim() || null,
        Boolean(data.registeredViaPublic),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async update(id: string, data: UpdatePlayerDto): Promise<Player> {
    validateCommon(data);
    const pool = getPool();
    const existing = await this.getById(id);
    const columnMap: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      birthDate: 'birth_date',
      documentType: 'document_type',
      documentNumber: 'document_number',
      category: 'category',
      position: 'position',
      photo: 'photo',
      documentFile: 'document_file',
      shirtNumber: 'shirt_number',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
      emergencyContactRelationship: 'emergency_contact_relationship',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, column] of Object.entries(columnMap)) {
      if ((data as Record<string, unknown>)[key] !== undefined) {
        const raw = (data as Record<string, unknown>)[key];
        fields.push(`${column} = $${idx}`);
        values.push(
          raw === null || raw === ''
            ? null
            : typeof raw === 'string'
              ? raw.trim()
              : raw,
        );
        idx++;
      }
    }
    if (fields.length === 0) return existing;
    fields.push('updated_at = NOW()');
    values.push(id);
    const result = await pool.query(
      `UPDATE players SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return mapRow(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM players WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Jugador@');
  }

  /**
   * Move a player to a different team within the SAME club. Used by the
   * club admin panel to fix "the parent picked the wrong team" without
   * forcing a delete + re-create round-trip (which would lose the photo
   * + PDF + emergency contact + the audit `registered_via_public` flag).
   *
   * Cross-club transfers are intentionally not supported here — they'd
   * leak players across tenants and the access middleware refuses to
   * authorize them anyway. The same-club invariant is enforced by
   * looking up `club_id` on both teams and 404'ing on mismatch so the
   * existence of the target team isn't disclosed.
   */
  async transferToTeam(playerId: string, targetTeamId: string): Promise<Player> {
    const pool = getPool();
    const player = await this.getById(playerId);
    if (player.teamId === targetTeamId) {
      // No-op — caller probably double-clicked. Return the existing
      // record so the FE can refresh its state without a special-case.
      return player;
    }
    const teamsRes = await pool.query<{ id: string; club_id: string | null }>(
      'SELECT id, club_id FROM teams WHERE id = ANY($1)',
      [[player.teamId, targetTeamId]],
    );
    const sourceTeam = teamsRes.rows.find((r) => r.id === player.teamId);
    const targetTeam = teamsRes.rows.find((r) => r.id === targetTeamId);
    if (!sourceTeam || !targetTeam) {
      throw new NotFoundError('Equipo');
    }
    if (
      sourceTeam.club_id == null ||
      targetTeam.club_id == null ||
      sourceTeam.club_id !== targetTeam.club_id
    ) {
      // Either team is orphaned (legacy null club_id) or they belong to
      // different clubs. Treat both as "not found" so we don't leak the
      // existence of teams in other clubs.
      throw new NotFoundError('Equipo');
    }
    const result = await pool.query(
      `UPDATE players SET team_id = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
      [targetTeamId, playerId],
    );
    return mapRow(result.rows[0]);
  }
}

export const playerService = new PlayerService();
