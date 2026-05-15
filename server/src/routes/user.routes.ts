import { Router } from 'express';
import {
  listJudges,
  createJudge,
  updateJudge,
  deleteJudge,
  resetJudgePassword,
} from '../controllers/user.controller';
import { requireRole } from '../middleware/auth';

const router = Router();

/**
 * Judge management. All routes require the admin role — judges cannot
 * manage other users, and non-authenticated requests never reach here
 * because the global `authMiddleware` gates non-GET methods.
 */
router.get('/judges', requireRole('admin'), listJudges);
router.post('/judges', requireRole('admin'), createJudge);
router.patch('/judges/:id', requireRole('admin'), updateJudge);
router.delete('/judges/:id', requireRole('admin'), deleteJudge);
router.post('/judges/:id/password', requireRole('admin'), resetJudgePassword);

export default router;
