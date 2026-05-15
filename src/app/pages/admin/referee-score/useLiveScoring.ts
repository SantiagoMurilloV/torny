import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../services/api';
import type { Match, SetScore } from '../../../types';
import {
  AUTOSAVE_DEBOUNCE_MS,
  MIN_DIFF_TO_WIN_SET,
  countSetsWon,
  isSetDecided,
  setTargetFor,
} from './scoring';
import type { ServingSide, SyncState } from './types';
import { getErrorMessage } from '../../../lib/errors';

interface Snapshot {
  scoreH: number;
  scoreA: number;
  sets: SetScore[];
  serving: ServingSide;
}

const UNDO_STACK_MAX = 10;

/**
 * State + behavior for the referee scoring console. Owns the loaded
 * match, the live set points, the array of closed sets, the timer,
 * the undo stack, and the debounced autosave. Returns an imperative
 * surface the page UI can wire to buttons without caring about how
 * any of it persists.
 */
export function useLiveScoring(matchId: string | undefined) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current-set score (not yet committed to match.sets)
  const [scoreH, setScoreH] = useState(0);
  const [scoreA, setScoreA] = useState(0);
  const [serving, setServing] = useState<ServingSide>('home');

  // Finalized sets (what we'll persist). Home=team1, Away=team2.
  const [sets, setSets] = useState<SetScore[]>([]);

  const [seconds, setSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);

  const [sync, setSync] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const undoStack = useRef<Snapshot[]>([]);
  const pushUndo = useCallback(() => {
    undoStack.current.push({ scoreH, scoreA, sets, serving });
    if (undoStack.current.length > UNDO_STACK_MAX) undoStack.current.shift();
  }, [scoreH, scoreA, sets, serving]);

  // Hydration gate: autosave shouldn't fire until we've loaded.
  const hydrated = useRef(false);
  const [dirtyTick, setDirtyTick] = useState(0);
  const markDirty = useCallback(() => setDirtyTick((n) => n + 1), []);

  // Load match on mount.
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getMatch(matchId);
        if (cancelled) return;
        setMatch(data);
        hydrateFromMatch(data);
        hydrated.current = true;
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Error al cargar el partido'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Hydrators are stable callers defined below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const hydrateFromMatch = (data: Match) => {
    // Drop 0-0 phantom sets (legacy from an earlier buggy version).
    const persisted = (data.sets ?? []).filter((s) => s.team1 > 0 || s.team2 > 0);
    const last = persisted[persisted.length - 1];
    if (last && !isSetDecided(last, persisted.length)) {
      setSets(persisted.slice(0, -1));
      setScoreH(last.team1);
      setScoreA(last.team2);
    } else {
      setSets(persisted);
      setScoreH(0);
      setScoreA(0);
    }
    if (data.duration && data.duration > 0) setSeconds(data.duration * 60);
  };

  // Timer tick
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // Debounced autosave.
  const matchRef = useRef<Match | null>(null);
  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (dirtyTick === 0) return;
    const current = matchRef.current;
    if (!current) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSync('syncing');
        const minutes = Math.max(1, Math.round(seconds / 60));
        const { team1: setsWonH, team2: setsWonA } = countSetsWon(sets);

        // Persist closed sets + the in-progress one as the trailing
        // row so (a) the public MatchDetail shows live points, and
        // (b) re-entering the match resumes where we left off. A
        // trailing 0-0 is skipped — no phantom rows.
        const persistedSets: SetScore[] = [...sets];
        if (scoreH > 0 || scoreA > 0) {
          persistedSets.push({ team1: scoreH, team2: scoreA });
        }
        const payload: Parameters<typeof api.updateMatchScore>[1] = {
          status: 'live',
          scoreTeam1: setsWonH,
          scoreTeam2: setsWonA,
          sets: persistedSets.map((s, i) => ({
            setNumber: i + 1,
            team1Points: s.team1,
            team2Points: s.team2,
          })),
        };
        if (seconds >= 60) payload.duration = minutes;

        const updated = await api.updateMatchScore(current.id, payload);
        setMatch(updated);
        setLastSyncedAt(new Date());
        setSync('saved');
      } catch (err) {
        setSync('error');
        toast.error(getErrorMessage(err, 'Error al sincronizar'));
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // `seconds` is excluded on purpose: persisting every tick would
    // spam the server. It's captured at save time alongside the score.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyTick, scoreH, scoreA, sets]);

  // Ref síncrono del saque actual para leer en callbacks sin deps estancadas.
  const servingRef = useRef<ServingSide>('home');
  useEffect(() => { servingRef.current = serving; }, [serving]);

  // Contadores de rotación: se incrementan SOLO cuando el equipo gana el saque
  // al anotar (nunca cuando el saque cambia por un "-punto").
  const [rotH, setRotH] = useState(0);
  const [rotA, setRotA] = useState(0);

  // Historial de saque por punto: registra quién tenía el saque ANTES de cada
  // addPoint. subtractPoint lo consume para restaurar el saque correcto sin
  // importar cuántos puntos seguidos lleva el equipo.
  // Estructura: { side: quién anotó, prevServing: quién servía antes }
  const serveHistory = useRef<Array<{ side: ServingSide; prevServing: ServingSide }>>([]);

  // Score controls
  const addPoint = useCallback(
    (side: ServingSide) => {
      pushUndo();
      const prevServing = servingRef.current;
      // Registrar en el historial ANTES de cambiar el saque
      serveHistory.current.push({ side, prevServing });
      if (side === 'home') {
        setScoreH((v) => v + 1);
        if (prevServing !== 'home') setRotH((n) => n + 1); // ganó el saque → rota
      } else {
        setScoreA((v) => v + 1);
        if (prevServing !== 'away') setRotA((n) => n + 1); // ganó el saque → rota
      }
      setServing(side);
      markDirty();
    },
    [pushUndo, markDirty],
  );

  const subtractPoint = useCallback(
    (side: ServingSide) => {
      if ((side === 'home' ? scoreH : scoreA) === 0) return;
      pushUndo();
      if (side === 'home') setScoreH((v) => Math.max(0, v - 1));
      else setScoreA((v) => Math.max(0, v - 1));

      // Buscar el último addPoint de este equipo en el historial y restaurar
      // el saque que había ANTES de ese punto. Así:
      //   · Si el equipo ganó el saque con ese punto → saque vuelve al otro
      //   · Si ya tenía el saque cuando anotó → saque se queda en el mismo equipo
      const history = serveHistory.current;
      let restored: ServingSide = servingRef.current; // por defecto no cambia
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].side === side) {
          restored = history[i].prevServing;
          history.splice(i, 1);
          break;
        }
      }
      setServing(restored);
      markDirty();
    },
    [scoreH, scoreA, pushUndo, markDirty],
  );

  const undo = useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) {
      toast.info('No hay acciones para deshacer');
      return;
    }
    setScoreH(snap.scoreH);
    setScoreA(snap.scoreA);
    setSets(snap.sets);
    setServing(snap.serving);
    markDirty();
  }, [markDirty]);

  // Set-closing + finishing
  const currentSetNumber = sets.length + 1;
  const setTarget = setTargetFor(currentSetNumber);

  const setIsDecidable = useMemo(() => {
    const top = Math.max(scoreH, scoreA);
    const diff = Math.abs(scoreH - scoreA);
    return top >= setTarget && diff >= MIN_DIFF_TO_WIN_SET;
  }, [scoreH, scoreA, setTarget]);

  const closeSet = useCallback(() => {
    if (scoreH === 0 && scoreA === 0) {
      toast.info('Marcá al menos un punto antes de cerrar el set');
      return;
    }
    if (!setIsDecidable) {
      toast.warning(
        `Set ${currentSetNumber} cerrado antes de ${setTarget} — revisa el marcador`,
      );
    } else {
      toast.success(`Set ${currentSetNumber} cerrado`);
    }
    pushUndo();
    setSets((prev) => [...prev, { team1: scoreH, team2: scoreA }]);
    setScoreH(0);
    setScoreA(0);
    markDirty();
  }, [scoreH, scoreA, setIsDecidable, currentSetNumber, setTarget, pushUndo, markDirty]);

  const finishMatch = useCallback(
    async (onSuccess: (tournamentId: string) => void) => {
      if (!match) return;
      try {
        const finalSets =
          scoreH === 0 && scoreA === 0 ? sets : [...sets, { team1: scoreH, team2: scoreA }];
        const { team1: setsH, team2: setsA } = countSetsWon(finalSets);
        const minutes = Math.max(1, Math.round(seconds / 60));
        await api.updateMatchScore(match.id, {
          status: 'completed',
          scoreTeam1: setsH,
          scoreTeam2: setsA,
          duration: seconds >= 60 ? minutes : 1,
          sets: finalSets.map((s, i) => ({
            setNumber: i + 1,
            team1Points: s.team1,
            team2Points: s.team2,
          })),
        });
        toast.success('Partido finalizado');
        onSuccess(match.tournamentId);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Error al finalizar'));
      }
    },
    [match, scoreH, scoreA, sets, seconds],
  );

  // Derived stuff used by UI
  const { team1: setsH, team2: setsA } = countSetsWon(sets);
  const elapsed = useMemo(() => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [seconds]);

  return {
    match,
    loading,
    error,
    scoreH,
    scoreA,
    sets,
    setsH,
    setsA,
    serving,
    rotH,
    rotA,
    seconds,
    elapsed,
    timerRunning,
    sync,
    lastSyncedAt,
    currentSetNumber,
    setIsDecidable,
    addPoint,
    subtractPoint,
    setServing,
    undo,
    closeSet,
    finishMatch,
    toggleTimer: () => setTimerRunning((v) => !v),
  };
}
