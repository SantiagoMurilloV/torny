import { Request, Response, NextFunction } from 'express';
import { sponsorService } from '../services/sponsor.service';
import { validateUUID } from '../middleware/validation';

/**
 * HTTP layer for the `tournament_sponsors` table (mig 033). All
 * mutations are owner-gated at the route layer
 * (`requireTournamentAccess`). Public callers can list sponsors
 * because the public Hero will render them in a strip.
 */

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const sponsors = await sponsorService.listByTournament(id);
    res.json(sponsors);
  } catch (error) {
    next(error);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const sponsor = await sponsorService.create(id, req.body ?? {});
    res.status(201).json(sponsor);
  } catch (error) {
    next(error);
  }
}

export async function update(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const sponsorId = req.params.sponsorId as string;
    validateUUID(id, 'ID de torneo');
    validateUUID(sponsorId, 'ID de patrocinador');
    const sponsor = await sponsorService.update(id, sponsorId, req.body ?? {});
    res.json(sponsor);
  } catch (error) {
    next(error);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const sponsorId = req.params.sponsorId as string;
    validateUUID(id, 'ID de torneo');
    validateUUID(sponsorId, 'ID de patrocinador');
    await sponsorService.remove(id, sponsorId);
    res.json({ message: 'Patrocinador eliminado' });
  } catch (error) {
    next(error);
  }
}

export async function reorder(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { orderedIds } = (req.body ?? {}) as { orderedIds?: string[] };
    const sponsors = await sponsorService.reorder(id, orderedIds ?? []);
    res.json(sponsors);
  } catch (error) {
    next(error);
  }
}
