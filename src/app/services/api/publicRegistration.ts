import { request } from './client';
import type { Player } from '../../types';

/**
 * Public parent-registration endpoints (mig 029). Mounted under
 * `/api/public/*` on the backend and intentionally NOT authenticated —
 * `request()` will still send the auth header if a token happens to be
 * around, but the server ignores it. Both the GET (view the form) and
 * the POST (submit) are scoped per-tournament via the slug fragment.
 */

export interface PublicTeamSummary {
  id: string;
  name: string;
  initials: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  category?: string;
  city?: string;
  /** Current player count (server-computed) for the cap UI. */
  rosterCount: number;
  /** Already at or past `tournament.playersPerTeam` — disable the option. */
  isFull: boolean;
}

export interface PublicClubSummary {
  id: string;
  name: string;
  teams: PublicTeamSummary[];
}

export interface PublicTournamentSummary {
  id: string;
  slug: string;
  name: string;
  club: string;
  logo?: string;
  coverImage?: string;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  playersPerTeam: number;
}

export interface PublicTournamentView {
  tournament: PublicTournamentSummary;
  /** False once the cutoff has passed OR the opening gate hasn't been reached yet. */
  isOpen: boolean;
  /** True when registrationOpensAt is in the future — show "not open yet" screen. */
  notOpenYet: boolean;
  /** ISO timestamp (or date) when the link closes. */
  closedAt: string;
  /** ISO timestamp when the link opens — only present when notOpenYet is true. */
  opensAt?: string;
  clubs: PublicClubSummary[];
}

export interface PublicPlayerRegistrationDto {
  teamId: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  documentType?: string;
  documentNumber?: string;
  photo?: string;
  documentFile?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
}

export const publicRegistrationApi = {
  /** Load tournament + nested clubs/teams for the form. */
  async getTournamentBySlug(slug: string): Promise<PublicTournamentView> {
    return request<PublicTournamentView>(
      `/public/tournaments/${encodeURIComponent(slug)}`,
    );
  },

  /** Submit the form. Returns the saved jugadora on 201. */
  async register(
    slug: string,
    dto: PublicPlayerRegistrationDto,
  ): Promise<Player> {
    return request<Player>(`/public/tournaments/${encodeURIComponent(slug)}/players`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },
};
