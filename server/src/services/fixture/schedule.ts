import type { ScheduleConfig } from './types';

interface FixtureShape {
  team1Id: string;
  team2Id: string;
  /**
   * Phase string, optional. Used only for `categoryPriority` sorting:
   * the category prefix lives in the substring before the first '|',
   * matching the `Category|round` encoding the rest of the codebase
   * uses. Pure team-only callers can omit this — the sort becomes a
   * stable no-op.
   */
  phase?: string;
}

interface Slot {
  date: string;
  time: string;
  court: string;
}

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';
const DEFAULT_MATCH_MIN = 60;
const DEFAULT_BREAK_MIN = 15;
const DAYS_BEFORE_ABORT = 500;

/**
 * Assign date/time/court slots to a list of fixtures while making sure
 * no team plays two matches simultaneously.
 *
 * Algorithm:
 *   · Sweep through time slots.
 *   · For each slot, iterate courts; pick the first unscheduled fixture
 *     whose teams aren't busy in that slot.
 *   · If nothing fits a slot, roll to the next day (prevents infinite
 *     loops on packed-tournament dead-ends).
 *   · Output keeps input order — caller zips it back with the fixtures.
 *
 * Fallback at the bottom: if anything stayed unscheduled against a
 * safety cap, place sequentially so every fixture gets a non-null slot.
 */
export function calculateMatchTimes<T extends FixtureShape>(
  fixtures: T[],
  startDate: string,
  courts: string[],
  config?: ScheduleConfig,
): Slot[] {
  const startTime = config?.startTime || DEFAULT_START;
  const endTime = config?.endTime || DEFAULT_END;
  const matchDuration = config?.matchDuration || DEFAULT_MATCH_MIN;
  const breakDuration = config?.breakDuration || DEFAULT_BREAK_MIN;
  const courtCount = config?.courtCount || courts.length || 1;
  const dailySchedules = config?.dailySchedules ?? {};
  // Migration-025 schedule constraints. Defaulting empty/0 keeps legacy
  // callers (and tests with no schedule config) on the previous greedy
  // path: no per-day cap, no dead-time skips, no priority reordering.
  const maxMatchesPerDay =
    typeof config?.maxMatchesPerDay === 'number' && config.maxMatchesPerDay > 0
      ? config.maxMatchesPerDay
      : 0;
  const deadTimeBlocks = Array.isArray(config?.deadTimeBlocks)
    ? config!.deadTimeBlocks!
    : [];
  const categoryPriority = Array.isArray(config?.categoryPriority)
    ? config!.categoryPriority!
    : [];

  const courtNames: string[] = [];
  for (let i = 0; i < courtCount; i++) {
    courtNames.push(courts[i] || `Cancha ${i + 1}`);
  }

  const parseHHMM = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const [h, m] = raw.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
    return h * 60 + m;
  };
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const defaultDayStart = startH * 60 + startM;
  const defaultDayEnd = endH * 60 + endM;
  /**
   * Resolve the active window (in minutes-from-midnight) for a given
   * date, looking up `dailySchedules['YYYY-MM-DD']` first and falling
   * back to the global startTime/endTime. Lets the admin model
   * "Saturday 08:00–22:00, Sunday 08:00–14:00" without forcing every
   * day to share hours.
   */
  const windowForDate = (
    dateStr: string,
  ): { startMin: number; endMin: number } => {
    const override = dailySchedules[dateStr];
    return {
      startMin: parseHHMM(override?.start, defaultDayStart),
      endMin: parseHHMM(override?.end, defaultDayEnd),
    };
  };

  // Pre-compute dead-time block minute ranges once so the per-slot
  // check is O(blocks). A slot is dead if its [startMin, endMin]
  // interval intersects ANY block; we treat a touching boundary as
  // OK (slot ends exactly when block starts → keep the slot).
  const deadRanges: Array<{ startMin: number; endMin: number }> = [];
  for (const block of deadTimeBlocks) {
    const s = parseHHMM(block.start, -1);
    const e = parseHHMM(block.end, -1);
    if (s >= 0 && e > s) deadRanges.push({ startMin: s, endMin: e });
  }
  const slotIntersectsDeadTime = (slotStartMin: number): boolean => {
    const slotEndMin = slotStartMin + matchDuration;
    for (const r of deadRanges) {
      if (slotStartMin < r.endMin && slotEndMin > r.startMin) return true;
    }
    return false;
  };

  // Extract the category prefix from a fixture's phase (e.g.
  // "Benjamín Femenino|grupos" → "Benjamín Femenino"). Returns ''
  // when no phase is set so unphased fixtures don't perturb the sort.
  const categoryOf = (phase: string | undefined): string => {
    if (!phase) return '';
    const idx = phase.indexOf('|');
    return idx === -1 ? phase : phase.substring(0, idx);
  };
  // Map each prioritised category to its rank (lower = earlier slot);
  // anything not listed gets a sentinel rank that lands AFTER the
  // priorities but keeps insertion order amongst itself.
  const categoryRank = new Map<string, number>();
  categoryPriority.forEach((cat, i) => categoryRank.set(cat, i));
  const rankFor = (phase: string | undefined): number => {
    const cat = categoryOf(phase);
    return categoryRank.get(cat) ?? Number.MAX_SAFE_INTEGER;
  };

  const results: Array<Slot | null> = new Array(fixtures.length).fill(null);
  // Build the unscheduled queue and sort by category priority. Stable
  // sort preserves the round-robin order within each category so a
  // priority change doesn't reshuffle previously-paired matchups.
  const unscheduled = fixtures
    .map((f, idx) => ({ ...f, __idx: idx }))
    .sort((a, b) => rankFor(a.phase) - rankFor(b.phase));
  // Tracks how many matches the loop has placed on the current calendar
  // day so we can roll forward once `maxMatchesPerDay` is hit. Reset
  // every time the day cursor advances.
  let matchesAssignedToday = 0;

  const currentDate = new Date(startDate + 'T00:00:00');
  // Track the per-day window so the loop can swap windows when it
  // rolls into the next day. Initialise to the first day's window.
  let currentDateStr = currentDate.toISOString().split('T')[0];
  let currentWindow = windowForDate(currentDateStr);
  let currentMinutes = currentWindow.startMin;
  const maxIterations = DAYS_BEFORE_ABORT * Math.max(1, courtCount);
  let iterations = 0;

  const advanceToNextDay = () => {
    currentDate.setDate(currentDate.getDate() + 1);
    currentDateStr = currentDate.toISOString().split('T')[0];
    currentWindow = windowForDate(currentDateStr);
    currentMinutes = currentWindow.startMin;
    matchesAssignedToday = 0;
  };

  while (unscheduled.length > 0 && iterations < maxIterations) {
    iterations++;

    if (currentMinutes + matchDuration > currentWindow.endMin) {
      advanceToNextDay();
      continue;
    }

    // Per-day cap (migration 025). When the admin sets `maxMatchesPerDay`
    // we stop packing more than N matches into a single calendar day,
    // even if the window still has room. 0 = no cap.
    if (maxMatchesPerDay > 0 && matchesAssignedToday >= maxMatchesPerDay) {
      advanceToNextDay();
      continue;
    }

    // Dead-time skip (migration 025). When this slot overlaps with a
    // configured block (lunch, ceremony, etc.) we advance past it
    // without trying to assign matches.
    if (slotIntersectsDeadTime(currentMinutes)) {
      currentMinutes += matchDuration + breakDuration;
      continue;
    }

    const timeStr = formatHHMM(currentMinutes);
    const dateStr = currentDateStr;
    const busyTeams = new Set<string>();
    let assignedInSlot = 0;

    for (let c = 0; c < courtCount && unscheduled.length > 0; c++) {
      // Stop placing on this slot once the per-day cap fires mid-slot
      // — otherwise a single 4-court slot could overshoot the cap by
      // up to 3 matches.
      if (maxMatchesPerDay > 0 && matchesAssignedToday >= maxMatchesPerDay) {
        break;
      }
      const candidateIdx = unscheduled.findIndex(
        (f) => !busyTeams.has(f.team1Id) && !busyTeams.has(f.team2Id),
      );
      if (candidateIdx === -1) break;

      const candidate = unscheduled.splice(candidateIdx, 1)[0];
      busyTeams.add(candidate.team1Id);
      busyTeams.add(candidate.team2Id);
      results[candidate.__idx] = { date: dateStr, time: timeStr, court: courtNames[c] };
      assignedInSlot++;
      matchesAssignedToday++;
    }

    currentMinutes += matchDuration + breakDuration;

    // If the slot was completely empty AND there are still matches to
    // place, bump to the next day so we don't spin endlessly.
    if (assignedInSlot === 0 && unscheduled.length > 0) {
      advanceToNextDay();
    }
  }

  if (results.some((r) => r === null)) {
    // Fallback uses the FIRST day's window — the unresolved leftovers
    // get sequential slots from there. Edge case for tournaments with
    // very tight per-day windows; the main loop handles 99% of cases.
    const fallbackWindow = windowForDate(
      new Date(startDate + 'T00:00:00').toISOString().split('T')[0],
    );
    fillFallback(
      results,
      startDate,
      fallbackWindow.startMin,
      fallbackWindow.endMin,
      matchDuration,
      breakDuration,
      courtNames[0],
    );
  }

  return results as Slot[];
}

function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function fillFallback(
  results: Array<Slot | null>,
  startDate: string,
  dayStartMinutes: number,
  dayEndMinutes: number,
  matchDuration: number,
  breakDuration: number,
  defaultCourt: string,
): void {
  let minutes = dayStartMinutes;
  const date = new Date(startDate + 'T00:00:00');
  for (let i = 0; i < results.length; i++) {
    if (results[i]) continue;
    if (minutes + matchDuration > dayEndMinutes) {
      date.setDate(date.getDate() + 1);
      minutes = dayStartMinutes;
    }
    results[i] = {
      date: date.toISOString().split('T')[0],
      time: formatHHMM(minutes),
      court: defaultCourt,
    };
    minutes += matchDuration + breakDuration;
  }
}
