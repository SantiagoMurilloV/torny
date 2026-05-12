import { Request, Response, NextFunction } from 'express';
import { clubService } from '../services/club.service';
import { buildClubsExcel } from '../services/club.export';
import { UnauthorizedError, ValidationError } from '../middleware/errorHandler';

/**
 * `/api/clubs` controller — admin-scoped CRUD for the club login
 * accounts (mig 028) plus the bulk-detect / bulk-create flow used by
 * the "Detectar y crear clubs" button on the admin tab. Plus the
 * Excel export endpoint.
 *
 * Every endpoint here is admin-only (super_admin also passes through
 * since it has god-mode); the `requireRole('admin','super_admin')`
 * guard lives in the routes file. Owner scoping happens in the
 * service via `req.user.userId` so two admins never see each other's
 * clubs.
 */

function ownerIdFromReq(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('No autenticado');
  }
  return req.user.userId;
}

export async function detect(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const clusters = await clubService.detectClusters(ownerId);
    res.json(clusters);
  } catch (err) {
    next(err);
  }
}

export async function bulkCreate(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const body = req.body as {
      clusters?: Array<{ key: string; name: string }>;
    };
    const clusters = body.clusters ?? [];
    if (!Array.isArray(clusters) || clusters.length === 0) {
      throw new ValidationError('No hay clusters para crear');
    }
    // Re-derive the team list per key from the live state so the
    // request body can stay tiny + tamper-proof. The service's UPDATE
    // is also owner-scoped, so even a forged key/teamId combo won't
    // associate a team to the wrong admin's club.
    const detected = await clubService.detectClusters(ownerId);
    const teamsByKey = new Map<string, string[]>();
    for (const d of detected) teamsByKey.set(d.key, d.teamIds);
    const created = await clubService.bulkCreate(
      ownerId,
      clusters,
      teamsByKey,
    );
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const clubs = await clubService.listForOwner(ownerId);
    res.json(clubs);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const club = await clubService.getById(req.params.id, ownerId);
    res.json(club);
  } catch (err) {
    next(err);
  }
}

export async function rename(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const club = await clubService.rename(
      req.params.id,
      ownerId,
      (req.body?.name ?? '') as string,
    );
    res.json(club);
  } catch (err) {
    next(err);
  }
}

export async function regenerateCredentials(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerId = ownerIdFromReq(req);
    const club = await clubService.regenerateCredentials(req.params.id, ownerId);
    res.json(club);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    await clubService.deleteClub(req.params.id, ownerId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function exportExcel(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const buffer = await buildClubsExcel(ownerId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="clubs-y-equipos.xlsx"',
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * Returns the team ids that belong to the authenticated club_captain.
 * Used by the public-facing club panel after login to render the
 * team picker. The frontend then hits the existing per-team endpoints
 * (logo upload, players CRUD) for each team in the list — no new
 * team-side endpoints needed.
 */
export async function meTeams(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || req.user.role !== 'club_captain' || !req.user.clubId) {
      throw new UnauthorizedError('Solo accesible para usuarios de club');
    }
    const teamIds = await clubService.getTeamIdsForClub(req.user.clubId);
    res.json({ clubId: req.user.clubId, teamIds });
  } catch (err) {
    next(err);
  }
}
