-- Migration 031: Add `city` to tournaments so the public Hero can show
-- the locality of the event (e.g. "Armenia, Quindío") instead of
-- borrowing the name of the first court ("INEM Cancha 1"), which read
-- as "venue" and confused visitors.
--
-- The column is optional. Legacy tournaments left empty fall back in
-- the UI to `courts[0]`, keeping the previous behaviour intact.
--
-- Safety:
--   · Pure additive — no NOT NULL, no DEFAULT computation from
--     existing rows, no backfill needed.
--   · No index added: this column is only read for display in the
--     hero, never used in WHERE clauses or joins.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS city VARCHAR(160);
