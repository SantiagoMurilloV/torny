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
import {
  requireMatchAccess,
  requireTournamentAccessFromBody,
} from '../middleware/access';

const router = Router();

// CRUD — `/matches` is the live-score endpoint, polled every 25 s by
// the public client. 15 s TTL with a 60 s SWR window collapses 400+
// concurrent pollers into ~1 origin hit per 15 s and lets Vercel's
// edge serve the stale snapshot during the refresh — load testing
// at 400 spectators showed Vercel rate-limiting kicked in when the
// origin was hit every 5 s.
router.get('/', cacheGet(15, { swrSeconds: 60 }), getAll);
router.get('/:id', cacheGet(15, { swrSeconds: 60 }), getById);
// Mutations are owner-scoped: the admin who owns the match's parent
// tournament (or super_admin / a judge created by that admin) is the
// only caller allowed through. POST reads the tournament from the
// body; the others derive it from the match's existing tournamentId.
router.post('/', requireTournamentAccessFromBody('tournamentId'), create);
router.put('/:id', requireMatchAccess, update);
router.delete('/:id', requireMatchAccess, remove);

// Score update — judges hit this from the referee panel. The match
// access guard checks the judge's `createdBy` against the tournament's
// owner_id so a judge created by Admin A cannot score Admin B's match
// (even if they happened to learn the match id).
router.put('/:id/score', requireMatchAccess, updateScore);

export default router;
