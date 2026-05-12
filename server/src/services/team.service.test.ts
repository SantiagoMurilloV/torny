import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from './team.service';
import { CreateTeamDto } from '../types';

// Mock the database module
vi.mock('../config/database', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../config/database';

const service = new TeamService();

function validDto(overrides: Partial<CreateTeamDto> = {}): CreateTeamDto {
  return {
    name: 'Equipo Prueba',
    initials: 'EP',
    primaryColor: '#FF0000',
    secondaryColor: '#0000FF',
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
    name: 'Equipo Prueba',
    initials: 'EP',
    logo: null,
    primary_color: '#FF0000',
    secondary_color: '#0000FF',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function sampleMatchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'match-1',
    tournament_id: 'tourn-1',
    team1_id: 'uuid-1',
    team2_id: 'uuid-2',
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
    ...overrides,
  };
}

// ── Validation tests (Req 5.4, 5.5) ──

describe('TeamService.validateData', () => {
  it('should accept valid team data', () => {
    const result = service.validateData(validDto());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Initials validation: 1-3 uppercase letters
  it('should accept initials with 1 uppercase letter', () => {
    const result = service.validateData(validDto({ initials: 'A' }));
    expect(result.valid).toBe(true);
  });

  it('should accept initials with 3 uppercase letters', () => {
    const result = service.validateData(validDto({ initials: 'ABC' }));
    expect(result.valid).toBe(true);
  });

  it('should reject empty initials', () => {
    expect(() => service.validateData(validDto({ initials: '' }))).toThrow();
  });

  it('should reject initials longer than 3 characters', () => {
    expect(() => service.validateData(validDto({ initials: 'ABCD' }))).toThrow();
  });

  it('should reject lowercase initials', () => {
    expect(() => service.validateData(validDto({ initials: 'ab' }))).toThrow();
  });

  it('should reject initials with numbers', () => {
    expect(() => service.validateData(validDto({ initials: 'A1' }))).toThrow();
  });

  it('should reject initials with special characters', () => {
    expect(() => service.validateData(validDto({ initials: 'A-B' }))).toThrow();
  });

  // Color validation: valid hex #RRGGBB
  it('should accept valid hex colors', () => {
    const result = service.validateData(validDto({ primaryColor: '#AABBCC', secondaryColor: '#112233' }));
    expect(result.valid).toBe(true);
  });

  it('should reject primaryColor without hash', () => {
    expect(() => service.validateData(validDto({ primaryColor: 'FF0000' }))).toThrow();
  });

  it('should reject secondaryColor without hash', () => {
    expect(() => service.validateData(validDto({ secondaryColor: '0000FF' }))).toThrow();
  });

  it('should reject short hex color (3-digit)', () => {
    expect(() => service.validateData(validDto({ primaryColor: '#F00' }))).toThrow();
  });

  it('should reject hex color with invalid characters', () => {
    expect(() => service.validateData(validDto({ primaryColor: '#GGHHII' }))).toThrow();
  });

  it('should reject empty primaryColor', () => {
    expect(() => service.validateData(validDto({ primaryColor: '' }))).toThrow();
  });

  // Required fields
  it('should reject missing name', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).name = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });

  it('should reject missing initials', () => {
    const dto = validDto();
    (dto as unknown as Record<string, unknown>).initials = undefined;
    expect(() => service.validateData(dto)).toThrow();
  });
});

// ── CRUD operations ──

describe('TeamService CRUD operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return all teams mapped from DB rows', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({
        rows: [sampleRow(), sampleRow({ id: 'uuid-2', name: 'Equipo 2' })],
      }));

      const result = await service.getAll();

      // The bulk SELECT now INCLUDES `logo` because match cards /
      // bracket / standings need it to render the team avatar from the
      // shared teamsCache. Logos are compressed client-side (256×256
      // WebP, see src/app/lib/compressImage.ts) before upload, so the
      // payload stays under the cache budget that the 2026-05-04
      // stress test set as the floor.
      const callArg = queryFn.mock.calls[0][0] as string;
      expect(callArg).toMatch(/FROM teams ORDER BY name/);
      expect(callArg).toMatch(/\blogo\b/);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('uuid-1');
      expect(result[0].primaryColor).toBe('#FF0000');
      expect(result[1].id).toBe('uuid-2');
    });

    it('should return empty array when no teams exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));
      const result = await service.getAll();
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should return a team by id', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      const result = await service.getById('uuid-1');

      expect(result.id).toBe('uuid-1');
      expect(result.name).toBe('Equipo Prueba');
      expect(result.initials).toBe('EP');
    });

    it('should throw NotFoundError when team does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));
      await expect(service.getById('nonexistent')).rejects.toThrow('Equipo no fue encontrado');
    });
  });

  describe('create', () => {
    it('should validate data and insert a new team', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      const dto = validDto();
      const result = await service.create(dto);

      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('uuid-1');
      expect(result.name).toBe('Equipo Prueba');
    });

    it('should throw validation error for invalid data before querying DB', async () => {
      const queryFn = mockPool(vi.fn());

      await expect(service.create(validDto({ initials: 'abc' }))).rejects.toThrow();
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('should pass logo as null when not provided', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      await service.create(validDto());

      const insertArgs = queryFn.mock.calls[0][1];
      expect(insertArgs[2]).toBeNull(); // logo
    });

    it('should pass logo value when provided', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow({ logo: 'logo.png' })] }));

      await service.create(validDto({ logo: 'logo.png' }));

      const insertArgs = queryFn.mock.calls[0][1];
      expect(insertArgs[2]).toBe('logo.png');
    });
  });

  describe('update', () => {
    it('should update an existing team', async () => {
      const existingRow = sampleRow();
      const updatedRow = sampleRow({ name: 'Equipo Actualizado' });
      const queryFn = mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [existingRow] }) // getById check
        .mockResolvedValueOnce({ rows: [existingRow] }) // getById for merge validation
        .mockResolvedValueOnce({ rows: [updatedRow] })  // UPDATE query
      );

      const result = await service.update('uuid-1', { name: 'Equipo Actualizado', initials: 'EA' });

      expect(result.name).toBe('Equipo Actualizado');
      expect(queryFn).toHaveBeenCalledTimes(3);
    });

    it('should throw NotFoundError when updating non-existent team', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));
      await expect(service.update('nonexistent', { name: 'New' })).rejects.toThrow('Equipo no fue encontrado');
    });

    it('should return unchanged team when no fields are provided', async () => {
      const existingRow = sampleRow();
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [existingRow] }) // getById check
        .mockResolvedValueOnce({ rows: [existingRow] }) // getById return
      );

      const result = await service.update('uuid-1', {});
      expect(result.id).toBe('uuid-1');
    });
  });

  // ── Delete with active matches rejection (Req 5.3) ──

  describe('delete', () => {
    it('should delete a team with no active matches', async () => {
      const queryFn = mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] })           // getById
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })        // active matches check
        .mockResolvedValueOnce({ rows: [] })                       // DELETE
      );

      await service.delete('uuid-1');

      expect(queryFn).toHaveBeenCalledTimes(3);
      expect(queryFn.mock.calls[2][0]).toBe('DELETE FROM teams WHERE id = $1');
    });

    it('should throw NotFoundError when deleting non-existent team', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));
      await expect(service.delete('nonexistent')).rejects.toThrow('Equipo no fue encontrado');
    });

    it('should reject deletion when team has active matches (live)', async () => {
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] })           // getById
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })        // active matches count > 0
      );

      await expect(service.delete('uuid-1')).rejects.toThrow(
        'No se puede eliminar el equipo porque tiene partidos activos'
      );
    });

    it('should reject deletion when team has upcoming matches', async () => {
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      );

      await expect(service.delete('uuid-1')).rejects.toThrow(
        'No se puede eliminar el equipo porque tiene partidos activos'
      );
    });
  });

  // ── Ownership scope (mig 022) ──

  describe('getAll with owner scope', () => {
    it('should filter by owner_id when scope is owner', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await service.getAll({ scope: 'owner', ownerId: 'admin-1' });

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toMatch(/WHERE owner_id = \$1/);
      const params = queryFn.mock.calls[0][1] as unknown[];
      expect(params).toEqual(['admin-1']);
    });

    it('should NOT filter by owner_id when scope is all', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await service.getAll({ scope: 'all' });

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/WHERE owner_id/);
    });
  });

  describe('search', () => {
    it('should scope to owner and apply LIKE filter on the search term', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await service.search(
        { scope: 'owner', ownerId: 'admin-1' },
        { search: 'agui', limit: 10 },
      );

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toMatch(/owner_id = \$1/);
      expect(sql).toMatch(/ILIKE/);
      const params = queryFn.mock.calls[0][1] as unknown[];
      // [ownerId, '%agui%', limit]
      expect(params[0]).toBe('admin-1');
      expect(params[1]).toBe('%agui%');
      expect(params[2]).toBe(10);
    });

    it('should clamp limit to the safe range', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [] }));

      await service.search({ scope: 'all' }, { limit: 999 });

      const params = queryFn.mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(50); // max
    });
  });

  describe('create with owner_id', () => {
    it('should persist owner_id when provided', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      await service.create(validDto(), 'admin-1');

      const insertArgs = queryFn.mock.calls[0][1] as unknown[];
      // INSERT … VALUES ($1..$10) with owner_id as the 9th positional arg
      // and club_id as the 10th (null when omitted).
      expect(insertArgs[8]).toBe('admin-1');
    });

    it('should pass null owner_id when none provided (super_admin / platform)', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      await service.create(validDto());

      const insertArgs = queryFn.mock.calls[0][1] as unknown[];
      expect(insertArgs[8]).toBeNull();
    });

    it('should pass null club_id by default', async () => {
      const queryFn = mockPool(vi.fn().mockResolvedValue({ rows: [sampleRow()] }));

      await service.create(validDto(), 'admin-1');

      const insertArgs = queryFn.mock.calls[0][1] as unknown[];
      // club_id sits at position $10 (index 9).
      expect(insertArgs[9]).toBeNull();
    });

    it('should persist club_id when provided and club belongs to same owner', async () => {
      // Two-step: assertClubOwnership SELECT first, then the INSERT.
      const queryFn = mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [{ owner_id: 'admin-1' }] }) // club lookup
        .mockResolvedValueOnce({ rows: [sampleRow({ club_id: 'club-1' })] }), // INSERT
      );

      await service.create(validDto({ clubId: 'club-1' }), 'admin-1');

      const insertArgs = queryFn.mock.calls[1][1] as unknown[];
      expect(insertArgs[9]).toBe('club-1');
    });

    it('should reject club_id pointing to another admin (leak-safe 404)', async () => {
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [{ owner_id: 'admin-2' }] }), // club lookup
      );

      await expect(
        service.create(validDto({ clubId: 'club-1' }), 'admin-1'),
      ).rejects.toThrow('Club no fue encontrado');
    });
  });

  describe('getMatches', () => {
    it('should return matches for a team', async () => {
      mockPool(vi.fn()
        .mockResolvedValueOnce({ rows: [sampleRow()] })           // getById
        .mockResolvedValueOnce({ rows: [sampleMatchRow()] })      // matches query
        .mockResolvedValueOnce({ rows: [] })                       // attached set_scores
      );

      const result = await service.getMatches('uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('match-1');
      expect(result[0].tournamentId).toBe('tourn-1');
      expect(result[0].sets).toEqual([]);
    });

    it('should throw NotFoundError if team does not exist', async () => {
      mockPool(vi.fn().mockResolvedValue({ rows: [] }));
      await expect(service.getMatches('nonexistent')).rejects.toThrow('Equipo no fue encontrado');
    });
  });
});
