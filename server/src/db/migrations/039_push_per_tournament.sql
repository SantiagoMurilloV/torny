-- Migration 039: per-tournament push subscriptions
--
-- Previously, a single subscription row (keyed by endpoint) received
-- ALL tournament notifications via sendToAll(). This was noisy — a
-- spectator who opened Tournament A got notifications for Tournament B, C…
--
-- New model:
--   · Add tournament_id to push_subscriptions (nullable FK).
--   · A device subscribes once per tournament it wants to follow.
--   · Global subscriptions (club captains) keep tournament_id = NULL.
--   · sendToTournament(id) replaces sendToAll() for match events.
--
-- Unique constraints:
--   · (endpoint) WHERE tournament_id IS NULL  → one global per device
--   · (endpoint, tournament_id) WHERE tournament_id IS NOT NULL → one per device per tournament

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE;

-- Drop the old blanket unique on endpoint (allows per-tournament duplicates)
ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

-- Partial unique: global subscriptions (club captains)
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_global_uniq
  ON push_subscriptions (endpoint)
  WHERE tournament_id IS NULL;

-- Partial unique: per-tournament subscriptions
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_tournament_uniq
  ON push_subscriptions (endpoint, tournament_id)
  WHERE tournament_id IS NOT NULL;

-- Index for efficient tournament-scoped dispatch
CREATE INDEX IF NOT EXISTS push_subscriptions_tournament_id_idx
  ON push_subscriptions (tournament_id)
  WHERE tournament_id IS NOT NULL;
