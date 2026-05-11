import type { FieldErrors, TournamentFormState } from './types';

const MIN_NAME = 3;
const MAX_NAME = 100;
const MIN_TEAMS = 2;
// Upper bound relaxed from 32 to 9999 (effectively unlimited for any
// real volleyball tournament). The cap is kept high purely as a typo
// safeguard. Mirrors the backend `tournament.service.validateData` and
// the DB CHECK constraint widened in migration 023.
const MAX_TEAMS = 9999;

/**
 * Pure synchronous validator for the tournament form. Returns a map
 * keyed by field name; the caller renders the message under each
 * input. An empty object means the form is valid.
 */
export function validate(form: TournamentFormState): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedName = form.name.trim();

  if (!trimmedName) {
    errors.name = 'El nombre es obligatorio';
  } else if (trimmedName.length < MIN_NAME) {
    errors.name = `El nombre debe tener al menos ${MIN_NAME} caracteres`;
  } else if (trimmedName.length > MAX_NAME) {
    errors.name = `El nombre no puede superar ${MAX_NAME} caracteres`;
  }

  if (!form.club.trim()) {
    errors.club = 'El club organizador es obligatorio';
  }

  if (!form.description.trim()) {
    errors.description = 'La descripción es obligatoria';
  }

  if (!form.startDate) errors.startDate = 'La fecha de inicio es obligatoria';
  if (!form.endDate) errors.endDate = 'La fecha de fin es obligatoria';
  if (form.startDate && form.endDate && form.startDate > form.endDate) {
    errors.endDate = 'La fecha de fin debe ser igual o posterior a la fecha de inicio';
  }

  if (form.teamsCount < MIN_TEAMS || form.teamsCount > MAX_TEAMS) {
    errors.teamsCount = `La cantidad de equipos debe estar entre ${MIN_TEAMS} y ${MAX_TEAMS}`;
  }

  const trimmedCourts = form.courts.map((c) => c.name.trim());
  if (trimmedCourts.length === 0) {
    errors.courts = 'Agregá al menos una cancha';
  } else if (trimmedCourts.some((n) => !n)) {
    errors.courts = 'Todas las canchas deben tener nombre';
  } else {
    const dup = trimmedCourts.find((n, i) => trimmedCourts.indexOf(n) !== i);
    if (dup) errors.courts = `Las canchas no pueden repetirse: "${dup}"`;
  }

  return errors;
}
