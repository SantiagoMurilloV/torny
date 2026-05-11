import { Calendar, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import type { DailyScheduleEntry } from '../types';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * "Programación de partidos" section of the tournament form. Edits the
 * three persisted scheduling defaults from migration 024:
 *   · matchDurationMinutes — global per-match length (5..600).
 *   · matchBreakMinutes    — global between-matches gap (0..240).
 *   · dailySchedules       — optional per-day overrides of the active
 *                             window. One row per day in the date
 *                             range; empty start/end cells mean "use
 *                             the global 08:00–18:00 default".
 *
 * Why per-day rows instead of a global start/end:
 *   The original modal exposed a single "08:00–18:00" pair, but
 *   weekend tournaments often run different hours per day (Sat 08:00–
 *   22:00, Sun 08:00–14:00). Letting the admin override each day
 *   individually keeps the simple case (every day same hours = leave
 *   them all blank) just as easy as before.
 */
export function ScheduleField({
  matchBreakMinutes,
  maxMatchesPerDay,
  deadTimeBlocks,
  dailySchedules,
  categoryPriority,
  availableCategories,
  finalsCourt,
  availableCourts,
  matchDurationsByCategory,
  onMatchBreakChange,
  onMaxMatchesPerDayChange,
  onDeadTimeBlocksChange,
  onDailyScheduleChange,
  onCategoryPriorityChange,
  onFinalsCourtChange,
  onMatchDurationsByCategoryChange,
}: {
  matchBreakMinutes: number;
  maxMatchesPerDay: number;
  deadTimeBlocks: Array<{ start: string; end: string }>;
  dailySchedules: DailyScheduleEntry[];
  categoryPriority: string[];
  availableCategories: string[];
  /** Migration 026 — current preference. '' means "Sin preferencia". */
  finalsCourt: string;
  /** Court names from the tournament's `courts` array — feeds the
   *  finals-court <select> options. */
  availableCourts: string[];
  /**
   * Migration 027 — per-category match length (in minutes). Sparse:
   * categories without an entry fall back to a hardcoded 60 min in the
   * scheduler. Replaced the old global `matchDurationMinutes` field
   * since the two were redundant from the admin's perspective.
   */
  matchDurationsByCategory: Record<string, number>;
  onMatchBreakChange: (n: number) => void;
  onMaxMatchesPerDayChange: (n: number) => void;
  onDeadTimeBlocksChange: (blocks: Array<{ start: string; end: string }>) => void;
  onDailyScheduleChange: (index: number, patch: Partial<DailyScheduleEntry>) => void;
  onCategoryPriorityChange: (order: string[]) => void;
  onFinalsCourtChange: (court: string) => void;
  onMatchDurationsByCategoryChange: (next: Record<string, number>) => void;
}) {
  // Format a YYYY-MM-DD string as "vie 15 may" for the row label. Uses
  // the browser's es-CO locale so the day-of-week is short + Spanish.
  const formatDateLabel = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3
          className="text-sm font-bold uppercase text-black/70 mb-1"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          Programación de partidos
        </h3>
        <p className="text-xs text-black/50">
          Estos valores se usan para generar y reparar los horarios de los
          partidos. Podés sobrescribir el horario activo de cada día abajo;
          los días sin override usan 08:00–18:00 por defecto.
        </p>
      </div>

      {/* Tournament-wide knobs that apply across all categories: the
          break between matches and the per-day cap. The per-MATCH
          duration was moved out of this row — it now lives in
          "Duración por categoría" below, so admin no longer sees the
          redundant global vs per-category inputs side-by-side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold mb-1" style={FONT}>
            Intervalo entre partidos (min)
          </label>
          <input
            type="number"
            min={0}
            max={240}
            value={String(matchBreakMinutes)}
            onChange={(e) =>
              onMatchBreakChange(parseInt(e.target.value, 10) || 0)
            }
            className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="text-[11px] text-black/45 mt-1">
            Pausa entre un partido y el siguiente. Default: 15.
          </p>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1" style={FONT}>
            Máx. partidos por día
          </label>
          <input
            type="number"
            min={0}
            max={200}
            value={String(maxMatchesPerDay)}
            onChange={(e) =>
              onMaxMatchesPerDayChange(parseInt(e.target.value, 10) || 0)
            }
            className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="text-[11px] text-black/45 mt-1">
            0 = sin límite. Útil para no sobrecargar un día.
          </p>
        </div>
      </div>

      {/* Finals court — admin's pick of the "best" court for the
          semis + final. The bracket materializer pins matches whose
          round name contains "semi" or "final" to this court (with
          a fallback to the rotation when the slot is already taken
          by another bracket match). */}
      <div>
        <label className="block text-sm font-bold mb-1" style={FONT}>
          Localidad de semifinales y finales
        </label>
        <select
          value={finalsCourt}
          onChange={(e) => onFinalsCourtChange(e.target.value)}
          className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
        >
          <option value="">Sin preferencia (rotación normal)</option>
          {availableCourts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-black/45 mt-1">
          Cancha donde se preferirá programar las semis y finales del
          cuadro de eliminación. Si está ocupada en ese horario por otro
          partido del cuadro, cae a la rotación normal.
        </p>
      </div>

      {/* Per-category match durations — migration 027. Each row is a
          category from the tournament with its own duration override.
          Empty / 0 input means "use the global default above" (the
          form drops the entry from the map at submit time). Lets the
          admin run mixed tournaments where Sub-13 partidos are 40 min
          but Senior best-of-5 stretch to 90 — no need to lock the
          whole tournament to the longest category. */}
      {availableCategories.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-black/60" aria-hidden="true" />
            <label className="text-sm font-bold" style={FONT}>
              Duración por categoría
            </label>
          </div>
          <p className="text-[11px] text-black/45 mb-3">
            Tiempo bloqueado por partido en cada categoría. Si dejás un
            campo vacío, esa categoría usa 60 min por defecto.
          </p>
          <div className="space-y-2">
            {availableCategories.map((cat) => {
              const current = matchDurationsByCategory[cat];
              return (
                <div
                  key={cat}
                  className="flex items-center gap-3 bg-black/[0.02] border border-black/10 rounded-sm px-3 py-2"
                >
                  <span className="flex-1 text-sm text-black/80 truncate" title={cat}>
                    {cat}
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    inputMode="numeric"
                    placeholder="60"
                    value={typeof current === 'number' ? String(current) : ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const next = { ...matchDurationsByCategory };
                      if (raw === '') {
                        delete next[cat];
                      } else {
                        const n = parseInt(raw, 10);
                        if (Number.isFinite(n) && n > 0) next[cat] = n;
                      }
                      onMatchDurationsByCategoryChange(next);
                    }}
                    className="w-20 px-2 py-1 text-sm bg-white border border-black/10 rounded-sm focus:outline-none focus:border-spk-red text-right tabular-nums"
                    aria-label={`Duración para ${cat} en minutos`}
                  />
                  <span className="text-[11px] text-black/55 uppercase tracking-wide w-8">
                    min
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dead-time blocks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-black/60" aria-hidden="true" />
            <label className="text-sm font-bold" style={FONT}>
              Horas muertas (sin partidos)
            </label>
          </div>
          <button
            type="button"
            onClick={() => onDeadTimeBlocksChange([...deadTimeBlocks, { start: '12:00', end: '13:00' }])}
            className="text-xs text-black/60 hover:text-black border border-black/20 rounded px-2 py-1 transition-colors"
            style={FONT}
          >
            + Agregar bloque
          </button>
        </div>
        {deadTimeBlocks.length === 0 ? (
          <p className="text-xs text-black/45 italic">
            Sin horas muertas. Agregá bloques para pausas (almuerzo, descanso, etc.)
          </p>
        ) : (
          <div className="space-y-2">
            {deadTimeBlocks.map((block, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-black/[0.02] border border-black/10 rounded-sm px-3 py-2">
                <label className="flex items-center gap-2 flex-1">
                  <span className="text-[11px] text-black/55 uppercase tracking-wide w-10">Inicio</span>
                  <input
                    type="time"
                    value={block.start}
                    onChange={(e) => {
                      const next = deadTimeBlocks.map((b, i) => i === idx ? { ...b, start: e.target.value } : b);
                      onDeadTimeBlocksChange(next);
                    }}
                    className="flex-1 px-2 py-1 text-sm bg-white border border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </label>
                <label className="flex items-center gap-2 flex-1">
                  <span className="text-[11px] text-black/55 uppercase tracking-wide w-10">Fin</span>
                  <input
                    type="time"
                    value={block.end}
                    onChange={(e) => {
                      const next = deadTimeBlocks.map((b, i) => i === idx ? { ...b, end: e.target.value } : b);
                      onDeadTimeBlocksChange(next);
                    }}
                    className="flex-1 px-2 py-1 text-sm bg-white border border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onDeadTimeBlocksChange(deadTimeBlocks.filter((_, i) => i !== idx))}
                  className="text-black/30 hover:text-red-500 transition-colors text-lg leading-none"
                  aria-label="Eliminar bloque"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category priority — opt-in. Hidden behind a toggle so admins
          who don't care about ordering don't see a giant list of
          numbered categories taking up form real estate. The toggle:
            · OFF (default when categoryPriority is empty) → small
              header + "Personalizar orden" button. Scheduler keeps
              the natural / insertion order.
            · ON (categoryPriority has at least one entry) → full
              reorderable list + "Quitar orden personalizado" link
              that clears the array back to [].
          The "personalizado" state is derived from `categoryPriority`
          itself so the form doesn't need an extra toggle field — turn
          off = clear the array, turn on = seed it with the current
          availableCategories. */}
      {availableCategories.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="flex items-center gap-2">
              <ArrowUp className="w-4 h-4 text-black/60" aria-hidden="true" />
              <label className="text-sm font-bold" style={FONT}>
                Orden de categorías{' '}
                <span className="text-black/40 font-normal">(opcional)</span>
              </label>
            </div>
            {categoryPriority.length === 0 ? (
              <button
                type="button"
                onClick={() => onCategoryPriorityChange([...availableCategories])}
                className="text-xs text-spk-red hover:underline font-bold"
                style={FONT}
              >
                Personalizar orden
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onCategoryPriorityChange([])}
                className="text-xs text-black/55 hover:text-black hover:underline"
                style={FONT}
              >
                Quitar orden personalizado
              </button>
            )}
          </div>
          {categoryPriority.length === 0 ? (
            <p className="text-[11px] text-black/45">
              Las categorías juegan en el orden natural. Si querés que
              alguna juegue siempre más temprano (por ejemplo categorías
              chicas primero), tocá &ldquo;Personalizar orden&rdquo;.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-black/45 mb-3">
                Las categorías de arriba juegan más temprano. Usá las
                flechas para reordenar.
              </p>
              <div className="space-y-1.5">
                {categoryPriority.map((cat, idx, arr) => (
                  <div
                    key={cat}
                    className="flex items-center gap-2 bg-white border border-black/10 rounded-sm px-3 py-2"
                  >
                    <span className="text-xs font-bold text-black/40 w-5" style={FONT}>
                      {idx + 1}.
                    </span>
                    <span className="text-sm font-medium flex-1">{cat}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          const next = [...arr];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          onCategoryPriorityChange(next);
                        }}
                        className="p-1 text-black/30 hover:text-black disabled:opacity-20 transition-colors"
                        aria-label="Subir"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === arr.length - 1}
                        onClick={() => {
                          const next = [...arr];
                          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                          onCategoryPriorityChange(next);
                        }}
                        className="p-1 text-black/30 hover:text-black disabled:opacity-20 transition-colors"
                        aria-label="Bajar"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Per-day rows — only render when the date range produced rows
          (set start + end first, save, then re-open). */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-black/60" aria-hidden="true" />
          <label className="text-sm font-bold" style={FONT}>
            Horario activo por día (opcional)
          </label>
        </div>
        {dailySchedules.length === 0 ? (
          <p className="text-xs text-black/45 italic">
            Configurá las fechas del torneo arriba y guardá; al volver a
            abrir el form vas a poder editar el horario activo de cada día.
          </p>
        ) : (
          <div className="space-y-2">
            {dailySchedules.map((row, idx) => (
              <div
                key={row.date}
                className="grid grid-cols-1 sm:grid-cols-[160px_1fr_1fr] gap-2 items-center bg-black/[0.02] border border-black/10 rounded-sm px-3 py-2"
              >
                <div
                  className="text-xs uppercase font-bold text-black/70 truncate"
                  style={{ ...FONT, letterSpacing: '0.06em' }}
                >
                  {formatDateLabel(row.date)}
                </div>
                <label className="flex items-center gap-2">
                  <Clock
                    className="w-3.5 h-3.5 text-black/40"
                    aria-hidden="true"
                  />
                  <span className="text-[11px] text-black/55 uppercase tracking-wide">
                    Inicio
                  </span>
                  <input
                    type="time"
                    value={row.start}
                    onChange={(e) =>
                      onDailyScheduleChange(idx, { start: e.target.value })
                    }
                    className="flex-1 px-2 py-1 text-sm bg-white border border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <Clock
                    className="w-3.5 h-3.5 text-black/40"
                    aria-hidden="true"
                  />
                  <span className="text-[11px] text-black/55 uppercase tracking-wide">
                    Fin
                  </span>
                  <input
                    type="time"
                    value={row.end}
                    onChange={(e) =>
                      onDailyScheduleChange(idx, { end: e.target.value })
                    }
                    className="flex-1 px-2 py-1 text-sm bg-white border border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                  />
                </label>
              </div>
            ))}
            <p className="text-[11px] text-black/45">
              Dejá inicio o fin vacío para que ese día use el horario por
              defecto (08:00–18:00).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
