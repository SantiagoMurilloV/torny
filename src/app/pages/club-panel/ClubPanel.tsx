import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2,
  Loader2,
  ArrowRight,
  Users,
  Share2,
  Calendar,
  Search,
  CalendarDays,
  Trophy,
  Clock,
  CircleDot,
  Sparkles,
  LayoutDashboard,
  Volleyball,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../services/api';
import type { Team, Tournament } from '../../types';
import { TeamAvatar } from '../../components/TeamAvatar';
import { getErrorMessage } from '../../lib/errors';
import { ParentRegistrationLinkModal } from './ParentRegistrationLinkModal';
import { ClubPushPermissionGate } from './ClubPushPermissionGate';
import { ClubCronogramaSection } from './ClubCronogramaSection';

/**
 * The /clubs/me/teams endpoint hydrates each team with its current
 * roster size and match stats so the panel can render the whole
 * dashboard without an N+1 fetch fanout.
 */
interface ClubTeamSummary extends Team {
  rosterCount: number;
  matchesPlayed: number;
  matchesUpcoming: number;
  matchesLive: number;
  wins: number;
  losses: number;
  currentPhase: string | null;
}

interface ClubStats {
  teams: number;
  players: number;
  matchesPlayed: number;
  matchesUpcoming: number;
  matchesLive: number;
  wins: number;
  losses: number;
}

/**
 * Tab keys for the in-panel section switcher. Each one maps to a
 * top-level region of the dashboard (resumen, equipos, inscripcion,
 * cronograma). Stored in component state so the user can jump
 * between sections without scrolling.
 */
type TabKey = 'resumen' | 'equipos' | 'inscripcion' | 'cronograma';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Club captain home (mig 028 + 029).
 *
 * Sections (top to bottom):
 *   1. Header con el nombre del club.
 *   2. Dashboard del club — cifras agregadas: equipos, jugadoras,
 *      partidos pendientes / en vivo / jugados, victorias.
 *   3. "Compartí el link de inscripción" — cards por torneo abierto
 *      en el que el club tiene equipos inscritos (mig 029).
 *   4. "Cronograma del club" — placeholder por ahora; se va a
 *      habilitar más adelante. Cuando esté listo va a mostrar la
 *      lista cronológica de partidos de todos los equipos del club.
 *   5. Equipos del club — buscador + cards con stats por equipo.
 *      Click → `/team-panel/:teamId` para gestionar plantel.
 *
 * ClubPushPermissionGate vive arriba como overlay invasivo (full
 * screen, sin backdrop dismiss, "ahora no" oculto 3s) para que el
 * capitán no se pierda los pings de inscripción.
 */
export function ClubPanel() {
  const navigate = useNavigate();
  const [clubName, setClubName] = useState<string>('');
  const [teams, setTeams] = useState<ClubTeamSummary[]>([]);
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLinkTournament, setActiveLinkTournament] =
    useState<Tournament | null>(null);
  // Client-side filter for the team list. Only rendered when the club
  // has 6+ teams (e.g. Spike has 14) to keep the UI light for smaller
  // clubs that don't need to search.
  const [teamSearch, setTeamSearch] = useState('');
  // Active section tab. Switching tabs hides every other section so
  // the captain works one thing at a time instead of scrolling
  // through a vertically-stacked page.
  const [activeTab, setActiveTab] = useState<TabKey>('resumen');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // /auth/me carries the club name for club_captain users.
        const me = await api.getMe();
        const fallbackName =
          (me as { club?: { name?: string } }).club?.name ??
          (me as { username?: string }).username ??
          '';
        setClubName(fallbackName);

        // Two parallel fetches: the rich team summary list (includes
        // roster counts, match stats, AND club-wide rollup in a
        // single query) and the tournaments where the club has at
        // least one team enrolled.
        const [meTeamsResp, fetchedTournaments] = await Promise.all([
          api.clubs.meTeams(),
          api.clubs.meTournaments().catch((err) => {
            // Don't fail the whole panel if /me/tournaments hiccups —
            // the team list is the primary content; the link cards are
            // a nice-to-have that the captain can retry on reload.
            // eslint-disable-next-line no-console
            console.warn('could not load tournaments:', err);
            return [] as Tournament[];
          }),
        ]);

        // Adapt the backend's flat color shape to the FE Team
        // interface (which nests them under `colors`). TeamAvatar
        // reads `team.colors.primary`.
        setTeams(
          meTeamsResp.teams.map((t) => ({
            id: t.id,
            name: t.name,
            initials: t.initials,
            logo: t.logo ?? undefined,
            colors: {
              primary: t.primaryColor,
              secondary: t.secondaryColor,
            },
            category: t.category ?? undefined,
            rosterCount: t.rosterCount,
            matchesPlayed: t.matchesPlayed,
            matchesUpcoming: t.matchesUpcoming,
            matchesLive: t.matchesLive,
            wins: t.wins,
            losses: t.losses,
            currentPhase: t.currentPhase,
          })),
        );
        setStats(meTeamsResp.stats);
        setTournaments(fetchedTournaments);
      } catch (err) {
        toast.error(getErrorMessage(err, 'No se pudieron cargar los equipos del club'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Open torneos = those whose start_date is in the future. Same logic
  // the backend uses to keep the public link alive (`now < startDate`)
  // so the UI mirrors the server's truth — the captain shouldn't see
  // a "Generar link" CTA on a torneo whose link is already dead.
  const openTournaments = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tournaments.filter((t) => {
      // tournament.startDate is a Date — slice(0, 10) of ISO gives a
      // YYYY-MM-DD string for direct lexicographic comparison.
      const iso = t.startDate.toISOString().slice(0, 10);
      return iso > today;
    });
  }, [tournaments]);

  const filteredTeams = useMemo(() => {
    const term = teamSearch.trim().toLowerCase();
    if (!term) return teams;
    return teams.filter((t) => {
      return (
        t.name.toLowerCase().includes(term) ||
        (t.category?.toLowerCase().includes(term) ?? false) ||
        t.initials.toLowerCase().includes(term)
      );
    });
  }, [teams, teamSearch]);

  return (
    <>
      <ClubPushPermissionGate />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-sm bg-spk-red/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 sm:w-7 sm:h-7 text-spk-red" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider text-black/55 font-bold"
              style={FONT}
            >
              Panel del club
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight" style={FONT}>
              {clubName || 'TU CLUB'}
            </h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-black/45">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Cargando…
          </div>
        ) : (
          <>
            {/* ── Tab nav (sticky pills) ─────────────────────────── */}
            <TabBar
              active={activeTab}
              onChange={setActiveTab}
              counts={{
                equipos: teams.length,
                inscripcion: openTournaments.length,
              }}
            />

            {/* ── Resumen ─────────────────────────────────────────── */}
            {activeTab === 'resumen' && (
              <>
                {stats && stats.teams > 0 ? (
                  <DashboardStats stats={stats} />
                ) : (
                  <EmptyHint
                    icon={<LayoutDashboard className="w-8 h-8" />}
                    title="Sin datos todavía"
                    body="Cuando tengas equipos inscritos en algún torneo, vas a ver acá el resumen del club."
                  />
                )}
              </>
            )}

            {/* ── Equipos ─────────────────────────────────────────── */}
            {activeTab === 'equipos' && (
              <section className="space-y-3">
                <p className="text-xs text-black/55 leading-relaxed">
                  Tocá un equipo para subir su logo, agregar jugadoras
                  y moverlas entre equipos del mismo club si te
                  inscribieron mal.
                </p>

                {/* Search: only render with 6+ teams so clubs chicos no
                    ven un input innecesario. Mismo umbral que el
                    buscador del TeamRosterCard del admin. */}
                {teams.length >= 6 && (
                  <div className="relative">
                    <Search
                      className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Buscar por nombre, categoría o iniciales…"
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-sm border-2 border-black/10 focus:border-spk-red focus:outline-none bg-white"
                    />
                  </div>
                )}

                {teams.length === 0 ? (
                  <EmptyHint
                    icon={<Users className="w-8 h-8" />}
                    title="Aún no hay equipos asociados a este club"
                    body="El admin del torneo todavía no inscribió equipos a tu nombre, o no fueron asociados al club. Contactá a la organización."
                  />
                ) : filteredTeams.length === 0 ? (
                  <div className="py-6 text-center text-sm text-black/55">
                    Ningún equipo coincide con &ldquo;{teamSearch}&rdquo;.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTeams.map((team) => (
                      <TeamCard
                        key={team.id}
                        team={team}
                        onClick={() => navigate(`/team-panel/${team.id}`)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Inscripción acudientes ─────────────────────────── */}
            {activeTab === 'inscripcion' && (
              <section className="space-y-3">
                <p className="text-xs text-black/55 leading-relaxed">
                  Compartí el link con los papás de tus jugadoras. Llenan
                  los datos y aparecen en el plantel al instante. El
                  link se cierra automáticamente la noche antes del
                  torneo.
                </p>

                {openTournaments.length === 0 ? (
                  <EmptyHint
                    icon={<Share2 className="w-8 h-8" />}
                    title="No hay torneos abiertos por ahora"
                    body="Cuando tengas equipos inscritos en un torneo que todavía no empezó, vas a poder generar el link de inscripción acá."
                  />
                ) : (
                  <ul className="space-y-2">
                    {openTournaments.map((t) => (
                      <li
                        key={t.id}
                        className="bg-white border border-black/10 rounded-sm px-4 py-3 flex items-center gap-3"
                      >
                        {t.logo ? (
                          <img
                            src={t.logo}
                            alt={`Logo ${t.name}`}
                            className="w-10 h-10 rounded-sm object-contain bg-black/5 p-1 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-sm bg-spk-red/10 flex items-center justify-center flex-shrink-0">
                            <Calendar
                              className="w-5 h-5 text-spk-red"
                              aria-hidden="true"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-bold leading-tight truncate"
                            style={FONT}
                          >
                            {t.name}
                          </div>
                          <div className="text-[11px] text-black/55 mt-0.5">
                            {formatDateRange(t.startDate, t.endDate)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveLinkTournament(t)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm text-xs font-bold uppercase transition-colors"
                          style={{ ...FONT, letterSpacing: '0.05em' }}
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          Generar link
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* ── Cronograma — programación publicada por torneo ── */}
            {activeTab === 'cronograma' && (
              <ClubCronogramaSection
                tournaments={tournaments}
                clubTeams={teams}
              />
            )}
          </>
        )}
      </div>

      {activeLinkTournament && (
        <ParentRegistrationLinkModal
          isOpen
          onClose={() => setActiveLinkTournament(null)}
          tournament={activeLinkTournament}
        />
      )}
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────

interface TabBarProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  /**
   * Optional badge counts shown on the pill. Currently only used for
   * the inscripción tab (number of torneos abiertos) since equipos
   * already shows the count inside its own section.
   */
  counts: { equipos: number; inscripcion: number };
}

/**
 * Sticky pill bar — one pill per top-level section. The pill that
 * matches the active tab gets a filled spk-red background; the
 * others are muted. Horizontal scroll on narrow screens so the row
 * stays in a single line on phones; on desktop the pills space out
 * comfortably.
 */
function TabBar({ active, onChange, counts }: TabBarProps) {
  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      key: 'resumen',
      label: 'Resumen',
      icon: <LayoutDashboard className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    {
      key: 'equipos',
      label: 'Equipos',
      icon: <Volleyball className="w-3.5 h-3.5" aria-hidden="true" />,
      badge: counts.equipos,
    },
    {
      key: 'inscripcion',
      label: 'Inscripción',
      icon: <Share2 className="w-3.5 h-3.5" aria-hidden="true" />,
      badge: counts.inscripcion,
    },
    {
      key: 'cronograma',
      label: 'Programación',
      icon: <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />,
    },
  ];

  return (
    <nav
      className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-white/95 backdrop-blur-sm border-b border-black/10"
      aria-label="Secciones del panel del club"
    >
      {/*
        Mobile: 2x2 grid — 4 pills no caben en una sola fila legible
        en pantallas de 360–390px, y el scroll horizontal cortaba el
        último botón. Desktop: una sola fila de 4 pills con la misma
        clase grid (grid-cols-4) para que el ancho lo defina la
        cuadrícula y todos se vean del mismo tamaño.

        Pills más compactos que la versión inicial: px-2 py-1.5,
        texto 11px, icono 3.5×3.5, gap más chico. La idea es que en
        mobile NO consuman la altura útil del primer pliegue.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-sm text-[11px] font-bold uppercase whitespace-nowrap transition-colors min-w-0',
                isActive
                  ? 'bg-spk-red text-white'
                  : 'bg-black/5 text-black/65 hover:bg-black/10',
              ].join(' ')}
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                letterSpacing: '0.05em',
              }}
            >
              <span className="flex-shrink-0">{t.icon}</span>
              <span className="truncate">{t.label}</span>
              {typeof t.badge === 'number' && t.badge > 0 && (
                <span
                  className={[
                    'inline-flex items-center justify-center min-w-[16px] h-[14px] px-1 rounded-sm text-[9px] tabular-nums flex-shrink-0',
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-spk-red/15 text-spk-red',
                  ].join(' ')}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface EmptyHintProps {
  icon: React.ReactNode;
  title: string;
  body: string;
}

/**
 * Generic empty-state card. Used by tabs that have no content yet
 * (e.g. "Resumen" before any team is inscribed) so each tab always
 * renders SOMETHING instead of a blank gap when active.
 */
function EmptyHint({ icon, title, body }: EmptyHintProps) {
  return (
    <div className="border-2 border-dashed border-black/15 rounded-sm p-8 text-center">
      <div className="text-black/25 flex justify-center mb-3" aria-hidden="true">
        {icon}
      </div>
      <p className="text-black/60 mb-1 font-bold" style={FONT}>
        {title}
      </p>
      <p className="text-xs text-black/45 leading-relaxed max-w-sm mx-auto">
        {body}
      </p>
    </div>
  );
}

interface DashboardStatsProps {
  stats: ClubStats;
}

/**
 * 6-up grid of cifras agregadas del club. Used as the dashboard
 * header. The colored accent on each card matches the meaning:
 * red = live (urgent), gold = upcoming (next), black = played
 * (history), blue/green = aggregate counts.
 */
function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <section className="space-y-3">
      <header>
        <h2
          className="text-xs font-bold uppercase text-black/50 border-b border-black/10 pb-1.5"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          Resumen del club
        </h2>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <StatCard
          label="Equipos"
          value={stats.teams}
          icon={<Users className="w-4 h-4" />}
          tone="black"
        />
        <StatCard
          label="Jugadoras"
          value={stats.players}
          icon={<Users className="w-4 h-4" />}
          tone="black"
        />
        <StatCard
          label="Pendientes"
          value={stats.matchesUpcoming}
          icon={<Clock className="w-4 h-4" />}
          tone="gold"
        />
        <StatCard
          label="En vivo"
          value={stats.matchesLive}
          icon={<CircleDot className="w-4 h-4" />}
          tone="red"
          pulse={stats.matchesLive > 0}
        />
        <StatCard
          label="Jugados"
          value={stats.matchesPlayed}
          icon={<Calendar className="w-4 h-4" />}
          tone="black"
        />
        <StatCard
          label="Victorias"
          value={stats.wins}
          icon={<Trophy className="w-4 h-4" />}
          tone="green"
        />
      </div>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'black' | 'red' | 'gold' | 'green';
  pulse?: boolean;
}

function StatCard({ label, value, icon, tone, pulse }: StatCardProps) {
  const toneMap = {
    black: 'bg-white border-black/10 text-black/55',
    red: 'bg-spk-red/5 border-spk-red/20 text-spk-red',
    gold: 'bg-spk-gold/10 border-spk-gold/30 text-spk-gold',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  } as const;
  return (
    <div
      className={`relative border rounded-sm px-3 py-2.5 ${toneMap[tone]}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold opacity-80">
        <span
          className={pulse ? 'animate-pulse' : ''}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span style={{ ...FONT, letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div
        className="text-2xl font-black tabular-nums text-black mt-0.5"
        style={FONT}
      >
        {value}
      </div>
    </div>
  );
}

interface TeamCardProps {
  team: ClubTeamSummary;
  onClick: () => void;
}

/**
 * Team row with the per-team mini-dashboard inline: roster size,
 * matches breakdown, current phase. Click → team panel for the
 * detailed view.
 */
function TeamCard({ team, onClick }: TeamCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-white border border-black/10 rounded-sm px-4 py-3 hover:border-spk-red hover:shadow-md transition-all text-left"
    >
      <div className="flex items-start gap-3">
        <TeamAvatar team={team} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className="font-bold text-base leading-tight truncate"
                style={FONT}
              >
                {team.name}
              </div>
              {team.category && (
                <div className="text-[11px] text-black/55 truncate">
                  {team.category}
                </div>
              )}
            </div>
            <ArrowRight
              className="w-4 h-4 text-black/40 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
          </div>

          {/* Mini dashboard row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]">
            <MiniStat
              icon={<Users className="w-3 h-3" aria-hidden="true" />}
              label="plantel"
              value={team.rosterCount}
            />
            <span className="text-black/15" aria-hidden="true">|</span>
            <MiniStat
              icon={<Clock className="w-3 h-3" aria-hidden="true" />}
              label="pend."
              value={team.matchesUpcoming}
            />
            {team.matchesLive > 0 && (
              <>
                <span className="text-black/15" aria-hidden="true">|</span>
                <MiniStat
                  icon={
                    <CircleDot
                      className="w-3 h-3 text-spk-red animate-pulse"
                      aria-hidden="true"
                    />
                  }
                  label="en vivo"
                  value={team.matchesLive}
                  tone="red"
                />
              </>
            )}
            <span className="text-black/15" aria-hidden="true">|</span>
            <MiniStat
              icon={<Calendar className="w-3 h-3" aria-hidden="true" />}
              label="jugados"
              value={team.matchesPlayed}
            />
            {team.matchesPlayed > 0 && (
              <>
                <span className="text-black/15" aria-hidden="true">|</span>
                <span
                  className="inline-flex items-center gap-1 text-emerald-700"
                  title="Victorias / Derrotas"
                >
                  <Trophy className="w-3 h-3" aria-hidden="true" />
                  <span className="tabular-nums font-bold">
                    {team.wins}
                  </span>
                  <span className="text-black/40">/</span>
                  <span className="tabular-nums">{team.losses}</span>
                </span>
              </>
            )}
          </div>

          {team.currentPhase && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-black/5 rounded-sm">
              <Sparkles
                className="w-3 h-3 text-spk-red"
                aria-hidden="true"
              />
              <span
                className="text-[10px] uppercase font-bold text-black/70 tracking-wider"
                style={FONT}
              >
                Fase: {team.currentPhase}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

interface MiniStatProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'black' | 'red';
}

function MiniStat({ icon, label, value, tone = 'black' }: MiniStatProps) {
  const text = tone === 'red' ? 'text-spk-red' : 'text-black/55';
  return (
    <span className={`inline-flex items-center gap-1 ${text}`}>
      {icon}
      <span className="tabular-nums font-bold text-black/80">{value}</span>
      <span className="text-black/45">{label}</span>
    </span>
  );
}

/**
 * Placeholder for the upcoming "Cronograma del club" — la vista que
 * va a listar cronológicamente todos los partidos del club, con
 * notificaciones push a medida que se ponen en vivo / terminan.
 *
 * Está acá para que el capitán SEPA que la funcionalidad viene en
 * camino y no pregunte por ella. Cuando se libere reemplazamos este
 * bloque con la vista real.
 */
function CronogramaPlaceholder() {
  return (
    <section className="space-y-3">
      <header>
        <h2
          className="text-xs font-bold uppercase text-black/50 border-b border-black/10 pb-1.5"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          Programación del club
        </h2>
      </header>
      <div className="relative overflow-hidden bg-gradient-to-br from-spk-black to-[#1a1a1a] text-white rounded-sm p-5">
        <div
          className="absolute top-0 right-0 w-32 h-32 bg-spk-red/20 rounded-full -translate-y-12 translate-x-12 blur-2xl pointer-events-none"
          aria-hidden="true"
        />
        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 rounded-sm bg-spk-red/20 flex items-center justify-center flex-shrink-0">
            <CalendarDays className="w-5 h-5 text-spk-red" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="text-base font-bold uppercase"
              style={{ ...FONT, letterSpacing: '0.04em' }}
            >
              Próximamente
            </h3>
            <p className="text-sm text-white/75 leading-relaxed mt-1">
              Te vamos a mostrar la programación completa de tus
              equipos en un solo calendario, con resultados en vivo y
              alertas push de cada partido.
            </p>
            <p className="text-[11px] text-white/45 mt-2">
              Apenas esté habilitado, te avisamos por notificación.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDateRange(start: Date, end: Date): string {
  try {
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();
    if (sameMonth) {
      const month = start.toLocaleDateString('es-CO', { month: 'long' });
      return `${start.getDate()}–${end.getDate()} ${month} ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
    })} – ${end.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}`;
  } catch {
    return '';
  }
}
