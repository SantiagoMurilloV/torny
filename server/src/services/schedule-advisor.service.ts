/**
 * Schedule advisor — deterministic metrics + AI (Groq) recommendations.
 *
 * Design: an LLM is BAD at hard combinatorial scheduling (it hallucinates
 * times and double-books). So we never ask it to build the schedule —
 * that's the deterministic engine's job (fixture generation + the
 * interval-based conflict repair). Instead we compute objective metrics
 * here and hand them to Groq, which adds the "business + sport
 * intelligence" layer: a prioritized, human-readable assessment of what's
 * wrong and what to change.
 *
 * The deterministic analysis is also useful on its own — if Groq isn't
 * configured we still return the metrics so the admin sees the facts.
 */

import { getPool } from '../config/database';
import { NotFoundError } from '../middleware/errorHandler';
import { intervalsOverlap } from './match.service';
import { groqChat, isGroqConfigured, groqModel } from './groq.service';

// ── Tunable thresholds ────────────────────────────────────────────────
// Minutes of rest a team should get between the END of one match and the
// START of the next. Below this we flag "sin descanso".
const MIN_REST_MIN = 20;
// A team idle longer than this (same day, between two of its matches) is
// "esperando demasiado" — bad experience, worth flagging.
const MAX_IDLE_MIN = 5 * 60;
// More than this many matches for one team in a single day is a fatigue
// risk worth surfacing.
const MAX_MATCHES_PER_TEAM_PER_DAY = 4;

export interface AdvisorMatch {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  court: string;
  team1Id: string | null;
  team2Id: string | null;
  team1Name: string;
  team2Name: string;
  category: string;
  phase: string;
  durationMin: number;
  status: string;
}

export interface ScheduleAnalysis {
  totalMatches: number;
  days: number;
  courts: number;
  /** Same team or same court overlapping in time (should be 0 post-repair). */
  overlaps: Array<{
    kind: 'equipo' | 'cancha';
    subject: string;
    date: string;
    a: string;
    b: string;
  }>;
  /** Team plays again with < MIN_REST_MIN of rest. */
  restViolations: Array<{
    team: string;
    date: string;
    gapMin: number;
    between: string;
  }>;
  /** Team idle > MAX_IDLE_MIN between two same-day matches. */
  longIdleGaps: Array<{ team: string; date: string; gapMin: number }>;
  /** Team with too many matches in one day. */
  heavyDays: Array<{ team: string; date: string; count: number }>;
  /** Matches per court — surfaces imbalance. */
  courtLoad: Array<{ court: string; count: number }>;
  /** Counts so the UI and the prompt can lead with the headline numbers. */
  counts: {
    overlaps: number;
    restViolations: number;
    longIdleGaps: number;
    heavyDays: number;
  };
}

const SAMPLE_CAP = 12; // cap per-issue lists so the prompt stays compact

function parseHHMM(raw: string): number {
  const [h, m] = (raw ?? '').split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

/**
 * Pure analysis over a match list. No DB, no AI — deterministic and unit
 * tested. Only considers matches with two resolved teams and a valid time
 * (bracket placeholders / TBD slots are skipped for team-centric checks).
 */
export function analyzeScheduleData(matches: AdvisorMatch[]): ScheduleAnalysis {
  const dates = new Set<string>();
  const courtSet = new Set<string>();
  for (const m of matches) {
    if (m.date) dates.add(m.date);
    if (m.court) courtSet.add(m.court);
  }

  // ── Overlaps (team + court) via real intervals ──────────────────────
  const overlaps: ScheduleAnalysis['overlaps'] = [];
  // Bucket by date so we only compare same-day matches.
  const byDate = new Map<string, AdvisorMatch[]>();
  for (const m of matches) {
    if (!m.date) continue;
    (byDate.get(m.date) ?? byDate.set(m.date, []).get(m.date)!).push(m);
  }
  const label = (m: AdvisorMatch) =>
    `${m.team1Name} vs ${m.team2Name} (${m.time} ${m.court})`;
  for (const [date, dayMatches] of byDate) {
    for (let i = 0; i < dayMatches.length; i++) {
      for (let j = i + 1; j < dayMatches.length; j++) {
        const a = dayMatches[i];
        const b = dayMatches[j];
        const as = parseHHMM(a.time);
        const bs = parseHHMM(b.time);
        if (as < 0 || bs < 0) continue;
        if (!intervalsOverlap(as, as + a.durationMin, bs, bs + b.durationMin)) continue;
        const sharedTeam =
          (a.team1Id && (a.team1Id === b.team1Id || a.team1Id === b.team2Id)) ||
          (a.team2Id && (a.team2Id === b.team1Id || a.team2Id === b.team2Id));
        if (sharedTeam) {
          overlaps.push({ kind: 'equipo', subject: 'equipo compartido', date, a: label(a), b: label(b) });
        } else if (a.court && a.court === b.court) {
          overlaps.push({ kind: 'cancha', subject: a.court, date, a: label(a), b: label(b) });
        }
      }
    }
  }

  // ── Per-team timelines for rest / idle / load ───────────────────────
  type Appearance = { date: string; start: number; end: number; time: string };
  const teamTimeline = new Map<string, Appearance[]>();
  const teamName = new Map<string, string>();
  const add = (id: string | null, name: string, m: AdvisorMatch) => {
    if (!id) return;
    teamName.set(id, name);
    const start = parseHHMM(m.time);
    if (start < 0) return;
    const list = teamTimeline.get(id) ?? teamTimeline.set(id, []).get(id)!;
    list.push({ date: m.date, start, end: start + m.durationMin, time: m.time });
  };
  for (const m of matches) {
    add(m.team1Id, m.team1Name, m);
    add(m.team2Id, m.team2Name, m);
  }

  const restViolations: ScheduleAnalysis['restViolations'] = [];
  const longIdleGaps: ScheduleAnalysis['longIdleGaps'] = [];
  const heavyDays: ScheduleAnalysis['heavyDays'] = [];

  for (const [id, appsRaw] of teamTimeline) {
    const name = teamName.get(id) ?? 'Equipo';
    const apps = appsRaw.slice().sort((x, y) =>
      x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.start - y.start,
    );
    // Per-day count
    const perDay = new Map<string, number>();
    for (const a of apps) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
    for (const [date, count] of perDay) {
      if (count > MAX_MATCHES_PER_TEAM_PER_DAY) heavyDays.push({ team: name, date, count });
    }
    // Consecutive same-day gaps
    for (let i = 1; i < apps.length; i++) {
      const prev = apps[i - 1];
      const cur = apps[i];
      if (prev.date !== cur.date) continue;
      const gap = cur.start - prev.end; // minutes of rest between matches
      if (gap < MIN_REST_MIN) {
        restViolations.push({
          team: name,
          date: cur.date,
          gapMin: gap,
          between: `${prev.time} → ${cur.time}`,
        });
      } else if (gap > MAX_IDLE_MIN) {
        longIdleGaps.push({ team: name, date: cur.date, gapMin: gap });
      }
    }
  }

  // ── Court load ──────────────────────────────────────────────────────
  const courtCount = new Map<string, number>();
  for (const m of matches) {
    if (!m.court) continue;
    courtCount.set(m.court, (courtCount.get(m.court) ?? 0) + 1);
  }
  const courtLoad = [...courtCount.entries()]
    .map(([court, count]) => ({ court, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalMatches: matches.length,
    days: dates.size,
    courts: courtSet.size,
    overlaps: overlaps.slice(0, SAMPLE_CAP),
    restViolations: restViolations.slice(0, SAMPLE_CAP),
    longIdleGaps: longIdleGaps.slice(0, SAMPLE_CAP),
    heavyDays: heavyDays.slice(0, SAMPLE_CAP),
    courtLoad,
    counts: {
      overlaps: overlaps.length,
      restViolations: restViolations.length,
      longIdleGaps: longIdleGaps.length,
      heavyDays: heavyDays.length,
    },
  };
}

export interface AdvisorRecommendation {
  priority: 'alta' | 'media' | 'baja';
  issue: string;
  suggestion: string;
}

export interface ScheduleAdvice {
  analysis: ScheduleAnalysis;
  /** Natural-language assessment from Groq (empty when AI unavailable). */
  summary: string;
  recommendations: AdvisorRecommendation[];
  /** 'groq' when the AI ran; 'metrics-only' when the key isn't set / failed. */
  source: 'groq' | 'metrics-only';
  model?: string;
}

/** Pull the tournament's matches in advisor shape. */
async function loadAdvisorMatches(tournamentId: string): Promise<{
  tournamentName: string;
  matches: AdvisorMatch[];
}> {
  const pool = getPool();
  const tRes = await pool.query<{
    name: string;
    match_duration_minutes: number | null;
    match_durations_by_category: Record<string, number> | null;
  }>(
    `SELECT name, match_duration_minutes, match_durations_by_category
       FROM tournaments WHERE id = $1`,
    [tournamentId],
  );
  if (tRes.rows.length === 0) throw new NotFoundError('Torneo');
  const globalDuration = tRes.rows[0].match_duration_minutes ?? 60;
  const byCategory = tRes.rows[0].match_durations_by_category ?? {};
  const durationFor = (cat: string): number => {
    const d = byCategory[cat];
    return typeof d === 'number' && d > 0 ? d : globalDuration;
  };

  const mRes = await pool.query<{
    id: string;
    date: string;
    time: string;
    court: string | null;
    team1_id: string | null;
    team2_id: string | null;
    team1_name: string | null;
    team2_name: string | null;
    phase: string | null;
    group_name: string | null;
    status: string;
  }>(
    `SELECT m.id, m.date::text AS date, m.time, m.court,
            m.team1_id, m.team2_id,
            t1.name AS team1_name, t2.name AS team2_name,
            m.phase, m.group_name, m.status
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       WHERE m.tournament_id = $1
       ORDER BY m.date, m.time`,
    [tournamentId],
  );

  const extractCategory = (groupName: string | null, phase: string | null): string => {
    const raw = groupName || phase || '';
    const idx = raw.indexOf('|');
    return idx > 0 ? raw.slice(0, idx) : raw;
  };

  const matches: AdvisorMatch[] = mRes.rows.map((r) => {
    const category = extractCategory(r.group_name, r.phase);
    return {
      id: r.id,
      date: (r.date ?? '').slice(0, 10),
      time: r.time ?? '',
      court: r.court ?? '',
      team1Id: r.team1_id,
      team2Id: r.team2_id,
      team1Name: r.team1_name ?? 'Por definir',
      team2Name: r.team2_name ?? 'Por definir',
      category,
      phase: r.phase ?? '',
      durationMin: durationFor(category),
      status: r.status,
    };
  });

  return { tournamentName: tRes.rows[0].name, matches };
}

const SYSTEM_PROMPT = `Eres un experto en programación (fixturing) de torneos deportivos. Recibirás MÉTRICAS YA CALCULADAS de un cronograma (no inventes datos nuevos ni horarios). Tu trabajo es interpretar esas métricas con criterio deportivo y de negocio, y dar recomendaciones accionables.

Criterios deportivos/negocio a considerar:
- Ningún equipo debe jugar partidos solapados; las canchas no se duplican.
- Los equipos necesitan descanso entre partidos (idealmente 20+ min); no deben jugar demasiados partidos por día (fatiga).
- Evitar que un equipo espere horas muertas entre sus partidos (mala experiencia).
- Balancear el uso de canchas.
- Las finales y partidos decisivos deberían ir en buen horario (cierre del día) y en la cancha principal.

Responde ÚNICAMENTE con un objeto JSON válido con esta forma:
{
  "summary": "diagnóstico breve en 2-4 frases, español colombiano formal (usted)",
  "recommendations": [
    { "priority": "alta|media|baja", "issue": "qué problema", "suggestion": "qué hacer, concreto" }
  ]
}
Prioriza por impacto: solapamientos = alta. Si todo está bien, dilo y devuelve recommendations vacío o de prioridad baja.`;

/**
 * Full advisor pass: deterministic analysis + Groq interpretation.
 * Degrades to metrics-only (no AI prose) when Groq isn't configured or
 * errors out, so the endpoint never fails just because the LLM is down.
 */
export async function adviseSchedule(tournamentId: string): Promise<ScheduleAdvice> {
  const { tournamentName, matches } = await loadAdvisorMatches(tournamentId);
  const analysis = analyzeScheduleData(matches);

  if (!isGroqConfigured()) {
    return { analysis, summary: '', recommendations: [], source: 'metrics-only' };
  }

  const userPayload = {
    torneo: tournamentName,
    resumen: {
      partidos: analysis.totalMatches,
      dias: analysis.days,
      canchas: analysis.courts,
      solapamientos: analysis.counts.overlaps,
      sinDescanso: analysis.counts.restViolations,
      esperasLargas: analysis.counts.longIdleGaps,
      diasCargados: analysis.counts.heavyDays,
    },
    detalle: {
      solapamientos: analysis.overlaps,
      sinDescanso: analysis.restViolations,
      esperasLargas: analysis.longIdleGaps,
      diasCargados: analysis.heavyDays,
      cargaPorCancha: analysis.courtLoad,
    },
  };

  try {
    const raw = await groqChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      { json: true, temperature: 0.3, maxTokens: 1200 },
    );
    const parsed = JSON.parse(raw) as {
      summary?: string;
      recommendations?: AdvisorRecommendation[];
    };
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .filter((r) => r && r.issue && r.suggestion)
          .map((r) => ({
            priority: (['alta', 'media', 'baja'] as const).includes(r.priority)
              ? r.priority
              : 'media',
            issue: String(r.issue),
            suggestion: String(r.suggestion),
          }))
      : [];
    return {
      analysis,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      recommendations,
      source: 'groq',
      model: groqModel(),
    };
  } catch (err) {
    console.warn('[schedule-advisor] Groq failed, returning metrics only:', (err as Error).message);
    return { analysis, summary: '', recommendations: [], source: 'metrics-only' };
  }
}
