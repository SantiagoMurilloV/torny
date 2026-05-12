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
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// `/me/teams` is for the club_captain's own panel.
router.get('/me/teams', requireAuth, meTeams);

// Everything else is admin-only (super_admin also passes through
// requireRole). The service does owner-scoping so super_admin only
// sees their own clubs unless we extend listForOwner later.
router.get('/export', requireAuth, requireRole('admin', 'super_admin'), exportExcel);
router.post('/detect', requireAuth, requireRole('admin', 'super_admin'), detect);
router.post('/bulk', requireAuth, requireRole('admin', 'super_admin'), bulkCreate);
router.get('/', requireAuth, requireRole('admin', 'super_admin'), list);
router.get('/:id', requireAuth, requireRole('admin', 'super_admin'), getById);
router.put('/:id', requireAuth, requireRole('admin', 'super_admin'), rename);
router.post(
  '/:id/credentials',
  requireAuth,
  requireRole('admin', 'super_admin'),
  regenerateCredentials,
);
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), remove);

export default router;
