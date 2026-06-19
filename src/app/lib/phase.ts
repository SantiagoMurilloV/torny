/**
 * Phase / group / bracket round names carry the category as a pipe-
 * delimited segment, but each field uses a DIFFERENT order. These
 * helpers hide the ordering so UI code doesn't have to remember which
 * segment is which. Always prefer these over ad-hoc `.split('|')`.
 *
 *   · match.phase       → "Grupos|Juvenil Femenino"          (phase|category)
 *   · match.group       → "Juvenil Femenino|A"               (category|letter)
 *   · bracketMatch.round→ "Mayores Masculino|semifinal"      (category|round)
 */

export const CATEGORY_SEP = '|';

function firstSegment(s: string): string {
  if (!s.includes(CATEGORY_SEP)) return s;
  return s.split(CATEGORY_SEP)[0];
}

function afterFirstSegment(s: string): string {
  if (!s.includes(CATEGORY_SEP)) return '';
  return s.split(CATEGORY_SEP).slice(1).join(CATEGORY_SEP);
}

// ── match.phase ("phase|category") ────────────────────────────────

/** Extract the category from `match.phase`. Falls back to the whole
 *  string when there's no separator (legacy single-category data). */
export function categoryOfMatchPhase(phase: string): string {
  if (!phase.includes(CATEGORY_SEP)) return phase;
  return afterFirstSegment(phase).trim();
}

/**
 * Resolve the category of a match in a single call, consulting both
 * `match.group` ("Cat|A") and `match.phase` ("Grupos|Cat") since
 * different match types fill different fields:
 *   · group-stage matches always have `group`.
 *   · bracket matches usually only have `phase`.
 *   · single-category legacy matches may have neither separator.
 *
 * Returns '' when no category can be derived so callers can decide
 * whether to fall back to a global default or a "General" bucket.
 */
export function categoryOfMatch(
  m: { group?: string; phase?: string },
): string {
  const g = m.group ?? '';
  if (g.includes(CATEGORY_SEP)) return firstSegment(g).trim();
  const p = m.phase ?? '';
  if (p.includes(CATEGORY_SEP)) return afterFirstSegment(p).trim();
  return '';
}

// ── match.group ("category|letter") ───────────────────────────────

/** Category segment of a group name. Empty when there's no separator. */
export function categoryOfGroupName(groupName: string): string {
  if (!groupName.includes(CATEGORY_SEP)) return '';
  return firstSegment(groupName);
}

/** Group letter (A, B, C…) of a group name. */
export function groupLetter(groupName: string): string {
  if (!groupName.includes(CATEGORY_SEP)) return groupName;
  return afterFirstSegment(groupName);
}

// ── bracketMatch.round ("category|round" or "category|tier|round") ─

/**
 * Bracket-division tier. `null` → ordinary single-bracket. When the
 * tournament uses the "División Oro + Plata" mode each bracket_matches
 * row carries the tier in its `round` as a middle segment
 * ("Category|gold|final").
 */
export type BracketTier = 'gold' | 'silver';

const TIER_SEGMENTS: readonly BracketTier[] = ['gold', 'silver'];

function isTier(segment: string | undefined): segment is BracketTier {
  return segment === 'gold' || segment === 'silver';
}
void TIER_SEGMENTS;

/** Category segment of a bracket round string — always the first piece. */
export function categoryOfBracketRound(round: string): string {
  if (!round.includes(CATEGORY_SEP)) return '';
  return firstSegment(round);
}

/**
 * Tier of a bracket round string, or `null` when the round was written
 * in the legacy 2-segment form. Pattern matched against the MIDDLE
 * segment so "Category|gold|final" → "gold" but "Category|gold" (a
 * malformed 2-segment with the tier as the round name) stays null.
 */
export function tierOfBracketRound(round: string): BracketTier | null {
  const parts = round.split(CATEGORY_SEP);
  if (parts.length < 3) return null;
  return isTier(parts[1]) ? parts[1] : null;
}

/**
 * Round name (semifinal, final, cuartos…) from a bracket round. Skips
 * the tier segment when present so the downstream UI doesn't have to
 * know whether the round was tiered.
 */
export function bracketRoundName(round: string): string {
  if (!round.includes(CATEGORY_SEP)) return round;
  const parts = round.split(CATEGORY_SEP);
  // With a tier segment: ["Category", "gold", "final"] → take from index 2.
  if (parts.length >= 3 && isTier(parts[1])) {
    return parts.slice(2).join(CATEGORY_SEP);
  }
  // Legacy 2-segment: ["Category", "final"] → everything after first pipe.
  return afterFirstSegment(round);
}

/**
 * Build a bracket round string from its parts. Central so call sites
 * don't reassemble the pipe format by hand.
 */
export function buildBracketRound(
  category: string,
  roundName: string,
  tier?: BracketTier | null,
): string {
  const cat = category ? `${category}${CATEGORY_SEP}` : '';
  if (tier) return `${cat}${tier}${CATEGORY_SEP}${roundName}`;
  return `${cat}${roundName}`;
}

// ── Display ───────────────────────────────────────────────────────

/** Human-readable version of any piped label — pipes become bullets. */
export function humanizePhase(label: string): string {
  return label.replace(new RegExp(`\\${CATEGORY_SEP}`, 'g'), ' · ');
}

// ── Phase sorting (public matches list) ───────────────────────────
//
// Ordered tournament progression so the public MatchesTab can group
// matches inside a category in chronological / playoff order:
//
//   Grupos → Liga → Cuartos → Cuartos · Oro → Cuartos · Plata →
//   Semifinal → … → Final → … → Tercer puesto → …
//
// Anything not in the list falls to the bottom in alphabetical order.
const PHASE_ORDER: Record<string, number> = {
  // Grupos — both raw ("grupos") and normalized labels ("Grupos",
  // "Fase de grupos"). The public MatchesTab now displays "Fase de
  // grupos" via resolvePhaseLabel().
  Grupos: 10,
  grupos: 10,
  'Fase de grupos': 10,
  'Fase de Grupos': 10,
  Liga: 20,
  liga: 20,
  Triangulares: 25,
  'Triangulares Oro': 25,
  'Triangulares Plata': 26,
  'Triangulares · Oro': 25,
  'Triangulares · Plata': 26,
  Cuartos: 30,
  'Cuartos · Oro': 31,
  'Cuartos · Plata': 32,
  Semifinal: 40,
  'Semifinal · Oro': 41,
  'Semifinal · Plata': 42,
  Final: 50,
  'Final · Oro': 51,
  'Final · Plata': 52,
  'Tercer puesto': 60,
  'Tercer puesto · Oro': 61,
  'Tercer puesto · Plata': 62,
};

/** Phase label without the "|category" suffix. */
export function phaseLabelOnly(phase: string): string {
  if (!phase.includes(CATEGORY_SEP)) return phase;
  return firstSegment(phase);
}

/**
 * Sort key for ordering phases within a single category. Smaller is
 * earlier. Unknown labels go after every known label, alphabetically.
 */
export function phaseOrderKey(phase: string): number {
  const label = phaseLabelOnly(phase);
  return PHASE_ORDER[label] ?? 999;
}

// ── Phase filter buckets ──────────────────────────────────────────
//
// The public matches tab exposes a 5-button filter over the entire
// playoff progression. Each button collapses any tier variant
// (Oro / Plata) into the same bucket so the user only thinks about
// "estoy buscando cuartos", regardless of division.

export type PhaseBucket =
  | 'grupos'
  | 'triangulares'
  | 'cuartos'
  | 'semifinal'
  | 'final'
  | 'tercer-puesto';

export const PHASE_BUCKET_LABELS: Record<PhaseBucket, string> = {
  grupos: 'Fase de grupos',
  triangulares: 'Copa Oro / Plata',
  cuartos: 'Cuartos',
  semifinal: 'Semifinal',
  final: 'Final',
  'tercer-puesto': 'Tercer puesto',
};

/** Ordered list for rendering pill buttons left → right. */
export const PHASE_BUCKETS: PhaseBucket[] = [
  'grupos',
  'triangulares',
  'cuartos',
  'semifinal',
  'final',
  'tercer-puesto',
];

/**
 * Match `match.phase` (already without category suffix preferred) to
 * its filter bucket. Returns null when the phase doesn't fit any of
 * the five buckets — those matches are still visible in the "todos"
 * view but don't pile into a button.
 *
 *   · "Grupos" / "grupos" / "Liga" / "liga"      → 'grupos'
 *   · "Cuartos" / "Cuartos · Oro" / "Cuartos · Plata" → 'cuartos'
 *   · idem for Semifinal / Final / Tercer puesto
 */
export function phaseBucket(phase: string): PhaseBucket | null {
  const label = phaseLabelOnly(phase).toLowerCase();
  if (label === 'grupos' || label === 'liga') return 'grupos';
  if (label.startsWith('triangulares')) return 'triangulares';
  if (label.startsWith('cuartos')) return 'cuartos';
  if (label.startsWith('semifinal')) return 'semifinal';
  if (label.startsWith('tercer puesto')) return 'tercer-puesto';
  // "final" matches must be checked AFTER "semifinal" so the prefix
  // doesn't swallow them.
  if (label.startsWith('final')) return 'final';
  return null;
}

// ── Bracket reveal keys ──────────────────────────────────────────
//
// Extended version of phaseBucket that also handles the generic
// "Ronda N" rounds produced by large brackets (16+ teams). These
// keys drive the admin "Descubrir fases" toggle buttons (mig 037).
// Unlike PhaseBucket (a fixed union for the public filter pills),
// reveal keys are plain strings so they can accommodate any number
// of pre-quarterfinal rounds without changing the type.

const RONDA_RE = /^ronda\s*(\d+)/i;

/**
 * Map a phase label to its reveal key. Same logic as `phaseBucket`
 * plus "Ronda 1" → 'ronda-1', "Ronda 2 · Oro" → 'ronda-2', etc.
 * Returns null only for group-phase labels.
 */
export function bracketRevealKey(phase: string): string | null {
  // Try the standard bucket first
  const bucket = phaseBucket(phase);
  if (bucket && bucket !== 'grupos' && bucket !== 'triangulares') return bucket;
  if (bucket === 'grupos' || bucket === 'triangulares') return null;
  // Check for "Ronda N" pattern (with optional tier suffix)
  const label = phaseLabelOnly(phase);
  const m = label.match(RONDA_RE);
  if (m) return `ronda-${m[1]}`;
  return null;
}

/**
 * Human-readable label for a reveal key. Handles both standard
 * buckets ("cuartos" → "Cuartos") and ronda keys ("ronda-1" → "Ronda 1").
 */
export function bracketRevealLabel(key: string): string {
  // Standard bucket labels
  if (key in PHASE_BUCKET_LABELS) return PHASE_BUCKET_LABELS[key as PhaseBucket];
  // Ronda-N pattern
  const m = key.match(/^ronda-(\d+)$/);
  if (m) return `Ronda ${m[1]}`;
  // Fallback: capitalize
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Sort key for reveal buttons. Ronda 1 < Ronda 2 < Cuartos < Semi < Final.
 */
export function bracketRevealOrder(key: string): number {
  const m = key.match(/^ronda-(\d+)$/);
  if (m) return Number(m[1]);           // ronda-1 → 1, ronda-2 → 2
  if (key === 'cuartos') return 100;
  if (key === 'semifinal') return 200;
  if (key === 'final') return 300;
  if (key === 'tercer-puesto') return 400;
  return 999;
}
