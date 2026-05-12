import { request } from './client';
import type { Player } from '../../types';
import type { CreatePlayerDto, UpdatePlayerDto } from './dtos';

/**
 * Roster endpoints — nested under /teams/:teamId/players. The backend
 * already returns camelCase (server/src/services/player.service.ts
 * mapRow) so no transformers are needed — the shape matches Player.
 */
export const playersApi = {
  async listTeamPlayers(teamId: string): Promise<Player[]> {
    return request<Player[]>(`/teams/${teamId}/players`);
  },

  async createPlayer(teamId: string, dto: CreatePlayerDto): Promise<Player> {
    return request<Player>(`/teams/${teamId}/players`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  async updatePlayer(teamId: string, playerId: string, dto: UpdatePlayerDto): Promise<Player> {
    return request<Player>(`/teams/${teamId}/players/${playerId}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  },

  async deletePlayer(teamId: string, playerId: string): Promise<void> {
    await request<void>(`/teams/${teamId}/players/${playerId}`, { method: 'DELETE' });
  },

  /**
   * Move a jugadora to another team of the SAME club. Mounted under
   * the source team's path so the same `requireTeamOwnership` guard
   * the admin/captain UI already passes covers the call. The server
   * 404s when the target team belongs to a different club, so the
   * UI's team dropdown should only ever offer same-club teams.
   */
  async transferPlayer(
    sourceTeamId: string,
    playerId: string,
    targetTeamId: string,
  ): Promise<Player> {
    return request<Player>(
      `/teams/${sourceTeamId}/players/${playerId}/transfer`,
      {
        method: 'PATCH',
        body: JSON.stringify({ targetTeamId }),
      },
    );
  },
};
