import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/user.service';
import { validateUUID } from '../middleware/validation';
import type { UpdateJudgeDto } from '../services/user.service';

export async function listJudges(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Admins see only the judges they created; super_admin sees all.
    const createdBy = req.user?.role === 'admin' ? req.user.userId : undefined;
    const judges = await userService.listJudges(createdBy);
    res.json(judges);
  } catch (error) {
    next(error);
  }
}

export async function createJudge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Admin-created judges are tied to that admin so they only see
    // matches of that admin's tournaments. super_admin creates unscoped
    // (platform) judges by default.
    const createdBy = req.user?.role === 'admin' ? req.user.userId : null;
    const judge = await userService.createJudge(req.body, createdBy);
    res.status(201).json(judge);
  } catch (error) {
    next(error);
  }
}

export async function updateJudge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de juez');
    const body = req.body as UpdateJudgeDto;
    const judge = await userService.updateJudge(id, {
      assignedTournamentId: body.assignedTournamentId ?? null,
      assignedCourt: body.assignedCourt ?? null,
    });
    res.json(judge);
  } catch (error) {
    next(error);
  }
}

export async function deleteJudge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de juez');
    await userService.deleteJudge(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function resetJudgePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de juez');
    const newPassword = (req.body as { password?: string }).password || '';
    const judge = await userService.resetJudgePassword(id, newPassword);
    res.json(judge);
  } catch (error) {
    next(error);
  }
}
