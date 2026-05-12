/**
 * Barrel for the `api` object. The actual endpoint-handling code lives
 * one directory down in `api/` split by resource. This file composes
 * those partial objects into the single `api.foo()` entry point every
 * caller already imports, so the split is invisible to the rest of
 * the codebase.
 *
 * If you're adding a new endpoint:
 *   · pick or create the appropriate `api/<resource>.ts`
 *   · add the method there
 *   · it's automatically part of `api` via the spread below
 *
 * If you're adding a new DTO:
 *   · drop it into `api/dtos.ts`
 *   · re-export from here if it's needed outside the api/ package
 */

import { authApi } from './api/auth';
import { adminApi } from './api/admin';
import { pushApi } from './api/push';
import { uploadsApi } from './api/uploads';
import { tournamentsApi } from './api/tournaments';
import { teamsApi } from './api/teams';
import { playersApi } from './api/players';
import { matchesApi } from './api/matches';
import { bracketApi } from './api/bracket';
import { judgesApi } from './api/judges';
import { settingsApi } from './api/settings';
import { platformApi } from './api/platform';
import { clubsApi } from './api/clubs';

export const api = {
  ...authApi,
  ...adminApi,
  ...pushApi,
  ...uploadsApi,
  ...tournamentsApi,
  ...teamsApi,
  ...playersApi,
  ...matchesApi,
  ...bracketApi,
  ...judgesApi,
  ...settingsApi,
  ...platformApi,
  ...clubsApi,
  // Re-export the clubs namespace explicitly so `api.clubs.detect()` and
  // `api.clubs.downloadExcel()` can be called without naming collisions
  // with the spread above (which mainly merges flat method names from
  // each domain).
  clubs: clubsApi,
};

// Re-exports — consumers import from 'api' rather than the sub-modules.
export { ApiError, setAuthToken, setOnUnauthorized, getAuthToken } from './api/client';
export { updateTeamsCache, clearTeamsCache } from './api/transformers';
export type {
  CreateTournamentDto,
  UpdateTournamentDto,
  CreateTeamDto,
  UpdateTeamDto,
  CreatePlayerDto,
  UpdatePlayerDto,
  CreateMatchDto,
  UpdateMatchDto,
  ScoreUpdate,
  SystemSettings,
  LoginResponse,
  Judge,
  PlatformStats,
  PlatformUser,
  CreatePlatformUserDto,
  UpdatePlatformUserDto,
} from './api/dtos';
