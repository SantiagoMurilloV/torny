-- Migration 023: relax the upper bound on tournaments.teams_count.
--
-- Context: migration 001 created the tournaments table with
--   teams_count INT NOT NULL CHECK (teams_count >= 2 AND teams_count <= 32)
-- so the admin form rejected anything beyond 32 with the error message
-- "La cantidad de equipos debe estar entre 2 y 32". Real federations
-- routinely exceed that (60+, 100+ teams in regional cups), so the cap
-- gets in the way more than it protects.
--
-- New rule: keep the floor of 2 (a "tournament" with 1 team has no
-- semantics) and bump the ceiling to 9999 — high enough that no real
-- volley tournament will ever hit it, low enough that an accidental
-- typo like "200000" still bounces. The matching ceiling lives in
-- `tournament.service.ts` validateData (mirrored at 9999) and in the
-- `tournament-form/validate.ts` MAX_TEAMS constant on the frontend.
--
-- Why a DO block: Postgres auto-named the original CHECK constraint
-- (something like `tournaments_teams_count_check`), but the exact name
-- depends on the order columns/constraints were declared. Looking it
-- up dynamically by table + content keeps this migration safe to run
-- even if a previous environment had a renamed constraint.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  WHERE cls.relname = 'tournaments'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%teams_count%';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE tournaments DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_teams_count_check
  CHECK (teams_count >= 2 AND teams_count <= 9999);
