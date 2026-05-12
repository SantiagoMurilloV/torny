import { request, API_BASE, getAuthToken } from './client';

/**
 * Club credentials API (mig 028). One row per (admin, club). Admin
 * runs `/api/clubs/detect` to see proposed clusters (grouped by the
 * normalized first word of each team's name), then `/api/clubs/bulk`
 * to create them with auto-generated user/password. The club captain
 * uses `/api/clubs/me/teams` after login to load their team picker.
 *
 * Excel export is a binary download — uses fetch() directly because
 * the shared `request()` helper assumes JSON.
 */

export interface DetectedCluster {
  key: string;
  proposedName: string;
  teamIds: string[];
  sampleTeamNames: string[];
}

export interface Club {
  id: string;
  ownerId: string;
  name: string;
  username: string;
  passwordRecovery: string | null;
  credentialsGeneratedAt: string;
  createdAt: string;
  updatedAt: string;
  teamsCount?: number;
}

export const clubsApi = {
  async detect(): Promise<DetectedCluster[]> {
    return request<DetectedCluster[]>('/clubs/detect', { method: 'POST' });
  },

  async bulkCreate(
    clusters: Array<{ key: string; name: string }>,
  ): Promise<Club[]> {
    return request<Club[]>('/clubs/bulk', {
      method: 'POST',
      body: JSON.stringify({ clusters }),
    });
  },

  async list(): Promise<Club[]> {
    return request<Club[]>('/clubs');
  },

  async getById(id: string): Promise<Club> {
    return request<Club>(`/clubs/${id}`);
  },

  async rename(id: string, name: string): Promise<Club> {
    return request<Club>(`/clubs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async regenerateCredentials(id: string): Promise<Club> {
    return request<Club>(`/clubs/${id}/credentials`, { method: 'POST' });
  },

  async deleteClub(id: string): Promise<void> {
    return request<void>(`/clubs/${id}`, { method: 'DELETE' });
  },

  /**
   * List teams currently linked to a club. Drives the "Dividir club"
   * modal so the admin picks which teams move to the new club.
   */
  async getClubTeams(id: string): Promise<Array<{
    id: string;
    name: string;
    initials: string;
    category: string | null;
    logo: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
  }>> {
    return request(`/clubs/${id}/teams`);
  },

  /**
   * Split: move the selected teams to a NEW club. Returns the new
   * club so the FE can show the credentials immediately. The original
   * club survives with its remaining teams + credentials intact.
   */
  async splitClub(
    sourceClubId: string,
    name: string,
    teamIds: string[],
  ): Promise<Club> {
    return request<Club>(`/clubs/${sourceClubId}/split`, {
      method: 'POST',
      body: JSON.stringify({ name, teamIds }),
    });
  },

  /**
   * Returns `{ clubId, teamIds }` for the authenticated club_captain.
   * The club panel then fetches each team via the existing /teams/:id
   * endpoint (no new team-side endpoint needed).
   */
  async meTeams(): Promise<{ clubId: string; teamIds: string[] }> {
    return request<{ clubId: string; teamIds: string[] }>('/clubs/me/teams');
  },

  /**
   * Triggers the XLSX download. Bypasses `request()` because we need
   * the raw blob, not parsed JSON. Includes the auth header manually
   * since fetch() doesn't read it from anywhere.
   */
  async downloadExcel(): Promise<void> {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/clubs/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Error ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clubs-y-equipos.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
