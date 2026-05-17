-- Migration 037: revealed bracket phases
--
-- Lets the admin "reveal" bracket phases one at a time in the public
-- schedule. Before this, every upcoming bracket match was blurred until
-- it flipped to 'live'. Now the admin can click "Descubrir Cuartos" etc.
-- and the blur drops for that phase immediately — even if the match is
-- still 'upcoming'. Stored as a JSONB array of phase-bucket strings
-- (e.g. '["cuartos","semifinal"]').

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS revealed_phases JSONB DEFAULT '[]'::jsonb;
