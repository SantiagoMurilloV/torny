-- Migration 040: purge legacy global push subscriptions
--
-- Context: mig 039 moved spectator notifications to a per-tournament model
-- (a device subscribes once per tournament it wants to follow). Every
-- subscription created BEFORE 039 is "global" (tournament_id IS NULL) and
-- predates that model, so under the new dispatch (`sendToTournament`) it
-- can never fire — it's dead weight that also kept the old
-- "everyone gets everything" behavior alive while two callers still used
-- sendToAll (autoLive + notifyAll, both fixed in the same change).
--
-- What we delete: global subscriptions that belong to nobody the new model
-- still pushes to — i.e. tournament_id IS NULL AND club_id IS NULL. These
-- are the old anonymous-spectator / admin global rows.
--
-- What we KEEP:
--   · Per-tournament subscriptions (tournament_id IS NOT NULL) — the new
--     model; spectators re-opted into a specific tournament.
--   · Club-captain global subscriptions (club_id IS NOT NULL) — still
--     actively used by sendToClub() for the parent-registration ping.
--
-- One-time cleanup. Tracked in _migrations so it runs exactly once.
DELETE FROM push_subscriptions
WHERE tournament_id IS NULL
  AND club_id IS NULL;
