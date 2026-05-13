import { Request, Response, NextFunction } from 'express';
import { platformService } from '../services/platform.service';
import { validateUUID } from '../middleware/validation';
import { getPool } from '../config/database';

/**
 * HTTP handlers for the super_admin control panel. All routes are gated
 * by `requireRole('super_admin')` at the router — the controller itself
 * doesn't re-check because that would just duplicate middleware.
 */

export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await platformService.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await platformService.listUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await platformService.createUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de usuario');
    const user = await platformService.updateUser(id, req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de usuario');
    // requireRole('super_admin') populated req.user already
    await platformService.deleteUser(id, req.user!.userId);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    next(err);
  }
}

/**
 * Reveal the stored-plaintext password of a user. Only works when the
 * recovery feature is on (PLATFORM_RECOVERY_KEY env var set) AND the
 * target user has a ciphertext on file. Super_admin-gated at the route.
 */
export async function revealPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de usuario');
    const result = await platformService.revealPassword(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Inspect duplicated / orphan bracket matches in a tournament.
 *
 * Built after the 2026-05-13 incident: the materializer's regen path
 * (`clearCategoryBracket`) used to delete bracket_matches without
 * touching the linked matches rows. The FK `ON DELETE SET NULL`
 * (mig 018) left those matches alive with `bracket_match_id = NULL`
 * but the same `phase`, so the next materialize created a sibling
 * row → the admin cronograma showed "Cuartos · Oro|Femenino" twice.
 *
 * This endpoint returns a read-only report so the operator can
 * eyeball what's there before invoking the destructive clean
 * endpoint. Returns three buckets:
 *   · `duplicatedPhases`  → phases that have >1 matches row.
 *   · `orphanMatches`     → upcoming, unscored matches with no
 *                            bracket_match_id link (the deletion
 *                            target for the clean endpoint).
 *   · `orphanWithScore`   → orphan rows that DO carry a score —
 *                            kept for manual relink because deleting
 *                            them would lose match history.
 */
export async function inspectOrphans(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const pool = getPool();

    const duplicatedPhases = await pool.query<{
      phase: string;
      rows: number;
      orphans: number;
      linked: number;
    }>(
      `SELECT phase,
              COUNT(*)::int AS rows,
              COUNT(*) FILTER (WHERE bracket_match_id IS NULL)::int AS orphans,
              COUNT(*) FILTER (WHERE bracket_match_id IS NOT NULL)::int AS linked
         FROM matches
        WHERE tournament_id = $1
          AND phase IS NOT NULL
          AND phase <> ''
        GROUP BY phase
       HAVING COUNT(*) > 1
        ORDER BY phase`,
      [id],
    );

    const orphanMatches = await pool.query(
      `SELECT id, phase, team1_id, team2_id,
              score_team1, score_team2, status,
              date::text AS date, time, court
         FROM matches
        WHERE tournament_id = $1
          AND bracket_match_id IS NULL
          AND phase IS NOT NULL
          AND phase <> ''
          AND status = 'upcoming'
          AND score_team1 IS NULL
          AND score_team2 IS NULL
        ORDER BY phase, date, time`,
      [id],
    );

    const orphanWithScore = await pool.query(
      `SELECT id, phase, team1_id, team2_id,
              score_team1, score_team2, status,
              date::text AS date, time, court
         FROM matches
        WHERE tournament_id = $1
          AND bracket_match_id IS NULL
          AND phase IS NOT NULL
          AND phase <> ''
          AND (score_team1 IS NOT NULL OR score_team2 IS NOT NULL OR status <> 'upcoming')
        ORDER BY phase, date, time`,
      [id],
    );

    res.json({
      tournamentId: id,
      duplicatedPhases: duplicatedPhases.rows,
      orphanMatches: orphanMatches.rows,
      orphanWithScore: orphanWithScore.rows,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Destructive cleanup: delete orphan upcoming bracket matches that
 * have no link to a bracket_matches row AND no score loaded. The
 * paired write in `clearCategoryBracket` (2026-05-13 fix) prevents
 * NEW orphans from appearing — this endpoint cleans the ones that
 * already piled up in production before the fix shipped.
 *
 * Hard safety rules:
 *   · `bracket_match_id IS NULL` — never touch a linked match.
 *   · `phase IS NOT NULL` — never touch group / liga rows.
 *   · `status = 'upcoming'` — never touch live or completed.
 *   · `score_team1 IS NULL AND score_team2 IS NULL` — never destroy
 *      scoring history. Orphans with score require manual relink.
 *
 * Returns the count of rows actually deleted so the operator can
 * verify the cleanup matched expectations.
 */
export async function cleanOrphans(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const pool = getPool();

    const result = await pool.query(
      `DELETE FROM matches
        WHERE tournament_id = $1
          AND bracket_match_id IS NULL
          AND phase IS NOT NULL
          AND phase <> ''
          AND status = 'upcoming'
          AND score_team1 IS NULL
          AND score_team2 IS NULL
        RETURNING id, phase, date::text AS date, time, court`,
      [id],
    );

    res.json({
      tournamentId: id,
      deletedCount: result.rowCount ?? 0,
      deleted: result.rows,
    });
  } catch (err) {
    next(err);
  }
}
