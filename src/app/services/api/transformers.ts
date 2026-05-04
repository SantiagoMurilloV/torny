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
    sport: t.sport,
    club: t.club,
    startDate: new Date(t.startDate),
    endDate: new Date(t.endDate),
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
    enrolledCount: t.enrolledCount,
    matchesCount: t.matchesCount,
  };
}

export function toFrontendMatch(m: BackendMatch): Match {
  return {
    id: m.id,
    tournamentId: m.tournamentId,
    team1: resolveTeam(m.team1Id),
    team2: resolveTeam(m.team2Id),
    date: new Date(m.date),
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
