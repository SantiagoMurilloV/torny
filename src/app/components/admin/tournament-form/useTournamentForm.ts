import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Tournament } from '../../../types';
import { api, ApiError } from '../../../services/api';
import { CATEGORIES, withCurrentCategories } from '../../../lib/categories';
import { validate } from './validate';
import {
  emptyForm,
  DEFAULT_COURTS,
  type CourtEntry,
  type FieldErrors,
  type TournamentFormState,
} from './types';
import { getErrorMessage } from '../../../lib/errors';

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_REGULATION_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Convert an ISO timestamp (with timezone, e.g. "2026-05-20T14:00:00.000Z")
 * to the "YYYY-MM-DDTHH:MM" shape that <input type="datetime-local"> expects.
 * The conversion uses the browser's local timezone so the admin sees the time
 * in their own clock — on save, the form converts back to a UTC ISO string.
 * Returns '' when the input is empty or invalid.
 */
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Encapsulates every piece of state the tournament form needs:
 *   · formData + errors + submitting flag
 *   · cover image (file, preview, upload spinner)
 *   · category toggle keyed on the canonical CATEGORIES list
 *
 * Returning a handful of setters + a bound handleSubmit keeps the
 * modal's JSX lean (it only renders fields, never orchestrates state).
 */
export function useTournamentForm({
  tournament,
  isOpen,
  inline,
  onSubmit,
  onClose,
}: {
  tournament: Tournament | undefined;
  isOpen: boolean;
  inline: boolean;
  onSubmit: (t: Tournament) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<TournamentFormState>(() => emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // PDF del reglamento — mismo patrón que cover: el archivo nuevo
  // espera en memoria hasta el submit, donde lo subimos vía
  // /upload/document y reemplazamos la data URL persistida.
  const [regulationPdfFile, setRegulationPdfFile] = useState<File | null>(null);
  const [regulationPdfFileName, setRegulationPdfFileName] = useState<string>('');
  const [uploadingRegulationPdf, setUploadingRegulationPdf] = useState(false);
  const regulationPdfInputRef = useRef<HTMLInputElement>(null);

  const categoryOptions = withCurrentCategories(CATEGORIES, formData.categories);

  // Hydrate when a tournament prop appears (edit flow).
  useEffect(() => {
    if (!tournament) return;
    const courts: CourtEntry[] =
      tournament.courts.length > 0
        ? tournament.courts.map((name) => ({
            name,
            location: tournament.courtLocations?.[name] ?? '',
          }))
        : [...DEFAULT_COURTS];
    // Hydrate the daily-schedule rows from the tournament. We
    // materialise an entry for EVERY date in the [start, end] range so
    // the form renders one row per day; entries for dates not present
    // in `tournament.dailySchedules` show empty start/end (= "use the
    // global default"). This keeps the per-day grid stable as the
    // admin edits — no rows shifting around when they save.
    const hydrateDailySchedules = (): TournamentFormState['dailySchedules'] => {
      const start = tournament.startDate.toISOString().split('T')[0];
      const end = tournament.endDate.toISOString().split('T')[0];
      const map = tournament.dailySchedules ?? {};
      const rows: TournamentFormState['dailySchedules'] = [];
      const cursor = new Date(start + 'T00:00:00');
      const endCursor = new Date(end + 'T00:00:00');
      let safety = 0;
      while (cursor.getTime() <= endCursor.getTime() && safety < 366) {
        const dateStr = cursor.toISOString().split('T')[0];
        const override = map[dateStr];
        rows.push({
          date: dateStr,
          start: override?.start ?? '',
          end: override?.end ?? '',
        });
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }
      return rows;
    };
    setFormData({
      name: tournament.name,
      club: tournament.club,
      sport: tournament.sport,
      description: tournament.description,
      startDate: tournament.startDate.toISOString().split('T')[0],
      endDate: tournament.endDate.toISOString().split('T')[0],
      status: tournament.status,
      teamsCount: tournament.teamsCount,
      format: tournament.format,
      courts,
      categories: tournament.categories ? [...tournament.categories] : [],
      enrollmentDeadline: tournament.enrollmentDeadline ?? '',
      registrationOpensAt: isoToDatetimeLocal(tournament.registrationOpensAt),
      registrationClosesAt: isoToDatetimeLocal(tournament.registrationClosesAt),
      playersPerTeam: tournament.playersPerTeam ?? 12,
      bracketMode: tournament.bracketMode ?? 'manual',
      goldClassifiersPerGroup: tournament.goldClassifiersPerGroup ?? 2,
      silverClassifiersPerGroup: tournament.silverClassifiersPerGroup ?? 2,
      regulationText: tournament.regulationText ?? '',
      regulationPdfUrl: tournament.regulationPdf ?? '',
      matchBreakMinutes: tournament.matchBreakMinutes ?? 15,
      dailySchedules: hydrateDailySchedules(),
      maxMatchesPerDay: tournament.maxMatchesPerDay ?? 0,
      deadTimeBlocks: tournament.deadTimeBlocks ?? [],
      categoryPriority: tournament.categoryPriority ?? [],
      // Migration 026 — empty string represents "Sin preferencia". Be
      // tolerant of legacy rows that don't have the field at all.
      finalsCourt: tournament.finalsCourt ?? '',
      // Migration 027 — empty object means "no overrides; use the
      // global matchDurationMinutes for every category".
      matchDurationsByCategory: tournament.matchDurationsByCategory ?? {},
      city: tournament.city ?? '',
      secondaryPhase: tournament.secondaryPhase ?? null,
    });
    setCoverFile(null);
    setCoverPreview(tournament.coverImage ?? null);
    setRegulationPdfFile(null);
    setRegulationPdfFileName('');
  }, [tournament]);

  // Reset errors + cover + reglamento when opening for "create" flow.
  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSubmitting(false);
    if (!tournament) {
      setCoverFile(null);
      setCoverPreview(null);
      setRegulationPdfFile(null);
      setRegulationPdfFileName('');
    }
  }, [isOpen, tournament]);

  // Keep the per-day schedule grid in sync with the tournament's date
  // range. When the admin changes startDate / endDate the array of rows
  // gets re-derived: existing entries (date keyed) are preserved so any
  // hand-typed overrides survive, new days get blank rows (= use global
  // default), and days outside the new range drop off. Without this the
  // form would either show stale rows or skip days entirely after a
  // date edit.
  useEffect(() => {
    setFormData((prev) => {
      if (!prev.startDate || !prev.endDate) return prev;
      const cursor = new Date(prev.startDate + 'T00:00:00');
      const endCursor = new Date(prev.endDate + 'T00:00:00');
      if (Number.isNaN(cursor.getTime()) || Number.isNaN(endCursor.getTime())) {
        return prev;
      }
      const previousByDate = new Map(prev.dailySchedules.map((d) => [d.date, d]));
      const next: TournamentFormState['dailySchedules'] = [];
      let safety = 0;
      while (cursor.getTime() <= endCursor.getTime() && safety < 366) {
        const dateStr = cursor.toISOString().slice(0, 10);
        next.push(
          previousByDate.get(dateStr) ?? { date: dateStr, start: '', end: '' },
        );
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }
      // Skip the state update if nothing actually changed (same length,
      // same dates) to avoid infinite re-render loops.
      if (
        next.length === prev.dailySchedules.length &&
        next.every((row, idx) => row.date === prev.dailySchedules[idx]?.date)
      ) {
        return prev;
      }
      return { ...prev, dailySchedules: next };
    });
  }, [formData.startDate, formData.endDate]);

  const patch = useCallback(
    (next: Partial<TournamentFormState>, clearFields?: (keyof FieldErrors)[]) => {
      setFormData((prev) => ({ ...prev, ...next }));
      if (clearFields && clearFields.length > 0) {
        setErrors((prev) => {
          const copy = { ...prev };
          for (const f of clearFields) copy[f] = undefined;
          copy.server = undefined;
          return copy;
        });
      }
    },
    [],
  );

  const toggleCategory = useCallback((value: string) => {
    setFormData((prev) => {
      const selected = prev.categories.includes(value);
      const selectedValues = selected
        ? prev.categories.filter((c) => c !== value)
        : [...prev.categories, value];
      const selectedSet = new Set(selectedValues);
      const next = withCurrentCategories(CATEGORIES, selectedValues).filter((c) =>
        selectedSet.has(c),
      );
      return { ...prev, categories: next };
    });
  }, []);

  const handleCoverSelect = useCallback((file: File | null) => {
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) {
      toast.error('La imagen no puede superar 10MB');
      return;
    }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }, []);

  const clearCover = useCallback(() => {
    setCoverFile(null);
    setCoverPreview(null);
    if (coverInputRef.current) coverInputRef.current.value = '';
  }, []);

  const handleRegulationPdfSelect = useCallback((file: File | null) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('El reglamento debe ser un PDF');
      return;
    }
    if (file.size > MAX_REGULATION_PDF_BYTES) {
      toast.error('El PDF no puede superar 10MB');
      return;
    }
    setRegulationPdfFile(file);
    setRegulationPdfFileName(file.name);
  }, []);

  const clearRegulationPdf = useCallback(() => {
    setRegulationPdfFile(null);
    setRegulationPdfFileName('');
    setFormData((prev) => ({ ...prev, regulationPdfUrl: '' }));
    if (regulationPdfInputRef.current) regulationPdfInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const fieldErrors = validate(formData);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        return;
      }
      setErrors({});
      setSubmitting(true);

      // Build clean courts array + locations map
      const courtNames: string[] = [];
      const courtLocations: Record<string, string> = {};
      for (const c of formData.courts) {
        const name = c.name.trim();
        if (!name) continue;
        courtNames.push(name);
        const loc = c.location.trim();
        if (loc) courtLocations[name] = loc;
      }

      // Upload a fresh cover before we hand the tournament to the parent.
      let coverImageUrl = tournament?.coverImage;
      if (coverFile) {
        try {
          setUploadingCover(true);
          coverImageUrl = await api.uploadLogo(coverFile);
        } catch {
          toast.error('Error al subir la imagen de portada');
          setSubmitting(false);
          setUploadingCover(false);
          return;
        } finally {
          setUploadingCover(false);
        }
      } else if (coverPreview === null) {
        coverImageUrl = undefined;
      }

      // Upload del PDF de reglamento (si hay archivo nuevo). Si no hay
      // archivo nuevo, conservamos el regulationPdfUrl del estado, que
      // puede haber sido vaciado por clearRegulationPdf.
      let regulationPdfUrl: string | undefined = formData.regulationPdfUrl || undefined;
      if (regulationPdfFile) {
        try {
          setUploadingRegulationPdf(true);
          regulationPdfUrl = await api.uploadDocument(regulationPdfFile);
        } catch {
          toast.error('Error al subir el PDF del reglamento');
          setSubmitting(false);
          setUploadingRegulationPdf(false);
          return;
        } finally {
          setUploadingRegulationPdf(false);
        }
      }

      // Collapse the per-day rows back to the API map shape. Only rows
      // with BOTH start AND end set become overrides — empty strings
      // mean "fall back to the global window" so we deliberately drop
      // them. The backend `daily_schedules` JSONB carries only the
      // explicit overrides; missing dates use the default.
      const dailySchedulesMap: Record<string, { start: string; end: string }> = {};
      for (const row of formData.dailySchedules) {
        const start = row.start.trim();
        const end = row.end.trim();
        if (start && end) {
          dailySchedulesMap[row.date] = { start, end };
        }
      }

      const newTournament: Tournament = {
        id: tournament?.id || `tournament-${Date.now()}`,
        name: formData.name,
        club: formData.club,
        sport: formData.sport,
        description: formData.description,
        startDate: new Date(formData.startDate),
        endDate: new Date(formData.endDate),
        status: formData.status,
        teamsCount: formData.teamsCount,
        format: formData.format,
        courts: courtNames,
        courtLocations,
        coverImage: coverImageUrl,
        categories: formData.categories,
        enrollmentDeadline: formData.enrollmentDeadline || undefined,
        registrationOpensAt: formData.registrationOpensAt
          ? new Date(formData.registrationOpensAt).toISOString()
          : null,
        registrationClosesAt: formData.registrationClosesAt
          ? new Date(formData.registrationClosesAt).toISOString()
          : null,
        playersPerTeam: formData.playersPerTeam,
        bracketMode: formData.bracketMode,
        // Only forward classifier counts when divisions mode is on,
        // so a manual-mode tournament doesn't carry phantom values
        // through the API payload.
        goldClassifiersPerGroup:
          formData.bracketMode === 'divisions'
            ? formData.goldClassifiersPerGroup
            : undefined,
        silverClassifiersPerGroup:
          formData.bracketMode === 'divisions'
            ? formData.silverClassifiersPerGroup
            : undefined,
        city: formData.city.trim() || undefined,
        regulationText: formData.regulationText.trim() || undefined,
        regulationPdf: regulationPdfUrl,
        matchBreakMinutes: formData.matchBreakMinutes,
        dailySchedules: dailySchedulesMap,
        maxMatchesPerDay: formData.maxMatchesPerDay,
        // Always send the array (even when empty) so removing every
        // dead-time block actually clears the column. `undefined`
        // would mean "leave it untouched" → old blocks persist.
        deadTimeBlocks: formData.deadTimeBlocks,
        // Always send the array (even when empty) so clicking "Quitar
        // orden personalizado" actually wipes the column. Sending
        // undefined would mean "leave it untouched" — the previous
        // ordering would persist after save.
        categoryPriority: formData.categoryPriority,
        // Migration 026 — empty string in the form means "Sin
        // preferencia". Send undefined so the API doesn't overwrite
        // the column with an empty string (the BE collapses '' to NULL
        // anyway but undefined is the cleaner contract).
        finalsCourt: formData.finalsCourt.trim() || undefined,
        // Migration 027 — always send the map (filtering only stale
        // category keys whose category was deleted). Sending `{}`
        // explicitly clears every override, matching the same "empty
        // = clear" semantics as deadTimeBlocks + categoryPriority
        // above. Out-of-range numeric values get dropped before send.
        matchDurationsByCategory: Object.fromEntries(
          Object.entries(formData.matchDurationsByCategory).filter(
            ([cat, val]) =>
              formData.categories.includes(cat) &&
              typeof val === 'number' &&
              Number.isFinite(val) &&
              val >= 5 &&
              val <= 600,
          ),
        ),
        // mig 038 — secondary phase config. Only include when divisions
        // mode is active (otherwise irrelevant and confusing to the API).
        secondaryPhase:
          formData.bracketMode === 'divisions' && formData.secondaryPhase?.enabled
            ? formData.secondaryPhase
            : null,
      };

      try {
        await onSubmit(newTournament);
        if (!inline) onClose();
        if (!tournament) setFormData(emptyForm());
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          setErrors({ server: err.message });
        } else {
          toast.error(getErrorMessage(err, 'Error de red al guardar torneo'), {
            action: { label: 'Reintentar', onClick: () => handleSubmit(e) },
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [formData, tournament, coverFile, coverPreview, regulationPdfFile, inline, onSubmit, onClose],
  );

  // Patch a single per-day schedule row by index. Used by the
  // ScheduleField rows so the form can edit "Saturday's hours" without
  // touching Sunday's. Empty strings collapse to "no override" at
  // submit time (see dailySchedulesMap collection above).
  const setDailyScheduleRow = useCallback(
    (
      index: number,
      patch: Partial<TournamentFormState['dailySchedules'][number]>,
    ) => {
      setFormData((prev) => {
        if (index < 0 || index >= prev.dailySchedules.length) return prev;
        const next = prev.dailySchedules.slice();
        next[index] = { ...next[index], ...patch };
        return { ...prev, dailySchedules: next };
      });
    },
    [],
  );

  return {
    formData,
    errors,
    submitting,
    uploadingCover,
    coverPreview,
    coverInputRef,
    categoryOptions,
    // Reglamento
    uploadingRegulationPdf,
    regulationPdfFileName,
    regulationPdfHasFile: !!regulationPdfFile || !!formData.regulationPdfUrl,
    regulationPdfInputRef,
    handleRegulationPdfSelect,
    clearRegulationPdf,
    patch,
    setErrors,
    toggleCategory,
    handleCoverSelect,
    clearCover,
    handleSubmit,
    setDailyScheduleRow,
  };
}
