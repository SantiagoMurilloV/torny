import { useState, useMemo, useEffect } from 'react';
import { X, Loader2, GitMerge } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { categoryOfGroupName, groupLetter } from '../../../lib/phase';
import { nextPow2 } from './shared';

export interface ManualBracketCrossingsModalProps {
  open: boolean;
  /** Full group names already in DB, e.g. ["Juvenil Femenino|A"]. */
  groupNames: string[];
  onClose: () => void;
  onGenerate: (seeds: Array<{ position: number; label: string }>) => void;
  generating: boolean;
}

/**
 * Manual post-group crossings builder. Only used when the tournament's
 * `bracketMode === 'manual'`. The admin drags/selects which group-
 * placement placeholders meet each other in the first round; matches
 * are later resolved against standings by the backend.
 *
 * Tournaments using `bracketMode === 'divisions'` go through the
 * separate {@link BracketCrossingsModal} which auto-seeds VNL-style
 * without letting the admin edit the pairings by hand.
 *
 * Bracket size is derived from `groups × classifiersPerGroup` rounded
 * up to the next power of two — extra slots become byes.
 */
export function ManualBracketCrossingsModal({
  open,
  groupNames,
  onClose,
  onGenerate,
  generating,
}: ManualBracketCrossingsModalProps) {
  const [classifiersPerGroup, setClassifiersPerGroup] = useState(2);

  const hasMultipleCategories = useMemo(() => {
    const cats = new Set(groupNames.map(categoryOfGroupName));
    return cats.size > 1;
  }, [groupNames]);

  const groupDisplayName = (fullName: string) => {
    const letter = groupLetter(fullName);
    const cat = categoryOfGroupName(fullName);
    return hasMultipleCategories && cat ? `Grupo ${letter} (${cat})` : `Grupo ${letter}`;
  };

  const placeholderOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    for (let pos = 1; pos <= classifiersPerGroup; pos++) {
      for (const gn of groupNames) {
        const letter = groupLetter(gn);
        const cat = categoryOfGroupName(gn);
        const displayLabel =
          hasMultipleCategories && cat
            ? `${pos}° Grupo ${letter} (${cat})`
            : `${pos}° Grupo ${letter}`;
        list.push({ value: `${pos}|${gn}`, label: displayLabel });
      }
    }
    return list;
  }, [groupNames, classifiersPerGroup, hasMultipleCategories]);

  const totalSlots = useMemo(
    () => nextPow2(Math.max(groupNames.length * classifiersPerGroup, 2)),
    [groupNames.length, classifiersPerGroup],
  );
  const matchCount = totalSlots / 2;

  const [matchups, setMatchups] = useState<Array<[string | null, string | null]>>([]);

  useEffect(() => {
    setMatchups(Array.from({ length: matchCount }, () => [null, null]));
  }, [matchCount]);

  const setSlot = (matchIdx: number, slotIdx: 0 | 1, value: string | null) => {
    setMatchups((prev) => {
      const next = [...prev];
      const pair: [string | null, string | null] = [next[matchIdx][0], next[matchIdx][1]];
      pair[slotIdx] = value;
      next[matchIdx] = pair;
      return next;
    });
  };

  const usedPlaceholders = useMemo(() => {
    const used = new Set<string>();
    for (const [s1, s2] of matchups) {
      if (s1) used.add(s1);
      if (s2) used.add(s2);
    }
    return used;
  }, [matchups]);

  const handleGenerate = () => {
    const seeds: Array<{ position: number; label: string }> = [];
    for (let i = 0; i < matchups.length; i++) {
      const [s1, s2] = matchups[i];
      if (s1) seeds.push({ position: i * 2 + 1, label: s1 });
      if (s2) seeds.push({ position: i * 2 + 2, label: s2 });
    }
    onGenerate(seeds);
  };

  const canGenerate = matchups.some(([s1, s2]) => s1 !== null || s2 !== null);

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
          <div className="flex items-center gap-3">
            <GitMerge className="w-5 h-5 text-spk-blue flex-shrink-0" />
            <h2
              className="text-lg sm:text-xl font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              DEFINIR ELIMINACIÓN DIRECTA
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div className="p-3 bg-black/5 rounded-sm text-sm text-black/70">
            <span className="font-medium">Grupos detectados: </span>
            {groupNames.map(groupDisplayName).join(', ')}
          </div>

          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Clasificados por grupo:</label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setClassifiersPerGroup((c) => Math.max(1, c - 1))}
                disabled={classifiersPerGroup <= 1}
              >
                −
              </Button>
              <span
                className="text-lg font-bold w-8 text-center"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {classifiersPerGroup}
              </span>
              <Button size="sm" variant="outline" onClick={() => setClassifiersPerGroup((c) => c + 1)}>
                +
              </Button>
            </div>
            <span className="text-sm text-black/50">
              → {groupNames.length * classifiersPerGroup} clasificados · Cruce de {totalSlots}
            </span>
          </div>

          <div>
            <h3
              className="text-sm font-bold text-black/70 mb-3"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              CRUCES DE PRIMERA RONDA
            </h3>
            <p className="text-xs text-black/50 mb-4">
              Definí quién juega contra quién. Los espacios vacíos quedan como "Bye" (pase directo).
            </p>
            <div className="space-y-4 sm:space-y-3">
              {matchups.map((matchup, idx) => (
                <MatchupRow
                  key={idx}
                  index={idx}
                  matchup={matchup}
                  placeholderOptions={placeholderOptions}
                  usedPlaceholders={usedPlaceholders}
                  onSetSlot={setSlot}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-6 border-t border-black/10">
          <p className="text-xs text-black/50">
            Los cruces se resuelven automáticamente cuando los grupos terminen
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
              Cancelar
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="bg-spk-blue hover:bg-spk-blue/90 flex-1 sm:flex-none"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirmar y Generar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchupRow({
  index,
  matchup,
  placeholderOptions,
  usedPlaceholders,
  onSetSlot,
}: {
  index: number;
  matchup: [string | null, string | null];
  placeholderOptions: Array<{ value: string; label: string }>;
  usedPlaceholders: Set<string>;
  onSetSlot: (matchIdx: number, slotIdx: 0 | 1, value: string | null) => void;
}) {
  return (
    <div className="border sm:border-0 border-black/10 rounded-sm p-3 sm:p-0">
      <div
        className="text-xs sm:hidden font-bold text-black/60 mb-2 uppercase"
        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
      >
        Cruce {index + 1}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <span
          className="hidden sm:block text-sm font-bold w-16 text-black/60 flex-shrink-0"
          style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
        >
          Cruce {index + 1}
        </span>
        <SlotSelect
          value={matchup[0]}
          placeholderOptions={placeholderOptions}
          usedPlaceholders={usedPlaceholders}
          onChange={(v) => onSetSlot(index, 0, v)}
        />
        <span className="text-center sm:text-left text-xs sm:text-sm font-bold text-black/40 flex-shrink-0 uppercase">
          vs
        </span>
        <SlotSelect
          value={matchup[1]}
          placeholderOptions={placeholderOptions}
          usedPlaceholders={usedPlaceholders}
          onChange={(v) => onSetSlot(index, 1, v)}
        />
      </div>
    </div>
  );
}

function SlotSelect({
  value,
  placeholderOptions,
  usedPlaceholders,
  onChange,
}: {
  value: string | null;
  placeholderOptions: Array<{ value: string; label: string }>;
  usedPlaceholders: Set<string>;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex-1">
      <Select
        value={value ?? '_bye'}
        onValueChange={(v) => onChange(v === '_bye' ? null : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Seleccionar..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_bye">— Bye —</SelectItem>
          {placeholderOptions.map((ph) => (
            <SelectItem
              key={ph.value}
              value={ph.value}
              disabled={usedPlaceholders.has(ph.value) && value !== ph.value}
            >
              {ph.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
