/**
 * Single source of truth for the app's user roles. Mirrors the backend
 * type in `server/src/types/index.ts::AppRole`. A JWT's `role` field will
 * be one of these values.
 *
 * Kept as a `const` tuple so we can derive `AppRole` from the runtime
 * list — adding a new role means touching ONE line and the union + the
 * home-route map + ProtectedRoute's permit list stay honest.
 */
export const ROLES = [
  'super_admin',
  'admin',
  'judge',
  'team_captain',
  // mig 028 — one user/pass per club covers every team in the cluster.
  'club_captain',
] as const;

export type AppRole = (typeof ROLES)[number];

/**
 * Landing path for each role. Used both on a successful login (to push
 * the user straight into their chrome) and inside ProtectedRoute when
 * someone with the wrong role hits a route that isn't theirs (so they
 * bounce to their own panel instead of a raw 403).
 *
 * `null` for roles we don't want to redirect (none today — kept as a
 * type hatch for future read-only roles).
 */
export const ROLE_HOME: Record<AppRole, string> = {
  super_admin: '/super-admin',
  admin: '/admin',
  judge: '/judge',
  team_captain: '/team-panel',
  club_captain: '/club-panel',
};

/**
 * Resolve the landing path for a role. Falls back to `/admin` (the old
 * default) if the role string isn't one we recognise — matches the
 * historical behavior for forward compatibility with old tokens.
 */
export function homeForRole(role: string | undefined | null): string {
  if (role && role in ROLE_HOME) {
    return ROLE_HOME[role as AppRole];
  }
  return '/admin';
}

/** Human-readable label for a role, used in lists/badges. */
export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  judge: 'Juez',
  team_captain: 'Capitán',
  club_captain: 'Club',
};

export function roleLabel(role: string | undefined | null): string {
  if (role && role in ROLE_LABEL) return ROLE_LABEL[role as AppRole];
  return role ?? '';
}

/**
 * Role predicates — use these instead of `role === 'admin'` literals
 * so adding a new role in the ROLES tuple doesn't silently bypass
 * call-site checks. Each accepts `unknown` so they compose with any
 * input shape (AuthUser.role, JWT payload, form value, etc.).
 */
export function isRole(role: unknown, target: AppRole): boolean {
  return role === target;
}

export const isSuperAdmin = (role: unknown): boolean => isRole(role, 'super_admin');
export const isAdmin = (role: unknown): boolean => isRole(role, 'admin');
export const isJudge = (role: unknown): boolean => isRole(role, 'judge');
export const isTeamCaptain = (role: unknown): boolean => isRole(role, 'team_captain');
export const isClubCaptain = (role: unknown): boolean => isRole(role, 'club_captain');
