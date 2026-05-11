import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import type { CreateTeamDto, UpdateTeamDto, UpdateTournamentDto } from '../../services/api';
import {
  Tournament,
  Team,
  Match,
  BracketMatch,
  FixtureResult,
  StandingsRow,
} from '../../types';
import { useData } from '../../context/DataContext';
import { Tabs, TabsContent } from '../../components/ui/tabs';
import { useScoreEditor } from '../../hooks/useScoreEditor';
import { hydrateSetsFromMatch } from '../../lib/scoring';
import {
  tournamentStatusColor,
  tournamentStatusLabel,
} from '../../lib/status';
import { InfoTab } from './tournament-detail/InfoTab';
import { TeamsTab } from './tournament-detail/TeamsTab';
import { FixturesTab } from './tournament-detail/FixturesTab';
import { MatchesTab } from './tournament-detail/MatchesTab';
import { CronogramaTab } from './tournament-detail/CronogramaTab';
import { getErrorMessage } from '../../lib/errors';

const FORMAT_LABELS: Record<string, string> = {
  groups: 'Fase de Grupos',
  knockout: 'Eliminación Directa',
  'groups+knockout': 'Grupos + Eliminación',
  league: 'Liga (Todos contra Todos)',
};

const VALID_TABS = ['info', 'teams', 'fixtures', 'matches', 'cronograma'] as const;
type TabId = (typeof VALID_TABS)[number];

const SECTION_TITLE: Record<TabId, string> = {
  info: 'Ajustes generales',
  teams: 'Inscripción equipos y plantel',
  fixtures: 'Cruces',
  matches: 'Partidos',
  cronograma: 'Cronograma',
};

/**
 * AdminTournamentDetail — orchestrator for the four tournament-detail
 * tabs. Owns the authoritative data slices (tournament, enrolledTeams,
 * matches, bracketMatches, standings) + the two score-editor hook
 * instances, and wires them into each tab component.
 *
 * Each tab renders its own section UI in a file under ./tournament-detail/
 * so this orchestrator stays under the 500-line budget. URL-driven tab
 * state (?tab=…) lets the admin sidebar deep-link into a specific
 * section while keeping the existing /admin/tournaments/:id bookmark.
 */
export function AdminTournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addTeam, updateTeam, updateTournament } = useData();

  // ── Tab routing ─────────────────────────────────────────────────

  const rawTab = searchParams.get('tab');
  const activeTab: TabId = (VALID_TABS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as TabId)
    : 'info';

  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'info') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  // ── Data state ──────────────────────────────────────────────────

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [enrolledTeams, setEnrolledTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [bracketMatches, setBracketMatches] = useState<BracketMatch[]>([]);
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unenrollingId, setUnenrollingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // ── Score editors ───────────────────────────────────────────────

  const matchEditor = useScoreEditor<Match>({
    getId: (m) => m.id,
    getStatus: (m) => m.status,
    getInitialSets: hydrateSetsFromMatch,
    save: async (match, payload) => {
      const updated = await api.updateMatchScore(match.id, {
        scoreTeam1: payload.scoreTeam1,
        scoreTeam2: payload.scoreTeam2,
        status: payload.status as 'live' | 'completed',
        sets: payload.sets,
      });
      setMatches((prev) => prev.map((m) => (m.id === match.id ? updated : m)));
    },
  });

  const bracketEditor = useScoreEditor<BracketMatch>({
    getId: (bm) => bm.id,
    getStatus: (bm) => bm.status,
    getInitialSets: () => [{ team1: 0, team2: 0 }],
    save: async (bm, payload) => {
      if (!id) return;
      const fresh = await api.updateBracketMatch(id, bm.id, payload);
      setBracketMatches(fresh);
    },
    labels: {
      success: 'Marcador de cruce actualizado',
      error: 'Error al actualizar marcador de cruce',
    },
  });

  // ── Data fetch ──────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Load teams first so the api/transformers cache is primed before
      // matches/bracket/standings transformers run. Without this the
      // parallel fetches race and rows would render with the neutral
      // placeholder team (id mismatch in the transformers cache).
      // The api/* getters now also self-prime via ensureTeamsCached(),
      // but doing it explicitly here also gives us `setAllTeams(teams)`.
      const teams = await api.getTeams();

      const [t, enrolled, tournamentMatches, bracket, standingsData] = await Promise.all([
        api.getTournament(id),
        api.getEnrolledTeams(id),
        api.getTournamentMatches(id),
        api.getTournamentBracket(id),
        api.getTournamentStandings(id),
      ]);
      setTournament(t);
      setEnrolledTeams(enrolled);
      setAllTeams(teams);
      setMatches(tournamentMatches);
      setBracketMatches(bracket);
      setStandings(standingsData);
    } catch (err) {
      setError(getErrorMessage(err, 'Error al cargar datos del torneo'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Handlers — tournament ───────────────────────────────────────

  const handleTournamentEditSubmit = async (updated: Tournament) => {
    if (!tournament) return;
    const newStartDate = updated.startDate.toISOString().split('T')[0];
    const newEndDate = updated.endDate.toISOString().split('T')[0];
    // Snapshot old dates BEFORE the update so we can detect a date
    // change and decide whether to trigger the auto-repair below.
    // Both fields are compared as YYYY-MM-DD strings so the comparison
    // is timezone-safe.
    const oldStartDate = tournament.startDate.toISOString().split('T')[0];
    const oldEndDate = tournament.endDate.toISOString().split('T')[0];
    const datesChanged =
      newStartDate !== oldStartDate || newEndDate !== oldEndDate;

    const dto: UpdateTournamentDto = {
      name: updated.name,
      sport: updated.sport,
      club: updated.club,
      startDate: newStartDate,
      endDate: newEndDate,
      description: updated.description,
      coverImage: updated.coverImage,
      logo: updated.logo,
      status: updated.status,
      teamsCount: updated.teamsCount,
      format: updated.format,
      courts: updated.courts,
      courtLocations: updated.courtLocations,
      categories: updated.categories,
      enrollmentDeadline: updated.enrollmentDeadline ?? null,
      playersPerTeam: updated.playersPerTeam,
      bracketMode: updated.bracketMode,
      regulationText: updated.regulationText ?? null,
      regulationPdf: updated.regulationPdf ?? null,
      // Schedule defaults — persist whatever the form holds so the
      // scheduler + repair tool both pick them up on the next run.
      matchDurationMinutes: updated.matchDurationMinutes,
      matchBreakMinutes: updated.matchBreakMinutes,
      dailySchedules: updated.dailySchedules,
      // Schedule constraints (migration 025). Without these three the
      // form values were getting filled in but silently dropped by the
      // DTO — the backend never saw them and the scheduler had nothing
      // to honour.
      maxMatchesPerDay: updated.maxMatchesPerDay,
      deadTimeBlocks: updated.deadTimeBlocks,
      categoryPriority: updated.categoryPriority,
      // Migration 026 — preferred court for semis + finals. Send null
      // to clear the preference; undefined leaves it untouched.
      finalsCourt: updated.finalsCourt ?? null,
    };
    const fresh = await updateTournament(tournament.id, dto);
    setTournament(fresh);
    toast.success('Torneo actualizado');

    // Auto-repair: when the admin shifts the tournament window, run the
    // schedule reparator so any matches that fell outside the new
    // [start, end] range get pulled into a valid slot. Only fires on
    // a real date change so editing the name or club doesn't trigger
    // an extra round-trip. Failures are surfaced via toast but the
    // tournament update itself already succeeded — admin can re-run
    // "Reparar horarios" manually if this auto-pass fails.
    if (datesChanged && id) {
      try {
        const result = await api.repairTournamentConflicts(id);
        if (result.matchesMoved > 0) {
          // Refetch matches so the Partidos tab reflects the new slots
          // without waiting for the user to navigate away and back.
          const freshMatches = await api.getTournamentMatches(id);
          setMatches(freshMatches);
          // Compose the same kind of detailed message the manual
          // button shows so the admin knows exactly what changed.
          const parts: string[] = [];
          if (result.outOfRange > 0) {
            parts.push(`${result.outOfRange} fuera del rango nuevo`);
          }
          if (result.teamConflicts > 0) {
            parts.push(`${result.teamConflicts} con equipo en dos partidos a la vez`);
          }
          if (result.courtConflicts > 0) {
            parts.push(`${result.courtConflicts} con cancha doble`);
          }
          const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
          toast.info(
            `Reagendé ${result.matchesMoved} partido${
              result.matchesMoved === 1 ? '' : 's'
            }${detail}.`,
          );
        }
      } catch (err) {
        toast.warning(
          'Cambié las fechas pero la reparación automática falló. Tocá ' +
            '"Reparar horarios" en la pestaña Partidos para reintentarla.',
        );
        console.warn('[auto-repair] tournament-date repair failed', err);
      }
    }
  };

  const finalizeTournament = async (t: Tournament) => updateTournament(t.id, { status: 'completed' });

  // ── Handlers — teams ────────────────────────────────────────────

  const handleEnroll = async (teamId: string) => {
    if (!id) return;
    try {
      await api.enrollTeam(id, teamId);
      const updated = await api.getEnrolledTeams(id);
      setEnrolledTeams(updated);
      toast.success('Equipo inscrito correctamente');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al inscribir equipo'));
    }
  };

  const handleUnenroll = async (teamId: string) => {
    if (!id) return;
    setUnenrollingId(teamId);
    try {
      await api.unenrollTeam(id, teamId);
      setEnrolledTeams((prev) => prev.filter((t) => t.id !== teamId));
      toast.success('Equipo desinscrito correctamente');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al desinscribir equipo'));
      // Re-throw so the ConfirmDialog in TeamsTab stays open on failure
      // and the admin can retry without having to re-click the trash
      // icon. Mirrors the pattern used by the other confirm handlers
      // (handleDelete in AdminTournaments / AdminMatches / etc.).
      throw err;
    } finally {
      setUnenrollingId(null);
    }
  };

  const handleTeamFormSubmit = async (team: Team, editingTeam: Team | undefined) => {
    if (editingTeam) {
      const dto: UpdateTeamDto = {
        name: team.name,
        initials: team.initials,
        logo: team.logo,
        primaryColor: team.colors.primary,
        secondaryColor: team.colors.secondary,
        city: team.city,
        department: team.department,
        category: team.category,
      };
      const updated = await updateTeam(editingTeam.id, dto);
      setEnrolledTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setAllTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      toast.success('Equipo actualizado');
      return;
    }
    if (!id) return;
    const dto: CreateTeamDto = {
      name: team.name,
      initials: team.initials,
      logo: team.logo,
      primaryColor: team.colors.primary,
      secondaryColor: team.colors.secondary,
      city: team.city,
      department: team.department,
      category: team.category,
    };
    const created = await addTeam(dto);
    await api.enrollTeam(id, created.id);
    const updated = await api.getEnrolledTeams(id);
    setEnrolledTeams(updated);
    setAllTeams((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
    toast.success(`${created.name} creado e inscrito`);
  };

  // ── Handlers — fixtures ─────────────────────────────────────────

  const handleGenerated = (
    result: FixtureResult,
    tournamentMatches: Match[],
    bracket: BracketMatch[],
  ) => {
    setGeneratedAt(result.generatedAt);
    setMatches(tournamentMatches);
    setBracketMatches(bracket);
  };

  const handleBracketUpdated = (bracket: BracketMatch[]) => setBracketMatches(bracket);

  const handleClearFixtures = async () => {
    if (!id) return;
    setClearing(true);
    try {
      await api.clearFixtures(id);
      const [tournamentMatches, bracket] = await Promise.all([
        api.getTournamentMatches(id),
        api.getTournamentBracket(id),
      ]);
      setMatches(tournamentMatches);
      setBracketMatches(bracket);
      setGeneratedAt(null);
      toast.success('Cruces eliminados correctamente');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al limpiar cruces'));
    } finally {
      setClearing(false);
    }
  };

  const handleRecalculateStandings = useCallback(async () => {
    if (!id) return;
    setRecalculating(true);
    try {
      // recalculateStandings rebuilds the standings table and re-resolves
      // bracket placeholders. resolveBracket on top of that triggers the
      // bracket materializer (creates `matches` rows for slots whose two
      // teams just got resolved) and returns a diagnostic snapshot we
      // surface to the admin via toast.
      const [fresh, resolved, freshMatches] = await Promise.all([
        api.recalculateStandings(id),
        api.resolveBracket(id),
        api.getTournamentMatches(id),
      ]);
      setStandings(fresh);
      setBracketMatches(resolved.bracket);
      setMatches(freshMatches);

      const m = resolved.materialize;
      if (m) {
        const touched = m.matchesCreated + m.matchesUpdated;
        if (touched > 0) {
          toast.success(
            `Tabla y cruces actualizados · ${m.matchesCreated} nuevos, ${m.matchesUpdated} ajustados`,
          );
        } else if (m.slotsWithBothTeamsResolved === 0) {
          toast.success(
            `Tabla actualizada · ${m.totalBracketRows} slots de cruces sin equipos definidos todavía`,
          );
        } else {
          toast.success(
            `Tabla y cruces actualizados · ${m.slotsAlreadyMaterialized}/${m.slotsWithBothTeamsResolved} partidos ya existían`,
          );
        }
      } else {
        toast.success('Tabla y cruces actualizados');
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo recalcular la tabla'));
    } finally {
      setRecalculating(false);
    }
  }, [id]);

  // ── Loading / error ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="p-6 text-center py-16">
        <p className="text-red-600 mb-4">{error || 'Torneo no encontrado'}</p>
        <button
          onClick={() => navigate('/admin/tournaments')}
          className="px-4 py-2 bg-spk-red text-white rounded-sm hover:bg-spk-red-dark transition-colors"
        >
          Volver a Torneos
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1
          className="text-lg sm:text-xl font-bold uppercase tracking-wider text-black/80"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
        >
          {SECTION_TITLE[activeTab]}
        </h1>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-black/50">
          <span className="font-medium">Copa {tournament.name}</span>
          <span className="text-black/20">·</span>
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${tournamentStatusColor(tournament.status)}`}
          >
            {tournamentStatusLabel(tournament.status)}
          </span>
          <span className="text-black/20">·</span>
          <span>{FORMAT_LABELS[tournament.format] || tournament.format}</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsContent value="info">
          <InfoTab
            tournament={tournament}
            onSubmit={handleTournamentEditSubmit}
            onFinalize={finalizeTournament}
            onFinalized={(fresh) => setTournament(fresh)}
          />
        </TabsContent>

        <TabsContent value="teams">
          <TeamsTab
            tournament={tournament}
            enrolledTeams={enrolledTeams}
            unenrollingId={unenrollingId}
            onEnroll={handleEnroll}
            onUnenroll={handleUnenroll}
            onTeamFormSubmit={handleTeamFormSubmit}
          />
        </TabsContent>

        <TabsContent value="fixtures">
          <FixturesTab
            tournament={tournament}
            enrolledTeams={enrolledTeams}
            matches={matches}
            bracketMatches={bracketMatches}
            standings={standings}
            generatedAt={generatedAt}
            clearing={clearing}
            recalculating={recalculating}
            bracketEditor={bracketEditor}
            onGenerated={handleGenerated}
            onBracketUpdated={handleBracketUpdated}
            onClear={handleClearFixtures}
            onRecalculateStandings={handleRecalculateStandings}
          />
        </TabsContent>

        <TabsContent value="matches">
          <MatchesTab
            matches={matches}
            tournamentId={id}
            editor={matchEditor}
            onMatchUpdated={(updated) =>
              setMatches((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            }
            // Used by the "Reparar horarios" button after a bulk reshuffle
            // — replaces the entire matches list so the new (date, time,
            // court) for each moved match shows up without a page reload.
            onMatchesReplaced={(fresh) => setMatches(fresh)}
          />
        </TabsContent>

        <TabsContent value="cronograma">
          {tournament && (
            <CronogramaTab
              tournament={tournament}
              matches={matches}
              // Optimistic update from the drag-and-drop swap/move so
              // the grid reflects the new slot without re-fetching.
              onMatchesPatched={(patched) => {
                setMatches((prev) => {
                  const byId = new Map(patched.map((m) => [m.id, m]));
                  return prev.map((m) => byId.get(m.id) ?? m);
                });
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
