import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getPool } from '../config/database';
import { JwtPayload, LoginRequest, LoginResponse } from '../types';
import { UnauthorizedError } from '../middleware/errorHandler';
import { BCRYPT_ROUNDS, validatePasswordStrength } from './password';
import { encryptPassword } from './passwordRecovery';

// JWT_SECRET is required in production. A weak fallback is only allowed in dev/test.
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is missing or too short (<16 chars). Refusing to start in production.',
    );
  }

  // Dev/test fallback. NEVER commit this as a production default.
  console.warn(
    '[auth] JWT_SECRET env var is missing or weak — using a development fallback. ' +
      'Set a strong JWT_SECRET (>=16 chars) before deploying.',
  );
  return 'spkcup-dev-only-secret-do-not-use-in-prod';
}

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRATION = '24h';

/**
 * Dummy bcrypt hash used to equalize timing on login when the username
 * doesn't exist. Without this, a missing user returns ~1 ms while a
 * wrong password takes ~150 ms (bcrypt.compare), which leaks username
 * existence via response-time side channel. Running a fake compare
 * against a constant hash makes both paths take the same time.
 *
 * The plaintext "never-matches" is irrelevant — this is only used as
 * the haystack for bcrypt.compare with whatever the attacker sent.
 */
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  'spkcup-timing-equalizer-never-matches',
  10,
);

export class AuthService {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const pool = getPool();

    // Two-tier lookup. First the `users` table (admin / judge / super_admin);
    // if no hit there, try the `teams` table (team captain credentials,
    // stored directly on teams.captain_username / .captain_password_hash
    // since captains don't have their own users row). At most ONE bcrypt
    // compare runs per request — the hash we check is whichever match
    // we found, or a dummy hash if neither did, so timing stays constant
    // regardless of which table (if any) contained the username.
    const userResult = await pool.query(
      `SELECT id, username, password_hash, role, created_by,
              assigned_tournament_id, assigned_court
         FROM users WHERE username = $1`,
      [credentials.username],
    );
    const user = userResult.rows[0];

    let team: {
      id: string;
      username: string;
      password_hash: string;
    } | undefined;
    if (!user) {
      const teamResult = await pool.query(
        `SELECT id, captain_username AS username, captain_password_hash AS password_hash
         FROM teams
         WHERE captain_username = $1 AND captain_password_hash IS NOT NULL`,
        [credentials.username],
      );
      team = teamResult.rows[0];
    }

    // Third tier — clubs (mig 028). Same lazy lookup pattern: only
    // hit the table when the previous two tiers missed. Username is
    // case-insensitive thanks to the UNIQUE LOWER(username) index.
    let club:
      | {
          id: string;
          username: string;
          password_hash: string;
          owner_id: string;
          name: string;
        }
      | undefined;
    if (!user && !team) {
      const clubResult = await pool.query(
        `SELECT id, username, password_hash, owner_id, name
           FROM clubs
          WHERE LOWER(username) = LOWER($1)`,
        [credentials.username],
      );
      club = clubResult.rows[0];
    }

    const hashToCheck =
      user?.password_hash ??
      team?.password_hash ??
      club?.password_hash ??
      DUMMY_BCRYPT_HASH;
    const validPassword = await bcrypt.compare(credentials.password, hashToCheck);

    if (!validPassword || (!user && !team && !club)) {
      throw new UnauthorizedError('Credenciales incorrectas');
    }

    if (user) {
      // `createdBy`, `assignedCourt`, and `assignedTournamentId` go into
      // the token so judge-scoped queries (match feed) don't have to hit
      // the users table on every request. The token is issued at login time
      // so a court re-assignment takes effect on the judge's next login.
      const payload = {
        userId: user.id,
        role: user.role,
        createdBy: user.created_by ?? null,
        assignedTournamentId: user.assigned_tournament_id ?? null,
        assignedCourt: user.assigned_court ?? null,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          assignedTournamentId: user.assigned_tournament_id ?? null,
          assignedCourt: user.assigned_court ?? null,
        },
      };
    }

    // Captain login. The JWT's `userId` is set to the team id so downstream
    // middleware that reads req.user.userId still works; a dedicated
    // `teamId` field is also embedded for ownership checks on roster
    // endpoints (POST /teams/:teamId/players must match this).
    if (team) {
      const payload = {
        userId: team.id,
        role: 'team_captain' as const,
        teamId: team.id,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
      return {
        token,
        user: {
          id: team.id,
          username: team.username,
          role: 'team_captain',
          teamId: team.id,
        },
      };
    }

    // Club login (mig 028). Mirrors captain pattern but the userId is
    // the club id; downstream `requireTeamAccess` is extended to allow
    // a club_captain on every team whose `club_id = req.user.clubId`.
    // Embedding `createdBy` = ownerId keeps audit-style queries
    // ("which admin owns this account") consistent with the user
    // payload shape upstream.
    const payload = {
      userId: club!.id,
      role: 'club_captain' as const,
      clubId: club!.id,
      createdBy: club!.owner_id,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
    return {
      token,
      user: {
        id: club!.id,
        username: club!.username,
        role: 'club_captain',
        clubId: club!.id,
        clubName: club!.name,
      },
    };
  }

  /**
   * Change the password of the currently authenticated user. Requires the
   * caller to confirm their current password so a stolen JWT alone cannot
   * lock out the real owner.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    validatePasswordStrength(newPassword, 'nueva contraseña');

    const pool = getPool();
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    if (result.rows.length === 0) {
      throw new UnauthorizedError('Usuario no encontrado');
    }
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      throw new UnauthorizedError('Contraseña actual incorrecta');
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Keep the encrypted recovery ciphertext in sync so super_admin's
    // "reveal current password" stays accurate. Null when the feature
    // is off (no PLATFORM_RECOVERY_KEY).
    const recovery = encryptPassword(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_recovery = $2, updated_at = NOW() WHERE id = $3',
      [hash, recovery, userId],
    );
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Token inválido o expirado');
    }
  }
}

export const authService = new AuthService();
