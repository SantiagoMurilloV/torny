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

  /**
   * Atomically swap (date, time, court) between two matches. Used by
   * the Cronograma drag-and-drop UI when the admin drops match A on
   * match B's slot — a regular PUT on either side would crash into
   * the other's row at the conflict check, so the backend exposes a
   * dedicated `/matches/swap` endpoint that bypasses that guard.
   * Returns both matches with their NEW slots so the UI can update
   * state in one go.
   */
  async swapMatches(
    matchAId: string,
    matchBId: string,
  ): Promise<{ matchA: Match; matchB: Match }> {
    await ensureTeamsCached();
    const data = await request<{ matchA: BackendMatch; matchB: BackendMatch }>(
      '/matches/swap',
      {
        method: 'POST',
        body: JSON.stringify({ matchAId, matchBId }),
      },
    );
    return {
      matchA: toFrontendMatch(data.matchA),
      matchB: toFrontendMatch(data.matchB),
    };
  },
};
