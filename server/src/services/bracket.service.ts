import { getPool } from '../config/database';
import { BracketMatch, Team } from '../types';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

// ── Bracket-round → match.phase mapping ────────────────────────────
//
// `bracket_matches.round` carries up to three pipe segments:
//   · "final"                       (legacy, single-category)
//   · "Category|final"              (multi-category, no division)
//   · "Category|gold|final"         (Oro / Plata división)
//
// Materialized matches need a `phase` value in the format
// "<roundLabel>|<category>" so the existing `categoryOfMatchPhase`
// helper keeps extracting the right category. The tier suffix lives
// inside the round label so a single-pipe split still works
// downstream — e.g. "Cuartos · Oro|Mayores Femenino".

function prettyRoundName(roundName: string): string {
  switch (roundName) {
    case 'cuartos':
      return 'Cuartos';
    case 'semifinal':
      return 'Semifinal';
    case 'final':
      return 'Final';
    case 'tercer-puesto':
      return 'Tercer puesto';
    default: {
      // Generic "ronda-N" → "Ronda N"
      const ronda = roundName.match(/^ronda-(\d+)$/);
      if (ronda) return `Ronda ${ronda[1]}`;
      // Fallback: capitalize first letter of any other custom label
      return roundName.charAt(0).toUpperCase() + roundName.slice(1);
    }
  }
}

function tierSuffix(tier: 'gold' | 'silver' | null): string {
  if (tier === 'gold') return ' · Oro';
  if (tier === 'silver') return ' · Plata';
  return '';
}

/** Parse a bracket_matches.round string into its three logical parts. */
function parseBracketRound(round: string): {
  category: string;
  tier: 'gold' | 'silver' | null;
  roundName: string;
} {
  const parts = round.split('|');
  if (parts.length >= 3 && (parts[1] === 'gold' || parts[1] === 'silver')) {
    return { category: parts[0], tier: parts[1] as 'gold' | 'silver', roundName: parts.slice(2).join('|') };
  }
  if (parts.length >= 2) {
    return { category: parts[0], tier: null, roundName: parts.slice(1).join('|') };
  }
  return { category: '', tier: null, roundName: round };
}

/**
 * Build the `match.phase` string for a materialized bracket match. The
 * format mirrors the existing "phase|category" convention used by
 * round-robin matches (see `generateRoundRobin`), so the public
 * `categoryOfMatchPhase` helper splits it correctly.
 *
 *   · "Cat|gold|cuartos"  → "Cuartos · Oro|Cat"
 *   · "Cat|final"         → "Final|Cat"
 *   · "semifinal"         → "Semifinal"        (legacy single-category)
 */
function bracketRoundToMatchPhase(round: string): string {
  const { category, tier, roundName } = parseBracketRound(round);
  const label = `${prettyRoundName(roundName)}${tierSuffix(tier)}`;
  return category ? `${label}|${category}` : label;
}

// ── Schedule defaults for materialized bracket matches ─────────────
//
// Kept in lockstep with the values in `fixture/schedule.ts`. We cannot
// import them from there without pulling the whole scheduler into this
// file, and bracket materialization does NOT need the conflict-aware
// sweep (each bracket round is sequential by construction). A simple
// court-rotating cursor is enough.

const DEFAULT_DAY_START_MIN = 8 * 60;
const DEFAULT_DAY_END_MIN = 18 * 60;
const DEFAULT_MATCH_MIN = 60;
const DEFAULT_BREAK_MIN = 15;

function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// ── Cross-group cumulative ranking for VNL seeding ─────────────────
//
// Every bracket flow that talks about "seed N" used to mean "Nth team
// alphabetically in the group letter list" (1°A, 1°B, … 2°A, 2°B). The
// FIVB / VNL convention is different: seed 1 is the team with the BEST
// cumulative record across all groups, not whoever happens to top
// group A. This helper computes that ranking from the standings table.
//
// Tiebreakers, in order (mirrors `StandingsTab.tsx#rankCategory` so the
// public Clasificación and the bracket seeds always agree on who's
// "best of silver"):
//   1. points DESC (3 for 3-0 / 3-1, 2 for 3-2, 1 for 2-3, 0 for 0-3 / 1-3)
//   2. set difference DESC (sets_for - sets_against)
//   3. rally-point ratio DESC (points_for / points_against) — FIVB
//      tiebreaker, decides 5/4-set ties on actual rally performance
//   4. sets_for DESC
//   5. wins DESC
//   6. group position ASC (1°A beats 2°B if everything above ties)
//   7. team_id ASC (deterministic order so re-runs produce the same seed)
//
// Only teams with at least one played match are considered — a 0-0
// row would otherwise tie every other 0-0 row and the bracket would
// seed against an alphabetical ghost ranking.

interface RankingCandidate {
  team_id: string;
  group_name: string | null;
  position: number;
  played: number;
  wins: number;
  sets_for: number;
  sets_against: number;
  points_for: number;
  points_against: number;
  points: number;
}

function compareRankingRows(a: RankingCandidate, b: RankingCandidate): number {
  if (a.points !== b.points) return b.points - a.points;
  const dA = a.sets_for - a.sets_against;
  const dB = b.sets_for - b.sets_against;
  if (dA !== dB) return dB - dA;
  // Rally-point ratio: a.points_against === 0 falls back to raw
  // points_for so a team that's only played sweeps doesn't get
  // shoved by a divide-by-zero. Same shape as StandingsTab.
  const rA = a.points_against === 0 ? a.points_for : a.points_for / a.points_against;
  const rB = b.points_against === 0 ? b.points_for : b.points_for / b.points_against;
  if (rA !== rB) return rB - rA;
  if (a.sets_for !== b.sets_for) return b.sets_for - a.sets_for;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.position !== b.position) return a.position - b.position;
  return a.team_id.localeCompare(b.team_id);
}

/**
 * Pull the standings rows that belong to a category and a set of group
 * positions (e.g. [1, 2] for Oro classifiers), then rank them
 * cumulatively across groups using {@link compareRankingRows}.
 */
export async function computeCumulativeRanking(
  tournamentId: string,
  category: string,
  positions: number[],
): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT team_id, group_name, position, played, wins,
            sets_for, sets_against, points_for, points_against, points
       FROM standings
       WHERE tournament_id = $1
         AND group_name LIKE $2
         AND position = ANY($3)
         AND played > 0`,
    [tournamentId, `${category}|%`, positions],
  );
  const rows = result.rows as RankingCandidate[];
  rows.sort(compareRankingRows);
  return rows.map((r) => r.team_id);
}

// ── VNL slot-index helpers (mirror of autoSeeding.ts in fixture/) ──
//
// Duplicated here so the resolver can map a bracket position to its
// VNL seed index without dragging in fixture.service. The recursive
// pattern is short enough that copying it is cheaper than refactoring
// the import graph (bracket.service is imported by fixture.service —
// reversing the dependency would create a cycle).

function nextPow2Local(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

function bracketSeedOrderLocal(n: number): number[] {
  if (n < 2 || (n & (n - 1)) !== 0) return [];
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, size + 1 - s);
    order = next;
  }
  return order;
}

/**
 * Normalize a value coming back from a pg DATE / TIMESTAMP column into
 * a Date set to local midnight. Accepts:
 *   - Date instances (pg's default for DATE/TIMESTAMP)
 *   - "YYYY-MM-DD" strings
 *   - "YYYY-MM-DDTHH:mm:ss(.sss)Z" ISO strings
 *   - null / undefined  → returns null so the caller can fall back
 *
 * Critical for the bracket materializer: passing the raw Date through a
 * `value + 'T00:00:00'` template produced "Invalid time value" errors
 * because JS coerced the Date to its full string form first.
 */
function parseDbDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Strip the time-of-day so the cursor starts at midnight regardless
    // of what timezone pg / our local box is in.
    return new Date(value.toISOString().slice(0, 10) + 'T00:00:00');
  }
  if (typeof value === 'string') {
    const tIdx = value.indexOf('T');
    const datePart = tIdx === -1 ? value : value.slice(0, tIdx);
    const parsed = new Date(datePart + 'T00:00:00');
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  return null;
}

/** YYYY-MM-DD slug for a Date (assumes the Date is at local midnight). */
function dateToSlug(d: Date): string {
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function mapBracketRow(row: Record<string, unknown>): BracketMatch {
  const match: BracketMatch = {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    team1Id: row.team1_id as string | undefined,
    team2Id: row.team2_id as string | undefined,
    winnerId: row.winner_id as string | undefined,
    scoreTeam1: row.score_team1 != null ? (row.score_team1 as number) : undefined,
    scoreTeam2: row.score_team2 != null ? (row.score_team2 as number) : undefined,
    status: row.status as BracketMatch['status'],
    round: row.round as string,
    position: row.position as number,
    team1Placeholder: row.team1_placeholder as string | undefined,
    team2Placeholder: row.team2_placeholder as string | undefined,
  };

  // Attach team data if joined
  if (row.team1_name) {
    match.team1 = {
      id: row.team1_id as string,
      name: row.team1_name as string,
      initials: row.team1_initials as string,
      logo: row.team1_logo as string | undefined,
      primaryColor: row.team1_primary_color as string,
      secondaryColor: row.team1_secondary_color as string,
    };
  }
  if (row.team2_name) {
    match.team2 = {
      id: row.team2_id as string,
      name: row.team2_name as string,
      initials: row.team2_initials as string,
      logo: row.team2_logo as string | undefined,
      primaryColor: row.team2_primary_color as string,
      secondaryColor: row.team2_secondary_color as string,
    };
  }

  return match;
}

/**
 * Round names for a bracket of `teamCount` teams. Mirrors
 * `getRoundName` in `fixture/algorithms.ts` so a 16-slot bracket
 * produces ['ronda-1', 'cuartos', 'semifinal', 'final'] (4 rounds)
 * — not ['cuartos', 'semifinal', 'final'] (3 rounds) which would
 * break advanceWinner for the first round of a 16+ bracket.
 *
 * Examples:
 *   ·  2 teams →                                  ['final']
 *   ·  4 teams →                       ['semifinal', 'final']
 *   ·  8 teams →            ['cuartos', 'semifinal', 'final']
 *   · 16 teams → ['ronda-1', 'cuartos', 'semifinal', 'final']
 *   · 32 teams → ['ronda-1', 'ronda-2', 'cuartos', 'semifinal', 'final']
 */
function getRounds(teamCount: number): string[] {
  if (teamCount < 2) return [];
  const totalRounds = Math.ceil(Math.log2(teamCount));
  const rounds: string[] = [];
  for (let i = 0; i < totalRounds; i++) {
    const fromEnd = totalRounds - 1 - i;
    if (fromEnd === 0) rounds.push('final');
    else if (fromEnd === 1) rounds.push('semifinal');
    else if (fromEnd === 2) rounds.push('cuartos');
    else rounds.push(`ronda-${i + 1}`);
  }
  return rounds;
}

/**
 * Returns the number of matches in a given round based on team count.
 */
function getMatchCountForRound(round: string, teamCount: number): number {
  const rounds = getRounds(teamCount);
  const roundIndex = rounds.indexOf(round);
  if (roundIndex === -1) return 0;

  // The first round has teamCount/2 matches, each subsequent round halves
  let matches = Math.floor(teamCount / 2);
  for (let i = 0; i < roundIndex; i++) {
    matches = Math.floor(matches / 2);
  }
  return matches;
}

/**
 * Returns the next round name, or null if it's the final.
 */
function getNextRound(currentRound: string, teamCount: number): string | null {
  const rounds = getRounds(teamCount);
  const idx = rounds.indexOf(currentRound);
  if (idx === -1 || idx === rounds.length - 1) return null;
  return rounds[idx + 1];
}

export class BracketGenerator {
  /**
   * Generate bracket structure for a tournament.
   * Clears any existing bracket matches and creates new ones.
   * Teams are seeded by their order in the qualifiedTeams array (index 0 = seed 1).
   *
   * For 8 teams: 4 quarter-final + 2 semi-final + 1 final = 7 matches
   * For 4 teams: 2 semi-final + 1 final = 3 matches
   * For 2 teams: 1 final = 1 match
   */
  async generate(tournamentId: string, qualifiedTeams: Team[]): Promise<BracketMatch[]> {
    const pool = getPool();

    // Verify tournament exists
    const tournamentResult = await pool.query(
      'SELECT id FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      throw new NotFoundError('Torneo');
    }

    const teamCount = qualifiedTeams.length;
    if (teamCount < 2) {
      throw new ValidationError('Se necesitan al menos 2 equipos para generar un bracket');
    }

    const rounds = getRounds(teamCount);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Clear existing bracket for this tournament
      await client.query('DELETE FROM bracket_matches WHERE tournament_id = $1', [tournamentId]);

      const bracketMatches: BracketMatch[] = [];

      // Generate matches for each round
      for (const round of rounds) {
        const matchCount = getMatchCountForRound(round, teamCount);

        for (let position = 1; position <= matchCount; position++) {
          let team1Id: string | null = null;
          let team2Id: string | null = null;

          // Only assign teams to the first round
          if (round === rounds[0]) {
            // Seeding: position 1 gets seed 1 vs last seed, etc.
            // For standard bracket seeding with N teams:
            // Match 1: seed 1 vs seed N
            // Match 2: seed 2 vs seed N-1
            // etc.
            const seed1Index = position - 1;
            const seed2Index = teamCount - position;

            if (seed1Index < qualifiedTeams.length) {
              team1Id = qualifiedTeams[seed1Index].id;
            }
            if (seed2Index < qualifiedTeams.length && seed2Index !== seed1Index) {
              team2Id = qualifiedTeams[seed2Index].id;
            }
          }

          const result = await client.query(
            `INSERT INTO bracket_matches (tournament_id, team1_id, team2_id, status, round, position)
             VALUES ($1, $2, $3, 'upcoming', $4, $5)
             RETURNING *`,
            [tournamentId, team1Id, team2Id, round, position]
          );

          bracketMatches.push(mapBracketRow(result.rows[0]));
        }
      }

      await client.query('COMMIT');
      return bracketMatches;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Advance the winner of a bracket match to the next round.
   * Handles compound round names with category prefix.
   */
  async advanceWinner(bracketMatchId: string, winnerId: string): Promise<BracketMatch> {
    const pool = getPool();

    // Get the bracket match
    const matchResult = await pool.query(
      'SELECT * FROM bracket_matches WHERE id = $1',
      [bracketMatchId]
    );
    if (matchResult.rows.length === 0) {
      throw new NotFoundError('Partido de bracket');
    }

    const bracketMatch = matchResult.rows[0];
    const team1Id = bracketMatch.team1_id as string | null;
    const team2Id = bracketMatch.team2_id as string | null;

    // Validate the winner is one of the two teams
    if (winnerId !== team1Id && winnerId !== team2Id) {
      throw new ValidationError('El ganador debe ser uno de los dos equipos del partido');
    }

    // Update the bracket match with the winner and mark as completed
    await pool.query(
      `UPDATE bracket_matches SET winner_id = $1, status = 'completed' WHERE id = $2`,
      [winnerId, bracketMatchId]
    );

    const tournamentId = bracketMatch.tournament_id as string;
    const currentRound = bracketMatch.round as string;
    const currentPosition = bracketMatch.position as number;

    // Parse category prefix + tier + round name from the round string.
    // Three supported shapes:
    //   · "final"                      → legacy single-category
    //   · "Category|final"             → category-scoped, non-tiered
    //   · "Category|gold|final"        → Oro/Plata división (tier middle)
    const rawParts = currentRound.includes('|') ? currentRound.split('|') : [currentRound];
    let categoryPrefix = '';
    let tierSegment: 'gold' | 'silver' | '' = '';
    let roundName = currentRound;
    if (rawParts.length >= 3 && (rawParts[1] === 'gold' || rawParts[1] === 'silver')) {
      categoryPrefix = rawParts[0];
      tierSegment = rawParts[1] as 'gold' | 'silver';
      roundName = rawParts.slice(2).join('|');
    } else if (rawParts.length >= 2) {
      categoryPrefix = rawParts[0];
      roundName = rawParts.slice(1).join('|');
    }

    const prefixRound = (name: string) => {
      if (categoryPrefix && tierSegment) return `${categoryPrefix}|${tierSegment}|${name}`;
      if (categoryPrefix) return `${categoryPrefix}|${name}`;
      return name;
    };

    // Determine total teams in the bracket to figure out rounds. Scope
    // the count to the SAME sub-bracket: when the round is tiered, only
    // count rows of the same tier (Oro ≠ Plata). When non-tiered, only
    // count 2-segment rows of that category so coexisting tiered rows
    // don't inflate the count.
    const allMatchesResult = await pool.query(
      'SELECT round, position FROM bracket_matches WHERE tournament_id = $1 ORDER BY round, position',
      [tournamentId]
    );

    const tierRoundPrefix = tierSegment ? `${categoryPrefix}|${tierSegment}|` : '';
    const sameCategoryMatches = allMatchesResult.rows.filter((r: Record<string, unknown>) => {
      const rRound = r.round as string;
      if (categoryPrefix && tierSegment) {
        return rRound.startsWith(tierRoundPrefix) && !rRound.endsWith('|tercer-puesto');
      }
      if (categoryPrefix) {
        if (rRound.endsWith('|tercer-puesto')) return false;
        if (!rRound.startsWith(categoryPrefix + '|')) return false;
        // Exclude any tiered rows so the single-bracket count stays clean.
        const parts = rRound.split('|');
        if (parts.length >= 3 && (parts[1] === 'gold' || parts[1] === 'silver')) return false;
        return true;
      }
      return !rRound.includes('|') && rRound !== 'tercer-puesto';
    });

    const roundCounts = new Map<string, number>();
    for (const r of sameCategoryMatches) {
      const round = r.round as string;
      roundCounts.set(round, (roundCounts.get(round) || 0) + 1);
    }
    let maxCount = 0;
    for (const [, count] of roundCounts) {
      if (count > maxCount) {
        maxCount = count;
      }
    }
    const teamCount = maxCount * 2;

    const nextRound = getNextRound(roundName, teamCount);

    if (nextRound) {
      // Determine which next-round match and slot (team1 or team2) the winner goes to
      const nextPosition = Math.ceil(currentPosition / 2);
      const isTeam1Slot = currentPosition % 2 === 1;

      const column = isTeam1Slot ? 'team1_id' : 'team2_id';
      const prefixedNextRound = prefixRound(nextRound);

      await pool.query(
        `UPDATE bracket_matches SET ${column} = $1
         WHERE tournament_id = $2 AND round = $3 AND position = $4`,
        [winnerId, tournamentId, prefixedNextRound, nextPosition]
      );
    }

    // If this is a semifinal, send the loser to the 3rd place match
    if (roundName === 'semifinal') {
      const loserId = winnerId === team1Id ? team2Id : team1Id;
      if (loserId) {
        const thirdPlaceRound = prefixRound('tercer-puesto');
        const thirdPlaceResult = await pool.query(
          `SELECT id, team1_id, team2_id FROM bracket_matches
           WHERE tournament_id = $1 AND round = $2
           LIMIT 1`,
          [tournamentId, thirdPlaceRound]
        );
        if (thirdPlaceResult.rows.length > 0) {
          const tp = thirdPlaceResult.rows[0];
          if (!tp.team1_id) {
            await pool.query(
              `UPDATE bracket_matches SET team1_id = $1 WHERE id = $2`,
              [loserId, tp.id]
            );
          } else if (!tp.team2_id) {
            await pool.query(
              `UPDATE bracket_matches SET team2_id = $1 WHERE id = $2`,
              [loserId, tp.id]
            );
          }
        }
      }
    }

    // Read the updated bracket row BEFORE materialization so the
    // caller's response data is independent of any materializer errors
    // (also keeps the existing test fixtures' mock queue layout intact).
    const updatedResult = await pool.query(
      'SELECT * FROM bracket_matches WHERE id = $1',
      [bracketMatchId]
    );
    const updated = mapBracketRow(updatedResult.rows[0]);

    // After the winner propagates, the next-round slot may have just
    // been filled (this side or the opposite). Materialize so a playable
    // match shows up immediately in the public list / referee console.
    // Best-effort: never block advancement on a materialization error.
    try {
      await this.materializePendingBracketMatches(tournamentId);
    } catch (err) {
      console.warn('[advanceWinner] materialize failed:', err);
    }

    return updated;
  }

  /**
   * Materialize playable `matches` rows for every bracket slot whose two
   * teams are already resolved.
   *
   * Why: bracket_matches stores the bracket structure and inline
   * score/winner, but the public matches list, the referee console and
   * the admin schedule all live on the regular `matches` table. Without
   * this step, cuartos / semifinal / final / tercer-puesto rounds never
   * appear in those flows.
   *
   * Behavior:
   *   · Idempotent — re-runs after every bracket change. The unique
   *     partial index on `matches.bracket_match_id` ensures we never
   *     create more than one match per slot.
   *   · Live re-sync — when a bracket slot's team ids change because
   *     standings shifted (handled by `resolveBracketFromStandings`),
   *     the materialized match's team ids get updated *only* while it
   *     is still `upcoming`. Once a referee/admin starts scoring, the
   *     match is treated as the source of truth.
   *   · Schedule continuation — new matches are placed after the
   *     latest scheduled slot of the tournament (group stage or earlier
   *     bracket round), rotating across the tournament's courts. Admins
   *     can edit date/time/court via the regular match edit UI.
   *
   * Returns a diagnostic snapshot so callers (and the admin "Recalcular
   * cruces" toast) can show counts and quickly tell whether a no-op was
   * because nothing needed materializing or because something is off.
   *
   *   · totalBracketRows           — every bracket_matches row
   *   · slotsWithBothTeamsResolved — rows with team1_id AND team2_id
   *   · slotsAlreadyMaterialized   — rows already pointing at a match
   *   · matchesCreated             — INSERTs done by this call
   *   · matchesUpdated             — UPDATEs (team re-sync on upcoming)
   */
  async materializePendingBracketMatches(
    tournamentId: string,
  ): Promise<{
    totalBracketRows: number;
    slotsWithBothTeamsResolved: number;
    slotsAlreadyMaterialized: number;
    matchesCreated: number;
    matchesUpdated: number;
  }> {
    const empty = {
      totalBracketRows: 0,
      slotsWithBothTeamsResolved: 0,
      slotsAlreadyMaterialized: 0,
      matchesCreated: 0,
      matchesUpdated: 0,
    };

    // Tournament metadata for scheduling.
    const pool = getPool();

    const tournRes = await pool.query(
      `SELECT id, courts, start_date, finals_court,
              match_duration_minutes, match_break_minutes,
              match_durations_by_category, daily_schedules
         FROM tournaments WHERE id = $1`,
      [tournamentId],
    );
    if (tournRes.rows.length === 0) return empty;
    const tournament = tournRes.rows[0];
    const courts: string[] = (tournament.courts as string[] | null) ?? [];
    const courtNames = courts.length > 0 ? courts : ['Cancha 1'];
    // Pull the same scheduling knobs the group-stage scheduler honours
    // so bracket slots inherit the tournament's actual cadence instead
    // of the hardcoded 60+15. Also resolves per-day windows (e.g.
    // "Saturday 08:00–22:00") so bracket matches don't bleed into a
    // day the admin already shortened.
    const tDuration =
      (tournament.match_duration_minutes as number | null) ?? DEFAULT_MATCH_MIN;
    const tBreak =
      (tournament.match_break_minutes as number | null) ?? DEFAULT_BREAK_MIN;
    const tDurationsByCat =
      (tournament.match_durations_by_category as Record<string, number> | null) ?? {};
    const tDailySchedules =
      (tournament.daily_schedules as Record<string, { start: string; end: string }> | null) ?? {};
    const parseHHMM = (raw: string | undefined, fallback: number): number => {
      if (!raw) return fallback;
      const [h, m] = raw.split(':').map((s) => parseInt(s, 10));
      if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
      return h * 60 + m;
    };
    const windowFor = (dateStr: string) => {
      const o = tDailySchedules[dateStr];
      return {
        startMin: parseHHMM(o?.start, DEFAULT_DAY_START_MIN),
        endMin: parseHHMM(o?.end, DEFAULT_DAY_END_MIN),
      };
    };
    // Per-round duration: a bracket round's category lives in the round
    // string (parseBracketRound returns it). Falls back to the global
    // tournament duration when no override exists for the category, then
    // to a hardcoded 60 as last resort.
    const durationForRound = (round: string): number => {
      const { category } = parseBracketRound(round);
      const override = category ? tDurationsByCat[category] : undefined;
      if (typeof override === 'number' && override > 0) return override;
      return tDuration;
    };
    // Migration 026 — preferred court for "semi" / "final" rounds. NULL
    // means "no preference" → the rotation below wins. We keep it
    // optional so a misconfigured value (court no longer in the
    // tournament's courts array) silently falls back to rotation
    // instead of crashing the materializer.
    const rawFinalsCourt =
      (tournament.finals_court as string | null | undefined) ?? null;
    const finalsCourt =
      rawFinalsCourt && courtNames.includes(rawFinalsCourt)
        ? rawFinalsCourt
        : null;
    /**
     * Returns true when the bracket round name maps to a semi or final
     * round. The `round` column is free-form text (e.g.
     * "Mini Femenino|gold|final", "Cuartos · Oro", "Tercer puesto") so
     * we just look for the substrings 'semi' / 'final' case-insensitive.
     * "Tercer puesto" / "tercer-puesto" is NOT considered a final — the
     * admin reserves the preferred court for THE final, not the
     * 3rd-place play-off.
     */
    const isFinalsRound = (round: string): boolean => {
      const normalized = round.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalized.includes('tercer')) return false;
      return normalized.includes('semi') || normalized.includes('final');
    };
    // Track which (date, time) pairs have already pinned a match to
    // the finals court within this materializer pass. Lets us fall
    // back to rotation when two semis would otherwise want the same
    // court at the same minute.
    const finalsCourtBookings = new Set<string>();

    // Snapshot every bracket row for the tournament so we can report
    // counters even when nothing materialized.
    const bracketAllRes = await pool.query(
      `SELECT id, team1_id, team2_id
         FROM bracket_matches
         WHERE tournament_id = $1`,
      [tournamentId],
    );
    const totalBracketRows = bracketAllRes.rows.length;

    // Materialize EVERY bracket slot — including the ones where
    // team1_id / team2_id are still NULL because the upstream round
    // hasn't completed yet. The admin needs all of these visible in
    // the cronograma to schedule the whole tournament end-to-end
    // (e.g. assign cuartos slots before grupos even start playing).
    // Until mig 030 the `matches.team1_id` was NOT NULL so we had to
    // skip nullable rows; the schema now allows them and the
    // frontend renders unresolved fixtures blurred so the admin sees
    // the slot label without the seed-based guess. The slotsWith…
    // counter still tracks fully-resolved rows for the response
    // payload (preserves caller compatibility). Order by round +
    // position so cuartos materialize before semis, keeping the
    // schedule monotonic.
    const bmRes = await pool.query(
      `SELECT id, team1_id, team2_id, round, position
         FROM bracket_matches
         WHERE tournament_id = $1
           AND (
             team1_id IS NULL
             OR team2_id IS NULL
             OR team1_id <> team2_id
           )
         ORDER BY round, position`,
      [tournamentId],
    );
    const slotsWithBothTeamsResolved = bmRes.rows.filter(
      (r) => r.team1_id !== null && r.team2_id !== null,
    ).length;
    if (bmRes.rows.length === 0) {
      return { ...empty, totalBracketRows };
    }

    // Existing materialized matches keyed by their bracket pointer so we
    // can detect "already there" vs "needs team re-sync". We also pre-
    // populate finalsCourtBookings with any existing match on the
    // finals court so the new placements never collide with what the
    // admin already has scheduled there.
    const existRes = await pool.query(
      `SELECT id, bracket_match_id, team1_id, team2_id, status,
              date::text AS date, time, court
         FROM matches
         WHERE tournament_id = $1 AND bracket_match_id IS NOT NULL`,
      [tournamentId],
    );
    if (finalsCourt) {
      // Seed bookings with rows that already live on the finals court.
      // The materializer below will skip the preferred-court branch for
      // any (date, time) already in the set, regardless of who placed
      // the match — admin manual edit, group regeneration, etc.
      const allFinalsCourtRes = await pool.query(
        `SELECT date::text AS date, time
           FROM matches
           WHERE tournament_id = $1 AND court = $2`,
        [tournamentId, finalsCourt],
      );
      for (const r of allFinalsCourtRes.rows) {
        finalsCourtBookings.add(`${r.date as string}|${r.time as string}`);
      }
    }
    const existing = new Map<
      string,
      {
        id: string;
        team1_id: string | null;
        team2_id: string | null;
        status: string;
      }
    >();
    for (const r of existRes.rows) {
      existing.set(r.bracket_match_id as string, {
        id: r.id as string,
        team1_id: (r.team1_id as string | null) ?? null,
        team2_id: (r.team2_id as string | null) ?? null,
        status: r.status as string,
      });
    }

    // Cursor for new slots — picks up after the latest scheduled match
    // (any phase) for the tournament so the bracket extends the agenda
    // instead of overlapping with grupos.
    const lastSlotRes = await pool.query(
      `SELECT date, time
         FROM matches
         WHERE tournament_id = $1
         ORDER BY date DESC, time DESC
         LIMIT 1`,
      [tournamentId],
    );
    let cursorDate: Date;
    let cursorMinutes: number;
    if (lastSlotRes.rows.length > 0) {
      const r = lastSlotRes.rows[0];
      // pg returns DATE columns as JS Date objects, not ISO strings —
      // normalize before concatenating with a time fragment.
      cursorDate = parseDbDate(r.date) ?? new Date();
      const [h, m] = (r.time as string).split(':').map((s) => parseInt(s, 10));
      // Use the tournament's configured duration + break so the bracket
      // continues the cadence the admin actually set. The previous
      // hardcoded `+ DEFAULT_MATCH_MIN + DEFAULT_BREAK_MIN` (=75min)
      // baked a phantom 15-min break on tournaments where the admin set
      // `matchBreakMinutes: 0`, leaving awkward 15min gaps between
      // bracket rows.
      cursorMinutes = h * 60 + m + tDuration + tBreak;
      // Roll forward if the last slot pushed us out of the day window.
      let win = windowFor(dateToSlug(cursorDate));
      if (cursorMinutes + tDuration > win.endMin) {
        cursorDate = new Date(cursorDate.getTime() + 86_400_000);
        win = windowFor(dateToSlug(cursorDate));
        cursorMinutes = win.startMin;
      }
    } else {
      // tournaments.start_date is also a DATE column → may arrive as a
      // Date instance OR as a YYYY-MM-DD string depending on the driver
      // path. parseDbDate handles both shapes.
      cursorDate = parseDbDate(tournament.start_date) ?? new Date();
      cursorMinutes = windowFor(dateToSlug(cursorDate)).startMin;
    }

    let courtIdx = 0;
    let matchesCreated = 0;
    let matchesUpdated = 0;
    let slotsAlreadyMaterialized = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const bm of bmRes.rows) {
        const bracketId = bm.id as string;
        // team1Id / team2Id may now legitimately be NULL — this is the
        // case for bracket slots waiting on a previous round (cuartos
        // before grupos finish, semis before cuartos finish, etc).
        // Mig 030 dropped the NOT NULL constraint on matches so we
        // can persist the slot anyway with a pre-assigned date / time
        // / court; advanceWinner fills the teams in later.
        const team1Id = (bm.team1_id as string | null) ?? null;
        const team2Id = (bm.team2_id as string | null) ?? null;
        const round = bm.round as string;

        const exists = existing.get(bracketId);
        if (exists) {
          slotsAlreadyMaterialized++;
          // Re-sync teams while the materialized match hasn't been
          // touched by the referee yet. Once a score lands the match
          // is the source of truth. Compare with == null shortcut so
          // a NULL→NULL sync doesn't trigger an UPDATE.
          if (
            exists.status === 'upcoming' &&
            (exists.team1_id !== team1Id || exists.team2_id !== team2Id)
          ) {
            await client.query(
              `UPDATE matches SET team1_id = $1, team2_id = $2, updated_at = NOW() WHERE id = $3`,
              [team1Id, team2Id, exists.id],
            );
            matchesUpdated++;
          }
          continue;
        }

        // Allocate a slot — same minute across courts until they're full,
        // then advance time. This mirrors the group-stage scheduler's
        // multi-court parallelism without re-running the whole sweep.
        // The per-round duration depends on the bracket round's category
        // override (mig 027); a Senior 90' round needs 90min of room
        // while a Sub-13 45' fits in less.
        const matchDur = durationForRound(round);
        const win = windowFor(dateToSlug(cursorDate));
        if (cursorMinutes + matchDur > win.endMin) {
          cursorDate = new Date(cursorDate.getTime() + 86_400_000);
          const next = windowFor(dateToSlug(cursorDate));
          cursorMinutes = next.startMin;
          courtIdx = 0;
        }
        const dateStr = dateToSlug(cursorDate);
        const time = formatHHMM(cursorMinutes);
        // Migration 026 — pick the finals court when the round is a
        // semi or final AND no other match has already claimed that
        // court at this minute. Otherwise stick to the rotation so two
        // bracket-semis don't get pinned to the same court at the same
        // time. We also DON'T bump courtIdx when we pin to the finals
        // court — that way the rotation slot stays available for the
        // NEXT non-finals match in the same minute.
        const slotKey = `${dateStr}|${time}`;
        const preferFinalsCourt =
          finalsCourt !== null &&
          isFinalsRound(round) &&
          !finalsCourtBookings.has(slotKey);
        const court = preferFinalsCourt
          ? finalsCourt!
          : courtNames[courtIdx % courtNames.length];
        // Mark the slot as booked on the finals court whenever the
        // chosen court IS the finals court — covers both the pinned
        // path AND the case where a non-finals match happens to rotate
        // onto the finals court (which would otherwise let a later
        // semi at the same minute think the court was free).
        if (finalsCourt !== null && court === finalsCourt) {
          finalsCourtBookings.add(slotKey);
        }

        const phase = bracketRoundToMatchPhase(round);

        await client.query(
          `INSERT INTO matches
             (tournament_id, team1_id, team2_id, date, time, court, status, phase, bracket_match_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'upcoming', $7, $8)`,
          [tournamentId, team1Id, team2Id, dateStr, time, court, phase, bracketId],
        );
        matchesCreated++;

        // When we pinned a semi/final to the finals court we DON'T
        // bump the rotation counter — the rotation slot at this minute
        // is still free for a regular bracket match. We DO advance the
        // time cursor when every rotation court has been used at this
        // minute, which still triggers correctly because non-finals
        // placements always increment courtIdx. Use the tournament's
        // configured stride (matchDur + tBreak) rather than the
        // hardcoded 75min so admins on `matchBreakMinutes:0` see slots
        // back-to-back instead of with a phantom 15min gap.
        if (!preferFinalsCourt) {
          courtIdx++;
          if (courtIdx % courtNames.length === 0) {
            cursorMinutes += matchDur + tBreak;
          }
        }
      }

      await client.query('COMMIT');
      return {
        totalBracketRows,
        slotsWithBothTeamsResolved,
        slotsAlreadyMaterialized,
        matchesCreated,
        matchesUpdated,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Sync a freshly-completed materialized match back into the bracket:
   * record the score, mark the bracket row completed, and propagate the
   * winner to the next round via {@link advanceWinner}.
   *
   * Called from `match.service` whenever a match with a non-null
   * `bracket_match_id` flips its status to `completed`. Idempotent — if
   * the bracket row is already completed, returns early so the call is
   * safe to fire on every score save.
   */
  async syncBracketFromMatch(matchId: string): Promise<void> {
    const pool = getPool();

    const matchRes = await pool.query(
      `SELECT id, bracket_match_id, team1_id, team2_id, status,
              score_team1, score_team2
         FROM matches WHERE id = $1`,
      [matchId],
    );
    if (matchRes.rows.length === 0) return;
    const match = matchRes.rows[0];
    if (!match.bracket_match_id) return;
    if (match.status !== 'completed') return;

    const bmRes = await pool.query(
      'SELECT id, status, team1_id, team2_id FROM bracket_matches WHERE id = $1',
      [match.bracket_match_id],
    );
    if (bmRes.rows.length === 0) return;
    const bm = bmRes.rows[0];

    // Resolve winner — fall back to score comparison if sets are absent.
    // The match service computes scoreTeam1/scoreTeam2 as sets-won by
    // each side, so the comparison is already at the match level.
    const score1 = (match.score_team1 as number | null) ?? 0;
    const score2 = (match.score_team2 as number | null) ?? 0;
    if (score1 === score2) return; // tied → can't determine a winner yet
    const team1Id = bm.team1_id as string | null;
    const team2Id = bm.team2_id as string | null;
    if (!team1Id || !team2Id) return;
    const winnerId = score1 > score2 ? team1Id : team2Id;

    // Persist score + status on the bracket row first so subsequent
    // `getBracket` calls reflect the latest result. Use coalesced score
    // values so the bracket also displays the sets-won count.
    await pool.query(
      `UPDATE bracket_matches
         SET score_team1 = $1, score_team2 = $2, status = 'completed'
         WHERE id = $3`,
      [score1, score2, bm.id],
    );

    if (bm.status === 'completed') return; // already advanced

    try {
      await this.advanceWinner(bm.id as string, winnerId);
    } catch (err) {
      // advanceWinner can throw "winner not in bracket match" while
      // standings are still settling. Don't surface — the next score
      // write will retry.
      console.warn('[syncBracketFromMatch] advanceWinner failed:', err);
    }
  }

  /**
   * Get all bracket matches for a tournament, with team data populated via joins.
   * Ordered by round and position.
   */
  async getBracket(tournamentId: string): Promise<BracketMatch[]> {
    const pool = getPool();

    // Verify tournament exists
    const tournamentResult = await pool.query(
      'SELECT id FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      throw new NotFoundError('Torneo');
    }

    const result = await pool.query(
      `SELECT bm.*,
              t1.name AS team1_name, t1.initials AS team1_initials, t1.logo AS team1_logo,
              t1.primary_color AS team1_primary_color, t1.secondary_color AS team1_secondary_color,
              t2.name AS team2_name, t2.initials AS team2_initials, t2.logo AS team2_logo,
              t2.primary_color AS team2_primary_color, t2.secondary_color AS team2_secondary_color
       FROM bracket_matches bm
       LEFT JOIN teams t1 ON bm.team1_id = t1.id
       LEFT JOIN teams t2 ON bm.team2_id = t2.id
       WHERE bm.tournament_id = $1
       ORDER BY bm.round, bm.position`,
      [tournamentId]
    );

    return result.rows.map(mapBracketRow);
  }

  /**
   * Populate bracket_matches.team1_id / team2_id from group-phase standings.
   *
   * Two seeding strategies depending on `tournament.bracket_mode`:
   *
   *   · `'divisions'` — VNL cumulative seeding. For every (category, tier)
   *     pair we compute a cumulative cross-group ranking (best record in
   *     the entire division → seed 1, second best → seed 2, …) and then
   *     drop those team ids into the first-round slots following the VNL
   *     [1, 8, 4, 5, 2, 7, 3, 6] pattern. Each slot's seed index comes
   *     from {@link bracketSeedOrderLocal}, so two slots of the same match
   *     are always [seed N, seed (N's bracket pair)].
   *   · `'manual'` (or unset) — legacy mode: each slot keeps its
   *     `team*_placeholder` of the form `"<pos>|<groupName>"`, and the
   *     resolver maps it 1:1 to whichever team currently sits at that
   *     (group, position).
   *
   * In both cases we only update slots whose materialized match (if any)
   * is still `'upcoming'` — once a referee starts scoring, the match is
   * the source of truth and the bracket holder is read-only.
   *
   * Returns the number of slots that had their team assignment updated.
   */
  async resolveBracketFromStandings(tournamentId: string): Promise<number> {
    const pool = getPool();

    // Tournament metadata so we know which strategy to apply.
    const tournRes = await pool.query(
      'SELECT bracket_mode FROM tournaments WHERE id = $1',
      [tournamentId],
    );
    if (tournRes.rows.length === 0) return 0;
    const bracketMode = (tournRes.rows[0].bracket_mode as string | null) ?? 'manual';

    const standingsResult = await pool.query(
      `SELECT team_id, group_name, position, played, wins,
              sets_for, sets_against, points_for, points_against, points
         FROM standings WHERE tournament_id = $1`,
      [tournamentId],
    );
    const standings = standingsResult.rows as RankingCandidate[];

    // Cumulative ranking is computed lazily per (category, tier) and
    // cached so a tournament with many tiers / categories doesn't
    // re-sort the same standings slice more than once.
    const rankingCache = new Map<string, string[]>();
    const cumulativeRanking = (
      category: string,
      positions: number[],
    ): string[] => {
      const key = `${category}::${positions.join(',')}`;
      if (rankingCache.has(key)) return rankingCache.get(key)!;
      const candidates = standings.filter((s) => {
        if (!s.group_name) return false;
        if (!s.group_name.startsWith(`${category}|`)) return false;
        if (!positions.includes(s.position)) return false;
        return s.played > 0;
      });
      const sorted = [...candidates].sort(compareRankingRows);
      const ids = sorted.map((s) => s.team_id);
      rankingCache.set(key, ids);
      return ids;
    };

    const resolvePlaceholder = (placeholder: string | null): string | null => {
      if (!placeholder) return null;
      const firstPipe = placeholder.indexOf('|');
      if (firstPipe === -1) return null;
      const pos = parseInt(placeholder.substring(0, firstPipe), 10);
      const groupName = placeholder.substring(firstPipe + 1);
      if (Number.isNaN(pos)) return null;
      const found = standings.find(
        (s) => s.group_name === groupName && s.position === pos,
      );
      // Need a populated standings row whose team has actually played
      // at least once. This sidesteps the "everybody is at position 1
      // alphabetically with 0-0" pre-tournament state without delaying
      // the live preview until groups are 100% complete.
      if (!found || found.played <= 0) return null;
      return found.team_id;
    };

    // For divisions mode we need EVERY first-round bracket row of the
    // tournament (placeholder or not) so we can re-seed by cumulative
    // ranking. For manual mode we only need rows with placeholders to
    // do the legacy lookup.
    const bmResult = await pool.query(
      bracketMode === 'divisions'
        ? `SELECT id, round, position, team1_id, team2_id,
                  team1_placeholder, team2_placeholder, status
             FROM bracket_matches
             WHERE tournament_id = $1`
        : `SELECT id, round, position, team1_id, team2_id,
                  team1_placeholder, team2_placeholder, status
             FROM bracket_matches
             WHERE tournament_id = $1
               AND (team1_placeholder IS NOT NULL
                    OR team2_placeholder IS NOT NULL)`,
      [tournamentId],
    );

    if (bmResult.rows.length === 0) {
      // Even if there are no placeholders to re-resolve, the bracket
      // may already have all teams locked in and never went through a
      // materialization pass (e.g. an old tournament generated before
      // migration 018). Run materialize idempotently so "Recalcular
      // cruces" always produces playable matches when it should.
      try {
        await this.materializePendingBracketMatches(tournamentId);
      } catch (err) {
        console.warn('[resolveBracketFromStandings] materialize failed:', err);
      }
      return 0;
    }

    // Look up materialized matches per bracket id — we keep
    // bracket-stage `matches` rows in sync with the bracket, but only
    // while they are still 'upcoming'. Once the referee starts scoring
    // we leave both the bracket and its match alone.
    const linkedMatchesRes = await pool.query(
      `SELECT id, bracket_match_id, team1_id, team2_id, status
         FROM matches
         WHERE tournament_id = $1 AND bracket_match_id IS NOT NULL`,
      [tournamentId],
    );
    const matchByBracketId = new Map<
      string,
      { id: string; team1_id: string; team2_id: string; status: string }
    >();
    for (const m of linkedMatchesRes.rows) {
      matchByBracketId.set(m.bracket_match_id as string, {
        id: m.id as string,
        team1_id: m.team1_id as string,
        team2_id: m.team2_id as string,
        status: m.status as string,
      });
    }

    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');

      if (bracketMode === 'divisions') {
        // ── Divisions: VNL cumulative seeding ──────────────────────
        //
        // Group every bracket row by (category, tier). For each group,
        // identify the FIRST round (the one with the most matches),
        // build the cumulative ranking for that tier, then drop seeds
        // into slots in the order [bracketSeedOrder(slots)].
        //
        // Slots in non-first rounds keep their current team ids — those
        // get filled by advanceWinner as bracket-stage matches finish.
        type GroupKey = string; // "category::tier"
        interface SlotRow {
          id: string;
          round: string;
          position: number;
          team1_id: string | null;
          team2_id: string | null;
          status: string;
        }
        const byKey = new Map<GroupKey, SlotRow[]>();
        const tierByKey = new Map<GroupKey, 'gold' | 'silver' | null>();
        const categoryByKey = new Map<GroupKey, string>();
        for (const r of bmResult.rows) {
          const round = r.round as string;
          const parts = round.split('|');
          let category = '';
          let tier: 'gold' | 'silver' | null = null;
          if (parts.length >= 3 && (parts[1] === 'gold' || parts[1] === 'silver')) {
            category = parts[0];
            tier = parts[1] as 'gold' | 'silver';
          } else if (parts.length >= 2) {
            category = parts[0];
          }
          const key: GroupKey = `${category}::${tier ?? ''}`;
          const list = byKey.get(key) ?? [];
          list.push({
            id: r.id as string,
            round,
            position: r.position as number,
            team1_id: r.team1_id as string | null,
            team2_id: r.team2_id as string | null,
            status: r.status as string,
          });
          byKey.set(key, list);
          tierByKey.set(key, tier);
          categoryByKey.set(key, category);
        }

        for (const [key, slots] of byKey.entries()) {
          // Find the first round inside this (category, tier). The
          // first round is whichever round name has the most matches.
          // Skip 3rd-place matches (`tercer-puesto`) — those are seeded
          // by advanceWinner from the semifinal losers.
          const standardSlots = slots.filter((s) => !s.round.endsWith('|tercer-puesto'));
          if (standardSlots.length === 0) continue;
          const roundCounts = new Map<string, number>();
          for (const s of standardSlots) {
            roundCounts.set(s.round, (roundCounts.get(s.round) || 0) + 1);
          }
          let firstRound: string | null = null;
          let maxCount = 0;
          for (const [r, c] of roundCounts.entries()) {
            if (c > maxCount) {
              maxCount = c;
              firstRound = r;
            }
          }
          if (!firstRound) continue;

          const firstRoundSlots = standardSlots
            .filter((s) => s.round === firstRound)
            .sort((a, b) => a.position - b.position);

          const tier = tierByKey.get(key) ?? null;
          const category = categoryByKey.get(key) ?? '';
          // Tier -> which group positions classify into this bracket.
          //   · gold  → top two of every group
          //   · silver → 3rd and 4th of every group (4th may be missing)
          //   · null  → manual single bracket: top two as well
          const positions = tier === 'silver' ? [3, 4] : [1, 2];
          const ranking = cumulativeRanking(category, positions);
          if (ranking.length === 0) continue;

          const totalSlots = firstRoundSlots.length * 2;
          const order = bracketSeedOrderLocal(totalSlots);
          if (order.length === 0) continue;

          for (let mIdx = 0; mIdx < firstRoundSlots.length; mIdx++) {
            const slot = firstRoundSlots[mIdx];
            const seedT1 = order[mIdx * 2]; // 1-indexed seed
            const seedT2 = order[mIdx * 2 + 1];
            const newT1 = ranking[seedT1 - 1] ?? null;
            const newT2 = ranking[seedT2 - 1] ?? null;

            // Skip slots whose materialized match is in progress / done
            // — flipping team ids underneath an active match would be
            // disastrous. The new ids will land the next time the slot
            // is `upcoming` (after a regen).
            const linked = matchByBracketId.get(slot.id);
            if (linked && linked.status !== 'upcoming') continue;
            if (slot.status !== 'upcoming') continue;

            if (newT1 !== slot.team1_id || newT2 !== slot.team2_id) {
              await client.query(
                `UPDATE bracket_matches SET team1_id = $1, team2_id = $2 WHERE id = $3`,
                [newT1, newT2, slot.id],
              );
              updated++;
              if (linked) {
                await client.query(
                  `UPDATE matches SET team1_id = $1, team2_id = $2, updated_at = NOW() WHERE id = $3`,
                  [newT1, newT2, linked.id],
                );
              }
            }
          }
        }
      } else {
        // ── Manual mode: legacy 1:1 placeholder lookup ────────────
        for (const bm of bmResult.rows) {
          const newTeam1Id = bm.team1_placeholder
            ? resolvePlaceholder(bm.team1_placeholder)
            : bm.team1_id;
          const newTeam2Id = bm.team2_placeholder
            ? resolvePlaceholder(bm.team2_placeholder)
            : bm.team2_id;

          if (newTeam1Id !== bm.team1_id || newTeam2Id !== bm.team2_id) {
            await client.query(
              `UPDATE bracket_matches SET team1_id = $1, team2_id = $2 WHERE id = $3`,
              [newTeam1Id, newTeam2Id, bm.id],
            );
            updated++;
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Auto-advance any first-round bye slot before the materializer
    // runs. A bye is a bracket row where exactly one team is set and
    // the other side has no team / no placeholder — happens whenever
    // the classifier count isn't a power of two (e.g. 10 → bracket 16
    // means 6 byes). Without this, those byes would sit forever as
    // "Por definir" and the next round would never seed.
    try {
      const advanced = await this.processByesAndAdvance(tournamentId);
      if (advanced > 0) {
        console.log(`[resolveBracketFromStandings] auto-advanced ${advanced} bye(s)`);
      }
    } catch (err) {
      console.warn('[resolveBracketFromStandings] processByesAndAdvance failed:', err);
    }

    // Always materialize after a re-resolve: even if `updated` is 0
    // (no team ids actually changed), there may be slots whose teams
    // resolved on a previous pass but never produced a `matches` row
    // because the materializer wasn't deployed yet. Best-effort —
    // never fail the recalc on a materialization error.
    try {
      await this.materializePendingBracketMatches(tournamentId);
    } catch (err) {
      console.warn('[resolveBracketFromStandings] materialize failed:', err);
    }

    return updated;
  }

  /**
   * Auto-advance bye matches.
   *
   * A "bye" is a FIRST-round bracket row that ended up with exactly
   * one team filled because the classifier count wasn't a power of
   * two: with 10 classifiers in a 16-slot bracket six matches are
   * `team vs nobody`. Volleyball convention: the lone team passes
   * through automatically.
   *
   * Why the first-round restriction matters: a half-filled
   * intermediate round (e.g. tercer-puesto with the first semifinal's
   * loser already placed but the second one still pending) looks
   * exactly like a bye if you only check team1/team2. Auto-closing
   * those would prematurely complete the match and the second loser
   * would never land. Only the bracket's entry point can legitimately
   * carry a bye — the deeper rounds always fill via advanceWinner.
   *
   * Algorithm:
   *   1. Load every bracket row, bucket by (category, tier), exclude
   *      tercer-puesto (its slots fill from semifinal losers).
   *   2. For each bucket, the first round is whichever round name has
   *      the most matches.
   *   3. For first-round rows where status='upcoming' and exactly one
   *      team is filled and the empty side has no placeholder: mark
   *      complete with the lone team as winner and advance.
   *
   * Idempotent: a row that's already completed won't match the
   * predicate, so calling this twice in a row is safe.
   */
  async processByesAndAdvance(tournamentId: string): Promise<number> {
    const pool = getPool();

    const allRowsRes = await pool.query(
      `SELECT id, round, position, team1_id, team2_id,
              team1_placeholder, team2_placeholder, status
         FROM bracket_matches
         WHERE tournament_id = $1`,
      [tournamentId],
    );
    if (allRowsRes.rows.length === 0) return 0;

    // Bucket rows by (category, tier), skipping tercer-puesto.
    const buckets = new Map<string, Array<Record<string, unknown>>>();
    for (const r of allRowsRes.rows) {
      const round = r.round as string;
      if (round.endsWith('|tercer-puesto') || round === 'tercer-puesto') continue;
      const parts = round.split('|');
      let key = '';
      if (parts.length >= 3 && (parts[1] === 'gold' || parts[1] === 'silver')) {
        key = `${parts[0]}::${parts[1]}`;
      } else if (parts.length >= 2) {
        key = `${parts[0]}::`;
      } else {
        key = `::`;
      }
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }

    let advanced = 0;
    for (const rows of buckets.values()) {
      // Identify the first round: round name with the most matches.
      const counts = new Map<string, number>();
      for (const r of rows) {
        const round = r.round as string;
        counts.set(round, (counts.get(round) || 0) + 1);
      }
      let firstRound = '';
      let maxN = 0;
      for (const [round, n] of counts.entries()) {
        if (n > maxN) {
          maxN = n;
          firstRound = round;
        }
      }
      if (!firstRound) continue;

      // Only first-round rows with one team set, no placeholder on the
      // empty side, status=upcoming → real bye.
      const candidates = rows.filter((r) => {
        if (r.round !== firstRound) return false;
        if (r.status !== 'upcoming') return false;
        const t1 = r.team1_id as string | null;
        const t2 = r.team2_id as string | null;
        const ph1 = r.team1_placeholder as string | null;
        const ph2 = r.team2_placeholder as string | null;
        const oneSetOther = (!!t1 && !t2 && !ph2) || (!t1 && !!t2 && !ph1);
        return oneSetOther;
      });

      for (const row of candidates) {
        const winnerId = ((row.team1_id ?? row.team2_id) as string | null);
        if (!winnerId) continue;
        try {
          await this.advanceWinner(row.id as string, winnerId);
          advanced++;
        } catch (err) {
          console.warn(
            `[processByesAndAdvance] advanceWinner failed for ${row.id}:`,
            err,
          );
        }
      }
    }
    return advanced;
  }
}

export const bracketGenerator = new BracketGenerator();
