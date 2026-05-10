-- Migration 022: team ownership for multi-tenancy.
--
-- Context: tournaments already carry `owner_id` (mig 012) so the admin
-- dashboard scopes the listing per tenant. But teams were still global —
-- any admin could see, edit and delete every team in the system. This
-- migration closes that gap so each admin owns the teams they create
-- (their "team library"). Public spectator reads remain unscoped because
-- the team detail/match views need every team to render.
--
-- Backfill strategy: each legacy team is assigned to the admin of the
-- first tournament where it was enrolled. Teams that were never enrolled
-- (orphan rows) stay NULL and are visible only to super_admins, who can
-- re-assign them via SQL or platform tools later.
--
-- Why ON DELETE SET NULL: deleting an admin shouldn't cascade-delete
-- their teams (enrollments + matches would break). The team becomes
-- orphan and re-assignable.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teams_owner_id_idx ON teams(owner_id);

-- Backfill: team → admin of the first tournament it was enrolled in.
UPDATE teams t
SET owner_id = sub.owner_id
FROM (
  SELECT DISTINCT ON (tt.team_id) tt.team_id, tour.owner_id
  FROM tournament_teams tt
  JOIN tournaments tour ON tour.id = tt.tournament_id
  WHERE tour.owner_id IS NOT NULL
  ORDER BY tt.team_id, tt.id
) sub
WHERE t.id = sub.team_id AND t.owner_id IS NULL;
