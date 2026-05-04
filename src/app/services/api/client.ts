/**
 * Shared fetch client for every resource-scoped module under `api/`.
 * Exposes:
 *   · request<T>()      — typed JSON fetch with bearer-token injection,
 *                         401 handler plumbing, empty-body tolerance.
 *   · ApiError          — thrown on non-2xx responses, carries status.
 *   · setAuthToken()    — called by AuthContext on login/logout.
 *   · setOnUnauthorized()— AuthContext registers a callback so we can
 *                          force-logout without coupling to React here.
 *
 * Kept deliberately framework-free so the same helper works for
 * auth/login, file uploads, SSE handlers, etc.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getErrorMessage(status: number, fallback?: string): string {
  switch (status) {
    case 400:
      return fallback || 'Datos inválidos. Revisa los campos e intenta de nuevo.';
    case 401:
      return fallback || 'No autorizado. Inicia sesión para continuar.';
    case 404:
      return fallback || 'El recurso solicitado no fue encontrado.';
    case 503:
      return fallback || 'Servicio temporalmente no disponible. Intenta más tarde.';
    default:
      return fallback || 'Ocurrió un error inesperado. Intenta de nuevo.';
  }
}

// ── Token management ───────────────────────────────────────────────

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

// ── 401 handler (set by AuthContext) ───────────────────────────────

type UnauthorizedHandler = (url: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/**
 * Public accessor so non-JSON endpoints (file uploads) can still fire
 * the same 401 pathway when the bearer is rejected.
 */
export function triggerUnauthorized(path: string): void {
  onUnauthorized?.(path);
}

// ── Base fetch helper ──────────────────────────────────────────────

/**
 * Where the backend lives. Two modes:
 *
 *   1. `VITE_API_URL` env var (production) → absolute Railway URL.
 *      The frontend talks to Railway directly so Vercel only serves
 *      static HTML/JS/CSS and never sits in the path of /api/* requests.
 *      That avoids Vercel's WAF / Attack Challenge Mode auto-activating
 *      whenever a tournament has 200+ concurrent spectators (the WAF
 *      treats the burst as a DDoS attempt and serves a JS challenge to
 *      every visitor until manually disabled).
 *
 *   2. `/api` relative (dev / fallback) → vite dev server proxies it
 *      to the local Express backend. Same path used by older builds
 *      that relied on the vercel.json rewrite.
 *
 * `import.meta.env.VITE_API_URL` is replaced at build time by Vite, so
 * production bundles ship with the absolute URL hard-coded — no runtime
 * lookup overhead per request.
 */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Notify AuthContext on unauthorized (except for the auth endpoints
  // themselves — a 401 on /auth/login is the user typing the wrong
  // password, and a 401 on /auth/logout would cause the 401 handler to
  // re-enter logout() and loop).
  if (
    response.status === 401 &&
    !path.includes('/auth/login') &&
    !path.includes('/auth/logout')
  ) {
    onUnauthorized?.(path);
  }

  if (!response.ok) {
    let serverMessage: string | undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = await response.json();
        serverMessage = body.message || body.error;
      } catch {
        // malformed JSON — ignore
      }
    }
    throw new ApiError(response.status, getErrorMessage(response.status, serverMessage));
  }

  // DELETE endpoints may return empty body
  const text = await response.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as unknown as T;
  }
}

/**
 * File-upload variant: builds FormData, skips the JSON Content-Type
 * header, still threads the bearer + 401 handler. Returns the parsed
 * JSON response.
 */
export async function requestMultipart<T>(
  path: string,
  file: File,
  field = 'file',
): Promise<T> {
  const form = new FormData();
  form.append(field, file);

  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (res.status === 401) onUnauthorized?.(path);
  if (!res.ok) {
    let serverMessage: string | undefined;
    try {
      const body = await res.json();
      serverMessage = body.message || body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, getErrorMessage(res.status, serverMessage));
  }
  return (await res.json()) as T;
}
