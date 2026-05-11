import type { Tournament } from '../../types';

/** Pre-persistence shape of a round-robin / league match. */
export interface MatchFixture {
  team1Id: string;
  team2Id: string;
  phase: string;
  groupName?: string;
  status: 'upcoming';
}

/**
 * Bracket-division tier. `null` / `undefined` → ordinary single-bracket
 * crossings. When the admin chooses "División Oro + Plata" two brackets
 * are generated and each bracket_matches row encodes its tier in the
 * `round` column as the middle pipe segment: "Category|gold|final".
 */
export type BracketTier = 'gold' | 'silver';

/** Pre-persistence shape of a bracket-match slot. */
export interface BracketFixture {
  round: number;
  position: number;
  team1Id: string | null;
  team2Id: string | null;
  roundName: string;
  team1Placeholder?: string;
  team2Placeholder?: string;
}

/** Schedule-generation knobs the admin picks on the Cruces modal. */
export interface ScheduleConfig {
  startTime?: string;
  endTime?: string;
  matchDuration?: number;
  breakDuration?: number;
  courtCount?: number;
  /**
   * Optional per-day overrides keyed by 'YYYY-MM-DD'. Days listed here
   * use the override window; every other day falls back to the
   * top-level `startTime`/`endTime`. Mirrors `tournaments.daily_schedules`
   * (migration 024) so the fixture generator and the repair tool stay
   * in sync.
   */
  dailySchedules?: Record<string, { start: string; end: string }>;
  /**
   * Persisted by migration 025. When provided the scheduler honours
   * them on top of the per-day windows:
   *   · maxMatchesPerDay  → 0 = no cap; >0 forces a day-roll after the
   *                          Nth match is placed.
   *   · deadTimeBlocks    → HH:MM windows the scheduler skips every
   *                          day (lunch, ceremonies, etc.).
   *   · categoryPriority  → ordered list; matches whose category is
   *                          listed earlier get the earliest slots.
   *                          Match.phase encodes the category as
   *                          "Category|round" so we extract it here.
   */
  maxMatchesPerDay?: number;
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  categoryPriority?: string[];
}

/** Minimum team count required to generate fixtures for each format. */
export const MIN_TEAMS: Record<Tournament['format'], number> = {
  groups: 4,
  knockout: 2,
  'groups+knockout': 4,
  league: 3,
};

/** User-facing error message when MIN_TEAMS isn't met. */
export const MIN_TEAMS_MESSAGES: Record<Tournament['format'], string> = {
  groups: 'Se necesitan al menos 4 equipos inscritos para generar cruces en formato de grupos',
  knockout: 'Se necesitan al menos 2 equipos inscritos para generar cruces en formato de eliminación',
  'groups+knockout':
    'Se necesitan al menos 4 equipos inscritos para generar cruces en formato de grupos + eliminación',
  league: 'Se necesitan al menos 3 equipos inscritos para generar cruces en formato de liga',
};
