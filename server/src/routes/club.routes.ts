import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  detect,
  bulkCreate,
  list,
  getById,
  rename,
  regenerateCredentials,
  remove,
  exportExcel,
  meTeams,
  listTeamsByClub,
  split,
} from '../controllers/club.controller';
import { requireRole } from '../middleware/auth';

const router = Router();

/**
 * Force a per-tenant private cache on every club response. Without
 * this, Fastly (Railway's edge) heuristically caches responses that
 * lack a Cache-Control header — and the response keys ignore the
 * Authorization header. The result is a cross-tenant leak: club A
 * gets club B's cached `{teamIds: [...]}` payload (or vice-versa
 * with a 403 baked in). Same defensive pattern the `cacheGet`
 * middleware already applies for owner-scoped reads on the public
 * tournament + team endpoints.
 */
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Origin, Accept-Encoding, Authorization');
  next();
});

// Auth runs globally via `authMiddleware` mounted in index.ts FOR
// non-GET requests; GETs need explicit role middleware to populate
// `req.user` from the Bearer token. `meTeams` is GET → use
// requireRole('club_captain') so the JWT is verified before the
// controller runs.

router.get('/me/teams', requireRole('club_captain'), meTeams);

router.get('/export', requireRole('admin', 'super_admin'), exportExcel);
router.post('/detect', requireRole('admin', 'super_admin'), detect);
router.post('/bulk', requireRole('admin', 'super_admin'), bulkCreate);
router.get('/', requireRole('admin', 'super_admin'), list);
router.get('/:id', requireRole('admin', 'super_admin'), getById);
router.get(
  '/:id/teams',
  requireRole('admin', 'super_admin'),
  listTeamsByClub,
);
router.put('/:id', requireRole('admin', 'super_admin'), rename);
router.post(
  '/:id/credentials',
  requireRole('admin', 'super_admin'),
  regenerateCredentials,
);
// Split: move N teams to a new club, keep the original. Returns the
// NEW club row so the show-once modal can display its credentials.
router.post('/:id/split', requireRole('admin', 'super_admin'), split);
router.delete('/:id', requireRole('admin', 'super_admin'), remove);

export default router;
