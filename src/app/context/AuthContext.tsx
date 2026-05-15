import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { api, setAuthToken, setOnUnauthorized } from '../services/api';

interface AuthUser {
  id: string;
  username: string;
  role: string;
  /** Present when role is team_captain — id of the team the user manages. */
  teamId?: string;
  /** Present when role is club_captain (mig 028) — id of the club. */
  clubId?: string;
  /** Present when role is club_captain — display name of the club, used
   *  to title the panel without an extra round-trip. */
  clubName?: string;
  /** Present when role is judge — the tournament the judge is assigned to (mig 036). */
  assignedTournamentId?: string | null;
  /** Present when role is judge — the court name the judge is assigned to (mig 036). */
  assignedCourt?: string | null;
}

interface LoginResult {
  token: string;
  user: AuthUser;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
  /** Resolves with the session on success so callers can route by role. */
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: (message?: string) => void;
  isLoading: boolean;
  sessionMessage: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

/**
 * Read token + user synchronously from localStorage on module init.
 * Runs once at bootstrap — before AuthProvider renders, before any
 * DataContext mounts, before any API call leaves. This is what keeps
 * the Authorization header present on the very first fetches after
 * a page refresh; otherwise those anonymous-looking requests would
 * be counted as fresh "visitors" in the presence tracker and the
 * admin dashboard would show you as a new visitor on every reload.
 */
function readStoredSession(): { token: string | null; user: AuthUser | null } {
  if (typeof window === 'undefined') return { token: null, user: null };
  const storedToken = localStorage.getItem(TOKEN_KEY);
  const storedUser = localStorage.getItem(USER_KEY);
  if (!storedToken || !storedUser) return { token: null, user: null };
  try {
    const parsed = JSON.parse(storedUser) as AuthUser;
    setAuthToken(storedToken); // side-effect: module-level token in api.ts
    return { token: storedToken, user: parsed };
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Eager restore so the first render of DataContext's fetches already
  // carries the bearer token.
  const initialSession = useRef(readStoredSession());
  const [user, setUser] = useState<AuthUser | null>(initialSession.current.user);
  const [token, setToken] = useState<string | null>(initialSession.current.token);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  const logout = useCallback((message?: string) => {
    // Tell the server to revoke this JWT so it stops working even if
    // someone copied it out of localStorage. Fire-and-forget — we don't
    // want a slow network to block the UX of "cerrar sesión".
    // The auth header is read from the token we're about to clear, so
    // the request has to go out BEFORE setAuthToken(null).
    api.logout().catch(() => {
      /* swallow — local logout still happens so the user isn't stuck */
    });

    setToken(null);
    setUser(null);
    setAuthToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('isAuthenticated');
    if (message) {
      setSessionMessage(message);
    }
  }, []);

  // Register a 401 handler with the API client.
  // This avoids monkey-patching window.fetch (which would interfere with
  // any other fetch caller and could double-wrap on re-mounts).
  useEffect(() => {
    setOnUnauthorized(() => {
      logout('Sesión expirada. Inicia sesión nuevamente.');
    });
    return () => {
      setOnUnauthorized(null);
    };
  }, [logout]);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      setSessionMessage(null);
      const response = await api.login(username, password);

      setToken(response.token);
      setUser(response.user);
      setAuthToken(response.token);
      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(USER_KEY, JSON.stringify(response.user));
      return { token: response.token, user: response.user };
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token && !!user,
        user,
        token,
        login,
        logout,
        isLoading,
        sessionMessage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
