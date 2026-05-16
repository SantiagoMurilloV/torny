/**
 * Auto-Live Scheduler
 * -------------------
 * Background job that runs every minute checking for matches whose
 * scheduled date+time is approaching. Transitions them from 'upcoming'
 * to 'live' automatically, firing push notifications exactly like
 * the manual admin flow.
 *
 * Two safety mechanisms:
 *   1. Activates 3 minutes BEFORE the scheduled time so the match is
 *      already live when the clock hits the exact hour.
 *   2. Won't put a match live if there's ALREADY a live match on the
 *      same court in the same tournament — it waits until the previous
 *      match is marked completed (by the judge or admin).
 *
 * Runs once per server instance (on primary in cluster mode, or in
 * single-process mode). Idempotent: re-running the tick on a match
 * that's already live is a no-op (the WHERE clause excludes it).
 */

import { getPool } from '../config/database';
import { pushService, ensureReady as ensurePushReady } from './push.service';

// ── Configuration ────────────────────────────────────────────────────────────
// Check every 60 seconds by default; override with AUTO_LIVE_INTERVAL_SEC env.
const INTERVAL_SEC = parseInt(process.env.AUTO_LIVE_INTERVAL_SEC ?? '60', 10);

// How many minutes before the scheduled time to go live.
// Default: 3 minutes early so everything is ready when the clock hits.
const EARLY_MIN = parseInt(process.env.AUTO_LIVE_EARLY_MIN ?? '3', 10);

// Timezone for comparing times. The DB stores date (DATE) and time
// (VARCHAR HH:MM) without timezone. Default: Colombia (COT = UTC-5).
const TZ_OFFSET = process.env.AUTO_LIVE_TZ ?? 'America/Bogota';

let timer: NodeJS.Timeout | null = null;

/**
 * Add minutes to a {date, time} pair and return the new {date, time}.
 * Handles day overflow (e.g. 23:58 + 3min = next day 00:01).
 */
function addMinutes(
  dateStr: string,
  timeStr: string,
  minutes: number,
): { date: string; time: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
}

/**
 * Core tick: find all 'upcoming' matches where both teams are assigned
 * and the scheduled datetime (minus EARLY_MIN) has passed, BUT only if
 * there is no other 'live' match on the same court+tournament.
 */
async function tick(): Promise<void> {
  const pool = getPool();
  try {
    // Build "now + EARLY_MIN" in the tournament timezone so we activate
    // matches 3 minutes early.
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ_OFFSET,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
    const nowDate = `${p('year')}-${p('month')}-${p('day')}`;
    const nowTime = `${p('hour')}:${p('minute')}`;

    // Shift "now" forward by EARLY_MIN so a match at 10:00 goes live
    // at 09:57 (with default 3-minute early activation).
    const threshold = addMinutes(nowDate, nowTime, EARLY_MIN);

    // Step 1: Find candidate matches whose time has come.
    const candidates = await pool.query<{
      id: string;
      tournament_id: string;
      court: string;
    }>(
      `SELECT id, tournament_id, court
         FROM matches
        WHERE status = 'upcoming'
          AND team1_id IS NOT NULL
          AND team2_id IS NOT NULL
          AND (
            date < $1::date
            OR (date = $1::date AND time <= $2)
          )
        ORDER BY date, time`,
      [threshold.date, threshold.time],
    );

    if (candidates.rowCount === 0) return;

    // Step 2: Check which courts already have a live match.
    // We only need to check courts involved in the candidates.
    const courtTournamentPairs = candidates.rows.map(
      (r) => `${r.tournament_id}::${r.court}`,
    );
    const uniquePairs = [...new Set(courtTournamentPairs)];

    const busyCourts = new Set<string>();
    if (uniquePairs.length > 0) {
      // Get all courts that currently have a live match
      const liveOnCourts = await pool.query<{
        tournament_id: string;
        court: string;
      }>(
        `SELECT DISTINCT tournament_id, court
           FROM matches
          WHERE status = 'live'
            AND court IS NOT NULL`,
      );
      for (const row of liveOnCourts.rows) {
        busyCourts.add(`${row.tournament_id}::${row.court}`);
      }
    }

    // Step 3: Filter out matches whose court is busy.
    const eligible: string[] = [];
    const blocked: string[] = [];

    for (const row of candidates.rows) {
      const key = `${row.tournament_id}::${row.court}`;
      if (busyCourts.has(key)) {
        blocked.push(row.id);
      } else {
        eligible.push(row.id);
        // Mark this court as busy so that if two matches on the same
        // court are both candidates, only the first (earliest) goes live.
        busyCourts.add(key);
      }
    }

    if (blocked.length > 0) {
      console.log(
        `[auto-live] ${blocked.length} partido(s) esperando — cancha ocupada:`,
        blocked.map((id) => id.slice(0, 8)).join(', '),
      );
    }

    if (eligible.length === 0) return;

    // Step 4: Flip eligible matches to 'live'.
    const result = await pool.query<{ id: string; tournament_id: string }>(
      `UPDATE matches
          SET status = 'live', updated_at = NOW()
        WHERE id = ANY($1)
      RETURNING id, tournament_id`,
      [eligible],
    );

    console.log(
      `[auto-live] ${result.rowCount} partido(s) pasaron a EN VIVO:`,
      result.rows.map((r) => r.id.slice(0, 8)).join(', '),
    );

    // Fire push notifications for each match (best-effort, non-blocking)
    for (const row of result.rows) {
      firePush(row.id).catch((err) =>
        console.warn(`[auto-live] push failed for match ${row.id.slice(0, 8)}:`, err),
      );
    }
  } catch (err) {
    console.error('[auto-live] tick error:', err);
  }
}

/**
 * Send the "En vivo" push notification — mirrors the logic in
 * match.service.ts when admin manually sets status to 'live'.
 */
async function firePush(matchId: string): Promise<void> {
  const keys = await ensurePushReady();
  if (!keys) return;

  const pool = getPool();
  const result = await pool.query(
    `SELECT m.id, m.tournament_id,
            t1.name AS t1_name, t1.initials AS t1_initials,
            t2.name AS t2_name, t2.initials AS t2_initials
     FROM matches m
     LEFT JOIN teams t1 ON m.team1_id = t1.id
     LEFT JOIN teams t2 ON m.team2_id = t2.id
     WHERE m.id = $1`,
    [matchId],
  );

  if (result.rows.length === 0) return;

  const row = result.rows[0];
  const team1 = (row.t1_name as string) || (row.t1_initials as string) || 'Equipo 1';
  const team2 = (row.t2_name as string) || (row.t2_initials as string) || 'Equipo 2';
  const title = `${team1} vs ${team2}`;
  const url = `/match/${matchId}`;

  // Global notification
  await pushService.sendToAll({
    title: `${title} · En vivo`,
    body: '¡El partido acaba de comenzar!',
    url,
    tag: `match-live-${matchId}`,
    data: { matchId, type: 'match-live' },
  });

  // Club-specific notification
  try {
    const clubs = await pool.query<{ club_id: string }>(
      `SELECT DISTINCT t.club_id
         FROM matches m
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
         JOIN LATERAL (
           VALUES (t1.club_id), (t2.club_id)
         ) AS t(club_id) ON TRUE
        WHERE m.id = $1
          AND t.club_id IS NOT NULL`,
      [matchId],
    );
    for (const { club_id } of clubs.rows) {
      await pushService.sendToClub(club_id, {
        title: `${title} · En vivo`,
        body: 'Tu equipo está jugando ahora.',
        url,
        tag: `club-match-live-${matchId}`,
      });
    }
  } catch {
    // Club push is best-effort
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Immediately check if the next match on a specific court should go
 * live. Called right after a match is marked 'completed' so there's
 * zero delay — the next match appears as live the instant the judge
 * finalizes the previous one.
 *
 * Runs the same logic as the periodic tick but scoped to a single
 * tournament+court combination for speed.
 */
export async function activateNextOnCourt(
  tournamentId: string,
  court: string,
): Promise<void> {
  const pool = getPool();
  try {
    // Build threshold = now + EARLY_MIN
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ_OFFSET,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
    const nowDate = `${p('year')}-${p('month')}-${p('day')}`;
    const nowTime = `${p('hour')}:${p('minute')}`;
    const threshold = addMinutes(nowDate, nowTime, EARLY_MIN);

    // Verify no other match is still live on this court
    const busy = await pool.query(
      `SELECT 1 FROM matches
        WHERE tournament_id = $1 AND court = $2 AND status = 'live'
        LIMIT 1`,
      [tournamentId, court],
    );
    if ((busy.rowCount ?? 0) > 0) return; // court still occupied

    // Find the next upcoming match on this court whose time has come
    const result = await pool.query<{ id: string }>(
      `UPDATE matches
          SET status = 'live', updated_at = NOW()
        WHERE id = (
          SELECT id FROM matches
           WHERE tournament_id = $1
             AND court = $2
             AND status = 'upcoming'
             AND team1_id IS NOT NULL
             AND team2_id IS NOT NULL
             AND (
               date < $3::date
               OR (date = $3::date AND time <= $4)
             )
           ORDER BY date, time
           LIMIT 1
        )
      RETURNING id`,
      [tournamentId, court, threshold.date, threshold.time],
    );

    if (result.rowCount === 0) return;

    const matchId = result.rows[0].id;
    console.log(
      `[auto-live] partido ${matchId.slice(0, 8)} activado inmediatamente en ${court}`,
    );

    firePush(matchId).catch((err) =>
      console.warn(`[auto-live] push failed for match ${matchId.slice(0, 8)}:`, err),
    );
  } catch (err) {
    console.error('[auto-live] activateNextOnCourt error:', err);
  }
}

export function startAutoLive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const intervalMs = INTERVAL_SEC * 1000;

  // First tick 10s after boot (let connections settle)
  setTimeout(() => {
    void tick();
  }, 10_000);

  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[auto-live] activo — revisando cada ${INTERVAL_SEC}s, ` +
    `${EARLY_MIN}min antes de la hora, timezone=${TZ_OFFSET}`,
  );
}

export function stopAutoLive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
