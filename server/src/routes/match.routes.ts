import { Router } from 'express';
import {
  getAll,
  getById,
  create,
  update,
  updateScore,
  remove,
} from '../controllers/match.controller';
import { cacheGet } from '../middleware/cache';

const router = Router();

// CRUD — `/matches` is the live-score endpoint, polled every 25 s by
// the public client. Short TTL (5 s) collapses concurrent polls into
// one DB query while keeping the visible lag below the polling cadence.
router.get('/', cacheGet(5, { swrSeconds: 30 }), getAll);
router.get('/:id', cacheGet(5, { swrSeconds: 30 }), getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

// Score update
router.put('/:id/score', updateScore);

export default router;
