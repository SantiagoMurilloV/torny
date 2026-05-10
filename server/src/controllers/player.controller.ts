import { Request, Response, NextFunction } from 'express';
import { playerService } from '../services/player.service';
import { validateUUID } from '../middleware/validation';

/**
 * Players controller. Routes are nested under a team — see
 * `/api/teams/:teamId/players` in `team.routes.ts`. The team ID comes from
 * `req.params.teamId` for list/create; individual record ops use
 * `req.params.playerId`.
 */

export async function listByTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const teamId = req.params.teamId as string;
    validateUUID(teamId, 'ID de equipo');
    // Optional ?search=... filters the roster server-side. Front-end can
    // also do client-side filtering on the full list — both are useful:
    // the server filter keeps response sizes small for huge rosters,
    // the client filter avoids a network round-trip per keystroke.
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const players = await playerService.listByTeam(teamId, search);
    res.json(players);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.playerId as string;
    validateUUID(id, 'ID de jugador@');
    const player = await playerService.getById(id);
    res.json(player);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const teamId = req.params.teamId as string;
    validateUUID(teamId, 'ID de equipo');
    const player = await playerService.create({ ...req.body, teamId });
    res.status(201).json(player);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.playerId as string;
    validateUUID(id, 'ID de jugador@');
    const player = await playerService.update(id, req.body);
    res.json(player);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.playerId as string;
    validateUUID(id, 'ID de jugador@');
    await playerService.delete(id);
    res.json({ message: 'Jugador@ eliminad@ exitosamente' });
  } catch (error) {
    next(error);
  }
}
