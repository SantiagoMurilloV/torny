import type { PoolClient } from 'pg';
import type { Match, BracketMatch } from '../../types';
import type { MatchFixture, BracketFixture, BracketTier } from './types';
import { mapMatchRow, mapBracketRow } from './mappers';

interface Slot {
  date: string;
  time: string;
  court: string;
}

/**
 * Insert the generated matches into the `matches` table. Runs inside
 * the caller's transaction. Takes the calculated schedule slots so
 * the schedule algorithm stays pure (no DB in schedule.ts).
 */
export async function persistMatches(
  client: PoolClient,
  tournamentId: string,
  fixtures: MatchFixture[],
  slots: Slot[],
): Promise<Match[]> {
  const persisted: Match[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const { date, time, court } = slots[i];
    const result = await client.query(
      `INSERT INTO matches (tournament_id, team1_id, team2_id, date, time, court, status, phase, group_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tournamentId,
        fixture.team1Id,
        fixture.team2Id,
        date,
        time,
        court,
        'upcoming',
        fixture.phase,
        fixture.groupName || null,
      ],
    );
    persisted.push(mapMatchRow(result.rows[0]));
  }
  return persisted;
}

/**
 * Insert the generated bracket fixtures into the `bracket_matches`
 * table. Team ids may already be resolved (knockout manual) or be
 * left NULL with a placeholder label (groups+knockout). Runs inside
 * the caller's transaction.
 */
export async function persistBracket(
  client: PoolClient,
  tournamentId: string,
  fixtures: BracketFixture[],
): Promise<BracketMatch[]> {
  const persisted: BracketMatch[] = [];
  for (const bf of fixtures) {
    const result = await client.query(
      `INSERT INTO bracket_matches
         (tournament_id, team1_id, team2_id, status, round, position, team1_placeholder, team2_placeholder)
       VALUES ($1, $2, $3, 'upcoming', $4, $5, $6, $7)
       RETURNING *`,
      [
        tournamentId,
        bf.team1Id || null,
        bf.team2Id || null,
        bf.roundName,
        bf.position,
        bf.team1Placeholder || null,
        bf.team2Placeholder || null,
      ],
    );
    persisted.push(mapBracketRow(result.rows[0]));
  }
  return persisted;
}

/** Truncate both `matches` and `bracket_matches` for the tournament. */
export async function clearTournamentFixtures(
  client: PoolClient,
  tournamentId: string,
): Promise<void> {
  await client.query('DELETE FROM matches WHERE tournament_id = $1', [tournamentId]);
  await client.query('DELETE FROM bracket_matches WHERE tournament_id = $1', [tournamentId]);
}

/**
 * Delete only the fixtures that belong to a specific category, leaving
 * other categories untouched. The category is encoded as a prefix in:
 *   · matches.group_name  → "Category|A" / "Category|liga"
 *   · bracket_matches.round → "Category|semifinal"
 *
 * Both fields use `category|…` so a single `LIKE 'Category|%'` catches
 * everything. A NULL / empty `group_name` means the match isn't
 * category-scoped and must be left alone.
 */
export async function clearCategoryFixtures(
  client: PoolClient,
  tournamentId: string,
  category: string,
): Promise<void> {
  const prefix = `${category}|%`;
  await client.query(
    'DELETE FROM matches WHERE tournament_id = $1 AND group_name LIKE $2',
    [tournamentId, prefix],
  );
  await client.query(
    'DELETE FROM bracket_matches WHERE tournament_id = $1 AND round LIKE $2',
    [tournamentId, prefix],
  );
}

/**
 * Delete only the bracket rows for a single category. When `tier` is
 * passed, scope further to that tier so regenerating Oro doesn't wipe
 * Plata (the round column is "Category|gold|…" / "Category|silver|…").
 * Passing no tier targets both legacy 2-segment rounds and any tier so
 * callers that toggle between modes can clear cleanly.
 *
 * IMPORTANT (2026-05-13 fix): we ALSO have to drop the materialized
 * `matches` rows that link to those bracket_matches BEFORE deleting
 * the bracket rows. The FK is `ON DELETE SET NULL` (mig 018), which
 * means deleting a bracket_match silently nulls `matches.bracket_match_id`
 * and leaves an "orphan" upcoming row pointing nowhere. When the
 * materializer runs again on the regenerated bracket, it can't see
 * those orphans (the `existing` map is built from
 * `bracket_match_id IS NOT NULL`), so it inserts FRESH matches → the
 * cronograma shows two cards for the same phase ("Cuartos · Oro|…").
 *
 * Safety rules for the matches purge:
 *   · `status = 'upcoming'` only — never destroy live or completed
 *     fixtures. If a referee already loaded a score, that match was
 *     played and belongs to the historical record; leaving it as an
 *     orphan is the right behaviour.
 *   · `score_team1 IS NULL AND score_team2 IS NULL` — extra belt over
 *     status in case some path marked a row 'upcoming' after scoring.
 */
export async function clearCategoryBracket(
  client: PoolClient,
  tournamentId: string,
  category: string,
  tier?: BracketTier | null,
): Promise<void> {
  if (tier) {
    // 1. Drop materialized matches that link to this tier's bracket
    //    rows OR to the legacy 2-segment rows for the same category.
    //    Same WHERE clauses as the bracket_matches deletes below.
    await client.query(
      `DELETE FROM matches
         WHERE tournament_id = $1
           AND status = 'upcoming'
           AND score_team1 IS NULL
           AND score_team2 IS NULL
           AND bracket_match_id IN (
             SELECT id FROM bracket_matches
               WHERE tournament_id = $1
                 AND (
                   round LIKE $2
                   OR (
                     round LIKE $3
                     AND round NOT LIKE $4
                     AND round NOT LIKE $5
                   )
                 )
           )`,
      [
        tournamentId,
        `${category}|${tier}|%`,        // this tier's 3-seg rounds
        `${category}|%`,                 // any row for the category
        `${category}|gold|%`,            // exclude other tier
        `${category}|silver|%`,
      ],
    );

    // 2. Wipe this tier's 3-segment rows ("Category|<tier>|roundName").
    const tierPrefix = `${category}|${tier}|%`;
    await client.query(
      'DELETE FROM bracket_matches WHERE tournament_id = $1 AND round LIKE $2',
      [tournamentId, tierPrefix],
    );
    // 3. Also purge legacy 2-segment rows ("Category|roundName") for
    //    the same category — a tiered generation supersedes any
    //    single-bracket mode that was there before, otherwise those
    //    orphan rows show up in the UI as a phantom 3rd bracket
    //    alongside Oro + Plata. The OTHER tier's 3-segment rows are
    //    deliberately left alone so regenerating Oro keeps Plata (and
    //    vice-versa).
    await client.query(
      `DELETE FROM bracket_matches
         WHERE tournament_id = $1
           AND round LIKE $2
           AND round NOT LIKE $3
           AND round NOT LIKE $4`,
      [
        tournamentId,
        `${category}|%`,
        `${category}|gold|%`,
        `${category}|silver|%`,
      ],
    );
    return;
  }
  // Non-tiered branch: drop the whole category's bracket. Same
  // matches-first ordering to keep orphans out of the cronograma.
  const prefix = `${category}|%`;
  await client.query(
    `DELETE FROM matches
       WHERE tournament_id = $1
         AND status = 'upcoming'
         AND score_team1 IS NULL
         AND score_team2 IS NULL
         AND bracket_match_id IN (
           SELECT id FROM bracket_matches
             WHERE tournament_id = $1 AND round LIKE $2
         )`,
    [tournamentId, prefix],
  );
  await client.query(
    'DELETE FROM bracket_matches WHERE tournament_id = $1 AND round LIKE $2',
    [tournamentId, prefix],
  );
}
