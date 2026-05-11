import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Match, Tournament } from '../../../types';
import { MatchCard } from '../../../components/MatchCard';
import {
  categoryOfMatchPhase,
  categoryOfGroupName,
  phaseLabelOnly,
  phaseOrderKey,
  phaseBucket,
  PHASE_BUCKETS,
  PHASE_BUCKET_LABELS,
  type PhaseBucket,
} from '../../../lib/phase';
import { CategoryFilterBar } from '../CategoryFilterBar';

/**
 * Resolve the category of a match across the two encoding shapes the
 * codebase has accumulated:
 *
 *   1. New bracket-stage matches set `phase = "<round>|<category>"`,
 *      e.g. "Cuartos · Oro|Infantil Femenino".
 *   2. Round-robin matches set `phase = "grupos"` (no category) and
 *      keep the category inside `group_name = "<category>|<letter>"`,
 *      e.g. "Infantil Femenino|A".
 *
 * Old `categoryOfMatchPhase("grupos")` returned the whole string as a
 * (bogus) category, which is why the public MatchesTab rendered a
 * spurious "GRUPOS" category header alongside the real divisions.
 */
function resolveCategory(match: Match): string {
  if (match.group) {
    const fromGroup = categoryOfGroupName(match.group);
    if (fromGroup) return fromGroup;
  }
  if (match.phase && match.phase.includes('|')) {
    return categoryOfMatchPhase(match.phase);
  }
  return '';
}

/**
 * Display label for the phase sub-header. Normalizes the legacy
 * lowercase values that the round-robin generator persists ("grupos",
 * "liga") into the same casing used everywhere else in the UI.
 */
function resolvePhaseLabel(match: Match): string {
  const raw = phaseLabelOnly(match.phase ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'grupos') return 'Fase de grupos';
  if (lower === 'liga') return 'Liga';
  return raw || 'Sin fase';
}

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Public "Partidos" tab.
 *
 * Layout:
 *   · Search by team name + filter pills:
 *       - one pill per category (extracted from the matches in scope)
 *       - five fixed phase pills: Grupos / Cuartos / Semifinal / Final
 *         / Tercer puesto. Each phase pill collapses tier variants
 *         (Oro / Plata) so a single "Cuartos" click matches both.
 *   · Live strip on top (every live match across categories) so the
 *     spectator notices a match in progress without scrolling.
 *   · When no filter is active, categories render as collapsible
 *     accordions (closed by default after the first one) so the page
 *     stays compact on tournaments with many divisions. Inside each
 *     category, phase sub-headers preserve the tournament progression.
 */
export function MatchesTab({
  matches,
  tournament,
}: {
  matches: Match[];
  /** Drives the expected-duration badge on each MatchCard. Optional so
   *  the tab still renders before the tournament loads. */
  tournament?: Tournament;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseBucket | 'all'>('all');

  // Categories that exist in the data — drives the dropdown on top.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      const c = resolveCategory(m);
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [matches]);

  const filtered = useMemo(
    () =>
      matches.filter((m) => {
        const q = query.toLowerCase();
        const matchesSearch =
          q === '' ||
          m.team1.name.toLowerCase().includes(q) ||
          m.team2.name.toLowerCase().includes(q);
        const cat = resolveCategory(m);
        const matchesCategory = categoryFilter === 'all' || cat === categoryFilter;
        const bucket = phaseBucket(m.phase);
        const matchesPhase = phaseFilter === 'all' || bucket === phaseFilter;
        return matchesSearch && matchesCategory && matchesPhase;
      }),
    [matches, query, categoryFilter, phaseFilter],
  );

  const live = useMemo(() => filtered.filter((m) => m.status === 'live'), [filtered]);
  const grouped = useMemo(() => groupByCategoryThenPhase(filtered), [filtered]);

  const hasActiveFilters =
    query !== '' || categoryFilter !== 'all' || phaseFilter !== 'all';
  const clear = () => {
    setQuery('');
    setCategoryFilter('all');
    setPhaseFilter('all');
  };

  const go = (id: string) => navigate(`/match/${id}`);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 sm:space-y-8"
    >
      <div className="space-y-3 sm:space-y-4">
        {/* Search — compact on mobile, expanded on desktop. */}
        <div className="relative w-full sm:max-w-xl">
          <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-black/40" />
          <input
            type="text"
            placeholder="Buscar por equipo..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 sm:pl-11 pr-3 sm:pr-4 py-2.5 sm:py-3 bg-black/5 border border-black/10 rounded-sm text-sm sm:text-base focus:outline-none focus:border-black/40 transition-colors placeholder:text-black/40"
          />
        </div>

        {/* Phase pills — 5 fixed buckets covering tournament progression. */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <PhasePill
            active={phaseFilter === 'all'}
            onClick={() => setPhaseFilter('all')}
            label="Todas las fases"
          />
          {PHASE_BUCKETS.map((b) => (
            <PhasePill
              key={b}
              active={phaseFilter === b}
              onClick={() => setPhaseFilter(b)}
              label={PHASE_BUCKET_LABELS[b]}
            />
          ))}
        </div>

        {/* Category pills — dynamic, hidden when there's only one. */}
        <CategoryFilterBar
          categories={categories}
          value={categoryFilter}
          onChange={setCategoryFilter}
        />

        {hasActiveFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center justify-between gap-3 px-3 py-2 bg-black/5 rounded-sm"
          >
            <p className="text-xs text-black/60">
              Mostrando <span className="font-bold text-black">{filtered.length}</span> de{' '}
              {matches.length} partidos
            </p>
            <button
              onClick={clear}
              className="flex items-center gap-1 px-2 py-1 bg-spk-red text-white rounded-sm text-[10px] font-bold uppercase tracking-wider"
              style={FONT}
            >
              <X className="w-3 h-3" />
              Limpiar
            </button>
          </motion.div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-black/20 mx-auto mb-4" />
          <h3 className="text-lg sm:text-xl font-bold mb-2" style={FONT}>
            NO SE ENCONTRARON PARTIDOS
          </h3>
          <p className="text-sm text-black/60">Intenta con otros filtros</p>
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          {live.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-black/10">
                <motion.div
                  className="w-2 h-2 bg-spk-red rounded-full"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <h3
                  className="text-xs font-bold uppercase text-spk-red tracking-wider"
                  style={FONT}
                >
                  En vivo
                </h3>
                <span className="text-[11px] text-black/40 tabular-nums">
                  ({live.length})
                </span>
              </div>
              <div className="space-y-2">
                {live.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    onClick={() => go(m.id)}
                    tournament={tournament}
                  />
                ))}
              </div>
            </section>
          )}

          {grouped.map(({ category, phases, total }, idx) => (
            <CategoryAccordion
              key={category || '_uncat'}
              category={category}
              phases={phases}
              total={total}
              defaultOpen={hasActiveFilters || idx === 0}
              expandPhases={hasActiveFilters}
              onMatchClick={go}
              tournament={tournament}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Pills ──────────────────────────────────────────────────────────

function PhasePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-sm text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
        active ? 'bg-spk-red text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
      }`}
      style={FONT}
    >
      {label}
    </motion.button>
  );
}

// ── Accordion + grouping ───────────────────────────────────────────

interface PhaseSection {
  phase: string;
  matches: Match[];
}

interface CategoryGroup {
  category: string;
  phases: PhaseSection[];
  total: number;
}

function CategoryAccordion({
  category,
  phases,
  total,
  defaultOpen,
  expandPhases,
  onMatchClick,
  tournament,
}: {
  category: string;
  phases: PhaseSection[];
  total: number;
  defaultOpen: boolean;
  /** When true, phase sub-sections also start expanded — used while a
   *  filter is active so the result is visible without extra clicks. */
  expandPhases: boolean;
  onMatchClick: (id: string) => void;
  tournament?: Tournament;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 pb-2 border-b-2 border-spk-red text-left transition-opacity hover:opacity-80"
      >
        <h2
          className="text-base sm:text-lg font-bold uppercase truncate"
          style={{ ...FONT, letterSpacing: '0.04em' }}
        >
          {category || 'Sin categoría'}
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-black/40 tabular-nums">{total}</span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-black/50"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-4">
              {phases.map(({ phase, matches: phaseMatches }) => (
                <PhaseAccordion
                  key={phase}
                  phase={phase}
                  matches={phaseMatches}
                  defaultOpen={expandPhases}
                  onClick={onMatchClick}
                  tournament={tournament}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function PhaseAccordion({
  phase,
  matches,
  defaultOpen,
  onClick,
  tournament,
}: {
  phase: string;
  matches: Match[];
  defaultOpen: boolean;
  onClick: (id: string) => void;
  tournament?: Tournament;
}) {
  // Phase sub-sections start collapsed by default when no filter is
  // active — opening a category already shows everything, and keeping
  // each phase closed avoids the "wall of cards" feeling on a
  // tournament with many divisions. Under an active filter we open
  // them so the result is visible without extra clicks.
  const [open, setOpen] = useState(defaultOpen);
  if (matches.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-2 border-b border-black/10 text-left transition-colors hover:bg-black/[0.02]"
      >
        <span
          className="text-[11px] sm:text-xs font-bold uppercase text-black/70 tracking-[0.14em]"
          style={FONT}
        >
          {phase}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] sm:text-[11px] text-black/40 tabular-nums">
            {matches.length}
          </span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-black/40"
          >
            <ChevronDown className="w-3 h-3" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-3">
              {matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  onClick={() => onClick(m.id)}
                  tournament={tournament}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Two-level grouping: category (h2) → phase (h3 inside). Phases are
 * ordered using {@link phaseOrderKey} so the public list reads like a
 * tournament timeline. Live matches are intentionally excluded — the
 * page renders them in their own "EN VIVO" section above this one.
 */
function groupByCategoryThenPhase(matches: Match[]): CategoryGroup[] {
  const map = new Map<string, Map<string, Match[]>>();
  for (const m of matches) {
    if (m.status === 'live') continue;
    const category = resolveCategory(m);
    const phaseLabel = resolvePhaseLabel(m);
    if (!map.has(category)) map.set(category, new Map());
    const phaseMap = map.get(category)!;
    if (!phaseMap.has(phaseLabel)) phaseMap.set(phaseLabel, []);
    phaseMap.get(phaseLabel)!.push(m);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, phaseMap]) => {
      const phases = [...phaseMap.entries()]
        .sort(([a], [b]) => {
          // phaseOrderKey expects a "phase|category" string — wrapping
          // with a trailing pipe is enough for the lookup; both legacy
          // ("Grupos", "Liga") and bracket variants map to fixed keys,
          // and unknown labels fall to the bottom.
          const ka = phaseOrderKey(`${a}|`);
          const kb = phaseOrderKey(`${b}|`);
          if (ka !== kb) return ka - kb;
          return a.localeCompare(b);
        })
        .map(([phase, ms]) => ({ phase, matches: sortMatchesForPhase(ms) }));
      const total = phases.reduce((acc, p) => acc + p.matches.length, 0);
      return { category, phases, total };
    });
}

function sortMatchesForPhase(matches: Match[]): Match[] {
  const ranked = (m: Match) => (m.status === 'upcoming' ? 0 : 1);
  return [...matches].sort((a, b) => {
    const ra = ranked(a);
    const rb = ranked(b);
    if (ra !== rb) return ra - rb;
    const ta = a.date.getTime();
    const tb = b.date.getTime();
    if (ta !== tb) return ta - tb;
    return (a.time ?? '').localeCompare(b.time ?? '');
  });
}
