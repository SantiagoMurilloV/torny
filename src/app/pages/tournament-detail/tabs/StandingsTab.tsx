import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Award, BarChart3, Medal, Trophy } from 'lucide-react';
import type { Match, StandingsRow, Team, Tournament } from '../../../types';
import { StandingsTable } from '../../../components/StandingsTable';
import { TeamAvatar } from '../../../components/TeamAvatar';
import { categoryOfGroupName, groupLetter } from '../../../lib/phase';
import { LiveBadge } from '../LiveBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

type BracketMode = NonNullable<Tournament['bracketMode']>;
type DivisionBucket = 'gold' | 'silver' | 'out';

/** Group placement → division bucket. Always 1°/2° → Oro, 3°/4° → Plata,
 *  5°+ → fuera de divisiones. Matches what the auto-bracket seeder
 *  takes from each group. */
function divisionBucket(groupPosition: number): DivisionBucket {
  if (groupPosition <= 2) return 'gold';
  if (groupPosition <= 4) return 'silver';
  return 'out';
}

const BUCKET_ORDER: Record<DivisionBucket, number> = { gold: 0, silver: 1, out: 2 };

/** Row consumed by {@link CategoryStandingsTable}. Keeps the original
 *  group position for sorting + display while exposing a recomputed
 *  `globalPosition` for the ranking column. Rally counters
 *  (`pointsFor` / `pointsAgainst`) are the raw point totals scored
 *  across every set of every group-phase match — a standard volleyball
 *  column independent of the match-points (`points`) used for
 *  classification. */
interface CategoryRankedRow {
  globalPosition: number;
  groupLetter: string;
  groupPosition: number;
  team: Team;
  played: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  /** Raw rally points scored. */
  pointsFor: number;
  /** Raw rally points conceded. */
  pointsAgainst: number;
  /** Match / classification points (3 / 2 / 1 / 0 per result). */
  points: number;
  isQualified?: boolean;
  /** Only meaningful in division-mode tournaments. Drives both the
   *  primary sort bucket and the row tint (oro / plata / sin tinte). */
  divisionBucket: DivisionBucket;
}

const MEDAL_BACKGROUNDS = [
  'linear-gradient(to right, rgba(255, 179, 0, 0.18), rgba(255, 179, 0, 0) 35%)',
  'linear-gradient(to right, rgba(192, 192, 192, 0.22), rgba(192, 192, 192, 0) 35%)',
  'linear-gradient(to right, rgba(205, 127, 50, 0.18), rgba(205, 127, 50, 0) 35%)',
];

const MEDAL_COLORS = ['#FFB300', '#C0C0C0', '#CD7F32'];

/** Warm-yellow fill used for rows that classified to the bracket on
 *  manual-mode tournaments. */
const QUALIFIED_ROW_BG =
  'linear-gradient(to right, rgba(253, 216, 53, 0.42), rgba(253, 216, 53, 0.12) 70%)';

/** Backgrounds for division-mode tournaments — Oro and Plata classifiers
 *  paint with the medal tint of their tier so the cutoff between the
 *  two divisions reads at a glance. The "out" bucket stays plain so the
 *  contrast lands on the rows that actually advanced. */
const GOLD_ROW_BG =
  'linear-gradient(to right, rgba(255, 179, 0, 0.34), rgba(255, 179, 0, 0.08) 70%)';
const SILVER_ROW_BG =
  'linear-gradient(to right, rgba(192, 192, 192, 0.34), rgba(192, 192, 192, 0.08) 70%)';

const GOLD_COLOR = '#B7791F';
const SILVER_COLOR = '#6B7280';

/**
 * "Tabla de clasificación" tab — public-facing overall standings view.
 *
 * Behaviour swings on `bracketMode`:
 *
 *   · `'divisions'` → primary sort bucket is the division (Oro 1°/2°,
 *     Plata 3°/4°, fuera 5°+). Rows paint with the bucket's medal
 *     tint so spectators see the cutoff between divisions live.
 *   · anything else → flat global leaderboard sorted by classif points
 *     and the standard FIVB tiebreakers.
 *
 * Within each bucket the order still cascades classif → set diff →
 * rally ratio → sets-for → wins so live score updates reshuffle teams
 * inside their division.
 */
export function StandingsTab({
  matches,
  standings,
  bracketMode,
  lastRefreshedAt,
}: {
  matches: Match[];
  standings: StandingsRow[];
  /** Tournament's `bracketMode`. When undefined, behaves like
   *  `'manual'` — flat global leaderboard. */
  bracketMode?: BracketMode;
  /** Epoch-ms of the last successful poll in the parent hook. Drives
   *  the live badge at the top of the tab so spectators know the
   *  table auto-syncs with the scoreboard. */
  lastRefreshedAt?: number | null;
}) {
  const groupNames = useMemo(
    () => [...new Set(matches.filter((m) => m.group).map((m) => m.group!))].sort(),
    [matches],
  );
  const hasGroups = groupNames.length > 0;
  const mode: BracketMode = bracketMode ?? 'manual';

  // Categories surfaced in the chip strip — derived from the actual
  // group names so we never offer a chip with no underlying data.
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
      {/* Toolbar — single category dropdown on the left (replaces the
          pill strip that wrapped to 2-3 rows on phones with many
          divisions), LiveBadge on the right. The dropdown only shows
          when there's something to filter (2+ categories). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {categories.length > 1 && (
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
      {hasGroups ? (
        <GlobalByCategory
          groupNames={groupNames}
          matches={matches}
          standings={standings}
          bracketMode={mode}
          categoryFilter={categoryFilter}
        />
      ) : standings.length > 0 ? (
        <StandingsTable standings={standings} groupName="Tabla General" />
      ) : (
        <EmptyStandings />
      )}
    </motion.div>
  );
}

function GlobalByCategory({
  groupNames,
  matches,
  standings,
  bracketMode,
  categoryFilter,
}: {
  groupNames: string[];
  matches: Match[];
  standings: StandingsRow[];
  bracketMode: BracketMode;
  categoryFilter: string | 'all';
}) {
  // Map `teamId → groupName` so we can attach the group letter to each
  // ranked row and rebuild per-category rankings below.
  const teamToGroup = new Map<string, string>();
  for (const m of matches) {
    if (!m.group) continue;
    if (!teamToGroup.has(m.team1.id)) teamToGroup.set(m.team1.id, m.group);
    if (!teamToGroup.has(m.team2.id)) teamToGroup.set(m.team2.id, m.group);
  }

  // Aggregate rally points per team across every set of every group-phase
  // match. Only matches with `sets` (live or completed) contribute.
  const rallyByTeam = new Map<string, { for: number; against: number }>();
  for (const m of matches) {
    if (!m.group || !m.sets || m.sets.length === 0) continue;
    const t1 = rallyByTeam.get(m.team1.id) ?? { for: 0, against: 0 };
    const t2 = rallyByTeam.get(m.team2.id) ?? { for: 0, against: 0 };
    for (const s of m.sets) {
      t1.for += s.team1;
      t1.against += s.team2;
      t2.for += s.team2;
      t2.against += s.team1;
    }
    rallyByTeam.set(m.team1.id, t1);
    rallyByTeam.set(m.team2.id, t2);
  }

  // Bucket groups by category so multi-category tournaments keep their
  // own red-underlined header + their own overall table.
  const categoryMap = new Map<string, string[]>();
  for (const gName of groupNames) {
    const category = categoryOfGroupName(gName);
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category)!.push(gName);
  }
  let categories = [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Apply chip filter — when a single category is selected the H2 is
  // dropped because the active chip already labels the section.
  if (categoryFilter !== 'all') {
    categories = categories.filter(([c]) => c === categoryFilter);
  }
  const hasMultipleCategories =
    categoryFilter === 'all' &&
    (categories.length > 1 ||
      (categories.length === 1 && categories[0][0] !== ''));

  if (categories.length === 0) {
    return <EmptyStandings />;
  }

  return (
    <div className="space-y-10">
      {categories.map(([category, catGroupNames]) => {
        const catGroupSet = new Set(catGroupNames);
        const catStandings = standings.filter((s) => {
          const gn = teamToGroup.get(s.team.id);
          return gn ? catGroupSet.has(gn) : false;
        });
        const ranked = rankCategory(catStandings, teamToGroup, rallyByTeam, bracketMode);
        if (ranked.length === 0) return null;
        return (
          <div key={category || '_default'}>
            {hasMultipleCategories && category && (
              <h2
                className="text-2xl font-bold mb-6 pb-3 border-b-2 border-spk-red"
                style={FONT}
              >
                {category.toUpperCase()}
              </h2>
            )}
            <CategoryStandingsTable rows={ranked} bracketMode={bracketMode} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Take the per-group standings for a single category and produce a
 * flat, globally-ranked array following the tiebreaker cascade
 * described on the tab docstring.
 */
function rankCategory(
  catStandings: StandingsRow[],
  teamToGroup: Map<string, string>,
  rallyByTeam: Map<string, { for: number; against: number }>,
  bracketMode: BracketMode,
): CategoryRankedRow[] {
  const rows: CategoryRankedRow[] = catStandings.map((s) => {
    const rally = rallyByTeam.get(s.team.id) ?? { for: 0, against: 0 };
    return {
      globalPosition: 0, // assigned after sort
      groupLetter: groupLetter(teamToGroup.get(s.team.id) ?? '') || '—',
      groupPosition: s.position,
      team: s.team,
      played: s.played,
      wins: s.wins,
      losses: s.losses,
      setsFor: s.setsFor,
      setsAgainst: s.setsAgainst,
      pointsFor: rally.for,
      pointsAgainst: rally.against,
      points: s.points,
      isQualified: s.isQualified,
      divisionBucket: divisionBucket(s.position),
    };
  });

  // In division mode the bucket (Oro → Plata → fuera) is the primary
  // sort key, so the table reads top-to-bottom as "who's in Oro, then
  // who's in Plata, then everyone else". Manual mode flattens straight
  // to the performance cascade so a team racking up points climbs
  // across group positions immediately.
  rows.sort((a, b) => {
    if (bracketMode === 'divisions') {
      const ba = BUCKET_ORDER[a.divisionBucket];
      const bb = BUCKET_ORDER[b.divisionBucket];
      if (ba !== bb) return ba - bb;
    }
    if (a.points !== b.points) return b.points - a.points;
    const setDiffA = a.setsFor - a.setsAgainst;
    const setDiffB = b.setsFor - b.setsAgainst;
    if (setDiffA !== setDiffB) return setDiffB - setDiffA;
    // Rally-point ratio (standard FIVB tiebreaker): higher is better.
    const ratioA = a.pointsAgainst === 0 ? a.pointsFor : a.pointsFor / a.pointsAgainst;
    const ratioB = b.pointsAgainst === 0 ? b.pointsFor : b.pointsFor / b.pointsAgainst;
    if (ratioA !== ratioB) return ratioB - ratioA;
    if (a.setsFor !== b.setsFor) return b.setsFor - a.setsFor;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.groupPosition !== b.groupPosition) return a.groupPosition - b.groupPosition;
    return a.team.name.localeCompare(b.team.name);
  });

  for (let i = 0; i < rows.length; i++) rows[i].globalPosition = i + 1;
  return rows;
}

/**
 * Flat category-wide standings table. The category title already lives
 * in the red-underlined `<h2>` above so the table itself starts straight
 * at the column header — no redundant title bar.
 *
 * Row tinting depends on `bracketMode`:
 *   · `'divisions'` → Oro classifiers (1°/2°) paint amber, Plata
 *     classifiers (3°/4°) paint slate, fuera-de-división stays plain.
 *   · `'manual'`    → keeps the legacy yellow `isQualified` highlight
 *     plus the gold/silver/bronze podium tints on the top three.
 */
function CategoryStandingsTable({
  rows,
  bracketMode,
}: {
  rows: CategoryRankedRow[];
  bracketMode: BracketMode;
}) {
  const isDivisions = bracketMode === 'divisions';
  return (
    <div
      // Centered + bounded width on desktop so the table doesn't stretch
      // edge-to-edge on a 4K monitor (the column data is sparse). On
      // mobile takes the full container so the inner scroller can
      // pan a wider table layout horizontally.
      className="bg-white overflow-hidden mx-auto w-full max-w-3xl"
      style={{
        border: 'var(--border-strong)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      {/* Inner wrapper. On mobile we drop the `min-w-[…]` and the
          x-overflow so the table fits the viewport edge-to-edge with
          no horizontal scroll — the column anchos are aggressively
          shrunk below and "Pts" (rally points) is hidden because it's
          redundant with Sets for the spectator quick-look. Desktop
          keeps the original spacious layout. */}
      <div className="max-h-[75vh] overflow-y-auto sm:overflow-x-auto">
        <table className="w-full table-fixed">
          <thead
            className="sticky top-0 z-10 bg-black text-white"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            <tr className="text-[9px] sm:text-xs uppercase">
              <th className="px-1 sm:px-3 py-1.5 sm:py-3 text-left font-bold w-7 sm:w-12">#</th>
              <th className="px-1 sm:px-3 py-1.5 sm:py-3 text-left font-bold">Equipo</th>
              <th
                className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-center font-bold w-9 sm:w-14"
                title="Grupo"
              >
                Grp
              </th>
              <th
                className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-right font-bold w-6 sm:w-10"
                title="Partidos jugados"
              >
                PJ
              </th>
              <th
                className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-right font-bold w-6 sm:w-10"
                title="Partidos ganados"
              >
                PG
              </th>
              <th
                className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-right font-bold w-6 sm:w-10"
                title="Partidos perdidos"
              >
                PP
              </th>
              <th
                className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-right font-bold w-10 sm:w-16"
                title="Sets ganados / perdidos"
              >
                Sets
              </th>
              <th
                className="hidden sm:table-cell px-1 sm:px-2 py-1.5 sm:py-3 text-right font-bold sm:w-20"
                title="Puntos a favor / en contra sumados en todos los sets"
              >
                Pts
              </th>
              <th
                className="px-1 sm:px-3 py-1.5 sm:py-3 text-right font-bold w-9 sm:w-14"
                title="Puntos de clasificación"
              >
                Cls
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const isPodium = !isDivisions && index < 3;
              const medalBg = isPodium ? MEDAL_BACKGROUNDS[index] : undefined;
              const medalColor = isPodium ? MEDAL_COLORS[index] : undefined;

              // Pick the row tint:
              //   · Division mode → tint by Oro / Plata bucket.
              //   · Manual mode → keep the legacy "isQualified" yellow
              //     highlight, falling back to the medal tint on the
              //     top three when groups haven't fully closed yet.
              let rowBg: string | undefined;
              let leftStripe = 'transparent';
              let positionColor = medalColor ?? 'rgba(0,0,0,0.6)';
              if (isDivisions) {
                if (row.divisionBucket === 'gold') {
                  rowBg = GOLD_ROW_BG;
                  leftStripe = GOLD_COLOR;
                  positionColor = GOLD_COLOR;
                } else if (row.divisionBucket === 'silver') {
                  rowBg = SILVER_ROW_BG;
                  leftStripe = SILVER_COLOR;
                  positionColor = SILVER_COLOR;
                }
              } else if (row.isQualified) {
                rowBg = QUALIFIED_ROW_BG;
                leftStripe = '#FBC02D';
              } else if (medalBg) {
                rowBg = medalBg;
              }

              return (
                <motion.tr
                  key={row.team.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    layout: { type: 'spring', stiffness: 320, damping: 32 },
                    default: { delay: index * 0.035, duration: 0.25 },
                  }}
                  className="group relative transition-colors"
                  style={{
                    borderBottom: 'var(--border-hairline)',
                    background: rowBg,
                    borderLeft: `3px solid ${leftStripe}`,
                  }}
                >
                  <td className="px-1 sm:px-3 py-1.5 sm:py-2.5">
                    <div className="flex items-center gap-0.5 sm:gap-1.5">
                      <span
                        className="font-bold text-xs sm:text-base tabular-nums"
                        style={{ ...FONT, color: positionColor }}
                      >
                        {row.globalPosition}
                      </span>
                      {/* Medal icon hidden on mobile to save horizontal
                          room — the position color still encodes the
                          division/podium tier. */}
                      {isDivisions && row.divisionBucket === 'gold' && (
                        <Award
                          className="hidden sm:block w-4 h-4 flex-shrink-0"
                          style={{ color: GOLD_COLOR }}
                          aria-hidden="true"
                        />
                      )}
                      {isDivisions && row.divisionBucket === 'silver' && (
                        <Medal
                          className="hidden sm:block w-4 h-4 flex-shrink-0"
                          style={{ color: SILVER_COLOR }}
                          aria-hidden="true"
                        />
                      )}
                      {!isDivisions && isPodium && (
                        <Trophy
                          className="hidden sm:block w-4 h-4 flex-shrink-0"
                          style={{ color: medalColor }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-1 sm:px-3 py-1.5 sm:py-2.5">
                    <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                      <TeamAvatar team={row.team} size="xs" />
                      <span
                        className="font-bold text-[10px] sm:text-sm uppercase truncate min-w-0"
                        style={{ ...FONT, letterSpacing: '0.01em' }}
                        title={row.team.name}
                      >
                        {row.team.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-0.5 sm:px-2 py-1.5 sm:py-2.5 text-center">
                    <span
                      className="inline-flex items-center justify-center px-0.5 sm:px-1.5 h-5 sm:h-6 rounded-sm bg-black/5 text-[9px] sm:text-xs font-bold text-black/70 tabular-nums"
                      style={FONT}
                      title={`Grupo ${row.groupLetter} · ${row.groupPosition}° de su grupo`}
                    >
                      {row.groupLetter}
                      <span className="text-black/40 ml-0.5">·{row.groupPosition}</span>
                    </span>
                  </td>
                  <td className="px-0.5 sm:px-2 py-1.5 sm:py-2.5 text-right text-[10px] sm:text-sm tabular-nums text-black/70">
                    {row.played}
                  </td>
                  <td
                    className="px-0.5 sm:px-2 py-1.5 sm:py-2.5 text-right text-[10px] sm:text-sm font-bold tabular-nums"
                    style={{ color: 'var(--feedback-win)' }}
                  >
                    {row.wins}
                  </td>
                  <td className="px-0.5 sm:px-2 py-1.5 sm:py-2.5 text-right text-[10px] sm:text-sm tabular-nums text-black/50">
                    {row.losses}
                  </td>
                  <td className="px-0.5 sm:px-2 py-1.5 sm:py-2.5 text-right text-[9px] sm:text-xs tabular-nums text-black/60">
                    {row.setsFor}/{row.setsAgainst}
                  </td>
                  <td
                    className="hidden sm:table-cell px-1 sm:px-2 py-1.5 sm:py-2.5 text-right text-[11px] sm:text-xs tabular-nums text-black/60"
                    title="Puntos a favor / en contra en todos los sets"
                  >
                    {row.pointsFor}/{row.pointsAgainst}
                  </td>
                  <td
                    className="px-1 sm:px-3 py-1.5 sm:py-2.5 text-right font-bold text-sm sm:text-xl tabular-nums"
                    style={{ ...FONT, color: '#0F0F14' }}
                  >
                    {row.points}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 bg-black/[0.03] border-t border-black/10">
        <div
          className="flex flex-wrap gap-4 text-[11px] text-black/60 uppercase"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          {isDivisions ? (
            <>
              <div className="flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" style={{ color: GOLD_COLOR }} aria-hidden="true" />
                <span className="font-bold">Clasifica a Oro (1° y 2°)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Medal
                  className="w-3.5 h-3.5"
                  style={{ color: SILVER_COLOR }}
                  aria-hidden="true"
                />
                <span className="font-bold">Clasifica a Plata (3° y 4°)</span>
              </div>
              <div className="text-black/50 font-medium">
                Orden: división → clasif → dif. sets → razón de puntos
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ background: '#FBC02D' }}
                  aria-hidden="true"
                />
                <span className="font-bold">Clasificado a cruces</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-spk-gold" aria-hidden="true" />
                <span className="font-bold">Podio</span>
              </div>
              <div className="text-black/50 font-medium">
                Orden: clasif → dif. sets → razón de puntos → sets a favor
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyStandings() {
  return (
    <div className="text-center py-20">
      <BarChart3 className="w-16 h-16 text-black/20 mx-auto mb-6" />
      <h3 className="text-2xl font-bold mb-3" style={FONT}>
        SIN CLASIFICACIÓN
      </h3>
      <p className="text-black/60">
        La tabla de clasificación aparecerá cuando se generen los cruces
      </p>
    </div>
  );
}
