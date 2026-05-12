import crypto from 'crypto';

/**
 * Server-side counterpart of `src/app/lib/passwordGen.ts`. Same word list +
 * shape so passwords are visually consistent whether they're generated
 * from the admin console (super-admin creating a platform user) or from
 * the backend (team-captain credentials, where the admin clicks a button
 * and the server picks the password).
 *
 * Policy compliance: Word-Word-NNNN always passes password.ts
 * validatePasswordStrength (≥8 chars, ≥1 letter, ≥1 digit).
 *
 * Uses Node's `crypto.randomInt` for unbiased integers (not modulo bias).
 */

const WORDS = [
  'Volei',
  'Spike',
  'Saque',
  'Remate',
  'Bloque',
  'Pase',
  'Match',
  'Rally',
  'Tigre',
  'Puma',
  'Condor',
  'Halcon',
] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[crypto.randomInt(0, arr.length)];
}

function fourDigits(): string {
  // 1000..9999 inclusive → 4 digits, no leading zero.
  return String(crypto.randomInt(1000, 10000));
}

export function generatePassword(): string {
  return `${pick(WORDS)}-${pick(WORDS)}-${fourDigits()}`;
}

/**
 * Human-typable username built from a team's initials + a 4-digit suffix.
 * Example: "TGS" → "tgs-4829". Lowercase so the login flow can be
 * case-insensitive without surprises.
 *
 * Caller is responsible for retrying on collision (UNIQUE constraint on
 * teams.captain_username). With ~9000 suffixes per initials prefix, a
 * few retries covers realistic tenant sizes.
 */
export function generateCaptainUsername(initials: string): string {
  const slug = (initials || 'team')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8) || 'team';
  return `${slug}-${fourDigits()}`;
}

/**
 * Username for a club account (mig 028). Same shape as captain
 * usernames so the login form / DB index treat them uniformly:
 * lowercased ascii slug + 4-digit suffix. Caller normalises the
 * club name first (strips diacritics + extra spaces) and passes the
 * leading word; we slice to 12 chars to leave room for the suffix.
 */
export function generateClubUsername(clubName: string): string {
  const slug = (clubName || 'club')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12) || 'club';
  return `${slug}-${fourDigits()}`;
}
