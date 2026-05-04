import { request } from './client';
import type { Team, Match, TeamCredentialsReceipt } from '../../types';
import type { BackendTeam, BackendMatch } from './backend-shapes';
import {
  toFrontendTeam,
  toFrontendMatch,
  updateTeamsCache,
  ensureTeamsCached,
} from './transformers';
import type { CreateTeamDto, UpdateTeamDto } from './dtos';

/**
 * Team CRUD + captain credentials. `getTeams()` also primes the shared
 * teams cache so match/bracket transformers can re-attach full Team
 * objects without an extra round-trip.
 */
export const teamsApi = {
  async getTeams(): Promise<Team[]> {
    const data = await request<BackendTeam[]>('/teams');
    const teams = data.map(toFrontendTeam);
    updateTeamsCache(teams);
    return teams;
  },

  async getTeam(id: string): Promise<Team> {
    const data = await request<BackendTeam>(`/teams/${id}`);
    return toFrontendTeam(data);
  },

  async createTeam(dto: CreateTeamDto): Promise<Team> {
    const data = await request<BackendTeam>('/teams', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return toFrontendTeam(data);
  },

  async updateTeam(id: string, dto: UpdateTeamDto): Promise<Team> {
    const data = await request<BackendTeam>(`/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
    return toFrontendTeam(data);
  },

  async deleteTeam(id: string): Promise<void> {
    await request<void>(`/teams/${id}`, { method: 'DELETE' });
  },

  async getTeamMatches(id: string): Promise<Match[]> {
    await ensureTeamsCached();
    const data = await request<BackendMatch[]>(`/teams/${id}/matches`);
    return data.map(toFrontendMatch);
  },

  /**
   * Generate (or regenerate) captain login credentials for a team. The
   * plaintext password is returned ONCE — caller shows it in the show-once
   * modal and drops it on close. Backend persists bcrypt hash + optional
   * AES-256-GCM recovery blob.
   */
  async generateTeamCredentials(teamId: string): Promise<TeamCredentialsReceipt> {
    return request<TeamCredentialsReceipt>(`/teams/${teamId}/credentials`, {
      method: 'POST',
    });
  },

  /**
   * Fetch the team's current captain credentials. Returns the plaintext
   * password when PLATFORM_RECOVERY_KEY is enabled; null otherwise. Throws
   * ApiError(404) when no credentials have ever been generated.
   */
  async getTeamCredentials(teamId: string): Promise<TeamCredentialsReceipt> {
    return request<TeamCredentialsReceipt>(`/teams/${teamId}/credentials`);
  },
};
