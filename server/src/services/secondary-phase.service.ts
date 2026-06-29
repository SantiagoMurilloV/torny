import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { computeCumulativeRanking, bracketGenerator } from './bracket.service';
import { generateRoundRobin } from './fixture/algorithms';
import type { Team } from '../types';

// ── Public interfaces ────────────────────────────────────────────────

export interface SecondaryPhaseConfig {
  enabled: boolean;
  groupsPerDivision: number; // e.g. 4
  teamsPerGroup: number;     // e.g. 3
  classifiersPerGroup: number; // e.g. 1
  /**
   * Seeding strategy for the second group stage:
   *   · 'balanced' (default) — one set of pools, each mixing one team
   *     from every finishing position (1st, 2nd, 3rd, 4th…) drawn from
   *     DIFFERENT primary groups. No Oro/Plata split.
   *   · 'divisions' — legacy Copa Oro / Copa Plata triangulars (top
   *     positions cluster in Oro, the rest in Plata).
   */
  seedingMode?: 'balanced' | 'divisions';
}

export interface SecondaryPhaseResult {
  categoriesProcessed: string[];
  /** Divisions mode only — Oro triangular groups created. */
  oroGroupsCreated: number;
  /** Divisions mode only — Plata triangular groups created. */
  plataGroupsCreated: number;
  /** Balanced mode — total balanced pools created across categories. */
  poolsCreated: number;
  matchesCreated: number;
  /** Which seeding strategy actually ran. */
  seedingMode: 'balanced' | 'divisions';
}

export interface FinalizeResult {
  semiFinalsSeeded: number;
  matchesMaterialized: number;
}

// ── Scheduling helpers ───────────────────────────────────────────────

const DEFAULT_MATCH_MIN = 60;
const DEFAULT_BREAK_MIN = 15;

function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseHHMM(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const [h, m] = raw.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return h * 60 + m;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Pot-based seeding ────────────────────────────────────────────────
//
// Given an ordered list of team IDs (best first), distribute them into
// `groupsPerDivision` groups using pot-based seeding:
//   Pot 1: seeds 1..G → each goes to group 0, 1, 2, ..., G-1
//   Pot 2: seeds G+1..2G → each goes to group 0, 1, ..., G-1
//   etc.
// So group 0 gets [seed1, seed(G+1), seed(2G+1), ...]
//                          — the same pot-spread used by FIVB / UEFA.

// Snake seeding with same-group avoidance:
//   Round 1 →  A B C D   (positions 0..G-1)
//   Round 2 ←  D C B A   (snake: G-1..0)
//   Round 3 →  A B C D   ...
// Ensures each triangular has one strong + one mid + one weaker team.
// After seeding, swaps are applied to avoid two teams from the same
// primary group ending up in the same triangular.

interface RankedTeam {
  teamId: string;
  sourceGroupName: string; // primary-phase group_name e.g. "Mayores Femenino|A"
}

function snakeDistribute(
  teams: RankedTeam[],
  groupsPerDivision: number,
): RankedTeam[][] {
  const groups: RankedTeam[][] = Array.from({ length: groupsPerDivision }, () => []);

  for (let i = 0; i < teams.length; i++) {
    const round = Math.floor(i / groupsPerDivision);
    const pos   = i % groupsPerDivision;
    const gi    = round % 2 === 0 ? pos : groupsPerDivision - 1 - pos;
    groups[gi].push(teams[i]);
  }

  // Conflict resolution: if two teams from the same primary group land
  // in the same triangular, try to swap one with a team from another
  // triangular that doesn't create a new conflict.
  for (let gi = 0; gi < groups.length; gi++) {
    for (let ti = 0; ti < groups[gi].length; ti++) {
      const teamA = groups[gi][ti];
      const conflict = groups[gi].some(
        (other, j) => j !== ti && other.sourceGroupName === teamA.sourceGroupName,
      );
      if (!conflict) continue;

      let swapped = false;
      for (let gj = 0; gj < groups.length && !swapped; gj++) {
        if (gj === gi) continue;
        for (let tj = 0; tj < groups[gj].length && !swapped; tj++) {
          const teamB = groups[gj][tj];
          const wouldConflictInGi = groups[gi].some(
            (t, k) => k !== ti && t.sourceGroupName === teamB.sourceGroupName,
          );
          const wouldConflictInGj = groups[gj].some(
            (t, k) => k !== tj && t.sourceGroupName === teamA.sourceGroupName,
          );
          if (!wouldConflictInGi && !wouldConflictInGj) {
            groups[gi][ti] = teamB;
            groups[gj][tj] = teamA;
            swapped = true;
          }
        }
      }
    }
  }

  return groups;
}

// ── Balanced pools (cross-position redistribution) ────────────────────
//
// Build one set of pools where each pool mixes teams of DIFFERENT
// finishing positions (1st, 2nd, 3rd, 4th…) drawn from DIFFERENT primary
// groups — e.g. Pool 1 = {1°A, 2°B, 3°C, 4°D}. This is a Latin-square
// rotation: pool k draws position p from primary group (k + p) mod G.
//
//   primaryGroups = [A, B, C, D]   (sorted), G = 4
//   positions     = [1, 2, 3, 4]   (P = teamsPerGroup)
//
//   Pool A: 1°A · 2°B · 3°C · 4°D
//   Pool B: 1°B · 2°C · 3°D · 4°A
//   Pool C: 1°C · 2°D · 3°A · 4°B
//   Pool D: 1°D · 2°A · 3°B · 4°C
//
// Guarantees (when P ≤ G): every pool has exactly one team per position
// and no two teams from the same primary group. When P > G the rotation
// wraps and some origins repeat — unavoidable, but rare.
export interface PositionedTeam {
  teamId: string;
  primaryGroup: string; // e.g. "Mayores Femenino|A"
  position: number;     // finishing position within the primary group
}

export function buildBalancedPools(
  /** Map: primary group_name → (position → teamId). */
  teamByGroupAndPosition: Map<string, Map<number, string>>,
  /** Sorted primary group names (A, B, C, …). */
  primaryGroups: string[],
  /** How many positions to combine per pool (= teamsPerGroup). */
  positionsPerPool: number,
): PositionedTeam[][] {
  const G = primaryGroups.length;
  if (G === 0) return [];
  const pools: PositionedTeam[][] = Array.from({ length: G }, () => []);

  for (let k = 0; k < G; k++) {
    for (let p = 1; p <= positionsPerPool; p++) {
      const originGroup = primaryGroups[(k + (p - 1)) % G];
      const teamId = teamByGroupAndPosition.get(originGroup)?.get(p);
      if (teamId) {
        pools[k].push({ teamId, primaryGroup: originGroup, position: p });
      }
    }
  }

  return pools;
}

// ── Local bracket-round helpers ───────────────────────────────────────
//
// Mirrors getRounds / getMatchCountForRound in bracket.service.ts so the
// balanced finalize can lay out a properly-sized, NON-tiered bracket
// (rounds "Category|semifinal", "Category|final") that the existing
// advanceWinner + materializePendingBracketMatches handle unchanged.
function roundsForTeamCount(teamCount: number): string[] {
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

function matchCountForRound(round: string, teamCount: number): number {
  const rounds = roundsForTeamCount(teamCount);
  const roundIndex = rounds.indexOf(round);
  if (roundIndex === -1) return 0;
  let matches = Math.floor(teamCount / 2);
  for (let i = 0; i < roundIndex; i++) matches = Math.floor(matches / 2);
  return matches;
}

/** Group_name token that marks a balanced second-phase pool. */
const BALANCED_POOL_TOKEN = 'F2';
/** Phase label for balanced pool round-robin matches. */
const SECONDARY_PHASE_LABEL = 'Triangulares';

// ── Main generate function ───────────────────────────────────────────

export async function generateSecondaryPhase(
  tournamentId: string,
): Promise<SecondaryPhaseResult> {
  const pool = getPool();

  // 1. Load tournament
  const tournRes = await pool.query(
    `SELECT id, categories, secondary_phase,
            gold_classifiers_per_group, silver_classifiers_per_group,
            start_date, end_date, courts,
            match_duration_minutes, match_break_minutes,
            match_durations_by_category, daily_schedules
       FROM tournaments WHERE id = $1`,
    [tournamentId],
  );
  if (tournRes.rows.length === 0) throw new NotFoundError('Torneo');
  const tournament = tournRes.rows[0] as Record<string, unknown>;

  // 2. Validate secondary_phase config
  const spRaw = tournament.secondary_phase as SecondaryPhaseConfig | null;
  if (!spRaw?.enabled) {
    throw new ValidationError('La fase secundaria no está habilitada en este torneo');
  }
  const config: SecondaryPhaseConfig = {
    enabled: true,
    groupsPerDivision: Number(spRaw.groupsPerDivision) || 4,
    teamsPerGroup: Number(spRaw.teamsPerGroup) || 3,
    classifiersPerGroup: Number(spRaw.classifiersPerGroup) || 1,
    // Default to balanced pools — the cross-position redistribution.
    // Legacy tournaments without the field opt into the new behavior;
    // set seedingMode:'divisions' explicitly to keep Oro/Plata.
    seedingMode: spRaw.seedingMode === 'divisions' ? 'divisions' : 'balanced',
  };

  const categories: string[] = (tournament.categories as string[] | null) ?? [];
  if (categories.length === 0) {
    throw new ValidationError('El torneo no tiene categorías configuradas');
  }

  const goldPerGroup = Number(tournament.gold_classifiers_per_group) || 2;
  const silverPerGroup = Number(tournament.silver_classifiers_per_group) || 2;
  const courts: string[] = (tournament.courts as string[] | null) ?? ['Cancha 1'];
  const courtNames = courts.length > 0 ? courts : ['Cancha 1'];
  const matchDuration =
    (tournament.match_duration_minutes as number | null) ?? DEFAULT_MATCH_MIN;
  const matchBreak =
    (tournament.match_break_minutes as number | null) ?? DEFAULT_BREAK_MIN;
  const dailySchedules =
    (tournament.daily_schedules as Record<string, { start: string; end: string }> | null) ?? {};

  // 3. Find the latest existing match date/time for scheduling after
  const latestRes = await pool.query(
    `SELECT date, time FROM matches WHERE tournament_id = $1
       ORDER BY date DESC, time DESC LIMIT 1`,
    [tournamentId],
  );

  let cursorDate: string;
  let cursorMinutes: number;

  if (latestRes.rows.length > 0) {
    const lastRow = latestRes.rows[0] as { date: string; time: string };
    // Extract YYYY-MM-DD from whatever pg returns
    const rawDate = lastRow.date as unknown;
    let dateStr: string;
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else {
      dateStr = String(rawDate).slice(0, 10);
    }
    cursorDate = dateStr;
    const lastMatchMin = parseHHMM(lastRow.time, 0);
    const dayOverride = dailySchedules[cursorDate];
    const dayEndMin = parseHHMM(dayOverride?.end, 18 * 60);
    const nextSlot = lastMatchMin + matchDuration + matchBreak;
    if (nextSlot + matchDuration > dayEndMin) {
      // Roll to next day
      cursorDate = addDays(cursorDate, 1);
      const nextOverride = dailySchedules[cursorDate];
      cursorMinutes = parseHHMM(nextOverride?.start, 8 * 60);
    } else {
      cursorMinutes = nextSlot;
    }
  } else {
    // No existing matches — start from tournament start_date
    const rawStart = tournament.start_date as unknown;
    if (rawStart instanceof Date) {
      cursorDate = rawStart.toISOString().slice(0, 10);
    } else {
      cursorDate = String(rawStart).slice(0, 10);
    }
    const dayOverride = dailySchedules[cursorDate];
    cursorMinutes = parseHHMM(dayOverride?.start, 8 * 60);
  }

  // Helper to advance cursor by one match duration + break
  function nextSlot(): { date: string; time: string } {
    const result = { date: cursorDate, time: formatHHMM(cursorMinutes) };
    cursorMinutes += matchDuration + matchBreak;
    // Check if we overflowed the day
    const dayOverride = dailySchedules[cursorDate];
    const dayEndMin = parseHHMM(dayOverride?.end, 18 * 60);
    if (cursorMinutes + matchDuration > dayEndMin) {
      cursorDate = addDays(cursorDate, 1);
      const nextOverride = dailySchedules[cursorDate];
      cursorMinutes = parseHHMM(nextOverride?.start, 8 * 60);
    }
    return result;
  }

  let courtIndex = 0;
  function nextCourt(): string {
    const court = courtNames[courtIndex % courtNames.length];
    courtIndex++;
    return court;
  }

  // 4. Generate matches per category
  const client = await pool.connect();
  let matchesCreated = 0;
  let oroGroupsTotal = 0;
  let plataGroupsTotal = 0;
  let poolsTotal = 0;

  try {
    await client.query('BEGIN');

    for (const category of categories) {
      // ── Balanced pools (default): one cross-position redistribution ──
      if (config.seedingMode === 'balanced') {
        poolsTotal += await generateBalancedPoolsForCategory({
          client,
          tournamentId,
          category,
          positionsPerPool: config.teamsPerGroup,
          nextSlot,
          nextCourt,
          onMatchCreated: () => { matchesCreated++; },
        });
        continue;
      }

      // ── Divisions (legacy): Copa Oro + Copa Plata triangulars ──
      // Gold positions: 1..goldPerGroup
      const goldPositions = Array.from({ length: goldPerGroup }, (_, i) => i + 1);
      // Silver positions: goldPerGroup+1..goldPerGroup+silverPerGroup
      const silverPositions =
        silverPerGroup > 0
          ? Array.from({ length: silverPerGroup }, (_, i) => goldPerGroup + i + 1)
          : [];

      // Get ranked teams WITH their source primary group (for snake seeding)
      // We query standings directly instead of computeCumulativeRanking so we
      // can retain the group_name for same-group conflict avoidance.
      const getRankedTeams = async (positions: number[]): Promise<RankedTeam[]> => {
        const res = await client.query(
          `SELECT team_id, group_name, position, played, wins,
                  sets_for, sets_against, points_for, points_against, points
             FROM standings
             WHERE tournament_id = $1
               AND group_name LIKE $2
               AND position = ANY($3)
               AND played > 0
               AND group_name NOT LIKE $4`,
          [tournamentId, `${category}|%`, positions, `${category}|%|%`],
        );
        // Sort by cumulative performance (same criteria as computeCumulativeRanking)
        const rows = res.rows as Array<Record<string, unknown>>;
        rows.sort((a, b) => {
          const wins = (Number(b.wins) || 0) - (Number(a.wins) || 0);
          if (wins !== 0) return wins;
          const setDiff = ((Number(b.sets_for)||0)-(Number(b.sets_against)||0))
                        - ((Number(a.sets_for)||0)-(Number(a.sets_against)||0));
          if (setDiff !== 0) return setDiff;
          const ptDiff = ((Number(b.points_for)||0)-(Number(b.points_against)||0))
                       - ((Number(a.points_for)||0)-(Number(a.points_against)||0));
          if (ptDiff !== 0) return ptDiff;
          return (Number(a.position)||99) - (Number(b.position)||99);
        });
        return rows.map((r) => ({
          teamId: r.team_id as string,
          sourceGroupName: r.group_name as string,
        }));
      };

      const oroRanked  = await getRankedTeams(goldPositions);
      const plataRanked = silverPositions.length > 0
        ? await getRankedTeams(silverPositions)
        : [];

      // Distribute into groups using snake seeding + same-group avoidance
      const { groupsPerDivision } = config;

      const processGroups = async (
        ranked: RankedTeam[],
        division: 'Oro' | 'Plata',
      ): Promise<number> => {
        if (ranked.length < 2) return 0;

        const groups = snakeDistribute(ranked, groupsPerDivision);
        let groupsCreated = 0;

        for (let gi = 0; gi < groups.length; gi++) {
          const groupRanked = groups[gi];
          if (groupRanked.length < 2) continue;
          const groupTeamIds = groupRanked.map((t) => t.teamId);

          const groupLetter = String.fromCharCode(65 + gi); // A, B, C, D...
          const groupName = `${category}|${division}|${groupLetter}`;
          const phase = `Triangulares ${division}|${category}`;

          // Fetch team objects for generateRoundRobin
          const teamsRes = await client.query(
            `SELECT id, name, initials, logo, primary_color AS "primaryColor",
                    secondary_color AS "secondaryColor"
               FROM teams WHERE id = ANY($1)`,
            [groupTeamIds],
          );
          // Preserve snake-seeding order
          const teamMap = new Map<string, Team>(
            (teamsRes.rows as Array<Record<string, unknown>>).map((r) => [
              r.id as string,
              {
                id: r.id as string,
                name: r.name as string,
                initials: r.initials as string,
                logo: r.logo as string | undefined,
                primaryColor: r.primaryColor as string,
                secondaryColor: r.secondaryColor as string,
              },
            ]),
          );
          const teams: Team[] = groupTeamIds
            .map((id) => teamMap.get(id))
            .filter((t): t is Team => !!t);

          if (teams.length < 2) continue;

          const fixtures = generateRoundRobin(teams, groupName);

          for (const fixture of fixtures) {
            const slot = nextSlot();
            const court = nextCourt();
            await client.query(
              `INSERT INTO matches (tournament_id, team1_id, team2_id, date, time, court, status, phase, group_name)
               VALUES ($1, $2, $3, $4, $5, $6, 'upcoming', $7, $8)`,
              [
                tournamentId,
                fixture.team1Id,
                fixture.team2Id,
                slot.date,
                slot.time,
                court,
                phase,
                groupName,
              ],
            );
            matchesCreated++;
          }
          groupsCreated++;
        }
        return groupsCreated;
      };

      const oroGroupsMade = await processGroups(oroRanked, 'Oro');
      const plataGroupsMade = await processGroups(plataRanked, 'Plata');

      oroGroupsTotal += oroGroupsMade;
      plataGroupsTotal += plataGroupsMade;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    categoriesProcessed: categories,
    oroGroupsCreated: oroGroupsTotal,
    plataGroupsCreated: plataGroupsTotal,
    poolsCreated: poolsTotal,
    matchesCreated,
    seedingMode: config.seedingMode ?? 'balanced',
  };
}

// ── Balanced pools: per-category generation ──────────────────────────
//
// Reads the primary-phase standings, takes the top `positionsPerPool`
// teams from each primary group, and redistributes them via the
// Latin-square rotation in buildBalancedPools(). Each pool plays a
// round-robin; matches are scheduled through the caller's nextSlot /
// nextCourt cursors so they slot in right after the existing fixtures.
// Returns the number of pools created.
async function generateBalancedPoolsForCategory(opts: {
  client: import('pg').PoolClient;
  tournamentId: string;
  category: string;
  positionsPerPool: number;
  nextSlot: () => { date: string; time: string };
  nextCourt: () => string;
  onMatchCreated: () => void;
}): Promise<number> {
  const { client, tournamentId, category, positionsPerPool, nextSlot, nextCourt, onMatchCreated } = opts;

  // Pull every primary-group standing for this category. Primary groups
  // are 2-segment group_names ("Category|A"); we exclude any 3-segment
  // secondary group ("Category|F2|A" / "Category|Oro|A").
  const standRes = await client.query(
    `SELECT team_id, group_name, position
       FROM standings
       WHERE tournament_id = $1
         AND group_name LIKE $2
         AND group_name NOT LIKE $3
         AND played > 0
         AND position BETWEEN 1 AND $4`,
    [tournamentId, `${category}|%`, `${category}|%|%`, positionsPerPool],
  );
  const standRows = standRes.rows as Array<{ team_id: string; group_name: string; position: number }>;
  if (standRows.length < 2) return 0;

  // Build: primaryGroup → (position → teamId), and the sorted group list.
  const teamByGroupAndPosition = new Map<string, Map<number, string>>();
  const primaryGroupSet = new Set<string>();
  for (const row of standRows) {
    primaryGroupSet.add(row.group_name);
    if (!teamByGroupAndPosition.has(row.group_name)) {
      teamByGroupAndPosition.set(row.group_name, new Map());
    }
    teamByGroupAndPosition.get(row.group_name)!.set(Number(row.position), row.team_id);
  }
  const primaryGroups = [...primaryGroupSet].sort();

  const pools = buildBalancedPools(teamByGroupAndPosition, primaryGroups, positionsPerPool);

  let poolsCreated = 0;
  for (let pi = 0; pi < pools.length; pi++) {
    const poolTeams = pools[pi];
    if (poolTeams.length < 2) continue;

    const poolLetter = String.fromCharCode(65 + pi); // A, B, C, …
    const groupName = `${category}|${BALANCED_POOL_TOKEN}|${poolLetter}`;
    const phase = `${SECONDARY_PHASE_LABEL}|${category}`;
    const teamIds = poolTeams.map((t) => t.teamId);

    const teamsRes = await client.query(
      `SELECT id, name, initials, logo, primary_color AS "primaryColor",
              secondary_color AS "secondaryColor"
         FROM teams WHERE id = ANY($1)`,
      [teamIds],
    );
    const teamMap = new Map<string, Team>(
      (teamsRes.rows as Array<Record<string, unknown>>).map((r) => [
        r.id as string,
        {
          id: r.id as string,
          name: r.name as string,
          initials: r.initials as string,
          logo: r.logo as string | undefined,
          primaryColor: r.primaryColor as string,
          secondaryColor: r.secondaryColor as string,
        },
      ]),
    );
    // Preserve rotation order (1st, 2nd, 3rd, … of distinct groups).
    const teams: Team[] = teamIds
      .map((id) => teamMap.get(id))
      .filter((t): t is Team => !!t);
    if (teams.length < 2) continue;

    const fixtures = generateRoundRobin(teams, groupName);
    for (const fixture of fixtures) {
      const slot = nextSlot();
      const court = nextCourt();
      await client.query(
        `INSERT INTO matches (tournament_id, team1_id, team2_id, date, time, court, status, phase, group_name)
         VALUES ($1, $2, $3, $4, $5, $6, 'upcoming', $7, $8)`,
        [tournamentId, fixture.team1Id, fixture.team2Id, slot.date, slot.time, court, phase, groupName],
      );
      onMatchCreated();
    }
    poolsCreated++;
  }

  return poolsCreated;
}

// ── Finalize function ────────────────────────────────────────────────
//
// After all triangular matches are played, read the standings for
// each secondary-phase group and seed the bracket semifinals.
//
// We look at matches.group_name LIKE '%|Oro|%' and '%|Plata|%' to
// find the triangular groups, compute standings on-the-fly from the
// matches table, then update bracket_matches for the semifinals.

export async function finalizeSecondaryPhase(
  tournamentId: string,
): Promise<FinalizeResult> {
  const pool = getPool();

  // Load tournament
  const tournRes = await pool.query(
    'SELECT id, categories, secondary_phase FROM tournaments WHERE id = $1',
    [tournamentId],
  );
  if (tournRes.rows.length === 0) throw new NotFoundError('Torneo');
  const tournament = tournRes.rows[0] as Record<string, unknown>;

  const spRaw = tournament.secondary_phase as SecondaryPhaseConfig | null;
  if (!spRaw?.enabled) {
    throw new ValidationError('La fase secundaria no está habilitada en este torneo');
  }

  const categories: string[] = (tournament.categories as string[] | null) ?? [];
  const seedingMode: 'balanced' | 'divisions' =
    spRaw.seedingMode === 'divisions' ? 'divisions' : 'balanced';

  // Helper: compute a simple standing for a set of matches within a group_name.
  // Returns team IDs sorted by wins desc, then set diff desc.
  async function getGroupWinner(groupName: string): Promise<string | null> {
    const matchesRes = await pool.query(
      `SELECT m.team1_id, m.team2_id, m.score_team1, m.score_team2
         FROM matches m
         WHERE m.tournament_id = $1 AND m.group_name = $2 AND m.status = 'completed'`,
      [tournamentId, groupName],
    );

    const rows = matchesRes.rows as Array<{
      team1_id: string;
      team2_id: string;
      score_team1: number | null;
      score_team2: number | null;
    }>;

    if (rows.length === 0) {
      // Try standings table
      const standRes = await pool.query(
        `SELECT team_id FROM standings
           WHERE tournament_id = $1 AND group_name = $2
           ORDER BY position ASC LIMIT 1`,
        [tournamentId, groupName],
      );
      if (standRes.rows.length > 0) {
        return (standRes.rows[0] as { team_id: string }).team_id;
      }
      return null;
    }

    const stats = new Map<string, { wins: number; setDiff: number }>();
    const ensureEntry = (id: string) => {
      if (!stats.has(id)) stats.set(id, { wins: 0, setDiff: 0 });
    };

    for (const row of rows) {
      const t1 = row.team1_id;
      const t2 = row.team2_id;
      const s1 = row.score_team1 ?? 0;
      const s2 = row.score_team2 ?? 0;
      ensureEntry(t1);
      ensureEntry(t2);
      const e1 = stats.get(t1)!;
      const e2 = stats.get(t2)!;
      e1.setDiff += s1 - s2;
      e2.setDiff += s2 - s1;
      if (s1 > s2) {
        e1.wins++;
      } else if (s2 > s1) {
        e2.wins++;
      }
    }

    // Sort descending by wins, then set diff
    const sorted = [...stats.entries()].sort(([, a], [, b]) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.setDiff - a.setDiff;
    });

    return sorted.length > 0 ? sorted[0][0] : null;
  }

  let semiFinalsSeeded = 0;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const category of categories) {
      // ── Balanced pools: seed a single NON-tiered bracket ──────────
      if (seedingMode === 'balanced') {
        // Find this category's balanced pools, in letter order.
        const poolsRes = await client.query(
          `SELECT DISTINCT group_name FROM matches
             WHERE tournament_id = $1 AND group_name LIKE $2
             ORDER BY group_name`,
          [tournamentId, `${category}|${BALANCED_POOL_TOKEN}|%`],
        );
        const poolNames = (poolsRes.rows as Array<{ group_name: string }>)
          .map((r) => r.group_name)
          .sort();
        if (poolNames.length === 0) continue;

        // One classifier per pool (the pool winner), in pool order.
        const winners: string[] = [];
        for (const gn of poolNames) {
          const w = await getGroupWinner(gn);
          if (w) winners.push(w);
        }
        if (winners.length < 2) continue;

        // Clean slate: drop any prior NON-tiered bracket for this category
        // (2-segment rounds like "Category|semifinal"), leaving tiered
        // Oro/Plata rows — if any — untouched.
        await client.query(
          `DELETE FROM bracket_matches
             WHERE tournament_id = $1
               AND round LIKE $2
               AND round NOT LIKE $3
               AND round NOT LIKE $4`,
          [tournamentId, `${category}|%`, `${category}|gold|%`, `${category}|silver|%`],
        );

        // Lay out a properly-sized single-elimination bracket. First
        // round is seeded (seed i vs seed N-1-i); later rounds start
        // empty and fill as winners advance. materialize + advanceWinner
        // handle byes and propagation for non-tiered rounds already.
        const N = winners.length;
        const rounds = roundsForTeamCount(N);
        for (const round of rounds) {
          const count = matchCountForRound(round, N);
          for (let position = 1; position <= count; position++) {
            let t1: string | null = null;
            let t2: string | null = null;
            if (round === rounds[0]) {
              const s1 = position - 1;
              const s2 = N - position;
              if (s1 < winners.length) t1 = winners[s1];
              if (s2 < winners.length && s2 !== s1) t2 = winners[s2];
            }
            await client.query(
              `INSERT INTO bracket_matches
                 (tournament_id, round, position, team1_id, team2_id, status)
               VALUES ($1, $2, $3, $4, $5, 'upcoming')`,
              [tournamentId, `${category}|${round}`, position, t1, t2],
            );
            if (round === rounds[0]) semiFinalsSeeded++;
          }
        }
        continue;
      }

      // ── Divisions (legacy): Copa Oro + Copa Plata brackets ─────────
      for (const division of ['Oro', 'Plata'] as const) {
        const tier = division === 'Oro' ? 'gold' : 'silver';

        // Find all secondary group names for this category+division
        const groupsRes = await client.query(
          `SELECT DISTINCT group_name FROM matches
             WHERE tournament_id = $1 AND group_name LIKE $2
             ORDER BY group_name`,
          [tournamentId, `${category}|${division}|%`],
        );
        if (groupsRes.rows.length === 0) continue;

        const groupNames: string[] = (groupsRes.rows as Array<{ group_name: string }>)
          .map((r) => r.group_name)
          .sort();

        // Get winners from each triangular group
        const classifiers: string[] = [];
        for (const gn of groupNames) {
          const winner = await getGroupWinner(gn);
          if (winner) classifiers.push(winner);
        }
        if (classifiers.length < 2) continue;

        // Clear old bracket_matches for this category+tier (clean slate)
        await client.query(
          `DELETE FROM bracket_matches
             WHERE tournament_id = $1 AND round LIKE $2`,
          [tournamentId, `${category}|${tier}|%`],
        );

        // Build a minimal bracket: semis + final
        // For N classifiers:
        //   - Math.floor(N/2) semifinals
        //   - 1 final
        // Pairing: seed 1 vs seed N, seed 2 vs seed N-1, ...
        const numSemis = Math.floor(classifiers.length / 2);
        const semiRound = `${category}|${tier}|semifinal`;
        const finalRound = `${category}|${tier}|final`;

        // Insert semifinal bracket_matches
        const semiIds: string[] = [];
        for (let i = 0; i < numSemis; i++) {
          const t1 = classifiers[i] ?? null;
          const t2 = classifiers[classifiers.length - 1 - i] ?? null;
          const res = await client.query(
            `INSERT INTO bracket_matches
               (tournament_id, round, position, team1_id, team2_id, status)
             VALUES ($1, $2, $3, $4, $5, 'upcoming')
             RETURNING id`,
            [tournamentId, semiRound, i + 1, t1, t2],
          );
          semiIds.push((res.rows[0] as { id: string }).id);
          semiFinalsSeeded++;
        }

        // Insert final bracket_match (teams TBD — winners advance automatically)
        await client.query(
          `INSERT INTO bracket_matches
             (tournament_id, round, position, team1_id, team2_id, status)
           VALUES ($1, $2, 1, NULL, NULL, 'upcoming')`,
          [tournamentId, finalRound],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Materialize all pending bracket slots into playable match rows
  const materializeResult = await bracketGenerator.materializePendingBracketMatches(tournamentId);

  return {
    semiFinalsSeeded,
    matchesMaterialized: materializeResult.matchesCreated + materializeResult.matchesUpdated,
  };
}
