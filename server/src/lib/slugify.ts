/**
 * URL slug helpers used to build the public per-tournament inscription
 * link `/torneo/:slug/inscripcion`. Kept here (not in tournament.service)
 * so the same algorithm is available to anything else that ever needs a
 * human-readable URL fragment (e.g. team vanity URLs, future blog posts).
 *
 * Convention: lower-case + ASCII-only + dash-separated. Accents are
 * stripped with NFD normalization so "Copa Espíritu Joven" → "copa-
 * espiritu-joven" instead of the regex producing "copa-esp-ritu-joven"
 * via Postgres' accent-naïve `regexp_replace`. The DB-side backfill (see
 * migration 029) uses the simpler Postgres-only flavor for legacy rows;
 * new tournaments go through here.
 */

const NON_ALNUM = /[^a-z0-9]+/g;
const TRIM_DASH = /(^-+|-+$)/g;

/**
 * Convert an arbitrary tournament name to a URL-safe slug.
 *
 * The output is empty when the input has no usable characters
 * (whitespace-only, all punctuation, etc) — callers fall back to a
 * randomly generated suffix in that pathological case so the slug
 * column never lands on `''`.
 */
export function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(NON_ALNUM, '-')
    .replace(TRIM_DASH, '');
}

/**
 * 5-char base36 suffix used to disambiguate slugs whose base form
 * collides with an existing tournament. `crypto.randomInt` is overkill
 * for the entropy we actually need (just "different from the row that
 * collided"), but it dedupes the dependency on Math.random() across the
 * server. The suffix space (≈60M) is huge relative to any realistic
 * number of collisions per base slug.
 */
function suffix(): string {
  const n = Math.floor(Math.random() * 60_466_176); // 36^5
  return n.toString(36).padStart(5, '0');
}

/**
 * Generate a unique slug for a tournament name. Tries the bare
 * `slugify(name)` first; on UNIQUE collision the caller catches the
 * 23505 and asks `nextCandidate()` for a fresh suffix.
 *
 * Splitting "first try" from "retry" keeps tournament URLs clean for
 * the 99% case (single admin, distinct names) — we only pollute the
 * URL with random characters when there's an actual conflict.
 */
export function buildTournamentSlug(name: string): string {
  const base = slugify(name);
  if (!base) return suffix(); // pathological: name is all punctuation
  return base;
}

/**
 * Fresh candidate when the previous insert hit a UNIQUE collision.
 * Stable base + random suffix so successive retries never repeat the
 * same string within a transaction.
 */
export function nextSlugCandidate(name: string): string {
  const base = slugify(name);
  return `${base || 'torneo'}-${suffix()}`;
}
