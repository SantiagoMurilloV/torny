import { useMemo, useState } from 'react';
import { Calendar, Filter } from 'lucide-react';
import type { Match } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

// Color palette for categories
const CATEGORY_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800', dot: 'bg-blue-500' },
  { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-800', dot: 'bg-red-500' },
  { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800', dot: 'bg-green-500' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800', dot: 'bg-yellow-500' },
];

interface CronogramaTabProps {
  matches: Match[];
}

export function CronogramaTab({ matches }: CronogramaTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Extract categories from group names (format: "Category|Letter")
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of matches) {
      if (m.group) {
        const cat = m.group.includes('|') ? m.group.split('|')[0] : 'General';
        cats.add(cat);
      } else {
        cats.add('General');
      }
    }
    return [...cats].sort();
  }, [matches]);

  // Map category → color
  const categoryColorMap = useMemo(() => {
    const map = new Map<string, typeof CATEGORY_COLORS[0]>();
    categories.forEach((cat, idx) => {
      map.set(cat, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
    });
    return map;
  }, [categories]);

  // Get category for a match
  const getMatchCategory = (m: Match): string => {
    if (m.group) {
      return m.group.includes('|') ? m.group.split('|')[0] : 'General';
    }
    return 'General';
  };

  // Filter matches by selected category
  const filteredMatches = useMemo(() => {
    if (selectedCategory === 'all') return matches;
    return matches.filter((m) => getMatchCategory(m) === selectedCategory);
  }, [matches, selectedCategory]);

  // Group matches by date
  const matchesByDate = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of filteredMatches) {
      const dateStr = m.date instanceof Date
        ? m.date.toISOString().split('T')[0]
        : String(m.date).split('T')[0];
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr)!.push(m);
    }
    // Sort by date
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredMatches]);

  // Format date for display
  const formatDate = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-black/60" />
          <h2 className="text-xl font-bold" style={FONT}>
            CRONOGRAMA
          </h2>
        </div>
        <span className="text-sm text-black/50">
          {filteredMatches.length} partidos
        </span>
      </div>

      {/* Category legend + filter */}
      <div className="bg-white border border-black/10 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-black/50" />
          <span className="text-sm font-bold text-black/70" style={FONT}>
            CATEGORÍAS
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              selectedCategory === 'all'
                ? 'bg-black text-white'
                : 'bg-black/5 text-black/60 hover:bg-black/10'
            }`}
            style={FONT}
          >
            Todas
          </button>
          {categories.map((cat) => {
            const color = categoryColorMap.get(cat)!;
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  isActive
                    ? `${color.bg} ${color.border} ${color.text}`
                    : `bg-white border-black/10 text-black/60 hover:${color.bg}`
                }`}
                style={FONT}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${color.dot}`} />
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule by day */}
      {matchesByDate.length === 0 ? (
        <div className="text-center py-16">
          <Calendar className="w-12 h-12 text-black/20 mx-auto mb-3" />
          <p className="text-black/60 font-medium">No hay partidos programados</p>
        </div>
      ) : (
        <div className="space-y-6">
          {matchesByDate.map(([dateStr, dayMatches]) => (
            <div key={dateStr} className="bg-white border border-black/10 rounded-lg overflow-hidden">
              {/* Day header */}
              <div className="bg-black text-white px-4 py-3">
                <h3 className="text-base font-bold uppercase tracking-wide" style={FONT}>
                  {formatDate(dateStr)}
                </h3>
                <span className="text-xs text-white/60">
                  {dayMatches.length} partidos
                </span>
              </div>

              {/* Matches for this day */}
              <div className="divide-y divide-black/5">
                {dayMatches
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                  .map((m) => {
                    const cat = getMatchCategory(m);
                    const color = categoryColorMap.get(cat) || CATEGORY_COLORS[0];
                    const groupLabel = m.group?.includes('|')
                      ? m.group.split('|').slice(1).join('')
                      : m.group || '';

                    return (
                      <div
                        key={m.id}
                        className={`flex items-center gap-3 px-4 py-2.5 border-l-4 ${color.border}`}
                      >
                        {/* Time */}
                        <div className="w-14 flex-shrink-0 text-center">
                          <span className="text-sm font-bold text-black/80" style={FONT}>
                            {m.time || '—'}
                          </span>
                        </div>

                        {/* Court */}
                        <div className="w-24 flex-shrink-0">
                          <span className="text-[10px] text-black/50 uppercase tracking-wide" style={FONT}>
                            {m.court || 'Sin cancha'}
                          </span>
                        </div>

                        {/* Teams */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <TeamAvatar team={m.team1} size="xs" />
                          <span className="text-xs font-medium truncate max-w-[100px]">
                            {m.team1.name}
                          </span>
                          <span className="text-[10px] text-black/30 font-bold mx-1">vs</span>
                          <span className="text-xs font-medium truncate max-w-[100px]">
                            {m.team2.name}
                          </span>
                          <TeamAvatar team={m.team2} size="xs" />
                        </div>

                        {/* Category + Group badge */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {groupLabel && (
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-bold ${color.bg} ${color.text}`}
                              style={FONT}
                            >
                              {groupLabel}
                            </span>
                          )}
                        </div>

                        {/* Score if completed */}
                        {m.score && (
                          <div className="flex-shrink-0">
                            <span className="text-sm font-bold" style={FONT}>
                              {m.score.team1}-{m.score.team2}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
