import { describe, it, expect } from 'vitest';
import { analyzeScheduleData, type AdvisorMatch } from './schedule-advisor.service';

let seq = 0;
function match(p: Partial<AdvisorMatch>): AdvisorMatch {
  seq += 1;
  return {
    id: `m${seq}`,
    date: '2026-07-01',
    time: '08:00',
    court: 'Cancha 1',
    team1Id: 't1',
    team2Id: 't2',
    team1Name: 'A',
    team2Name: 'B',
    category: 'Mayores',
    phase: 'Grupos|Mayores',
    durationMin: 60,
    status: 'upcoming',
    ...p,
  };
}

describe('analyzeScheduleData', () => {
  it('flags a court double-booking (overlapping intervals, same court)', () => {
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 't1', team2Id: 't2' }),
      // Starts 30 min later on the SAME court → overlaps [480,540) vs [510,570).
      match({ time: '08:30', court: 'C1', team1Id: 't3', team2Id: 't4' }),
    ]);
    expect(a.counts.overlaps).toBe(1);
    expect(a.overlaps[0].kind).toBe('cancha');
  });

  it('flags a team playing two overlapping matches', () => {
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 'shared', team2Id: 't2' }),
      match({ time: '08:30', court: 'C2', team1Id: 'shared', team2Id: 't4' }),
    ]);
    expect(a.counts.overlaps).toBe(1);
    expect(a.overlaps[0].kind).toBe('equipo');
  });

  it('does not flag back-to-back matches on different courts as overlap', () => {
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 't1', team2Id: 't2' }),
      match({ time: '09:00', court: 'C2', team1Id: 't3', team2Id: 't4' }),
    ]);
    expect(a.counts.overlaps).toBe(0);
  });

  it('flags a team with no rest between its matches', () => {
    // Team "x" plays 08:00–09:00 then again 09:05 → only 5 min rest.
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 'x', team2Id: 't2' }),
      match({ time: '09:05', court: 'C1', team1Id: 'x', team2Id: 't3' }),
    ]);
    expect(a.counts.restViolations).toBe(1);
    expect(a.restViolations[0].gapMin).toBe(5);
  });

  it('flags a long idle gap for a team across the same day', () => {
    // Team "y": 08:00–09:00 then 16:00 → 7h idle.
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 'y', team2Id: 't2' }),
      match({ time: '16:00', court: 'C1', team1Id: 'y', team2Id: 't3' }),
    ]);
    expect(a.counts.longIdleGaps).toBe(1);
  });

  it('flags a team with too many matches in one day', () => {
    // Team "z" plays 5 matches in a day (cap is 4) with proper rest gaps.
    const times = ['08:00', '09:30', '11:00', '12:30', '14:00'];
    const a = analyzeScheduleData(
      times.map((time, i) =>
        match({ time, court: 'C1', team1Id: 'z', team2Id: `op${i}` }),
      ),
    );
    expect(a.counts.heavyDays).toBe(1);
    expect(a.heavyDays[0].count).toBe(5);
  });

  it('reports court load per court', () => {
    const a = analyzeScheduleData([
      match({ court: 'C1', time: '08:00' }),
      match({ court: 'C1', time: '10:00' }),
      match({ court: 'C2', time: '08:00' }),
    ]);
    const c1 = a.courtLoad.find((c) => c.court === 'C1');
    expect(c1?.count).toBe(2);
    expect(a.courts).toBe(2);
  });

  it('returns a clean report for a well-spaced schedule', () => {
    const a = analyzeScheduleData([
      match({ time: '08:00', court: 'C1', team1Id: 't1', team2Id: 't2' }),
      match({ time: '09:30', court: 'C1', team1Id: 't3', team2Id: 't4' }),
    ]);
    expect(a.counts.overlaps).toBe(0);
    expect(a.counts.restViolations).toBe(0);
    expect(a.counts.heavyDays).toBe(0);
  });
});
