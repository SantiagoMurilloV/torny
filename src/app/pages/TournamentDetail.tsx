import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { RefreshCw, Trophy, ArrowLeft } from 'lucide-react';
import { useTournamentData } from './tournament-detail/useTournamentData';
import { Header } from './tournament-detail/Header';
import { Hero } from './tournament-detail/Hero';
import { SponsorsCarousel } from './tournament-detail/SponsorsCarousel';
import { TabNav } from './tournament-detail/TabNav';
import { Footer } from './tournament-detail/Footer';
import { TeamsTab } from './tournament-detail/tabs/TeamsTab';
import { GruposTab } from './tournament-detail/tabs/GruposTab';
import { MatchesTab } from './tournament-detail/tabs/MatchesTab';
import { StandingsTab } from './tournament-detail/tabs/StandingsTab';
import { BracketTab } from './tournament-detail/tabs/BracketTab';
import { InfoTab } from './tournament-detail/tabs/InfoTab';
import { CronogramaTab } from './tournament-detail/tabs/CronogramaTab';
import type { TabDescriptor, TabId } from './tournament-detail/tabs/types';
import { NotificationPrompt } from '../components/NotificationPrompt';

/**
 * Public tournament-detail page. Orchestrates the data hook + 5 tab
 * components split out under ./tournament-detail/. Owns only:
 *   · active tab + follow toggle (UI state)
 *   · early-return loading / error / not-found screens
 *
 * Every visual piece (header, hero, tabs, footer) is in its own file
 * so this orchestrator stays under ~150 lines.
 */
export function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Default to the cronograma — spectators land directly on the
  // day's schedule. Hits "today" if it's inside the tournament range,
  // otherwise the start date (handled inside CronogramaTab).
  const [activeTab, setActiveTab] = useState<TabId>('cronograma');

  const {
    tournament,
    matches,
    standings,
    bracket,
    enrolledTeams,
    loading,
    error,
    reload,
    lastRefreshedAt,
  } = useTournamentData(id);

  if (loading) {
    return <TournamentDetailSkeleton onBack={() => navigate('/')} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <div className="text-5xl mb-6">⚠️</div>
          <p
            className="text-2xl font-bold mb-2"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            ERROR AL CARGAR TORNEO
          </p>
          <p className="text-black/60 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => reload()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white font-bold hover:bg-black/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-black/10 text-black font-bold hover:bg-black/20 transition-colors"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white">
        <div className="text-center">
          <p
            className="text-2xl font-bold mb-4"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            TORNEO NO ENCONTRADO
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-white text-black rounded-sm font-bold hover:bg-white/90 transition-colors"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const tabs: TabDescriptor[] = [
    // Cronograma is the entry point — spectators see the day's
    // schedule the moment they open the tournament. Counter shows the
    // total scheduled across all days so they know the size at a glance.
    { id: 'cronograma', label: 'Programación', count: matches.length },
    {
      id: 'teams',
      label: 'Equipos',
      count: standings.length || enrolledTeams.length || tournament.teamsCount,
    },
    { id: 'grupos', label: 'Grupos', count: standings.length },
    { id: 'matches', label: 'Partidos', count: matches.length },
    { id: 'standings', label: 'Clasificación', count: standings.length },
    { id: 'bracket', label: 'Cruces' },
    { id: 'info', label: 'Info' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Header tournamentName={tournament.name} tournamentId={tournament.id} />

      <Hero
        tournament={tournament}
        matchesCount={matches.length}
        enrolledCount={enrolledTeams.length}
      />

      {/* Sponsors marquee — lives at the page layer (not inside any
          tab) so it stays visible while the visitor switches between
          Programación / Equipos / Cruces / Info. Auto-hides when
          the torneo has zero sponsors so the white strip doesn't
          show on tournaments without curated logos.
          The admin tunes the loop speed from Patrocinadores tab
          (mig 034); we forward `sponsorsSpeedSeconds` as the
          override and the component falls back to its algorithmic
          default when the field is null. */}
      <SponsorsCarousel
        tournamentId={tournament.id}
        speedSeconds={tournament.sponsorsSpeedSeconds ?? null}
      />

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-12 md:py-20">
        {activeTab === 'cronograma' && (
          <CronogramaTab tournament={tournament} matches={matches} />
        )}
        {activeTab === 'teams' && (
          <TeamsTab standings={standings} enrolledTeams={enrolledTeams} />
        )}
        {activeTab === 'grupos' && <GruposTab matches={matches} standings={standings} />}
        {activeTab === 'matches' && (
          <MatchesTab matches={matches} tournament={tournament} />
        )}
        {activeTab === 'standings' && (
          <StandingsTab
            matches={matches}
            standings={standings}
            bracketMode={tournament.bracketMode}
            lastRefreshedAt={lastRefreshedAt}
          />
        )}
        {activeTab === 'bracket' && (
          <BracketTab bracketMatches={bracket} lastRefreshedAt={lastRefreshedAt} />
        )}
        {activeTab === 'info' && (
          <InfoTab
            tournament={tournament}
            enrolledCount={enrolledTeams.length}
            matchesCount={matches.length}
          />
        )}
      </div>

      <Footer />

      {/* Per-tournament notification prompt — only asks for THIS tournament (mig 039) */}
      <NotificationPrompt
        tournamentId={tournament.id}
        tournamentName={tournament.name}
      />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

/**
 * Branded loading shell for the public tournament detail. Renders the
 * fixed header (with logo + back button) and a dark hero placeholder
 * with shimmering skeletons in the same shape as the real Hero so the
 * page never flashes plain white while data loads — important on
 * slow LTE / cold-PWA boots where useTournamentData can take 1-2s.
 */
function TournamentDetailSkeleton({ onBack }: { onBack: () => void }) {
  const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Fixed header — mirrors Header.tsx so the chrome stays consistent */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12">
          <div className="flex items-center justify-between gap-2 h-16">
            <div className="flex items-center gap-3 sm:gap-6 min-w-0">
              <button
                type="button"
                onClick={onBack}
                aria-label="Volver al inicio"
                className="text-white/70 hover:text-white transition-colors flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="w-8 h-8 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
                  <Trophy className="w-4 h-4 text-black" />
                </div>
                <h1
                  className="text-base sm:text-lg md:text-xl font-bold tracking-tighter leading-none text-white truncate"
                  style={FONT}
                >
                  Torn<span className="text-spk-red">y</span>
                </h1>
              </div>
            </div>
            <div
              className="h-8 w-20 sm:w-24 rounded-sm bg-white/10 animate-pulse"
              aria-hidden="true"
            />
          </div>
        </div>
      </header>

      {/* Dark hero placeholder — gradient + skeletons in the same vertical
          rhythm as the real Hero so swap-in feels seamless. */}
      <section className="relative overflow-hidden bg-gradient-to-b from-black via-black to-spk-black pt-24 sm:pt-28 md:pt-32 pb-10 sm:pb-12 md:pb-16 md:min-h-[70vh] md:flex md:items-center">
        {/* Diagonal red pattern, faint, for brand presence */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #E31E24 0 20px, transparent 20px 40px)',
          }}
        />
        <div className="relative z-10 max-w-[1600px] mx-auto w-full px-4 sm:px-6 md:px-12">
          <div className="max-w-4xl space-y-4 sm:space-y-6">
            {/* Status badge skeleton */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-sm animate-pulse">
              <div className="w-2 h-2 rounded-full bg-spk-red/60" />
              <div className="h-3 w-24 bg-white/15 rounded" />
            </div>
            {/* Title skeleton — two stacked bars */}
            <div className="space-y-3 animate-pulse">
              <div className="h-9 sm:h-14 md:h-20 w-3/4 bg-white/10 rounded" />
              <div className="h-9 sm:h-14 md:h-20 w-1/2 bg-white/10 rounded" />
            </div>
            {/* Description skeleton */}
            <div className="space-y-2 animate-pulse">
              <div className="h-3 sm:h-4 w-full max-w-md bg-white/8 rounded" />
              <div className="h-3 sm:h-4 w-2/3 max-w-sm bg-white/8 rounded" />
            </div>
            {/* Stats skeleton — 2x2 on phones, row of 4 on sm+ */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-4 sm:gap-8 md:gap-12 pt-2 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-7 sm:h-10 md:h-12 w-12 sm:w-16 md:w-20 bg-white/12 rounded" />
                  <div className="h-2.5 sm:h-3 w-14 sm:w-20 bg-white/8 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tabs nav skeleton — sticky white strip below the hero */}
      <div className="sticky top-16 z-40 bg-white border-b border-black/10">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex gap-6 px-4 sm:px-6 md:px-12 py-3 sm:py-4 overflow-x-auto hide-scrollbar">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-3.5 sm:h-4 w-16 sm:w-20 bg-black/8 rounded animate-pulse flex-shrink-0"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content area — light cards on white so the transition into the
          real tab content doesn't pop. */}
      <div className="bg-white">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12 py-8 sm:py-12">
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-28 sm:h-32 bg-black/5 rounded-sm animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
