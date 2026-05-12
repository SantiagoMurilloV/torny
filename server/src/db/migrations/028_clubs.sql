-- Migration 028: club-level credentials.
--
-- Until now every team carried its own captain credentials
-- (teams.captain_username / captain_password_hash). For multi-team
-- clubs (e.g. "Spike Rubi", "Spike Esmeralda", "Spike Diamante" all
-- belong to club "Spike") the admin had to generate, distribute and
-- track ONE login per team — painful for clubs with 4+ teams.
--
-- This migration adds:
--   · clubs table — one row per (admin, club name). Holds login
--     credentials so a single user/password sees every team in the
--     cluster. Plaintext password lives in `password_recovery` so
--     the admin can re-export the Excel without rotating creds.
--     Same pattern teams.captain_password_recovery already uses.
--   · teams.club_id  — nullable FK pointing at the club a team
--     belongs to. NULL for legacy teams (default) → no behaviour
--     change. Becomes set when the admin runs the "Detectar y crear
--     clubs" bulk action that groups teams by the first word of
--     their normalized name.
--
-- Backwards-compat: every existing team stays with `club_id = NULL`
-- and its individual captain credentials intact. The two channels
-- coexist — captain login still works for old teams, club login is
-- a parallel path for grouped teams.

CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The admin who owns this club entry. Cascade so deleting the
  -- admin removes their clubs (and via teams.club_id ON DELETE SET
  -- NULL leaves teams orphaned-but-alive, same as current captain).
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  -- Auto-generated as `<slug>-NNNN` (mirrors captain credential gen
  -- in server/src/lib/passwordGen.ts), so collisions across admins
  -- are rare. Kept globally unique (case-insensitive) so the login
  -- endpoint can do `WHERE LOWER(username) = LOWER($1)` without
  -- ambiguity.
  username VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- Plaintext recovery — only readable by the admin via
  -- GET /api/clubs (owner-scoped). Lets the Excel export reproduce
  -- the password without forcing a regen + re-distribute cycle.
  password_recovery VARCHAR(255),
  credentials_generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clubs_username_lower_idx
  ON clubs (LOWER(username));
CREATE INDEX IF NOT EXISTS clubs_owner_id_idx ON clubs(owner_id);

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS club_id UUID
    REFERENCES clubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teams_club_id_idx ON teams(club_id);
