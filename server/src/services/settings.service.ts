import { getPool } from '../config/database';
import { SystemSettings } from '../types';
import { NotFoundError } from '../middleware/errorHandler';

export class SettingsService {
  async get(): Promise<SystemSettings> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, system_name AS "systemName", club_name AS "clubName",
              location, language, contact_email AS "contactEmail",
              website, updated_at AS "updatedAt"
       FROM system_settings
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      // Create default settings row if none exists
      const insert = await pool.query(
        `INSERT INTO system_settings (system_name, language)
         VALUES ('Torny', 'es')
         RETURNING id, system_name AS "systemName", club_name AS "clubName",
                   location, language, contact_email AS "contactEmail",
                   website, updated_at AS "updatedAt"`
      );
      return insert.rows[0];
    }

    return result.rows[0];
  }

  async update(data: Partial<Omit<SystemSettings, 'id' | 'updatedAt'>>): Promise<SystemSettings> {
    const pool = getPool();

    // Ensure a settings row exists
    const existing = await this.get();

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.systemName !== undefined) {
      fields.push(`system_name = $${paramIndex++}`);
      values.push(data.systemName);
    }
    if (data.clubName !== undefined) {
      fields.push(`club_name = $${paramIndex++}`);
      values.push(data.clubName);
    }
    if (data.location !== undefined) {
      fields.push(`location = $${paramIndex++}`);
      values.push(data.location);
    }
    if (data.language !== undefined) {
      fields.push(`language = $${paramIndex++}`);
      values.push(data.language);
    }
    if (data.contactEmail !== undefined) {
      fields.push(`contact_email = $${paramIndex++}`);
      values.push(data.contactEmail);
    }
    if (data.website !== undefined) {
      fields.push(`website = $${paramIndex++}`);
      values.push(data.website);
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push(`updated_at = NOW()`);
    values.push(existing.id);

    const result = await pool.query(
      `UPDATE system_settings
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, system_name AS "systemName", club_name AS "clubName",
                 location, language, contact_email AS "contactEmail",
                 website, updated_at AS "updatedAt"`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Configuración del sistema');
    }

    return result.rows[0];
  }
}

export const settingsService = new SettingsService();
