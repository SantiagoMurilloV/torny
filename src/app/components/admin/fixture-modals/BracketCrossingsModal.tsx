import { useState, useMemo } from 'react';
import { X, Loader2, GitMerge, Award, Medal, Info } from 'lucide-react';
import { Button } from '../../ui/button';
import { categoryOfGroupName, groupLetter, type BracketTier } from '../../../lib/phase';
import { autoVnlSeeds, nextPow2 } from '../../../lib/autoBracketSeeds';

export interface BracketCrossingsModalProps {
  open: boolean;
  /** Full group names already in DB, e.g. ["Juvenil Femenino|A"]. */
  groupNames: string[];
  onClose: () => void;
  onGenerate: (seeds: Array<{ position: number; label: string }>) => void;
  generating: boolean;
  /**
   * When set, the modal is opened as part of the Oro/Plata division
   * flow. The header + confirm button switch to the tier-specific
   * copy so the admin knows which bracket they're currently defining.
   * The actual tier goes to the backend from the parent's onGenerate
   * handler — this prop is purely presentational.
   */
  tier?: BracketTier | null;
  /**
   * Group placement the placeholder list starts at. Defaults to 1
   * (1°, 2°…). For Plata the parent passes `goldClassifiers + 1`
   * so the auto-generated seeding offers the positions Oro didn't
   * consume.
   */
  startPosition?: number;
}

/**
 * Post-group crossings — switched from the legacy manual "drag pairs"
 * builder to a VNL-style auto-seeding preview. The admin only picks
 * how many teams advance per group; the pairings fall out of the
 * classic power-of-two bracket pattern applied to `1°A, 1°B, …, 2°A,
 * 2°B, …` seeds.
 *
 * The confirm button hands the parent the very same `{position, label}`
 * shape the old manual flow produced, so the server-side
 * `generateBracketCrossings` endpoint doesn't need to change.
 */
export function BracketCrossingsModal({
  open,
  groupNames,
  onClose,
  onGenerate,
  generating,
  tier = null,
  startPosition = 1,
}: BracketCrossingsModalProps) {
  const headline =
    tier === 'gold'
      ? 'DEFINIR BRACKET ORO'
      : tier === 'silver'
        ? 'DEFINIR BRACKET PLATA'
        : 'DEFINIR ELIMINACIÓN DIRECTA';
  const HeadlineIcon = tier === 'gold' ? Award : tier === 'silver' ? Medal : GitMerge;
  const headlineColor =
    tier === 'gold'
      ? 'text-amber-500'
      : tier === 'silver'
        ? 'text-slate-400'
        : 'text-spk-blue';
  const confirmLabel =
    tier === 'gold'
      ? 'Generar Cruce Oro'
      : tier === 'silver'
        ? 'Generar Cruce Plata'
        : 'Confirmar y Generar';
  const [classifiersPerGroup, setClassifiersPerGroup] = useState(2);

  const hasMultipleCategories = useMemo(() => {
    const cats = new Set(groupNames.map(categoryOfGroupName));
    return cats.size > 1;
  }, [groupNames]);

  const sortedGroupNames = useMemo(() => [...groupNames].sort(), [groupNames]);

  const seeds = useMemo(
    () =>
      autoVnlSeeds({
        groupNames: sortedGroupNames,
        classifiersPerGroup,
        startPosition,
      }),
    [sortedGroupNames, classifiersPerGroup, startPosition],
  );

  const totalSlots = useMemo(
    () => nextPow2(Math.max(sortedGroupNames.length * classifiersPerGroup, 2)),
    [sortedGroupNames.length, classifiersPerGroup],
  );
  const matchCount = totalSlots / 2;

  /** Pretty-print the placeholder label `"pos|Cat|letter"` as "1° Grupo A". */
  const labelToDisplay = (label: string | undefined): string => {
    if (!label) return '— Bye —';
    const firstPipe = label.indexOf('|');
    if (firstPipe === -1) return label;
    const pos = label.substring(0, firstPipe);
    const groupName = label.substring(firstPipe + 1);
    const letter = groupLetter(groupName);
    const cat = categoryOfGroupName(groupName);
    return hasMultipleCategories && cat
      ? `${pos}° Grupo ${letter} (${cat})`
      : `${pos}° Grupo ${letter}`;
  };

  /** Pair the seeds by bracket-match slot (slots 1-2 form match 1, 3-4
   *  form match 2, etc.) so we can render a clean preview grid. */
  const matchPreview = useMemo(() => {
    const bySlot = new Map<number, string>();
    for (const s of seeds) bySlot.set(s.position, s.label);
    const pairs: Array<{ slot1: string | undefined; slot2: string | undefined }> = [];
    for (let i = 0; i < matchCount; i++) {
      pairs.push({
        slot1: bySlot.get(i * 2 + 1),
        slot2: bySlot.get(i * 2 + 2),
      });
    }
    return pairs;
  }, [seeds, matchCount]);

  const groupDisplayName = (fullName: string) => {
    const letter = groupLetter(fullName);
    const cat = categoryOfGroupName(fullName);
    return hasMultipleCategories && cat ? `Grupo ${letter} (${cat})` : `Grupo ${letter}`;
  };

  const handleGenerate = () => {
    onGenerate(seeds);
  };

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
            <HeadlineIcon className={`w-5 h-5 ${headlineColor} flex-shrink-0`} />
            <h2
              className="text-lg sm:text-xl font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {headline}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5">
          <div className="p-3 bg-black/5 rounded-sm text-sm text-black/70">
            <span className="font-medium">Grupos detectados: </span>
            {sortedGroupNames.map(groupDisplayName).join(', ')}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
              → {sortedGroupNames.length * classifiersPerGroup} clasificados · Cruce de{' '}
              {totalSlots}
            </span>
          </div>

          <div className="flex items-start gap-2 p-3 border border-spk-blue/20 bg-spk-blue/5 rounded-sm">
            <Info className="w-4 h-4 text-spk-blue mt-0.5 flex-shrink-0" />
            <div className="text-xs text-black/70 leading-relaxed">
              <span className="font-semibold text-spk-blue">Seeding automático estilo VNL.</span>{' '}
              Se emparejan 1°s contra últimos, 2°s contra penúltimos, y así sucesivamente,
              siguiendo el patrón clásico potencias-de-dos. Los cruces se resuelven con las
              posiciones reales cuando los grupos terminen.
            </div>
          </div>

          <div>
            <h3
              className="text-sm font-bold text-black/70 mb-3"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              CRUCES DE PRIMERA RONDA
            </h3>
            <div className="space-y-2">
              {matchPreview.map((pair, idx) => (
                <PreviewRow
                  key={idx}
                  index={idx}
                  slot1={labelToDisplay(pair.slot1)}
                  slot2={labelToDisplay(pair.slot2)}
                  isBye={!pair.slot1 || !pair.slot2}
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
              disabled={seeds.length === 0 || generating}
              className="bg-spk-blue hover:bg-spk-blue/90 flex-1 sm:flex-none"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({
  index,
  slot1,
  slot2,
  isBye,
}: {
  index: number;
  slot1: string;
  slot2: string;
  isBye: boolean;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 p-2.5 border border-black/10 rounded-sm bg-white">
      <span
        className="text-xs font-bold w-14 sm:w-16 text-black/50 flex-shrink-0 uppercase"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
      >
        Cruce {index + 1}
      </span>
      <SlotChip label={slot1} dimmed={slot1.startsWith('— Bye')} />
      <span className="text-[11px] sm:text-xs font-bold text-black/40 flex-shrink-0 uppercase">
        vs
      </span>
      <SlotChip label={slot2} dimmed={slot2.startsWith('— Bye')} />
      {isBye && (
        <span className="text-[10px] text-black/40 uppercase font-semibold flex-shrink-0 ml-auto">
          Pase directo
        </span>
      )}
    </div>
  );
}

function SlotChip({ label, dimmed }: { label: string; dimmed: boolean }) {
  return (
    <div
      className={`flex-1 px-3 py-1.5 text-sm rounded-sm truncate ${
        dimmed
          ? 'bg-black/5 text-black/35 italic'
          : 'bg-spk-blue/5 text-black/80 border border-spk-blue/15 font-medium'
      }`}
    >
      {label}
    </div>
  );
}
