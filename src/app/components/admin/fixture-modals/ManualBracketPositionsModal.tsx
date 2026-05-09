import { useState, useMemo, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { nextPow2 } from './shared';

export interface ManualBracketPositionsProps {
  open: boolean;
  groups: Record<string, string[]>;
  onClose: () => void;
  onGenerate: (
    seeds: Array<{ position: number; teamId: string | null; label?: string }>,
  ) => void;
  generating: boolean;
}

/**
 * Post-groups variant of the bracket seeding modal. Instead of picking
 * teams directly, the admin maps bracket positions to group-placement
 * placeholders ("1° Grupo A", "2° Grupo B", …). The backend resolves
 * those placeholders to real teams once the group phase wraps up.
 */
export function ManualBracketPositionsModal({
  open,
  groups,
  onClose,
  onGenerate,
  generating,
}: ManualBracketPositionsProps) {
  const groupNames = useMemo(() => Object.keys(groups), [groups]);

  const [bracketSize, setBracketSize] = useState<number>(() =>
    nextPow2(Math.max(groupNames.length * 2, 2)),
  );

  const availablePlaceholders = useMemo(() => {
    const list: string[] = [];
    const maxTeamsInAnyGroup = Math.max(...Object.values(groups).map((g) => g.length), 0);
    for (let i = 1; i <= Math.max(maxTeamsInAnyGroup, 4); i++) {
      for (const groupName of groupNames) {
        list.push(`${i}|${groupName}`);
      }
    }
    return list;
  }, [groups, groupNames]);

  const formatPlaceholder = (ph: string) => {
    const [pos, grp] = ph.split('|');
    return `${pos}° Grupo ${grp}`;
  };

  const [seeds, setSeeds] = useState<
    Array<{ position: number; teamId: string | null; label?: string }>
  >([]);

  useEffect(() => {
    setSeeds((prev) => {
      const fresh: Array<{ position: number; teamId: string | null; label?: string }> =
        Array.from({ length: bracketSize }, (_, i) => ({
          position: i + 1,
          teamId: null,
          label: undefined,
        }));
      prev.forEach((p) => {
        if (p.position <= bracketSize && p.label) {
          fresh[p.position - 1].label = p.label;
        }
      });
      return fresh;
    });
  }, [bracketSize]);

  const assignedLabels = useMemo(
    () => new Set(seeds.map((s) => s.label).filter((l): l is string => Boolean(l))),
    [seeds],
  );

  const setLabelAtPosition = (position: number, label: string | undefined) => {
    setSeeds((prev) =>
      prev.map((s) => (s.position === position ? { ...s, label } : s)),
    );
  };

  const canGenerate = seeds.some((s) => s.label !== undefined);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-0"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-sm shadow-xl w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-black/10">
          <h2
            className="text-lg sm:text-xl font-bold"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            CRUCES DIRECTOS DESDE GRUPOS
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <p className="text-sm text-black/60 mb-4">
            Definí el tamaño del cruce de eliminación final y vinculá qué posición de cada
            grupo ocupará cada lugar (Ej: 1° Grupo A). Las posiciones se emparejan: 1 vs 2, 3
            vs 4.
          </p>

          <div className="mb-6">
            <label className="text-xs font-bold text-black/60 block mb-1">
              Tamaño del Cruce (Clasificados totales)
            </label>
            <Select value={bracketSize.toString()} onValueChange={(v) => setBracketSize(parseInt(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 equipos (Final)</SelectItem>
                <SelectItem value="4">4 equipos (Semifinal)</SelectItem>
                <SelectItem value="8">8 equipos (Cuartos)</SelectItem>
                <SelectItem value="16">16 equipos (Octavos)</SelectItem>
                <SelectItem value="32">32 equipos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {seeds.map((seed) => (
              <div
                key={seed.position}
                className="flex items-center gap-3 p-2 border border-black/10 rounded-sm"
              >
                <span
                  className="w-8 text-center font-bold text-sm"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                >
                  {seed.position}
                </span>
                <div className="flex-1">
                  <Select
                    value={seed.label || '_empty'}
                    onValueChange={(v) =>
                      setLabelAtPosition(seed.position, v === '_empty' ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar posición de grupo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_empty">— Vacío —</SelectItem>
                      {availablePlaceholders.map((ph) => (
                        <SelectItem
                          key={ph}
                          value={ph}
                          disabled={assignedLabels.has(ph) && seed.label !== ph}
                        >
                          {formatPlaceholder(ph)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 sm:p-6 border-t border-black/10">
          <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
            Atrás
          </Button>
          <Button
            onClick={() => onGenerate(seeds)}
            disabled={!canGenerate || generating}
            className="bg-spk-red hover:bg-spk-red-dark flex-1 sm:flex-none"
          >
            {generating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Confirmar y Generar
          </Button>
        </div>
      </div>
    </div>
  );
}
