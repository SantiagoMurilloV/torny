import { Router } from 'express';
import {
  getAll,
  getById,
  create,
  update,
  updateLogo,
  remove,
  getMatches,
  getTournaments,
  generateCredentials,
  getCredentials,
  search,
} from '../controllers/team.controller';
import {
  listByTeam as listPlayers,
  getById as getPlayerById,
  create as createPlayer,
  update as updatePlayer,
  remove as removePlayer,
} from '../controllers/player.controller';
import { requireRole } from '../middleware/auth';
import { requireTeamOwnership } from '../middleware/access';
import { cacheGet } from '../middleware/cache';

const router = Router();

// CRUD — `/teams` is the heaviest read endpoint of the public flow
// (carries logos as base64 data URLs), so we cache it the longest.
// Teams change rarely once a tournament is set up.
router.get('/', cacheGet(60), getAll);
// Search is intentionally NOT cached — it depends on the caller's owner
// scope and on the live query string, so caching would cross-contaminate
// admins. The query is cheap (LIMIT 20) and runs only when the team
// picker modal is open.
router.get('/search', search);
router.get('/:id', cacheGet(60), getById);
router.post('/', create);
// Mutations are owner-scoped: the admin who created the team (or its
// captain, for /logo only) is the only non-super_admin who can touch
// it. Captain access is handled inside `requireTeamOwnership`.
router.put('/:id', requireTeamOwnership, update);
router.delete('/:id', requireTeamOwnership, remove);

// Logo-only update — gated by requireTeamOwnership which also lets the
// team's captain through (parity with the previous requireTeamAccess).
router.put('/:teamId/logo', requireTeamOwnership, updateLogo);

// Team sub-resources
router.get('/:id/matches', cacheGet(10), getMatches);

// Tournaments where this team is enrolled. Gated by requireTeamOwnership
// so the captain (own team only), the owner-admin, and super_admins can
// list it. Skip the public cache because the response is tenant-scoped:
// `Cache-Control: private, no-store` is emitted by the auth branch of
// cacheGet, but we go further and don't even invoke that middleware
// since this route is never legitimately public.
router.get('/:teamId/tournaments', requireTeamOwnership, getTournaments);

// Captain credentials — admins (and super_admins) can look up, (re)generate
// a team captain's login. Owner gate keeps Admin A out of Admin B's team.
//   GET    → returns {username, password?, generatedAt, recoveryEnabled}.
//            password is plaintext when PLATFORM_RECOVERY_KEY decrypts the
//            stored AES-GCM blob; null otherwise. 404 if never generated.
//   POST   → generates or rotates and returns the plaintext exactly once.
router.get(
  '/:teamId/credentials',
  requireRole('admin', 'super_admin'),
  requireTeamOwnership,
  getCredentials
);
router.post(
  '/:teamId/credentials',
  requireRole('admin', 'super_admin'),
  requireTeamOwnership,
  generateCredentials
);

// Roster — nested under /teams/:teamId/players
// GET is public (read-only); POST/PUT/DELETE require either ownership
// (admin/super_admin who owns the team) or the team's own captain. The
// captain bypass lives inside requireTeamOwnership so the same guard
// covers both paths consistently.
router.get('/:teamId/players', cacheGet(60), listPlayers);
router.get('/:teamId/players/:playerId', cacheGet(60), getPlayerById);
router.post('/:teamId/players', requireTeamOwnership, createPlayer);
router.put('/:teamId/players/:playerId', requireTeamOwnership, updatePlayer);
router.delete('/:teamId/players/:playerId', requireTeamOwnership, removePlayer);

// Note: the previous `requireTeamAccess` (auth.ts) is now superseded by
// `requireTeamOwnership` which enforces admin owner_id + lets the team's
// own captain through. The older guard stays exported for any route
// outside this file that still needs the team_captain-only behavior.

export default router;
