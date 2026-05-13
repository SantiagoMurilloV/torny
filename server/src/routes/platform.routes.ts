import { Router } from 'express';
import {
  getStats,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  revealPassword,
  inspectOrphans,
  cleanOrphans,
} from '../controllers/platform.controller';
import { requireRole } from '../middleware/auth';

const router = Router();

/**
 * Every endpoint under /api/platform is super_admin-only. requireRole
 * handles both authentication (bearer token) and authorisation (correct
 * role) so routes stay declarative.
 */
router.get('/stats', requireRole('super_admin'), getStats);
router.get('/users', requireRole('super_admin'), listUsers);
router.post('/users', requireRole('super_admin'), createUser);
router.put('/users/:id', requireRole('super_admin'), updateUser);
router.delete('/users/:id', requireRole('super_admin'), deleteUser);
router.get('/users/:id/password', requireRole('super_admin'), revealPassword);

// Bracket orphan inspector + cleaner — read-only + destructive ops
// to recover from the 2026-05-13 duplicate-phase incident. Both are
// scoped to a single tournament and gated by super_admin.
router.get(
  '/tournaments/:id/orphan-matches',
  requireRole('super_admin'),
  inspectOrphans,
);
router.post(
  '/tournaments/:id/clean-orphan-matches',
  requireRole('super_admin'),
  cleanOrphans,
);

export default router;
