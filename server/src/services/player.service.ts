import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  birthYear?: number;
  documentType?: string;   // TI, CC, CE
  documentNumber?: string;
  category?: string;
  position?: string;
  photo?: string;          // data URL
  documentFile?: string;   // data URL (PDF)
  shirtNumber?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePlayerDto {
  teamId: string;
  firstName: string;
  lastName: string;
  birthYear?: number;
  documentType?: string;
  documentNumber?: string;
  category?: string;
  position?: string;
  photo?: string;
  documentFile?: string;
  shirtNumber?: number;
}

export type UpdatePlayerDto = Partial<Omit<CreatePlayerDto, 'teamId'>>;

function mapRow(row: Record<string, unknown>): Player {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    birthYear: (row.birth_year as number | null) ?? undefined,
    documentType: (row.document_type as string | null) ?? undefined,
    documentNumber: (row.document_number as string | null) ?? undefined,
    category: (row.category as string | null) ?? undefined,
    position: (row.position as string | null) ?? undefined,
    photo: (row.photo as string | null) ?? undefined,
    documentFile: (row.document_file as string | null) ?? undefined,
    shirtNumber: (row.shirt_number as number | null) ?? undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

function validateCommon(data: CreatePlayerDto | UpdatePlayerDto): void {
  if ('firstName' in data && !data.firstName?.trim()) {
    throw new ValidationError('El nombre es obligatorio');
  }
  if ('lastName' in data && !data.lastName?.trim()) {
    throw new ValidationError('El apellido es obligatorio');
  }
  if (data.birthYear !== undefined && data.birthYear !== null) {
    const y = Number(data.birthYear);
    if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) {
      throw new ValidationError('Año de nacimiento inválido');
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
        (team_id, first_name, last_name, birth_year, document_type, document_number,
         category, position, photo, document_file, shirt_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.teamId,
        data.firstName.trim(),
        data.lastName.trim(),
        data.birthYear ?? null,
        data.documentType ?? null,
        data.documentNumber?.trim() ?? null,
        data.category?.trim() ?? null,
        data.position?.trim() ?? null,
        data.photo ?? null,
        data.documentFile ?? null,
        data.shirtNumber ?? null,
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
      birthYear: 'birth_year',
      documentType: 'document_type',
      documentNumber: 'document_number',
      category: 'category',
      position: 'position',
      photo: 'photo',
      documentFile: 'document_file',
      shirtNumber: 'shirt_number',
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
}

export const playerService = new PlayerService();
