import { request } from './client';
import type { Match } from '../../types';
import type { BackendMatch } from './backend-shapes';
import { toFrontendMatch, ensureTeamsCached } from './transformers';
import type { CreateMatchDto, UpdateMatchDto, ScoreUpdate } from './dtos';

/**
 * Match CRUD + score updates. Score updates go to a dedicated endpoint
 * (`/matches/:id/score`) because they carry the per-set payload that
 * standings/bracket cascades need to recompute on the server.
 *
 * Read methods always `await ensureTeamsCached()` first so the
 * transformer can attach full Team objects (name, colors, initials,
 * logo) instead of falling back to the neutral placeholder. This makes
 * pages that race-fetch matches + teams in parallel render correctly
 * regardless of which response arrives first.
 */
export const matchesApi = {
  async getMatches(): Promise<Match[]> {
    await ensureTeamsCached();
    const data = await request<BackendMatch[]>('/matches');
    return data.map(toFrontendMatch);
  },

  async getMatch(id: string): Promise<Match> {
    await ensureTeamsCached();
    const data = await request<BackendMatch>(`/matches/${id}`);
    return toFrontendMatch(data);
  },

  async createMatch(dto: CreateMatchDto): Promise<Match> {
    await ensureTeamsCached();
    const data = await request<BackendMatch>('/matches', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return toFrontendMatch(data);
  },

  async updateMatch(id: string, dto: UpdateMatchDto): Promise<Match> {
    await ensureTeamsCached();
    const data = await request<BackendMatch>(`/matches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
    return toFrontendMatch(data);
  },

  async updateMatchScore(id: string, score: ScoreUpdate): Promise<Match> {
    await ensureTeamsCached();
    const data = await request<BackendMatch>(`/matches/${id}/score`, {
      method: 'PUT',
      body: JSON.stringify(score),
    });
    return toFrontendMatch(data);
  },

  async deleteMatch(id: string): Promise<void> {
    await request<void>(`/matches/${id}`, { method: 'DELETE' });
  },
};
