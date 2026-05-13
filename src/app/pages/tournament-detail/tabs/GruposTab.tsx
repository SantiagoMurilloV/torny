import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy } from 'lucide-react';
import type { Match, StandingsRow } from '../../../types';
import { GroupMatrix } from '../../../components/GroupMatrix';
import { StandingsTable } from '../../../components/StandingsTable';
import { categoryOfGroupName } from '../../../lib/phase';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * "Grupos" tab — group matrices per category. Falls back to a flat
 * standings table when the tournament has no group phase, and to an
 * empty state when neither is available yet.
 *
 * Public spectator UX: a category chip strip on top filters the visible
 * groups so a parent of a Benjamín team can pin the view to that
 * category without scrolling past every other division. "Todas" is the
 * default and behaves exactly like the previous flat layout.
 */
export function GruposTab({
  matches,
  standings,
}: {
  matches: Match[];
  standings: StandingsRow[];
}) {
  const groupNames = useMemo(
    () => [...new Set(matches.filter((m) => m.group).map((m) => m.group!))].sort(),
    [matches],
  );
  const hasGroups = groupNames.length > 0;

  // Categories surfaced in the strip — derived from the actual group
  // names so we never offer a chip with no underlying data.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const gn of groupNames) {
      const c = categoryOfGroupName(gn);
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [groupNames]);

  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 sm:space-y-6"
    >
      {/* Category dropdown — only renders when there are 2+ categories
          to choose from, otherwise the page already shows everything
          relevant and the filter is dead weight. Matches the dropdown
          style used in Cruces and Clasificación for consistency. */}
      {hasGroups && categories.length > 1 && (
        <div>
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
        </div>
      )}
      {hasGroups ? (
        <GroupedByCategory
          groupNames={groupNames}
          matches={matches}
          standings={standings}
          categoryFilter={categoryFilter}
        />
      ) : standings.length > 0 ? (
        <StandingsTable standings={standings} groupName="Tabla General" />
      ) : (
        <EmptyGroups />
      )}
    </motion.div>
  );
}

function GroupedByCategory({
  groupNames,
  matches,
  standings,
  categoryFilter,
}: {
  groupNames: string[];
  matches: Match[];
  standings: StandingsRow[];
  categoryFilter: string | 'all';
}) {
  const categoryMap = new Map<string, string[]>();
  for (const gName of groupNames) {
    const category = categoryOfGroupName(gName);
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category)!.push(gName);
  }
  let categories = [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Apply the chip filter before deciding whether to render category
  // headers — when a single category is selected the redundant H2 is
  // dropped because the active chip already tells the spectator which
  // division they're looking at.
  if (categoryFilter !== 'all') {
    categories = categories.filter(([c]) => c === categoryFilter);
  }
  const hasMultipleCategories =
    categoryFilter === 'all' &&
    (categories.length > 1 ||
      (categories.length === 1 && categories[0][0] !== ''));

  if (categories.length === 0) {
    return <EmptyGroups />;
  }

  return (
    <div className="space-y-10">
      {categories.map(([category, catGroupNames]) => (
        <div key={category || '_default'}>
          {hasMultipleCategories && category && (
            <h2
              className="text-2xl font-bold mb-6 pb-3 border-b-2 border-spk-red"
              style={FONT}
            >
              {category.toUpperCase()}
            </h2>
          )}
          <div className="space-y-8">
            {catGroupNames.map((gName) => {
              const groupTeamIds = new Set<string>();
              for (const m of matches) {
                if (m.group === gName) {
                  groupTeamIds.add(m.team1.id);
                  groupTeamIds.add(m.team2.id);
                }
              }
              return (
                <GroupMatrix
                  key={gName}
                  groupName={gName}
                  matches={matches.filter((m) => m.group === gName)}
                  standings={standings.filter((s) => groupTeamIds.has(s.team.id))}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyGroups() {
  return (
    <div className="text-center py-20">
      <Trophy className="w-16 h-16 text-black/20 mx-auto mb-6" />
      <h3 className="text-2xl font-bold mb-3" style={FONT}>
        SIN GRUPOS
      </h3>
      <p className="text-black/60">Los grupos se mostrarán cuando se generen los cruces</p>
    </div>
  );
}
