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
// the public client. 15 s TTL with a 60 s SWR window collapses 400+
// concurrent pollers into ~1 origin hit per 15 s and lets Vercel's
// edge serve the stale snapshot during the refresh — load testing
// at 400 spectators showed Vercel rate-limiting kicked in when the
// origin was hit every 5 s.
router.get('/', cacheGet(15, { swrSeconds: 60 }), getAll);
router.get('/:id', cacheGet(15, { swrSeconds: 60 }), getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

// Score update
router.put('/:id/score', updateScore);

export default router;
