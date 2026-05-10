import { getPool } from '../config/database';
import { EnrolledTeam, Team } from '../types';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

interface EnrolledTeamsByCategory {
  category: string;
  teams: EnrolledTeam[];
}

function mapTeamFromRow(row: Record<string, unknown>): Team {
  // captain_username + credentials_generated_at are joined here so the
  // enrolled-teams endpoint surfaces the captain handle without an
  // extra round-trip per row. Skipping them is what made the public
  // team list "lose" credentials after a reload — the front-end then
  // saw `team.captainUsername === undefined` and treated the row as
  // never-credentialed even though the column on `teams` was populated.
  const generatedAtRaw = row.team_credentials_generated_at as
    | Date
    | string
    | null
    | undefined;
  const generatedAt =
    generatedAtRaw instanceof Date
      ? generatedAtRaw.toISOString()
      : (generatedAtRaw ?? undefined);
  return {
    id: row.team_id as string,
    name: row.team_name as string,
    initials: row.team_initials as string,
    logo: row.team_logo as string | undefined,
    primaryColor: row.team_primary_color as string,
    secondaryColor: row.team_secondary_color as string,
    city: row.team_city as string | undefined,
    department: row.team_department as string | undefined,
    category: row.team_category as string | undefined,
    captainUsername: (row.team_captain_username as string | null) ?? undefined,
    credentialsGeneratedAt: generatedAt,
  };
}

function mapEnrolledTeamRow(row: Record<string, unknown>): EnrolledTeam {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    teamId: row.team_id as string,
    team: mapTeamFromRow(row),
  };
}

export class EnrollmentService {
  async getEnrolledTeams(tournamentId: string): Promise<EnrolledTeam[]> {
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
      `SELECT tt.id, tt.tournament_id, tt.team_id,
              t.name AS team_name, t.initials AS team_initials, t.logo AS team_logo,
              t.primary_color AS team_primary_color, t.secondary_color AS team_secondary_color,
              t.city AS team_city, t.department AS team_department, t.category AS team_category,
              t.captain_username AS team_captain_username,
              t.credentials_generated_at AS team_credentials_generated_at
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       WHERE tt.tournament_id = $1
       ORDER BY t.name`,
      [tournamentId]
    );

    return result.rows.map(mapEnrolledTeamRow);
  }

  async getEnrolledTeamsByCategory(tournamentId: string): Promise<EnrolledTeamsByCategory[]> {
    const enrolledTeams = await this.getEnrolledTeams(tournamentId);

    const categoryMap = new Map<string, EnrolledTeam[]>();

    for (const enrolled of enrolledTeams) {
      const category = enrolled.team.category || 'Sin Categoría';
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(enrolled);
    }

    const result: EnrolledTeamsByCategory[] = [];
    for (const [category, teams] of categoryMap.entries()) {
      result.push({ category, teams });
    }

    // Sort categories alphabetically, but "Sin Categoría" goes last
    result.sort((a, b) => {
      if (a.category === 'Sin Categoría') return 1;
      if (b.category === 'Sin Categoría') return -1;
      return a.category.localeCompare(b.category);
    });

    return result;
  }

  /**
   * Enroll a team in a tournament.
   *
   * `actingOwnerId` is the admin id pulled from req.user (or null for
   * super_admin). When provided we cross-check that the team belongs to
   * the same admin who is enrolling — Admin A cannot pluck Admin B's
   * team into their own tournament. Tournament ownership itself is
   * already validated by `requireTournamentAccess` upstream so the team
   * check is the only extra step here.
   */
  async enroll(
    tournamentId: string,
    teamId: string,
    actingOwnerId: string | null = null,
  ): Promise<EnrolledTeam> {
    const pool = getPool();

    // Validate tournament exists
    const tournamentResult = await pool.query(
      'SELECT id FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      throw new NotFoundError('Torneo');
    }

    // Validate team exists + belongs to the calling admin (if any).
    const teamResult = await pool.query(
      'SELECT id, owner_id FROM teams WHERE id = $1',
      [teamId]
    );
    if (teamResult.rows.length === 0) {
      throw new NotFoundError('Equipo');
    }
    const teamOwner = (teamResult.rows[0] as { owner_id: string | null }).owner_id;
    if (actingOwnerId !== null && teamOwner !== actingOwnerId) {
      // Treat cross-tenant enrollment as 404 (don't leak existence).
      throw new NotFoundError('Equipo');
    }

    // Check not already enrolled
    const existingResult = await pool.query(
      'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );
    if (existingResult.rows.length > 0) {
      throw new ValidationError('El equipo ya está inscrito en este torneo');
    }

    // Insert enrollment
    const insertResult = await pool.query(
      `INSERT INTO tournament_teams (tournament_id, team_id)
       VALUES ($1, $2)
       RETURNING id, tournament_id, team_id`,
      [tournamentId, teamId]
    );

    const row = insertResult.rows[0];

    // Fetch full team data for the response
    const fullTeamResult = await pool.query(
      `SELECT t.id AS team_id, t.name AS team_name, t.initials AS team_initials,
              t.logo AS team_logo, t.primary_color AS team_primary_color,
              t.secondary_color AS team_secondary_color, t.city AS team_city,
              t.department AS team_department, t.category AS team_category
       FROM teams t WHERE t.id = $1`,
      [teamId]
    );

    return {
      id: row.id as string,
      tournamentId: row.tournament_id as string,
      teamId: row.team_id as string,
      team: mapTeamFromRow(fullTeamResult.rows[0]),
    };
  }

  async unenroll(tournamentId: string, teamId: string): Promise<void> {
    const pool = getPool();

    // Validate enrollment exists
    const enrollmentResult = await pool.query(
      'SELECT id FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );
    if (enrollmentResult.rows.length === 0) {
      throw new NotFoundError('Inscripción');
    }

    // Check no matches exist for this team in this tournament
    const matchesResult = await pool.query(
      `SELECT COUNT(*) AS count FROM matches
       WHERE tournament_id = $1 AND (team1_id = $2 OR team2_id = $2)`,
      [tournamentId, teamId]
    );
    if (parseInt(matchesResult.rows[0].count, 10) > 0) {
      throw new ValidationError(
        'No se puede desinscribir un equipo con partidos generados. Elimine los cruces primero'
      );
    }

    // Delete enrollment
    await pool.query(
      'DELETE FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2',
      [tournamentId, teamId]
    );
  }
}

export const enrollmentService = new EnrollmentService();
