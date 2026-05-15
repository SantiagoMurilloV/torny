import { Request, Response, NextFunction } from 'express';
import { matchService } from '../services/match.service';
import { validateUUID } from '../middleware/validation';
import { optionalUser } from '../middleware/auth';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Scope per caller role:
    //   · judge      → only LIVE matches from tournaments owned by their creator admin
    //   · admin      → all matches from their own tournaments
    //   · super_admin / public → everything
    const caller = optionalUser(req);
    if (caller?.role === 'judge' && caller.createdBy) {
      const matches = await matchService.getAll({
        scope: 'judge',
        judgeCreatedBy: caller.createdBy,
        assignedCourt: caller.assignedCourt ?? null,
      });
      res.json(matches);
      return;
    }
    if (caller?.role === 'admin') {
      const matches = await matchService.getAll({
        scope: 'owner',
        ownerId: caller.userId,
      });
      res.json(matches);
      return;
    }
    const matches = await matchService.getAll();
    res.json(matches);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de partido');
    const match = await matchService.getById(id);
    res.json(match);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const match = await matchService.create(req.body);
    res.status(201).json(match);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de partido');
    const match = await matchService.update(id, req.body);
    res.json(match);
  } catch (error) {
    next(error);
  }
}

export async function updateScore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de partido');
    const match = await matchService.updateScore(id, req.body);
    res.json(match);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/matches/swap
 *
 * Atomically swaps (date, time, court) between two matches. Used by
 * the Cronograma drag-and-drop UI: when the admin drops match A onto
 * the slot occupied by match B, the regular `update()` path would
 * reject either single move because of the team/court conflict guard.
 * This endpoint performs both UPDATEs inside a transaction with row
 * locks, bypassing the per-row conflict check (the swap is symmetric
 * by construction). Service ensures both matches share a tournament
 * so an admin can't move a match across tenants.
 */
export async function swap(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { matchAId?: string; matchBId?: string };
    const a = body.matchAId ?? '';
    const b = body.matchBId ?? '';
    validateUUID(a, 'matchAId');
    validateUUID(b, 'matchBId');
    const result = await matchService.swapSlots(a, b);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de partido');
    await matchService.delete(id);
    res.json({ message: 'Partido eliminado exitosamente' });
  } catch (error) {
    next(error);
  }
}
