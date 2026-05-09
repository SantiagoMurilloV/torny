import { useState } from 'react';
import { X, Trophy, Award, Medal } from 'lucide-react';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

export type BracketMode = 'single' | 'division';

interface BracketModePickerDialogProps {
  open: boolean;
  /** Category the crossings flow is scoped to — shown in the subtitle
   *  so the admin knows which bracket they're about to define. */
  category: string | null;
  onClose: () => void;
  onPick: (mode: BracketMode) => void;
}

/**
 * Step after the category picker in the "Definir Eliminación Directa"
 * flow. The admin chooses whether this category plays a single knockout
 * bracket or splits into two independent divisions (Oro + Plata).
 *
 *   · `single`   → one BracketCrossingsModal call, no tier tag. Legacy
 *                  behavior for every existing tournament.
 *   · `division` → two sequential BracketCrossingsModal calls. First
 *                  with `tier: 'gold'`, then with `tier: 'silver'`. Each
 *                  bracket is fully independent (Plata has its own final,
 *                  Plata has no third-place match — only Oro does).
 *
 * Round strings are encoded with a 3-segment format when a tier is set
 * (`"Category|gold|final"`). No SQL migration needed — the same
 * `bracket_matches.round` column holds every variant.
 */
export function BracketModePickerDialog({
  open,
  category,
  onClose,
  onPick,
}: BracketModePickerDialogProps) {
  const [selected, setSelected] = useState<BracketMode | null>(null);

  if (!open) return null;

  const confirm = () => {
    if (!selected) return;
    onPick(selected);
    setSelected(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-0"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-sm shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-black/10">
          <div>
            <h2 className="text-xl font-bold" style={FONT}>
              MODO DE ELIMINACIÓN
            </h2>
            {category && (
              <p className="text-xs text-black/50 mt-1">
                Categoría: <span className="font-bold text-black/70">{category}</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-3">
          <p className="text-sm text-black/60">
            Elegí cómo se arman los cruces. La división Oro + Plata genera dos cruces
            independientes para premiar a los mejores y dar una segunda chance al resto.
          </p>

          <OptionCard
            icon={<Trophy className="w-5 h-5" />}
            title="Cruce único"
            description="Un solo cuadro de eliminación directa con todos los clasificados. Incluye 3er puesto."
            selected={selected === 'single'}
            onClick={() => setSelected('single')}
            accent="spk-blue"
          />

          <OptionCard
            icon={
              <div className="flex items-center gap-1">
                <Award className="w-5 h-5" />
                <Medal className="w-5 h-5" />
              </div>
            }
            title="División Oro + Plata"
            description="Dos cruces: Oro para los mejores (con 3er puesto), Plata para el resto (solo final). Se arman en dos pasos."
            selected={selected === 'division'}
            onClick={() => setSelected('division')}
            accent="spk-red"
          />
        </div>

        <div className="flex items-center justify-end gap-3 p-4 sm:p-6 border-t border-black/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-black/5 hover:bg-black/10 rounded-sm text-sm font-bold uppercase"
            style={{ ...FONT, letterSpacing: '0.08em' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={confirm}
            className="px-5 py-2 bg-spk-red hover:bg-spk-red-dark text-white rounded-sm text-sm font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ ...FONT, letterSpacing: '0.08em' }}
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionCard({
  icon,
  title,
  description,
  selected,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  accent: 'spk-blue' | 'spk-red';
}) {
  // Hardcoded class strings per accent so Tailwind's JIT scanner picks
  // them up at build time. Dynamic `border-${accent}` would be invisible.
  const selectedClasses =
    accent === 'spk-red'
      ? 'border-spk-red bg-spk-red/5'
      : 'border-spk-blue bg-spk-blue/5';
  const iconColor =
    selected && accent === 'spk-red'
      ? 'text-spk-red'
      : selected
        ? 'text-spk-blue'
        : 'text-black/40';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border-2 rounded-sm p-3 sm:p-4 transition-all flex gap-3 ${
        selected ? selectedClasses : 'border-black/10 hover:border-black/30'
      }`}
    >
      <div className={`flex-shrink-0 ${iconColor}`}>{icon}</div>
      <div className="min-w-0">
        <div className="font-bold text-sm sm:text-base" style={FONT}>
          {title}
        </div>
        <p className="text-xs text-black/55 mt-1 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}
