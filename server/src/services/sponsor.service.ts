import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

/**
 * Tournament sponsor — base64 data URL backed so the FS isn't a
 * dependency at runtime (Railway's filesystem is ephemeral). Display
 * order drives the public render sequence; admins drag-reorder from
 * the "Patrocinadores" tab.
 */
export interface Sponsor {
  id: string;
  tournamentId: string;
  name: string | null;
  logo: string;
  link: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SponsorInput {
  name?: string | null;
  logo: string;
  link?: string | null;
  displayOrder?: number;
}

function mapRow(row: Record<string, unknown>): Sponsor {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    name: (row.name as string | null) ?? null,
    logo: row.logo as string,
    link: (row.link as string | null) ?? null,
    displayOrder: row.display_order as number,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : (row.updated_at as string),
  };
}

const MAX_LOGO_BYTES = 2_000_000; // ~2 MB on the wire — enough for a 1024px PNG

function assertLogo(logo: string): void {
  if (!logo || typeof logo !== 'string') {
    throw new ValidationError('logo es obligatorio');
  }
  if (!logo.startsWith('data:image/') && !logo.startsWith('http')) {
    throw new ValidationError(
      'logo debe ser un data URL de imagen o una URL http(s)',
    );
  }
  if (logo.length > MAX_LOGO_BYTES) {
    throw new ValidationError(
      'logo demasiado grande — comprimilo a 2 MB o menos antes de subir',
    );
  }
}

export class SponsorService {
  async listByTournament(tournamentId: string): Promise<Sponsor[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM tournament_sponsors
        WHERE tournament_id = $1
        ORDER BY display_order ASC, created_at ASC`,
      [tournamentId],
    );
    return res.rows.map(mapRow);
  }

  async create(
    tournamentId: string,
    data: SponsorInput,
  ): Promise<Sponsor> {
    assertLogo(data.logo);
    const pool = getPool();
    // Default display_order = current max + 1 so the new sponsor
    // lands at the end of the list visually without clobbering an
    // existing slot. Concurrent inserts may collide on the same
    // value — that's fine, the UI sorts by (order, created_at) so
    // collisions resolve deterministically by insertion time.
    const ord =
      data.displayOrder !== undefined
        ? Math.max(0, Math.floor(data.displayOrder))
        : await this.nextOrder(tournamentId);
    const res = await pool.query(
      `INSERT INTO tournament_sponsors
         (tournament_id, name, logo, link, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        tournamentId,
        data.name?.trim() || null,
        data.logo,
        data.link?.trim() || null,
        ord,
      ],
    );
    return mapRow(res.rows[0]);
  }

  async update(
    tournamentId: string,
    sponsorId: string,
    data: Partial<SponsorInput>,
  ): Promise<Sponsor> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name?.trim() || null);
    }
    if (data.logo !== undefined) {
      assertLogo(data.logo);
      fields.push(`logo = $${idx++}`);
      values.push(data.logo);
    }
    if (data.link !== undefined) {
      fields.push(`link = $${idx++}`);
      values.push(data.link?.trim() || null);
    }
    if (data.displayOrder !== undefined) {
      fields.push(`display_order = $${idx++}`);
      values.push(Math.max(0, Math.floor(data.displayOrder)));
    }
    if (fields.length === 0) {
      // Nothing to update — return the row as-is.
      const found = await this.findById(tournamentId, sponsorId);
      return found;
    }
    fields.push(`updated_at = NOW()`);
    values.push(sponsorId, tournamentId);
    const res = await getPool().query(
      `UPDATE tournament_sponsors
          SET ${fields.join(', ')}
        WHERE id = $${idx++} AND tournament_id = $${idx}
        RETURNING *`,
      values,
    );
    if (res.rows.length === 0) {
      throw new NotFoundError('Patrocinador');
    }
    return mapRow(res.rows[0]);
  }

  async remove(tournamentId: string, sponsorId: string): Promise<void> {
    const res = await getPool().query(
      `DELETE FROM tournament_sponsors
        WHERE id = $1 AND tournament_id = $2`,
      [sponsorId, tournamentId],
    );
    if (res.rowCount === 0) {
      throw new NotFoundError('Patrocinador');
    }
  }

  /**
   * Re-stamp the display_order of every sponsor of a tournament in
   * one shot. Body is an array of sponsor ids in the order the
   * admin wants them rendered. Sponsors not present in the array
   * keep their previous order (defensive: a partial reorder doesn't
   * accidentally drop the rest to position 0).
   */
  async reorder(
    tournamentId: string,
    orderedIds: string[],
  ): Promise<Sponsor[]> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return this.listByTournament(tournamentId);
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < orderedIds.length; i++) {
        await client.query(
          `UPDATE tournament_sponsors
              SET display_order = $1, updated_at = NOW()
            WHERE id = $2 AND tournament_id = $3`,
          [i, orderedIds[i], tournamentId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listByTournament(tournamentId);
  }

  private async findById(
    tournamentId: string,
    sponsorId: string,
  ): Promise<Sponsor> {
    const res = await getPool().query(
      `SELECT * FROM tournament_sponsors
        WHERE id = $1 AND tournament_id = $2`,
      [sponsorId, tournamentId],
    );
    if (res.rows.length === 0) throw new NotFoundError('Patrocinador');
    return mapRow(res.rows[0]);
  }

  private async nextOrder(tournamentId: string): Promise<number> {
    const res = await getPool().query<{ max: number | null }>(
      `SELECT MAX(display_order) AS max
         FROM tournament_sponsors
        WHERE tournament_id = $1`,
      [tournamentId],
    );
    const max = res.rows[0]?.max;
    return (max ?? -1) + 1;
  }
}

export const sponsorService = new SponsorService();
