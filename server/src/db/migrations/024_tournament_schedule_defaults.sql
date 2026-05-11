-- Migration 024: persist per-tournament scheduling defaults.
--
-- Until now the four numbers that control how matches lay out on the
-- calendar (daily start, daily end, per-match duration, per-match break)
-- were transient — the admin re-typed them every time they generated
-- fixtures and the repair tool used hardcoded constants. That meant:
--   · long-running tournaments needed the admin to remember the same
--     numbers across regenerations,
--   · the repair tool placed conflict matches in slots that didn't
--     match the tournament's actual cadence (e.g. 75-min slots when
--     the tournament was actually running 45-min matches with 5-min
--     breaks), surprising the admin with "Reagendé al partido a las
--     09:15" toasts they never configured.
--
-- After this migration the tournament owns the defaults; the form
-- pre-fills the schedule modal from the row, the repair tool reads
-- the row directly, and (new) the admin can set DIFFERENT hours per
-- day — useful for tournaments where Saturday runs 08:00–22:00 and
-- Sunday only goes to 14:00.
--
-- Columns:
--   match_duration_minutes — global per-match length (default 60).
--   match_break_minutes    — global between-matches gap (default 15).
--   daily_schedules        — JSONB object keyed by ISO date
--                            ('YYYY-MM-DD') with the shape
--                            { "<date>": { "start": "HH:MM", "end": "HH:MM" } }.
--                            Days NOT in the object fall back to the
--                            global defaults (08:00–18:00). Empty
--                            object {} is the default for new
--                            tournaments — they keep behaving exactly
--                            like before until the admin opens the form
--                            and sets per-day overrides.
--
-- Why per-day lives in JSONB instead of a child table:
--   · A tournament rarely has more than ~7 days, so the JSONB
--     overhead is minimal.
--   · We never query "all tournaments running on day X" — the lookups
--     are always tournament-scoped, so an index on (tournament_id,
--     date) wouldn't pay for itself.
--   · The form renders one row per day; reading the whole map at once
--     is the dominant pattern.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS match_duration_minutes INT       NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS match_break_minutes    INT       NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS daily_schedules        JSONB     NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_match_duration_range
    CHECK (match_duration_minutes BETWEEN 5 AND 600),
  ADD CONSTRAINT tournaments_match_break_range
    CHECK (match_break_minutes BETWEEN 0 AND 240);
