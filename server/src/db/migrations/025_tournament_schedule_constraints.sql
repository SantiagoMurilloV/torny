-- Migration 025: persist the remaining schedule constraints that the
-- admin form was already exposing but had no place to live in.
--
-- Migration 024 added the three "happy path" defaults (match length,
-- break, per-day windows). The form quickly outgrew them — admins also
-- wanted to:
--   · cap the number of matches a venue can host per day (avoid 18-hour
--     marathons even when the day window technically allows them);
--   · block out "dead" minutes inside the active window (lunch breaks,
--     opening / closing ceremonies, court drying time, etc.);
--   · order categories by priority so the early slots of each day
--     favour the most important divisions (typical: finals on top of
--     a multi-category day go first).
--
-- These three were added to the React form in commits 7abc42c +
-- cc3f0cf but the values never reached the backend — the DTO didn't
-- carry them, the column map didn't write them, and the scheduler had
-- no way to honour them. This migration unblocks all of that.
--
-- Columns:
--   max_matches_per_day — INT default 0. 0 = "no cap"; positive values
--                          stop the scheduler from packing more than
--                          that many matches into a single calendar day.
--   dead_time_blocks    — JSONB array, default '[]'. Each entry is
--                          `{ "start": "HH:MM", "end": "HH:MM" }`. The
--                          scheduler skips any slot whose [matchStart,
--                          matchStart+matchDuration) interval intersects
--                          a block. Day-agnostic (same blocks repeat
--                          every day); per-day windows in `daily_schedules`
--                          handle the calendar-level shape.
--   category_priority   — TEXT[] default '{}'. Ordered list of category
--                          names; categories listed earlier get the
--                          earliest slots of each day. Categories not
--                          in the list keep their natural insertion
--                          order (after the prioritised ones).
--
-- Defaults match the pre-migration behaviour exactly so existing
-- tournaments stay schedule-identical until an admin opens the form.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS max_matches_per_day INT       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_time_blocks    JSONB     NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category_priority   TEXT[]    NOT NULL DEFAULT '{}'::text[];

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_max_matches_per_day_range
    CHECK (max_matches_per_day BETWEEN 0 AND 500);
