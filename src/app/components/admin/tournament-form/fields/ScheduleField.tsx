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
  matchDurationMinutes,
  matchBreakMinutes,
  maxMatchesPerDay,
  deadTimeBlocks,
  dailySchedules,
  categoryPriority,
  availableCategories,
  onMatchDurationChange,
  onMatchBreakChange,
  onMaxMatchesPerDayChange,
  onDeadTimeBlocksChange,
  onDailyScheduleChange,
  onCategoryPriorityChange,
}: {
  matchDurationMinutes: number;
  matchBreakMinutes: number;
  maxMatchesPerDay: number;
  deadTimeBlocks: Array<{ start: string; end: string }>;
  dailySchedules: DailyScheduleEntry[];
  categoryPriority: string[];
  availableCategories: string[];
  onMatchDurationChange: (n: number) => void;
  onMatchBreakChange: (n: number) => void;
  onMaxMatchesPerDayChange: (n: number) => void;
  onDeadTimeBlocksChange: (blocks: Array<{ start: string; end: string }>) => void;
  onDailyScheduleChange: (index: number, patch: Partial<DailyScheduleEntry>) => void;
  onCategoryPriorityChange: (order: string[]) => void;
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

      {/* Global match length + break — applies to every day. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold mb-1" style={FONT}>
            Duración de cada partido (min)
          </label>
          <input
            type="number"
            min={5}
            max={600}
            value={String(matchDurationMinutes)}
            onChange={(e) =>
              onMatchDurationChange(parseInt(e.target.value, 10) || 0)
            }
            className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
          />
          <p className="text-[11px] text-black/45 mt-1">
            Tiempo bloqueado por partido. Default: 60.
          </p>
        </div>
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

      {/* Category priority — which categories play first each day */}
      {availableCategories.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ArrowUp className="w-4 h-4 text-black/60" aria-hidden="true" />
            <label className="text-sm font-bold" style={FONT}>
              Orden de categorías (quién juega primero)
            </label>
          </div>
          <p className="text-[11px] text-black/45 mb-3">
            Las categorías de arriba juegan más temprano. Arrastrá o usá las flechas para reordenar.
          </p>
          <div className="space-y-1.5">
            {(categoryPriority.length > 0 ? categoryPriority : availableCategories).map((cat, idx, arr) => (
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
