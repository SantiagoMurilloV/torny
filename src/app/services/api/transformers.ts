import { request } from './client';
import type { Tournament, Team, Match, StandingsRow, BracketMatch } from '../../types';
import type {
  BackendTeam,
  BackendTournament,
  BackendMatch,
  BackendStandingsRow,
  BackendBracketMatch,
} from './backend-shapes';

/**
 * Convert backend responses into the frontend's camelCased domain
 * types. Lives in one place so changes to the Team / Match / Tournament
 * shape propagate consistently across every resource-module.
 *
 * The teams cache is a small optimisation: match / bracket / standings
 * rows reference teams by id, and the backend sometimes omits the full
 * Team object when the caller already has it (e.g. tournament matches).
 * We keep the last successful `getTeams()` result in memory so we can
 * re-attach the full Team without blocking.
 */

let teamsCache: Map<string, Team> = new Map();

// In-flight fetch shared across concurrent callers so we never hit
// /teams more than once at a time when several getters race to prime
// the cache (matches + bracket + standings firing in parallel).
let inflightTeamsFetch: Promise<void> | null = null;

/** Called by the teams module after a successful /teams fetch so the
 *  match/bracket transformers can attach full Team objects to rows. */
export function updateTeamsCache(teams: Team[]): void {
  teamsCache = new Map(teams.map((t) => [t.id, t]));
}

/**
 * Wipe the cache. Called by DataContext on auth-token changes so a
 * team metadata snapshot from Admin A's session can never bleed into
 * Admin B's match/bracket/standings rendering after a switch.
 *
 * Also resets `inflightTeamsFetch` so the next caller after a clear
 * triggers a fresh `/teams` request instead of awaiting a stale one
 * that was scoped to the previous session.
 */
export function clearTeamsCache(): void {
  teamsCache = new Map();
  inflightTeamsFetch = null;
}

/**
 * Guarantees the teams cache is populated before transformers run.
 *
 * Match/bracket/standings transformers attach full Team objects by id
 * lookup. If the cache is empty when they execute (e.g. a page that
 * fires `Promise.all([getTeams, getMatches])` and `/matches` lands
 * first), every team would render as the placeholder.
 *
 * This helper dedupes concurrent calls — N parallel getters trigger a
 * single `/teams` request and all of them await the same promise.
 *
 * Direct `request<BackendTeam[]>` instead of importing teamsApi to
 * avoid a circular dependency (teams.ts ↔ transformers.ts).
 */
export async function ensureTeamsCached(): Promise<void> {
  if (teamsCache.size > 0) return;
  if (inflightTeamsFetch) return inflightTeamsFetch;

  inflightTeamsFetch = (async () => {
    try {
      const data = await request<BackendTeam[]>('/teams');
      updateTeamsCache(data.map(toFrontendTeam));
    } finally {
      inflightTeamsFetch = null;
    }
  })();

  return inflightTeamsFetch;
}

/**
 * Last-resort placeholder when a team id isn't in the cache (network
 * failure on /teams, or a stale id pointing at a deleted team).
 *
 * Visual goal: blank-but-tidy. We deliberately avoid loud strings like
 * "???" or "Equipo desconocido" because they make the UI look broken
 * to the end-user. An em-dash + soft grey reads as "still loading" and
 * keeps the layout intact.
 *
 * Callers that need to detect this case can check `id === ''` is false
 * AND the team isn't in `teamsCache` — but the rendered output is
 * always safe.
 */
function resolveTeam(id: string): Team {
  const cached = teamsCache.get(id);
  if (cached) return cached;
  return {
    id,
    name: '—',
    initials: '—',
    colors: { primary: '#E5E7EB', secondary: '#F3F4F6' },
  };
}

export function toFrontendTeam(t: BackendTeam): Team {
  return {
    id: t.id,
    name: t.name,
    initials: t.initials,
    logo: t.logo,
    colors: {
      primary: t.primaryColor,
      secondary: t.secondaryColor,
    },
    city: t.city,
    department: t.department,
    category: t.category,
    captainUsername: t.captainUsername ?? undefined,
    credentialsGeneratedAt: t.credentialsGeneratedAt ?? undefined,
  };
}

export function toFrontendTournament(t: BackendTournament): Tournament {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    sport: t.sport,
    club: t.club,
    // Anchor at noon UTC via parseWireDate so tournament dates show
    // identically across timezones (same fix as match dates — see the
    // note on parseWireDate below).
    startDate: parseWireDate(t.startDate),
    endDate: parseWireDate(t.endDate),
    description: t.description ?? '',
    coverImage: t.coverImage,
    logo: t.logo,
    status: t.status,
    teamsCount: t.teamsCount,
    format: t.format,
    courts: t.courts ?? [],
    courtLocations: t.courtLocations ?? {},
    categories: t.categories ?? [],
    ownerId: t.ownerId,
    enrollmentDeadline: t.enrollmentDeadline,
    playersPerTeam: t.playersPerTeam,
    bracketMode: t.bracketMode ?? 'manual',
    goldClassifiersPerGroup: t.goldClassifiersPerGroup,
    silverClassifiersPerGroup: t.silverClassifiersPerGroup,
    regulationText: t.regulationText,
    regulationPdf: t.regulationPdf,
    matchDurationMinutes: t.matchDurationMinutes,
    matchBreakMinutes: t.matchBreakMinutes,
    dailySchedules: t.dailySchedules ?? {},
    // Migration 025 — same empty-fallback pattern so the form fields
    // and scheduler hooks never have to null-check.
    maxMatchesPerDay: t.maxMatchesPerDay ?? 0,
    deadTimeBlocks: t.deadTimeBlocks ?? [],
    categoryPriority: t.categoryPriority ?? [],
    // Migration 026 — undefined when no preference, so the form's
    // <select> can default to "Sin preferencia".
    finalsCourt: t.finalsCourt ?? undefined,
    // Migration 027 — empty-fallback so the form's "duración por
    // categoría" section can iterate without null checks.
    matchDurationsByCategory: t.matchDurationsByCategory ?? {},
    enrolledCount: t.enrolledCount,
    matchesCount: t.matchesCount,
  };
}

/**
 * Parse a 'YYYY-MM-DD' wire date into a JS Date that always represents
 * the calendar day, never drifting across timezone boundaries.
 *
 * The naive `new Date('2026-05-15')` constructor treats the input as
 * UTC midnight. In any timezone west of UTC (Colombia is UTC-5) that's
 * "yesterday" in local time, so a card formatted with date-fns / local
 * helpers shows '14 may' while a `toISOString().split('T')[0]` round-
 * trip in the edit modal still returns '2026-05-15'. The two surfaces
 * disagree by a day, leaving the admin convinced the form is loading
 * "wrong" data.
 *
 * Anchoring at NOON UTC gives a 12-hour cushion in either direction
 * so every IRL timezone interprets the Date as the same calendar day —
 * the card's `formatShortDate` and the modal's `toISOString()` both
 * agree, and downstream consumers (date inputs, sorting) keep working.
 *
 * Falls back to the raw `new Date(...)` path for anything that doesn't
 * look like a bare date so timestamps with explicit timezones (rare but
 * possible for legacy callers) keep their precision.
 */
function parseWireDate(raw: string): Date {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`);
  }
  // Handle ISO datetime strings like "2026-05-15T05:00:00.000Z"
  // Extract just the date part and create at noon local to avoid timezone shift
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const datePart = raw.split('T')[0];
    return new Date(`${datePart}T12:00:00`);
  }
  return new Date(raw);
}

export function toFrontendMatch(m: BackendMatch): Match {
  return {
    id: m.id,
    tournamentId: m.tournamentId,
    team1: resolveTeam(m.team1Id),
    team2: resolveTeam(m.team2Id),
    date: parseWireDate(m.date),
    time: m.time,
    court: m.court,
    referee: m.referee,
    status: m.status,
    score:
      m.scoreTeam1 != null && m.scoreTeam2 != null
        ? { team1: m.scoreTeam1, team2: m.scoreTeam2 }
        : undefined,
    sets: m.sets?.map((s) => ({ team1: s.team1Points, team2: s.team2Points })),
    phase: m.phase,
    group: m.groupName,
    duration: m.duration,
  };
}

export function toFrontendStandingsRow(r: BackendStandingsRow): StandingsRow {
  return {
    position: r.position,
    team: r.team ? toFrontendTeam(r.team) : resolveTeam(r.teamId),
    played: r.played,
    wins: r.wins,
    losses: r.losses,
    setsFor: r.setsFor,
    setsAgainst: r.setsAgainst,
    points: r.points,
    isQualified: r.isQualified,
  };
}

export function toFrontendBracketMatch(b: BackendBracketMatch): BracketMatch {
  const team1 = b.team1
    ? toFrontendTeam(b.team1)
    : b.team1Id
      ? resolveTeam(b.team1Id)
      : undefined;
  const team2 = b.team2
    ? toFrontendTeam(b.team2)
    : b.team2Id
      ? resolveTeam(b.team2Id)
      : undefined;

  const winner = b.winnerId ? resolveTeam(b.winnerId) : undefined;

  return {
    id: b.id,
    team1,
    team2,
    winner,
    score:
      b.scoreTeam1 != null && b.scoreTeam2 != null
        ? { team1: b.scoreTeam1, team2: b.scoreTeam2 }
        : undefined,
    status: b.status,
    round: b.round,
    team1Placeholder: b.team1Placeholder,
    team2Placeholder: b.team2Placeholder,
  };
}
