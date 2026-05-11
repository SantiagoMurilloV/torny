import { Request, Response, NextFunction } from 'express';
import { getPool } from '../config/database';
import { getActiveUserIds, getActiveVisitorsCount } from '../services/presence';

/**
 * Lightweight dashboard rollup for the admin home. Scoped to the caller:
 *   · liveMatches    — matches with status='live' in THIS admin's tournaments
 *   · activeJudges   — judges created by THIS admin that hit the API in the
 *                      last 5 min (cross-reference presence.getActiveUserIds
 *                      with users.created_by)
 *   · activeVisitors — platform-wide, same number the super-admin sees
 *
 * requireRole('admin') at the router guarantees `req.user` is set.
 */
export async function dashboardStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminId = req.user!.userId;
    const pool = getPool();

    // Single round-trip for all DB-backed numbers. Subselects keep it
    // readable; the COUNT DISTINCT on teams and players is the scoping
    // trick — teams live globally but we only count the ones enrolled
    // in THIS admin's tournaments, and similarly for their rosters.
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE t.owner_id = $1 AND m.status = 'live') AS live_matches,
        (SELECT COUNT(*)::int FROM tournaments WHERE owner_id = $1) AS tournaments,
        (SELECT COUNT(DISTINCT tt.team_id)::int FROM tournament_teams tt
         JOIN tournaments t ON tt.tournament_id = t.id
         WHERE t.owner_id = $1) AS teams,
        (SELECT COUNT(DISTINCT p.id)::int FROM players p
         JOIN tournament_teams tt ON p.team_id = tt.team_id
         JOIN tournaments t ON tt.tournament_id = t.id
         WHERE t.owner_id = $1) AS players,
        COALESCE(ARRAY_AGG(id) FILTER (WHERE role = 'judge' AND created_by = $1), '{}') AS judge_ids
       FROM users`,
      [adminId],
    );
    const row = result.rows[0] as {
      live_matches: number;
      tournaments: number;
      teams: number;
      players: number;
      judge_ids: string[];
    };

    const activeUserIds = getActiveUserIds();
    const activeJudges = (row.judge_ids ?? []).filter((id) => activeUserIds.has(id))
      .length;

    res.json({
      liveMatches: row.live_matches,
      tournaments: row.tournaments,
      teams: row.teams,
      players: row.players,
      activeJudges,
      activeVisitors: getActiveVisitorsCount(),
    });
  } catch (error) {
    next(error);
  }
}
