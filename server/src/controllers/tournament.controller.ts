import { Request, Response, NextFunction } from 'express';
import { tournamentService } from '../services/tournament.service';
import { enrollmentService } from '../services/enrollment.service';
import { fixtureGenerator } from '../services/fixture.service';
import { bracketGenerator } from '../services/bracket.service';
import { standingsCalculator } from '../services/standings.service';
import { matchService } from '../services/match.service';
import { validateUUID } from '../middleware/validation';
import { ValidationError } from '../middleware/errorHandler';
import { optionalUser } from '../middleware/auth';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Scope by caller role:
    //   · admin      → only their own tournaments (owner_id match)
    //   · super_admin / public / judge → everything
    const caller = optionalUser(req);
    const tournaments = caller?.role === 'admin'
      ? await tournamentService.getAll({ scope: 'owner', ownerId: caller.userId })
      : await tournamentService.getAll({ scope: 'all' });
    res.json(tournaments);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const tournament = await tournamentService.getById(id);
    res.json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Ownership comes from req.user (set by authMiddleware), never from
    // the body — a malicious admin could otherwise assign tournaments to
    // another tenant. super_admin creating a tournament gets null owner
    // (platform-owned; visible to every super_admin, no quota).
    let ownerId: string | null = null;
    if (req.user?.role === 'admin') {
      ownerId = req.user.userId;
    }
    const tournament = await tournamentService.create(req.body, ownerId);
    res.status(201).json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const tournament = await tournamentService.update(id, req.body);
    res.json(tournament);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await tournamentService.delete(id);
    res.json({ message: 'Torneo eliminado exitosamente' });
  } catch (error) {
    next(error);
  }
}

export async function getMatches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');

    // Self-healing materialization pass: if the torneo already has a
    // bracket but its slots were never persisted into `matches`
    // (e.g. tournaments created before mig 030 dropped the NOT NULL
    // on team1_id/team2_id, OR a manual generateBracketCrossings
    // that ran before the materializer was wired), force the
    // materializer here so the admin's cronograma shows every
    // future slot (cuartos / semis / final / 3er puesto) and can be
    // scheduled end-to-end. Idempotent: `bracketGenerator.materialize…`
    // skips slots already linked via `bracket_match_id` and only
    // inserts new rows for missing ones, so calling it on every
    // admin GET is cheap (one indexed COUNT + zero writes on the
    // steady state).
    //
    // Best-effort: any failure (transient DB hiccup, schema drift on
    // an older deploy) MUST NOT block the response — the admin
    // needs to see whatever matches DO exist, even when the
    // materializer is unhappy. Failures are logged for the operator.
    //
    // Public visitors land here via the cache hot-path before the
    // controller runs (the cacheGet middleware sits before this in
    // tournament.routes.ts), so this side-effect only fires for
    // requests that carry an Authorization header. We further narrow
    // it to admin / super_admin: judges fetch this endpoint on every
    // referee-panel tick and don't need (or have any business
    // triggering) bracket materialization — the admin that created
    // the torneo is the right actor.
    const caller = optionalUser(req);
    if (caller && (caller.role === 'admin' || caller.role === 'super_admin')) {
      try {
        await bracketGenerator.materializePendingBracketMatches(id);
      } catch (err) {
        console.warn(
          `[tournament.getMatches] materialize on read failed for ${id}:`,
          err,
        );
      }
    }

    const matches = await tournamentService.getMatches(id);
    res.json(matches);
  } catch (error) {
    next(error);
  }
}

export async function getStandings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const standings = await tournamentService.getStandings(id);
    res.json(standings);
  } catch (error) {
    next(error);
  }
}

/**
 * Force-recalculate and persist the standings for a tournament, then re-
 * resolve any bracket slots that reference group positions so the knockout
 * bracket stays in sync with the freshly computed table. Used by the admin
 * UI's "Recalcular tabla" button.
 */
export async function recalculateStandings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const standings = await standingsCalculator.recalculate(id);
    // Best-effort: if the tournament doesn't have a bracket yet or has no
    // placeholders to resolve, this is a no-op. Failures here shouldn't
    // prevent the caller from getting the fresh standings.
    try {
      await bracketGenerator.resolveBracketFromStandings(id);
    } catch {
      // swallow: the standings update is the primary response
    }
    // Run the division auto-gen too so the "Recalcular Tabla y Bracket"
    // button is the manual override for tournaments that already
    // finished their group phase. force=true tells the auto-gen to
    // wipe and rebuild the bracket using the FRESH cumulative
    // ranking — guarded internally so any in-progress bracket match
    // aborts the regen instead of erasing played rounds.
    try {
      await fixtureGenerator.autoGenerateDivisionBrackets(id, { force: true });
      // Re-resolve once more so freshly inserted Oro/Plata placeholders
      // pick up the current standings without waiting for the next
      // poll tick on the client.
      await bracketGenerator.resolveBracketFromStandings(id);
    } catch {
      // swallow: best-effort
    }
    res.json(standings);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/tournaments/:id/repair-conflicts
 *
 * Detects every team double-booking in the tournament's matches and
 * reschedules the offending matches into safe slots. Used by the admin
 * "Reparar horarios" button after the SAN JOSE A bug from 2026-05-10
 * surfaced a class of legacy fixtures with two-matches-at-the-same-time
 * for one team.
 *
 * Auth + ownership: gated at the route level by requireTournamentAccess,
 * so an admin can only repair their own tournaments and judges + public
 * are blocked. Returns the move list so the UI can show "moví N partidos".
 */
export async function repairConflicts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const result = await matchService.repairTeamConflicts(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getBracket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const bracket = await tournamentService.getBracket(id);
    res.json(bracket);
  } catch (error) {
    next(error);
  }
}

export async function getEnrolledTeams(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const teams = await enrollmentService.getEnrolledTeams(id);
    res.json(teams);
  } catch (error) {
    next(error);
  }
}

export async function enrollTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { teamId } = req.body;
    // The acting owner is the admin in req.user; super_admin and judge
    // pass null so the service skips the cross-tenant check (super_admin
    // can enroll any team, judge shouldn't reach this route at all but
    // the role guard runs before us).
    const actingOwnerId = req.user?.role === 'admin' ? req.user.userId : null;
    const enrolled = await enrollmentService.enroll(id, teamId, actingOwnerId);
    res.status(201).json(enrolled);
  } catch (error) {
    next(error);
  }
}

export async function unenrollTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const teamId = req.params.teamId as string;
    validateUUID(teamId, 'ID de equipo');
    await enrollmentService.unenroll(id, teamId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function generateFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { schedule, categoryFilter } = req.body || {};
    const result = await fixtureGenerator.generate(id, schedule, categoryFilter);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function generateManualFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { groups, bracketSeeds, schedule, categoryFilter } = req.body;
    const result = await fixtureGenerator.generateManual(id, {
      groups,
      bracketSeeds,
      schedule,
      categoryFilter,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function clearFixtures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await fixtureGenerator.clearFixtures(id);
    // Also clear standings
    const { getPool } = await import('../config/database');
    const pool = getPool();
    await pool.query('DELETE FROM standings WHERE tournament_id = $1', [id]);
    res.json({ message: 'Cruces eliminados' });
  } catch (error) {
    next(error);
  }
}

export async function updateBracketMatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tournamentId = req.params.id as string;
    const matchId = req.params.matchId as string;
    validateUUID(tournamentId, 'ID de torneo');
    validateUUID(matchId, 'ID de partido de bracket');

    const { scoreTeam1, scoreTeam2, status, sets } = req.body;

    // Update score fields on the bracket match
    const pool = (await import('../config/database')).getPool();

    // Verify the bracket match belongs to this tournament
    const bmResult = await pool.query(
      'SELECT * FROM bracket_matches WHERE id = $1 AND tournament_id = $2',
      [matchId, tournamentId]
    );
    if (bmResult.rows.length === 0) {
      throw new ValidationError('Partido de bracket no encontrado en este torneo');
    }

    const bm = bmResult.rows[0];

    // Update score and status
    await pool.query(
      `UPDATE bracket_matches SET score_team1 = $1, score_team2 = $2, status = $3 WHERE id = $4`,
      [scoreTeam1 ?? bm.score_team1, scoreTeam2 ?? bm.score_team2, status ?? bm.status, matchId]
    );

    // If completed, determine winner and advance
    if (status === 'completed' && bm.team1_id && bm.team2_id) {
      // Determine winner from sets if provided, otherwise from scores
      let winnerId: string;
      if (sets && sets.length > 0) {
        let team1SetsWon = 0;
        let team2SetsWon = 0;
        for (const s of sets) {
          if (s.team1Points > s.team2Points) team1SetsWon++;
          else if (s.team2Points > s.team1Points) team2SetsWon++;
        }
        winnerId = team1SetsWon > team2SetsWon ? bm.team1_id : bm.team2_id;
      } else {
        winnerId = (scoreTeam1 ?? 0) > (scoreTeam2 ?? 0) ? bm.team1_id : bm.team2_id;
      }

      // Use bracketGenerator.advanceWinner to set winner and advance to next round
      await bracketGenerator.advanceWinner(matchId, winnerId);
    }

    // Return updated bracket for the tournament
    const bracket = await bracketGenerator.getBracket(tournamentId);
    res.json(bracket);
  } catch (error) {
    next(error);
  }
}

export async function generateBracketCrossings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    const { seeds, categoryFilter, bracketTier } = req.body;
    if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
      throw new ValidationError('Se requieren las posiciones del bracket (seeds)');
    }
    if (bracketTier && bracketTier !== 'gold' && bracketTier !== 'silver') {
      throw new ValidationError('bracketTier debe ser "gold" o "silver"');
    }
    const bracketMatches = await fixtureGenerator.generateBracketCrossings(id, seeds, {
      categoryFilter,
      bracketTier,
    });
    res.json({ bracketMatches, generatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}

export async function resolveBracket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    validateUUID(id, 'ID de torneo');
    await bracketGenerator.resolveBracketFromStandings(id);
    // Run materialize explicitly so the response carries the diagnostic
    // snapshot. resolveBracketFromStandings already invokes it, but its
    // return value is just the count of bracket-row updates — we want
    // the materializer's own counters to surface in the toast.
    const materialize = await bracketGenerator
      .materializePendingBracketMatches(id)
      .catch((err) => {
        console.warn('[resolveBracket] materialize failed:', err);
        return null;
      });
    const bracket = await bracketGenerator.getBracket(id);
    res.json({ bracket, materialize });
  } catch (error) {
    next(error);
  }
}
