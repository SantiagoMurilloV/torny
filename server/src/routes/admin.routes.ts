import { Router } from 'express';
import { dashboardStats } from '../controllers/admin.controller';
import { requireRole } from '../middleware/auth';

const router = Router();

/**
 * Admin endpoints. All gated behind `requireRole('admin')` so judges
 * (and anyone without a token) get 403. super_admin is intentionally
 * excluded — they have `/api/platform/*` for platform-wide views.
 */
router.get('/dashboard-stats', requireRole('admin'), dashboardStats);

export default router;
