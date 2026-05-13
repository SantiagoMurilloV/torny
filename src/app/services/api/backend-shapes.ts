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
  /** Club assignment (mig 028). Null when the team has no club. */
  clubId?: string | null;
  captainUsername?: string | null;
  credentialsGeneratedAt?: string | null;
}

export interface BackendTournament {
  id: string;
  name: string;
  /** Public URL slug (mig 029). */
  slug?: string;
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
  /** mig 031 — locality shown in the public Hero. Optional; the Hero
   *  falls back to `courts[0]` when null. */
  city?: string;
  /**
   * mig 032 — wall-clock when the admin clicked "Enviar programación
   * a clubes". NULL → not published yet; the club panel's cronograma
   * view stays gated behind an empty-state.
   */
  scheduleSentToClubsAt?: string | null;
  /** mig 034 — sponsors carousel speed (seconds per loop). NULL =
   *  use FE fallback. Range enforced server-side: 10..300. */
  sponsorsSpeedSeconds?: number | null;
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
  /** Per-category match duration overrides — migration 027. Keyed by
   *  category name; values in minutes. */
  matchDurationsByCategory?: Record<string, number>;
  /** Real counts decorated by the LIST_SELECT in tournament.service. */
  enrolledCount?: number;
  matchesCount?: number;
  /** Total players inscritos en todos los teams enrolled. Replace
   *  "En vivo" en el Hero público desde 2026-05-13 — el público
   *  prefiere ver el tamaño del torneo (cuántas jugadoras) en lugar
   *  del contador transiente de partidos en curso (0 casi siempre
   *  hasta que arranca el día). */
  playersCount?: number;
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
  // NULLABLE since mig 030: bracket slots that the materializer
  // pre-creates while the upstream round (grupos / cuartos / semis)
  // is still in flux. The admin's cronograma renders these
  // placeholders blurred and the `resolveTeam` helper returns a
  // neutral em-dash card when the id is null.
  team1Id: string | null;
  team2Id: string | null;
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
