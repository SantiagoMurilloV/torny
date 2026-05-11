import { describe, it, expect } from 'vitest';
import { calculateMatchTimes } from './schedule';

/**
 * Pure-function tests for the slot scheduler. No DB / no service mocks
 * needed because `calculateMatchTimes` only does in-memory placement.
 *
 * These specifically guard the regressions we've seen recently:
 *   · `||` vs `??` for the numeric knobs (an admin's explicit 0
 *     break must not get coerced to the 15-min default).
 *   · per-category match duration overrides actually shrink/extend
 *     the slot stride per fixture.
 */

const FIXTURES = [
  { team1Id: 't1', team2Id: 't2', phase: 'Sub-13|grupos' },
  { team1Id: 't3', team2Id: 't4', phase: 'Sub-13|grupos' },
  { team1Id: 't1', team2Id: 't3', phase: 'Sub-13|grupos' },
  { team1Id: 't2', team2Id: 't4', phase: 'Sub-13|grupos' },
];

describe('calculateMatchTimes', () => {
  it('honours an explicit zero break (regression: || vs ??)', () => {
    // 4 fixtures, 2 courts, 45-min matches, 0-min break.
    // Slot 1 (8:00) places 2 matches (one per court). Slot 2 should
    // start at 8:45 — NOT 9:00 (which would mean the BE silently
    // added a 15-min default break).
    const slots = calculateMatchTimes(
      FIXTURES,
      '2026-01-01',
      ['Cancha A', 'Cancha B'],
      {
        startTime: '08:00',
        endTime: '18:00',
        matchDuration: 45,
        breakDuration: 0,
        courtCount: 2,
      },
    );
    const times = [...new Set(slots.map((s) => s!.time))].sort();
    expect(times).toEqual(['08:00', '08:45']);
  });

  it('uses 15-min default break only when undefined is passed', () => {
    const slots = calculateMatchTimes(
      FIXTURES,
      '2026-01-01',
      ['Cancha A', 'Cancha B'],
      {
        startTime: '08:00',
        endTime: '18:00',
        matchDuration: 45,
        // breakDuration intentionally omitted → default 15.
        courtCount: 2,
      },
    );
    const times = [...new Set(slots.map((s) => s!.time))].sort();
    expect(times).toEqual(['08:00', '09:00']); // 45 + 15 = 60 stride
  });

  it('advances by the longest placed match duration when categories mix', () => {
    // 2 Sub-13 (45 min) + 2 Senior (90 min). 2 courts.
    // Slot 1 at 8:00 places one Sub-13 + one Senior (different teams,
    // different categories). Max placed = 90. With break=0, next slot
    // starts at 9:30 — NOT 8:45 (which would let the 90-min Senior
    // bleed into the next 8:45 row).
    const mixed = [
      { team1Id: 't1', team2Id: 't2', phase: 'Sub-13|grupos' },
      { team1Id: 't3', team2Id: 't4', phase: 'Senior|grupos' },
      { team1Id: 't5', team2Id: 't6', phase: 'Sub-13|grupos' },
      { team1Id: 't7', team2Id: 't8', phase: 'Senior|grupos' },
    ];
    const slots = calculateMatchTimes(
      mixed,
      '2026-01-01',
      ['Cancha A', 'Cancha B'],
      {
        startTime: '08:00',
        endTime: '18:00',
        matchDuration: 60,
        breakDuration: 0,
        courtCount: 2,
        matchDurationsByCategory: {
          'Sub-13': 45,
          Senior: 90,
        },
      },
    );
    const times = [...new Set(slots.map((s) => s!.time))].sort();
    expect(times).toEqual(['08:00', '09:30']);
  });

  it('rotates through every declared court before advancing', () => {
    // 6 fixtures with 4 teams ×3 courts. Round-robin only fits 2
    // matches at a time (2 pairs from 4 teams), so court C should be
    // empty for those 2 simultaneous matches but the next slot must
    // still try court A first. Regression check: a stale break loop
    // could leave court C unused even when teams are free.
    const six = [
      { team1Id: 't1', team2Id: 't2', phase: 'X|g' },
      { team1Id: 't3', team2Id: 't4', phase: 'X|g' },
      { team1Id: 't1', team2Id: 't3', phase: 'X|g' },
      { team1Id: 't2', team2Id: 't4', phase: 'X|g' },
      { team1Id: 't1', team2Id: 't4', phase: 'X|g' },
      { team1Id: 't2', team2Id: 't3', phase: 'X|g' },
    ];
    const slots = calculateMatchTimes(
      six,
      '2026-01-01',
      ['Cancha A', 'Cancha B', 'Cancha C'],
      {
        startTime: '08:00',
        endTime: '18:00',
        matchDuration: 45,
        breakDuration: 0,
        courtCount: 3,
      },
    );
    // 6 matches = 3 slots × 2 matches (since 4 teams = max 2 parallel).
    const times = [...new Set(slots.map((s) => s!.time))].sort();
    expect(times).toEqual(['08:00', '08:45', '09:30']);
    // Per-slot: should always use Cancha A + Cancha B (the round-robin
    // can't fit a third match because all teams are busy after 2 pairs).
    const courts = new Set(slots.map((s) => s!.court));
    expect(courts).toContain('Cancha A');
    expect(courts).toContain('Cancha B');
  });
});
