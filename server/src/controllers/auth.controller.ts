import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { revokeToken } from '../services/tokenBlacklist';
import { ValidationError } from '../middleware/errorHandler';
import { loginRateLimiter } from '../middleware/rateLimit';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new ValidationError('Usuario y contraseña son requeridos');
    }

    const result = await authService.login({ username, password });
    // Success — reset this user's rate-limit bucket so five legitimate
    // logins in a session (e.g. admin testing judge accounts) don't lock
    // them out. Failed attempts still accumulate.
    loginRateLimiter.clear(req);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Return the authenticated user's profile, including scoping metadata
 * (tournament_quota, count of owned tournaments). Used by the admin
 * dashboard to display "X/Y torneos usados" and by the super-admin
 * console to sanity-check its own session.
 */
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    const { getPool } = await import('../config/database');
    const pool = getPool();

    // Team captains don't have a users row — their "account" is the team.
    // Return a captain-shaped profile so the /team-panel can render team
    // name, initials, and enrollment deadlines it needs to gate roster
    // edits in later phases.
    if (req.user.role === 'team_captain') {
      const teamResult = await pool.query(
        `SELECT id, name, initials, logo, primary_color, secondary_color,
                category, captain_username, credentials_generated_at
         FROM teams
         WHERE id = $1`,
        [req.user.userId],
      );
      if (teamResult.rows.length === 0) {
        res.status(404).json({ error: 'Equipo no encontrado' });
        return;
      }
      const t = teamResult.rows[0];
      res.json({
        id: t.id,
        username: t.captain_username,
        role: 'team_captain',
        teamId: t.id,
        team: {
          id: t.id,
          name: t.name,
          initials: t.initials,
          logo: t.logo ?? undefined,
          primaryColor: t.primary_color,
          secondaryColor: t.secondary_color,
          category: t.category ?? undefined,
          credentialsGeneratedAt:
            t.credentials_generated_at instanceof Date
              ? t.credentials_generated_at.toISOString()
              : t.credentials_generated_at ?? undefined,
        },
      });
      return;
    }

    // Club captain (mig 028) — no users row; resolve from clubs table.
    if (req.user.role === 'club_captain') {
      const clubResult = await pool.query(
        `SELECT id, name, username,
                (SELECT COUNT(*)::int FROM teams t WHERE t.club_id = clubs.id) AS teams_count
           FROM clubs WHERE id = $1`,
        [req.user.userId],
      );
      if (clubResult.rows.length === 0) {
        res.status(404).json({ error: 'Club no encontrado' });
        return;
      }
      const c = clubResult.rows[0];
      res.json({
        id: c.id,
        username: c.username,
        role: 'club_captain',
        clubId: c.id,
        club: {
          id: c.id,
          name: c.name,
          teamsCount: c.teams_count,
        },
      });
      return;
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.role, u.display_name, u.tournament_quota,
              u.created_by,
              COUNT(t.id)::int AS owned_tournaments_count
       FROM users u
       LEFT JOIN tournaments t ON t.owner_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.user.userId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name ?? undefined,
      tournamentQuota: row.tournament_quota,
      createdBy: row.created_by ?? null,
      ownedTournamentsCount: row.owned_tournaments_count,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  // Revoke the bearer token so it's rejected even if someone kept a
  // copy. JWT is stateless so this lives in an in-memory blacklist —
  // enough for our single Railway instance + 24h token lifetime.
  //
  // The authMiddleware already validated the token, so if we got here
  // `req.user` is set and the token is good. We pull the raw token from
  // the header and add its SHA-256 hash to the blacklist alongside the
  // token's own `exp` so the janitor can drop it when it would've
  // expired anyway.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && req.user?.exp) {
    revokeToken(authHeader.substring(7), req.user.exp);
  }
  res.json({ message: 'Sesión cerrada exitosamente' });
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new ValidationError('La contraseña actual es requerida');
    }
    if (!newPassword || typeof newPassword !== 'string') {
      throw new ValidationError('La nueva contraseña es requerida');
    }

    const userId = req.user!.userId;
    // auth.service validates strength + checks current password
    await authService.changePassword(userId, currentPassword, newPassword);
    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    next(error);
  }
}
