import { Router } from 'express';
import {
  getAll,
  getById,
  create,
  update,
  updateLogo,
  remove,
  getMatches,
  generateCredentials,
  getCredentials,
} from '../controllers/team.controller';
import {
  listByTeam as listPlayers,
  getById as getPlayerById,
  create as createPlayer,
  update as updatePlayer,
  remove as removePlayer,
} from '../controllers/player.controller';
import { requireRole, requireTeamAccess } from '../middleware/auth';
import { cacheGet } from '../middleware/cache';

const router = Router();

// CRUD — `/teams` is the heaviest read endpoint of the public flow
// (carries logos as base64 data URLs), so we cache it the longest.
// Teams change rarely once a tournament is set up.
router.get('/', cacheGet(60), getAll);
router.get('/:id', cacheGet(60), getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

// Logo-only update — gated by requireTeamAccess so the team's captain can
// upload their own crest from the team panel without exposing the rest of
// the team mutation surface (name, colors, captain credentials, etc).
router.put('/:teamId/logo', requireTeamAccess, updateLogo);

// Team sub-resources
router.get('/:id/matches', cacheGet(10), getMatches);

// Captain credentials — admins (and super_admins) can look up, (re)generate
// a team captain's login.
//   GET    → returns {username, password?, generatedAt, recoveryEnabled}.
//            password is plaintext when PLATFORM_RECOVERY_KEY decrypts the
//            stored AES-GCM blob; null otherwise. 404 if never generated.
//   POST   → generates or rotates and returns the plaintext exactly once.
router.get(
  '/:teamId/credentials',
  requireRole('admin', 'super_admin'),
  getCredentials
);
router.post(
  '/:teamId/credentials',
  requireRole('admin', 'super_admin'),
  generateCredentials
);

// Roster — nested under /teams/:teamId/players
// GET is public (read-only); POST/PUT/DELETE require an authenticated caller
// who either has global access (admin/super_admin) or is the team's captain.
router.get('/:teamId/players', cacheGet(60), listPlayers);
router.get('/:teamId/players/:playerId', cacheGet(60), getPlayerById);
router.post('/:teamId/players', requireTeamAccess, createPlayer);
router.put('/:teamId/players/:playerId', requireTeamAccess, updatePlayer);
router.delete('/:teamId/players/:playerId', requireTeamAccess, removePlayer);

export default router;
