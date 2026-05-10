import { Router, Request, Response, NextFunction } from 'express';
import { getPool } from '../config/database';
import { bracketGenerator } from '../services/bracket.service';
import { cacheGet } from '../middleware/cache';
import { requireTournamentAccess } from '../middleware/access';
import {
  getAll,
  getById,
  create,
  update,
  remove,
  getMatches,
  getStandings,
  recalculateStandings,
  getBracket,
  getEnrolledTeams,
  enrollTeam,
  unenrollTeam,
  generateFixtures,
  generateManualFixtures,
  generateBracketCrossings,
  updateBracketMatch,
  clearFixtures,
  resolveBracket,
} from '../controllers/tournament.controller';

const router = Router();

// CRUD — public GETs go through the in-memory cache so a stadium full
// of spectators sharing the same tournament view triggers one DB query
// instead of N. TTLs are tuned per endpoint:
//   /tournaments      30 s (the index changes when admins create one)
//   /tournaments/:id  15 s (metadata edits are infrequent)
//   /matches           5 s (live scores; clients also poll every 25 s)
//   /standings        10 s
//   /bracket          10 s
//   /teams (enrolled) 30 s
// Authed callers (admins/judges) bypass the cache automatically.
router.get('/', cacheGet(30), getAll);
router.get('/:id', cacheGet(15), getById);
router.post('/', create);
// Mutations are gated by `requireTournamentAccess`: only the admin who
// owns the tournament (or super_admin) can edit / delete it. Public
// callers get 404 (not 403) so the existence of cross-tenant resources
// is never disclosed.
router.put('/:id', requireTournamentAccess, update);
router.delete('/:id', requireTournamentAccess, remove);

// Tournament sub-resources
//
// /matches TTL was raised from 5 s to 15 s after the load test showed
// that 400 concurrent spectators polling every 25 s saturated Vercel's
// rate limit when the 5 s cache window expired and the burst hit the
// origin every 5 s. With 15 s + swr=60 s, the front-edge collapses
// the polling crowd into ~1 origin hit per 15 s and serves the stale
// snapshot for up to 60 s while refreshing in the background. Visible
// score lag stays under the polling cadence, so end users don't notice.
router.get('/:id/matches', cacheGet(15, { swrSeconds: 60 }), getMatches);
router.get('/:id/standings', cacheGet(15, { swrSeconds: 60 }), getStandings);
router.post('/:id/standings/recalculate', requireTournamentAccess, recalculateStandings);
router.get('/:id/bracket', cacheGet(15, { swrSeconds: 60 }), getBracket);

// Team enrollment — list is public (spectators see who's playing); the
// enroll/unenroll mutations are owner-scoped.
router.get('/:id/teams', cacheGet(30), getEnrolledTeams);
router.post('/:id/teams', requireTournamentAccess, enrollTeam);
router.delete('/:id/teams/:teamId', requireTournamentAccess, unenrollTeam);

// Fixture generation
router.post('/:id/generate-fixtures', requireTournamentAccess, generateFixtures);
router.post('/:id/generate-manual-fixtures', requireTournamentAccess, generateManualFixtures);
router.post('/:id/generate-bracket-crossings', requireTournamentAccess, generateBracketCrossings);
router.delete('/:id/fixtures', requireTournamentAccess, clearFixtures);
router.post('/:id/resolve-bracket', requireTournamentAccess, resolveBracket);

// Bracket match update
router.put('/:id/bracket/:matchId', requireTournamentAccess, updateBracketMatch);

// Diagnostic endpoint — public-readable summary of the bracket vs
// matches state. Useful to debug "the bracket has teams but Partidos
// is empty" without browser access. Returns:
//   · bracket rows with their team1_id / team2_id / round / position /
//     placeholder values
//   · how many `matches` rows already point at a bracket_match_id
//   · the materializer counters (run as a dry probe + actual run)
router.get('/:id/bracket-debug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const pool = getPool();

    const tournRes = await pool.query(
      'SELECT id, name, courts, start_date, bracket_mode FROM tournaments WHERE id = $1',
      [id],
    );
    if (tournRes.rows.length === 0) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    const bracketRes = await pool.query(
      `SELECT id, round, position, team1_id, team2_id,
              team1_placeholder, team2_placeholder, status, winner_id
         FROM bracket_matches
         WHERE tournament_id = $1
         ORDER BY round, position`,
      [id],
    );

    const linkedMatchesRes = await pool.query(
      `SELECT id, bracket_match_id, team1_id, team2_id, phase, status, date, time, court
         FROM matches
         WHERE tournament_id = $1 AND bracket_match_id IS NOT NULL
         ORDER BY date, time`,
      [id],
    );

    const standingsRes = await pool.query(
      `SELECT team_id, group_name, position, played
         FROM standings
         WHERE tournament_id = $1
         ORDER BY group_name, position`,
      [id],
    );

    // Run a real materialize so the response shows what the next
    // call would actually do.
    const materializeReport = await bracketGenerator
      .materializePendingBracketMatches(id)
      .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));

    res.json({
      tournament: tournRes.rows[0],
      bracketCount: bracketRes.rows.length,
      bracketSample: bracketRes.rows,
      linkedMatchesCount: linkedMatchesRes.rows.length,
      linkedMatches: linkedMatchesRes.rows,
      standingsCount: standingsRes.rows.length,
      standingsSample: standingsRes.rows.slice(0, 30),
      materializeReport,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
