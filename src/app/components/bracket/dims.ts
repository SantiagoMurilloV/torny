/**
 * Geometry constants for the bracket SVG. Desktop gets the broadcast-
 * scale layout; mobile uses a compressed version so it stays tappable
 * in a phone viewport. The SVG still overflow-x-scrolls on mobile when
 * the round count is high, but each card footprint is ~60% of desktop
 * so 4 rounds fit in ~800 px instead of ~1400 px.
 */
export const DIMENSIONS = {
  desktop: {
    MATCH_W: 280,
    MATCH_H: 96,
    COL_GAP: 72,
    ROW_GAP: 20,
    HEADER_H: 56,
    TEAM_COLOR_RAIL_W: 5,
    AVATAR_SIZE: 28,
    TEAM_NAME_FONT: 15,
    TEAM_INITIALS_FONT: 12,
    SCORE_FONT: 22,
    ROUND_LABEL_FONT: 13,
    ROUND_COUNT_FONT: 10,
    MAX_NAME_CHARS: 22,
  },
  mobile: {
    // Aggressively compact so a 3-round bracket fits in a 360-400px
    // viewport (plus the wrapper escapes the parent's px-6 padding,
    // gaining ~48px more). 4+ rounds still scroll horizontally but
    // each card now occupies ~58% of the previous mobile footprint
    // (200→116 wide, 80→60 tall).
    MATCH_W: 116,
    MATCH_H: 60,
    COL_GAP: 18,
    ROW_GAP: 10,
    HEADER_H: 38,
    TEAM_COLOR_RAIL_W: 3,
    AVATAR_SIZE: 18,
    TEAM_NAME_FONT: 10,
    TEAM_INITIALS_FONT: 8,
    SCORE_FONT: 14,
    ROUND_LABEL_FONT: 9,
    ROUND_COUNT_FONT: 8,
    MAX_NAME_CHARS: 10,
  },
} as const;

export type BracketDims = typeof DIMENSIONS.desktop;

export const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/** Brand colors used by the confetti burst. */
export const BRAND_COLORS = ['#E31E24', '#FFB300', '#FFFFFF', '#003087'];
