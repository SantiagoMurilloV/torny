/**
 * Torny IA — Agente orquestador con skills (Phase C).
 *
 * Implementa un loop agentico sobre DeepSeek function calling:
 *   1. Recibe mensajes del admin
 *   2. Envía a DeepSeek con las tools disponibles
 *   3. Si DeepSeek invoca tools → las ejecuta internamente
 *   4. Devuelve el resultado + log de acciones ejecutadas
 *
 * Aislamiento estricto: cada llamada recibe el `userId` del JWT y
 * las tools que acceden a datos solo leen/escriben recursos de ese admin.
 */

import { getPool } from '../config/database';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const MODEL = 'deepseek-chat';
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY = 16;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface ActionLog {
  tool: string;
  label: string;
  success: boolean;
  detail?: string;
}

export interface AgentResponse {
  message: string;
  actionsExecuted: ActionLog[];
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_my_tournaments',
      description: 'Obtiene la lista de torneos del administrador con sus estadísticas actuales (equipos inscritos, partidos completados, estado).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tournament_details',
      description: 'Obtiene todos los detalles de un torneo específico: equipos inscritos, partidos por fase, standings actuales.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_team',
      description: 'Crea un nuevo equipo en la plataforma.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del equipo' },
          initials: { type: 'string', description: 'Siglas del equipo (2-4 letras)' },
          city: { type: 'string', description: 'Ciudad del equipo' },
          category: { type: 'string', description: 'Categoría (ej: Mayores Femenino, Sub-18)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enroll_team',
      description: 'Inscribe un equipo existente en un torneo.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
          team_id: { type: 'string', description: 'ID del equipo a inscribir' },
        },
        required: ['tournament_id', 'team_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_groups',
      description: 'Genera automáticamente los grupos y el calendario de partidos para la fase inicial del torneo.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_triangulars',
      description: 'Genera los grupos triangulares (Copa Oro y Copa Plata) después de que terminan los grupos principales. Solo aplica a torneos con fase secundaria habilitada.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_triangulars',
      description: 'Finaliza los triangulares y genera automáticamente los partidos de semifinales usando los ganadores de cada grupo triangular.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_standings',
      description: 'Obtiene la tabla de posiciones actual de un torneo.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recalculate_standings',
      description: 'Recalcula la tabla de posiciones y los cruces del torneo.',
      parameters: {
        type: 'object',
        properties: {
          tournament_id: { type: 'string', description: 'ID del torneo' },
        },
        required: ['tournament_id'],
      },
    },
  },
] as const;

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, string>,
  userId: string,
): Promise<{ result: unknown; label: string }> {
  const pool = getPool();

  switch (toolName) {
    case 'get_my_tournaments': {
      const res = await pool.query(
        `SELECT t.id, t.name, t.sport, t.format, t.status, t.teams_count,
                t.start_date, t.end_date,
                (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) as enrolled,
                (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) as total_matches,
                (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.status = 'completed') as completed_matches
         FROM tournaments t
         WHERE t.owner_id = $1
         ORDER BY t.created_at DESC`,
        [userId],
      );
      return {
        label: `Torneos consultados: ${res.rows.length}`,
        result: res.rows,
      };
    }

    case 'get_tournament_details': {
      const { tournament_id } = args;
      // Verify ownership
      const own = await pool.query(
        'SELECT id, name, format, status, teams_count, bracket_mode FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Torneo no encontrado', result: { error: 'No autorizado o no encontrado' } };

      const teams = await pool.query(
        `SELECT t.id, t.name FROM tournament_teams tt
         JOIN teams t ON t.id = tt.team_id
         WHERE tt.tournament_id = $1 ORDER BY t.name`,
        [tournament_id],
      );
      const phases = await pool.query(
        `SELECT phase, COUNT(*) as total,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as done
         FROM matches WHERE tournament_id = $1 GROUP BY phase`,
        [tournament_id],
      );
      return {
        label: `Detalles de ${own.rows[0].name}`,
        result: { tournament: own.rows[0], teams: teams.rows, phases: phases.rows },
      };
    }

    case 'create_team': {
      const { name, initials, city, category } = args;
      const res = await pool.query(
        `INSERT INTO teams (name, initials, city, category, owner_id, primary_color, secondary_color)
         VALUES ($1, $2, $3, $4, $5, '#E53E3E', '#C53030')
         RETURNING id, name`,
        [name, initials ?? name.slice(0, 3).toUpperCase(), city ?? null, category ?? null, userId],
      );
      return { label: `Equipo creado: ${name}`, result: res.rows[0] };
    }

    case 'enroll_team': {
      const { tournament_id, team_id } = args;
      const own = await pool.query(
        'SELECT id FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso al torneo', result: { error: 'No autorizado' } };
      await pool.query(
        'INSERT INTO tournament_teams (tournament_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [tournament_id, team_id],
      );
      return { label: `Equipo inscrito en el torneo`, result: { success: true } };
    }

    case 'generate_groups': {
      const { tournament_id } = args;
      const own = await pool.query(
        'SELECT id, name FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso', result: { error: 'No autorizado' } };
      // Call the fixture generator service internally
      const { fixtureGenerator } = await import('./fixture.service');
      const result = await fixtureGenerator.generate(tournament_id);
      return { label: `Grupos generados en "${own.rows[0].name}"`, result };
    }

    case 'generate_triangulars': {
      const { tournament_id } = args;
      const own = await pool.query(
        'SELECT id, name FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso', result: { error: 'No autorizado' } };
      const { generateSecondaryPhase } = await import('./secondary-phase.service');
      const result = await generateSecondaryPhase(tournament_id);
      return { label: `Triangulares generados en "${own.rows[0].name}"`, result };
    }

    case 'finalize_triangulars': {
      const { tournament_id } = args;
      const own = await pool.query(
        'SELECT id, name FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso', result: { error: 'No autorizado' } };
      const { finalizeSecondaryPhase } = await import('./secondary-phase.service');
      const result = await finalizeSecondaryPhase(tournament_id);
      return { label: `Semifinales generadas en "${own.rows[0].name}"`, result };
    }

    case 'get_standings': {
      const { tournament_id } = args;
      const own = await pool.query(
        'SELECT id, name FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso', result: { error: 'No autorizado' } };
      const res = await pool.query(
        `SELECT s.group_name, s.position, t.name as team_name,
                s.played, s.wins, s.losses, s.sets_for, s.sets_against, s.points
         FROM standings s JOIN teams t ON t.id = s.team_id
         WHERE s.tournament_id = $1
         ORDER BY s.group_name, s.position`,
        [tournament_id],
      );
      return { label: `Standings de "${own.rows[0].name}"`, result: res.rows };
    }

    case 'recalculate_standings': {
      const { tournament_id } = args;
      const own = await pool.query(
        'SELECT id, name FROM tournaments WHERE id = $1 AND owner_id = $2',
        [tournament_id, userId],
      );
      if (!own.rows.length) return { label: 'Sin acceso', result: { error: 'No autorizado' } };
      const { standingsCalculator } = await import('./standings.service');
      await standingsCalculator.recalculate(tournament_id);
      return { label: `Tabla recalculada en "${own.rows[0].name}"`, result: { success: true } };
    }

    default:
      return { label: `Tool desconocida: ${toolName}`, result: { error: 'Tool no implementada' } };
  }
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildAgentSystemPrompt(username: string, currentPage?: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `Eres Torny IA, el asistente personal del administrador "${username}" en la plataforma Torny.
Hoy es ${today}.${currentPage ? `\nEl administrador está en: ${currentPage}` : ''}

IDIOMA: Responde SIEMPRE en español colombiano formal. Usa "usted". Tono profesional, cálido y conciso.

ROL:
- Ayudar a gestionar sus torneos
- Ejecutar acciones cuando el admin lo solicite (tienes tools disponibles)
- Guiar paso a paso en el uso de la plataforma
- Responder preguntas sobre sus torneos con datos reales

HERRAMIENTAS DISPONIBLES:
- Consultar lista de torneos
- Ver detalles de un torneo específico
- Crear equipos nuevos
- Inscribir equipos en torneos
- Generar grupos y calendario
- Generar triangulares (Copa Oro / Plata)
- Finalizar triangulares y generar semifinales
- Ver tabla de posiciones
- Recalcular tabla y cruces

REGLAS ESTRICTAS:
1. Solo tienes acceso a los torneos de ESTE administrador
2. Antes de ejecutar acciones destructivas, confirma con el admin
3. Si el admin pide algo que no puedes hacer con las tools disponibles, explica cómo hacerlo manualmente
4. Nunca muestres IDs técnicos al usuario — usa nombres legibles
5. Cuando ejecutes una tool, informa brevemente qué hiciste y el resultado`;
}

// ── Agentic loop ──────────────────────────────────────────────────────────────

interface DeepSeekMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export async function runAgentLoop(
  userId: string,
  username: string,
  messages: AgentMessage[],
  currentPage?: string,
): Promise<AgentResponse> {
  const apiKey = DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada');

  const actionsExecuted: ActionLog[] = [];
  const systemPrompt = buildAgentSystemPrompt(username, currentPage);

  // Build initial message array for DeepSeek
  let dsMessages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-MAX_HISTORY).map((m) => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    })),
  ];

  // Agentic loop — max MAX_TOOL_ITERATIONS rounds
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    let res: Response;
    try {
      res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: dsMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.4,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      console.error(`[AgentLoop iter=${iter}] DeepSeek error ${res.status}:`, err);
      throw new Error(`DeepSeek API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        finish_reason: string;
        message: DeepSeekMessage;
      }>;
    };

    const choice = data.choices[0];
    const assistantMsg = choice.message;

    // Add assistant message to history
    dsMessages.push(assistantMsg);

    // If no tool calls → final answer
    if (choice.finish_reason !== 'tool_calls' || !assistantMsg.tool_calls?.length) {
      return {
        message: assistantMsg.content ?? 'Sin respuesta.',
        actionsExecuted,
      };
    }

    // Execute tool calls
    for (const tc of assistantMsg.tool_calls) {
      let toolResult: unknown;
      let toolLabel = tc.function.name;
      let success = true;

      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, string>;
        const { result, label } = await executeTool(tc.function.name, args, userId);
        toolResult = result;
        toolLabel = label;
      } catch (err) {
        toolResult = { error: String(err) };
        success = false;
        toolLabel = `Error en ${tc.function.name}`;
      }

      actionsExecuted.push({
        tool: tc.function.name,
        label: toolLabel,
        success,
        detail: typeof toolResult === 'object' ? JSON.stringify(toolResult).slice(0, 200) : String(toolResult),
      });

      // Add tool result to messages
      dsMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return {
    message: 'He ejecutado las acciones solicitadas. ¿Hay algo más en lo que pueda ayudarle?',
    actionsExecuted,
  };
}
