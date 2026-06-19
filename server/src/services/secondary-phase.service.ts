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
}

export interface SecondaryPhaseResult {
  categoriesProcessed: string[];
  oroGroupsCreated: number;
  plataGroupsCreated: number;
  matchesCreated: number;
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

function distributeIntoPots(
  teamIds: string[],
  groupsPerDivision: number,
): string[][] {
  const groups: string[][] = Array.from({ length: groupsPerDivision }, () => []);
  for (let i = 0; i < teamIds.length; i++) {
    groups[i % groupsPerDivision].push(teamIds[i]);
  }
  return groups;
}

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

  try {
    await client.query('BEGIN');

    for (const category of categories) {
      // Gold positions: 1..goldPerGroup
      const goldPositions = Array.from({ length: goldPerGroup }, (_, i) => i + 1);
      // Silver positions: goldPerGroup+1..goldPerGroup+silverPerGroup
      const silverPositions =
        silverPerGroup > 0
          ? Array.from({ length: silverPerGroup }, (_, i) => goldPerGroup + i + 1)
          : [];

      // Get ranked team IDs for each division
      const oroTeamIds = await computeCumulativeRanking(
        tournamentId,
        category,
        goldPositions,
      );
      const plataTeamIds =
        silverPositions.length > 0
          ? await computeCumulativeRanking(tournamentId, category, silverPositions)
          : [];

      // Distribute into groups (pot-based)
      const { groupsPerDivision } = config;

      const processGroups = async (
        teamIds: string[],
        division: 'Oro' | 'Plata',
      ): Promise<number> => {
        if (teamIds.length < 2) return 0;

        const groups = distributeIntoPots(teamIds, groupsPerDivision);
        let groupsCreated = 0;

        for (let gi = 0; gi < groups.length; gi++) {
          const groupTeamIds = groups[gi];
          if (groupTeamIds.length < 2) continue; // skip empty/singleton groups

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
          // Preserve pot ordering
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

      const oroGroupsMade = await processGroups(oroTeamIds, 'Oro');
      const plataGroupsMade = await processGroups(plataTeamIds, 'Plata');

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
    matchesCreated,
  };
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
