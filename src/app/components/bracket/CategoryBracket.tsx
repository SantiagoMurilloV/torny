import { useMemo } from 'react';
import { Award, Medal } from 'lucide-react';
import type { BracketMatch } from '../../types';
import type { BracketTier } from '../../lib/phase';
import { FONT, type BracketDims } from './dims';
import { BracketMatchBox } from './BracketMatchBox';
import { ThirdPlaceCard } from './ThirdPlaceCard';
import {
  parseRound,
  formatBracketPlaceholder,
  generateSeedLabels,
} from './helpers';
import { bracketSeedOrder } from '../../lib/autoBracketSeeds';

/**
 * Single-category bracket. Renders the knockout rounds as SVG columns
 * with Bezier connectors, plus an optional 3rd-place card at the
 * bottom when the tournament includes one.
 *
 * Category-level header (the big red-underlined `<h2>`) is owned by
 * the wrapper (`Bracket.tsx` for public, `BracketView` for admin) so
 * multi-tier divisions (Oro + Plata within one category) share a
 * single heading above the two sub-brackets.
 */
export function CategoryBracket({
  category,
  bracketMatches,
  dims,
  tier = null,
  seedOffset = 0,
}: {
  category: string;
  bracketMatches: BracketMatch[];
  dims: BracketDims;
  /** When set, a smaller "Oro"/"Plata" sub-header appears above the
   *  bracket SVG with a medal icon in the tier's color. */
  tier?: BracketTier | null;
  /** First-round seed badges shift by this amount so Plata reads as
   *  the continuation of Oro in the overall ranking (e.g. with 8 Oro
   *  classifiers, Plata labels #1-#8 become #9-#16). Owned by the
   *  parent (`Bracket.tsx`) since only it knows how many classifiers
   *  the upstream tier consumed. */
  seedOffset?: number;
}) {
  const { MATCH_W, MATCH_H, COL_GAP, ROW_GAP, HEADER_H } = dims;
  const ROUND_W = MATCH_W + COL_GAP;

  const standard = bracketMatches.filter((m) => !parseRound(m.round).name.includes('tercer'));
  const thirdPlace = bracketMatches.find((m) => parseRound(m.round).name.includes('tercer'));

  const bracketRounds = useMemo(() => {
    const names = [...new Set(standard.map((m) => m.round))];
    return names
      .map((r) => ({
        round: r,
        label: parseRound(r).name,
        // Sort by `position` so the bracket always renders the seeds in
        // VNL order from top to bottom — pos 1 (seeds 1 vs 8), pos 2
        // (4 vs 5), pos 3 (2 vs 7), pos 4 (3 vs 6). The fixture
        // generator already persists positions in this order, but the
        // SQL `ORDER BY round, position` lexicographically can drift
        // for two-digit positions; an explicit numeric sort keeps the
        // visual order stable for any size bracket.
        matches: standard
          .filter((m) => m.round === r)
          .sort((a, b) => a.position - b.position),
      }))
      .sort((a, b) => b.matches.length - a.matches.length);
  }, [standard]);

  if (bracketRounds.length === 0) return null;

  // Vertical space driven by the first round (most matches).
  const firstRoundCount = bracketRounds[0]?.matches.length ?? 1;
  const contentH = firstRoundCount * (MATCH_H + ROW_GAP);
  const totalH = HEADER_H + contentH + 24;
  const totalW = bracketRounds.length * ROUND_W + 40;

  const tierLabel =
    tier === 'gold' ? 'División Oro' : tier === 'silver' ? 'División Plata' : null;
  const TierIcon = tier === 'gold' ? Award : tier === 'silver' ? Medal : null;
  const tierColor =
    tier === 'gold' ? 'text-amber-500' : tier === 'silver' ? 'text-slate-400' : '';

  return (
    <div>
      {tierLabel && TierIcon && (
        <h3
          className={`flex items-center gap-2 text-lg sm:text-xl font-bold mb-3 uppercase ${tierColor}`}
          style={{ ...FONT, letterSpacing: '0.04em' }}
        >
          <TierIcon className="w-5 h-5" />
          {tierLabel}
        </h3>
      )}

      <div
        // Edge-to-edge on mobile (-mx-6 escapes the parent's px-6
        // padding from TournamentDetail, gaining ~48px of horizontal
        // breathing room so a 3-round bracket fits without scroll).
        // Desktop keeps the bordered card with its own gutter.
        className="overflow-x-auto pb-4 sm:pb-6 rounded-none sm:rounded-sm -mx-6 sm:mx-0 border-y sm:border border-black/10"
        style={{
          background: 'linear-gradient(180deg, #F8F9FB 0%, #FFFFFF 100%)',
        }}
      >
        <div style={{ minWidth: totalW, width: totalW }}>
          <svg
            width={totalW}
            height={totalH}
            className="block"
            role="img"
            aria-label={category ? `Cruces de ${category}` : 'Cruces del torneo'}
          >
            {/* Connectors — drawn BEFORE boxes so they sit behind */}
            {bracketRounds.map((round, rIdx) => {
              if (rIdx >= bracketRounds.length - 1) return null;
              return (
                <RoundConnectors
                  key={`connectors-${round.round}`}
                  roundIdx={rIdx}
                  round={round}
                  nextRound={bracketRounds[rIdx + 1]}
                  contentH={contentH}
                  dims={dims}
                  roundW={ROUND_W}
                />
              );
            })}

            {/* Match boxes */}
            {bracketRounds.map((round, rIdx) => (
              <RoundColumn
                key={round.round}
                round={round}
                roundIdx={rIdx}
                totalRounds={bracketRounds.length}
                contentH={contentH}
                dims={dims}
                roundW={ROUND_W}
                seedOffset={seedOffset}
              />
            ))}
          </svg>

          {/* 3rd-place mini bracket — aligned under the final column so
              it reads as a small satellite of the finals row instead of
              drifting far below to the left. Uses the compact variant of
              ThirdPlaceCard to fit neatly in one match-width slot. */}
          {thirdPlace && (
            <div
              style={{
                paddingLeft: (bracketRounds.length - 1) * ROUND_W + 20,
                paddingRight: 20,
                marginTop: -4,
              }}
            >
              <div style={{ width: MATCH_W }}>
                <div
                  className="text-[10px] font-bold uppercase text-black/45 mb-1.5 text-center"
                  style={{ ...FONT, letterSpacing: '0.18em' }}
                >
                  3er Puesto
                </div>
                <ThirdPlaceCard match={thirdPlace} compact />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Round = { round: string; label: string; matches: BracketMatch[] };

function RoundConnectors({
  roundIdx,
  round,
  nextRound,
  contentH,
  dims,
  roundW,
}: {
  roundIdx: number;
  round: Round;
  nextRound: Round;
  contentH: number;
  dims: BracketDims;
  roundW: number;
}) {
  const { MATCH_W, COL_GAP, HEADER_H } = dims;
  const matchCount = round.matches.length;
  const slotH = matchCount > 0 ? contentH / matchCount : contentH;
  const nextMatchCount = nextRound.matches.length;
  const nextSlotH = nextMatchCount > 0 ? contentH / nextMatchCount : contentH;
  const x = roundIdx * roundW + 20;

  return (
    <g>
      {round.matches.map((match, mIdx) => {
        if (mIdx % 2 !== 0) return null;
        const pairIdx = Math.floor(mIdx / 2);
        if (mIdx + 1 >= matchCount) return null;

        const topCY = HEADER_H + slotH * mIdx + slotH / 2;
        const botCY = HEADER_H + slotH * (mIdx + 1) + slotH / 2;
        const nextCY = HEADER_H + nextSlotH * pairIdx + nextSlotH / 2;

        const startX = x + MATCH_W;
        const endX = x + MATCH_W + COL_GAP;
        const midX = (startX + endX) / 2;

        const topPath = `M ${startX} ${topCY} C ${midX} ${topCY}, ${midX} ${nextCY}, ${endX} ${nextCY}`;
        const botPath = `M ${startX} ${botCY} C ${midX} ${botCY}, ${midX} ${nextCY}, ${endX} ${nextCY}`;

        const stroke =
          match.status === 'completed' && match.winner
            ? 'rgba(15,15,20,0.24)'
            : 'rgba(15,15,20,0.14)';

        return (
          <g key={`c-${match.id}`}>
            <path d={topPath} fill="none" stroke={stroke} strokeWidth={1.5} />
            <path d={botPath} fill="none" stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}

function RoundColumn({
  round,
  roundIdx,
  totalRounds,
  contentH,
  dims,
  roundW,
  seedOffset,
}: {
  round: Round;
  roundIdx: number;
  totalRounds: number;
  contentH: number;
  dims: BracketDims;
  roundW: number;
  seedOffset: number;
}) {
  const { MATCH_W, MATCH_H, HEADER_H } = dims;
  const matchCount = round.matches.length;
  const slotH = matchCount > 0 ? contentH / matchCount : contentH;
  const x = roundIdx * roundW + 20;
  const isFinal = roundIdx === totalRounds - 1;

  return (
    <g>
      <rect
        x={x}
        y={8}
        width={MATCH_W}
        height={32}
        fill={isFinal ? '#E31E24' : '#0F0F14'}
        rx={4}
      />
      <text
        x={x + MATCH_W / 2}
        y={28}
        textAnchor="middle"
        className="fill-white font-bold uppercase"
        style={{ ...FONT, letterSpacing: '0.16em', fontSize: dims.ROUND_LABEL_FONT }}
      >
        {round.label.toUpperCase()}
      </text>

      {round.matches.map((match, mIdx) => {
        const centerY = HEADER_H + slotH * mIdx + slotH / 2;
        const y = centerY - MATCH_H / 2;
        const { label1, label2 } = resolveLabels(
          match,
          roundIdx,
          mIdx,
          matchCount,
          seedOffset,
        );

        return (
          <BracketMatchBox
            key={match.id}
            x={x}
            y={y}
            match={match}
            label1={label1}
            label2={label2}
            dims={dims}
          />
        );
      })}
    </g>
  );
}

/**
 * Label cascade for a bracket slot:
 *   1. First round of a tiered (gold / silver) bracket → seed badge
 *      "#N" computed from the slot's vertical position. Tiered brackets
 *      use cumulative cross-group VNL seeding, so seed 1 = best record
 *      across all groups regardless of group letter.
 *   2. First round with a `team*_placeholder` (legacy / manual mode) →
 *      formatted "1°A" / "2°D" placeholder.
 *   3. Later rounds with no team → fall back to the placeholder if
 *      present (rare — usually those slots fill via advanceWinner).
 *   4. First round with neither team nor placeholder → auto-seed
 *      fallback so a brand-new bracket still shows what *will* go in
 *      each slot.
 */
function resolveLabels(
  match: BracketMatch,
  roundIdx: number,
  mIdx: number,
  matchCount: number,
  seedOffset = 0,
): { label1?: string; label2?: string } {
  let label1: string | undefined;
  let label2: string | undefined;

  const { tier } = parseRound(match.round);
  const isTieredFirstRound = roundIdx === 0 && tier !== null;

  if (isTieredFirstRound) {
    // VNL seed badge: each slot's position in the bracket maps to a
    // VNL seed via the recursive [1,8,4,5,2,7,3,6,…] order. Seed 1 is
    // the best cumulative classifier in the division (see server
    // resolveBracketFromStandings). `seedOffset` shifts the badge so
    // Plata reads as positions (Oro count + 1) … (Oro + Plata) of the
    // overall ranking instead of restarting at #1.
    const totalSlots = matchCount * 2;
    const order = totalSlots >= 2 ? bracketSeedOrder(totalSlots) : [];
    const seed1 = order[mIdx * 2];
    const seed2 = order[mIdx * 2 + 1];
    if (seed1) label1 = `#${seed1 + seedOffset}`;
    if (seed2) label2 = `#${seed2 + seedOffset}`;
  } else if (roundIdx === 0) {
    // Manual / non-tiered first round: show the placeholder mapping
    // ("1°A", "2°D") so the admin sees which group position lands in
    // each slot.
    if (match.team1Placeholder) {
      label1 = formatBracketPlaceholder(match.team1Placeholder);
    }
    if (match.team2Placeholder) {
      label2 = formatBracketPlaceholder(match.team2Placeholder);
    }
  } else {
    if (!match.team1 && match.team1Placeholder) {
      label1 = formatBracketPlaceholder(match.team1Placeholder);
    }
    if (!match.team2 && match.team2Placeholder) {
      label2 = formatBracketPlaceholder(match.team2Placeholder);
    }
  }

  if (
    roundIdx === 0 &&
    !match.team1 &&
    !match.team2 &&
    !label1 &&
    !label2
  ) {
    const allGroups: string[] = [];
    for (let gi = 0; gi < Math.max(2, matchCount); gi++) {
      allGroups.push(String.fromCharCode(65 + gi));
    }
    const seeds = generateSeedLabels(allGroups);
    if (seeds[mIdx]) {
      label1 = seeds[mIdx][0];
      label2 = seeds[mIdx][1];
    }
  }

  return { label1, label2 };
}
