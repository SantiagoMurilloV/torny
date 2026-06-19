import { request } from './client';
import type {
  Tournament,
  Team,
  Match,
  StandingsRow,
  BracketMatch,
  FixtureResult,
  TournamentSponsor,
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

export interface SecondaryPhaseResult {
  categoriesProcessed: string[];
  oroGroupsCreated: number;
  plataGroupsCreated: number;
  matchesCreated: number;
}

export interface SecondaryPhaseFinalizeResult {
  semiFinalsSeeded: number;
  matchesMaterialized: number;
}

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
    /** Matches the priority pass relocated. Surfaced separately so the
     *  toast can say "reordené N por prioridad" instead of bundling
     *  them into the team/court conflict counters. */
    priorityReordered: number;
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

  /**
   * Free-form push notification to every enrolled club. Body
   * shape: `{ title, body, url? }`. Admins use it for one-off
   * reminders / announcements that should reach club captains
   * (not the public stream).
   */
  async notifyClubs(
    id: string,
    payload: { title: string; body: string; url?: string },
  ): Promise<{
    tournamentId: string;
    tournamentName: string;
    clubsNotified: number;
    clubs: Array<{ clubId: string; clubName: string }>;
  }> {
    return request(`/tournaments/${id}/notify-clubs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Free-form push to EVERY subscriber (public spectators + club
   * captains). For tournament-wide announcements.
   */
  async notifyAll(
    id: string,
    payload: { title: string; body: string; url?: string },
  ): Promise<{
    tournamentId: string;
    tournamentName: string;
    totalSubscriptions: number;
  }> {
    return request(`/tournaments/${id}/notify-all`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ── Sponsors (mig 033) ──────────────────────────────────────────

  async listSponsors(id: string): Promise<TournamentSponsor[]> {
    return request(`/tournaments/${id}/sponsors`);
  },

  async createSponsor(
    id: string,
    payload: { name?: string | null; logo: string; link?: string | null },
  ): Promise<TournamentSponsor> {
    return request(`/tournaments/${id}/sponsors`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateSponsor(
    id: string,
    sponsorId: string,
    payload: Partial<{
      name: string | null;
      logo: string;
      link: string | null;
      displayOrder: number;
    }>,
  ): Promise<TournamentSponsor> {
    return request(`/tournaments/${id}/sponsors/${sponsorId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteSponsor(id: string, sponsorId: string): Promise<void> {
    await request(`/tournaments/${id}/sponsors/${sponsorId}`, {
      method: 'DELETE',
    });
  },

  async reorderSponsors(id: string, orderedIds: string[]): Promise<TournamentSponsor[]> {
    return request(`/tournaments/${id}/sponsors/reorder`, {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  },

  /**
   * Publish the tournament schedule to every enrolled club. The
   * backend stamps `schedule_sent_to_clubs_at` and pushes a
   * notification to every distinct club whose team is enrolled.
   * Idempotent — calling it again updates the timestamp + re-fires
   * the push, so the admin can resend after a schedule edit.
   */
  async sendScheduleToClubs(id: string): Promise<{
    tournamentId: string;
    tournamentName: string;
    sentAt: string | null;
    clubsNotified: number;
    clubs: Array<{ clubId: string; clubName: string }>;
  }> {
    return request(`/tournaments/${id}/send-schedule-to-clubs`, {
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

  // ── Secondary phase (triangulares) ──────────────────────────────

  /**
   * Generate round-robin matches for the secondary group phase
   * (triangulares). Creates Oro + Plata triangular groups from the
   * primary-phase standings and schedules matches after existing ones.
   */
  async generateSecondaryPhase(tournamentId: string): Promise<SecondaryPhaseResult> {
    return request<SecondaryPhaseResult>(
      `/tournaments/${tournamentId}/secondary-phase/generate`,
      { method: 'POST' },
    );
  },

  /**
   * Finalize the secondary phase: read the winner of each triangular
   * group and seed them into the bracket semifinals. Calls the bracket
   * materializer so the semifinal matches appear in the schedule.
   */
  async finalizeSecondaryPhase(tournamentId: string): Promise<SecondaryPhaseFinalizeResult> {
    return request<SecondaryPhaseFinalizeResult>(
      `/tournaments/${tournamentId}/secondary-phase/finalize`,
      { method: 'POST' },
    );
  },
};
