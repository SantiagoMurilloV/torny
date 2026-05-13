-- Migration 034: Admin-tunable marquee speed for the sponsors strip.
--
-- The public carousel auto-scrolls at a fixed rate per element.
-- Each torneo now persists its own speed (seconds per full loop)
-- so brands that want a slow, premium feel can crank it up while
-- snappier events keep the default 40 s.
--
-- Range:
--   · 10  → very fast (legible only for big logos)
--   · 40  → DEFAULT (current behaviour)
--   · 180 → very slow (almost static)
--
-- The frontend clamps the slider to the CHECK range so an out-of-
-- range value from a malformed write never breaks the animation.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS sponsors_speed_seconds INTEGER
    DEFAULT 40
    CHECK (sponsors_speed_seconds IS NULL OR (sponsors_speed_seconds BETWEEN 10 AND 300));
