import { BracketMatch } from '../../types';
import { FONT, type BracketDims } from './dims';

/**
 * SVG match card — two team slots stacked vertically, live red bar on
 * top for in-progress matches, hairline divider between slots. Pure
 * presentation: no DOM, just <g>/<rect>/<text>.
 */
export function BracketMatchBox({
  x,
  y,
  match,
  label1,
  label2,
  dims,
}: {
  x: number;
  y: number;
  match: BracketMatch;
  label1?: string;
  label2?: string;
  dims: BracketDims;
}) {
  const { MATCH_W, MATCH_H } = dims;
  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';
  const hasWinner = match.winner !== undefined;
  const t1Won = hasWinner && match.winner?.id === match.team1?.id;
  const t2Won = hasWinner && match.winner?.id === match.team2?.id;
  const halfH = MATCH_H / 2;

  const border = isLive ? '#E31E24' : isCompleted ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.10)';

  return (
    <g>
      {/* Shadow */}
      <rect x={x} y={y + 2} width={MATCH_W} height={MATCH_H} rx={6} fill="rgba(0,0,0,0.06)" />
      {/* Card body */}
      <rect
        x={x}
        y={y}
        width={MATCH_W}
        height={MATCH_H}
        rx={6}
        fill="white"
        stroke={border}
        strokeWidth={isLive ? 2 : 1.5}
      />
      {/* Live red top bar with pulse */}
      {isLive && (
        <rect x={x} y={y} width={MATCH_W} height={4} fill="#E31E24">
          <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
        </rect>
      )}
      {/* Divider between slots */}
      <line
        x1={x}
        y1={y + halfH}
        x2={x + MATCH_W}
        y2={y + halfH}
        stroke="rgba(0,0,0,0.06)"
        strokeWidth={1}
      />

      <BracketTeamSlot
        x={x}
        y={y}
        team={match.team1}
        score={match.score?.team1}
        isWinner={t1Won}
        isLoser={isCompleted && !t1Won && hasWinner}
        label={label1}
        dims={dims}
      />
      <BracketTeamSlot
        x={x}
        y={y + halfH}
        team={match.team2}
        score={match.score?.team2}
        isWinner={t2Won}
        isLoser={isCompleted && !t2Won && hasWinner}
        label={label2}
        dims={dims}
      />
    </g>
  );
}

function BracketTeamSlot({
  x,
  y,
  team,
  score,
  isWinner,
  isLoser,
  label,
  dims,
}: {
  x: number;
  y: number;
  team?: BracketMatch['team1'];
  score?: number;
  isWinner: boolean;
  isLoser: boolean;
  label?: string;
  dims: BracketDims;
}) {
  const {
    MATCH_W,
    MATCH_H,
    TEAM_COLOR_RAIL_W,
    AVATAR_SIZE,
    TEAM_NAME_FONT,
    TEAM_INITIALS_FONT,
    SCORE_FONT,
    MAX_NAME_CHARS,
  } = dims;
  const halfH = MATCH_H / 2;
  const cy = y + halfH / 2;
  const avatarPadX = TEAM_COLOR_RAIL_W + 10;
  const nameX = avatarPadX + AVATAR_SIZE + 8;
  const scoreRightPad = 10;
  const trophySize = 14;

  // Empty slot — render the placeholder label if any, otherwise "Por definir".
  if (!team) {
    return (
      <g>
        <text
          x={x + 16}
          y={cy}
          dominantBaseline="central"
          className="fill-black/40 font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.04em', fontSize: TEAM_NAME_FONT - 1 }}
        >
          {label || 'Por definir'}
        </text>
      </g>
    );
  }

  const truncatedName =
    team.name.length > MAX_NAME_CHARS ? team.name.slice(0, MAX_NAME_CHARS) + '…' : team.name;

  // Logo support inside the bracket SVG. We can't drop a <TeamAvatar>
  // (DOM div) into an <svg>, so we mirror its rendering rules with SVG
  // primitives: tinted backdrop + the uploaded image clipped to the
  // same rounded square. Per-slot clipPath id derived from absolute
  // coordinates (each slot lives at a unique (x,y) in the SVG) so two
  // different teams' logos don't reuse a clip path. Falls back to the
  // initials chip when no logo is set or while the cache is warming.
  const avatarX = x + avatarPadX;
  const avatarY = cy - AVATAR_SIZE / 2;
  const hasLogo = Boolean(team.logo);
  const clipId = `bracket-logo-clip-${avatarX}-${avatarY}`;

  return (
    <g>
      <rect
        x={x}
        y={y + 2}
        width={TEAM_COLOR_RAIL_W}
        height={halfH - 4}
        fill={team.colors.primary}
      />
      {isWinner && (
        <rect
          x={x + TEAM_COLOR_RAIL_W}
          y={y + 1}
          width={MATCH_W - TEAM_COLOR_RAIL_W - 2}
          height={halfH - 2}
          fill="rgba(227,30,36,0.06)"
        />
      )}
      <rect
        x={avatarX}
        y={avatarY}
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        rx={4}
        fill={team.colors.primary}
      />
      {hasLogo ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect
                x={avatarX}
                y={avatarY}
                width={AVATAR_SIZE}
                height={AVATAR_SIZE}
                rx={4}
              />
            </clipPath>
          </defs>
          <image
            href={team.logo}
            x={avatarX}
            y={avatarY}
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : (
        <text
          x={avatarX + AVATAR_SIZE / 2}
          y={cy + 1}
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-white font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.02em', fontSize: TEAM_INITIALS_FONT }}
        >
          {team.initials}
        </text>
      )}
      <text
        x={x + nameX}
        y={cy - (label ? 6 : 0)}
        dominantBaseline="central"
        className={`font-bold uppercase ${
          isLoser ? 'fill-black/45' : isWinner ? 'fill-black' : 'fill-black/80'
        }`}
        style={{ ...FONT, letterSpacing: '-0.01em', fontSize: TEAM_NAME_FONT }}
      >
        {truncatedName}
      </text>
      {/* Seed badge — shown for resolved teams in the first round so
          the VNL pairing pattern is readable straight off the bracket
          (slot 1 = "1°A", slot 2 = "2°D", etc). The wrapper passes a
          `label` only on the first round; later rounds keep their
          minimal one-line layout. */}
      {label && (
        <text
          x={x + nameX}
          y={cy + 7}
          dominantBaseline="central"
          className="fill-black/45 font-semibold uppercase"
          style={{ ...FONT, letterSpacing: '0.08em', fontSize: TEAM_NAME_FONT - 4 }}
        >
          {label}
        </text>
      )}
      {score !== undefined && (
        <text
          x={x + MATCH_W - scoreRightPad}
          y={cy}
          dominantBaseline="central"
          textAnchor="end"
          className={`font-bold tabular-nums ${
            isWinner ? 'fill-[#E31E24]' : isLoser ? 'fill-black/35' : 'fill-black/80'
          }`}
          style={{ ...FONT, letterSpacing: '-0.02em', fontSize: SCORE_FONT }}
        >
          {score}
        </text>
      )}
      {isWinner && (
        <g transform={`translate(${x + MATCH_W - scoreRightPad - 30}, ${cy - trophySize / 2})`}>
          <path
            d="M6 4h8l-1.3 10.7H7.3L6 4z M9 8h2 M2 6h2 M16 6h2"
            fill="none"
            stroke="#FFB300"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
  );
}
