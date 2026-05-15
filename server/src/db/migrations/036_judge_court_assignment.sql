-- Migration 036: judge court assignment
--
-- Lets admins assign a specific court (and the tournament it belongs to)
-- to a judge account. When assigned, the judge's match feed is narrowed
-- to live + scheduled matches on that court only, instead of all live
-- matches across the admin's tournaments.
--
-- assigned_tournament_id: FK to the tournament whose court list is the
--   source of truth. Cascade-nullified on tournament delete so orphaned
--   judges simply fall back to the unscoped (all-live) feed.
--
-- assigned_court: denormalized court name (VARCHAR, not FK) matching one
--   of tournaments.courts[]. Storing it directly avoids a join on every
--   match-list request and survives court renames gracefully (the admin
--   will simply re-assign if they rename a court).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS assigned_tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_court         VARCHAR(255);
