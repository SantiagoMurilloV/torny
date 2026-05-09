import { getActiveUserIds, getActiveVisitorsCount } from './presence';
import { getPool } from '../config/database';

/**
 * Telegram reporter de presencia.
 *
 * Lee el snapshot in-memory de `presence.ts` (usuarios autenticados +
 * visitantes anónimos), enriquece con un breakdown por rol consultando
 * la tabla `users`, y manda un mensaje formateado al chat de Santiago
 * via Telegram Bot API.
 *
 * Configurable via env vars (todas opcionales, defaults razonables):
 *
 *   TELEGRAM_BOT_TOKEN          (requerido — sin esto, no manda nada)
 *   TELEGRAM_CHAT_ID            (requerido — chat de destino)
 *   PRESENCE_REPORT_INTERVAL_MIN  default 30  — cada cuánto reportar
 *   PRESENCE_REPORT_SKIP_EMPTY    default true — no reportar si activos === 0
 *   PRESENCE_REPORT_QUIET         default '23-6' — formato 'HH-HH' COT,
 *                                  no manda dentro de esa franja
 *   PRESENCE_SPIKE_THRESHOLD      default 10  — diferencia que rompe el
 *                                  silencio (quiet hours, smart skip)
 *
 * El reporte INICIAL al boot del server se manda 60s después del start —
 * esto deja un buffer para que el container caliente y para que la primer
 * lectura no sea siempre "0 usuarios" antes de que entre tráfico real.
 *
 * Sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID, el módulo no hace nada
 * (no rompe el boot).
 */

interface PresenceReport {
  total: number;
  activeUsers: number;
  activeVisitors: number;
  byRole: {
    super_admin: number;
    admin: number;
    judge: number;
    team_captain: number;
  };
  delta: number | null; // null en el primer reporte
}

interface ReporterState {
  lastReportedTotal: number | null;
  lastReportTimestamp: number | null;
}

const state: ReporterState = {
  lastReportedTotal: null,
  lastReportTimestamp: null,
};

function getInterval(): number {
  const raw = process.env.PRESENCE_REPORT_INTERVAL_MIN;
  const parsed = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function getSkipEmpty(): boolean {
  const raw = (process.env.PRESENCE_REPORT_SKIP_EMPTY ?? 'true').toLowerCase();
  return raw !== 'false' && raw !== '0';
}

function getQuietHours(): { start: number; end: number } | null {
  const raw = process.env.PRESENCE_REPORT_QUIET ?? '23-6';
  const m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (start === end) return null;
  return { start, end };
}

function getSpikeThreshold(): number {
  const raw = process.env.PRESENCE_SPIKE_THRESHOLD;
  const parsed = raw ? parseInt(raw, 10) : 10;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

/** Hora actual en zona horaria de Bogotá (COT, UTC-5). */
function nowInBogota(): { hour: number; date: Date } {
  // toLocaleString con timeZone produce el string local; lo parseamos
  // de vuelta a Date para sacar el hour confiable.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const hourStr = fmt.format(new Date()); // "HH" (00-23)
  return { hour: parseInt(hourStr, 10), date: new Date() };
}

function isQuietHour(): boolean {
  const window = getQuietHours();
  if (!window) return false;
  const { hour } = nowInBogota();
  // Si start > end, la ventana cruza medianoche (ej. 23-6 = 23, 0, 1...5)
  if (window.start > window.end) {
    return hour >= window.start || hour < window.end;
  }
  return hour >= window.start && hour < window.end;
}

/** Escape para Markdown V2 de Telegram (chars reservados). */
function escapeMd(text: string | number): string {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Cuenta los usuarios activos discriminando por rol — query a la tabla
 * `users` con el set de IDs activos. Si la query falla, devuelve ceros.
 */
async function countByRole(activeIds: Set<string>): Promise<PresenceReport['byRole']> {
  const empty = { super_admin: 0, admin: 0, judge: 0, team_captain: 0 };
  if (activeIds.size === 0) return empty;

  try {
    const idList = Array.from(activeIds);
    const result = await getPool().query<{ role: string; count: string }>(
      `SELECT role, COUNT(*) AS count FROM users WHERE id = ANY($1::uuid[]) GROUP BY role`,
      [idList],
    );
    const out = { ...empty };
    for (const row of result.rows) {
      const role = row.role as keyof PresenceReport['byRole'];
      if (role in out) {
        out[role] = parseInt(row.count, 10);
      }
    }
    return out;
  } catch (err) {
    console.error('[telegram-reporter] countByRole failed:', err);
    return empty;
  }
}

/** Genera el snapshot completo (presencia + roles + delta). */
async function snapshot(): Promise<PresenceReport> {
  const activeIds = getActiveUserIds();
  const activeVisitors = getActiveVisitorsCount();
  const byRole = await countByRole(activeIds);
  const total = activeIds.size + activeVisitors;
  const delta = state.lastReportedTotal !== null ? total - state.lastReportedTotal : null;
  return {
    total,
    activeUsers: activeIds.size,
    activeVisitors,
    byRole,
    delta,
  };
}

/** Construye el mensaje MarkdownV2 a partir del snapshot. */
function formatMessage(r: PresenceReport): string {
  const fmt = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
  const hora = fmt.format(new Date());

  const roleLines: string[] = [];
  if (r.byRole.super_admin > 0) roleLines.push(`  • ${r.byRole.super_admin} super admin`);
  if (r.byRole.admin > 0) roleLines.push(`  • ${r.byRole.admin} admin${r.byRole.admin > 1 ? 's' : ''}`);
  if (r.byRole.judge > 0) roleLines.push(`  • ${r.byRole.judge} juez/jueces`);
  if (r.byRole.team_captain > 0) roleLines.push(`  • ${r.byRole.team_captain} capitán/capitanes`);

  const usersBlock = r.activeUsers > 0
    ? `👥 *${escapeMd(r.activeUsers)} usuarios autenticados*:\n${roleLines.map(escapeMd).join('\n')}`
    : `👥 0 usuarios autenticados`;

  const deltaLine = r.delta !== null
    ? r.delta === 0
      ? `\n\n📊 Sin cambios desde el último reporte`
      : r.delta > 0
        ? `\n\n📈 \\+${escapeMd(r.delta)} desde el último reporte`
        : `\n\n📉 ${escapeMd(r.delta)} desde el último reporte`
    : '';

  return (
    `🏐 *Torny — Estado en vivo*\n\n` +
    `${usersBlock}\n` +
    `👁 ${escapeMd(r.activeVisitors)} espectador${r.activeVisitors === 1 ? '' : 'es'}` +
    deltaLine +
    `\n\n🕐 ${escapeMd(hora)} \\(COT\\)`
  );
}

/** Envía el mensaje a Telegram. Silencioso si falta config o si la API falla. */
async function send(message: string): Promise<void> {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        disable_notification: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[telegram-reporter] sendMessage non-OK:', res.status, body.slice(0, 200));
    }
  } catch (err) {
    console.error('[telegram-reporter] send error:', err);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Toma snapshot, decide si reporta (smart skip + quiet hours + spike),
 * y envía. Llamado por el setInterval y exportado para uso ad-hoc.
 */
export async function reportPresence(): Promise<void> {
  try {
    const r = await snapshot();
    const skipEmpty = getSkipEmpty();
    const quiet = isQuietHour();
    const spike = state.lastReportedTotal !== null
      && r.total - state.lastReportedTotal >= getSpikeThreshold();

    // Spike rompe cualquier filtro — es alerta proactiva.
    if (!spike) {
      if (skipEmpty && r.total === 0) return;
      if (quiet) return;
    }

    const msg = formatMessage(r);
    await send(msg);
    state.lastReportedTotal = r.total;
    state.lastReportTimestamp = Date.now();
  } catch (err) {
    console.error('[telegram-reporter] reportPresence error:', err);
  }
}

/**
 * Arranca el cron interno. Llamar UNA vez al boot del server después de
 * `startServer()`. Idempotente (si ya hay un timer activo, lo descarta
 * antes de crear el nuevo).
 */
let timer: NodeJS.Timeout | null = null;

export function startPresenceReporter(): void {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) {
    console.log('[telegram-reporter] skipping — TELEGRAM_BOT_TOKEN o _CHAT_ID no configurados');
    return;
  }

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const intervalMin = getInterval();
  const intervalMs = intervalMin * 60 * 1000;

  // Primer reporte 60s después del boot — deja tiempo a que entre algo
  // de tráfico para no mandar siempre "0 usuarios" al startup.
  setTimeout(() => {
    void reportPresence();
  }, 60_000);

  timer = setInterval(() => {
    void reportPresence();
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[telegram-reporter] activo — reportes cada ${intervalMin} min, ` +
    `skipEmpty=${getSkipEmpty()}, quiet=${process.env.PRESENCE_REPORT_QUIET ?? '23-6'}, ` +
    `spikeThreshold=${getSpikeThreshold()}`,
  );
}

/** Para tests / shutdown. */
export function stopPresenceReporter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
