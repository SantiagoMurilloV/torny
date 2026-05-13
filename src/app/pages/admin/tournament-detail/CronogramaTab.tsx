import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AlertTriangle, Calendar, CalendarDays, GripVertical, Loader2, Timer } from 'lucide-react';
import { toast } from 'sonner';
import type { Match, Tournament } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';
import { getMatchDurationMinutes, addMinutesToHHMM } from '../../../lib/matchDuration';
import { categoryOfMatch, phaseLabelOnly } from '../../../lib/phase';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
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
  // Per-match in-flight set. Only matches currently mutating are
  // locked — the rest of the grid stays draggable. Replaces the
  // earlier global `busy` flag that froze every drop after the first
  // success on slow networks (the post-patch re-render briefly looked
  // "stuck" because the lock hadn't released yet visually).
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  // Big red alert state for unrecoverable conflicts (backend rejects
  // even after the auto-swap fallback, or there's nowhere to move a
  // match to on the target day). Replaces silent toast.error so the
  // admin can't miss the failure mid-drag.
  const [conflictAlert, setConflictAlert] = useState<
    { title: string; body: string } | null
  >(null);

  const markInFlight = useCallback((ids: string[], on: boolean) => {
    setInFlight((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const toIso = (d: Date | string): string => {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    return '';
  };

  // Tournament day range — one entry per calendar day between start
  // and end (inclusive). Falls back to "today" if dates missing.
  //
  // ALSO append any extra day where `matches` already live but that
  // falls OUTSIDE the tournament's start..end window. This is the
  // recovery path for when an upstream auto-scheduler (the bracket
  // materializer mainly) overflowed past `endDate` and left cards
  // stranded on a day the day-picker would otherwise refuse to
  // show. Without this, those orphan-day matches are completely
  // invisible to the admin and impossible to drag back inside the
  // range. The cronograma is the only UI that can rescue them, so
  // we surface every day-with-matches as an option even if it's
  // beyond the official tournament window.
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
    // Append any out-of-range days that DO have matches. Sort lex
    // (YYYY-MM-DD) so they slot in chronologically alongside the
    // official days.
    const inRange = new Set(out);
    for (const m of matches) {
      const iso = toIso(m.date);
      if (iso && !inRange.has(iso)) {
        inRange.add(iso);
        out.push(iso);
      }
    }
    out.sort();
    return out;
  }, [tournament.startDate, tournament.endDate, matches]);

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

  const globalDuration = tournament.matchDurationMinutes ?? 60;
  const matchBreak = tournament.matchBreakMinutes ?? 15;
  // Per-category overrides (mig 027). The grid stride uses the SHORTEST
  // duration across all categories so a card whose category is longer
  // simply spans 2+ rows visually. Cards in the shortest category fit
  // in 1 row. This is "option B": no over-painting, no truncation —
  // the grid reflects real match lengths.
  const durationsByCategory = tournament.matchDurationsByCategory ?? {};
  const overrideValues = Object.values(durationsByCategory).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );
  const minDuration =
    overrideValues.length > 0 ? Math.min(globalDuration, ...overrideValues) : globalDuration;
  // The stride is `minDuration + break` clamped to ≥15 min so the grid
  // never produces hundreds of micro-rows on degenerate config.
  const slotStride = Math.max(15, minDuration + matchBreak);

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

  // Time slots for an arbitrary day. Used by:
  //   · `times` (the visible grid) for the selected day.
  //   · `findFreeSlotForDay` (cross-day move from the per-card day
  //      picker) to look up the legal slot lattice of a different day.
  const timesForDay = useCallback(
    (day: string): string[] => {
      const set = new Set<string>();
      if (!day) return ['08:00'];
      const override = dailySchedules[day];
      const startMin = parseHHMM(override?.start, DEFAULT_DAY_START_MIN);
      const endMin = parseHHMM(override?.end, DEFAULT_DAY_END_MIN);
      // Step by the shortest-duration stride so longer matches can span
      // multiple rows visually. Still gate on `minDuration` (not stride)
      // so the last short slot of the day shows up.
      for (let m = startMin; m + minDuration <= endMin; m += slotStride) {
        set.add(formatHHMM(m));
      }
      for (const m of matches) {
        if (toIso(m.date) === day && m.time) set.add(m.time);
      }
      const sorted = [...set].sort();
      return sorted.length > 0 ? sorted : ['08:00'];
    },
    [dailySchedules, minDuration, slotStride, matches],
  );

  // Time slots are generated FOR THE SELECTED DAY using its specific
  // window (per-day override or global default). We also union the
  // times of matches scheduled on that day so a match in an
  // off-cadence slot (e.g. admin manually moved it to a non-standard
  // time) still has a row to land in.
  const times = useMemo<string[]>(
    () => timesForDay(selectedDay),
    [timesForDay, selectedDay],
  );

  // Match → category. Reads from both `group` (round-robin matches)
  // and `phase` (bracket fixtures), falling back to the legacy
  // "General" bucket only when neither encoding produces a real
  // category — this keeps the admin grid's color coding aligned with
  // the public cronograma + makes sure materialised bracket matches
  // share the same hue as the rest of their category.
  const getMatchCategory = (m: Match): string => {
    const cat = categoryOfMatch(m);
    return cat || 'General';
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

  // Total matches matching the active filters — drives the small
  // counter badge in the header so the admin sees "12 partidos" at a
  // glance without counting cells.
  const visibleMatchCount = useMemo<number>(() => {
    let n = 0;
    for (const list of matchesByCell.values()) n += list.length;
    return n;
  }, [matchesByCell]);

  /**
   * How many grid rows does a match's card span, given the current
   * stride. A match of `globalDuration` with `slotStride = globalDuration
   * + matchBreak` spans 1 row. A match of `2 × globalDuration` spans 2
   * rows. We always render at least 1 row so a degenerate sub-stride
   * duration (e.g. 25-min match in a 30-min stride config) still has a
   * visible cell. Hover the badge to see the exact end time.
   */
  const spanFor = useCallback(
    (m: Match): number => {
      const dur = getMatchDurationMinutes(m, tournament);
      // The stride includes the break, so the equivalent "span budget"
      // for a single-row match is `slotStride - matchBreak` minutes of
      // play time. We add the break back inside ceil so two adjacent
      // matches with the same duration each span 1 row exactly.
      const span = Math.max(1, Math.ceil((dur + matchBreak) / slotStride));
      return span;
    },
    [tournament, slotStride, matchBreak],
  );

  /**
   * Cells covered by a multi-row card (top cell excluded). We skip
   * rendering these in the grid because the card above already paints
   * over them via CSS Grid `grid-row: span N`. Drop targets on covered
   * cells are intentionally absent so a drop snaps to the next free
   * top-cell instead of mid-span.
   *
   * IMPORTANT: scope by the SAME filter that drives `matchesByCell`.
   * If we covered cells based on the unfiltered match list, hidden
   * cards would leave invisible holes in the grid (covered slot but
   * no painting card on top), breaking drag-drop into those slots.
   */
  const coveredCells = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    const timeIndex = new Map<string, number>(times.map((t, i) => [t, i]));
    // Process matches CHRONOLOGICALLY so we can break the cascade: if
    // a match's own top cell is already covered by an earlier card
    // (overlap-stacked data), we don't propagate its own span downward.
    // Without this, back-to-back 60-min matches at 8:00, 8:45, 9:30…
    // in the same column with stride 45 would chain covers all the way
    // down, leaving entire rows blank with no card painting over them
    // — the user reads those blanks as "null spaces I can't drag to",
    // which is exactly the bug we're fixing.
    const dayMatches = matches
      .filter((m) => toIso(m.date) === selectedDay)
      .filter(
        (m) =>
          selectedCategory === 'all' ||
          getMatchCategory(m) === selectedCategory,
      )
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    for (const m of dayMatches) {
      const topKey = `${m.court}|${m.time}`;
      // Skip cascading when this match's own top cell is already
      // covered — it can't paint anything visible there, so its span
      // shouldn't extend the gap.
      if (out.has(topKey)) continue;
      const topIdx = timeIndex.get(m.time);
      if (topIdx === undefined) continue;
      const span = spanFor(m);
      for (let i = 1; i < span; i++) {
        const t = times[topIdx + i];
        if (!t) break;
        out.add(`${m.court}|${t}`);
      }
    }
    return out;
  }, [matches, selectedDay, selectedCategory, times, spanFor]);

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
  const shortLabel = useCallback(
    (m: Match): string =>
      `${m.team1.initials || m.team1.name} vs ${m.team2.initials || m.team2.name}`,
    [],
  );

  const formatDayLabel = useCallback((iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }, []);

  // Match count + bracket-presence indicator per day. The day picker
  // surfaces both so the admin knows where the bracket fixtures live
  // before having to scroll through the schedule day-by-day. Without
  // this it was easy to miss that cuartos/semis/final were already
  // materialized on later days — the dropdown showed only weekday
  // labels with no hint at where the action was.
  const dayStats = useMemo<Map<string, { total: number; bracket: number }>>(
    () => {
      const map = new Map<string, { total: number; bracket: number }>();
      for (const m of matches) {
        const iso = toIso(m.date);
        const entry = map.get(iso) ?? { total: 0, bracket: 0 };
        entry.total += 1;
        const phaseLabel = m.phase ? phaseLabelOnly(m.phase) : '';
        if (phaseLabel && phaseLabel !== 'grupos' && !m.group) {
          entry.bracket += 1;
        }
        map.set(iso, entry);
      }
      return map;
    },
    [matches],
  );

  const handleDrop = useCallback(
    async (dragged: Match, destCourt: string, destTime: string) => {
      // Same slot drop → no-op.
      if (dragged.court === destCourt && dragged.time === destTime) return;
      // This specific match is already mutating — ignore the second drop
      // to avoid double-firing the API. Other matches stay draggable.
      if (inFlight.has(dragged.id)) return;

      // 1) Destination cell occupied → straight swap with whichever
      // match is sitting on it (first wins if it's a stacked cell).
      const destStack = matchesByCell.get(`${destCourt}|${destTime}`) ?? [];
      const destMatch = destStack.find((m) => m.id !== dragged.id) ?? null;

      // GEOMETRY GUARD — block swaps where the destination's matches
      // wouldn't fit in the source's time budget. Two scenarios:
      //
      //   a) Destination cell has > 1 match stacked. We can't safely
      //      do a multi-way swap with the current API (it only swaps
      //      two matches), and even if we could, those matches need
      //      enough room in the source slot to all land somewhere.
      //      Block with a clear "movelos primero" message.
      //
      //   b) Destination has 1 match BUT it's longer than the dragged
      //      match. Putting a 90-min Senior in a 60-min Sub-13 slot
      //      would overflow into whatever's right after the source —
      //      either creating a second-order overlap or shifting the
      //      next match. The user explicitly asked us to block this:
      //      "solo debe dejar si donde esta el de 60 hay espacio para
      //      los dos de 45 si no no".
      //
      // Only fires when there's at least one match in the destination
      // cell — empty drops fall through to the team-conflict / clean
      // move branches below.
      const destOthers = destStack.filter((m) => m.id !== dragged.id);
      if (destOthers.length > 0) {
        const draggedDur = getMatchDurationMinutes(dragged, tournament);
        const destTotalDur = destOthers.reduce(
          (sum, m) => sum + getMatchDurationMinutes(m, tournament),
          0,
        );
        if (destOthers.length > 1) {
          setConflictAlert({
            title: 'No se puede intercambiar acá',
            body:
              `El destino ya tiene ${destOthers.length} partidos apilados ` +
              `(${destTotalDur} min en total). ${shortLabel(dragged)} dura ` +
              `${draggedDur} min — moveríamos uno y los demás quedarían sin ` +
              'lugar. Mové cada uno por separado a un slot libre antes de ' +
              'soltar otro acá.',
          });
          return;
        }
        if (destTotalDur > draggedDur) {
          setConflictAlert({
            title: 'Las duraciones no encajan',
            body:
              `${shortLabel(destOthers[0])} dura ${destTotalDur} min y ` +
              `${shortLabel(dragged)} dura solo ${draggedDur} min. Si los ` +
              'cambiamos, el partido más largo no entraría en el slot original ' +
              'sin chocar con el siguiente. Movelo manualmente a una hora con ' +
              'más espacio o achicá la duración de su categoría.',
          });
          return;
        }
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
      // slot.
      const teamConflict = !destMatch
        ? matches.find((m) => {
            if (m.id === dragged.id) return false;
            if (toIso(m.date) !== selectedDay) return false;
            if (m.time !== destTime) return false;
            const t1 = m.team1.id;
            const t2 = m.team2.id;
            const d1 = dragged.team1.id;
            const d2 = dragged.team2.id;
            // Bracket slots not yet resolved have `team.id === ''`
            // (placeholder shape returned by `resolveTeam(null)`).
            // Treating those as a real team would make two unresolved
            // cuartos collide on a phantom "same team" check (both
            // have `''` on both sides → `'' === ''` always wins). Skip
            // the match when either dragged side is unresolved, and
            // ignore matches in the candidate set whose team id is
            // also empty.
            const valid = (id: string) => id !== '';
            return (
              (valid(d1) && (t1 === d1 || t2 === d1)) ||
              (valid(d2) && (t1 === d2 || t2 === d2))
            );
          })
        : null;

      // 3) Decide partner for swap (if any) or a clean move.
      const swapPartner = destMatch ?? teamConflict ?? null;
      const partnerIds = swapPartner ? [dragged.id, swapPartner.id] : [dragged.id];
      markInFlight(partnerIds, true);

      try {
        if (swapPartner) {
          const { matchA, matchB } = await api.swapMatches(
            dragged.id,
            swapPartner.id,
          );
          onMatchesPatched?.([matchA, matchB]);
          // Resolve the dragged + partner's NEW slots from the
          // server's response so the toast announces actual landing
          // positions. Previously we just said "intercambiaron" and
          // the admin couldn't verify where each card ended up — if
          // the post-swap render had any glitch they'd think the drag
          // landed wrong. Spelling out "X → cancha/hora · Y →
          // cancha/hora" removes the ambiguity.
          const draggedFinal = matchA.id === dragged.id ? matchA : matchB;
          const partnerFinal = matchA.id === swapPartner.id ? matchA : matchB;
          if (destMatch) {
            toast.success(
              `Intercambio · ${shortLabel(dragged)} → ${draggedFinal.court} ${draggedFinal.time} · ` +
                `${shortLabel(destMatch)} → ${partnerFinal.court} ${partnerFinal.time}`,
            );
          } else {
            const hidden =
              selectedCategory !== 'all' &&
              getMatchCategory(swapPartner) !== selectedCategory;
            toast.success(
              `${shortLabel(dragged)} → ${draggedFinal.court} ${draggedFinal.time} · ` +
                `${shortLabel(swapPartner)} → ${partnerFinal.court} ${partnerFinal.time}` +
                (hidden ? ' (oculto por filtro).' : ''),
            );
          }
          return;
        }

        // 4) Clean move — destination empty and no team conflict.
        //
        // Only re-send team ids when they're actually resolved.
        // Bracket slots pending an upstream round carry the `''`
        // placeholder (resolveTeam(null) → id: ''), and forwarding
        // that empty string as a real id makes `match.service.update`
        // do a `SELECT id FROM teams WHERE id = ''` and 404. Letting
        // the payload omit the field tells the backend "keep whatever
        // team1_id / team2_id was already there" (which is NULL for
        // an unresolved slot — exactly what we want).
        const updated = await api.updateMatch(dragged.id, {
          tournamentId: dragged.tournamentId,
          ...(dragged.team1.id ? { team1Id: dragged.team1.id } : {}),
          ...(dragged.team2.id ? { team2Id: dragged.team2.id } : {}),
          date: selectedDay,
          time: destTime,
          court: destCourt,
          phase: dragged.phase,
          groupName: dragged.group,
          status: dragged.status,
        });
        onMatchesPatched?.([updated]);
        // Show the SERVER-confirmed landing slot rather than what we
        // requested. Defends against the rare path where the backend
        // sanitizes (rounds time, validates court) and lands the
        // match somewhere different from the drop target.
        toast.success(
          `${shortLabel(dragged)} → ${updated.court} ${updated.time}`,
        );
      } catch (err) {
        // Loud, unmissable failure dialog instead of a small toast.
        // The admin must dismiss the alert before continuing — which
        // is the right UX when the backend rejects a destructive move.
        // eslint-disable-next-line no-console
        console.warn('[cronograma] move failed', err);
        setConflictAlert({
          title: 'No se pudo mover el partido',
          body: getErrorMessage(
            err,
            'El servidor rechazó el cambio. Probá con otra cancha u hora.',
          ),
        });
      } finally {
        markInFlight(partnerIds, false);
      }
    },
    [
      inFlight,
      matches,
      matchesByCell,
      selectedDay,
      selectedCategory,
      onMatchesPatched,
      markInFlight,
      shortLabel,
    ],
  );

  /**
   * Cross-day move from the per-card day picker. Finds the first free
   * (time, court) slot on `targetDay` that:
   *   1. Has nothing scheduled on it.
   *   2. Doesn't put either of the dragged match's teams in two
   *      matches at the same time on that day.
   *
   * If nothing fits, surfaces the big red alert with an explanation.
   * If something fits, fires `api.updateMatch` and (optionally) jumps
   * the view to the target day so the admin sees where it landed.
   */
  const handleMoveToDay = useCallback(
    async (dragged: Match, targetDay: string) => {
      if (!targetDay) return;
      if (toIso(dragged.date) === targetDay) {
        toast.info('El partido ya está en ese día.');
        return;
      }
      if (inFlight.has(dragged.id)) return;

      const slots = timesForDay(targetDay);
      // Existing matches on the target day, indexed by occupancy and
      // by team-time. Includes ALL categories — backend will reject
      // cross-team conflicts regardless of the active filter.
      //
      // Bracket slots whose teams aren't resolved yet carry the
      // placeholder `team.id === ''`. Skipping them when building
      // `teamTimes` is essential: otherwise every unresolved slot
      // pollutes the `''` bucket with its time, and dragging another
      // unresolved cuartos to that day collides falsely against its
      // own kind. Two unresolved slots are NOT the same team — they
      // just both happen to read as the "—" placeholder.
      const occupied = new Set<string>();
      const teamTimes = new Map<string, Set<string>>(); // teamId → Set<time>
      const isResolved = (id: string) => id !== '';
      for (const m of matches) {
        if (m.id === dragged.id) continue;
        if (toIso(m.date) !== targetDay) continue;
        occupied.add(`${m.court}|${m.time}`);
        for (const tid of [m.team1.id, m.team2.id]) {
          if (!isResolved(tid)) continue;
          const s = teamTimes.get(tid) ?? new Set<string>();
          s.add(m.time);
          teamTimes.set(tid, s);
        }
      }
      // Same guard on the dragged side — if either team is still a
      // placeholder, treat its "already plays at time X" set as
      // empty. The backend's per-match conflict check (slot + court +
      // resolved teams) still catches real collisions on save.
      const t1Times = isResolved(dragged.team1.id)
        ? (teamTimes.get(dragged.team1.id) ?? new Set<string>())
        : new Set<string>();
      const t2Times = isResolved(dragged.team2.id)
        ? (teamTimes.get(dragged.team2.id) ?? new Set<string>())
        : new Set<string>();

      let chosen: { court: string; time: string } | null = null;
      outer: for (const time of slots) {
        if (t1Times.has(time) || t2Times.has(time)) continue;
        for (const court of courts) {
          if (occupied.has(`${court}|${time}`)) continue;
          chosen = { court, time };
          break outer;
        }
      }

      if (!chosen) {
        setConflictAlert({
          title: 'No hay espacio libre ese día',
          body:
            `No queda ningún horario en ${formatDayLabel(targetDay)} donde ` +
            `${shortLabel(dragged)} pueda jugar sin chocar con otro partido ` +
            'de los mismos equipos. Probá con otro día o liberá un slot.',
        });
        return;
      }

      markInFlight([dragged.id], true);
      try {
        // Same placeholder guard as the in-day drop above: don't
        // forward `team.id === ''` to the backend, otherwise the
        // `SELECT id FROM teams WHERE id = ''` returns zero rows and
        // the admin sees "Equipo 1 no encontrado". Omitting the
        // field tells the service to keep whatever was already
        // stored (NULL for unresolved bracket slots).
        const updated = await api.updateMatch(dragged.id, {
          tournamentId: dragged.tournamentId,
          ...(dragged.team1.id ? { team1Id: dragged.team1.id } : {}),
          ...(dragged.team2.id ? { team2Id: dragged.team2.id } : {}),
          date: targetDay,
          time: chosen.time,
          court: chosen.court,
          phase: dragged.phase,
          groupName: dragged.group,
          status: dragged.status,
        });
        onMatchesPatched?.([updated]);
        toast.success(
          `Movido a ${formatDayLabel(targetDay)} · ${chosen.court} · ${chosen.time}.`,
          {
            action: {
              label: 'Ir al día',
              onClick: () => setSelectedDay(targetDay),
            },
          },
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[cronograma] day-move failed', err);
        setConflictAlert({
          title: 'No se pudo cambiar de día',
          body: getErrorMessage(
            err,
            'El servidor rechazó el cambio. Intentá de nuevo o elegí otro día.',
          ),
        });
      } finally {
        markInFlight([dragged.id], false);
      }
    },
    [
      inFlight,
      matches,
      courts,
      timesForDay,
      onMatchesPatched,
      markInFlight,
      shortLabel,
      formatDayLabel,
    ],
  );

  return (
    <div className="space-y-4">
      {/* Header — title + live counter ("12 partidos") so the admin
          sees how many matches the active filter resolves to without
          counting cells. The badge updates as soon as the day or
          category dropdown changes. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-black/60" />
          <h2 className="text-xl font-bold" style={FONT}>
            PROGRAMACIÓN
          </h2>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-sm bg-black text-white text-xs font-bold tabular-nums"
            style={FONT}
            title={
              selectedCategory === 'all'
                ? 'Partidos programados ese día'
                : 'Partidos del día filtrados por categoría'
            }
          >
            {visibleMatchCount}{' '}
            {visibleMatchCount === 1 ? 'partido' : 'partidos'}
          </span>
        </div>
        <span className="text-xs text-black/50">
          Arrastrá para mover, soltá en una celda ocupada para intercambiar.
          Para cambiar de día, tocá el ícono de calendario en la cartica del
          partido.
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
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue placeholder="Elegí un día" />
            </SelectTrigger>
            <SelectContent>
              {days.map((d) => {
                const stats = dayStats.get(d) ?? { total: 0, bracket: 0 };
                // Flag days that fall outside the tournament's
                // official start..end window. They only appear here
                // because there are matches stuck on them (the
                // bracket auto-scheduler overflowed past endDate);
                // surface that visually so the admin knows to drag
                // those cards back into the official range.
                const startIso = toIso(tournament.startDate);
                const endIso = toIso(tournament.endDate) || startIso;
                const outsideRange =
                  !!startIso && (d < startIso || d > endIso);
                return (
                  <SelectItem key={d} value={d}>
                    <span className="flex items-center gap-2 w-full">
                      <span>{formatDayLabel(d)}</span>
                      {stats.total > 0 && (
                        <span className="text-[10px] font-bold text-black/55 tabular-nums">
                          · {stats.total}
                        </span>
                      )}
                      {outsideRange && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider"
                          style={FONT}
                          title="Este día está fuera del rango oficial del torneo. Arrastrá las carticas a un día válido."
                        >
                          Fuera del rango
                        </span>
                      )}
                      {/* Pill rojo cuando el día tiene matches del
                          bracket (cuartos/semis/final/3°). El admin ve
                          de un vistazo dónde está la eliminatoria sin
                          tener que abrir cada día. */}
                      {stats.bracket > 0 && (
                        <span
                          className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-sm bg-spk-red/15 text-spk-red text-[9px] font-bold uppercase tracking-wider"
                          style={FONT}
                        >
                          {stats.bracket} cruce{stats.bracket === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
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
                days={days}
                currentDay={toIso(m.date)}
                onMoveToDay={handleMoveToDay}
                formatDayLabel={formatDayLabel}
                isInFlight={inFlight.has(m.id)}
                tournament={tournament}
              />
            ))}
          </div>
        </div>
      )}

      {/* The grid — explicit row/column placement so multi-row cards
          (long-duration categories) span N rows naturally. Row 1 is
          the sticky court header band; rows 2..N+1 are time slots.
          Each cell knows its (rowStart, span) and CSS Grid handles
          the layout. Covered cells (positions a multi-row card paints
          over) are skipped — drops there are intentionally blocked so
          a card never lands "mid-other-card". */}
      <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `60px repeat(${courts.length}, minmax(180px, 1fr))`,
              gridAutoRows: 'minmax(72px, auto)',
            }}
          >
            {/* Top-left empty corner — row 1, col 1 */}
            <div
              className="sticky top-0 left-0 z-20 bg-white border-b border-r border-black/10"
              style={{ gridRow: 1, gridColumn: 1 }}
            />
            {/* Court headers — row 1, cols 2..N+1.
                Bumped from text-xs + left-aligned to text-base + centered
                so the column owner reads at-a-glance ("INEM CANCHA 1" no
                longer hugs the left edge of an 180px+ column). Vertical
                divider between adjacent court headers makes the grid
                read as a stadium scoreboard rather than a continuous
                black bar. */}
            {courts.map((court, colIdx) => (
              <div
                key={court}
                className={`sticky top-0 z-10 bg-black text-white px-4 py-3 border-b border-black/10 flex items-center justify-center text-center ${
                  colIdx > 0 ? 'border-l border-white/10' : ''
                }`}
                style={{ gridRow: 1, gridColumn: colIdx + 2 }}
              >
                <div
                  className="text-sm sm:text-base font-bold uppercase tracking-widest truncate"
                  style={FONT}
                  title={court}
                >
                  {court}
                </div>
              </div>
            ))}

            {/* Time labels — col 1, rows 2..N+1 */}
            {times.map((time, rowIdx) => (
              <div
                key={`time-${time}`}
                className="sticky left-0 z-10 bg-white border-b border-r border-black/10 px-2 py-2 text-xs font-bold text-black/70 tabular-nums"
                style={{ gridRow: rowIdx + 2, gridColumn: 1, ...FONT }}
              >
                {time}
              </div>
            ))}

            {/* Cells — one per (court, time), with multi-row spans for
                long-duration matches. Skip ONLY empty cells that are
                covered by a span from above (their area is visually
                filled by the spanning card). When a covered cell has
                its OWN matches starting there (data overlap — two
                rounds picked the same court+time), we MUST render
                those matches; otherwise the data exists in the API
                but the admin can't see it in the grid. The render
                shows them as a stacked Cell with a conflict indicator
                so the admin notices and can fix via drag-drop. */}
            {courts.flatMap((court, colIdx) =>
              times.map((time, rowIdx) => {
                const key = `${court}|${time}`;
                const cellMatches = matchesByCell.get(key) ?? [];
                // Empty AND covered → the spanning card paints it; skip.
                if (coveredCells.has(key) && cellMatches.length === 0) {
                  return null;
                }
                // Span = max of placed cards' spans (so a 90-min
                // Senior in a 30-min stride takes 3 rows even when
                // sitting next to a 30-min Sub-13).
                let span = 1;
                for (const m of cellMatches) {
                  const s = spanFor(m);
                  if (s > span) span = s;
                }
                // Covered cell with matches: clamp to span 1 so the
                // overlap-card doesn't extend FURTHER into already-
                // covered rows. Visually it still overlaps with the
                // spanning card from above (revealing the conflict)
                // but doesn't cascade the gap.
                if (coveredCells.has(key)) span = 1;
                // Don't let a span overshoot the day's last row — the
                // card just clamps to whatever's left on the grid.
                const maxAvailable = times.length - rowIdx;
                const renderSpan = Math.min(span, maxAvailable);
                const isOverlap = coveredCells.has(key);
                return (
                  <Cell
                    key={key}
                    court={court}
                    time={time}
                    matches={cellMatches}
                    categoryColorMap={categoryColorMap}
                    getMatchCategory={getMatchCategory}
                    onDrop={handleDrop}
                    onMoveToDay={handleMoveToDay}
                    days={days}
                    selectedDay={selectedDay}
                    formatDayLabel={formatDayLabel}
                    inFlight={inFlight}
                    tournament={tournament}
                    gridRow={rowIdx + 2}
                    gridColumn={colIdx + 2}
                    rowSpan={renderSpan}
                    isOverlap={isOverlap}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>

      {/* Big red unrecoverable-conflict alert. Keeps the admin from
          missing a failure mid-drag the way a small toast can — once
          shown, the alert blocks the rest of the UI until dismissed. */}
      <AlertDialog
        open={conflictAlert !== null}
        onOpenChange={(open) => {
          if (!open) setConflictAlert(null);
        }}
      >
        <AlertDialogContent className="border-2 border-red-600">
          <AlertDialogHeader>
            <AlertDialogTitle
              className="flex items-center gap-2 text-red-700 text-xl"
              style={FONT}
            >
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              {conflictAlert?.title ?? 'Conflicto'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-black/80 whitespace-pre-line">
              {conflictAlert?.body ?? ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => setConflictAlert(null)}
            >
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

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
  onMoveToDay: (m: Match, targetDay: string) => void;
  days: string[];
  selectedDay: string;
  formatDayLabel: (iso: string) => string;
  inFlight: Set<string>;
  /**
   * Tournament for resolving the per-category duration on each card —
   * drives the badge "60' → termina 15:00" and the cell's row span.
   * Optional so the orphans banner (which doesn't have grid context)
   * can omit it.
   */
  tournament?: Tournament;
  /** CSS Grid placement (1-indexed). */
  gridRow: number;
  gridColumn: number;
  /** How many rows this cell occupies. 1 = the previous behaviour. */
  rowSpan: number;
  /**
   * True when this cell sits in a row-range covered by a longer
   * spanning card from above AND has its own match(es) starting here
   * (a data overlap — two matches on the same court+time). The cell
   * gets a red dashed outline + warning badge so the admin sees the
   * conflict instead of having the matches silently hidden.
   */
  isOverlap?: boolean;
}

function Cell({
  court,
  time,
  matches,
  categoryColorMap,
  getMatchCategory,
  onDrop,
  onMoveToDay,
  days,
  selectedDay,
  formatDayLabel,
  inFlight,
  tournament,
  gridRow,
  gridColumn,
  rowSpan,
  isOverlap,
}: CellProps) {
  const [{ isOver, canDrop }, drop] = useDrop<
    { match: Match },
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: MATCH_DND_TYPE,
    // Refuse drops when the dragged match itself is locked. Cells stay
    // hot for other (idle) matches — the previous global `busy` flag
    // froze every cell during a save and made the grid feel broken.
    drop: (item) => onDrop(item.match, court, time),
    canDrop: (item) => !inFlight.has(item.match.id),
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [court, time, onDrop, inFlight]);

  const dropTint = isOver && canDrop ? 'bg-spk-red/5 ring-2 ring-spk-red/40 ring-inset' : '';
  const isStacked = matches.length > 1;
  // Overlap = cell sits on top of a spanning card from above and has
  // its own match(es). Use a red dashed outline + raised z-index so
  // the overlapping card is visually distinct and on top of the
  // spanning card's painted area (grid items at the same area stack
  // by source order; we want the overlap-card visible).
  const overlapStyles = isOverlap
    ? 'ring-2 ring-red-500 ring-inset bg-white relative z-10 shadow-md'
    : '';

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`border-b border-r border-black/10 p-1.5 transition-colors ${dropTint} ${overlapStyles}`}
      // Inline minHeight beats the Tailwind arbitrary class — turns out
      // `min-h-[72px]` isn't always honoured by CSS Grid items in the
      // browser. Inline style on the grid item enforces the row-track
      // floor so empty cells never collapse to a thin strip.
      style={{
        gridRow: rowSpan > 1 ? `${gridRow} / span ${rowSpan}` : gridRow,
        gridColumn,
        minHeight: 72,
      }}
    >
      {isOverlap && (
        <div
          className="mb-1 text-[9px] font-bold uppercase tracking-wider text-red-700 bg-red-50 border border-red-300 rounded-sm px-1.5 py-0.5"
          style={FONT}
          title="Este partido se superpone con otro que ocupa el mismo bloque horario. Arrastralo a otra hora libre."
        >
          ⚠ Conflicto · arrastrá a otra hora
        </div>
      )}
      {isStacked && !isOverlap && (
        <div
          className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-1.5 py-0.5"
          style={FONT}
          title="Hay más de un partido en esta cancha y hora — arrastrá uno a otra celda para resolver."
        >
          ⚠ {matches.length} partidos en este slot
        </div>
      )}
      {matches.length === 0 ? (
        // Empty drop-target — visible but text-free placeholder. Just
        // a dashed-bordered tinted box that fills the cell so the grid
        // never reads as a white void AND the admin can clearly see
        // "this is a slot you can drop a match into". Hover brightens
        // it so the drop target is unmistakable. minHeight on the
        // wrapper Cell guarantees this never collapses.
        <div
          className="h-full w-full rounded-sm border-2 border-dashed border-black/20 bg-black/[0.035] hover:bg-black/[0.06] transition-colors"
          style={{ minHeight: 60 }}
          aria-hidden="true"
        />
      ) : (
        <div className="space-y-1 h-full flex flex-col">
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              color={categoryColorMap.get(getMatchCategory(m)) ?? CATEGORY_COLORS[0]}
              days={days}
              currentDay={selectedDay}
              onMoveToDay={onMoveToDay}
              formatDayLabel={formatDayLabel}
              isInFlight={inFlight.has(m.id)}
              tournament={tournament}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MatchCardProps {
  match: Match;
  color: typeof CATEGORY_COLORS[0];
  /** Tournament days for the day-picker popover. */
  days: string[];
  /**
   * The day this card is currently rendered under. Disables that
   * option in the popover so "moving to the same day" is a no-op the
   * user can't even pick.
   */
  currentDay: string;
  /** Cross-day move from the popover. Parent finds a free slot. */
  onMoveToDay: (m: Match, targetDay: string) => void;
  formatDayLabel: (iso: string) => string;
  /** True while this match's PUT/SWAP is in flight. */
  isInFlight: boolean;
  /**
   * Tournament for per-category duration lookup (mig 027). Optional so
   * the orphans banner — which renders before the user has chosen a
   * grid context — can omit it and silently fall back to the global
   * default.
   */
  tournament?: Tournament;
}

function MatchCard({
  match,
  color,
  days,
  currentDay,
  onMoveToDay,
  formatDayLabel,
  isInFlight,
  tournament,
}: MatchCardProps) {
  const [dayPickerOpen, setDayPickerOpen] = useState(false);

  const [{ isDragging }, drag, preview] = useDrag<
    { match: Match },
    void,
    { isDragging: boolean }
  >(() => ({
    type: MATCH_DND_TYPE,
    item: { match },
    // Don't let an in-flight card be re-dragged — the previous drop
    // hasn't settled yet and a second drag would race the parent
    // state update.
    canDrag: () => !isInFlight,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }), [match, isInFlight]);

  const opacity = isDragging || isInFlight ? 'opacity-40' : 'opacity-100';
  // Slot label = round-robin letter ("A") OR bracket phase name
  // ("Cuartos · Oro", "Final"). Without the phase fallback the
  // materialised bracket fixtures rendered with no badge in the
  // admin cronograma — admins couldn't tell at a glance whether a
  // card was a Cuartos or a Semifinal slot.
  const groupLabel = match.group?.includes('|')
    ? match.group.split('|').slice(1).join('|')
    : '';
  const phaseLabel = match.phase ? phaseLabelOnly(match.phase) : '';
  const isBracketLabel = !groupLabel && phaseLabel && phaseLabel !== 'grupos';
  const slotLabel = groupLabel || (isBracketLabel ? phaseLabel : '');
  // Bracket fixture is "unresolved" until it's actually live or
  // completed. While `upcoming` the matchup is just a seed-based
  // guess (1°A vs 2°B), so even when the placeholder team objects
  // have names, those names don't represent guaranteed opponents.
  // The card hides them behind a strong blur and shows only the
  // phase label + category colour — same treatment as the public
  // cronograma so admin + spectator views stay consistent.
  const isUnresolved = isBracketLabel && match.status === 'upcoming';
  // Per-category duration + end-time for the badge. Falls back to the
  // global default when no tournament is supplied (orphans banner) so
  // we still surface something useful.
  const durationMin = tournament
    ? getMatchDurationMinutes(match, tournament)
    : 60;
  const endTime = addMinutesToHHMM(match.time ?? '', durationMin);

  return (
    <div
      ref={preview as unknown as React.Ref<HTMLDivElement>}
      className={`${color.bg} ${color.border} border rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing transition-all ${opacity} h-full flex flex-col`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          ref={drag as unknown as React.Ref<HTMLSpanElement>}
          className="text-black/40 hover:text-black/70"
          aria-label="Arrastrar"
        >
          <GripVertical className="w-3 h-3" />
        </span>
        {slotLabel && (
          // Bracket-stage phase labels get a pill outline so they
          // stand out as "this is Cuartos/Semi/Final"; round-robin
          // letters keep the quiet inline label.
          isBracketLabel ? (
            <span
              className={`${color.text} ${color.border} text-[9px] font-bold uppercase tracking-wider border bg-white/70 px-1.5 py-0.5 rounded-sm truncate`}
              style={FONT}
              title={slotLabel}
            >
              {slotLabel}
            </span>
          ) : (
            <span className={`text-[9px] font-bold ${color.text}`} style={FONT}>
              {slotLabel}
            </span>
          )
        )}
        {match.score && !isUnresolved && (
          <span className="ml-auto text-[10px] font-bold tabular-nums text-black/70">
            {match.score.team1}-{match.score.team2}
          </span>
        )}
        {/* Day-picker — small calendar icon. Opens a popover with the
            tournament days; selecting one fires onMoveToDay and the
            parent finds a free (court, time) slot on that day. The
            button isn't part of the drag handle, so clicking it never
            starts a drag. */}
        <Popover open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              disabled={isInFlight}
              aria-label="Cambiar de día"
              title="Cambiar de día"
              className={`${match.score ? '' : 'ml-auto'} text-black/50 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isInFlight ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-52 p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-black/55"
              style={FONT}
            >
              Mover a otro día
            </div>
            <div className="max-h-60 overflow-y-auto">
              {days.map((d) => {
                const isCurrent = d === currentDay;
                // Highlight out-of-range days (matches landed past
                // the tournament's endDate). Same amber pill as the
                // top day-picker so the visual cue is consistent.
                const startIso = tournament
                  ? (tournament.startDate instanceof Date
                      ? tournament.startDate.toISOString().slice(0, 10)
                      : String(tournament.startDate ?? '').slice(0, 10))
                  : '';
                const endIso = tournament
                  ? (tournament.endDate instanceof Date
                      ? tournament.endDate.toISOString().slice(0, 10)
                      : String(tournament.endDate ?? '').slice(0, 10))
                  : startIso;
                const outsideRange =
                  !!startIso && (d < startIso || d > (endIso || startIso));
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      setDayPickerOpen(false);
                      if (!isCurrent) onMoveToDay(match, d);
                    }}
                    className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{formatDayLabel(d)}</span>
                      {outsideRange && (
                        <span
                          className="inline-flex items-center px-1 py-0.5 rounded-sm bg-amber-100 text-amber-800 text-[8px] font-bold uppercase tracking-wider flex-shrink-0"
                          style={FONT}
                          title="Fuera del rango oficial"
                        >
                          Fuera
                        </span>
                      )}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] text-black/40 uppercase flex-shrink-0">
                        Actual
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {/* Teams cluster — wrapped in a flex-1 column with
          justify-center so when the card is TALLER than its content
          (multi-row spans for long categories) the two team rows sit
          centered between the header and the footer instead of
          glueing to the top with a giant blank space below. For
          single-row cards the wrapper has minimal extra height so the
          centering is invisible — content stays compact. When the
          fixture is an unresolved bracket placeholder we blur the
          rows so the admin doesn't read the half-empty matchup as
          real data. */}
      <div
        className={`flex-1 flex flex-col justify-center gap-1.5 ${
          isUnresolved ? 'blur-[3px] opacity-30 select-none pointer-events-none' : ''
        }`}
        aria-hidden={isUnresolved || undefined}
      >
        <div className="flex items-center gap-1.5">
          <TeamAvatar team={match.team1} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team1.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TeamAvatar team={match.team2} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team2.name}
          </span>
        </div>
      </div>
      {/* Time-range + duration badge — shows the EXACT start → end
          time inside the card so a 60-min cell reads "08:00 → 09:00"
          without needing to consult the row label. Duration on the
          right pulls the admin's attention to long categories so they
          understand why the card visually occupies two rows. The
          flex-1 wrapper above already pushes this footer to the
          bottom — no need for `mt-auto` anymore. */}
      {(durationMin > 0 || endTime) && (
        <div
          className="pt-1 flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-black/70"
          style={FONT}
          title={endTime ? `Termina aprox ${endTime}` : 'Duración del partido'}
        >
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Timer className="w-2.5 h-2.5" aria-hidden="true" />
            {match.time}
            {endTime && (
              <>
                <span className="opacity-40">→</span>
                {endTime}
              </>
            )}
          </span>
          <span className="opacity-60 tabular-nums">{durationMin}&prime;</span>
        </div>
      )}
    </div>
  );
}
