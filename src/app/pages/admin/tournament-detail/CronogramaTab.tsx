import { useEffect, useMemo, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Calendar, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import type { Match, Tournament } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { api } from '../../../services/api';
import { getErrorMessage } from '../../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

// Category color palette — same indexing rule as before (sorted
// category list → CATEGORY_COLORS[idx % len]) so a category always
// renders in the same colour across runs and across views.
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
 * Cronograma — interactive single-day schedule grid.
 *
 * Layout per the 2026-05-11 redesign:
 *   · Top filter: day picker chips (one per tournament day).
 *   · Columns: each court declared on the tournament.
 *   · Rows: time slots stepped by (matchDuration + matchBreak) from
 *           the day's window (with the historic 08:00–18:00 fallback).
 *   · Each cell shows AT MOST one match (the match at that court+time
 *     on the selected day) or stays empty as a drop target.
 *   · Drag a card onto an occupied cell → atomic swap.
 *   · Drag a card onto an empty cell → simple move; the dragged
 *     match's court changes to the destination column.
 *
 * Cross-day reschedules are intentional: the admin changes the day
 * picker first, then drags. Keeps the visual structure honest about
 * what's possible in a single tap-and-drop.
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
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const toIso = (d: Date | string): string => {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    return '';
  };

  // Tournament day range — one entry per calendar day between start
  // and end (inclusive). Falls back to "today" if dates missing.
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

  // Pick a default day on first render — prefer "today" if it falls
  // inside the range, otherwise the first day with matches scheduled,
  // otherwise the first day of the tournament. Only fires when the
  // current selection isn't a valid day in `days`.
  useEffect(() => {
    if (selectedDay && days.includes(selectedDay)) return;
    const today = new Date().toISOString().slice(0, 10);
    const matchDays = new Set(matches.map((m) => toIso(m.date)));
    const fallback =
      (days.includes(today) ? today : null) ??
      days.find((d) => matchDays.has(d)) ??
      days[0] ??
      '';
    if (fallback) setSelectedDay(fallback);
  }, [days, matches, selectedDay]);

  // Courts — sourced from the tournament metadata so the column set is
  // stable even on days with no matches yet. Fallback to "Cancha 1"
  // for tournaments that never declared courts (legacy / brand-new).
  const courts = useMemo<string[]>(() => {
    const list = tournament.courts && tournament.courts.length > 0
      ? tournament.courts
      : ['Cancha 1'];
    // Also surface any court that shows up in matches but isn't in the
    // declared list (e.g. an admin manually moved a match to a renamed
    // court). Otherwise those matches would have no column to land in.
    const set = new Set(list);
    for (const m of matches) {
      if (m.court && !set.has(m.court)) set.add(m.court);
    }
    return [...set];
  }, [tournament.courts, matches]);

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

  // Time slots are generated FOR THE SELECTED DAY using its specific
  // window (per-day override or global default). We also union the
  // times of matches scheduled on that day so a match in an
  // off-cadence slot (e.g. admin manually moved it to a non-standard
  // time) still has a row to land in.
  const times = useMemo<string[]>(() => {
    const set = new Set<string>();
    if (selectedDay) {
      const override = dailySchedules[selectedDay];
      const startMin = parseHHMM(override?.start, DEFAULT_DAY_START_MIN);
      const endMin = parseHHMM(override?.end, DEFAULT_DAY_END_MIN);
      for (let m = startMin; m + matchDuration <= endMin; m += slotStride) {
        set.add(formatHHMM(m));
      }
      for (const m of matches) {
        if (toIso(m.date) === selectedDay && m.time) set.add(m.time);
      }
    }
    const sorted = [...set].sort();
    return sorted.length > 0 ? sorted : ['08:00'];
  }, [selectedDay, dailySchedules, matchDuration, slotStride, matches]);

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

  // Build a (court, time) → matches[] index for the selected day.
  //
  // History: this map originally kept only ONE match per cell, which
  // hid duplicates when the data ended up with two matches sharing
  // (court, time, date) — a court double-booking that the repair tool
  // is supposed to clean up but might not have run yet. The hidden
  // duplicate then made the team-conflict pre-check below fire on a
  // match that wasn't visible in the grid, leaving the admin
  // confused about WHY the drop was blocked.
  //
  // Now we render every match in its cell (stacked vertically) so the
  // admin sees the actual mess. The drop logic still picks the FIRST
  // match in a cell as the swap target.
  const matchesByCell = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of matches) {
      if (toIso(m.date) !== selectedDay) continue;
      if (selectedCategory !== 'all' && getMatchCategory(m) !== selectedCategory) continue;
      const key = `${m.court}|${m.time}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [matches, selectedDay, selectedCategory]);

  // Matches on the selected day that don't fit in the current grid
  // (court not in the columns, or time not in the rows). Currently
  // both are unioned into the column/row sets above so this stays
  // empty in practice — kept here as a safety banner in case future
  // edge cases (renames, etc.) leak a match outside.
  const orphans = useMemo<Match[]>(() => {
    const out: Match[] = [];
    const courtSet = new Set(courts);
    const timeSet = new Set(times);
    for (const m of matches) {
      if (toIso(m.date) !== selectedDay) continue;
      if (selectedCategory !== 'all' && getMatchCategory(m) !== selectedCategory) continue;
      if (!courtSet.has(m.court) || !timeSet.has(m.time)) {
        out.push(m);
      }
    }
    return out;
  }, [matches, selectedDay, selectedCategory, courts, times]);

  /**
   * Drop handler. The destination cell lives at (court, time) on the
   * currently selected day — the cross-day move requires the admin to
   * change the day picker first.
   *
   *   1. Same court + same time → no-op.
   *   2. Destination occupied → atomic swap via /matches/swap.
   *   3. Destination empty → update the dragged match's slot to the
   *      new (court, time). Date stays as selectedDay.
   *
   * Backend-side conflict validation still kicks in for case 3: if
   * the move would put one of the teams in two matches at the same
   * time on another court, the PUT throws and we toast the friendly
   * error.
   */
  const handleDrop = async (dragged: Match, destCourt: string, destTime: string) => {
    if (busy) return;
    if (dragged.court === destCourt && dragged.time === destTime) return;

    setBusy(true);
    try {
      // 1) Destination cell occupied → straight swap with whichever
      // match is sitting on it (first wins if it's a stacked cell).
      const destStack = matchesByCell.get(`${destCourt}|${destTime}`) ?? [];
      const destMatch = destStack.find((m) => m.id !== dragged.id) ?? null;

      if (destMatch) {
        const { matchA, matchB } = await api.swapMatches(dragged.id, destMatch.id);
        onMatchesPatched?.([matchA, matchB]);
        toast.success(
          `Cambio: ${shortLabel(dragged)} y ${shortLabel(destMatch)} intercambiaron horario.`,
        );
        return;
      }

      // 2) Destination empty in the active view — but a match in
      // another category (hidden by the filter) or another court at
      // the same time may share a team with the dragged match. The
      // backend would reject the plain update with the generic "Uno
      // de los equipos ya tiene un partido programado el …" message.
      //
      // To keep the drop succeeding, we auto-swap with that hidden
      // team-conflict match so the dragged match takes the conflict's
      // slot and the conflict's match moves to the dragged's original
      // slot. Both teams keep their commitments without forcing the
      // admin to chase the hidden partido.
      const teamConflict = matches.find((m) => {
        if (m.id === dragged.id) return false;
        if (toIso(m.date) !== selectedDay) return false;
        if (m.time !== destTime) return false;
        const t1 = m.team1.id;
        const t2 = m.team2.id;
        const d1 = dragged.team1.id;
        const d2 = dragged.team2.id;
        return t1 === d1 || t1 === d2 || t2 === d1 || t2 === d2;
      });

      if (teamConflict) {
        const { matchA, matchB } = await api.swapMatches(dragged.id, teamConflict.id);
        onMatchesPatched?.([matchA, matchB]);
        const hidden =
          selectedCategory !== 'all' &&
          getMatchCategory(teamConflict) !== selectedCategory;
        toast.success(
          `Movido a ${destCourt} · ${destTime} e intercambiado con ${shortLabel(teamConflict)}` +
            (hidden ? ' (estaba oculto por el filtro).' : '.'),
        );
        return;
      }

      // 3) Clean move — destination empty and no team conflict.
      {
        // Diagnostic snapshot — the BE has rejected drops with a "conflict
        // on another day" message in the past and the only way to tell
        // whether the FE or the BE drifted is to log what we're sending.
        // Safe to leave in production: a console.info entry per drag has
        // negligible cost and stays invisible unless the admin opens
        // devtools.
        // eslint-disable-next-line no-console
        console.info('[cronograma] move match', {
          matchId: dragged.id,
          draggedFrom: {
            date: toIso(dragged.date),
            time: dragged.time,
            court: dragged.court,
          },
          movingTo: {
            date: selectedDay,
            time: destTime,
            court: destCourt,
          },
          teams: { team1Id: dragged.team1.id, team2Id: dragged.team2.id },
          selectedDay,
        });
        const updated = await api.updateMatch(dragged.id, {
          tournamentId: dragged.tournamentId,
          team1Id: dragged.team1.id,
          team2Id: dragged.team2.id,
          date: selectedDay,
          time: destTime,
          court: destCourt,
          phase: dragged.phase,
          groupName: dragged.group,
          status: dragged.status,
        });
        onMatchesPatched?.([updated]);
        toast.success(`Movido a ${destCourt} · ${destTime}.`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cronograma] move failed', err);
      toast.error(getErrorMessage(err, 'No se pudo mover el partido'));
    } finally {
      setBusy(false);
    }
  };

  const shortLabel = (m: Match): string =>
    `${m.team1.initials || m.team1.name} vs ${m.team2.initials || m.team2.name}`;

  const formatDayLabel = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
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
          Arrastrá un partido a otra cancha u hora del mismo día. Si la celda destino está ocupada → intercambio automático. Para mover a otro día, cambialo arriba en el filtro.
        </span>
      </div>

      {/* Filters — two dropdowns in ONE row, always side by side.
          On mobile the labels collapse to icons (Día → calendar icon
          stays inside the SelectValue placeholder) so the two pickers
          fit even on the narrowest screens. On desktop the labels
          come back as small uppercase captions. flex-1 splits the
          available width 50/50 so neither picker overpowers the
          other regardless of viewport. */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="hidden sm:inline text-xs font-bold text-black/55 uppercase tracking-wider whitespace-nowrap"
            style={FONT}
          >
            Día
          </span>
          <Select value={selectedDay} onValueChange={setSelectedDay}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Elegí un día" />
            </SelectTrigger>
            <SelectContent>
              {days.map((d) => (
                <SelectItem key={d} value={d}>
                  {formatDayLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="hidden sm:inline text-xs font-bold text-black/55 uppercase tracking-wider whitespace-nowrap"
            style={FONT}
          >
            Categoría
          </span>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Orphans banner — only renders when a match has a court/time
          not in the current grid (rare; future-proofing). */}
      {orphans.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs font-bold text-yellow-900 mb-2" style={FONT}>
            Partidos fuera del calendario configurado — arrastralos a una celda válida
          </p>
          <div className="flex flex-wrap gap-2">
            {orphans.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                color={categoryColorMap.get(getMatchCategory(m)) ?? CATEGORY_COLORS[0]}
              />
            ))}
          </div>
        </div>
      )}

      {/* The grid — sticky time column on the left, court columns on
          top, single match per cell. min-width-per-column keeps cards
          legible on narrow screens; overflow-x scroll handles
          tournaments with many courts. */}
      <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `60px repeat(${courts.length}, minmax(180px, 1fr))`,
            }}
          >
            {/* Top-left empty corner */}
            <div className="sticky top-0 left-0 z-20 bg-white border-b border-r border-black/10" />
            {/* Court headers */}
            {courts.map((court) => (
              <div
                key={court}
                className="sticky top-0 z-10 bg-black text-white px-3 py-2 border-b border-black/10"
              >
                <div className="text-xs font-bold uppercase tracking-wide truncate" style={FONT}>
                  {court}
                </div>
              </div>
            ))}

            {/* Time rows */}
            {times.map((time) => (
              <RowFragment
                key={time}
                time={time}
                courts={courts}
                matchesByCell={matchesByCell}
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
  courts: string[];
  matchesByCell: Map<string, Match[]>;
  categoryColorMap: Map<string, typeof CATEGORY_COLORS[0]>;
  getMatchCategory: (m: Match) => string;
  onDrop: (dragged: Match, destCourt: string, destTime: string) => void;
  busy: boolean;
}

/**
 * A single time row. The leftmost cell shows the HH:MM label; one
 * Cell per court follows. Each Cell owns its own `useDrop` so a hover
 * highlight reflects only that cell, not the whole row.
 */
function RowFragment({
  time,
  courts,
  matchesByCell,
  categoryColorMap,
  getMatchCategory,
  onDrop,
  busy,
}: RowFragmentProps) {
  return (
    <>
      <div
        className="sticky left-0 z-10 bg-white border-b border-r border-black/10 px-2 py-2 text-xs font-bold text-black/70 tabular-nums"
        style={FONT}
      >
        {time}
      </div>
      {courts.map((court) => (
        <Cell
          key={`${court}|${time}`}
          court={court}
          time={time}
          matches={matchesByCell.get(`${court}|${time}`) ?? []}
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
  court: string;
  time: string;
  /**
   * All matches scheduled at this (court, time) on the selected day.
   * Usually 0 or 1; if it's >1 we render them stacked so the admin
   * sees the double-booking and can fix it (rather than silently
   * hiding the duplicate, which used to break drag-and-drop with
   * "phantom" team conflicts the user couldn't see).
   */
  matches: Match[];
  categoryColorMap: Map<string, typeof CATEGORY_COLORS[0]>;
  getMatchCategory: (m: Match) => string;
  onDrop: (dragged: Match, destCourt: string, destTime: string) => void;
  busy: boolean;
}

function Cell({
  court,
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
    drop: (item) => onDrop(item.match, court, time),
    canDrop: () => !busy,
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [court, time, onDrop, busy]);

  const dropTint = isOver && canDrop ? 'bg-spk-red/5 ring-2 ring-spk-red/40 ring-inset' : '';
  const isStacked = matches.length > 1;

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`min-h-[72px] border-b border-r border-black/10 p-1.5 transition-colors ${dropTint}`}
    >
      {isStacked && (
        <div
          className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-1.5 py-0.5"
          style={FONT}
          title="Hay más de un partido en esta cancha y hora — arrastrá uno a otra celda para resolver."
        >
          ⚠ {matches.length} partidos en este slot
        </div>
      )}
      <div className="space-y-1">
        {matches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            color={categoryColorMap.get(getMatchCategory(m)) ?? CATEGORY_COLORS[0]}
          />
        ))}
      </div>
    </div>
  );
}

interface MatchCardProps {
  match: Match;
  color: typeof CATEGORY_COLORS[0];
}

function MatchCard({ match, color }: MatchCardProps) {
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
      <div className="flex items-center gap-1.5">
        <TeamAvatar team={match.team1} size="xs" />
        <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
          {match.team1.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <TeamAvatar team={match.team2} size="xs" />
        <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
          {match.team2.name}
        </span>
      </div>
    </div>
  );
}
