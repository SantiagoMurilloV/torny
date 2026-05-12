import { Router } from 'express';
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
} from '../controllers/club.controller';
import { requireRole } from '../middleware/auth';

const router = Router();

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
router.put('/:id', requireRole('admin', 'super_admin'), rename);
router.post(
  '/:id/credentials',
  requireRole('admin', 'super_admin'),
  regenerateCredentials,
);
router.delete('/:id', requireRole('admin', 'super_admin'), remove);

export default router;
