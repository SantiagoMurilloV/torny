import { Request, Response, NextFunction } from 'express';
import { clubService } from '../services/club.service';
import { buildClubsExcel } from '../services/club.export';
import { tournamentService } from '../services/tournament.service';
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
    const club = await clubService.getById(req.params.id as string, ownerId);
    res.json(club);
  } catch (err) {
    next(err);
  }
}

export async function rename(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    const club = await clubService.rename(
      req.params.id as string,
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
    const club = await clubService.regenerateCredentials(
      req.params.id as string,
      ownerId,
    );
    res.json(club);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const ownerId = ownerIdFromReq(req);
    await clubService.deleteClub(req.params.id as string, ownerId);
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
 * Admin-scoped: list of teams currently linked to the club. Drives
 * the "Dividir club" modal so the admin can pick which teams should
 * move to a new club. Owner-scoped via service.
 */
export async function listTeamsByClub(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerId = ownerIdFromReq(req);
    const teams = await clubService.getTeamsForClub(
      req.params.id as string,
      ownerId,
    );
    res.json(teams);
  } catch (err) {
    next(err);
  }
}

/**
 * Split a club: create a NEW club with auto-generated credentials and
 * re-point the selected teams' `club_id` at it. The original club
 * keeps the unselected teams; its credentials don't rotate.
 *
 * Used to fix "auto-detect grouped two real clubs together" — admin
 * picks the teams that belong to a different club and types the new
 * club's name. Returns the NEW club row (with plaintext password) so
 * the show-once modal can display the credential immediately.
 */
export async function split(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ownerId = ownerIdFromReq(req);
    const body = req.body as { name?: string; teamIds?: string[] };
    const name = (body.name ?? '').trim();
    const teamIds = Array.isArray(body.teamIds) ? body.teamIds : [];
    if (!name) {
      throw new ValidationError('El nombre del nuevo club es obligatorio');
    }
    if (teamIds.length === 0) {
      throw new ValidationError('Seleccioná al menos un equipo para mover');
    }
    const newClub = await clubService.splitClub(
      req.params.id as string,
      ownerId,
      name,
      teamIds,
    );
    res.status(201).json(newClub);
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
    // Rich team summary list (one query) instead of just ids — the
    // club panel needs the roster count + match stats per team and
    // we don't want an N+1 fetch fan-out. `teamIds` stays in the
    // response so any legacy caller (a deployed but cached FE bundle)
    // keeps working while users transition.
    //
    // `stats` rolls up the team list into club-wide cifras for the
    // dashboard header (total teams, total jugadoras, total partidos
    // pendientes / jugados, wins). Computed in JS over the same row
    // set we just queried so there's no extra DB hit.
    const teams = await clubService.listTeamsForClub(req.user.clubId);
    const stats = {
      teams: teams.length,
      players: teams.reduce((acc, t) => acc + t.rosterCount, 0),
      matchesPlayed: teams.reduce((acc, t) => acc + t.matchesPlayed, 0),
      matchesUpcoming: teams.reduce((acc, t) => acc + t.matchesUpcoming, 0),
      matchesLive: teams.reduce((acc, t) => acc + t.matchesLive, 0),
      wins: teams.reduce((acc, t) => acc + t.wins, 0),
      losses: teams.reduce((acc, t) => acc + t.losses, 0),
    };
    res.json({
      clubId: req.user.clubId,
      teamIds: teams.map((t) => t.id),
      teams,
      stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Tournaments where AT LEAST ONE of the captain's teams is enrolled.
 * Drives the "Generar link para acudientes" cards on the club panel —
 * the captain needs the `slug` of each torneo abierto (mig 029) to
 * build and share the inscription URL with parents.
 *
 * Returns the same Tournament shape the regular list endpoint emits
 * so the frontend transformer reuses without changes.
 */
export async function meTournaments(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || req.user.role !== 'club_captain' || !req.user.clubId) {
      throw new UnauthorizedError('Solo accesible para usuarios de club');
    }
    const tournaments = await tournamentService.getByClubId(req.user.clubId);
    res.json(tournaments);
  } catch (err) {
    next(err);
  }
}
