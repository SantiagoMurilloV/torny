import { useState, useMemo } from 'react';
import { Trophy, Filter, Edit, MapPin, Pencil, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Match } from '../../../types';
import { Badge } from '../../../components/ui/badge';
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
import type { useScoreEditor } from '../../../hooks/useScoreEditor';

type ScoreEditor = ReturnType<typeof useScoreEditor<Match>>;

interface MatchesTabProps {
  matches: Match[];
  /** Shared editor hook instance from the parent (so state persists
   *  across tab switches and stays in sync with other surfaces). */
  editor: ScoreEditor;
  /** Patch a match in the parent state after the metadata-edit modal
   *  saves successfully — keeps the list in sync without re-fetching. */
  onMatchUpdated?: (match: Match) => void;
}

/**
 * Partidos tab — filters + live-first grouped list with inline editor.
 * Owns its own filter state since no other tab reads it; gets the
 * score-editor from the parent because it's shared with the Cruces
 * tab.
 */
export function MatchesTab({ matches, editor, onMatchUpdated }: MatchesTabProps) {
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Free-text search across both teams in each match. Matches the
  // accent-tolerant pattern used in TeamsTab (Bogota → Bogotá, Anez →
  // Áñez) so admins typing fast on mobile still hit results.
  const [search, setSearch] = useState<string>('');
  const [editingMatch, setEditingMatch] = useState<Match | undefined>();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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

  // The MatchFormModal calls onSubmit with a fresh Match payload — we
  // translate that into the wire DTO and PUT /matches/:id. Throws on
  // failure so the modal keeps itself open and shows the error.
  const handleEditSubmit = async (m: Match) => {
    if (!editingMatch) return;
    const dto: UpdateMatchDto = {
      tournamentId: m.tournamentId,
      team1Id: m.team1.id,
      team2Id: m.team2.id,
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
      {/* Search bar — kept on its own row so it gets full width on
          mobile and doesn't get squeezed between the filter selects. */}
      <div className="relative mb-3">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por equipo, sigla o cancha…"
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-6">
        <Filter className="w-4 h-4 text-black/40" />
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
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
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
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
}: {
  match: Match;
  editor: ScoreEditor;
  onOpenEditModal: (m: Match) => void;
}) {
  const isEditing = editor.isEditing(match);
  const displayScore = isEditing ? editor.editedScore : match.score;
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
