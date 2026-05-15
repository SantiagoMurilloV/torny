import { request } from './client';
import type { Judge } from './dtos';

/**
 * Judges CRUD. Lives under /users/judges because judges are just
 * `users` rows with role='judge' on the server; we keep the frontend
 * surface narrow by not exposing the generic users endpoint.
 */
export const judgesApi = {
  async listJudges(): Promise<Judge[]> {
    return request<Judge[]>('/users/judges');
  },

  async createJudge(data: {
    username: string;
    password: string;
    displayName?: string;
    assignedTournamentId?: string | null;
    assignedCourt?: string | null;
  }): Promise<Judge> {
    return request<Judge>('/users/judges', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteJudge(id: string): Promise<void> {
    await request<void>(`/users/judges/${id}`, { method: 'DELETE' });
  },

  /** Returns the updated judge including the new decrypted password. */
  async resetJudgePassword(id: string, password: string): Promise<Judge> {
    return request<Judge>(`/users/judges/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async updateJudge(
    id: string,
    data: { assignedTournamentId?: string | null; assignedCourt?: string | null },
  ): Promise<Judge> {
    return request<Judge>(`/users/judges/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};
