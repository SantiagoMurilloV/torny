import { X, Loader2 } from 'lucide-react';
import type { Tournament } from '../../types';
import { motion } from 'motion/react';
import { useTournamentForm } from './tournament-form/useTournamentForm';
import { CategoriesField } from './tournament-form/fields/CategoriesField';
import { CoverImageField } from './tournament-form/fields/CoverImageField';
import { CourtsField } from './tournament-form/fields/CourtsField';
import { RegulationField } from './tournament-form/fields/RegulationField';
import { ScheduleField } from './tournament-form/fields/ScheduleField';
import type { FieldErrors } from './tournament-form/types';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface TournamentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (tournament: Tournament) => Promise<void>;
  tournament?: Tournament;
  /**
   * 'modal' (default) wraps everything in a backdrop + centered card
   * with a sticky header and a Cancel button. 'inline' renders the
   * same form inline on the host page — used by Ajustes Generales so
   * the tab becomes a direct edit surface.
   */
  variant?: 'modal' | 'inline';
}

/**
 * Tournament create/edit form. The modal shell is thin — the heavy
 * lifting (state, validation, cover upload, submit) lives in
 * `useTournamentForm`, and three non-trivial fields (categories,
 * cover, courts) are separate components.
 */
export function TournamentFormModal({
  isOpen,
  onClose,
  onSubmit,
  tournament,
  variant = 'modal',
}: TournamentFormModalProps) {
  const inline = variant === 'inline';
  const form = useTournamentForm({ tournament, isOpen, inline, onSubmit, onClose });

  if (!inline && !isOpen) return null;

  const body = (
    <form
      onSubmit={form.handleSubmit}
      className={inline ? 'space-y-4 sm:space-y-6' : 'p-4 sm:p-6 space-y-4 sm:space-y-6'}
      noValidate
    >
      {form.errors.server && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
          {form.errors.server}
        </div>
      )}

      <TextField
        label="Nombre del Torneo *"
        value={form.formData.name}
        onChange={(v) => form.patch({ name: v }, ['name'])}
        placeholder="Ej: Copa SPK 2026"
        error={form.errors.name}
      />

      <TextField
        label="Club Organizador *"
        value={form.formData.club}
        onChange={(v) => form.patch({ club: v }, ['club'])}
        error={form.errors.club}
      />

      <TextField
        label="Descripción *"
        value={form.formData.description}
        onChange={(v) => form.patch({ description: v }, ['description'])}
        placeholder="Describe el torneo..."
        error={form.errors.description}
        multiline
      />

      <CategoriesField
        options={form.categoryOptions}
        selected={form.formData.categories}
        onToggle={form.toggleCategory}
      />

      <CoverImageField
        preview={form.coverPreview}
        inputRef={form.coverInputRef}
        onSelect={form.handleCoverSelect}
        onClear={form.clearCover}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField
          label="Fecha Inicio *"
          type="date"
          value={form.formData.startDate}
          onChange={(v) => form.patch({ startDate: v }, ['startDate', 'endDate'])}
          error={form.errors.startDate}
        />
        <TextField
          label="Fecha Fin *"
          type="date"
          value={form.formData.endDate}
          onChange={(v) => form.patch({ endDate: v }, ['endDate'])}
          error={form.errors.endDate}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField
          label="Estado *"
          value={form.formData.status}
          onChange={(v) =>
            form.patch({ status: v as 'upcoming' | 'ongoing' | 'completed' })
          }
          options={[
            { value: 'upcoming', label: 'Próximo' },
            { value: 'ongoing', label: 'En Curso' },
            { value: 'completed', label: 'Finalizado' },
          ]}
        />
        <TextField
          label="Cantidad de Equipos *"
          type="number"
          min={2}
          // Upper bound mirrors `MAX_TEAMS` in tournament-form/validate.ts
          // and the backend service ruleset. Bumped from 32 → 9999 to
          // unblock federations with 60+, 100+ teams; the cap exists
          // only to bounce typo errors like "200000".
          max={9999}
          value={String(form.formData.teamsCount)}
          onChange={(v) => form.patch({ teamsCount: parseInt(v, 10) || 0 }, ['teamsCount'])}
          error={form.errors.teamsCount}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FormLabel>Fecha límite de inscripción</FormLabel>
          <input
            type="date"
            value={form.formData.enrollmentDeadline}
            onChange={(e) => form.patch({ enrollmentDeadline: e.target.value })}
            className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="mt-1 text-xs text-black/50">
            Opcional. Después de esta fecha los capitanes no pueden editar su plantel.
          </p>
        </div>
        <div>
          <FormLabel>Jugador@s por equipo</FormLabel>
          <input
            type="number"
            min={1}
            max={30}
            value={form.formData.playersPerTeam}
            onChange={(e) =>
              form.patch({
                playersPerTeam: Math.max(1, parseInt(e.target.value, 10) || 0),
              })
            }
            className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="mt-1 text-xs text-black/50">Cupo recomendado del plantel. Default: 12.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FormLabel>Apertura del link de inscripción</FormLabel>
          <input
            type="datetime-local"
            value={form.formData.registrationOpensAt}
            onChange={(e) => form.patch({ registrationOpensAt: e.target.value })}
            className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="mt-1 text-xs text-black/50">
            Opcional. Si se define, el link no funciona antes de esta fecha y hora.
          </p>
        </div>
        <div>
          <FormLabel>Cierre del link de inscripción</FormLabel>
          <input
            type="datetime-local"
            value={form.formData.registrationClosesAt}
            onChange={(e) => form.patch({ registrationClosesAt: e.target.value })}
            className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="mt-1 text-xs text-black/50">
            Opcional. Si no se define, el link cierra la medianoche anterior al inicio del torneo.
          </p>
        </div>
      </div>

      <div>
        <SelectField
          label="Sistema de juego *"
          value={form.formData.format}
          onChange={(v) =>
            form.patch({
              format: v as 'groups' | 'knockout' | 'groups+knockout' | 'league',
            })
          }
          options={[
            { value: 'groups', label: 'Solo Grupos' },
            { value: 'knockout', label: 'Solo Eliminatoria' },
            { value: 'groups+knockout', label: 'Grupos + Eliminatoria' },
            { value: 'league', label: 'Liga' },
          ]}
        />
        <p className="mt-1 text-xs text-black/50">
          Define cómo se generan los partidos (grupos, llaves, liga). El reglamento que comuniquen los espectadores se configura más abajo.
        </p>
      </div>

      {(form.formData.format === 'groups+knockout' || form.formData.format === 'knockout') && (
        <div className="space-y-4">
          <SelectField
            label="Tipo de cruces de eliminatoria *"
            value={form.formData.bracketMode}
            onChange={(v) =>
              form.patch({ bracketMode: v as 'manual' | 'divisions' })
            }
            options={[
              { value: 'manual', label: 'Clasificación normal (manual)' },
              { value: 'divisions', label: 'Por divisiones (Oro + Plata, automático)' },
            ]}
          />
          <p className="text-xs text-black/50">
            {form.formData.bracketMode === 'divisions'
              ? 'Los cruces se arman automáticamente siguiendo el seeding VNL desde la tabla de clasificación cumulativa cross-grupo.'
              : 'El administrador elige los cruces a mano desde el panel.'}
          </p>

          {form.formData.bracketMode === 'divisions' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-black/[0.03] rounded-sm border border-black/10">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-black/70 mb-2" style={FONT}>
                  Clasificados a Oro por grupo
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={form.formData.goldClassifiersPerGroup}
                  onChange={(e) =>
                    form.patch({ goldClassifiersPerGroup: parseInt(e.target.value, 10) || 1 })
                  }
                  className="w-full px-3 py-2 bg-white border border-black/15 rounded-sm focus:outline-none focus:border-spk-red"
                />
                <p className="mt-1 text-[11px] text-black/45">
                  Top {form.formData.goldClassifiersPerGroup} de cada grupo entran al cruce Oro.
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-black/70 mb-2" style={FONT}>
                  Clasificados a Plata por grupo
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={form.formData.silverClassifiersPerGroup}
                  onChange={(e) =>
                    form.patch({ silverClassifiersPerGroup: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full px-3 py-2 bg-white border border-black/15 rounded-sm focus:outline-none focus:border-spk-red"
                />
                <p className="mt-1 text-[11px] text-black/45">
                  {form.formData.silverClassifiersPerGroup === 0
                    ? 'Plata desactivada — solo se genera Oro.'
                    : `Posiciones ${form.formData.goldClassifiersPerGroup + 1} a ${form.formData.goldClassifiersPerGroup + form.formData.silverClassifiersPerGroup} de cada grupo entran al cruce Plata.`}
                </p>
              </div>
              <div className="sm:col-span-2 text-[11px] text-black/55">
                Tip: para un cruce sin "byes", elegí valores que multipliquen tu número de grupos a una potencia de dos
                (ej. 4 grupos × 2 = 8 → cruce de 8 limpio).
              </div>
            </div>
          )}
        </div>
      )}

      <CourtsField
        courts={form.formData.courts}
        error={form.errors.courts}
        onChange={(next) => form.patch({ courts: next }, ['courts'])}
      />

      {/* Programación de partidos — se persiste en el torneo y la usan
          tanto el generador inicial como el reparador automático. */}
      <ScheduleField
        matchBreakMinutes={form.formData.matchBreakMinutes}
        maxMatchesPerDay={form.formData.maxMatchesPerDay}
        deadTimeBlocks={form.formData.deadTimeBlocks}
        dailySchedules={form.formData.dailySchedules}
        categoryPriority={form.formData.categoryPriority}
        availableCategories={form.formData.categories}
        // Migration 026 — preferred court for semis + finals. Sourced
        // from the form's own courts list so the dropdown stays in
        // sync as the admin renames or adds courts.
        finalsCourt={form.formData.finalsCourt}
        availableCourts={form.formData.courts.map((c) => c.name).filter((n) => n.trim() !== '')}
        onMatchBreakChange={(n) => form.patch({ matchBreakMinutes: n })}
        onMaxMatchesPerDayChange={(n) => form.patch({ maxMatchesPerDay: n })}
        onDeadTimeBlocksChange={(blocks) => form.patch({ deadTimeBlocks: blocks })}
        onDailyScheduleChange={(idx, patch) => {
          const next = form.formData.dailySchedules.map((row, i) =>
            i === idx ? { ...row, ...patch } : row,
          );
          form.patch({ dailySchedules: next });
        }}
        onCategoryPriorityChange={(order) => form.patch({ categoryPriority: order })}
        onFinalsCourtChange={(court) => form.patch({ finalsCourt: court })}
        // Migration 027 — per-category match duration overrides. The
        // map is sparse (only categories with explicit values are
        // present) so the field UI shows an empty input for missing
        // entries that hint at the global default.
        matchDurationsByCategory={form.formData.matchDurationsByCategory}
        onMatchDurationsByCategoryChange={(next) =>
          form.patch({ matchDurationsByCategory: next })
        }
      />

      <RegulationField
        text={form.formData.regulationText}
        onTextChange={(v) => form.patch({ regulationText: v })}
        hasFile={form.regulationPdfHasFile}
        fileName={form.regulationPdfFileName}
        inputRef={form.regulationPdfInputRef}
        onSelect={form.handleRegulationPdfSelect}
        onClear={form.clearRegulationPdf}
      />

      <div className="flex gap-3 pt-4 border-t border-black/10">
        {!inline && (
          <button
            type="button"
            onClick={onClose}
            disabled={form.submitting}
            className="flex-1 px-4 py-3 bg-black/5 hover:bg-black/10 font-bold rounded-sm transition-colors disabled:opacity-50"
            style={FONT}
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={form.submitting}
          className={`${
            inline ? 'sm:flex-none sm:min-w-[200px] ml-auto' : 'flex-1'
          } px-4 py-3 bg-spk-red text-white hover:bg-spk-red-dark font-bold rounded-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2`}
          style={FONT}
        >
          {(form.submitting || form.uploadingCover || form.uploadingRegulationPdf) && (
            <Loader2 className="w-4 h-4 animate-spin" />
          )}
          {form.uploadingCover
            ? 'Subiendo imagen…'
            : form.uploadingRegulationPdf
              ? 'Subiendo reglamento…'
              : tournament
                ? 'Guardar Cambios'
                : 'Crear Torneo'}
        </button>
      </div>
    </form>
  );

  if (inline) return body;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-sm shadow-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 sm:px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl sm:text-2xl font-bold" style={FONT}>
            {tournament ? 'EDITAR TORNEO' : 'CREAR TORNEO'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-sm transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {body}
      </motion.div>
    </div>
  );
}

/* ── Tiny field helpers (local to this modal) ─────────────────────── */

function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-bold mb-2" style={FONT}>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  multiline = false,
  error,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  error?: string;
  min?: number;
  max?: number;
}) {
  const base = `w-full px-4 py-2 border-2 rounded-sm focus:outline-none ${
    error ? 'border-red-500 focus:border-red-500' : 'border-black/10 focus:border-spk-red'
  }`;
  return (
    <div>
      <FormLabel>{label}</FormLabel>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${base} min-h-[100px]`}
        />
      ) : (
        <input
          type={type}
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={base}
        />
      )}
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <FormLabel>{label}</FormLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Re-export types for anyone still importing FieldErrors from this file.
export type { FieldErrors };
