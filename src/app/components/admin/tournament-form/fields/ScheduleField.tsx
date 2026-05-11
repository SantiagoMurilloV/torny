import { Calendar, Clock } from 'lucide-react';
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
  dailySchedules,
  onMatchDurationChange,
  onMatchBreakChange,
  onDailyScheduleChange,
}: {
  matchDurationMinutes: number;
  matchBreakMinutes: number;
  dailySchedules: DailyScheduleEntry[];
  onMatchDurationChange: (n: number) => void;
  onMatchBreakChange: (n: number) => void;
  /**
   * Replace one row by index. Passing empty strings clears the
   * override for that date — the day falls back to the global default.
   */
  onDailyScheduleChange: (index: number, patch: Partial<DailyScheduleEntry>) => void;
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
      </div>

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
