import { Match, Tournament } from '../types';
import { Clock, MapPin, User, ArrowRight, Timer } from 'lucide-react';
import { motion } from 'motion/react';
import { TeamAvatar } from './TeamAvatar';
import { LiveBadge } from './LiveBadge';
import { formatShortDate } from '../lib/format';
import { getMatchDurationMinutes, getMatchEndTime } from '../lib/matchDuration';

interface MatchCardProps {
  match: Match;
  /** `compact` is a 1-line row used in dense lists; `default` is the full card. */
  variant?: 'default' | 'compact';
  onClick?: () => void;
  /** Optional tournament label shown in the footer (e.g. "Copa del Eje · Grupo A"). */
  tournamentLabel?: string;
  /**
   * Tournament whose schedule defaults drive the EXPECTED match
   * duration shown on upcoming / live cards. Optional so legacy
   * callers without the tournament loaded keep working — they just
   * won't see the duration badge for unfinished matches. Completed
   * matches always show the actual `match.duration` regardless.
   */
  tournament?: Pick<
    Tournament,
    'matchDurationMinutes' | 'matchDurationsByCategory'
  >;
}

/**
 * MatchCard — hero card for every matchup in the app.
 *
 * Structure: `header` (status + phase) · `body` (teams + score) · `footer` (meta).
 * On screens <520px the body grid collapses vertically so team names
 * don't get squeezed next to the score — see `.spk-match-*` rules.
 */
export function MatchCard({ match, variant = 'default', onClick, tournamentLabel, tournament }: MatchCardProps) {
  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';
  const isUpcoming = match.status === 'upcoming';
  // Expected duration + end-time string for the badge on
  // upcoming/live cards. Completed cards continue to use the real
  // `match.duration` lower in the footer.
  const expectedDuration = tournament
    ? getMatchDurationMinutes(match, tournament)
    : null;
  const expectedEnd = tournament ? getMatchEndTime(match, tournament) : '';

  if (variant === 'compact') {
    return (
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        className="flex items-center justify-between px-4 py-3 bg-white border border-black/10 rounded-sm hover:border-black/30 transition-all cursor-pointer"
        onClick={onClick}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {/* Date over time — gives the spectator the "when" without
            having to open the full match card. Date stays the smaller
            line so the time keeps visual priority for "today's
            matches" lists where every row's date is the same. */}
        <span
          className="flex flex-col leading-tight min-w-[64px] text-black/60"
          style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
        >
          <span className="text-[10px] uppercase tracking-wide text-black/45">
            {formatShortDate(match.date)}
          </span>
          <span className="text-sm font-bold text-black/80">{match.time}</span>
        </span>
        <div className="flex items-center gap-2 flex-1 mx-4">
          <span className="text-sm truncate">{match.team1.name}</span>
          {match.score && (
            <span className="font-bold text-lg tabular-nums" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {match.score.team1} - {match.score.team2}
            </span>
          )}
          <span className="text-sm truncate">{match.team2.name}</span>
        </div>
        <span className="text-xs text-black/60">{match.court}</span>
      </div>
    );
  }

  // Winner highlighting: losers dim to black/40, winners stay full black.
  const team1Won = isCompleted && match.score && match.score.team1 > match.score.team2;
  const team2Won = isCompleted && match.score && match.score.team2 > match.score.team1;
  const teamOneText = team2Won ? 'text-black/40' : 'text-black';
  const teamTwoText = team1Won ? 'text-black/40' : 'text-black';

  return (
    <motion.div
      layout
      className="relative bg-white overflow-hidden cursor-pointer transition-shadow"
      style={{
        border: isLive ? 'var(--border-live)' : 'var(--border-strong)',
        borderRadius: 'var(--radius-card)',
        boxShadow: isLive ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
      }}
      onClick={onClick}
      whileHover={{ y: -4, boxShadow: 'var(--shadow-elevated)' as unknown as string }}
      transition={{ duration: 0.2 }}
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <div
        className={`spk-match-header ${
          isLive ? 'bg-spk-red' : 'bg-spk-black'
        } text-white`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {isLive && <LiveBadge size="sm" />}
          {!isLive && (
            <span
              className="text-[11px] font-bold uppercase opacity-85"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
            >
              {/* PRÓXIMO line now carries date + time so the spectator
                  doesn't have to drill into the match to see WHEN it
                  is. Format: "PRÓXIMO · 15 abr · 10:00". */}
              {isUpcoming && `PRÓXIMO · ${formatShortDate(match.date)} · ${match.time}`}
              {isCompleted && 'FINALIZADO'}
            </span>
          )}
          <span
            className="text-[11px] opacity-75 inline-flex items-center gap-3"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {match.court}
            </span>
            {/* Date + time cluster for live / completed cards. Upcoming
                cards already show the date in the PRÓXIMO label above
                so we skip them here to avoid duplicating the info. */}
            {!isUpcoming && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {formatShortDate(match.date)} · {match.time}
              </span>
            )}
          </span>
        </div>
        <span
          className="text-[11px] font-bold uppercase opacity-85"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
        >
          <span>{match.phase}</span>
          {match.group && <span className="opacity-60"> · {match.group}</span>}
        </span>
      </div>

      {/* ── Body: grid (home | score | away) on desktop, stacks on mobile ── */}
      <div className="spk-match-body">
        {/* Home */}
        <div className="spk-match-home">
          <TeamAvatar team={match.team1} size="md" />
          <div className="min-w-0">
            <div
              className={`spk-match-team ${teamOneText}`}
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {match.team1.name}
            </div>
            {match.team1.city && (
              <div className="spk-match-players text-black/50">{match.team1.city}</div>
            )}
          </div>
        </div>

        {/* Score */}
        <div className="spk-match-score">
          {isUpcoming && !match.score ? (
            <div className="text-center">
              <div
                className="spk-match-mid text-spk-red tabular-nums"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, lineHeight: 1 }}
              >
                {match.time}
              </div>
              <div
                className="text-[10px] text-black/50 uppercase mt-1"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
              >
                Próximo
              </div>
            </div>
          ) : match.score ? (
            <>
              <div
                className="flex items-baseline gap-3 tabular-nums"
                style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                }}
              >
                <motion.span
                  className={`spk-match-big ${teamOneText}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {match.score.team1}
                </motion.span>
                <span className="spk-match-mid text-black/30">—</span>
                <motion.span
                  className={`spk-match-big ${teamTwoText}`}
                  whileHover={{ scale: 1.05 }}
                >
                  {match.score.team2}
                </motion.span>
              </div>
              {match.sets && match.sets.length > 0 && (
                <div
                  className="text-[11px] text-black/60 uppercase"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.04em' }}
                >
                  Sets{' '}
                  <span className="text-black font-bold">
                    {match.sets.filter((s) => s.team1 > s.team2).length}
                  </span>
                  {' — '}
                  <span className="text-black font-bold">
                    {match.sets.filter((s) => s.team2 > s.team1).length}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div
              className="text-2xl text-black/20 font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              VS
            </div>
          )}
        </div>

        {/* Away */}
        <div className="spk-match-away">
          <div className="min-w-0">
            <div
              className={`spk-match-team ${teamTwoText}`}
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {match.team2.name}
            </div>
            {match.team2.city && (
              <div className="spk-match-players text-black/50">{match.team2.city}</div>
            )}
          </div>
          <TeamAvatar team={match.team2} size="md" />
        </div>
      </div>

      {/* ── Per-set chips (visible on live/completed) ───────── */}
      {match.sets && match.sets.length > 0 && (isCompleted || isLive) && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 justify-center">
          {match.sets.map((set, index) => {
            const team1Won = set.team1 > set.team2;
            const team2Won = set.team2 > set.team1;
            return (
              <div
                key={index}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-bold tabular-nums ${
                  isLive ? 'bg-spk-red/10 text-spk-red' : 'bg-black/5 text-black/70'
                }`}
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                <span className="text-black/40 font-medium">S{index + 1}</span>
                <span className={team1Won ? 'text-black' : 'text-black/40'}>{set.team1}</span>
                <span className="text-black/20">-</span>
                <span className={team2Won ? 'text-black' : 'text-black/40'}>{set.team2}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer: referee, duration, CTA ───────────────────── */}
      <div className="spk-match-footer bg-black/[0.03] border-t border-black/10 text-xs text-black/60">
        <div className="flex items-center gap-3 flex-wrap">
          {match.referee && (
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-medium">{match.referee}</span>
            </span>
          )}
          {isCompleted && match.duration && (
            <span
              className="inline-flex items-center gap-1.5 font-bold bg-black/5 px-2 py-0.5 rounded-sm tabular-nums"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {match.duration} min
            </span>
          )}
          {!isCompleted && expectedDuration && (
            <span
              className="inline-flex items-center gap-1.5 font-bold bg-black/5 px-2 py-0.5 rounded-sm tabular-nums"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              title={
                expectedEnd
                  ? `Duración estimada — termina aprox ${expectedEnd}`
                  : 'Duración estimada del partido'
              }
            >
              <Timer className="w-3 h-3" aria-hidden="true" />
              {expectedDuration}&prime;
              {expectedEnd && (
                <span className="opacity-60 font-normal">→ {expectedEnd}</span>
              )}
            </span>
          )}
          {tournamentLabel && (
            <span
              className="text-[11px] uppercase font-bold text-black/50"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em' }}
            >
              {tournamentLabel}
            </span>
          )}
        </div>
        {onClick && (
          <span
            className="inline-flex items-center gap-1 font-bold uppercase text-black"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em' }}
          >
            Ver partido
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* ── Bottom red pulse bar on live cards ───────────────── */}
      {isLive && (
        <div
          className="absolute left-0 right-0 bottom-0 h-[3px] bg-spk-red spk-live-bar"
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}
