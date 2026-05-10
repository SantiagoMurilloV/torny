/**
 * Multi-tenant access control middleware.
 *
 * Complements `requireRole` / `requireTeamAccess` in auth.ts by enforcing
 * row-level ownership on tournaments + teams so Admin A cannot mutate
 * resources owned by Admin B. Public GETs stay unscoped (any spectator
 * can read any tournament/team) — these guards only run on the
 * admin/judge mutation surface.
 *
 * Rules:
 *   · super_admin → bypasses every check (operates above tenants).
 *   · admin       → must match the resource's owner_id.
 *   · judge       → never owns anything; allowed only if the caller's
 *                   `createdBy` admin owns the resource (so a judge
 *                   created by Admin A can score Admin A's matches).
 *   · team_captain → never reaches these guards; their own routes use
 *                    requireTeamAccess.
 */

import { NextFunction, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { isRevoked } from '../services/tokenBlacklist';
import { getPool } from '../config/database';
import { JwtPayload } from '../types';

function ensureAuthed(req: Request, res: Response): JwtPayload | null {
  if (req.user) return req.user;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticación requerido' });
    return null;
  }
  const token = authHeader.substring(7);
  if (isRevoked(token)) {
    res.status(401).json({ error: 'Sesión cerrada. Iniciá sesión de nuevo.' });
    return null;
  }
  try {
    const payload = authService.verifyToken(token);
    req.user = payload;
    return payload;
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return null;
  }
}

/**
 * Returns the admin id whose ownership the caller can act on:
 *   · admin       → their own id
 *   · judge       → the admin that created them (createdBy)
 *   · super_admin → wildcard (returned as undefined → bypass)
 *   · others      → null (deny)
 */
function effectiveAdminId(user: JwtPayload): string | null | undefined {
  if (user.role === 'super_admin') return undefined; // bypass
  if (user.role === 'admin') return user.userId;
  if (user.role === 'judge') return user.createdBy ?? null;
  return null;
}

/**
 * Require the caller to own the tournament referenced in the route.
 * Looks up `req.params.tournamentId` first (used by nested routes like
 * /tournaments/:tournamentId/...) then falls back to `req.params.id`
 * (used by /tournaments/:id directly).
 *
 * Sends 404 instead of 403 to avoid leaking the existence of resources
 * owned by other tenants.
 */
export async function requireTournamentAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = ensureAuthed(req, res);
  if (!user) return;

  const adminId = effectiveAdminId(user);
  if (adminId === null) {
    res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
    return;
  }

  const tournamentId =
    (req.params.tournamentId as string | undefined) ??
    (req.params.id as string | undefined);
  if (!tournamentId) {
    res.status(400).json({ error: 'Falta el ID del torneo' });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM tournaments WHERE id = $1',
      [tournamentId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Torneo no encontrado' });
      return;
    }
    // super_admin bypass
    if (adminId === undefined) {
      next();
      return;
    }
    const ownerId = result.rows[0].owner_id;
    if (ownerId !== adminId) {
      res.status(404).json({ error: 'Torneo no encontrado' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require the caller to own the team referenced in the route.
 * Looks up `req.params.teamId` first then falls back to `req.params.id`.
 *
 * team_captain is allowed when the route's teamId matches their JWT's
 * `teamId` (parity with requireTeamAccess for routes that mix admin and
 * captain paths). For pure admin routes use this guard standalone.
 */
export async function requireTeamOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = ensureAuthed(req, res);
  if (!user) return;

  const teamId =
    (req.params.teamId as string | undefined) ??
    (req.params.id as string | undefined);
  if (!teamId) {
    res.status(400).json({ error: 'Falta el ID del equipo' });
    return;
  }

  // Captain bypass for their own team — required for /teams/:teamId/players/*
  // and /teams/:teamId/logo when the captain is the caller.
  if (user.role === 'team_captain') {
    if (user.teamId === teamId) {
      next();
      return;
    }
    res.status(403).json({ error: 'Solo podés gestionar tu propio equipo' });
    return;
  }

  const adminId = effectiveAdminId(user);
  if (adminId === null) {
    res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM teams WHERE id = $1',
      [teamId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Equipo no encontrado' });
      return;
    }
    if (adminId === undefined) {
      next();
      return;
    }
    const ownerId = result.rows[0].owner_id;
    // Legacy teams with NULL owner_id are visible only to super_admin.
    if (ownerId == null || ownerId !== adminId) {
      res.status(404).json({ error: 'Equipo no encontrado' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require the caller to own the tournament referenced by `req.body[field]`.
 * Used on routes that create resources scoped to a tournament where the
 * tournament id arrives in the JSON body (e.g. POST /matches with
 * `{ tournamentId: ..., team1Id: ..., ... }`).
 *
 * Returns a middleware factory so the body field can be customised.
 */
export function requireTournamentAccessFromBody(field = 'tournamentId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = ensureAuthed(req, res);
    if (!user) return;

    const adminId = effectiveAdminId(user);
    if (adminId === null) {
      res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
      return;
    }

    const tournamentId = (req.body as Record<string, unknown> | undefined)?.[field];
    if (typeof tournamentId !== 'string' || !tournamentId) {
      res.status(400).json({ error: `Falta el campo "${field}"` });
      return;
    }

    try {
      const pool = getPool();
      const result = await pool.query<{ owner_id: string | null }>(
        'SELECT owner_id FROM tournaments WHERE id = $1',
        [tournamentId],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Torneo no encontrado' });
        return;
      }
      if (adminId === undefined) {
        next();
        return;
      }
      const ownerId = result.rows[0].owner_id;
      if (ownerId !== adminId) {
        res.status(404).json({ error: 'Torneo no encontrado' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the caller to own the tournament that contains the match
 * referenced by `req.params.id` (or `req.params.matchId`). Used on
 * /matches/:id, /matches/:id/score, etc.
 */
export async function requireMatchAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = ensureAuthed(req, res);
  if (!user) return;

  const adminId = effectiveAdminId(user);
  if (adminId === null) {
    res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
    return;
  }

  const matchId =
    (req.params.matchId as string | undefined) ??
    (req.params.id as string | undefined);
  if (!matchId) {
    res.status(400).json({ error: 'Falta el ID del partido' });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<{ owner_id: string | null }>(
      `SELECT t.owner_id
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.id = $1`,
      [matchId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Partido no encontrado' });
      return;
    }
    if (adminId === undefined) {
      next();
      return;
    }
    const ownerId = result.rows[0].owner_id;
    if (ownerId !== adminId) {
      res.status(404).json({ error: 'Partido no encontrado' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
