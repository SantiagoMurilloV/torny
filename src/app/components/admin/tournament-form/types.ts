import type { Tournament } from '../../../types';

export type TournamentStatus = Tournament['status'];
export type TournamentFormat = Tournament['format'];

export interface CourtEntry {
  name: string;
  location: string;
}

export interface FieldErrors {
  name?: string;
  club?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  teamsCount?: string;
  courts?: string;
  server?: string;
}

export type BracketMode = NonNullable<Tournament['bracketMode']>;

/** Per-day schedule override row used by the "Programación de partidos"
 *  section. The form keeps these as an array so the daily order in the
 *  UI is stable; the API layer transforms it to the
 *  `{ "YYYY-MM-DD": { start, end } }` map the backend stores. */
export interface DailyScheduleEntry {
  /** ISO 'YYYY-MM-DD'. Set by the form when the date range is computed. */
  date: string;
  /** "HH:MM" — empty string ("") means "use the global default". */
  start: string;
  end: string;
}

/** Shape of the form model held by useTournamentForm. */
export interface TournamentFormState {
  name: string;
  club: string;
  sport: string;
  description: string;
  startDate: string;
  endDate: string;
  status: TournamentStatus;
  teamsCount: number;
  format: TournamentFormat;
  courts: CourtEntry[];
  categories: string[];
  enrollmentDeadline: string;
  playersPerTeam: number;
  bracketMode: BracketMode;
  /** Divisions-only: top N of each group go to Oro. */
  goldClassifiersPerGroup: number;
  /** Divisions-only: next M of each group go to Plata (0 disables it). */
  silverClassifiersPerGroup: number;
  /** Reglamento del torneo (texto plano). Vacío = sin texto. */
  regulationText: string;
  /**
   * Data URL del PDF del reglamento ya subido (si existe). El campo
   * `regulationPdfFile` (en el hook, no en el state) representa un PDF
   * recién seleccionado que aún no se subió. Al hacer submit, si hay
   * archivo nuevo se sube y se reemplaza esta URL.
   */
  regulationPdfUrl: string;
  /**
   * Schedule defaults — persisted on the tournament so the admin sets
   * them once instead of re-typing for every fixture generation.
   *   · matchDurationMinutes — global per-match length (5..600).
   *   · matchBreakMinutes    — global between-matches gap (0..240).
   *   · dailySchedules       — per-date overrides of the active window.
   *                             One row per day in the range; empty
   *                             start/end means "use the global
   *                             08:00–18:00 default".
   */
  matchDurationMinutes: number;
  matchBreakMinutes: number;
  dailySchedules: DailyScheduleEntry[];
  /** Max matches per day (0 = unlimited). */
  maxMatchesPerDay: number;
  /** Dead-time blocks — no matches scheduled during these windows. */
  deadTimeBlocks: Array<{ start: string; end: string }>;
  /** Category play order — first in array plays earliest in the day. */
  categoryPriority: string[];
  /**
   * Preferred court for semifinals and finals (migration 026). The
   * <select> writes the literal court name; '' means "Sin preferencia"
   * which the API converts to NULL.
   */
  finalsCourt: string;
  /**
   * Per-category match duration overrides (migration 027). Keyed by
   * category name; the value is in MINUTES. Categories not present in
   * this map fall back to `matchDurationMinutes`. The form only writes
   * a key when the admin explicitly sets a value — leaving the input
   * blank keeps the global default for that category.
   */
  matchDurationsByCategory: Record<string, number>;
}

export const DEFAULT_COURTS: CourtEntry[] = [
  { name: 'Cancha Principal', location: '' },
  { name: 'Cancha 2', location: '' },
];

export function emptyForm(): TournamentFormState {
  return {
    name: '',
    club: '',
    sport: 'Voleibol',
    description: '',
    startDate: '',
    endDate: '',
    status: 'upcoming',
    teamsCount: 8,
    format: 'groups+knockout',
    courts: [...DEFAULT_COURTS],
    categories: [],
    enrollmentDeadline: '',
    playersPerTeam: 12,
    bracketMode: 'manual',
    goldClassifiersPerGroup: 2,
    silverClassifiersPerGroup: 2,
    regulationText: '',
    regulationPdfUrl: '',
    matchDurationMinutes: 60,
    matchBreakMinutes: 15,
    dailySchedules: [],
    maxMatchesPerDay: 0,
    deadTimeBlocks: [],
    categoryPriority: [],
    finalsCourt: '',
    matchDurationsByCategory: {},
  };
}
