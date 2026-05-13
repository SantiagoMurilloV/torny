import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy } from 'lucide-react';
import type { BracketMatch } from '../../../types';
import { Bracket } from '../../../components/Bracket';
import { LiveBadge } from '../LiveBadge';
import { categoryOfBracketRound } from '../../../lib/phase';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * "Bracket" tab — wraps the shared Bracket visual with an empty state
 * for tournaments that haven't produced one yet, plus the same "En vivo"
 * pill the Clasificación tab uses so spectators can tell the bracket
 * stays in sync with the scoreboard via the polling hook.
 *
 * A category chip strip on top filters the rendered brackets so a
 * spectator can pin the view to a single division — useful on
 * tournaments with 4+ categories where scrolling through every Oro +
 * Plata bracket gets tedious. "Todas" is the default and renders the
 * historical layout (one section per category, two side-by-side
 * sub-brackets when divisions mode is on).
 */
export function BracketTab({
  bracketMatches,
  lastRefreshedAt,
}: {
  bracketMatches: BracketMatch[];
  /** Forwarded from {@link useTournamentData}. Drives the live pill. */
  lastRefreshedAt?: number | null;
}) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of bracketMatches) {
      const c = categoryOfBracketRound(m.round);
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [bracketMatches]);

  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all');

  const visible = useMemo(() => {
    if (categoryFilter === 'all') return bracketMatches;
    return bracketMatches.filter(
      (m) => categoryOfBracketRound(m.round) === categoryFilter,
    );
  }, [bracketMatches, categoryFilter]);

  const hasBracket = bracketMatches.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 sm:space-y-6"
    >
      {/* Toolbar — category dropdown on the left (replacing the pill
          strip that broke into 2-3 rows on phones with many
          divisions), live pill on the right. Hidden entirely while no
          bracket exists since there's nothing to filter. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {hasBracket && categories.length > 1 && (
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as string | 'all')}
            >
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <LiveBadge lastRefreshedAt={lastRefreshedAt} />
      </div>
      {hasBracket ? (
        visible.length > 0 ? (
          <Bracket matches={visible} />
        ) : (
          <div className="text-center py-16 text-black/60 text-sm">
            No hay partidos de cruces en esta categoría todavía.
          </div>
        )
      ) : (
        <div className="text-center py-20">
          <Trophy className="w-16 h-16 text-black/20 mx-auto mb-6" />
          <h3 className="text-2xl font-bold mb-3" style={FONT}>
            SIN CRUCES
          </h3>
          <p className="text-black/60">
            Los cruces se generarán cuando la fase de grupos finalice
          </p>
        </div>
      )}
    </motion.div>
  );
}
