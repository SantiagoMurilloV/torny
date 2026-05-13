-- Migration 030: Make matches.team1_id / matches.team2_id nullable so
-- the bracket materializer can persist UNRESOLVED slots (cuartos,
-- semis, finals) before the upstream rounds complete.
--
-- Why?
--   The admin's cronograma needs to show every bracket fixture the
--   tournament will eventually play — including the cuartos that
--   depend on group standings still in flux. Until now the
--   materializer skipped any bracket_matches row with NULL team
--   pointers, which meant the admin couldn't pre-schedule those
--   slots: they didn't exist in the `matches` table yet, so they
--   couldn't be dragged around the schedule grid or assigned a
--   (date, court, time) slot.
--
--   By relaxing the NOT NULL + the "different_teams" CHECK, the
--   materializer can insert a row for every bracket slot at bracket
--   generation time. The slot gets (date, time, court) from the
--   normal scheduler; team1_id / team2_id stay NULL until the
--   upstream round completes and `advanceWinner` writes back the
--   actual team UUIDs.
--
-- Frontend behaviour (already in place from feat/cronograma-bracket-
-- labels): unresolved matches in `upcoming` state render their team
-- rows blurred so the spectator/admin doesn't read placeholder data
-- as a real matchup.
--
-- Safety:
--   · Non-bracket matches keep working: the API path that creates
--     group-stage matches still INSERTs with both team ids set.
--     Validators on the service layer guard against accidental NULLs
--     for group-stage rows.
--   · The replacement CHECK still rejects (team1_id = team2_id) when
--     both are non-null — the only thing it allows extra is the NULL
--     case for one or both columns, which is exactly what an
--     unresolved bracket slot needs.
--   · No data backfill: existing matches already have both team ids
--     filled in, so dropping the NOT NULL has zero impact on them.

ALTER TABLE matches ALTER COLUMN team1_id DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN team2_id DROP NOT NULL;

-- Replace the original CHECK that required different (non-null) team
-- ids with one that accepts NULLs but still rejects two non-null
-- equal ids.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS different_teams;
ALTER TABLE matches ADD CONSTRAINT different_teams CHECK (
  team1_id IS NULL OR team2_id IS NULL OR team1_id <> team2_id
);
