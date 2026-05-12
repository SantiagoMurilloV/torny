import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Calendar, Search, Timer, X } from 'lucide-react';
import type { Match, Tournament } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  getMatchDurationMinutes,
  addMinutesToHHMM,
} from '../../../lib/matchDuration';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

// Same palette + index rule as the admin cronograma so a category
// renders in the same colour across both views — visual continuity for
// admins who toggle between pages.
const CATEGORY_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800' },
  { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-800' },
  { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-800' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-800' },
  { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800' },
];

const DEFAULT_DAY_START_MIN = 8 * 60;
const DEFAULT_DAY_END_MIN = 18 * 60;

interface CronogramaTabProps {
  tournament: Tournament;
  matches: Match[];
}

/**
 * Public read-only Cronograma — same grid shape as the admin view but
 * stripped of drag-and-drop, popovers and the unrecoverable-conflict
 * AlertDialog. Spectators land here first when they open a tournament:
 *   · Default day = today if it falls inside the tournament range,
 *     otherwise the tournament's start date. So as the tournament
 *     progresses each day's matches appear automatically.
 *   · Three filters: team search (substring match on either team's
 *     name / initials / city), category, day. They compose freely.
 *   · Cards render in a court × time grid; long matches span N rows
 *     so a 90-min Senior visually occupies double the height of a
 *     45-min Sub-13. Identical algorithm to the admin grid.
 *   · Tap a card → the existing match-detail page (re-uses the same
 *     route the public MatchesTab links to).
 */
export function CronogramaTab({ tournament, matches }: CronogramaTabProps) {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [search, setSearch] = useState('');

  const toIso = (d: Date | string): string => {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    return '';
  };

  // Tournament day range — one entry per calendar day inclusive.
  const days = useMemo<string[]>(() => {
    const start =
      toIso(tournament.startDate) || new Date().toISOString().slice(0, 10);
    const end = toIso(tournament.endDate) || start;
    const out: string[] = [];
    const cursor = new Date(start + 'T12:00:00');
    const endCursor = new Date(end + 'T12:00:00');
    let safety = 0;
    while (cursor.getTime() <= endCursor.getTime() && safety < 200) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }
    return out;
  }, [tournament.startDate, tournament.endDate]);

  // Default-day rule the user asked for: today wins when it falls in
  // the range, otherwise the tournament's first day. Falls forward to
  // any day that has matches when neither today nor the start day do
  // — saves an extra click for spectators looking at archived events.
  useEffect(() => {
    if (selectedDay && days.includes(selectedDay)) return;
    const today = new Date().toISOString().slice(0, 10);
    const startDay = days[0] ?? '';
    const matchDays = new Set(matches.map((m) => toIso(m.date)));
    const fallback =
      (days.includes(today) ? today : null) ??
      (matchDays.has(startDay) ? startDay : null) ??
      days.find((d) => matchDays.has(d)) ??
      startDay;
    if (fallback) setSelectedDay(fallback);
  }, [days, matches, selectedDay]);

  const courts = useMemo<string[]>(() => {
    const list =
      tournament.courts && tournament.courts.length > 0
        ? tournament.courts
        : ['Cancha 1'];
    const set = new Set(list);
    for (const m of matches) {
      if (m.court && !set.has(m.court)) set.add(m.court);
    }
    return [...set];
  }, [tournament.courts, matches]);

  const matchBreak = tournament.matchBreakMinutes ?? 15;
  // Stride = shortest configured category duration. Cards in longer
  // categories span N rows, identical to the admin layout. Falls back
  // to 60 when no overrides exist so the grid stays sensible.
  const durationsByCategory = tournament.matchDurationsByCategory ?? {};
  const overrideValues = Object.values(durationsByCategory).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );
  const minDuration = overrideValues.length > 0 ? Math.min(...overrideValues) : 60;
  const slotStride = Math.max(15, minDuration + matchBreak);

  const parseHHMM = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const [h, m] = raw.split(':').map((n) => Number(n));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
    return h * 60 + m;
  };
  const formatHHMM = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const dailySchedules = tournament.dailySchedules ?? {};

  const times = useMemo<string[]>(() => {
    const set = new Set<string>();
    if (!selectedDay) return ['08:00'];
    const override = dailySchedules[selectedDay];
    const startMin = parseHHMM(override?.start, DEFAULT_DAY_START_MIN);
    const endMin = parseHHMM(override?.end, DEFAULT_DAY_END_MIN);
    for (let m = startMin; m + minDuration <= endMin; m += slotStride) {
      set.add(formatHHMM(m));
    }
    for (const m of matches) {
      if (toIso(m.date) === selectedDay && m.time) set.add(m.time);
    }
    const sorted = [...set].sort();
    return sorted.length > 0 ? sorted : ['08:00'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, dailySchedules, minDuration, slotStride, matches]);

  const getMatchCategory = (m: Match): string => {
    if (m.group) return m.group.includes('|') ? m.group.split('|')[0] : 'General';
    return 'General';
  };

  const categories = useMemo<string[]>(() => {
    const cats = new Set<string>();
    for (const m of matches) cats.add(getMatchCategory(m));
    return [...cats].sort();
  }, [matches]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, typeof CATEGORY_COLORS[0]>();
    categories.forEach((cat, idx) => {
      map.set(cat, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
    });
    return map;
  }, [categories]);

  // Diacritic-stripped lowercase for accent-insensitive search.
  const normalize = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const term = normalize(search.trim());
  const teamMatches = (m: Match): boolean => {
    if (term.length === 0) return true;
    const haystacks = [
      m.team1.name,
      m.team1.initials,
      m.team1.city ?? '',
      m.team2.name,
      m.team2.initials,
      m.team2.city ?? '',
    ];
    return haystacks.some((s) => normalize(s).includes(term));
  };

  // Filtered match list for the active day + category + search. Used
  // to populate the grid AND to drive the "X partidos" counter.
  const visibleMatches = useMemo<Match[]>(() => {
    return matches.filter((m) => {
      if (toIso(m.date) !== selectedDay) return false;
      if (selectedCategory !== 'all' && getMatchCategory(m) !== selectedCategory)
        return false;
      if (!teamMatches(m)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, selectedDay, selectedCategory, term]);

  const matchesByCell = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of visibleMatches) {
      const key = `${m.court}|${m.time}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [visibleMatches]);

  const spanFor = (m: Match): number => {
    const dur = getMatchDurationMinutes(m, tournament);
    return Math.max(1, Math.ceil((dur + matchBreak) / slotStride));
  };

  // Cells covered by a multi-row card (top cell excluded). Skipped at
  // render time so CSS Grid lays out the spanning card correctly.
  //
  // Process matches chronologically and SKIP cascading whenever a
  // match's own top cell is already covered — otherwise back-to-back
  // long matches in the same column (data overlap) would chain covers
  // all the way down, leaving entire rows blank with no card painting
  // over them.
  const coveredCells = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    const timeIndex = new Map<string, number>(times.map((t, i) => [t, i]));
    const sortedByTime = [...visibleMatches].sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? ''),
    );
    for (const m of sortedByTime) {
      const topKey = `${m.court}|${m.time}`;
      if (out.has(topKey)) continue;
      const topIdx = timeIndex.get(m.time);
      if (topIdx === undefined) continue;
      const span = spanFor(m);
      for (let i = 1; i < span; i++) {
        const t = times[topIdx + i];
        if (!t) break;
        out.add(`${m.court}|${t}`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMatches, times]);

  const formatDayLabel = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const isFiltering =
    term.length > 0 || selectedCategory !== 'all';
  const matchCount = visibleMatches.length;

  return (
    <div className="space-y-4">
      {/* Header + counter — the counter sits inline with the toolbar
          so the spectator sees "12 partidos" right next to the day
          picker without scrolling. Hidden when the day has zero
          matches (the empty-state below explains that case better). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-black/60" aria-hidden="true" />
          <h2 className="text-xl font-bold" style={FONT}>
            CRONOGRAMA
          </h2>
          {matchCount > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-sm bg-black text-white text-xs font-bold tabular-nums"
              style={FONT}
              title={
                isFiltering
                  ? 'Coincidencias del filtro activo'
                  : 'Partidos programados ese día'
              }
            >
              {matchCount} {matchCount === 1 ? 'partido' : 'partidos'}
            </span>
          )}
        </div>
        <span className="text-xs text-black/50">
          Mirá los partidos por día y cancha. Buscá tu equipo o filtrá por
          categoría.
        </span>
      </div>

      {/* Filters — three controls in one row, wraps to two rows on
          narrow screens. Search expands to fill the leftover space so
          spectators on phones can type comfortably. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px] relative">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar equipo…"
            aria-label="Buscar partido por equipo"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none bg-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black rounded-sm"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <Select value={selectedDay} onValueChange={setSelectedDay}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Día" />
          </SelectTrigger>
          <SelectContent>
            {days.map((d) => (
              <SelectItem key={d} value={d}>
                {formatDayLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-[170px]">
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

      {/* Grid — empty cells render as drop-target-style blanks so the
          full court × time matrix is visible (no missing rows). The
          render loop emits a Cell for EVERY (court, time) except those
          covered by a multi-row span above. */}
      <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `60px repeat(${courts.length}, minmax(180px, 1fr))`,
              gridAutoRows: 'minmax(72px, auto)',
            }}
          >
            {/* Top-left empty corner */}
            <div
              className="sticky top-0 left-0 z-20 bg-white border-b border-r border-black/10"
              style={{ gridRow: 1, gridColumn: 1 }}
            />
            {/* Court headers — bigger + centered + thin white divider
                between adjacent columns so each cancha reads as its own
                lane. */}
            {courts.map((court, colIdx) => (
              <div
                key={court}
                className={`sticky top-0 z-10 bg-black text-white px-4 py-3 border-b border-black/10 flex items-center justify-center text-center ${
                  colIdx > 0 ? 'border-l border-white/10' : ''
                }`}
                style={{ gridRow: 1, gridColumn: colIdx + 2 }}
              >
                <div
                  className="text-sm sm:text-base font-bold uppercase tracking-wide truncate"
                  style={FONT}
                  title={court}
                >
                  {court}
                </div>
              </div>
            ))}

            {/* Time labels */}
            {times.map((time, rowIdx) => (
              <div
                key={`time-${time}`}
                className="sticky left-0 z-10 bg-white border-b border-r border-black/10 px-2 py-2 text-xs font-bold text-black/70 tabular-nums"
                style={{ gridRow: rowIdx + 2, gridColumn: 1, ...FONT }}
              >
                {time}
              </div>
            ))}

            {/* Cells — one per (court, time) including empty drop targets
                so the visual matrix is complete. Covered cells whose
                area is filled by a spanning card from above are
                skipped UNLESS they have their own match starting there
                (data overlap — two matches scheduled at the same
                court+time). The overlap case must render so the data
                stays visible to spectators; otherwise their team's
                match would be invisible in the grid. */}
            {courts.flatMap((court, colIdx) =>
              times.map((time, rowIdx) => {
                const key = `${court}|${time}`;
                const cellMatches = matchesByCell.get(key) ?? [];
                if (coveredCells.has(key) && cellMatches.length === 0) {
                  return null;
                }
                let span = 1;
                for (const m of cellMatches) {
                  const s = spanFor(m);
                  if (s > span) span = s;
                }
                // Overlap-cell stays span=1 to avoid extending the
                // already-covered gap further.
                if (coveredCells.has(key)) span = 1;
                const maxAvailable = times.length - rowIdx;
                const renderSpan = Math.min(span, maxAvailable);
                const isOverlap = coveredCells.has(key);
                return (
                  <div
                    key={key}
                    className={`border-b border-r border-black/10 p-1.5 ${
                      isOverlap
                        ? 'ring-2 ring-red-500 ring-inset bg-white relative z-10 shadow-md'
                        : ''
                    }`}
                    // Inline minHeight beats the Tailwind arbitrary
                    // class for grid items — turns out CSS Grid doesn't
                    // always honour `min-h-[72px]` when the row track
                    // is auto-sized, leaving cells flat. Inline forces
                    // the grid track floor.
                    style={{
                      gridRow:
                        renderSpan > 1
                          ? `${rowIdx + 2} / span ${renderSpan}`
                          : rowIdx + 2,
                      gridColumn: colIdx + 2,
                      minHeight: 72,
                    }}
                  >
                    {cellMatches.length === 0 ? (
                      // Visible empty-slot placeholder, text-free —
                      // dashed-bordered tinted box that never collapses
                      // (minHeight forced on parent Cell). The grid
                      // always reads as a complete matrix so the
                      // spectator never sees a white void.
                      <div
                        className="h-full w-full rounded-sm border-2 border-dashed border-black/15 bg-black/[0.025]"
                        style={{ minHeight: 60 }}
                        aria-hidden="true"
                      />
                    ) : (
                      <div className="space-y-1 h-full flex flex-col">
                        {cellMatches.map((m) => (
                          <PublicMatchCard
                            key={m.id}
                            match={m}
                            color={
                              categoryColorMap.get(getMatchCategory(m)) ??
                              CATEGORY_COLORS[0]
                            }
                            tournament={tournament}
                            onClick={() => navigate(`/match/${m.id}`)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>

      {matchCount === 0 && (
        <div className="text-center py-10 text-sm text-black/55">
          {isFiltering
            ? 'Ningún partido coincide con el filtro. Probá quitar la búsqueda o cambiar la categoría.'
            : 'Aún no hay partidos programados para este día.'}
        </div>
      )}
    </div>
  );
}

interface PublicMatchCardProps {
  match: Match;
  color: typeof CATEGORY_COLORS[0];
  tournament: Tournament;
  onClick: () => void;
}

/**
 * Read-only card. Same look as the admin's cronograma card but no
 * drag, no day-picker, no in-flight spinner. Renders:
 *   · group label + score (if any)
 *   · both teams (avatar + name)
 *   · duration + end-time badge so "60' → 09:00" is always visible
 *
 * The whole card is clickable so phone users can tap to drill into
 * the match detail page.
 */
function PublicMatchCard({
  match,
  color,
  tournament,
  onClick,
}: PublicMatchCardProps) {
  const groupLabel = match.group?.includes('|')
    ? match.group.split('|').slice(1).join('|')
    : match.group || '';
  const durationMin = getMatchDurationMinutes(match, tournament);
  const endTime = addMinutesToHHMM(match.time ?? '', durationMin);
  const isLive = match.status === 'live';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${color.bg} ${color.border} ${
        isLive ? 'ring-2 ring-spk-red/70' : ''
      } border rounded-md px-2 py-1.5 text-left w-full transition-all hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {groupLabel && (
          <span
            className={`text-[9px] font-bold ${color.text}`}
            style={FONT}
          >
            {groupLabel}
          </span>
        )}
        {isLive && (
          <span
            className="text-[9px] font-bold uppercase text-white bg-spk-red px-1.5 py-0.5 rounded-sm tracking-wider"
            style={FONT}
          >
            En vivo
          </span>
        )}
        {match.score && (
          <span className="ml-auto text-[10px] font-bold tabular-nums text-black/70">
            {match.score.team1}-{match.score.team2}
          </span>
        )}
      </div>
      {/* Teams cluster vertically centered when the card is taller
          than its content (multi-row spans for long categories), so
          the empty area in the middle of a stretched card disappears.
          Footer below sits at the bottom because flex-1 here pushes
          it down. Single-row cards stay compact since flex-1 has no
          extra height to absorb. */}
      <div className="flex-1 flex flex-col justify-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <TeamAvatar team={match.team1} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team1.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TeamAvatar team={match.team2} size="xs" />
          <span className="text-[11px] font-medium text-black/85 truncate flex-1 min-w-0">
            {match.team2.name}
          </span>
        </div>
      </div>
      {(durationMin > 0 || endTime) && (
        <div
          className="pt-1 flex items-center justify-between gap-1 text-[9px] font-bold uppercase tracking-wider text-black/60"
          style={FONT}
        >
          <span className="inline-flex items-center gap-0.5">
            <Timer className="w-2.5 h-2.5" aria-hidden="true" />
            {match.time ?? ''}
            {endTime && ` → ${endTime}`}
          </span>
          <span className="opacity-60 tabular-nums">{durationMin}&prime;</span>
        </div>
      )}
    </button>
  );
}
