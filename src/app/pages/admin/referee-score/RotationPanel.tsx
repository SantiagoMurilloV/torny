import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Disposición visual del grid (vista desde la red, izquierda→derecha):
 *
 *        ┌─────────────────────────────────┐
 *        │    R E D  (zona frontal, arriba) │
 *        ├──────────┬──────────┬───────────┤
 *        │    P4    │    P3    │    P2     │  ← Delantera  (izq → der)
 *        ├──────────┼──────────┼───────────┤
 *        │    P5    │    P6    │    P1 ●   │  ← Trasera    (izq → der)
 *        └──────────┴──────────┴───────────┘
 *                               ↑ zona de saque (P1 = sacadora)
 *
 * lineup[i] = dorsal de la jugadora en posición i+1
 *   lineup[0] → P1 (sacadora, trasera-derecha)
 *   lineup[1] → P2 (delantera-derecha)
 *   lineup[2] → P3 (delantera-centro)
 *   lineup[3] → P4 (delantera-izquierda)
 *   lineup[4] → P5 (trasera-izquierda)
 *   lineup[5] → P6 (trasera-centro)
 *
 * Rotación automática (izquierda → derecha en el grid):
 *   Delantera: P4 → P3 → P2  (los números avanzan hacia la derecha)
 *   Trasera:   P2 → P1 → P6 → P5  (bajan por la derecha y vuelven por la izquierda)
 *
 *   En el array: cada posición recibe al jugador de la siguiente:
 *   P1 ← P2, P2 ← P3, P3 ← P4, P4 ← P5, P5 ← P6, P6 ← P1
 */

const GRID_CELLS: { pos: number; label: string }[] = [
  { pos: 4, label: 'Delantera izquierda' },
  { pos: 3, label: 'Delantera centro' },
  { pos: 2, label: 'Delantera derecha' },
  { pos: 5, label: 'Trasera izquierda' },
  { pos: 6, label: 'Trasera centro' },
  { pos: 1, label: 'Sacadora' },
];

// Rotación izquierda→derecha en el grid:
// Cada posición recibe la jugadora de la siguiente en sentido horario visual.
// P4→P3→P2 en la delantera (los números se desplazan hacia la derecha).
function rotate(l: string[]): string[] {
  // new[P1] = old[P2], new[P2] = old[P3], new[P3] = old[P4],
  // new[P4] = old[P5], new[P5] = old[P6], new[P6] = old[P1]
  return [l[1], l[2], l[3], l[4], l[5], l[0]];
}

interface RotationPanelProps {
  teamColor: string;
  serving: boolean;
  setNumber: number;
  /** Clave única por equipo + partido para persistir en localStorage. */
  storageKey: string;
  /**
   * Contador de rotaciones: se incrementa cada vez que el equipo gana el saque
   * por anotar un punto. La rotación se dispara al detectar el incremento,
   * NO por el cambio de `serving`, para evitar rotaciones falsas al restar puntos.
   */
  rotationTrigger: number;
}

/** Lee el estado guardado en localStorage para este equipo/partido/set. */
function loadSaved(key: string, setNumber: number): { lineup: string[]; rotNum: number } | null {
  try {
    const raw = localStorage.getItem(`spk_rot_${key}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Solo es válido si corresponde al set activo
    if (data.setNumber !== setNumber) return null;
    return { lineup: data.lineup, rotNum: data.rotNum };
  } catch {
    return null;
  }
}

/** Persiste el estado actual en localStorage. */
function saveState(key: string, setNumber: number, lineup: string[], rotNum: number) {
  try {
    localStorage.setItem(`spk_rot_${key}`, JSON.stringify({ setNumber, lineup, rotNum }));
  } catch {
    // localStorage lleno o bloqueado — ignorar silenciosamente
  }
}

export function RotationPanel({
  teamColor,
  serving,
  setNumber,
  storageKey,
  rotationTrigger,
}: RotationPanelProps) {
  // Inicializar desde localStorage si hay datos del set activo
  const saved = loadSaved(storageKey, setNumber);
  const [lineup, setLineup] = useState<string[]>(saved?.lineup ?? ['', '', '', '', '', '']);
  const [rotNum, setRotNum] = useState(saved?.rotNum ?? 1);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  // Flash visual brevemente al rotar
  const [justRotated, setJustRotated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guarda el set anterior para resetear sin disparar rotación espuria
  const prevSet = useRef(setNumber);
  // Guarda el trigger anterior para detectar incrementos reales
  const prevTrigger = useRef(rotationTrigger);

  // Persistir en localStorage cada vez que cambia lineup o rotNum
  useEffect(() => {
    saveState(storageKey, setNumber, lineup, rotNum);
  }, [storageKey, setNumber, lineup, rotNum]);

  // Rotación automática: se dispara SOLO cuando rotationTrigger se incrementa.
  // Esto evita rotaciones falsas cuando el saque cambia por un "-punto".
  useEffect(() => {
    if (rotationTrigger > prevTrigger.current) {
      prevTrigger.current = rotationTrigger;
      setLineup(rotate);
      setRotNum((n) => (n % 6) + 1);
      setJustRotated(true);
      const t = setTimeout(() => setJustRotated(false), 500);
      return () => clearTimeout(t);
    }
    prevTrigger.current = rotationTrigger;
  }, [rotationTrigger]);

  // Reset al iniciar un set nuevo
  useEffect(() => {
    if (setNumber !== prevSet.current) {
      const nextSaved = loadSaved(storageKey, setNumber);
      setLineup(nextSaved?.lineup ?? ['', '', '', '', '', '']);
      setRotNum(nextSaved?.rotNum ?? 1);
      setEditIdx(null);
      prevSet.current = setNumber;
    }
  }, [setNumber, storageKey]);

  // Focus al input al abrir edición
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

  function clearAll() {
    setLineup(['', '', '', '', '', '']);
    setRotNum(1);
    setEditIdx(null);
    try { localStorage.removeItem(`spk_rot_${storageKey}`); } catch { /* ignorar */ }
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
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm transition-colors duration-300"
            style={{
              ...FONT,
              letterSpacing: '0.1em',
              background: justRotated ? `${colorRgb}55` : `${colorRgb}28`,
              color: colorRgb,
            }}
          >
            #{rotNum}
          </span>
          {/* Indicador de rotación automática */}
          <span
            className="text-[8px] text-white/20 uppercase"
            style={{ ...FONT, letterSpacing: '0.15em' }}
          >
            auto
          </span>
        </div>

        <button
          onClick={clearAll}
          className="text-white/25 hover:text-white/60 transition-colors"
          title="Limpiar formación"
          aria-label="Limpiar formación"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Indicador de red */}
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
                'border-2 select-none',
                // La transición es más larga en el flash de rotación para que se vea
                justRotated ? 'transition-all duration-300' : 'transition-all duration-150',
                highlight
                  ? 'border-spk-red shadow-[0_0_16px_rgba(227,30,36,0.35)]'
                  : filled
                    ? 'border-white/35 hover:border-white/55'
                    : 'border-white/15 hover:border-white/30',
              ].join(' ')}
              style={{
                background: highlight
                  ? 'rgba(227,30,36,0.14)'
                  : justRotated && filled
                    ? `${colorRgb}28`
                    : filled
                      ? `${colorRgb}16`
                      : 'rgba(255,255,255,0.04)',
              }}
            >
              {/* Número de posición */}
              <span
                className="absolute top-1 left-1.5 text-[8px] font-bold leading-none"
                style={{
                  ...FONT,
                  color: highlight ? '#e31e24' : 'rgba(255,255,255,0.28)',
                }}
              >
                {pos}
              </span>

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
