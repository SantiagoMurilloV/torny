-- Migration 033: Tournament sponsors.
--
-- Each tournament can carry a list of sponsor logos that the admin
-- curates from the new "Patrocinadores" tab. The logos render in
-- the public Hero / Info tab (TBD when the FE surface is wired) so
-- visitors associate the brands with the event.
--
-- Schema decisions:
--   · One row per sponsor. `logo` is a base64 data URL (same
--     storage pattern as team logos / tournament cover) so
--     Railway's ephemeral FS doesn't lose them on redeploy.
--   · `name` is optional — many sponsors are recognisable from the
--     logo alone, and forcing a label would clutter dense rows.
--   · `link` is optional — clicking the logo opens it in a new tab
--     when present.
--   · `display_order` controls the render sequence. Defaults to
--     999 so a freshly added sponsor lands at the end; admin can
--     reorder by drag-drop later.
--   · `ON DELETE CASCADE` on tournament_id so deleting a torneo
--     drops its sponsor row cleanly.
--
-- Public consumers (GET /api/tournaments/:id/sponsors) cache the
-- response for ~30s — sponsors rarely change.

CREATE TABLE IF NOT EXISTS tournament_sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(160),
  logo TEXT NOT NULL,
  link VARCHAR(500),
  display_order INTEGER NOT NULL DEFAULT 999,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournament_sponsors_tournament_id_idx
  ON tournament_sponsors (tournament_id, display_order);
