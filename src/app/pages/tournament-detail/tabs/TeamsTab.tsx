import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Search, Users, X } from 'lucide-react';
import type { StandingsRow, Team } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * "Equipos" tab on the public tournament view. Prefers the standings
 * rows (which carry position + win/loss records) when they exist; falls
 * back to the plain enrolled list otherwise.
 */
export function TeamsTab({
  standings,
  enrolledTeams,
}: {
  standings: StandingsRow[];
  enrolledTeams: Team[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // Category filter. 'all' = no filter; otherwise the exact category
  // string from team.category. The dropdown options are computed
  // from whatever teams are actually present in the active dataset
  // (standings rows or enrolled fallback) so we never offer an
  // empty bucket.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Distinct, non-empty categories present in the source list. Sorted
  // alphabetically so the picker is stable across reloads.
  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    const src = standings.length > 0
      ? standings.map((r) => r.team)
      : enrolledTeams;
    for (const t of src) {
      const c = t.category?.trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' }),
    );
  }, [standings, enrolledTeams]);

  const matchesCategory = (team: Team): boolean => {
    if (categoryFilter === 'all') return true;
    return (team.category ?? '') === categoryFilter;
  };

  const matchesQuery = (name: string): boolean => {
    if (query === '') return true;
    return name.toLowerCase().includes(query.toLowerCase());
  };

  const filteredStandings = useMemo(() => {
    if (standings.length === 0) return [];
    return standings.filter(
      (row) => matchesQuery(row.team.name) && matchesCategory(row.team),
    );
  }, [standings, query, categoryFilter]);

  const filteredEnrolled = useMemo(() => {
    if (standings.length > 0) return [];
    return enrolledTeams.filter(
      (team) => matchesQuery(team.name) && matchesCategory(team),
    );
  }, [enrolledTeams, standings, query, categoryFilter]);

  // Visible count to feed the header pill — uses whichever list is
  // active (standings rows or enrolled fallback) before any filter is
  // applied so the badge always shows the tournament-wide total.
  const totalCount =
    standings.length > 0 ? standings.length : enrolledTeams.length;

  // Show the per-card category badge ONLY when there's no active
  // category filter. Once the admin/visitor narrowed by category the
  // badge would be redundant noise on every card.
  const showCategoryBadge = categoryFilter === 'all';

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header — mirrors the "PROGRAMACIÓN" tab so the two pages feel
          like one design system: icon + uppercase Barlow display + a
          black pill with the total count. Replaces the old jumbo
          search-only header that floated on the page. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-black/60" aria-hidden="true" />
          <h2 className="text-xl font-bold" style={FONT}>
            EQUIPOS
          </h2>
          {totalCount > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-sm bg-black text-white text-xs font-bold tabular-nums"
              style={FONT}
            >
              {totalCount} {totalCount === 1 ? 'equipo' : 'equipos'}
            </span>
          )}
        </div>
        <span className="text-xs text-black/50">
          Tocá un equipo para ver su plantel, fixtures y resultados.
        </span>
      </div>

      {/* Toolbar — search + category filter side by side. On phones
          stack vertically so neither field shrinks past its readable
          minimum; on sm+ split the row so search takes the bulk and
          the categoría dropdown sits on the right. The Select stays
          fixed-width so a long category name doesn't push the input
          around. */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Buscar equipo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar equipo"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none bg-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black rounded-sm"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {categories.length > 0 && (
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger
              className="w-full sm:w-[220px] py-2 text-sm rounded-sm border border-spk-hairline bg-white"
              aria-label="Filtrar por categoría"
            >
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {filteredStandings.length === 0 && filteredEnrolled.length === 0 ? (
        <EmptyState
          icon={<Search className="w-16 h-16 text-black/20 mx-auto mb-6" />}
          title="NO SE ENCONTRARON EQUIPOS"
          subtitle="Intenta con otros términos de búsqueda"
        />
      ) : filteredStandings.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredStandings.map((row, index) => (
            <StandingCard
              key={row.team.id}
              row={row}
              index={index}
              showCategory={showCategoryBadge}
              onClick={() => navigate(`/team/${row.team.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredEnrolled.map((team, index) => (
            <EnrolledCard
              key={team.id}
              team={team}
              index={index}
              showCategory={showCategoryBadge}
              onClick={() => navigate(`/team/${team.id}`)}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function StandingCard({
  row,
  index,
  showCategory,
  onClick,
}: {
  row: StandingsRow;
  index: number;
  /** When true and the team carries a category, paint the category
   *  pill on the top-right corner. Suppressed when the parent has
   *  an active category filter to avoid redundant noise. */
  showCategory: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="group relative transition-all cursor-pointer overflow-hidden"
      style={{
        backgroundColor: row.isQualified ? 'rgba(227, 30, 36, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(0, 0, 0, 0.1)',
      }}
    >
      {showCategory && row.team.category && <CategoryBadge category={row.team.category} />}
      <div className="p-6">
        <div className="flex items-center gap-4 mb-4">
          <TeamAvatar team={row.team} size="lg" className="w-16 h-16 text-2xl" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg mb-1 truncate" style={FONT}>
              {row.team.name}
            </div>
            <div className="text-sm text-black/60">Posición #{row.position}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-black/10">
          <StatCell label="Ganados" value={row.wins} />
          <StatCell label="Perdidos" value={row.losses} />
          <StatCell label="Puntos" value={row.points} />
        </div>
      </div>

      <HoverUnderline />
    </motion.div>
  );
}

function EnrolledCard({
  team,
  index,
  showCategory,
  onClick,
}: {
  team: Team;
  index: number;
  showCategory: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="group relative transition-all cursor-pointer overflow-hidden"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)', border: '1px solid rgba(0, 0, 0, 0.1)' }}
    >
      {showCategory && team.category && <CategoryBadge category={team.category} />}
      <div className="p-6">
        <div className="flex items-center gap-4">
          <TeamAvatar team={team} size="lg" className="w-16 h-16 text-2xl" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg mb-1 truncate" style={FONT}>
              {team.name}
            </div>
            {/* Categoría se muestra arriba como CategoryBadge cuando
                showCategory está activo. La city queda debajo como
                metadato secundario sin pisar el avatar+nombre. */}
            {team.city && <div className="text-xs text-black/40">{team.city}</div>}
          </div>
        </div>
      </div>
      <HoverUnderline />
    </motion.div>
  );
}

/**
 * Compact category pill that sits in the top-right corner of a team
 * card. Same hairline + tabular-numerals language as the rest of the
 * public tournament page; mid-tone amber/gold accent so it reads as
 * "category", not "alert" (red) or "qualified" (red bg).
 */
function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className="absolute top-2 right-2 z-10 inline-flex items-center px-2 py-0.5 rounded-sm bg-black/80 text-white text-[10px] font-bold uppercase tracking-wider max-w-[60%] truncate"
      style={{ ...FONT, letterSpacing: '0.08em' }}
      title={category}
    >
      {category}
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={FONT}>
        {value}
      </div>
      <div className="text-xs text-black/60 uppercase">{label}</div>
    </div>
  );
}

function HoverUnderline() {
  return (
    <motion.div
      className="absolute bottom-0 left-0 right-0 h-1 bg-spk-red"
      initial={{ scaleX: 0 }}
      whileHover={{ scaleX: 1 }}
      transition={{ duration: 0.3 }}
      style={{ originX: 0 }}
    />
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="text-center py-20">
      {icon}
      <h3 className="text-2xl font-bold mb-3" style={FONT}>
        {title}
      </h3>
      <p className="text-black/60">{subtitle}</p>
    </div>
  );
}
