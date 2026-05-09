import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Shuffle, Trophy, Clock, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../../services/api';
import {
  Tournament,
  Team,
  Match,
  BracketMatch,
  FixtureResult,
  StandingsRow,
} from '../../../types';
import { Button } from '../../../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import {
  CategoryPickerDialog,
  ManualGroupsModal,
  ManualBracketModal,
  BracketCrossingsModal,
  ManualBracketCrossingsModal,
  type ScheduleConfig,
} from '../../../components/admin/ManualFixtureModal';
import type { BracketTier } from '../../../lib/phase';
import type { useScoreEditor } from '../../../hooks/useScoreEditor';
import { GroupMatricesByCategory } from './fixtures/GroupsView';
import { BracketByCategory } from './fixtures/BracketView';
import { useCategoryFlow } from './fixtures/useCategoryFlow';
import { useFixturesDerived } from './fixtures/useFixturesDerived';
import { getErrorMessage } from '../../../lib/errors';

type BracketEditor = ReturnType<typeof useScoreEditor<BracketMatch>>;

interface FixturesTabProps {
  tournament: Tournament;
  enrolledTeams: Team[];
  matches: Match[];
  bracketMatches: BracketMatch[];
  standings: StandingsRow[];
  generatedAt: string | null;
  clearing: boolean;
  recalculating: boolean;
  bracketEditor: BracketEditor;
  /**
   * Called after a successful fixture-generation round-trip so the
   * parent can patch its matches + bracket + generatedAt slices in
   * one shot. The tab itself doesn't own the authoritative copies.
   */
  onGenerated: (result: FixtureResult, matches: Match[], bracket: BracketMatch[]) => void;
  /** Patch only the bracket slice (post-groups crossings flow). */
  onBracketUpdated: (bracket: BracketMatch[]) => void;
  onClear: () => Promise<void>;
  onRecalculateStandings: () => Promise<void>;
}

/**
 * Cruces tab — "generate fixtures" action bar, group matrices per
 * category, per-phase/group match lists, and the bracket view with
 * inline score editor. Owns modal-open state internally but delegates
 * all network calls back to the parent so the single source of truth
 * stays with the orchestrator.
 */
export function FixturesTab({
  tournament,
  enrolledTeams,
  matches,
  bracketMatches,
  standings,
  generatedAt,
  clearing,
  recalculating,
  bracketEditor,
  onGenerated,
  onBracketUpdated,
  onClear,
  onRecalculateStandings,
}: FixturesTabProps) {
  const { id } = tournament;

  // Modal open state — purely local UX. The actual work happens in
  // the async handlers below which bubble results up to the parent.
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showManualGroups, setShowManualGroups] = useState(false);
  const [showManualBracket, setShowManualBracket] = useState(false);
  const [showBracketCrossings, setShowBracketCrossings] = useState(false);
  const [showManualCrossings, setShowManualCrossings] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  // Tier for the currently-open BracketCrossingsModal when the tournament
  // runs in division mode: `'gold'` during the first step, `'silver'`
  // during the second, `null` while the modal isn't open / the tournament
  // runs in manual mode.
  const [currentTier, setCurrentTier] = useState<BracketTier | null>(null);
  // Starting group-placement offered by the Plata step. Derived from
  // the max position used when generating Oro — if Oro took 1° y 2°,
  // Plata starts at 3°. Parsed from the seed labels
  // (`"pos|groupName"`) that went to the backend.
  const [silverStartPosition, setSilverStartPosition] = useState(3);

  /** Tournament-level bracket strategy — chosen on creation. Drives which
   *  modal opens for "Definir Eliminación Directa". Defaults to 'manual'
   *  so legacy tournaments without the field keep their old behavior. */
  const bracketMode: 'manual' | 'divisions' = tournament.bracketMode ?? 'manual';
  // True while any generate-round-trip is in flight — drives disable
  // state on every "Generar" button so the admin can't double-submit.
  const [generating, setGenerating] = useState(false);

  // Picker state + per-category filtering lives in a dedicated hook so
  // FixturesTab keeps its orchestration-only shape.
  const flow = useCategoryFlow({ tournament, enrolledTeams, matches });

  // Derived collections consumed by the render block.
  const { groupNames, matchesByGroup, standingsByGroup } = useFixturesDerived({
    matches,
    standings,
  });

  // ── Handlers ────────────────────────────────────────────────────

  const refreshAfterGenerate = async (result: FixtureResult) => {
    const [tournamentMatches, bracket] = await Promise.all([
      api.getTournamentMatches(id),
      api.getTournamentBracket(id),
    ]);
    onGenerated(result, tournamentMatches, bracket);
  };

  /**
   * Dispatch the right manual modal once a category is resolved.
   * Knockout format goes straight to bracket seeding; everything else
   * starts with manual groups.
   */
  const openManualModal = () => {
    if (tournament.format === 'knockout') {
      setShowManualBracket(true);
    } else {
      setShowManualGroups(true);
    }
  };

  /**
   * Entry point for "Creación de Grupos". Auto-generation was removed —
   * every flow is manual, scoped per-category.
   *
   *   · Existing fixtures → confirm regenerate first.
   *   · 2+ categories     → open the picker via the flow hook.
   *   · 1 (or none)       → the hook resolves immediately and we jump
   *                         straight into the manual modal.
   */
  const handleGenerateClick = () => {
    if (matches.length > 0 || bracketMatches.length > 0) {
      setShowRegenerateDialog(true);
      return;
    }
    const resolved = flow.openInitialFlow();
    if (resolved !== null) openManualModal();
  };

  /**
   * "Definir Eliminación Directa" button — post-groups bracket flow.
   * The crossings strategy is decided at tournament creation
   * (`tournament.bracketMode`), so there's no per-generation picker
   * anymore:
   *   · 'manual'    → open the drag-pairs {@link ManualBracketCrossingsModal}.
   *   · 'divisions' → open the auto VNL {@link BracketCrossingsModal}
   *                   pre-tagged with `tier='gold'`; after a successful
   *                   Oro generate the handler re-opens it with
   *                   `tier='silver'` until both tiers are persisted.
   */
  const startPostGroupsCrossings = () => {
    const resolved = flow.openPostGroupsFlow();
    if (resolved !== null) openCrossingsModal();
  };

  const handlePickCategory = (category: string) => {
    const target = flow.pick(category);
    if (target === 'post-groups') {
      openCrossingsModal();
    } else {
      openManualModal();
    }
  };

  /** Route the post-groups flow to the right modal based on the
   *  tournament-level bracket mode. */
  const openCrossingsModal = () => {
    if (bracketMode === 'divisions') {
      setCurrentTier('gold');
      setShowBracketCrossings(true);
    } else {
      setCurrentTier(null);
      setShowManualCrossings(true);
    }
  };

  /**
   * Persist the groups the admin drew for the picked category. The
   * backend auto-creates an empty bracket shape for `groups+knockout`
   * but WITHOUT placeholders — the admin defines crossings later via
   * "Definir Eliminación Directa", which is a separate conscious step.
   */
  const handleManualGroupsGenerate = async (
    groups: Record<string, string[]>,
    schedule: ScheduleConfig,
  ) => {
    setGenerating(true);
    try {
      const result = await api.generateManualFixtures(id, {
        groups,
        schedule,
        categoryFilter: flow.pickedCategory ?? undefined,
      });
      await refreshAfterGenerate(result);
      setShowManualGroups(false);
      toast.success('Grupos generados');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al generar grupos'));
    } finally {
      setGenerating(false);
    }
  };

  const handleManualBracketGenerate = async (
    seeds: Array<{ position: number; teamId: string | null; label?: string }>,
  ) => {
    setGenerating(true);
    try {
      const result = await api.generateManualFixtures(id, {
        bracketSeeds: seeds,
        categoryFilter: flow.pickedCategory ?? undefined,
      });
      await refreshAfterGenerate(result);
      setShowManualBracket(false);
      toast.success('Cruces generados');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al generar cruces'));
    } finally {
      setGenerating(false);
    }
  };

  const handlePostGroupsBracketCrossings = async (
    seeds: Array<{ position: number; label: string }>,
  ) => {
    setGenerating(true);
    try {
      const bracket = await api.generateBracketCrossings(id, seeds, {
        categoryFilter: flow.pickedCategory ?? undefined,
        bracketTier: currentTier ?? undefined,
      });
      onBracketUpdated(bracket);
      // Division flow: after finishing Oro, re-open the modal for Plata.
      // After Plata (or the single-bracket flow), close and reset.
      if (bracketMode === 'divisions' && currentTier === 'gold') {
        // Parse seed labels ("pos|groupName") to find the highest group
        // placement Oro consumed. Plata starts right after — e.g. if
        // Oro took 1° y 2°, Plata begins at 3°.
        let maxGoldPosition = 0;
        for (const s of seeds) {
          const firstPipe = s.label.indexOf('|');
          if (firstPipe === -1) continue;
          const pos = parseInt(s.label.substring(0, firstPipe), 10);
          if (!Number.isNaN(pos) && pos > maxGoldPosition) maxGoldPosition = pos;
        }
        setSilverStartPosition(maxGoldPosition > 0 ? maxGoldPosition + 1 : 3);
        toast.success('Cruce Oro generado. Ahora definí el cruce Plata.');
        setCurrentTier('silver');
        // Keep the modal open — swapping `tier` re-renders the header/
        // button but `useEffect` inside the modal resets the matchups
        // when `matchCount` or `startPosition` changes.
        return;
      }
      setShowBracketCrossings(false);
      setShowManualCrossings(false);
      setCurrentTier(null);
      setSilverStartPosition(3);
      toast.success(
        currentTier === 'silver'
          ? `Cruce Plata generado con ${bracket.filter((b) => b.round.includes('|silver|')).length} partidos`
          : `Cruces generados con ${bracket.length} partidos`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al generar cruces'));
    } finally {
      setGenerating(false);
    }
  };

  const handleClearClick = async () => {
    setShowClearDialog(false);
    await onClear();
  };

  return (
    <>
      {/* Action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          {generatedAt && (
            <div className="flex items-center gap-2 text-sm text-black/60">
              <Clock className="w-4 h-4" />
              <span>Generados: {new Date(generatedAt).toLocaleString('es-CO')}</span>
            </div>
          )}
          {!generatedAt && matches.length > 0 && (
            <p className="text-sm text-black/60">{matches.length} partidos generados</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-wrap">
          <Button
            onClick={handleGenerateClick}
            disabled={generating || enrolledTeams.length < 2}
            className="bg-spk-blue hover:bg-spk-blue/90 w-full sm:w-auto"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Shuffle className="w-4 h-4" />
            )}
            Creación de Grupos
          </Button>
          {tournament.format === 'groups+knockout' &&
            matches.length > 0 &&
            bracketMode === 'manual' && (
              <Button
                onClick={startPostGroupsCrossings}
                disabled={generating}
                className="bg-spk-win hover:bg-spk-win/90 text-white w-full sm:w-auto"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trophy className="w-4 h-4" />
                )}
                Definir Eliminación Directa
              </Button>
            )}
          {tournament.format === 'groups+knockout' &&
            matches.length > 0 &&
            bracketMode === 'divisions' && (
              <div
                className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-sm text-xs text-amber-800 w-full sm:w-auto"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                title="El cruce Oro + Plata se genera solo cuando todos los grupos de la categoría terminan."
              >
                <Trophy className="w-4 h-4 flex-shrink-0" />
                <span className="font-semibold uppercase tracking-wider">
                  Cruces por divisiones
                </span>
                <span className="text-amber-700/80">
                  · se genera automático al terminar los grupos
                </span>
              </div>
            )}
          {(matches.length > 0 || bracketMatches.length > 0) && (
            <Button
              onClick={onRecalculateStandings}
              disabled={recalculating}
              variant="outline"
              className="border-spk-blue text-spk-blue hover:bg-spk-blue/10 w-full sm:w-auto"
              title="Fuerza un recálculo de la tabla con la lógica actual"
            >
              {recalculating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Recalcular Tabla y Cruces
            </Button>
          )}
          {(matches.length > 0 || bracketMatches.length > 0) && (
            <Button
              onClick={() => setShowClearDialog(true)}
              disabled={clearing}
              variant="outline"
              className="border-spk-red text-spk-red hover:bg-spk-red/10 w-full sm:w-auto"
            >
              {clearing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Limpiar Cruces
            </Button>
          )}
        </div>
      </div>

      {/* Content — two top-level sections mirror the public layout:
          "Grupos" lists the round-robin matrices per category, "Brackets"
          lists the knockout per category (with Oro/Plata when present).
          Enfrentamientos individuales viven en la tab Partidos. */}
      {matches.length === 0 && bracketMatches.length === 0 ? (
        <div className="text-center py-12">
          <Trophy className="w-12 h-12 text-black/20 mx-auto mb-3" />
          <p className="text-black/60">No hay cruces generados</p>
          <p className="text-sm text-black/40 mt-1">
            Inscribe equipos y presioná "Creación de Grupos"
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupNames.length > 0 && (
            <section>
              <SectionHeader title="Grupos" />
              <GroupMatricesByCategory
                groupNames={groupNames}
                matchesByGroup={matchesByGroup}
                standingsByGroup={standingsByGroup}
              />
            </section>
          )}

          {bracketMatches.length > 0 && (
            <section>
              <SectionHeader title="Cruces" />
              <BracketByCategory bracketMatches={bracketMatches} editor={bracketEditor} />
            </section>
          )}
        </div>
      )}

      {/* Regenerate confirmation — deja claro que el próximo paso
          pregunta la categoría y el alcance se limita a ella. */}
      <AlertDialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Regenerar grupos?</AlertDialogTitle>
            <AlertDialogDescription>
              A continuación elegís la categoría cuyos grupos querés regenerar. Se reemplazan los
              grupos y resultados de esa categoría; las demás categorías y los cruces no se tocan.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRegenerateDialog(false);
                const resolved = flow.openInitialFlow();
                if (resolved !== null) openManualModal();
              }}
              className="bg-spk-red hover:bg-spk-red-dark"
            >
              Elegir categoría
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear fixtures confirmation */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Limpiar cruces?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán todos los cruces, resultados y clasificaciones de este torneo. Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearClick} className="bg-spk-red hover:bg-spk-red-dark">
              Limpiar Cruces
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CategoryPickerDialog
        open={flow.showPicker}
        categories={flow.pickerCategories}
        enrolledTeams={enrolledTeams}
        onClose={flow.closePicker}
        onPick={handlePickCategory}
      />

      <ManualGroupsModal
        open={showManualGroups}
        teams={flow.teamsForPickedCategory}
        onClose={() => setShowManualGroups(false)}
        onGenerate={handleManualGroupsGenerate}
        generating={generating}
        defaultCourtCount={tournament.courts.length || 1}
        availableCourts={tournament.courts}
      />

      <ManualBracketModal
        open={showManualBracket}
        teams={flow.teamsForPickedCategory}
        onClose={() => setShowManualBracket(false)}
        onGenerate={handleManualBracketGenerate}
        generating={generating}
      />

      <BracketCrossingsModal
        open={showBracketCrossings}
        groupNames={flow.groupNamesForPickedCategory}
        onClose={() => {
          setShowBracketCrossings(false);
          setCurrentTier(null);
          setSilverStartPosition(3);
        }}
        onGenerate={handlePostGroupsBracketCrossings}
        generating={generating}
        tier={currentTier}
        startPosition={currentTier === 'silver' ? silverStartPosition : 1}
      />

      <ManualBracketCrossingsModal
        open={showManualCrossings}
        groupNames={flow.groupNamesForPickedCategory}
        onClose={() => {
          setShowManualCrossings(false);
          setCurrentTier(null);
        }}
        onGenerate={handlePostGroupsBracketCrossings}
        generating={generating}
      />
    </>
  );
}

/**
 * Subtle section heading for "Grupos" and "Brackets". Kept low-weight
 * so the real visual hierarchy belongs to the category accordions
 * underneath — the section name is just a navigational marker.
 */
function SectionHeader({ title }: { title: string }) {
  return (
    <h2
      className="text-xs font-semibold uppercase text-black/50 mb-2 tracking-wider pb-1.5 border-b border-black/10"
      style={{
        fontFamily: 'Barlow Condensed, sans-serif',
        letterSpacing: '0.12em',
      }}
    >
      {title}
    </h2>
  );
}

