import bcrypt from 'bcrypt';
import { getPool } from '../config/database';
import {
  NotFoundError,
  ValidationError,
} from '../middleware/errorHandler';
import { BCRYPT_ROUNDS, validatePasswordStrength } from './password';
import { encryptPassword } from './passwordRecovery';

/**
 * App user. Today we have two roles:
 *  - 'admin'  → full control over tournaments, teams, matches, users.
 *  - 'judge'  → can score live matches (no tournament / team / user CRUD).
 */
export interface AppUser {
  id: string;
  username: string;
  role: string;
  displayName?: string;
  /** For judges: UUID of the tournament they're assigned to (mig 036). */
  assignedTournamentId?: string | null;
  /** For judges: court name they're assigned to (mig 036). */
  assignedCourt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateJudgeDto {
  username: string;
  password: string;
  displayName?: string;
}

export interface UpdateJudgeDto {
  /** Set to a tournament UUID to assign the judge to that tournament's court list, or null to clear. */
  assignedTournamentId?: string | null;
  /** Set to a court name to restrict the judge's feed to that court, or null to clear. */
  assignedCourt?: string | null;
}

function mapUserRow(row: Record<string, unknown>): AppUser {
  return {
    id: row.id as string,
    username: row.username as string,
    role: row.role as string,
    displayName: (row.display_name as string | null) ?? undefined,
    assignedTournamentId: (row.assigned_tournament_id as string | null) ?? null,
    assignedCourt: (row.assigned_court as string | null) ?? null,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

export class UserService {
  /**
   * Return judges. If `createdBy` is set we only return judges that were
   * created by that admin — that's how the admin dashboard lists "my
   * judges" instead of every judge on the platform.
   */
  async listJudges(createdBy?: string): Promise<AppUser[]> {
    const pool = getPool();
    if (createdBy) {
      const result = await pool.query(
        `SELECT id, username, role, display_name,
                assigned_tournament_id, assigned_court,
                created_at, updated_at
         FROM users
         WHERE role = 'judge' AND created_by = $1
         ORDER BY created_at DESC`,
        [createdBy],
      );
      return result.rows.map(mapUserRow);
    }
    const result = await pool.query(
      `SELECT id, username, role, display_name,
              assigned_tournament_id, assigned_court,
              created_at, updated_at
       FROM users
       WHERE role = 'judge'
       ORDER BY created_at DESC`,
    );
    return result.rows.map(mapUserRow);
  }

  /**
   * Create a new judge. `createdBy` is set by the controller from
   * `req.user.userId` when an admin creates the judge — that's what
   * scopes the judge's match feed to only the admin's tournaments.
   * super_admin can pass null (platform-wide judge).
   */
  async createJudge(data: CreateJudgeDto, createdBy: string | null = null): Promise<AppUser> {
    const username = (data.username || '').trim();
    const password = data.password || '';
    const displayName = data.displayName?.trim() || null;

    if (username.length < 3) {
      throw new ValidationError('El nombre de usuario debe tener al menos 3 caracteres');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new ValidationError(
        'El nombre de usuario solo puede contener letras, números, puntos, guiones o guiones bajos',
      );
    }
    validatePasswordStrength(password);

    const pool = getPool();

    // Uniqueness check up front so we can give a friendly message instead
    // of relying on a Postgres unique-violation error.
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [username],
    );
    if (existing.rows.length > 0) {
      throw new ValidationError('Ya existe un usuario con ese nombre');
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recovery = encryptPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, display_name, created_by, password_recovery)
       VALUES ($1, $2, 'judge', $3, $4, $5)
       RETURNING id, username, role, display_name, created_at, updated_at`,
      [username, hash, displayName, createdBy, recovery],
    );
    return mapUserRow(result.rows[0]);
  }

  /**
   * Update a judge's court assignment. Passing null for both fields clears
   * the assignment — the judge reverts to the legacy feed (all live matches
   * from the admin's tournaments). The new assignment takes effect on the
   * judge's next login (it's baked into the JWT at login time).
   */
  async updateJudge(id: string, dto: UpdateJudgeDto): Promise<AppUser> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE users
          SET assigned_tournament_id = $1,
              assigned_court         = $2,
              updated_at             = NOW()
        WHERE id = $3 AND role = 'judge'
        RETURNING id, username, role, display_name,
                  assigned_tournament_id, assigned_court,
                  created_at, updated_at`,
      [dto.assignedTournamentId ?? null, dto.assignedCourt ?? null, id],
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Juez');
    }
    return mapUserRow(result.rows[0]);
  }

  /** Delete a judge by id. Refuses to delete non-judge accounts. */
  async deleteJudge(id: string): Promise<void> {
    const pool = getPool();
    const result = await pool.query('SELECT id, role FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('Usuario');
    }
    const user = result.rows[0];
    if (user.role !== 'judge') {
      throw new ValidationError('Solo se pueden eliminar usuarios juez');
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  /** Reset a judge's password. Admin-only recovery flow. */
  async resetJudgePassword(id: string, newPassword: string): Promise<void> {
    validatePasswordStrength(newPassword);
    const pool = getPool();
    const result = await pool.query('SELECT id, role FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('Usuario');
    }
    if (result.rows[0].role !== 'judge') {
      throw new ValidationError('Solo se puede resetear la contraseña de usuarios juez');
    }
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const recovery = encryptPassword(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_recovery = $2, updated_at = NOW() WHERE id = $3',
      [hash, recovery, id],
    );
  }
}

export const userService = new UserService();
