import type { ScheduleConfig } from './types';

interface FixtureShape {
  team1Id: string;
  team2Id: string;
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

  const results: Array<Slot | null> = new Array(fixtures.length).fill(null);
  const unscheduled = fixtures.map((f, idx) => ({ ...f, __idx: idx }));

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
  };

  while (unscheduled.length > 0 && iterations < maxIterations) {
    iterations++;

    if (currentMinutes + matchDuration > currentWindow.endMin) {
      advanceToNextDay();
      continue;
    }

    const timeStr = formatHHMM(currentMinutes);
    const dateStr = currentDateStr;
    const busyTeams = new Set<string>();
    let assignedInSlot = 0;

    for (let c = 0; c < courtCount && unscheduled.length > 0; c++) {
      const candidateIdx = unscheduled.findIndex(
        (f) => !busyTeams.has(f.team1Id) && !busyTeams.has(f.team2Id),
      );
      if (candidateIdx === -1) break;

      const candidate = unscheduled.splice(candidateIdx, 1)[0];
      busyTeams.add(candidate.team1Id);
      busyTeams.add(candidate.team2Id);
      results[candidate.__idx] = { date: dateStr, time: timeStr, court: courtNames[c] };
      assignedInSlot++;
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
