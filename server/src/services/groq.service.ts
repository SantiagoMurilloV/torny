/**
 * Groq client — OpenAI-compatible chat completions.
 *
 * Groq exposes the exact same request/response shape as OpenAI (and
 * DeepSeek), so this is a thin wrapper around `fetch` against their
 * `/openai/v1/chat/completions` endpoint. Used by the schedule advisor
 * to turn deterministic schedule metrics into natural-language,
 * sport-aware recommendations.
 *
 * Config (all via env, set in Railway):
 *   · GROQ_API_KEY   — required; without it isGroqConfigured() is false
 *                      and callers fall back gracefully.
 *   · GROQ_MODEL     — defaults to a current Groq production model.
 *                      Override here if Groq deprecates it (no code
 *                      change needed).
 *   · GROQ_API_URL   — escape hatch for a proxy / different base URL.
 */

const GROQ_API_URL =
  process.env.GROQ_API_URL ?? 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

export function isGroqConfigured(): boolean {
  return GROQ_API_KEY.trim().length > 0;
}

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Force a JSON object response (uses response_format json_object). */
  json?: boolean;
  /** Per-call model override; defaults to GROQ_MODEL. */
  model?: string;
  /** Abort the request after this many ms (default 30s). */
  timeoutMs?: number;
}

/**
 * Single-shot chat completion. Returns the assistant message content.
 * Throws when GROQ_API_KEY is missing or the API responds non-2xx so the
 * caller can decide whether to surface the error or fall back.
 */
export async function groqChat(
  messages: GroqMessage[],
  opts: GroqChatOptions = {},
): Promise<string> {
  if (!isGroqConfigured()) {
    throw new Error('GROQ_API_KEY no configurada');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  let res: Response;
  try {
    res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: opts.model ?? GROQ_MODEL,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    console.error(`[groq] API error ${res.status}:`, err.slice(0, 500));
    throw new Error(`Groq API ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

export const groqModel = (): string => GROQ_MODEL;
