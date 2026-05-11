import type { MatchStatus } from '../../types';

/**
 * DTOs that match the backend's request/response contracts. Kept
 * together so every resource-module imports from the same place, and
 * anybody adding a field can see the sibling types side by side.
 */

export interface CreateTournamentDto {
  name: string;
  sport: string;
  club: string;
  startDate: string;
  endDate: string;
  description?: string;
  coverImage?: string;
  logo?: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  teamsCount: number;
  format: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  courts: string[];
  /** Mapa opcional { nombreCancha: ubicación }. */
  courtLocations?: Record<string, string>;
  /** Divisions accepted by the tournament; empty = no filter. */
  categories?: string[];
  /** ISO yyyy-mm-dd; captain credentials stop working after this day. */
  enrollmentDeadline?: string | null;
  /** Recommended roster cap (default 12). */
  playersPerTeam?: number;
  /** Bracket strategy — 'manual' = drag-pairs flow, 'divisions' = auto
   *  VNL Oro/Plata driven by the standings table. Defaults to 'manual'
   *  on the server. */
  bracketMode?: 'manual' | 'divisions';
  /** Reglamento del torneo en texto plano. null para borrar; undefined para no tocar. */
  regulationText?: string | null;
  /** Reglamento como PDF data URL. null para borrar; undefined para no tocar. */
  regulationPdf?: string | null;
  /**
   * Schedule defaults persisted on the tournament (migration 024). Used
   * by the original scheduler AND the repair tool so the admin sets
   * them once in Ajustes Generales instead of re-typing for every
   * fixture generation. The per-day map (`dailySchedules`) lets the
   * admin model "Sat 08:00–22:00, Sun 08:00–14:00" without splitting
   * the tournament. Days not in the map fall back to the global
   * 08:00–18:00 window inside the scheduler.
   */
  matchDurationMinutes?: number;
  matchBreakMinutes?: number;
  dailySchedules?: Record<string, { start: string; end: string }>;
  /**
   * Schedule constraints persisted by migration 025 — the FE form had
   * these for a while but they weren't reaching the API.
   *   · maxMatchesPerDay — 0 = no cap; >0 forces the scheduler to roll
   *                       into the next day once N matches are scheduled.
   *   · deadTimeBlocks   — array of `{ start, end }` (HH:MM) windows the
   *                       scheduler skips every day.
   *   · categoryPriority — ordered category names; categories listed
   *                       first take the earlier slots of each day.
   */
  maxMatchesPerDay?: number;
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  categoryPriority?: string[];
}

export type UpdateTournamentDto = Partial<CreateTournamentDto>;

export interface CreateTeamDto {
  name: string;
  initials: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  city?: string;
  department?: string;
  category?: string;
}

export type UpdateTeamDto = Partial<CreateTeamDto>;

export interface CreatePlayerDto {
  firstName: string;
  lastName: string;
  birthYear?: number;
  documentType?: string;
  documentNumber?: string;
  category?: string;
  position?: string;
  photo?: string;
  documentFile?: string;
  shirtNumber?: number;
}

export type UpdatePlayerDto = Partial<CreatePlayerDto>;

export interface CreateMatchDto {
  tournamentId: string;
  team1Id: string;
  team2Id: string;
  date: string;
  time: string;
  court: string;
  referee?: string;
  phase: string;
  groupName?: string;
}

export type UpdateMatchDto = Partial<CreateMatchDto> & {
  status?: MatchStatus;
  scoreTeam1?: number;
  scoreTeam2?: number;
  duration?: number;
};

export interface ScoreUpdate {
  status?: 'live' | 'completed';
  scoreTeam1?: number;
  scoreTeam2?: number;
  sets?: Array<{ setNumber: number; team1Points: number; team2Points: number }>;
  duration?: number;
}

export interface SystemSettings {
  id?: string;
  systemName: string;
  clubName?: string;
  location?: string;
  language: string;
  contactEmail?: string;
  website?: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    role: string;
    /** Team id when role is team_captain. */
    teamId?: string;
  };
}

export interface Judge {
  id: string;
  username: string;
  role: string;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Platform (super_admin) ────────────────────────────────────────

export interface PlatformStats {
  tournaments: number;
  teams: number;
  players: number;
  users: {
    super_admin: number;
    admin: number;
    judge: number;
    total: number;
  };
  presence: {
    activeUsers: number;
    activeVisitors: number;
  };
  /** True when PLATFORM_RECOVERY_KEY is configured on the backend. */
  passwordRecoveryEnabled: boolean;
}

export interface PlatformUser {
  id: string;
  username: string;
  role: string;
  displayName?: string;
  tournamentQuota: number;
  createdBy?: string | null;
  ownedTournamentsCount: number;
  /** Free-text note, only visible to super_admin. Memory aid only. */
  adminNote?: string | null;
  createdAt?: string;
}

export interface CreatePlatformUserDto {
  username: string;
  password: string;
  role: 'super_admin' | 'admin' | 'judge';
  displayName?: string;
  tournamentQuota?: number;
  createdBy?: string | null;
  adminNote?: string | null;
}

export interface UpdatePlatformUserDto {
  role?: 'super_admin' | 'admin' | 'judge';
  tournamentQuota?: number;
  displayName?: string;
  username?: string;
  password?: string;
  adminNote?: string | null;
}
