-- Migration 038: secondary tournament phase (triangulars)
-- Allows a configurable second group stage between primary groups and bracket.
-- Stored as JSONB: { enabled: bool, groupsPerDivision: int, teamsPerGroup: int, classifiersPerGroup: int }
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS secondary_phase JSONB DEFAULT NULL;
