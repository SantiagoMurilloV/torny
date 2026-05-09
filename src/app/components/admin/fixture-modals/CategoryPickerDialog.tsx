import { useMemo, useState } from 'react';
import { X, Trophy } from 'lucide-react';
import type { Team } from '../../../types';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface CategoryPickerDialogProps {
  open: boolean;
  /**
   * Categories configured on the tournament. Each is shown with its
   * current enrolled-teams count so the admin knows whether the
   * generation will actually have enough teams to run.
   */
  categories: string[];
  enrolledTeams: Team[];
  onClose: () => void;
  /**
   * Called with the chosen category. The admin can only pick one at
   * a time — this flow is intentionally scoped so each category gets
   * its own groups / bracket independently.
   */
  onPick: (category: string) => void;
}

/**
 * First step of the manual fixture-generation flow when the tournament
 * spans multiple categories. Groups and brackets are always built per
 * category (group names and bracket rounds carry the category as a
 * pipe-prefix) so forcing the admin to pick one here keeps the
 * downstream modals honest: the team list they see is already scoped.
 *
 * Single-category tournaments skip this step entirely — FixturesTab
 * jumps straight to ManualGroupsModal / ManualBracketModal.
 */
export function CategoryPickerDialog({
  open,
  categories,
  enrolledTeams,
  onClose,
  onPick,
}: CategoryPickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // Count enrolled teams per category to surface on each row. A
  // category with < 2 teams can't produce fixtures, so we disable it
  // and mark it explicitly in the UI.
  const countsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of categories) map.set(cat, 0);
    for (const t of enrolledTeams) {
      if (t.category && map.has(t.category)) {
        map.set(t.category, (map.get(t.category) ?? 0) + 1);
      }
    }
    return map;
  }, [categories, enrolledTeams]);

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
          <h2 className="text-xl font-bold" style={FONT}>
            ELEGÍ LA CATEGORÍA
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto">
          <p className="text-sm text-black/60 mb-4">
            Los cruces se arman por categoría. Cada categoría tiene sus propios grupos y cruces
            independientes.
          </p>

          <div className="space-y-2">
            {categories.map((cat) => {
              const count = countsByCategory.get(cat) ?? 0;
              const disabled = count < 2;
              const isSelected = selected === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(cat)}
                  className={`w-full flex items-center justify-between gap-3 p-3 sm:p-4 border-2 rounded-sm text-left transition-all ${
                    disabled
                      ? 'border-black/5 bg-black/[0.02] text-black/35 cursor-not-allowed'
                      : isSelected
                        ? 'border-spk-red bg-spk-red/5'
                        : 'border-black/10 hover:border-black/30'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Trophy
                      className={`w-4 h-4 flex-shrink-0 ${
                        isSelected ? 'text-spk-red' : 'text-black/40'
                      }`}
                    />
                    <span className="font-bold truncate" style={FONT}>
                      {cat}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                      disabled ? 'text-black/35' : 'text-black/60'
                    }`}
                  >
                    {count} {count === 1 ? 'equipo' : 'equipos'}
                    {disabled && ' · insuficiente'}
                  </span>
                </button>
              );
            })}
          </div>
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
