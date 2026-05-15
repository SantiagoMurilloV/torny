-- Migration 035: registration window
-- Adds two nullable TIMESTAMPTZ columns so admins can configure when the
-- public parent-registration link opens and closes. Both are optional:
--   · registration_opens_at NULL  → link is open from the moment the
--                                   tournament is created (legacy behaviour)
--   · registration_closes_at NULL → link closes at midnight of start_date
--                                   (legacy behaviour preserved)
-- When both are set the link is only active during [opens_at, closes_at).

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS registration_opens_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_closes_at TIMESTAMPTZ;
