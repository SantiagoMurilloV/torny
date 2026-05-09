import { useState, useMemo } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { Team } from '../../../types';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { nextPow2 } from './shared';

interface ManualBracketModalProps {
  open: boolean;
  teams: Team[];
  onClose: () => void;
  onGenerate: (
    seeds: Array<{ position: number; teamId: string | null; label?: string }>,
  ) => void;
  generating: boolean;
}

/**
 * Direct bracket assignment — used by knockout tournaments where there
 * are no groups, just a seeded bracket. Positions follow standard
 * pairing: 1vs2, 3vs4, etc.
 *
 * The size of the bracket is rounded up to the next power of two so
 * empty slots become byes.
 */
export function ManualBracketModal({
  open,
  teams,
  onClose,
  onGenerate,
  generating,
}: ManualBracketModalProps) {
  const positionCount = useMemo(() => nextPow2(Math.max(teams.length, 2)), [teams]);

  const [seeds, setSeeds] = useState<Array<{ position: number; teamId: string | null }>>(() =>
    Array.from({ length: positionCount }, (_, i) => ({ position: i + 1, teamId: null })),
  );

  const assignedIds = useMemo(
    () => new Set(seeds.filter((s) => s.teamId).map((s) => s.teamId!)),
    [seeds],
  );

  const setTeamAtPosition = (position: number, teamId: string | null) => {
    setSeeds((prev) => prev.map((s) => (s.position === position ? { ...s, teamId } : s)));
  };

  const canGenerate = seeds.some((s) => s.teamId !== null);

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
            ASIGNACIÓN MANUAL DE BRACKET
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <p className="text-sm text-black/60 mb-4">
            Asigná un equipo a cada posición del cruce. Las posiciones se emparejan: 1 vs 2, 3 vs 4, etc.
          </p>
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
                    value={seed.teamId || '_empty'}
                    onValueChange={(v) =>
                      setTeamAtPosition(seed.position, v === '_empty' ? null : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar equipo..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_empty">— Vacío —</SelectItem>
                      {teams.map((t) => (
                        <SelectItem
                          key={t.id}
                          value={t.id}
                          disabled={assignedIds.has(t.id) && seed.teamId !== t.id}
                        >
                          {t.name}
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
            Cancelar
          </Button>
          <Button
            onClick={() => onGenerate(seeds)}
            disabled={!canGenerate || generating}
            className="bg-spk-red hover:bg-spk-red-dark flex-1 sm:flex-none"
          >
            {generating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Generar
          </Button>
        </div>
      </div>
    </div>
  );
}
