import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router';
import { Loader2, RefreshCw } from 'lucide-react';
import { Layout } from './components/Layout';
import { AdminLayout } from './components/AdminLayout';
import { JudgeLayout } from './components/JudgeLayout';
import { SuperAdminLayout } from './components/SuperAdminLayout';
import { TeamPanelLayout } from './components/TeamPanelLayout';
import { ProtectedRoute } from './components/ProtectedRoute';

// Keep Home eager: it's the landing page and already critical-path.
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';

/**
 * Wraps `import()` so a failed chunk fetch triggers a single page
 * reload. When we redeploy, the old bundle still references chunks
 * by their previous hashes (e.g. Dashboard-abc123.js). Users with an
 * open tab hit a 404 the first time they navigate to a lazy route.
 * Reloading pulls the fresh bundle with the new hashes.
 *
 * Gated by sessionStorage so we don't loop forever if the chunk is
 * genuinely broken (dev error, bad deploy, actual 404 of an asset
 * that shouldn't exist).
 */
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      const looksLikeChunkError =
        /dynamically imported module|Loading chunk|Failed to fetch/i.test(msg);
      const alreadyReloaded = sessionStorage.getItem('chunk-reload-attempt') === '1';
      if (looksLikeChunkError && !alreadyReloaded) {
        sessionStorage.setItem('chunk-reload-attempt', '1');
        // Hard reload — we want a fresh index.html with the new hash
        // manifest, not just a re-run of the same stale JS.
        window.location.reload();
        // Return a dummy component that never renders (the reload
        // aborts everything anyway) so Suspense doesn't choke on
        // the rejection before navigation happens.
        return { default: (() => null) as unknown as T };
      }
      // Not a chunk error, or we already tried once — bubble up so
      // the router's errorElement can show the friendly fallback.
      throw err;
    }
  });
}

// Lazy-load everything else so the initial bundle stays lean.
const Login = lazyWithRetry(() =>
  import('./pages/Login').then((m) => ({ default: m.Login })),
);
const MatchDetail = lazyWithRetry(() =>
  import('./pages/MatchDetail').then((m) => ({ default: m.MatchDetail })),
);
const TournamentDetail = lazyWithRetry(() =>
  import('./pages/TournamentDetail').then((m) => ({ default: m.TournamentDetail })),
);
const TeamDetail = lazyWithRetry(() =>
  import('./pages/TeamDetail').then((m) => ({ default: m.TeamDetail })),
);

const AdminDashboard = lazyWithRetry(() =>
  import('./pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })),
);
const AdminTournaments = lazyWithRetry(() =>
  import('./pages/admin/AdminTournaments').then((m) => ({ default: m.AdminTournaments })),
);
const AdminMatches = lazyWithRetry(() =>
  import('./pages/admin/AdminMatches').then((m) => ({ default: m.AdminMatches })),
);
const AdminJudges = lazyWithRetry(() =>
  import('./pages/admin/AdminJudges').then((m) => ({ default: m.AdminJudges })),
);
const AdminClubs = lazyWithRetry(() =>
  import('./pages/admin/AdminClubs').then((m) => ({ default: m.AdminClubs })),
);
const AdminSettings = lazyWithRetry(() =>
  import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })),
);
const AdminTournamentDetail = lazyWithRetry(() =>
  import('./pages/admin/AdminTournamentDetail').then((m) => ({
    default: m.AdminTournamentDetail,
  })),
);

const JudgeDashboard = lazyWithRetry(() =>
  import('./pages/judge/JudgeDashboard').then((m) => ({ default: m.JudgeDashboard })),
);

const SuperAdminDashboard = lazyWithRetry(() =>
  import('./pages/super-admin/SuperAdminDashboard').then((m) => ({
    default: m.SuperAdminDashboard,
  })),
);

const TeamPanel = lazyWithRetry(() =>
  import('./pages/team-panel/TeamPanel').then((m) => ({ default: m.TeamPanel })),
);
const ClubPanel = lazyWithRetry(() =>
  import('./pages/club-panel/ClubPanel').then((m) => ({ default: m.ClubPanel })),
);
const PublicRegistration = lazyWithRetry(() =>
  import('./pages/public-registration/PublicRegistration').then((m) => ({
    default: m.PublicRegistration,
  })),
);
const SuperAdminUsers = lazyWithRetry(() =>
  import('./pages/super-admin/SuperAdminUsers').then((m) => ({
    default: m.SuperAdminUsers,
  })),
);

// RefereeScore is the live-scoring console. ONLY judges can open it — admins
// use the match-edit form for corrections. Keeping the /admin/referee path
// as a no-op redirect for any legacy bookmark so a stale link doesn't 404.
const RefereeScore = lazyWithRetry(() =>
  import('./pages/admin/RefereeScore').then((m) => ({ default: m.RefereeScore })),
);

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Cargando"
      className="min-h-[50vh] flex items-center justify-center"
    >
      <Loader2 className="w-8 h-8 animate-spin text-spk-red" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

/**
 * Route-level error boundary. Shown when a lazy chunk failed to load
 * AND lazyWithRetry already consumed its one-shot reload. Gives the
 * user an explicit "Recargar" button so they're not stuck staring at
 * a red router error page.
 */
function RouteErrorBoundary() {
  const error = useRouteError() as Error | undefined;
  const msg = error?.message ?? '';
  const looksLikeChunkError =
    /dynamically imported module|Loading chunk|Failed to fetch/i.test(msg);

  useEffect(() => {
    // Clear the reload flag so the NEXT chunk error gets a fresh retry.
    sessionStorage.removeItem('chunk-reload-attempt');
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-4 bg-spk-red/10 text-spk-red rounded-sm flex items-center justify-center">
          <RefreshCw className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
        >
          {looksLikeChunkError ? 'La app se actualizó' : 'Ocurrió un error'}
        </h1>
        <p className="text-sm text-black/60 mb-5">
          {looksLikeChunkError
            ? 'Se desplegó una nueva versión mientras tenías esto abierto. Recargá la página para usar la última.'
            : 'Algo salió mal al cargar esta sección. Recargá para volver a intentarlo.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm font-bold uppercase"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
        >
          <RefreshCw className="w-4 h-4" />
          Recargar
        </button>
      </div>
    </div>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, Component: Home },
      { path: 'login', element: withSuspense(<Login />) },
      { path: 'match/:id', element: withSuspense(<MatchDetail />) },
      { path: 'tournament/:id', element: withSuspense(<TournamentDetail />) },
      { path: 'team/:id', element: withSuspense(<TeamDetail />) },
      { path: '*', Component: NotFound },
    ],
  },
  {
    // Judge-only live scoring console. Admins lost access entirely; the old
    // /admin/referee path is kept as a route so bookmarks don't 404, but
    // ProtectedRoute will bounce admin users back to /admin.
    path: '/admin/referee/:matchId',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['judge']}>
        {withSuspense(<RefereeScore />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/judge/match/:matchId',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['judge']}>
        {withSuspense(<RefereeScore />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['admin']}>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: withSuspense(<AdminDashboard />) },
      { path: 'tournaments', element: withSuspense(<AdminTournaments />) },
      { path: 'tournaments/:id', element: withSuspense(<AdminTournamentDetail />) },
      { path: 'matches', element: withSuspense(<AdminMatches />) },
      { path: 'judges', element: withSuspense(<AdminJudges />) },
      { path: 'clubs', element: withSuspense(<AdminClubs />) },
      { path: 'settings', element: withSuspense(<AdminSettings />) },
    ],
  },
  {
    path: '/judge',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['judge']}>
        <JudgeLayout />
      </ProtectedRoute>
    ),
    children: [{ index: true, element: withSuspense(<JudgeDashboard />) }],
  },
  {
    // Platform-level console. Only the super_admin(s) can reach this.
    // AdminLayout + AdminDashboard stay untouched; this is a parallel
    // control plane for tenant management + global stats.
    path: '/super-admin',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['super_admin']}>
        <SuperAdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: withSuspense(<SuperAdminDashboard />) },
      { path: 'users', element: withSuspense(<SuperAdminUsers />) },
    ],
  },
  {
    // Team-captain panel. Captains use credentials generated by an admin
    // from the Equipos inscritos list (see TeamCredentialsModal) and only
    // see/edit the roster of their own team. Also reachable as
    // `/team-panel/:teamId` from the club_captain flow (mig 028) — the
    // backend's requireTeamAccess permits that path when the team belongs
    // to the captain's club.
    path: '/team-panel',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['team_captain', 'club_captain']}>
        <TeamPanelLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: withSuspense(<TeamPanel />) },
      { path: ':teamId', element: withSuspense(<TeamPanel />) },
    ],
  },
  {
    // Club-captain panel (mig 028) — one user/pass per club lands here.
    // Lists every team the club owns; clicking a team opens the existing
    // TeamPanel at /team-panel/:teamId so logo + plantel UI is reused.
    path: '/club-panel',
    errorElement: <RouteErrorBoundary />,
    element: (
      <ProtectedRoute allowedRoles={['club_captain']}>
        <TeamPanelLayout />
      </ProtectedRoute>
    ),
    children: [{ index: true, element: withSuspense(<ClubPanel />) }],
  },
  {
    // Public parent-registration link (mig 029). Lives outside every
    // layout so a parent opening the link on their phone gets a
    // clean, focused page (no app shell / nav). The slug is the
    // tournament's `slug` column.
    path: '/torneo/:slug/inscripcion',
    errorElement: <RouteErrorBoundary />,
    element: withSuspense(<PublicRegistration />),
  },
]);
