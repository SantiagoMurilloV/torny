import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requireTournamentAccess,
  requireTeamOwnership,
  requireMatchAccess,
} from './access';
import type { JwtPayload } from '../types';

vi.mock('../config/database', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../config/database';

/**
 * Build a fake Express triplet for the middleware. `params`/`body`/`user`
 * default to empty so each test only sets what matters. `next` is a
 * vitest mock so we can inspect whether it was called.
 */
function makeReqRes(opts: {
  user?: JwtPayload | undefined;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}): {
  req: Partial<Request>;
  res: Partial<Response>;
  next: NextFunction;
  jsonMock: ReturnType<typeof vi.fn>;
  statusMock: ReturnType<typeof vi.fn>;
} {
  const jsonMock = vi.fn();
  const statusMock = vi.fn(() => ({ json: jsonMock })) as unknown as Response['status'];
  const res = { status: statusMock, json: jsonMock } as Partial<Response>;
  const next = vi.fn() as NextFunction;
  const req: Partial<Request> = {
    user: opts.user,
    params: opts.params ?? {},
    body: opts.body ?? {},
    headers: {},
  };
  return {
    req,
    res,
    next,
    jsonMock,
    statusMock: statusMock as unknown as ReturnType<typeof vi.fn>,
  };
}

function mockPool(rows: Array<Record<string, unknown>>) {
  const queryFn = vi.fn().mockResolvedValue({ rows });
  (getPool as ReturnType<typeof vi.fn>).mockReturnValue({ query: queryFn });
  return queryFn;
}

const adminA: JwtPayload = {
  userId: 'admin-a',
  role: 'admin',
  iat: 0,
  exp: 0,
};
const adminB: JwtPayload = {
  userId: 'admin-b',
  role: 'admin',
  iat: 0,
  exp: 0,
};
const superAdmin: JwtPayload = {
  userId: 'super-1',
  role: 'super_admin',
  iat: 0,
  exp: 0,
};
const judgeOfA: JwtPayload = {
  userId: 'judge-1',
  role: 'judge',
  createdBy: 'admin-a',
  iat: 0,
  exp: 0,
};

describe('requireTournamentAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets the owning admin through', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: adminA,
      params: { id: 'tourn-1' },
    });
    await requireTournamentAccess(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error arg
  });

  it('rejects a different admin with 404 (no leak)', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next, statusMock, jsonMock } = makeReqRes({
      user: adminB,
      params: { id: 'tourn-1' },
    });
    await requireTournamentAccess(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Torneo no encontrado' });
  });

  it('lets super_admin through regardless of owner', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: superAdmin,
      params: { id: 'tourn-1' },
    });
    await requireTournamentAccess(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a tournament that does not exist', async () => {
    mockPool([]);
    const { req, res, next, statusMock } = makeReqRes({
      user: adminA,
      params: { id: 'ghost' },
    });
    await requireTournamentAccess(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(404);
  });

  it('reads from req.params.tournamentId when present', async () => {
    const queryFn = mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: adminA,
      params: { tournamentId: 'tourn-2' },
    });
    await requireTournamentAccess(req as Request, res as Response, next);
    expect(queryFn).toHaveBeenCalledWith(expect.any(String), ['tourn-2']);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireTeamOwnership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets the owning admin through', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: adminA,
      params: { teamId: 'team-1' },
    });
    await requireTeamOwnership(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the team belongs to another admin', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next, statusMock } = makeReqRes({
      user: adminB,
      params: { teamId: 'team-1' },
    });
    await requireTeamOwnership(req as Request, res as Response, next);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('treats null owner_id (legacy team) as inaccessible to admins', async () => {
    mockPool([{ owner_id: null }]);
    const { req, res, next, statusMock } = makeReqRes({
      user: adminA,
      params: { teamId: 'legacy' },
    });
    await requireTeamOwnership(req as Request, res as Response, next);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets the team captain through for their own team', async () => {
    // No DB query is even needed for captain bypass — the guard exits
    // early once it sees user.role === 'team_captain' && matching teamId.
    const queryFn = mockPool([]);
    const captain: JwtPayload = {
      userId: 'cap-1',
      role: 'team_captain',
      teamId: 'team-1',
      iat: 0,
      exp: 0,
    };
    const { req, res, next } = makeReqRes({
      user: captain,
      params: { teamId: 'team-1' },
    });
    await requireTeamOwnership(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('rejects a captain trying to touch a different team', async () => {
    const captain: JwtPayload = {
      userId: 'cap-1',
      role: 'team_captain',
      teamId: 'team-1',
      iat: 0,
      exp: 0,
    };
    const { req, res, next, statusMock } = makeReqRes({
      user: captain,
      params: { teamId: 'team-other' },
    });
    await requireTeamOwnership(req as Request, res as Response, next);
    expect(statusMock).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireMatchAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets the owning admin through', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: adminA,
      params: { id: 'match-1' },
    });
    await requireMatchAccess(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('lets a judge created by the owning admin through', async () => {
    mockPool([{ owner_id: 'admin-a' }]);
    const { req, res, next } = makeReqRes({
      user: judgeOfA,
      params: { id: 'match-1' },
    });
    await requireMatchAccess(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a judge whose admin does not own the match', async () => {
    mockPool([{ owner_id: 'admin-b' }]);
    const { req, res, next, statusMock } = makeReqRes({
      user: judgeOfA,
      params: { id: 'match-1' },
    });
    await requireMatchAccess(req as Request, res as Response, next);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the match does not exist', async () => {
    mockPool([]);
    const { req, res, next, statusMock } = makeReqRes({
      user: adminA,
      params: { id: 'ghost' },
    });
    await requireMatchAccess(req as Request, res as Response, next);
    expect(statusMock).toHaveBeenCalledWith(404);
  });
});
