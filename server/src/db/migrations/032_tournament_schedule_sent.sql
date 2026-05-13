-- Migration 032: Track when the admin published the schedule to the
-- enrolled clubs. The new "Enviar programación a clubes" button on the
-- admin Cronograma stamps this column with `NOW()` and fires push
-- notifications to every club captain whose team participates in the
-- torneo. The club panel then unlocks a read-only schedule view that
-- mirrors the public cronograma but filters to the club's own matches.
--
-- NULL means "not yet published" — the club panel shows an empty-state
-- message and the public cronograma is unaffected (the public view is
-- always visible regardless of this flag; the flag only gates the
-- club-panel mirror).
--
-- Safety:
--   · Pure additive (no NOT NULL, no DEFAULT computation).
--   · No backfill — every existing torneo starts as "no enviada".
--   · Used in reads only by `GET /api/clubs/me/tournaments` to expose
--     the timestamp to the club captain UI.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS schedule_sent_to_clubs_at TIMESTAMP WITH TIME ZONE;
