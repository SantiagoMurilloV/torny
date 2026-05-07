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
}

export const DEFAULT_COURTS: CourtEntry[] = [
  { name: 'Cancha Principal', location: '' },
  { name: 'Cancha 2', location: '' },
];

export function emptyForm(): TournamentFormState {
  return {
    name: '',
    club: 'Club Deportivo Spike',
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
  };
}
