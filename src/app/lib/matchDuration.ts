import type { Match, Tournament } from '../types';
import { categoryOfMatch } from './phase';

/** Hard fallback when neither the tournament nor a category override
 *  declares a duration. Mirrors the backend default. */
export const DEFAULT_MATCH_DURATION_MIN = 60;

/**
 * Resolve the expected match duration in MINUTES for a given match,
 * honouring the migration-027 priority chain:
 *
 *   1. `tournament.matchDurationsByCategory[<categoryOfMatch>]`
 *   2. `tournament.matchDurationMinutes` (the global default)
 *   3. `DEFAULT_MATCH_DURATION_MIN` (60)
 *
 * The lookup is tournament-scoped so the SAME match resolves
 * differently depending on which tournament's config we're rendering
 * under (live tournament vs another's view of the same team's history).
 *
 * Pass `tournament` undefined to use only the global default + the
 * hardcoded fallback — useful for callers that don't have the
 * tournament loaded but still want to render a sensible duration.
 */
export function getMatchDurationMinutes(
  match: Pick<Match, 'group' | 'phase'>,
  tournament: Pick<
    Tournament,
    'matchDurationMinutes' | 'matchDurationsByCategory'
  > | null | undefined,
): number {
  const overrides = tournament?.matchDurationsByCategory ?? {};
  const cat = categoryOfMatch(match);
  if (cat) {
    const override = overrides[cat];
    if (typeof override === 'number' && override > 0) return override;
  }
  const globalDefault = tournament?.matchDurationMinutes;
  if (typeof globalDefault === 'number' && globalDefault > 0) {
    return globalDefault;
  }
  return DEFAULT_MATCH_DURATION_MIN;
}

/**
 * Compute the expected match end time as 'HH:MM' given a start time
 * and a duration. Returns '' when the inputs aren't parseable so
 * callers can render the badge unconditionally.
 */
export function addMinutesToHHMM(start: string, addMinutes: number): string {
  if (!start || !/^\d{1,2}:\d{2}$/.test(start)) return '';
  const [h, m] = start.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const total = h * 60 + m + addMinutes;
  if (total < 0) return '';
  const finalH = Math.floor(total / 60) % 24;
  const finalM = total % 60;
  return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
}

/**
 * One-shot: returns the end-time string for `match` under
 * `tournament`'s schedule defaults. Empty string when the start time
 * isn't parseable.
 */
export function getMatchEndTime(
  match: Pick<Match, 'group' | 'phase' | 'time'>,
  tournament: Pick<
    Tournament,
    'matchDurationMinutes' | 'matchDurationsByCategory'
  > | null | undefined,
): string {
  const dur = getMatchDurationMinutes(match, tournament);
  return addMinutesToHHMM(match.time ?? '', dur);
}
