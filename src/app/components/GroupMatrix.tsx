import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { TeamAvatar } from './TeamAvatar';
import type { Match, StandingsRow, Team } from '../types';

interface GroupMatrixProps {
  groupName: string;
  matches: Match[];
  standings: StandingsRow[];
}

export function GroupMatrix({ groupName, matches, standings }: GroupMatrixProps) {
  // Parse compound group name: "Category|Letter" → show "GRUPO Letter" (category shown by parent)
  const displayGroupName = groupName.includes('|')
    ? groupName.split('|').slice(1).join('|')
    : groupName;

  // Get unique teams from matches, ordered by standings position if available
  const teams = useMemo(() => {
    const teamMap = new Map<string, Team>();
    for (const m of matches) {
      if (!teamMap.has(m.team1.id)) teamMap.set(m.team1.id, m.team1);
      if (!teamMap.has(m.team2.id)) teamMap.set(m.team2.id, m.team2);
    }
    // Order by standings position
    const posMap = new Map(standings.map((s) => [s.team.id, s.position]));
    return Array.from(teamMap.values()).sort(
      (a, b) => (posMap.get(a.id) ?? 99) - (posMap.get(b.id) ?? 99),
    );
  }, [matches, standings]);

  // Build a lookup: "team1Id-team2Id" → Match
  const matchLookup = useMemo(() => {
    const map = new Map<string, Match>();
    for (const m of matches) {
      map.set(`${m.team1.id}-${m.team2.id}`, m);
      map.set(`${m.team2.id}-${m.team1.id}`, m);
    }
    return map;
  }, [matches]);

  const getResult = (rowTeam: Team, colTeam: Team) => {
    const m = matchLookup.get(`${rowTeam.id}-${colTeam.id}`);
    if (!m || !m.score) return null;
    // Return score from row team's perspective
    if (m.team1.id === rowTeam.id) {
      return { row: m.score.team1, col: m.score.team2, rowWon: m.score.team1 > m.score.team2 };
    }
    return { row: m.score.team2, col: m.score.team1, rowWon: m.score.team2 > m.score.team1 };
  };

  const font = { fontFamily: 'Barlow Condensed, sans-serif' };

  return (
    <div className="bg-white border border-black/10 overflow-hidden rounded-sm">
      {/* Group Header */}
      <div className="bg-black text-white px-3 sm:px-6 py-2 sm:py-4 font-bold border-b border-white/10" style={font}>
        <h3 className="text-base sm:text-xl tracking-wider">GRUPO {displayGroupName.toUpperCase()}</h3>
      </div>

      {/* Results Matrix — horizontal scroll on mobile when teams > 3, with a
          sticky team-name column so rows stay readable while scrolling.
          Mobile sizes shrunk one notch (Equipo col 90→72px, team cells
          44→36px, paddings tighter) so a 6-team round-robin fits the
          phone viewport without scrolling and an 8-team one barely
          spills, making the scroll-affordance discoverable. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                className="px-1.5 sm:px-3 py-1.5 sm:py-3 text-left text-[9px] sm:text-xs font-bold text-black/60 uppercase tracking-wider bg-black/5 border-b border-r border-black/10 min-w-[72px] sm:min-w-[140px] md:min-w-[160px] sticky left-0 z-10"
                style={font}
              >
                Equipo
              </th>
              {teams.map((t) => (
                <th
                  key={t.id}
                  className="px-0.5 sm:px-2 py-1.5 sm:py-3 text-center border-b border-r border-black/10 bg-black/5 min-w-[38px] sm:min-w-[56px] md:min-w-[64px]"
                >
                  <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                    <TeamAvatar team={t} size="xs" />
                    <span
                      className="text-[8px] sm:text-[10px] font-bold text-black/60 uppercase leading-tight"
                      style={font}
                    >
                      {t.initials}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((rowTeam) => (
              <tr key={rowTeam.id}>
                <td className="px-1.5 sm:px-3 py-1 sm:py-2 border-b border-r border-black/10 bg-white sticky left-0 z-10">
                  <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                    <TeamAvatar team={rowTeam} size="xs" />
                    <span className="text-[10px] sm:text-sm font-medium truncate max-w-[44px] sm:max-w-[100px] md:max-w-[120px]">
                      {rowTeam.name}
                    </span>
                  </div>
                </td>
                {teams.map((colTeam) => {
                  if (rowTeam.id === colTeam.id) {
                    return (
                      <td
                        key={colTeam.id}
                        className="px-0.5 sm:px-2 py-1 sm:py-2 text-center border-b border-r border-black/10 bg-black/10"
                      />
                    );
                  }
                  const result = getResult(rowTeam, colTeam);
                  return (
                    <td
                      key={colTeam.id}
                      className="px-0.5 sm:px-2 py-1 sm:py-2 text-center border-b border-r border-black/10"
                    >
                      {result ? (
                        <span className="text-[10px] sm:text-sm whitespace-nowrap" style={font}>
                          <span className={result.rowWon ? 'font-bold text-spk-win' : 'text-black/60'}>
                            {result.row}
                          </span>
                          <span className="text-black/30 mx-0.5">-</span>
                          <span className={!result.rowWon ? 'font-bold text-spk-red' : 'text-black/60'}>
                            {result.col}
                          </span>
                        </span>
                      ) : (
                        <span className="text-black/30 text-[10px] sm:text-sm">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Standings Table */}
      {standings.length > 0 && (
        <div className="overflow-x-auto border-t border-black/10">
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-black/5 border-b border-black/10">
              <tr>
                <th className="px-2 md:px-4 py-2 md:py-3 text-left text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider" style={font}>Pos</th>
                <th className="px-2 md:px-4 py-2 md:py-3 text-left text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider" style={font}>Equipo</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider" style={font}>PG</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider" style={font}>PP</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider" style={font}>Pts</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider hidden sm:table-cell" style={font}>SF</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider hidden sm:table-cell" style={font}>SC</th>
                <th className="px-1.5 md:px-3 py-2 md:py-3 text-center text-[10px] md:text-xs font-bold text-black/60 uppercase tracking-wider hidden md:table-cell" style={font}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => {
                // Set quotient (FIVB tiebreaker) = sets_for / sets_against.
                //
                // The literal `∞` we used to render when sets_against = 0
                // looked broken next to the rest of the numeric column.
                // We mirror the convention the rest of the project already
                // uses for ordering — see fixture.service.ts:595 (bracket
                // seeder) and StandingsTab.tsx:303 (public table sort) —
                // which falls back to the numerator when the denominator
                // is zero. In display terms: a sweep-only team (e.g. 8/0)
                // surfaces as "8.00" instead of "∞", which still places
                // them above any finite ratio in the visual scan and
                // keeps the column tabular-aligned.
                //
                // SF = SC = 0 (team yet to play a set) renders as "—"
                // rather than "0.00" because the latter wrongly implies a
                // loss of every set.
                const ratio =
                  row.setsAgainst > 0
                    ? (row.setsFor / row.setsAgainst).toFixed(2)
                    : row.setsFor > 0
                      ? row.setsFor.toFixed(2)
                      : '—';
                return (
                  <tr
                    key={row.team.id}
                    className="border-b border-black/10 hover:bg-black/5 transition-colors"
                    style={{ backgroundColor: row.isQualified ? 'rgba(227, 30, 36, 0.05)' : 'transparent' }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 md:gap-2">
                        <span className="font-bold text-sm md:text-base" style={font}>{row.position}</span>
                        {row.position === 1 && <Trophy className="w-3.5 h-3.5 md:w-4 md:h-4 text-spk-gold" />}
                        {row.position === 2 && <Trophy className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#C0C0C0]" />}
                      </div>
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-3">
                      <div className="flex items-center gap-1.5 md:gap-3">
                        <TeamAvatar team={row.team} size="xs" className="md:w-8 md:h-8" />
                        <span className="font-medium text-xs md:text-sm truncate max-w-[80px] md:max-w-none">{row.team.name}</span>
                      </div>
                    </td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center font-bold text-spk-win" style={font}>{row.wins}</td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center font-bold text-spk-red" style={font}>{row.losses}</td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center font-bold text-base md:text-lg" style={font}>{row.points}</td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center text-black/60 hidden sm:table-cell" style={font}>{row.setsFor}</td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center text-black/60 hidden sm:table-cell" style={font}>{row.setsAgainst}</td>
                    <td className="px-1.5 md:px-3 py-2 md:py-3 text-center text-black/60 hidden md:table-cell" style={font}>{ratio}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
