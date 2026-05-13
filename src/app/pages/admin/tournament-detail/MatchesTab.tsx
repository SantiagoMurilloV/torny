import { useState, useMemo } from 'react';
import { Trophy, Filter, Edit, MapPin, Pencil, Search, X, Wrench, Loader2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { toast } from 'sonner';
import { Match, Tournament } from '../../../types';
import { Badge } from '../../../components/ui/badge';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { CategorySection } from '../../../components/admin/CategorySection';
import { ScoreSetsEditor } from '../../../components/admin/ScoreSetsEditor';
import { MatchFormModal } from '../../../components/admin/MatchFormModal';
import { TeamAvatar } from '../../../components/TeamAvatar';
import { api, type UpdateMatchDto } from '../../../services/api';
import { categoryOfMatchPhase } from '../../../lib/phase';
import { matchStatusLabel } from '../../../lib/status';
import { formatShortDate } from '../../../lib/format';
import { getErrorMessage } from '../../../lib/errors';
import { getMatchDurationMinutes, getMatchEndTime } from '../../../lib/matchDuration';
import type { useScoreEditor } from '../../../hooks/useScoreEditor';

type ScoreEditor = ReturnType<typeof useScoreEditor<Match>>;

interface MatchesTabProps {
  matches: Match[];
  /** Tournament whose matches are being shown — needed by the repair-
   *  conflicts call which is tournament-scoped. Falls back to
   *  matches[0]?.tournamentId when not supplied so older callers don't
   *  break. */
  tournamentId?: string;
  /** Tournament object — drives the per-card "expected duration" badge.
   *  Optional so the tab still renders before the tournament loads. */
  tournament?: Tournament;
  /** Shared editor hook instance from the parent (so state persists
   *  across tab switches and stays in sync with other surfaces). */
  editor: ScoreEditor;
  /** Patch a match in the parent state after the metadata-edit modal
   *  saves successfully — keeps the list in sync without re-fetching. */
  onMatchUpdated?: (match: Match) => void;
  /** Replace the entire matches list in the parent — fired after a
   *  repair-conflicts run reshuffles many matches at once so the UI
   *  reflects the new schedule without a full page reload. */
  onMatchesReplaced?: (matches: Match[]) => void;
}

/**
 * Partidos tab — filters + live-first grouped list with inline editor.
 * Owns its own filter state since no other tab reads it; gets the
 * score-editor from the parent because it's shared with the Cruces
 * tab.
 */
export function MatchesTab({
  matches,
  tournamentId,
  tournament,
  editor,
  onMatchUpdated,
  onMatchesReplaced,
}: MatchesTabProps) {
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Free-text search across both teams in each match. Matches the
  // accent-tolerant pattern used in TeamsTab (Bogota → Bogotá, Anez →
  // Áñez) so admins typing fast on mobile still hit results.
  const [search, setSearch] = useState<string>('');
  const [editingMatch, setEditingMatch] = useState<Match | undefined>();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  // Repair-conflicts dialog + in-flight state. Kept here (not the parent)
  // because the trigger lives in the toolbar of this tab — the parent
  // only needs to know about the result via onMatchesReplaced.
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const effectiveTournamentId = tournamentId ?? matches[0]?.tournamentId;

  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const openEditModal = (m: Match) => {
    setEditingMatch(m);
    setIsEditModalOpen(true);
  };
  const closeEditModal = () => {
    setIsEditModalOpen(false);
  };

  /**
   * Detect + auto-reschedule team double-bookings. The button only kicks
   * off after the admin confirms in the dialog. On success we re-fetch
   * the tournament's matches so the UI reflects the new slots; on a
   * "no conflicts found" response we still toast a friendly nothing-to-do
   * message so the admin knows the click was acknowledged.
   */
  const handleRepairConfirm = async () => {
    if (!effectiveTournamentId) {
      toast.error('No se pudo determinar el torneo');
      return;
    }
    setRepairing(true);
    try {
      const result = await api.repairTournamentConflicts(effectiveTournamentId);
      // Mirror the backend's debug snapshot in the dev console so the
      // admin can verify what window the repair ran against. Useful when
      // toast says "todo en orden" but the matches list still shows
      // out-of-range dates — usually points at a date-format mismatch.
      // eslint-disable-next-line no-console
      console.info('[repair] result', result);
      if (result.conflictsDetected === 0) {
        const d = result.debug;
        toast.success(
          `No se encontraron conflictos. Ventana ${d.tournamentStart} a ${d.tournamentEnd}, ` +
            `${d.totalMatches} partidos entre ${d.earliestMatchDate ?? '—'} y ${d.latestMatchDate ?? '—'}.`,
        );
      } else {
        const fresh = await api.getTournamentMatches(effectiveTournamentId);
        onMatchesReplaced?.(fresh);
        const moved = result.matchesMoved;
        // Compose a sentence that names every problem found ("X por
        // conflicto de equipo, Y por cancha doble, Z fuera del rango")
        // so the admin understands not just THAT something moved but
        // WHAT was wrong. Each sub-total is listed only when > 0.
        const parts: string[] = [];
        if (result.teamConflicts > 0) {
          parts.push(
            `${result.teamConflicts} con equipo en dos partidos a la vez`,
          );
        }
        if (result.courtConflicts > 0) {
          parts.push(
            `${result.courtConflicts} con cancha doble`,
          );
        }
        if (result.outOfRange > 0) {
          parts.push(
            `${result.outOfRange} fuera del rango del torneo`,
          );
        }
        if (result.priorityReordered > 0) {
          parts.push(
            `${result.priorityReordered} reordenad${result.priorityReordered === 1 ? 'o' : 'os'} por prioridad de categoría`,
          );
        }
        const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        const tail =
          result.unresolved > 0
            ? `. Quedaron ${result.unresolved} sin slot disponible — revisalos a mano.`
            : '.';
        toast.success(
          `Reagendé ${moved} partido${moved === 1 ? '' : 's'}${detail}${tail}`,
        );
      }
      setRepairConfirmOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al reparar horarios'));
      throw err; // keep dialog open so the admin can retry
    } finally {
      setRepairing(false);
    }
  };

  // The MatchFormModal calls onSubmit with a fresh Match payload — we
  // translate that into the wire DTO and PUT /matches/:id. Throws on
  // failure so the modal keeps itself open and shows the error.
  const handleEditSubmit = async (m: Match) => {
    if (!editingMatch) return;
    // For unresolved bracket slots, `m.team1.id` / `m.team2.id` carry
    // the empty-string placeholder (resolveTeam(null)). Forwarding
    // those as real ids would make the backend's `SELECT id FROM
    // teams WHERE id = ''` return zero rows and reject the edit with
    // "Equipo 1 no encontrado". Omitting the field keeps the
    // server-side team_id as NULL — exactly what an unresolved slot
    // needs while the admin is only reprogramming date / time / court.
    const dto: UpdateMatchDto = {
      tournamentId: m.tournamentId,
      ...(m.team1.id ? { team1Id: m.team1.id } : {}),
      ...(m.team2.id ? { team2Id: m.team2.id } : {}),
      date: m.date.toISOString().split('T')[0],
      time: m.time,
      court: m.court,
      referee: m.referee,
      status: m.status,
      phase: m.phase,
      groupName: m.group,
      scoreTeam1: m.score?.team1,
      scoreTeam2: m.score?.team2,
      duration: m.duration,
    };
    try {
      const updated = await api.updateMatch(editingMatch.id, dto);
      onMatchUpdated?.(updated);
      toast.success('Partido actualizado');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al actualizar partido'));
      throw err;
    }
  };

  const phases = useMemo(() => [...new Set(matches.map((m) => m.phase))], [matches]);
  const groups = useMemo(
    () => [...new Set(matches.filter((m) => m.group).map((m) => m.group!))],
    [matches],
  );

  const filteredMatches = useMemo(() => {
    const term = normalize(search.trim());
    const matchesSearch = (m: Match): boolean => {
      if (term.length === 0) return true;
      // Match against both teams' name + initials so the admin can
      // type either side of the matchup. Court is included so a
      // referee asking "what's on Cancha 2 today?" can find it fast.
      return (
        normalize(m.team1.name).includes(term) ||
        normalize(m.team2.name).includes(term) ||
        normalize(m.team1.initials).includes(term) ||
        normalize(m.team2.initials).includes(term) ||
        (m.court ? normalize(m.court).includes(term) : false)
      );
    };
    return matches.filter((m) => {
      if (phaseFilter !== 'all' && m.phase !== phaseFilter) return false;
      if (groupFilter !== 'all' && m.group !== groupFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!matchesSearch(m)) return false;
      return true;
    });
  }, [matches, phaseFilter, groupFilter, statusFilter, search]);

  // Active filtering forces all category accordions open during
  // search/filter so matches aren't hidden behind collapsed sections.
  const isFiltering =
    search.trim().length > 0 ||
    phaseFilter !== 'all' ||
    groupFilter !== 'all' ||
    statusFilter !== 'all';

  const split = useMemo(() => {
    const live: Match[] = [];
    const byCategory = new Map<string, Match[]>();
    for (const m of filteredMatches) {
      if (m.status === 'live') {
        live.push(m);
        continue;
      }
      const category = categoryOfMatchPhase(m.phase);
      const bucket = byCategory.get(category) ?? [];
      bucket.push(m);
      byCategory.set(category, bucket);
    }
    return {
      live,
      categories: Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [filteredMatches]);

  return (
    <>
      {/* Toolbar — single row: search input takes most of the width,
          two icon buttons sit next to it.
            · Filtros popover  — opens the three Select dropdowns
              (fase, grupo, estado). The trigger shows a small dot when
              any filter is active so the admin can tell at a glance
              that something is filtering even with the popover closed.
            · Reparar (icon-only) — same action as before, just an
              icon now to save horizontal space. Tooltip preserves the
              affordance copy. Both buttons keep the same `mb-6` gap
              below so the matches list breathes the same as before. */}
      <div className="flex items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-0">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar partido…"
            aria-label="Buscar partido"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none bg-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black rounded-sm"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filtros popover — collapses three Selects into one trigger.
            The red dot on the icon hints at "filtros aplicados" without
            popping the popover open. */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Filtros"
              title="Filtros"
              className="relative flex-shrink-0 inline-flex items-center justify-center w-10 h-10 border border-spk-hairline hover:border-black/20 hover:bg-black/[0.02] rounded-sm transition-colors"
            >
              <Filter className="w-4 h-4 text-black/70" aria-hidden="true" />
              {isFiltering && (
                <span
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-spk-red"
                  aria-hidden="true"
                />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3 space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/55 mb-1.5">
                Fase
              </label>
              <Select value={phaseFilter} onValueChange={setPhaseFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Fase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las fases</SelectItem>
                  {phases.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/55 mb-1.5">
                Grupo
              </label>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los grupos</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/55 mb-1.5">
                Estado
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="upcoming">{matchStatusLabel('upcoming')}</SelectItem>
                  <SelectItem value="live">{matchStatusLabel('live')}</SelectItem>
                  <SelectItem value="completed">{matchStatusLabel('completed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  setPhaseFilter('all');
                  setGroupFilter('all');
                  setStatusFilter('all');
                }}
                className="w-full text-[11px] font-bold uppercase tracking-wider text-spk-red hover:underline"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Limpiar filtros
              </button>
            )}
          </PopoverContent>
        </Popover>

        {/* DESHABILITADO PERMANENTEMENTE hasta nuevo aviso (2026-05-13,
            decisión del product owner). `repairTournamentSchedule`
            usa una key `${teamId}|${date}|${time}` para detectar
            conflictos; tras mig 030 los bracket slots no resueltos
            tienen `team1_id = null`, que se serializa como la string
            literal "null" y colapsa TODOS los slots pendientes en una
            única entrada del Map. Resultado: el reparador los
            considera conflictos mutuos y reagenda agresivamente la
            eliminatoria, deshaciendo el plan manual que el admin
            armó en el cronograma.

            Reactivar después de:
              · Excluir matches con team1_id/team2_id NULL del
                `repairTournamentSchedule` (no son conflictos
                reagendables — el bracket los reabsorbe cuando avanza
                el winner).
              · O usar `bracket_match_id IS NULL` como filtro previo
                (sólo reparar fase de grupos / liga).

            Mientras tanto el admin reagenda manualmente vía drag-and-
            drop del Cronograma, que ya tiene su propia validación de
            conflictos por slot. */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {false && (
          <button
            type="button"
            onClick={() => setRepairConfirmOpen(true)}
            disabled={repairing || !effectiveTournamentId}
            aria-label="Reparar horarios"
            title="Reparar horarios — detecta y reagenda partidos con conflicto"
            className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 border border-spk-blue/40 text-spk-blue hover:bg-spk-blue/10 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {repairing ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wrench className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {filteredMatches.length === 0 ? (
        <div className="text-center py-12">
          <Trophy className="w-12 h-12 text-black/20 mx-auto mb-3" />
          <p className="text-black/60">
            {matches.length === 0
              ? 'No hay partidos generados'
              : 'No hay partidos que coincidan con los filtros'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {split.live.length > 0 && (
            <section>
              <h3
                className="flex items-center gap-2 text-xs font-semibold uppercase text-spk-red mb-3"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.14em' }}
              >
                <span className="relative inline-flex w-2 h-2">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-spk-red opacity-75 animate-ping" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-spk-red" />
                </span>
                En vivo
                <span className="text-black/40 font-medium tabular-nums">
                  ({split.live.length})
                </span>
              </h3>
              <div className="space-y-2">
                {split.live.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    editor={editor}
                    onOpenEditModal={openEditModal}
                    tournament={tournament}
                  />
                ))}
              </div>
            </section>
          )}

          {split.categories.map(([category, catMatches]) => (
            <CategorySection
              key={category || '_uncat'}
              title={category || 'Sin categoría'}
              count={catMatches.length}
              defaultOpen
              // Pin all categories open while filtering so matches in
              // collapsed sections aren't hidden behind an extra click.
              forceOpen={isFiltering ? true : undefined}
            >
              <div className="space-y-2">
                {catMatches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    editor={editor}
                    onOpenEditModal={openEditModal}
                    tournament={tournament}
                  />
                ))}
              </div>
            </CategorySection>
          ))}
        </div>
      )}

      <MatchFormModal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        onSubmit={handleEditSubmit}
        match={editingMatch}
      />

      {/* Confirm before reshuffling the schedule. The dialog body
          spells out exactly what the operation will do (move the
          duplicates to the next free slot, leave the original in
          place) so the admin understands they're not about to
          regenerate the entire fixture from scratch. */}
      <ConfirmDialog
        open={repairConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !repairing) setRepairConfirmOpen(false);
        }}
        title="¿Reparar horarios?"
        description={
          'Voy a buscar tres tipos de problemas y reagendar los partidos afectados al próximo ' +
          'horario libre dentro del torneo: (1) un mismo equipo programado en dos partidos a la ' +
          'misma hora, (2) la misma cancha usada por dos partidos a la misma hora, y (3) partidos ' +
          'con fecha fuera del rango del torneo (anteriores al inicio o posteriores al fin). ' +
          'Esta acción no toca marcadores ni el estado de los partidos.'
        }
        confirmLabel="Reparar"
        variant="default"
        loading={repairing}
        onConfirm={handleRepairConfirm}
      />
    </>
  );
}

/**
 * Single match card with inline score-editor support. Owns no state —
 * all editor interaction goes through the shared hook.
 */
function MatchCard({
  match,
  editor,
  onOpenEditModal,
  tournament,
}: {
  match: Match;
  editor: ScoreEditor;
  onOpenEditModal: (m: Match) => void;
  /** Drives the per-card "expected duration" badge (migration 027).
   *  Optional so callers without the tournament loaded keep working. */
  tournament?: Tournament;
}) {
  const isEditing = editor.isEditing(match);
  const displayScore = isEditing ? editor.editedScore : match.score;
  const expectedDuration = tournament
    ? getMatchDurationMinutes(match, tournament)
    : null;
  const expectedEnd = tournament ? getMatchEndTime(match, tournament) : '';
  return (
    <div
      className={`p-4 bg-white border rounded-sm ${
        match.status === 'live' ? 'border-spk-red border-2' : 'border-black/10'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              match.status === 'live'
                ? 'destructive'
                : match.status === 'completed'
                  ? 'secondary'
                  : 'outline'
            }
          >
            {matchStatusLabel(match.status)}
          </Badge>
          <span className="text-xs text-black/50">
            {match.phase}
            {match.group ? ` • ${match.group}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-black/50">
          {match.court && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {match.court}
            </span>
          )}
          {/* Date + time. Date format "15 abr" comes from formatShortDate
              (date-fns es locale) — same helper the public TournamentCard
              uses, so the styling stays consistent across surfaces.
              `whitespace-nowrap` prevents the "15 abr · 10:00" cluster
              from breaking across two lines on narrow screens. */}
          <span className="whitespace-nowrap">
            {formatShortDate(match.date)} · {match.time}
          </span>
          {/* Expected duration (migration 027) — only on non-completed
              matches; completed cards already show the actual duration
              elsewhere in the listing. The "→ HH:MM" suffix makes the
              expected end-time skimmable without doing math. */}
          {expectedDuration && match.status !== 'completed' && (
            <span
              className="inline-flex items-center gap-1 text-black/60 bg-black/5 px-1.5 py-0.5 rounded-sm tabular-nums whitespace-nowrap"
              title={
                expectedEnd
                  ? `Duración estimada — termina aprox ${expectedEnd}`
                  : 'Duración estimada'
              }
            >
              {expectedDuration}&prime;
              {expectedEnd && (
                <span className="opacity-60">→ {expectedEnd}</span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* TeamAvatar renders the uploaded logo when present and
              falls back to the initials-on-primary-color square. The
              previous inline div ignored `team.logo` entirely, so
              every match card showed initials only. */}
          <TeamAvatar team={match.team1} size="md" />
          <span className="font-medium truncate">{match.team1.name}</span>
        </div>

        <div className="px-4 text-center flex-shrink-0">
          {displayScore ? (
            <span
              className="text-2xl font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {displayScore.team1} — {displayScore.team2}
            </span>
          ) : (
            <span
              className="text-xl text-black/20 font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              VS
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
          <span className="font-medium truncate text-right">{match.team2.name}</span>
          <TeamAvatar team={match.team2} size="md" />
        </div>
      </div>

      {isEditing ? (
        <ScoreSetsEditor
          sets={editor.sets}
          status={editor.status}
          saving={editor.saving}
          onAddSet={editor.addSet}
          onRemoveSet={editor.removeSet}
          onUpdateSet={editor.updateSet}
          onStatusChange={editor.setStatus}
          onSave={() => editor.commit(match)}
          onCancel={editor.cancel}
        />
      ) : (
        <div className="flex justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={() => onOpenEditModal(match)}
            className="flex items-center gap-1 text-xs text-black/60 hover:text-black transition-colors"
            title="Editar fecha, hora, cancha, equipos…"
          >
            <Pencil className="w-3 h-3" />
            Editar partido
          </button>
          <button
            type="button"
            onClick={() => editor.start(match)}
            className="flex items-center gap-1 text-xs text-spk-blue hover:text-spk-blue/80 transition-colors"
            title="Editar marcador y sets"
          >
            <Edit className="w-3 h-3" />
            Editar marcador
          </button>
        </div>
      )}
    </div>
  );
}
