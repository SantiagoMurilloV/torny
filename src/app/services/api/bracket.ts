import { request } from './client';
import type { BracketMatch } from '../../types';
import type { BackendBracketMatch } from './backend-shapes';
import { toFrontendBracketMatch, ensureTeamsCached } from './transformers';

/** Diagnostic snapshot returned by the bracket materializer. */
export interface BracketMaterializeReport {
  totalBracketRows: number;
  slotsWithBothTeamsResolved: number;
  slotsAlreadyMaterialized: number;
  matchesCreated: number;
  matchesUpdated: number;
}

/**
 * Bracket endpoints — editing a single bracket match cascades on the
 * server (winner advancement, placeholder resolution) so the response
 * is the full bracket, not just the row that was edited. The client
 * replaces its bracket slice with the returned list.
 */
export const bracketApi = {
  async updateBracketMatch(
    tournamentId: string,
    matchId: string,
    data: {
      scoreTeam1?: number;
      scoreTeam2?: number;
      status?: string;
      sets?: Array<{ setNumber: number; team1Points: number; team2Points: number }>;
    },
  ): Promise<BracketMatch[]> {
    await ensureTeamsCached();
    const raw = await request<BackendBracketMatch[]>(
      `/tournaments/${tournamentId}/bracket/${matchId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
    );
    return raw.map(toFrontendBracketMatch);
  },

  /** Re-run placeholder resolution over the full bracket plus a
   *  materializer pass so any slot whose two teams are already resolved
   *  produces a playable `matches` row. The response carries diagnostic
   *  counters (totalBracketRows, slotsWithBothTeamsResolved,
   *  slotsAlreadyMaterialized, matchesCreated, matchesUpdated) so the
   *  admin "Recalcular cruces" toast can show what actually happened. */
  async resolveBracket(tournamentId: string): Promise<{
    bracket: BracketMatch[];
    materialize: BracketMaterializeReport | null;
  }> {
    await ensureTeamsCached();
    const raw = await request<{
      bracket: BackendBracketMatch[];
      materialize: BracketMaterializeReport | null;
    }>(
      `/tournaments/${tournamentId}/resolve-bracket`,
      { method: 'POST' },
    );
    return {
      bracket: raw.bracket.map(toFrontendBracketMatch),
      materialize: raw.materialize,
    };
  },

  /** Post-groups crossings — admin defines which group positions meet
   *  in each first-round bracket slot. When `categoryFilter` is set the
   *  backend scopes the DELETE so sibling categories' brackets survive;
   *  when `bracketTier` is set the DELETE narrows further to that tier
   *  (Oro regen leaves Plata intact, and vice-versa). */
  async generateBracketCrossings(
    tournamentId: string,
    seeds: Array<{ position: number; label: string }>,
    options: { categoryFilter?: string; bracketTier?: 'gold' | 'silver' } = {},
  ): Promise<BracketMatch[]> {
    await ensureTeamsCached();
    const raw = await request<{ bracketMatches: BackendBracketMatch[]; generatedAt: string }>(
      `/tournaments/${tournamentId}/generate-bracket-crossings`,
      {
        method: 'POST',
        body: JSON.stringify({
          seeds,
          categoryFilter: options.categoryFilter,
          bracketTier: options.bracketTier,
        }),
      },
    );
    return raw.bracketMatches.map(toFrontendBracketMatch);
  },
};
