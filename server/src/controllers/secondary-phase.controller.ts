import { Request, Response, NextFunction } from 'express';
import { generateSecondaryPhase, finalizeSecondaryPhase } from '../services/secondary-phase.service';
import { validateUUID } from '../middleware/validation';

export async function generate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const result = await generateSecondaryPhase(id);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function finalize(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const result = await finalizeSecondaryPhase(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
