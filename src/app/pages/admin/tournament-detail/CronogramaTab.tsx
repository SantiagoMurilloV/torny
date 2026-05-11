import { useMemo, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Calendar, Filter, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import type { Match, Tournament } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';
import { api } from '../../../services/api';
import { getErrorMessage } from '../../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

// Color palette for categories — kept in sync with the previous
// version of this tab. Indexed by category position so the same
// category always lands on the same colour across runs.
const CATEGORY_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800', dot: 'bg-blue-500' },
  { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-800', dot: 'bg-red-500' },
  { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800', dot: 'bg-green-500' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800', dot: 'bg-yellow-500' },
];

const DEFAULT_DAY_START_MIN = 8 * 60;
const DEFAULT_DAY_END_MIN = 18 * 60;

const MATCH_DND_TYPE = 'cronograma-match';

interface CronogramaTabProps {
  tournament: Tournament;
  matches: Match[];
  /**
   * Called after a successful drag-and-drop save. Receives the matches
   * whose (date, time, court) changed so the parent can patch its
   * state in one shot. Two entries for a swap, one for a plain move.
   */
  onMatchesPatched?: (patched: Match[]) => void;
}

/**
 * Cronograma — interactive schedule grid with drag-and-drop.
 *
 * Columns: each calendar day in the tournament range.
 * Rows:    time slots stepped by (matchDuration + matchBreak) from the
 *          tournament's daily window (or the historic 08:00–18:00
 *          fallback when no schedule is configured).
 * Cards:   one per match, coloured by category, labeled with court.
 *          The admin drags a card onto another (day, time) cell to
 *          change its slot. When the destination already has a match
 *          on the SAME court, the two matches swap atomically; when
 *          the court is free in the destination, the dragged match
 *          moves and keeps its court.
 *
 * The grid generation is data-driven from the tournament config so the
 * dead-time blocks / per-day windows the admin set in Ajustes show up
 * as gaps and short days respectively.
 */
export function CronogramaTab({ tournament, matches, onMatchesPatched }: CronogramaTabProps) {
  return (
    <DndProvider backend={HTML5Backend}>
      <CronogramaGrid
        tournament={tournament}
        matches={matches}
        onMatchesPatched={onMatchesPatched}
      />
    </DndProvider>
  );
}

function CronogramaGrid({ tournament, matches, onMatchesPatched }: CronogramaTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [busy, setBusy] = useState(false);

  // YYYY-MM-DD for a Date or string. Anchors all comparisons + map
  // keys so timezone shifts in the JS Date round-trip can't perturb
  // the grouping.
  const toIso = (d: Date | string): string => {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    return '';
  };

  // Days array — one cell per calendar day between the tournament's
  // start and end dates (inclusive). Falls back to "today" if the
  // tournament dates are missing.
  const days = useMemo<string[]>(() => {
    const start = toIso(tournament.startDate) || new Date().toISOString().slice(0, 10);
    const end = toIso(tournament.endDate) || start;
    const out: string[] = [];
    const cursor = new Date(start + 'T12:00:00');
    const endCursor = new Date(end + 'T12:00:00');
    let safety = 0;
    while (cursor.getTime() <= endCursor.getTime() && safety < 200) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }
    return out;
  }, [tournament.startDate, tournament.endDate]);

  // Time-slot generator. Walks each day's window stepping by
  // (matchDuration + matchBreak) and collects the union of all
  // resulting times across days. We also UNION the times of existing
  // matches so a match scheduled outside the configured window still
  // shows up in the grid (otherwise the admin couldn't grab it to
  // move it back into a legal slot).
  const matchDuration = tournament.matchDurationMinutes ?? 60;
  const matchBreak = tournament.matchBreakMinutes ?? 15;
  const slotStride = Math.max(15, matchDuration + matchBreak);

  const parseHHMM = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const [h, m] = raw.split(':').map((n) => Number(n));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
    return h * 60 + m;
  };
  const formatHHMM = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const dailySchedules = tournament.dailySchedules ?? {};
  const times = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const day of days) {
      const override = dailySchedules[day];
      const startMin = parseHHMM(override?.start, DEFAULT_DAY_START_MIN);
      const endMin = parseHHMM(override?.end, DEFAULT_DAY_END_MIN);
      for (let m = startMin; m + matchDuration <= endMin; m += slotStride) {
        set.add(formatHHMM(m));
      }
    }
    // Add any existing match times so out-of-window matches still
    // appear (the admin must be able to grab them to move them in).
    for (const m of matches) {
      if (m.time) set.add(m.time);
    }
    const sorted = [...set].sort();
    return sorted.length > 0 ? sorted : ['08:00'];
  }, [days, dailySchedules, matchDuration, slotStride, matches]);

  // Category extraction — same convention used everywhere else
  // ("Category|group" or "Category|round"). Empty group/phase falls
  // back to "General" so an unphased match still gets a colour.
  const getMatchCategory = (m: Match): string => {
    if (m.group) {
      return m.group.includes('|') ? m.group.split('|')[0] : 'General';
    }
    return 'General';
  };

  const categories = useMemo<string[]>(() => {
    const cats = new Set<string>();
    for (const m of matches) cats.add(getMatchCategory(m));
    return [...cats].sort();
  }, [matches]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, typeof CATEGORY_COLORS[0]>();
    categories.forEach((cat, idx) => {
      map.set(cat, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
    });
    return map;
  }, [categories]);

  // Group matches into a (day, time) → matches[] structure for O(1)
  // lookup when rendering each cell. We also keep an "out of grid"
  // bucket for matches whose date isn't in the tournament's day
  // range — those render in a separate banner above the grid so the
  // admin can grab them and drop them back inside.
  const cellMap = useMemo(() => {
    const map = new Map<string, Match[]>();
    const outOfGrid: Match[] = [];
    const daySet = new Set(days);
    for (const m of matches) {
      if (selectedCategory !== 'all' && getMatchCategory(m) !== selectedCategory) continue;
      const date = toIso(m.date);
      if (!daySet.has(date)) {
        outOfGrid.push(m);
        continue;
      }
      const key = `${date}|${m.time}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return { map, outOfGrid };
  }, [days, matches, selectedCategory]);

  /**
   * Handle a drop. `dragged` is the match being moved; `destDate` and
   * `destTime` come from the cell. The dragged match keeps its OWN
   * court — the only court the drop can swap with is one already
   * occupying the destination cell with the same court name.
   *
   * Cases:
   *   1. dest is the same slot as the dragged match → no-op.
   *   2. dest has another match on the same court → atomic swap via
   *      the backend's /matches/swap endpoint.
   *   3. dest cell has no match on the dragged match's court → plain
   *      update (the backend's per-row validation kicks in for team
   *      / court conflicts against OTHER cells, surfacing a friendly
   *      error to the toast).
   */
  const handleDrop = async (dragged: Match, destDate: string, destTime: string) => {
    if (busy) return;
    const draggedDate = toIso(dragged.date);
    if (draggedDate === destDate && dragged.time === destTime) return;
    setBusy(true);
    try {
      const destMatches = cellMap.map.get(`${destDate}|${destTime}`) ?? [];
      const sameCourt = destMatches.find(
        (m) => m.id !== dragged.id && m.court === dragged.court,
      );
      if (sameCourt) {
        const { matchA, matchB } = await api.swapMatches(dragged.id, sameCourt.id);
        onMatchesPatched?.([matchA, matchB]);
        toast.success(
          `Cambio: ${dragged.team1.name} y ${sameCourt.team1.name} intercambiaron horario.`,
        );
      } else {
        const updated = await api.updateMatch(dragged.id, {
          tournamentId: dragged.tournamentId,
          team1Id: dragged.team1.id,
          team2Id: dragged.team2.id,
          date: destDate,
          time: destTime,
          court: dragged.court,
          phase: dragged.phase,
          groupName: dragged.group,
          status: dragged.status,
        });
        onMatchesPatched?.([updated]);
        toast.success(`Movido a ${formatDateLabel(destDate)} · ${destTime}.`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo mover el partido'));
    } finally {
      setBusy(false);
    }
  };

  const formatDateLabel = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-black/60" />
          <h2 className="text-xl font-bold" style={FONT}>
            CRONOGRAMA
          </h2>
        </div>
        <span className="text-xs text-black/50">
          Arrastrá los partidos para reagendarlos. Mismo cancha en el destino → intercambio.
        </span>
      </div>

      {/* Category legend / filter — same UI as the read-only version
          before this refactor. Filter affects the grid AND the
          out-of-grid banner so the admin always sees the same scope. */}
      <div className="bg-white border border-black/10 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-black/50" />
          <span className="text-sm font-bold text-black/70" style={FONT}>
            CATEGORÍAS
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              selectedCategory === 'all'
                ? 'bg-black text-white'
                : 'bg-black/5 text-black/60 hover:bg-black/10'
            }`}
            style={FONT}
          >
            Todas
          </button>
          {categories.map((cat) => {
            const color = categoryColorMap.get(cat)!;
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  isActive
                    ? `${color.bg} ${color.border} ${color.text}`
                    : 'bg-white border-black/10 text-black/60 hover:bg-black/5'
                }`}
                style={FONT}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${color.dot}`} />
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Out-of-grid banner — matches whose date falls outside the
          tournament's range stay grabbable here so the admin can drag
          them back into a real slot. */}
      {cellMap.outOfGrid.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs font-bold text-yellow-900 mb-2" style={FONT}>
            Partidos fuera del rango del torneo — arrastralos a un día/hora arriba
          </p>
          <div className="flex flex-wrap gap-2">
            {cellMap.outOfGrid.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                color={categoryColorMap.get(getMatchCategory(m)) ?? CATEGORY_COLORS[0]}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {/* The grid itself — sticky day header on top, sticky time
          column on the left. Overflow-x scroll handles tournaments
          with many days; the inner content sizes itself so cells stay
          legible on mobile (~140px per day column). */}
      <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `60px repeat(${days.length}, minmax(180px, 1fr))`,
            }}
          >
            {/* Top-left empty corner */}
            <div className="sticky top-0 left-0 z-20 bg-white border-b border-r border-black/10" />
            {/* Day headers */}
            {days.map((day) => (
              <div
                key={day}
                className="sticky top-0 z-10 bg-black text-white px-3 py-2 border-b border-black/10"
              >
                <div className="text-xs font-bold uppercase tracking-wide" style={FONT}>
                  {formatDateLabel(day)}
                </div>
                <div className="text-[10px] text-white/60 tabular-nums">{day}</div>
              </div>
            ))}

            {/* Time rows */}
            {times.map((time) => (
              <RowFragment
                key={time}
                time={time}
                days={days}
                cellMap={cellMap.map}
                categoryColorMap={categoryColorMap}
                getMatchCategory={getMatchCategory}
                onDrop={handleDrop}
                busy={busy}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

interface RowFragmentProps {
  time: string;
  days: string[];
  cellMap: Map<string, Match[]>;
  categoryColorMap: Map<string, typeof CATEGORY_COLORS[0]>;
  getMatchCategory: (m: Match) => string;
  onDrop: (dragged: Match, destDate: string, destTime: string) => void;
  busy: boolean;
}

/**
 * One row of the grid. Renders the time label on the left + a drop-cell
 * per day on the right. Lives in its own component so each cell can own
 * its useDrop without redefining the hook per render of the outer grid.
 */
function RowFragment({
  time,
  days,
  cellMap,
  categoryColorMap,
  getMatchCategory,
  onDrop,
  busy,
}: RowFragmentProps) {
  return (
    <>
      <div className="sticky left-0 z-10 bg-white border-b border-r border-black/10 px-2 py-2 text-xs font-bold text-black/70 tabular-nums" style={FONT}>
        {time}
      </div>
      {days.map((day) => (
        <Cell
          key={`${day}|${time}`}
          date={day}
          time={time}
          matches={cellMap.get(`${day}|${time}`) ?? []}
          categoryColorMap={categoryColorMap}
          getMatchCategory={getMatchCategory}
          onDrop={onDrop}
          busy={busy}
        />
      ))}
    </>
  );
}

interface CellProps {
  date: string;
  time: string;
  matches: Match[];
  categoryColorMap: Map<string, typeof CATEGORY_COLORS[0]>;
  getMatchCategory: (m: Match) => string;
  onDrop: (dragged: Match, destDate: string, destTime: string) => void;
  busy: boolean;
}

/**
 * Drop target for one (date, time) intersection. Holds zero or more
 * match cards stacked vertically. Highlights on hover (canDrop +
 * isOver) so the admin gets clear feedback while dragging.
 */
function Cell({
  date,
  time,
  matches,
  categoryColorMap,
  getMatchCategory,
  onDrop,
  busy,
}: CellProps) {
  const [{ isOver, canDrop }, drop] = useDrop<
    { match: Match },
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: MATCH_DND_TYPE,
    drop: (item) => onDrop(item.match, date, time),
    canDrop: () => !busy,
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [date, time, onDrop, busy]);

  const dropTint = isOver && canDrop ? 'bg-spk-red/5 ring-2 ring-spk-red/40 ring-inset' : '';

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`min-h-[64px] border-b border-r border-black/10 p-1.5 space-y-1.5 transition-colors ${dropTint}`}
    >
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          color={categoryColorMap.get(getMatchCategory(m)) ?? CATEGORY_COLORS[0]}
        />
      ))}
    </div>
  );
}

interface MatchCardProps {
  match: Match;
  color: typeof CATEGORY_COLORS[0];
  /** Compact rendering used by the out-of-grid banner. */
  compact?: boolean;
}

/**
 * One draggable match. Compact mode skips the team-avatar row and
 * shrinks the padding so the out-of-grid banner doesn't dwarf the
 * grid below it.
 */
function MatchCard({ match, color, compact = false }: MatchCardProps) {
  const [{ isDragging }, drag, preview] = useDrag<
    { match: Match },
    void,
    { isDragging: boolean }
  >(() => ({
    type: MATCH_DND_TYPE,
    item: { match },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }), [match]);

  const opacity = isDragging ? 'opacity-40' : 'opacity-100';
  const groupLabel = match.group?.includes('|')
    ? match.group.split('|').slice(1).join('|')
    : match.group || '';

  return (
    <div
      ref={preview as unknown as React.Ref<HTMLDivElement>}
      className={`${color.bg} ${color.border} border rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing transition-all ${opacity}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          ref={drag as unknown as React.Ref<HTMLSpanElement>}
          className="text-black/40 hover:text-black/70"
          aria-label="Arrastrar"
        >
          <GripVertical className="w-3 h-3" />
        </span>
        {match.court && (
          <span
            className="text-[9px] font-bold uppercase tracking-wider bg-white/70 text-black/70 px-1.5 py-0.5 rounded"
            style={FONT}
          >
            {match.court}
          </span>
        )}
        {groupLabel && (
          <span className={`text-[9px] font-bold ${color.text}`} style={FONT}>
            {groupLabel}
          </span>
        )}
        {match.score && (
          <span className="ml-auto text-[10px] font-bold tabular-nums text-black/70">
            {match.score.team1}-{match.score.team2}
          </span>
        )}
      </div>
      {!compact && (
        <div className="flex items-center gap-1.5">
          <TeamAvatar team={match.team1} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team1.name}
          </span>
        </div>
      )}
      {!compact && (
        <div className="flex items-center gap-1.5 mt-1">
          <TeamAvatar team={match.team2} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team2.name}
          </span>
        </div>
      )}
      {compact && (
        <div className="text-[10px] text-black/70">
          {match.team1.initials} vs {match.team2.initials}
        </div>
      )}
    </div>
  );
}
