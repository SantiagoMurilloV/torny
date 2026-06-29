import { describe, it, expect } from 'vitest';
import { buildBalancedPools } from './secondary-phase.service';

/**
 * Build the standings map the way generateBalancedPoolsForCategory does:
 *   primaryGroup → (position → teamId)
 * Team IDs are encoded as "<groupLetter><position>" so assertions read
 * naturally — e.g. "A1" is the 1st-place team of group A.
 */
function makeMap(groups: string[], positions: number): Map<string, Map<number, string>> {
  const cat = 'Cat';
  const map = new Map<string, Map<number, string>>();
  for (const g of groups) {
    const inner = new Map<number, string>();
    for (let p = 1; p <= positions; p++) inner.set(p, `${g}${p}`);
    map.set(`${cat}|${g}`, inner);
  }
  return map;
}

const groupNames = (groups: string[]) => groups.map((g) => `Cat|${g}`).sort();

describe('buildBalancedPools', () => {
  it('mixes one team per position from different groups (4 groups × 4 positions)', () => {
    const map = makeMap(['A', 'B', 'C', 'D'], 4);
    const pools = buildBalancedPools(map, groupNames(['A', 'B', 'C', 'D']), 4);

    expect(pools).toHaveLength(4);

    // Exact rotation: pool k draws position p from group (k + p) mod G.
    expect(pools[0].map((t) => t.teamId)).toEqual(['A1', 'B2', 'C3', 'D4']);
    expect(pools[1].map((t) => t.teamId)).toEqual(['B1', 'C2', 'D3', 'A4']);
    expect(pools[2].map((t) => t.teamId)).toEqual(['C1', 'D2', 'A3', 'B4']);
    expect(pools[3].map((t) => t.teamId)).toEqual(['D1', 'A2', 'B3', 'C4']);
  });

  it('gives every pool exactly one of each position and no repeated origin (P ≤ G)', () => {
    const map = makeMap(['A', 'B', 'C', 'D', 'E', 'F'], 4);
    const pools = buildBalancedPools(map, groupNames(['A', 'B', 'C', 'D', 'E', 'F']), 4);

    expect(pools).toHaveLength(6); // one pool per primary group
    for (const pool of pools) {
      expect(pool).toHaveLength(4);
      // One of each finishing position 1..4
      expect(pool.map((t) => t.position).sort()).toEqual([1, 2, 3, 4]);
      // All from distinct primary groups
      const origins = new Set(pool.map((t) => t.primaryGroup));
      expect(origins.size).toBe(4);
    }
    // Every advancing team appears exactly once across all pools.
    const allTeams = pools.flat().map((t) => t.teamId);
    expect(new Set(allTeams).size).toBe(allTeams.length);
    expect(allTeams).toHaveLength(24); // 6 groups × top 4
  });

  it('takes only the requested number of positions (P < group size)', () => {
    const map = makeMap(['A', 'B', 'C', 'D'], 4); // groups have 4 teams each
    const pools = buildBalancedPools(map, groupNames(['A', 'B', 'C', 'D']), 2); // take top 2

    expect(pools).toHaveLength(4);
    for (const pool of pools) {
      expect(pool.map((t) => t.position).sort()).toEqual([1, 2]);
    }
    // 4th-place teams never advance.
    expect(pools.flat().some((t) => t.position > 2)).toBe(false);
  });

  it('skips missing teams when a primary group has fewer teams than positions', () => {
    const map = makeMap(['A', 'B', 'C', 'D'], 4);
    // Group C only finished 3 teams (no 4th place).
    map.get('Cat|C')!.delete(4);
    const pools = buildBalancedPools(map, groupNames(['A', 'B', 'C', 'D']), 4);

    const allTeams = pools.flat().map((t) => t.teamId);
    expect(allTeams).not.toContain('C4');
    // The pool that would have received C4 just has 3 teams.
    expect(allTeams).toHaveLength(15); // 16 - 1 missing
  });

  it('returns no pools when there are no primary groups', () => {
    expect(buildBalancedPools(new Map(), [], 4)).toEqual([]);
  });
});
