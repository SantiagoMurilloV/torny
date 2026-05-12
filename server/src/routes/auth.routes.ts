import { Router } from 'express';
import { login, logout, changePassword, me } from '../controllers/auth.controller';
import { loginRateLimiter } from '../middleware/rateLimit';
import { requireRole } from '../middleware/auth';

const router = Router();

// Login is the single entry point for brute-force attacks, so we
// throttle it per (ip, username) before bcrypt.compare even runs.
// The controller itself calls loginRateLimiter.clear() on success so a
// legitimate user isn't locked out after 5 successful logins.
router.post('/login', loginRateLimiter, login);
router.post('/logout', logout);
router.put('/password', changePassword);
// /me is authenticated (any role) and exposes the caller's own profile.
// For users (admin/judge/super_admin) it includes tournament quota — the
// frontend uses that for the "X/Y torneos de tu plan" badge. For
// team_captain it returns the captain's team info (id, initials, logo,
// colors, category) so /team-panel has something to render. For
// club_captain (mig 028) it returns the club's id + name so /club-panel
// can title itself + render the team list. The allowlist must include
// EVERY role we issue JWTs for, otherwise the role's first request
// after login bounces with 403 and the panel never loads.
router.get(
  '/me',
  requireRole('super_admin', 'admin', 'judge', 'team_captain', 'club_captain'),
  me,
);

export default router;
