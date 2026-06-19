import { getPool } from '../config/database';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';

export interface AdminChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdminAIResponse {
  message: string;
}

interface TournamentRow {
  id: string;
  name: string;
  sport: string;
  format: string;
  status: string;
  teams_count: number;
  start_date: string;
  end_date: string;
  secondary_phase: unknown;
  bracket_mode: string | null;
  gold_classifiers_per_group: number | null;
  silver_classifiers_per_group: number | null;
  enrolled_count: string;
  matches_count: string;
  completed_count: string;
}

interface UserRow {
  username: string;
  display_name: string | null;
}

interface DeepSeekChoice {
  message: { content: string };
}
interface DeepSeekResponse {
  choices: DeepSeekChoice[];
}

function buildSystemPrompt(
  userId: string,
  adminName: string,
  tournaments: TournamentRow[],
  currentPage?: string,
): string {
  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const tourneosSection =
    tournaments.length === 0
      ? 'Este administrador aún no tiene torneos creados.'
      : tournaments
          .map((t) => {
            const enrolled = parseInt(t.enrolled_count, 10);
            const matches = parseInt(t.matches_count, 10);
            const completed = parseInt(t.completed_count, 10);
            const startDate = t.start_date
              ? new Date(t.start_date).toLocaleDateString('es-CO')
              : 'Por definir';
            const endDate = t.end_date
              ? new Date(t.end_date).toLocaleDateString('es-CO')
              : 'Por definir';
            return [
              `- **${t.name}**`,
              `  Deporte: ${t.sport} | Estado: ${t.status} | Formato: ${t.format}`,
              `  Equipos: ${enrolled}/${t.teams_count} inscritos`,
              `  Partidos: ${completed}/${matches} completados`,
              `  Fechas: ${startDate} → ${endDate}`,
              t.bracket_mode ? `  Modo de cruce: ${t.bracket_mode}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n');

  const pageContext = currentPage
    ? `El administrador está actualmente en: ${currentPage}\n`
    : '';

  return `REGLA DE IDIOMA: Responde SIEMPRE en español colombiano formal. Usa "usted". Tono profesional y cálido.

Eres el asistente personal de Torny para el administrador ${adminName}.
Hoy es ${today}.
${pageContext}
## SUS TORNEOS ACTUALES

${tourneosSection}

## TU ROL
- Responder preguntas sobre sus torneos específicos
- Guiar paso a paso en el uso de la plataforma Torny
- Ayudar a resolver problemas operativos del torneo
- NUNCA revelar información de otros administradores

## CONOCIMIENTO DE LA PLATAFORMA TORNY

### Flujo de creación de torneo
1. Ir a "Torneos" → "Crear Torneo" → Aparece el asistente de pasos
2. Elegir tipo: Copa Triangulares / Grupos+Eliminatoria / Solo Eliminatoria / Liga / Personalizado
3. Completar: información básica → fechas y equipos → canchas y horarios → categorías → confirmar

### Flujo de gestión (una vez creado el torneo)
En la pestaña "Cruces" del torneo:
- "Creación de Grupos" → Genera grupos y calendario automáticamente
- Luego ir a "Partidos" → Ingresar resultados partido por partido
- Si el torneo tiene triangulares: "Generar Triangulares" → ingresar resultados → "Finalizar Triangulares"
- Los brackets de semis y finales se generan automáticamente

### Inscripción de equipos
- Pestaña "Inscripción equipos" → buscar o crear equipos → inscribir
- Los equipos necesitan: nombre, siglas, colores

### Resultados en vivo
- Pestaña "Partidos" → editar resultado → ingresar sets ganados
- Para voleibol: sets ganados (0-3), puntos por set

### Vista pública
- URL: /tournament/[slug-del-torneo]
- Tabs: Programación, Grupos, Partidos, Clasificación, Cruces, Info

REGLA ESTRICTA: Solo hablas sobre los torneos de ESTE administrador (userId: ${userId}). Si preguntan por otros admins, declina cortésmente.`;
}

export async function chatWithAdminContext(
  userId: string,
  messages: AdminChatMessage[],
  currentPage?: string,
): Promise<AdminAIResponse> {
  const db = getPool();

  // Load admin's tournaments
  const tournamentsResult = await db.query<TournamentRow>(
    `SELECT t.id, t.name, t.sport, t.format, t.status, t.teams_count,
            t.start_date, t.end_date, t.secondary_phase, t.bracket_mode,
            t.gold_classifiers_per_group, t.silver_classifiers_per_group,
            (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) as enrolled_count,
            (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) as matches_count,
            (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.status = 'completed') as completed_count
     FROM tournaments t
     WHERE t.owner_id = $1
     ORDER BY t.created_at DESC
     LIMIT 10`,
    [userId],
  );

  // Load admin username
  const userResult = await db.query<UserRow>(
    `SELECT username, display_name FROM users WHERE id = $1`,
    [userId],
  );

  const userRow = userResult.rows[0];
  const adminName = userRow?.display_name || userRow?.username || 'Administrador';
  const tournaments = tournamentsResult.rows;

  const systemPrompt = buildSystemPrompt(userId, adminName, tournaments, currentPage);

  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    response_format: { type: 'text' },
    temperature: 0.6,
    max_tokens: 1000,
  };

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as DeepSeekResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek devolvió una respuesta vacía');

  return { message: content };
}
