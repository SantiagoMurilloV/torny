import { request } from './client';
import type {
  Tournament,
  Team,
  Match,
  StandingsRow,
  BracketMatch,
  FixtureResult,
} from '../../types';
import type {
  BackendTournament,
  BackendMatch,
  BackendStandingsRow,
  BackendBracketMatch,
  BackendEnrolledTeam,
} from './backend-shapes';
import {
  toFrontendTournament,
  toFrontendMatch,
  toFrontendStandingsRow,
  toFrontendBracketMatch,
  toFrontendTeam,
  ensureTeamsCached,
} from './transformers';
import type { CreateTournamentDto, UpdateTournamentDto } from './dtos';

interface ScheduleOptions {
  startTime?: string;
  endTime?: string;
  matchDuration?: number;
  breakDuration?: number;
  courtCount?: number;
}

interface ManualFixtureOptions {
  groups?: Record<string, string[]>;
  bracketSeeds?: Array<{ position: number; teamId: string | null; label?: string }>;
  schedule?: ScheduleOptions;
  /**
   * Limits the generation to a single category of the tournament. Set
   * when the admin picked a category from the picker dialog before
   * opening the manual-groups / manual-bracket modal. When absent, the
   * backend falls back to the legacy "all categories at once" path.
   */
  categoryFilter?: string;
}

/**
 * Tournaments + enrollment + fixture generation live here because the
 * endpoints are all nested under /tournaments/:id and share the same
 * response transformers. Splitting enrolment into its own file would
 * add an import without any real separation of concerns.
 */
export const tournamentsApi = {
  async getTournaments(): Promise<Tournament[]> {
    const data = await request<BackendTournament[]>('/tournaments');
    return data.map(toFrontendTournament);
  },

  async getTournament(id: string): Promise<Tournament> {
    const data = await request<BackendTournament>(`/tournaments/${id}`);
    return toFrontendTournament(data);
  },

  async createTournament(dto: CreateTournamentDto): Promise<Tournament> {
    const data = await request<BackendTournament>('/tournaments', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return toFrontendTournament(data);
  },

  async updateTournament(id: string, dto: UpdateTournamentDto): Promise<Tournament> {
    const data = await request<BackendTournament>(`/tournaments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
    return toFrontendTournament(data);
  },

  async deleteTournament(id: string): Promise<void> {
    await request<void>(`/tournaments/${id}`, { method: 'DELETE' });
  },

  async getTournamentMatches(id: string): Promise<Match[]> {
    await ensureTeamsCached();
    const data = await request<BackendMatch[]>(`/tournaments/${id}/matches`);
    return data.map(toFrontendMatch);
  },

  async getTournamentStandings(id: string): Promise<StandingsRow[]> {
    await ensureTeamsCached();
    const data = await request<BackendStandingsRow[]>(`/tournaments/${id}/standings`);
    return data.map(toFrontendStandingsRow);
  },

  /**
   * Force the backend to recompute and persist standings for a tournament.
   * Use after a scoring-rule change or when the UI shows stale numbers.
   */
  async recalculateStandings(id: string): Promise<StandingsRow[]> {
    await ensureTeamsCached();
    const data = await request<BackendStandingsRow[]>(
      `/tournaments/${id}/standings/recalculate`,
      { method: 'POST' },
    );
    return data.map(toFrontendStandingsRow);
  },

  async getTournamentBracket(id: string): Promise<BracketMatch[]> {
    await ensureTeamsCached();
    const data = await request<BackendBracketMatch[]>(`/tournaments/${id}/bracket`);
    return data.map(toFrontendBracketMatch);
  },

  /**
   * Detect every schedule problem in a tournament's matches and
   * reschedule the offenders into safe slots. Three failure modes are
   * caught:
   *   · teamConflicts  — same team in two matches at the same datetime
   *   · courtConflicts — same court double-booked at the same datetime
   *   · outOfRange     — match.date sits before tournament_start or
   *                      after tournament_end (admin shifted the dates
   *                      after fixtures were generated)
   * Idempotent — re-running it on a clean tournament returns
   * conflictsDetected: 0 and changes nothing.
   */
  async repairTournamentConflicts(id: string): Promise<{
    conflictsDetected: number;
    matchesMoved: number;
    teamConflicts: number;
    courtConflicts: number;
    outOfRange: number;
    moves: Array<{
      matchId: string;
      from: { date: string; time: string; court: string };
      to: { date: string; time: string; court: string };
    }>;
    unresolved: number;
    debug: {
      tournamentStart: string;
      tournamentEnd: string;
      totalMatches: number;
      earliestMatchDate: string | null;
      latestMatchDate: string | null;
    };
  }> {
    return request(`/tournaments/${id}/repair-conflicts`, {
      method: 'POST',
    });
  },

  // ── Enrolment ───────────────────────────────────────────────────

  async getEnrolledTeams(tournamentId: string): Promise<Team[]> {
    const data = await request<BackendEnrolledTeam[]>(`/tournaments/${tournamentId}/teams`);
    return data.map((e) => toFrontendTeam(e.team));
  },

  async enrollTeam(tournamentId: string, teamId: string): Promise<void> {
    await request<unknown>(`/tournaments/${tournamentId}/teams`, {
      method: 'POST',
      body: JSON.stringify({ teamId }),
    });
  },

  async unenrollTeam(tournamentId: string, teamId: string): Promise<void> {
    await request<void>(`/tournaments/${tournamentId}/teams/${teamId}`, {
      method: 'DELETE',
    });
  },

  // ── Fixtures ────────────────────────────────────────────────────

  async generateFixtures(
    tournamentId: string,
    schedule?: ScheduleOptions,
    categoryFilter?: string,
  ): Promise<FixtureResult> {
    return request<FixtureResult>(`/tournaments/${tournamentId}/generate-fixtures`, {
      method: 'POST',
      body: JSON.stringify({ schedule, categoryFilter }),
    });
  },

  async generateManualFixtures(
    tournamentId: string,
    options: ManualFixtureOptions,
  ): Promise<FixtureResult> {
    return request<FixtureResult>(`/tournaments/${tournamentId}/generate-manual-fixtures`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  async clearFixtures(tournamentId: string): Promise<void> {
    await request<void>(`/tournaments/${tournamentId}/fixtures`, { method: 'DELETE' });
  },
};
