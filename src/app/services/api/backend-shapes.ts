import type { MatchStatus } from '../../types';

/**
 * Raw JSON shapes the backend returns. Kept internal to the api/
 * package — the rest of the app sees the camelCased frontend types
 * after transformers.ts runs.
 */

export interface BackendTeam {
  id: string;
  name: string;
  initials: string;
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  city?: string;
  department?: string;
  category?: string;
  captainUsername?: string | null;
  credentialsGeneratedAt?: string | null;
}

export interface BackendTournament {
  id: string;
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
  courtLocations?: Record<string, string>;
  categories?: string[];
  ownerId?: string;
  enrollmentDeadline?: string;
  playersPerTeam?: number;
  /** 'manual' | 'divisions'. See Tournament.bracketMode. */
  bracketMode?: 'manual' | 'divisions';
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  /** Texto del reglamento (opcional). */
  regulationText?: string;
  /** PDF del reglamento como data URL (opcional). */
  regulationPdf?: string;
  /** Schedule defaults — migration 024. See Tournament (frontend type)
   *  for the full doc. */
  matchDurationMinutes?: number;
  matchBreakMinutes?: number;
  dailySchedules?: Record<string, { start: string; end: string }>;
  /** Schedule constraints — migration 025. */
  maxMatchesPerDay?: number;
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  categoryPriority?: string[];
  /** Preferred court for semis + finals — migration 026. */
  finalsCourt?: string;
  /** Real counts decorated by the LIST_SELECT in tournament.service. */
  enrolledCount?: number;
  matchesCount?: number;
}

export interface BackendEnrolledTeam {
  id: string;
  tournamentId: string;
  teamId: string;
  team: BackendTeam;
}

export interface BackendSetScore {
  id: string;
  matchId: string;
  setNumber: number;
  team1Points: number;
  team2Points: number;
}

export interface BackendMatch {
  id: string;
  tournamentId: string;
  team1Id: string;
  team2Id: string;
  date: string;
  time: string;
  court: string;
  referee?: string;
  status: MatchStatus;
  scoreTeam1?: number;
  scoreTeam2?: number;
  phase: string;
  groupName?: string;
  duration?: number;
  sets?: BackendSetScore[];
}

export interface BackendStandingsRow {
  id: string;
  tournamentId: string;
  teamId: string;
  groupName?: string;
  position: number;
  played: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  points: number;
  isQualified: boolean;
  team?: BackendTeam;
}

export interface BackendBracketMatch {
  id: string;
  tournamentId: string;
  team1Id?: string;
  team2Id?: string;
  winnerId?: string;
  scoreTeam1?: number;
  scoreTeam2?: number;
  status: MatchStatus;
  round: string;
  position: number;
  team1?: BackendTeam;
  team2?: BackendTeam;
  team1Placeholder?: string;
  team2Placeholder?: string;
}
