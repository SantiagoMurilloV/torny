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
  /**
   * datetime-local value ("YYYY-MM-DDTHH:MM") for when the public
   * registration link opens. Empty = open immediately (legacy).
   */
  registrationOpensAt: string;
  /**
   * datetime-local value ("YYYY-MM-DDTHH:MM") for when the public
   * registration link closes. Empty = close at midnight of startDate (legacy).
   */
  registrationClosesAt: string;
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
   *   · matchBreakMinutes    — global between-matches gap (0..240).
   *   · dailySchedules       — per-date overrides of the active window.
   *                             One row per day in the range; empty
   *                             start/end means "use the global
   *                             08:00–18:00 default".
   *
   * Per-MATCH duration moved to `matchDurationsByCategory` (mig 027).
   * The DB column `match_duration_minutes` stays for backwards-compat
   * but the form no longer writes it — every category gets its own
   * value (or falls back to a 60-min hardcoded default).
   */
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
  /** City / locality shown in the public tournament Hero (migration 031). */
  city: string;
  /**
   * Secondary phase (triangulares) config (migration 038). null when
   * disabled. Only relevant when format === 'groups+knockout' AND
   * bracketMode === 'divisions'.
   */
  secondaryPhase: {
    enabled: boolean;
    groupsPerDivision: number;
    teamsPerGroup: number;
    classifiersPerGroup: number;
  } | null;
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
    registrationOpensAt: '',
    registrationClosesAt: '',
    playersPerTeam: 12,
    bracketMode: 'manual',
    goldClassifiersPerGroup: 2,
    silverClassifiersPerGroup: 2,
    regulationText: '',
    regulationPdfUrl: '',
    matchBreakMinutes: 15,
    dailySchedules: [],
    maxMatchesPerDay: 0,
    deadTimeBlocks: [],
    categoryPriority: [],
    finalsCourt: '',
    matchDurationsByCategory: {},
    city: '',
    secondaryPhase: null,
  };
}
