const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const MODEL = 'deepseek-chat';
const MAX_HISTORY_MESSAGES = 16;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TournamentSuggestions {
  name?: string;
  club?: string;
  sport?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  teamsCount?: number;
  format?: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  status?: 'upcoming' | 'ongoing' | 'completed';
  courts?: string[];
  categories?: string[];
  city?: string;
  matchBreakMinutes?: number;
  playersPerTeam?: number;
  bracketMode?: 'manual' | 'divisions';
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  maxMatchesPerDay?: number;
  regulationText?: string;
  matchDurationMinutes?: number;
  enrollmentDeadline?: string;
}

export interface AIChatResponse {
  message: string;
  suggestions?: TournamentSuggestions;
  nextQuestion?: string;
  pendingFields?: string[];
  isComplete?: boolean;
}

// ── Language detection ────────────────────────────────────────────────────────

const EN_WORDS = /\b(the|and|for|with|want|have|this|that|are|you|your|teams|tournament|create|organize|play|need|our|my|we|from|about|how|what|when|where|who|can|will|would|should|could|please|thanks|hello|hi|hey|want|like|make|set|up|yes|no|ok|sure|great)\b/gi;
const ES_WORDS = /\b(el|la|los|las|un|una|quiero|torneo|equipos|para|con|que|por|como|cuando|donde|quien|puede|nuestro|hola|gracias|tengo|hacer|crear|organizar|jugadores|cancha|listo|dale|claro|sí|no|bueno|quiero|necesito|vamos|parce|bacano|chévere)\b/gi;

function detectLanguage(text: string): 'en' | 'es' | 'other' {
  const enCount = (text.match(EN_WORDS) ?? []).length;
  const esCount = (text.match(ES_WORDS) ?? []).length;
  if (enCount > esCount && enCount >= 2) return 'en';
  if (esCount > enCount && esCount >= 2) return 'es';
  if (enCount > 0 && esCount === 0) return 'en';
  return 'other';
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(lang: 'en' | 'es' | 'other'): string {
  const today = new Date().toISOString().split('T')[0];

  if (lang === 'en') {
    return `You are Torny's AI tournament wizard. Today is ${today}.
Your mission: guide the user through EVERY tournament field via conversation until the form is 100% complete.
CRITICAL: You MUST respond ENTIRELY in English. No Spanish words.

## YOUR APPROACH
You are a thorough, expert tournament organizer. Ask ONE focused question at a time.
Never skip fields. Never assume — always confirm. When you have enough info for a field, suggest it immediately.
Keep going until ALL required fields AND all relevant optional fields are filled.

## ALL FORM FIELDS (fill every single one)

### REQUIRED — must fill all of these:
1. name — Tournament name
2. sport — Sport (Volleyball, Soccer, Basketball, Handball, Tennis, Padel, Rugby, Baseball, Hockey, Other)
3. club — Organizing club or entity
4. description — Short description (you can write this yourself based on the info gathered)
5. startDate — Start date (YYYY-MM-DD)
6. endDate — End date (YYYY-MM-DD)
7. teamsCount — Number of teams (2–9999)
8. format — "groups", "knockout", "groups+knockout", or "league"
9. courts — Array of court/field names (at least 1)

### IMPORTANT OPTIONAL — ask about all of these:
10. city — City where it takes place
11. categories — Gender/age divisions e.g. ["Men", "Women", "Mixed"] or ["U18", "Open"]
12. matchDurationMinutes — Match duration in minutes (sport-specific defaults apply)
13. matchBreakMinutes — Break between matches (0–240 min)
14. playersPerTeam — Players per team (1–30)
15. maxMatchesPerDay — Max matches per day per team (0 = unlimited)
16. enrollmentDeadline — Deadline for roster changes (YYYY-MM-DD, optional)

### CONDITIONAL — ask only when relevant:
17. bracketMode — "manual" or "divisions" (only for formats with knockout)
18. goldClassifiersPerGroup — Teams per group advancing to Gold bracket (1–8, only for divisions mode)
19. silverClassifiersPerGroup — Teams per group advancing to Silver bracket (0–8, only for divisions mode)

### AI-GENERATED — generate these yourself:
20. regulationText — Full tournament regulations document. Generate this automatically once you know the sport, format, categories and rules. Write a complete, professional document.

## FORMAT RECOMMENDATIONS
- Under 8 teams → "league" or "knockout"
- 8–16 teams → "groups+knockout" (BEST for most cases)
- Over 16 teams → "groups+knockout" with multiple groups
- 1-day event → "knockout"

## SPORT DEFAULTS (apply intelligently)
- Soccer: 90 min/match, 20 min break, 18 players/team
- Futsal: 40 min/match, 15 min break, 8 players/team
- Basketball: 60 min/match, 15 min break, 12 players/team
- Volleyball: 75 min/match, 15 min break, 12 players/team
- Handball: 60 min/match, 15 min break, 14 players/team
- Tennis/Padel: 90 min/match, 30 min break, 1–2 players/team
- Rugby: 80 min/match, 30 min break, 15 players/team

## RESPONSE FORMAT — always valid JSON:
{
  "message": "Your conversational reply",
  "suggestions": { /* fields you can fill RIGHT NOW based on what you know */ },
  "nextQuestion": "The single most important unanswered question",
  "pendingFields": ["field1", "field2", ...], /* fields still needed */
  "isComplete": false
}

Set "isComplete": true ONLY when all required + all important optional fields have been suggested.
When isComplete is true, generate the regulationText and include it in suggestions.
When isComplete is true, write a warm completion message summarizing the tournament.`;
  }

  // Spanish (Colombian default) or other
  return `Eres el asistente organizador de torneos de Torny. Hoy es ${today}.
Tu misión: guiar al usuario por TODOS los campos del torneo de forma conversacional hasta que el formulario esté 100% completo.

TONO Y ESTILO — MUY IMPORTANTE:
Hablas en español colombiano formal. Usas "usted" siempre. Tu tono es cordial, profesional y cálido — como el de un organizador deportivo experimentado que atiende con respeto.
Expresiones permitidas: "con mucho gusto", "claro que sí", "perfecto", "entendido", "con todo el gusto", "de acuerdo", "excelente", "le cuento", "le indico", "cómo le parece".
Expresiones PROHIBIDAS: "parce", "bacano", "chévere", "dale", "buenísimo", "che", "vos", "hacé", "confirmá", "sugerilo". Nada de tuteo ni lunfardo.
Frases de ejemplo correctas:
  - "Con mucho gusto le ayudo a organizar ese torneo."
  - "Perfecto, ya tengo esa información. ¿Me podría indicar la fecha de inicio?"
  - "Entendido. Le recomiendo el formato grupos más eliminatoria para esa cantidad de equipos."
  - "¿Cuántas canchas tienen disponibles para el evento?"

## TU ENFOQUE
Eres un organizador experto y meticuloso. Haz UNA pregunta concreta por turno.
Nunca omitas campos. Nunca asumas — siempre confirma. Cuando tengas información suficiente para un campo, inclúyelo en suggestions de inmediato.
Continúa hasta que TODOS los campos requeridos y los opcionales relevantes estén completos.

## TODOS LOS CAMPOS DEL FORMULARIO (llenar absolutamente todos)

### OBLIGATORIOS — llenar todos:
1. name — Nombre del torneo
2. sport — Deporte (Voleibol, Fútbol, Básketbol, Handball, Tenis, Pádel, Rugby, Béisbol, Hockey, Fútbol sala, Otro)
3. club — Club u organización anfitriona
4. description — Descripción corta (podés escribirla vos basándote en la info recolectada)
5. startDate — Fecha de inicio (YYYY-MM-DD)
6. endDate — Fecha de fin (YYYY-MM-DD)
7. teamsCount — Cantidad de equipos (2–9999)
8. format — "groups", "knockout", "groups+knockout", o "league"
9. courts — Array de nombres de canchas (mínimo 1)

### OPCIONALES IMPORTANTES — preguntar por todos:
10. city — Ciudad donde se realiza
11. categories — Divisiones por género/edad ej: ["Masculino","Femenino","Mixto"] o ["Sub-18","Abierto"]
12. matchDurationMinutes — Duración de cada partido en minutos
13. matchBreakMinutes — Pausa entre partidos (0–240 min)
14. playersPerTeam — Jugadores por equipo (1–30)
15. maxMatchesPerDay — Máximo de partidos por día por equipo (0 = ilimitado)
16. enrollmentDeadline — Fecha límite para modificar plantel (YYYY-MM-DD, opcional)

### CONDICIONALES — solo si aplica:
17. bracketMode — "manual" o "divisions" (solo si el formato tiene eliminatoria)
18. goldClassifiersPerGroup — Clasificados al cruce Oro por grupo (1–8, solo modo divisions)
19. silverClassifiersPerGroup — Clasificados al cruce Plata por grupo (0–8, solo modo divisions)

### GENERADOS POR IA — generarlos automáticamente:
20. regulationText — Reglamento completo del torneo. Generalo vos cuando tengas toda la info necesaria. Redactá un documento completo y profesional con: elegibilidad, formato de juego, criterios de desempate, horarios, conducta deportiva, sanciones.

## RECOMENDACIONES DE FORMATO
- Menos de 8 equipos → "league" o "knockout"
- 8 a 16 equipos → "groups+knockout" (lo más recomendado)
- Más de 16 equipos → "groups+knockout" con múltiples grupos
- Torneo de 1 día → "knockout"

## DEFAULTS POR DEPORTE
- Fútbol: 90 min/partido, 20 min pausa, 18 jugadores/equipo
- Fútbol sala/Microfútbol: 40 min/partido, 15 min pausa, 8 jugadores/equipo
- Básketbol: 60 min/partido, 15 min pausa, 12 jugadores/equipo
- Voleibol: 75 min/partido, 15 min pausa, 12 jugadores/equipo
- Handball: 60 min/partido, 15 min pausa, 14 jugadores/equipo
- Tenis/Pádel: 90 min/partido, 30 min pausa, 1–2 jugadores/equipo
- Rugby: 80 min/partido, 30 min pausa, 15 jugadores/equipo

## FORMATO DE RESPUESTA — siempre JSON válido:
{
  "message": "Tu respuesta conversacional aquí",
  "suggestions": { /* campos que podés completar AHORA con la info que ya tenés */ },
  "nextQuestion": "La única pregunta más importante que falta responder",
  "pendingFields": ["campo1", "campo2", ...], /* campos que todavía faltan */
  "isComplete": false
}

Ponés "isComplete": true SOLO cuando todos los campos requeridos y opcionales importantes estén sugeridos.
Cuando isComplete sea true: generá el regulationText completo y una mensaje de cierre cálido que resuma el torneo.`;
}

// ── API call ──────────────────────────────────────────────────────────────────

interface DeepSeekChoice {
  message: { content: string };
}
interface DeepSeekResponse {
  choices: DeepSeekChoice[];
}

/**
 * Builds a context block summarizing what's already filled in the form
 * so the AI doesn't re-ask questions that were already answered.
 */
function buildFormContext(formState: Record<string, unknown>, lang: 'en' | 'es' | 'other'): string {
  const isEmpty = (v: unknown) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'number' && v === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

  const filled: string[] = [];
  const empty: string[] = [];

  const fieldMap: Record<string, string> = {
    name: 'name', sport: 'sport', club: 'club', description: 'description',
    startDate: 'startDate', endDate: 'endDate', teamsCount: 'teamsCount',
    format: 'format', courts: 'courts', city: 'city', categories: 'categories',
    matchDurationMinutes: 'matchDurationMinutes', matchBreakMinutes: 'matchBreakMinutes',
    playersPerTeam: 'playersPerTeam', maxMatchesPerDay: 'maxMatchesPerDay',
    enrollmentDeadline: 'enrollmentDeadline', bracketMode: 'bracketMode',
    regulationText: 'regulationText',
  };

  for (const [key, label] of Object.entries(fieldMap)) {
    const val = formState[key];
    // teamsCount default is 8, matchBreakMinutes default is 15, playersPerTeam default is 12
    const isDefault =
      (key === 'teamsCount' && val === 8) ||
      (key === 'matchBreakMinutes' && val === 15) ||
      (key === 'playersPerTeam' && val === 12) ||
      (key === 'sport' && val === 'Voleibol') ||
      (key === 'format' && val === 'groups+knockout') ||
      (key === 'bracketMode' && val === 'manual');

    if (!isEmpty(val) && !isDefault) {
      const display = Array.isArray(val)
        ? (val as Array<{ name?: string } | string>).map((c) => typeof c === 'object' && c !== null ? (c as { name?: string }).name ?? JSON.stringify(c) : String(c)).join(', ')
        : String(val);
      filled.push(`  ${label}: ${display}`);
    } else {
      empty.push(label);
    }
  }

  if (lang === 'en') {
    return `\n\n[CURRENT FORM STATE — use this to know what's already filled and what still needs to be asked]
ALREADY FILLED (do NOT ask about these again):
${filled.length > 0 ? filled.join('\n') : '  (nothing yet)'}

STILL EMPTY (these need to be asked/filled):
  ${empty.join(', ')}
]`;
  }

  return `\n\n[ESTADO ACTUAL DEL FORMULARIO — usalo para saber qué ya está lleno y qué falta preguntar]
YA COMPLETADO (NO preguntes esto de nuevo):
${filled.length > 0 ? filled.join('\n') : '  (nada todavía)'}

TODAVÍA VACÍO (hay que preguntar/completar esto):
  ${empty.join(', ')}
]`;
}

export async function chatWithDeepSeek(
  messages: ChatMessage[],
  formState: Record<string, unknown> = {},
): Promise<AIChatResponse> {
  const trimmedMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  // Detect language from the last user message
  const lastUserMsg = [...trimmedMessages].reverse().find((m) => m.role === 'user');
  const lang = lastUserMsg ? detectLanguage(lastUserMsg.content) : 'other';

  const langInstruction =
    lang === 'en'
      ? '[INSTRUCTION: The user wrote in English. You MUST respond entirely in English. No Spanish at all.]'
      : lang === 'es'
        ? '[INSTRUCCIÓN: El usuario escribió en español. Responde en español colombiano formal: usa "usted", tono profesional y cordial, sin tuteo ni jerga informal.]'
        : '';

  // Build form context to inject into last user message
  const formContext = buildFormContext(formState, lang);

  // Inject language instruction + form context into the last user message
  const messagesWithContext = trimmedMessages.map((m, i) => {
    const isLastUser =
      m.role === 'user' &&
      i === trimmedMessages.map((x) => x.role).lastIndexOf('user');
    if (isLastUser) {
      const prefix = langInstruction ? `${langInstruction}\n\n` : '';
      return { ...m, content: `${prefix}${m.content}${formContext}` };
    }
    return m;
  });

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(lang) },
      ...messagesWithContext,
    ],
    response_format: { type: 'json_object' },
    temperature: 0.65,
    max_tokens: 2000,
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

  let parsed: AIChatResponse;
  try {
    parsed = JSON.parse(content) as AIChatResponse;
  } catch {
    parsed = { message: content };
  }

  return parsed;
}
