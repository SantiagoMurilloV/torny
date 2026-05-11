import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TournamentService } from './tournament.service';
import { CreateTournamentDto } from '../types';

// Mock the database module
vi.mock('../config/database', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../config/database';

const service = new TournamentService();

function validDto(overrides: Partial<CreateTournamentDto> = {}): CreateTournamentDto {
  return {
    name: 'Torneo de Prueba',
    sport: 'Voleibol',
    club: 'Torny Club',
    startDate: '2025-06-01',
    endDate: '2025-06-15',
    status: 'upcoming',
    teamsCount: 8,
    format: 'groups',
    courts: ['Cancha 1'],
    ...overrides,
  };
}

// Helper to create a mock pool with a query function
function mockPool(queryFn: ReturnType<typeof vi.fn>) {
  (getPool as ReturnType<typeof vi.fn>).mockReturnValue({ query: queryFn });
  return queryFn;
}

// A sample DB row as returned by PostgreSQL
function sampleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'uuid-1',
    name: 'Torneo de Prueba',
    sport: 'Voleibol',
    club: 'Torny Club',
    start_date: '2025-06-01',
    end_date: '2025-06-15',
    description: null,
    cover_image: null,
    logo: null,
    status: 'upcoming',
    teams_count: 8,
    format: 'groups',
    courts: ['Cancha 1'],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TournamentService.validateData', () => {
  it('should accept valid tournament data', () => {
    const result = service.validateData(validDto());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Name validation: 3-100 characters
  it('should reject name shorter than 3 characters', () => {
    expect(() => service.validateData(validDto({ name: 'AB' }))).toThrow();
  });

  it('should accept name with exactly 3 characters', () => {
    const result = service.validateData(validDto({ name: 'ABC' }));
    expect(result.valid).toBe(true);
  });

  it('should reject name longer than 100 characters', () => {
    expect(() => service.validateData(validDto({ name: 'A'.repeat(101) }))).toThrow();
  });

  it('should accept name with exactly 100 characters', () => {
    const result = service.validateData(validDto({ name: 'A'.repeat(100) }));
    expect(result.valid).toBe(true);
  });

  it('should reject empty name', () => {
    expect(() => service.validateData(validDto({ name: '' }))).toThrow();
  });

  // Date validation: startDate <= endDate
  it('should reject startDate after endDate', () => {
    expect(() =>
      service.validateData(validDto({ startDate: '2025-07-01', endDate: '2025-06-01' }))
    ).toThrow();
  });

  it('should accept startDate equal to endDate', () => {
    const result = service.validateData(validDto({ startDate: '2025-06-01', endDate: '2025-06-01' }));
    expect(result.valid).toBe(true);
  });

  it('should reject invalid startDate', () => {
    expect(() => service.validateData(validDto({ startDate: 'not-a-date' }))).toThrow();
  });

  it('should reject invalid endDate', () => {
    expect(() => service.validateData(validDto({ endDate: 'not-a-date' }))).toThrow();
  });

  // teamsCount validation: 2-9999 (cap relaxed in migration 023 + service
  // ruleset on 2026-05-10 to support federations with 60+ teams; the
  // upper bound stays purely as a typo safeguard against accidental
  // 4-zero overshoots).
  it('should reject teamsCount less than 2', () => {
    expect(() => service.validateData(validDto({ teamsCount: 1 }))).toThrow();
  });

  it('should accept teamsCount of 2', () => {
    const result = service.validateData(validDto({ teamsCount: 2 }));
    expect(result.valid).toBe(true);
  });

  it('should accept teamsCount above the legacy 32 cap', () => {
    const result = service.validateData(validDto({ teamsCount: 60 }));
    expect(result.valid).toBe(true);
  });

  it('should accept teamsCount at the new 9999 ceiling', () => {
    const result = service.validateData(validDto({ teamsCount: 9999 }));
    expect(result.valid).toBe(true);
  });

  it('should reject teamsCount above 9999', () => {
    expect(() => service.validateData(validDto({ teamsCount: 10000 }))).toThrow();
  });

  // Required fields
  it('should reject missing sport', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).sport = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });

  it('should reject missing club', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).club = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });

  it('should reject missing format', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).format = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });

  it('should reject missing status', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).status = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });
});

describe('TournamentService CRUD operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return all tournaments mapped from DB rows', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({
        rows: [sampleRow(), sampleRow({ id: 'uuid-2', name: 'Torneo 2' })],
      }));

      const result = await service.getAll();

      // The query now decorates each row with correlated counts
      // (enrolled_count + matches_count) so the home cards / hero can
      // show real numbers instead of the configured cap. Match the
      // shape loosely — we care that the SELECT references the
      // tournaments table and orders by start_date DESC.
      const calledWith = queryFn.mock.calls[0][0] as string;
      expect(calledWith).toMatch(/FROM\s+tournaments\s+t/);
      expect(calledWith).toMatch(/enrolled_count/);
      expect(calledWith).toMatch(/matches_count/);
      expect(calledWith).toMatch(/ORDER BY t\.start_date DESC/);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('uuid-1');
      expect(result[0].name).toBe('Torneo de Prueba');
      expect(result[1].id).toBe('uuid-2');
      expect(result[1].name).toBe('Torneo 2');
    });

    it('should return empty array when no tournaments exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      const result = await service.getAll();
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should return a tournament by id', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      const result = await service.getById('uuid-1');

      expect(result.id).toBe('uuid-1');
      expect(result.name).toBe('Torneo de Prueba');
      expect(result.teamsCount).toBe(8);
    });

    it('should throw NotFoundError when tournament does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.getById('nonexistent')).rejects.toThrow('Torneo no fue encontrado');
    });
  });

  describe('create', () => {
    it('should validate data and insert a new tournament', async () => {
      const row = sampleRow();
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [row] }));

      const dto = validDto();
      const result = await service.create(dto);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('uuid-1');
      expect(result.name).toBe('Torneo de Prueba');
    });

    it('should throw validation error for invalid data before querying DB', async () => {
      const queryFn = mockPool(vi.fn());

      await expect(service.create(validDto({ name: 'AB' }))).rejects.toThrow();
      expect(queryFn).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing tournament', async () => {
      const existingRow = sampleRow();
      const updatedRow = sampleRow({ name: 'Torneo Actualizado' });
      const queryFn = mockPool(vi.fn()
        // First call: getById check (exists)
        .mockResolvedValueOnce({ rows: [existingRow] })
        // Second call: getById for merge validation
        .mockResolvedValueOnce({ rows: [existingRow] })
        // Third call: UPDATE query
        .mockResolvedValueOnce({ rows: [updatedRow] })
      );

      const result = await service.update('uuid-1', { name: 'Torneo Actualizado' });

      expect(result.name).toBe('Torneo Actualizado');
      expect(queryFn).toHaveBeenCalledTimes(3);
    });

    it('should throw NotFoundError when updating non-existent tournament', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.update('nonexistent', { name: 'New Name' })).rejects.toThrow(
        'Torneo no fue encontrado'
      );
    });

    it('should return unchanged tournament when no fields are provided', async () => {
      const existingRow = sampleRow();
      mockPool(vi.fn()
        // First call: getById check
        .mockResolvedValueOnce({ rows: [existingRow] })
        // Second call: getById return (no fields to update)
        .mockResolvedValueOnce({ rows: [existingRow] })
      );

      const result = await service.update('uuid-1', {});

      expect(result.id).toBe('uuid-1');
    });
  });

  describe('delete', () => {
    it('should delete an existing tournament', async () => {
      const queryFn = mockPool(vi.fn()
        // First call: getById check
        .mockResolvedValueOnce({ rows: [sampleRow()] })
        // Second call: DELETE
        .mockResolvedValueOnce({ rows: [] })
      );

      await service.delete('uuid-1');

      expect(queryFn).toHaveBeenCalledTimes(2);
      // Verify the DELETE query was called
      expect(queryFn.mock.calls[1][0]).toBe('DELETE FROM tournaments WHERE id = $1');
      expect(queryFn.mock.calls[1][1]).toEqual(['uuid-1']);
    });

    it('should throw NotFoundError when deleting non-existent tournament', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.delete('nonexistent')).rejects.toThrow('Torneo no fue encontrado');
    });
  });

  describe('cascade deletion', () => {
    it('should rely on FK CASCADE constraints — delete only the tournament row', async () => {
      // The service issues a single DELETE on the tournaments table.
      // PostgreSQL FK ON DELETE CASCADE handles matches, standings, bracket_matches, tournament_teams.
      const queryFn = mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] }) // getById
        .mockResolvedValueOnce({ rows: [] })            // DELETE
      );

      await service.delete('uuid-1');

      // Only 2 queries: SELECT (getById) + DELETE
      expect(queryFn).toHaveBeenCalledTimes(2);
      const deleteCall = queryFn.mock.calls[1];
      expect(deleteCall[0]).toBe('DELETE FROM tournaments WHERE id = $1');
      // No additional DELETE queries for matches, standings, etc.
    });
  });

  describe('getMatches', () => {
    it('should return matches for a tournament', async () => {
      const matchRow = {
        id: 'match-1',
        tournament_id: 'uuid-1',
        team1_id: 'team-1',
        team2_id: 'team-2',
        date: '2025-06-05',
        time: '10:00',
        court: 'Cancha 1',
        referee: null,
        status: 'upcoming',
        score_team1: null,
        score_team2: null,
        phase: 'groups',
        group_name: 'A',
        duration: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] }) // getById
        .mockResolvedValueOnce({ rows: [matchRow] })     // matches query
        .mockResolvedValueOnce({ rows: [] })             // attached set_scores
      );

      const result = await service.getMatches('uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('match-1');
      expect(result[0].tournamentId).toBe('uuid-1');
      expect(result[0].sets).toEqual([]);
    });

    it('should throw NotFoundError if tournament does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.getMatches('nonexistent')).rejects.toThrow('Torneo no fue encontrado');
    });
  });

  describe('getStandings', () => {
    it('should throw NotFoundError if tournament does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.getStandings('nonexistent')).rejects.toThrow('Torneo no fue encontrado');
    });
  });

  describe('getBracket', () => {
    it('should throw NotFoundError if tournament does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await expect(service.getBracket('nonexistent')).rejects.toThrow('Torneo no fue encontrado');
    });
  });
});
