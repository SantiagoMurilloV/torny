import { useEffect, useRef, useState } from 'react';
import { RotateCw, X } from 'lucide-react';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * FIVB volleyball court positions (team's perspective, facing the net):
 *
 *        ┌─────────────────────────────────┐
 *        │    R E D  (zona frontal, arriba) │
 *        ├──────────┬──────────┬───────────┤
 *        │    P4    │    P3    │    P2     │  ← Delantera
 *        ├──────────┼──────────┼───────────┤
 *        │    P5    │    P6    │    P1 ●   │  ← Trasera (P1 = sacador)
 *        └──────────┴──────────┴───────────┘
 *                               ↑ zona de saque
 *
 * lineup[i] = dorsal de la jugadora en posición i+1
 *   lineup[0] → P1 (sacadora, trasera-derecha)
 *   lineup[1] → P2 (delantera-derecha)
 *   lineup[2] → P3 (delantera-centro)
 *   lineup[3] → P4 (delantera-izquierda)
 *   lineup[4] → P5 (trasera-izquierda)
 *   lineup[5] → P6 (trasera-centro)
 *
 * Rotación horaria (cuando el equipo recibe el saque):
 *   P6 → P1 (nueva sacadora), P1 → P2, P2 → P3, P3 → P4, P4 → P5, P5 → P6
 *   En el array: el último elemento (P6, idx 5) pasa al frente.
 */

/** Celdas del grid en orden de lectura (fila 0 = red, fila 1 = fondo). */
const GRID_CELLS: { pos: number; label: string }[] = [
  { pos: 4, label: 'Delantera izquierda' },
  { pos: 3, label: 'Delantera centro' },
  { pos: 2, label: 'Delantera derecha' },
  { pos: 5, label: 'Trasera izquierda' },
  { pos: 6, label: 'Trasera centro' },
  { pos: 1, label: 'Sacadora' },
];

/** Rota el lineup en sentido horario (equipo gana el saque). */
function rotateClockwise(l: string[]): string[] {
  // Último elemento (P6) se convierte en el primero (P1, nueva sacadora)
  return [l[5], l[0], l[1], l[2], l[3], l[4]];
}

interface RotationPanelProps {
  teamColor: string;
  serving: boolean;
  setNumber: number;
}

/**
 * Control visual de rotación para el panel del juez.
 * Muestra un grid 3×2 con los 6 puestos del voleibol.
 * El juez ingresa los dorsales y usa "Rotar" cuando el equipo gana el saque.
 */
export function RotationPanel({ teamColor, serving, setNumber }: RotationPanelProps) {
  const [lineup, setLineup] = useState<string[]>(['', '', '', '', '', '']);
  const [rotNum, setRotNum] = useState(1);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Resetear al inicio de cada set
  const prevSet = useRef(setNumber);
  useEffect(() => {
    if (setNumber !== prevSet.current) {
      setLineup(['', '', '', '', '', '']);
      setRotNum(1);
      setEditIdx(null);
      prevSet.current = setNumber;
    }
  }, [setNumber]);

  // Focus al input cuando se abre edición
  useEffect(() => {
    if (editIdx !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editIdx]);

  function beginEdit(idx: number) {
    setDraft(lineup[idx]);
    setEditIdx(idx);
  }

  function commitEdit() {
    if (editIdx === null) return;
    const val = draft.trim().slice(0, 3);
    setLineup((prev) => {
      const next = [...prev];
      next[editIdx] = val;
      return next;
    });
    setEditIdx(null);
  }

  function rotate() {
    setLineup(rotateClockwise);
    setRotNum((n) => (n % 6) + 1);
  }

  function clearAll() {
    setLineup(['', '', '', '', '', '']);
    setRotNum(1);
    setEditIdx(null);
  }

  const colorRgb = teamColor ?? '#e31e24';

  return (
    <div className="px-4 pt-3 pb-4" style={{ background: 'rgba(0,0,0,0.3)' }}>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase text-white/40"
            style={{ ...FONT, letterSpacing: '0.22em' }}
          >
            Rotación
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
            style={{
              ...FONT,
              letterSpacing: '0.1em',
              background: `${colorRgb}28`,
              color: colorRgb,
            }}
          >
            #{rotNum}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearAll}
            className="text-white/25 hover:text-white/60 transition-colors"
            title="Limpiar formación"
            aria-label="Limpiar formación"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={rotate}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase border border-white/15 bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-colors"
            style={{ ...FONT, letterSpacing: '0.12em' }}
            title="Rotar posiciones en sentido horario (FIVB)"
          >
            <RotateCw className="w-3 h-3" />
            Rotar
          </button>
        </div>
      </div>

      {/* Indicador de red (zona frontal) */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-px" style={{ background: `${colorRgb}50` }} />
        <span
          className="text-[8px] uppercase font-bold text-white/30"
          style={{ ...FONT, letterSpacing: '0.25em' }}
        >
          red
        </span>
        <div className="flex-1 h-px" style={{ background: `${colorRgb}50` }} />
      </div>

      {/* Grid 3×2 de posiciones */}
      <div className="grid grid-cols-3 gap-2 justify-items-center">
        {GRID_CELLS.map(({ pos, label }) => {
          const idx = pos - 1;
          const isServer = pos === 1;
          const highlight = isServer && serving;
          const isEditing = editIdx === idx;
          const jersey = lineup[idx];
          const filled = jersey !== '';

          return (
            <button
              key={pos}
              onClick={() => beginEdit(idx)}
              title={`${label}${isServer ? ' · Sacadora' : ''} — toca para editar dorsal`}
              aria-label={`Posición ${pos}: ${jersey || 'vacía'}. ${label}`}
              className={[
                'relative flex flex-col items-center justify-center',
                'w-[60px] h-[60px] rounded-full',
                'border-2 transition-all duration-150 select-none',
                highlight
                  ? 'border-spk-red shadow-[0_0_16px_rgba(227,30,36,0.35)]'
                  : filled
                    ? 'border-white/35 hover:border-white/55'
                    : 'border-white/15 hover:border-white/30',
              ].join(' ')}
              style={{
                background: highlight
                  ? 'rgba(227,30,36,0.14)'
                  : filled
                    ? `${colorRgb}16`
                    : 'rgba(255,255,255,0.04)',
              }}
            >
              {/* Número de posición (esquina superior izquierda) */}
              <span
                className="absolute top-1 left-1.5 text-[8px] font-bold leading-none"
                style={{
                  ...FONT,
                  color: highlight ? '#e31e24' : 'rgba(255,255,255,0.28)',
                }}
              >
                {pos}
              </span>

              {/* Input inline al editar, o dorsal al mostrar */}
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      commitEdit();
                    }
                    if (e.key === 'Escape') setEditIdx(null);
                  }}
                  className="w-10 text-center bg-transparent text-white font-bold text-base outline-none border-b border-white/50"
                  style={{ ...FONT, letterSpacing: '-0.01em' }}
                  maxLength={3}
                  inputMode="numeric"
                />
              ) : (
                <span
                  className={`text-xl font-bold tabular-nums leading-none ${
                    jersey ? 'text-white' : 'text-white/18'
                  }`}
                  style={{ ...FONT, letterSpacing: '-0.02em' }}
                >
                  {jersey || '·'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Indicador de zona de saque */}
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-px bg-white/10" />
        <span
          className="text-[8px] uppercase font-bold text-white/20"
          style={{ ...FONT, letterSpacing: '0.25em' }}
        >
          saque
        </span>
        <div className="flex-1 h-px bg-white/10" />
      </div>
    </div>
  );
}
