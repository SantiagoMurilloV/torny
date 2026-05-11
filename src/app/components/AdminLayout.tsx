import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  Trophy,
  Settings,
  LogOut,
  Menu,
  X,
  UserCog,
  ChevronDown,
  ChevronRight,
  Info,
  Users as UsersIcon,
  Shuffle,
  Swords,
} from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useIdleTimeout, useActivePresence } from '../hooks/useIdleTimeout';
import { IdleWarningDialog } from './admin/IdleWarningDialog';
import { isAdmin } from '../lib/roles';

// Idle auto-logout — admin only. Judges deliberately stay on the
// scoring console for long stretches between rallies and must never
// be kicked out mid-match.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min total idle → logout
const IDLE_WARN_MS = 60 * 1000; // warn 60 s before the logout fires

/**
 * Sub-tabs inside the tournament detail. These live in the URL as
 * `?tab=<id>` and are deep-linkable from the sidebar — clicking one
 * here navigates AND selects the right tab inside AdminTournamentDetail.
 */
const TOURNAMENT_TABS = [
  { id: 'info', label: 'Ajustes generales', icon: Info },
  { id: 'teams', label: 'Equipos inscritos', icon: UsersIcon },
  { id: 'fixtures', label: 'Cruces', icon: Shuffle },
  { id: 'matches', label: 'Partidos', icon: Swords },
] as const;

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { tournaments } = useData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [idleWarnOpen, setIdleWarnOpen] = useState(false);

  // "Online" dot in the sidebar. True while the user has generated any
  // activity in the last minute AND the tab is visible — flips to dim
  // grey when the admin steps away or minimizes the browser.
  const isActivePresence = useActivePresence(60_000);

  // ── Nested sidebar state ─────────────────────────────────────────
  //
  // "Torneos" expands to show the list of tournaments; each tournament
  // further expands to show its 4 sub-tabs. We auto-expand the node
  // that matches the current URL so the sidebar reflects "where am I".
  const currentTournamentId = useMemo(() => {
    const m = location.pathname.match(/^\/admin\/tournaments\/([^/]+)$/);
    return m ? m[1] : null;
  }, [location.pathname]);

  // Path-prefix match: /admin or /admin/tournaments should show the
  // Torneos node as expanded. We initialize open-by-default to `true`
  // when we're anywhere under /admin/tournaments.
  const [torneosOpen, setTorneosOpen] = useState(() =>
    location.pathname.startsWith('/admin/tournaments'),
  );
  const [expandedTournaments, setExpandedTournaments] = useState<Set<string>>(
    () => new Set(currentTournamentId ? [currentTournamentId] : []),
  );

  // Keep expansions in sync when the URL changes (e.g. router navigation
  // from within a page). Merges rather than overwrites so user manual
  // expansions aren't lost.
  useEffect(() => {
    if (location.pathname.startsWith('/admin/tournaments')) {
      setTorneosOpen(true);
    }
    if (currentTournamentId) {
      setExpandedTournaments((prev) => {
        if (prev.has(currentTournamentId)) return prev;
        const next = new Set(prev);
        next.add(currentTournamentId);
        return next;
      });
    }
  }, [location.pathname, currentTournamentId]);

  const toggleTournament = useCallback((tId: string) => {
    setExpandedTournaments((prev) => {
      const next = new Set(prev);
      if (next.has(tId)) next.delete(tId);
      else next.add(tId);
      return next;
    });
  }, []);

  // ── Logout + idle handling ──────────────────────────────────────

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const handleIdleWarn = useCallback(() => {
    setIdleWarnOpen(true);
  }, []);

  const handleIdleTimeout = useCallback(() => {
    setIdleWarnOpen(false);
    toast.info('Tu sesión se cerró por inactividad');
    handleLogout();
  }, [handleLogout]);

  const { reset: resetIdle } = useIdleTimeout({
    enabled: isAdmin(user?.role),
    timeoutMs: IDLE_TIMEOUT_MS,
    warnMs: IDLE_WARN_MS,
    onWarn: handleIdleWarn,
    onTimeout: handleIdleTimeout,
  });

  const handleContinueSession = useCallback(() => {
    setIdleWarnOpen(false);
    resetIdle();
  }, [resetIdle]);

  // ── URL helpers ─────────────────────────────────────────────────

  const currentTab = new URLSearchParams(location.search).get('tab') ?? 'info';

  // Top-level entries other than Torneos (which is special — nested).
  // "Partidos" was removed from the top level: it's duplicated inside
  // every tournament's sub-nav and the global /admin/matches page is
  // rarely useful once you're working inside a single torneo.
  const flatItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
    { icon: UserCog, label: 'Jueces', path: '/admin/judges' },
    { icon: Settings, label: 'Configuración', path: '/admin/settings' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Mobile floating menu button — replaces the previous full-width
          black header bar (Trophy + "Torny ADMIN" + subtitle) so the
          page content keeps the entire viewport on mobile. The button
          stays z-50 so it sits above the sidebar overlay (z-30) and
          the sidebar itself (z-40); clicking it toggles to X to close
          the sidebar without needing a second control inside it. */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed top-3 left-3 z-50 inline-flex items-center justify-center w-10 h-10 bg-black/85 hover:bg-black backdrop-blur-md text-white rounded-sm shadow-lg transition-colors"
        aria-label={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
      >
        {sidebarOpen ? (
          <X className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Menu className="w-5 h-5" aria-hidden="true" />
        )}
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-black border-r border-white/10 z-40
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 w-[85vw] max-w-72 md:w-72 flex flex-col
        `}
      >
        {/* Logo */}
        <div className="hidden md:flex items-center gap-3 p-6 border-b border-white/10 flex-shrink-0">
          <div className="w-12 h-12 bg-white rounded-sm flex items-center justify-center">
            <Trophy className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-white tracking-tighter"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Torn<span className="text-spk-red">y</span>
            </h1>
            <div className="w-16 h-0.5 bg-spk-red mt-1" />
            <p className="text-xs text-white/60 mt-1 uppercase tracking-wider">Admin Panel</p>
          </div>
        </div>

        {/* Navigation (scrolls if tournament list is long).
            The mobile mt-16 used to clear the old fixed header — now
            removed, but we keep an mt-14 so the floating hamburger
            button (top-3 left-3, 40 px square) doesn't overlap the
            first nav row when the sidebar is open. */}
        <nav className="p-4 space-y-1 mt-14 md:mt-0 flex-1 overflow-y-auto">
          {/* Dashboard */}
          <TopLink
            icon={LayoutDashboard}
            label="Dashboard"
            path="/admin"
            active={location.pathname === '/admin'}
            onNavigate={() => setSidebarOpen(false)}
          />

          {/* Torneos (nested) */}
          <div>
            <div className="flex items-stretch">
              {/* Left side: main link to /admin/tournaments */}
              <Link
                to="/admin/tournaments"
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex-1 flex items-center gap-3 px-4 py-3 rounded-l-sm transition-colors relative overflow-hidden
                  ${
                    location.pathname === '/admin/tournaments'
                      ? 'bg-white text-black'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }
                `}
              >
                {location.pathname === '/admin/tournaments' && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute left-0 top-0 bottom-0 w-1 bg-spk-red"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <Trophy className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                <span
                  className="font-bold uppercase tracking-wider text-sm"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                >
                  Torneos
                </span>
              </Link>
              {/* Right side: expand/collapse chevron (independent from nav) */}
              <button
                type="button"
                onClick={() => setTorneosOpen((v) => !v)}
                aria-label={torneosOpen ? 'Colapsar torneos' : 'Expandir torneos'}
                aria-expanded={torneosOpen}
                className={`px-3 rounded-r-sm transition-colors ${
                  location.pathname === '/admin/tournaments'
                    ? 'bg-white text-black/60 hover:text-black'
                    : 'text-white/50 hover:text-white hover:bg-white/10'
                }`}
              >
                <motion.span
                  animate={{ rotate: torneosOpen ? 0 : -90 }}
                  transition={{ duration: 0.18 }}
                  className="inline-flex"
                  aria-hidden="true"
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.span>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {torneosOpen && (
                <motion.div
                  key="torneos-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="pl-3 mt-1 space-y-0.5 border-l border-white/10 ml-5">
                    {tournaments.length === 0 && (
                      <div className="px-3 py-2 text-xs text-white/40 italic">
                        Sin torneos todavía
                      </div>
                    )}
                    {tournaments.map((t) => {
                      const isOpenT = expandedTournaments.has(t.id);
                      const isCurrent = currentTournamentId === t.id;
                      return (
                        <div key={t.id}>
                          <div className="flex items-stretch">
                            <Link
                              to={`/admin/tournaments/${t.id}`}
                              onClick={() => setSidebarOpen(false)}
                              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-l-sm transition-colors ${
                                isCurrent && !currentTab
                                  ? 'bg-white/10 text-white'
                                  : 'text-white/60 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <span className="text-sm truncate" title={t.name}>
                                {t.name}
                              </span>
                            </Link>
                            <button
                              type="button"
                              onClick={() => toggleTournament(t.id)}
                              aria-label={isOpenT ? 'Colapsar' : 'Expandir'}
                              aria-expanded={isOpenT}
                              className="px-2 text-white/40 hover:text-white hover:bg-white/5 rounded-r-sm"
                            >
                              <motion.span
                                animate={{ rotate: isOpenT ? 0 : -90 }}
                                transition={{ duration: 0.18 }}
                                className="inline-flex"
                                aria-hidden="true"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </motion.span>
                            </button>
                          </div>

                          <AnimatePresence initial={false}>
                            {isOpenT && (
                              <motion.div
                                key="tabs"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                className="overflow-hidden"
                              >
                                <ul className="pl-4 py-1 space-y-0.5 border-l border-white/10 ml-3">
                                  {TOURNAMENT_TABS.map((tab) => {
                                    const TabIcon = tab.icon;
                                    const tabActive =
                                      isCurrent &&
                                      (tab.id === 'info'
                                        ? currentTab === 'info'
                                        : currentTab === tab.id);
                                    const target =
                                      tab.id === 'info'
                                        ? `/admin/tournaments/${t.id}`
                                        : `/admin/tournaments/${t.id}?tab=${tab.id}`;
                                    return (
                                      <li key={tab.id}>
                                        <Link
                                          to={target}
                                          onClick={() => setSidebarOpen(false)}
                                          className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs transition-colors ${
                                            tabActive
                                              ? 'bg-spk-red text-white'
                                              : 'text-white/55 hover:text-white hover:bg-white/5'
                                          }`}
                                        >
                                          <TabIcon
                                            className="w-3.5 h-3.5 flex-shrink-0"
                                            aria-hidden="true"
                                          />
                                          <span className="truncate">{tab.label}</span>
                                        </Link>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* The rest of the top-level entries */}
          {flatItems.slice(1).map((item) => (
            <TopLink
              key={item.path}
              icon={item.icon}
              label={item.label}
              path={item.path}
              active={location.pathname === item.path}
              onNavigate={() => setSidebarOpen(false)}
            />
          ))}
        </nav>

        {/* User & Logout */}
        <div className="p-4 border-t border-white/10 bg-black flex-shrink-0">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="relative">
              <div className="w-10 h-10 bg-white rounded-sm flex items-center justify-center">
                <span
                  className="text-black font-bold text-lg"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                >
                  {(user?.username ?? 'A').charAt(0).toUpperCase()}
                </span>
              </div>
              <span
                className={`absolute -right-1 -bottom-1 w-3 h-3 rounded-full border-2 border-black ${
                  isActivePresence ? 'bg-spk-win' : 'bg-white/30'
                }`}
                aria-hidden="true"
              >
                {isActivePresence && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-spk-win"
                    animate={{ scale: [1, 1.8], opacity: [0.55, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-bold text-white truncate"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {user?.username ?? 'Administrador'}
              </div>
              <div className="text-xs text-white/60 truncate">
                {isActivePresence ? 'En línea' : 'Inactivo'}
              </div>
            </div>
          </div>
          <motion.button
            onClick={handleLogout}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-spk-red text-white hover:bg-spk-red/90 rounded-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span
              className="font-bold uppercase tracking-wider text-sm"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Cerrar Sesión
            </span>
          </motion.button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-30"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content. Mobile pt was pt-16 to clear the old fixed
          header bar; now we only need pt-14 to leave room for the
          floating hamburger (top-3 + 40 px height = 52 px) plus a
          tiny breathing gap before page headings. Desktop has no
          floating button so pt is 0. */}
      <main className="md:ml-72 pt-14 md:pt-0 min-h-screen bg-white">
        <Outlet />
      </main>

      {/* Idle warning — only active for admins (the hook itself is
          disabled for other roles). */}
      <IdleWarningDialog
        open={idleWarnOpen}
        secondsUntilLogout={Math.floor(IDLE_WARN_MS / 1000)}
        onContinue={handleContinueSession}
        onLogoutNow={() => {
          setIdleWarnOpen(false);
          handleLogout();
        }}
      />
    </div>
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────

interface TopLinkProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
  active: boolean;
  onNavigate: () => void;
}

function TopLink({ icon: Icon, label, path, active, onNavigate }: TopLinkProps) {
  return (
    <Link to={path} onClick={onNavigate}>
      <motion.div
        whileHover={{
          x: 4,
          backgroundColor: active ? 'rgb(255, 255, 255)' : 'rgba(255, 255, 255, 0.1)',
        }}
        whileTap={{ scale: 0.98 }}
        className={`
          flex items-center gap-3 px-4 py-3 rounded-sm transition-all relative overflow-hidden
          ${active ? 'text-black' : 'text-white/70 hover:text-white'}
        `}
        style={{ backgroundColor: active ? 'rgb(255, 255, 255)' : 'transparent' }}
      >
        {active && (
          <motion.div
            layoutId="activeNav"
            className="absolute left-0 top-0 bottom-0 w-1 bg-spk-red"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        )}
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span
          className="font-bold uppercase tracking-wider text-sm"
          style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
        >
          {label}
        </span>
      </motion.div>
    </Link>
  );
}
