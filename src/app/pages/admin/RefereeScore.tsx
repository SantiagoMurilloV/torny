import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Clock, RefreshCw, Trophy, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LiveBadge } from '../../components/LiveBadge';
import { isJudge } from '../../lib/roles';
import { useLiveScoring } from './referee-score/useLiveScoring';
import { TeamScorePanel } from './referee-score/TeamScorePanel';
import { RotationPanel } from './referee-score/RotationPanel';
import { SetStrip } from './referee-score/SetStrip';
import { SyncIndicator } from './referee-score/SyncIndicator';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Full-bleed live-scoring console for one match. State + autosave +
 * timer + undo all live in `useLiveScoring`; this file wires the
 * resulting surface into the top/set/panel/bottom chrome.
 *
 * Route: `/admin/referee/:matchId` (lazy-loaded, judge role only).
 */
export function RefereeScore() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Judges land back at their dashboard; admins return to the
  // tournament detail they came from.
  const postFinalizeTarget = isJudge(user?.role) ? '/judge' : null;

  const live = useLiveScoring(matchId);

  if (live.loading) {
    return (
      <div className="min-h-screen bg-spk-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" aria-hidden="true" />
      </div>
    );
  }

  if (live.error || !live.match) {
    return (
      <div className="min-h-screen bg-spk-black text-white flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-white/70">{live.error || 'Partido no encontrado'}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-white/10 text-white rounded-sm hover:bg-white/20 text-sm font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          Volver
        </button>
      </div>
    );
  }

  const { match } = live;

  return (
    <div className="min-h-screen bg-spk-black text-white flex flex-col">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 md:px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-sm text-xs font-bold uppercase"
            style={{ ...FONT, letterSpacing: '0.08em' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Salir
          </button>
          <div className="min-w-0">
            <div
              className="text-sm md:text-base font-bold uppercase truncate"
              style={{ ...FONT, letterSpacing: '0.02em' }}
            >
              {match.phase}
              {match.group && ` · ${match.group}`}
            </div>
            <div className="text-[11px] text-white/50 truncate">
              {match.court}
              {match.referee ? ` · Árbitro: ${match.referee}` : ''} · ID #
              {match.id.slice(0, 6).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <LiveBadge label="EN VIVO" size="sm" />
          <div
            className="text-xl md:text-2xl font-bold text-spk-red tabular-nums"
            style={{ ...FONT, letterSpacing: '-0.02em' }}
            aria-label={`Tiempo transcurrido: ${live.elapsed}`}
          >
            {live.elapsed}
          </div>
          <button
            onClick={live.toggleTimer}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-sm text-xs font-bold uppercase"
            style={{ ...FONT, letterSpacing: '0.08em' }}
            aria-label={live.timerRunning ? 'Pausar cronómetro' : 'Reanudar cronómetro'}
          >
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {live.timerRunning ? 'Pausa' : 'Reanudar'}
          </button>
        </div>
      </header>

      <SetStrip
        sets={live.sets}
        currentSetNumber={live.currentSetNumber}
        scoreH={live.scoreH}
        scoreA={live.scoreA}
      />

      {/* Action buttons — above score panels for quick access */}
      <div className="px-4 md:px-6 py-2 bg-black/40 border-b border-white/10 flex items-center gap-2">
        <button
          onClick={live.undo}
          className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-xs font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Corregir
        </button>
        <button
          onClick={live.closeSet}
          className="inline-flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-xs font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.08em' }}
          title={
            live.setIsDecidable
              ? 'Cerrar el set con el marcador actual'
              : 'Forzar cierre (válido para abandonos / forfeits)'
          }
        >
          Cerrar set ({live.currentSetNumber})
        </button>
        <div className="ml-auto">
          <SyncIndicator state={live.sync} lastSyncedAt={live.lastSyncedAt} />
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {/* Paneles de marcador */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-[2px] bg-white/10">
          <TeamScorePanel
            team={match.team1}
            score={live.scoreH}
            sets={live.setsH}
            setNumber={live.currentSetNumber}
            serving={live.serving === 'home'}
            onPlus={() => live.addPoint('home')}
            onMinus={() => live.subtractPoint('home')}
            onServe={() => live.setServing('home')}
          />
          <TeamScorePanel
            team={match.team2}
            score={live.scoreA}
            sets={live.setsA}
            setNumber={live.currentSetNumber}
            serving={live.serving === 'away'}
            onPlus={() => live.addPoint('away')}
            onMinus={() => live.subtractPoint('away')}
            onServe={() => live.setServing('away')}
          />
        </div>

        {/* Paneles de rotación (FIVB: grid 3×2 de posiciones) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px] bg-white/10">
          <div className="bg-spk-black">
            <RotationPanel
              teamColor={match.team1.colors.primary}
              serving={live.serving === 'home'}
              setNumber={live.currentSetNumber}
              storageKey={`${match.id}-home`}
              rotationTrigger={live.rotH}
            />
          </div>
          <div className="bg-spk-black">
            <RotationPanel
              teamColor={match.team2.colors.primary}
              serving={live.serving === 'away'}
              setNumber={live.currentSetNumber}
              storageKey={`${match.id}-away`}
              rotationTrigger={live.rotA}
            />
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-3 bg-black/40 border-t border-white/10 flex items-center justify-center">
        <button
          onClick={() =>
            live.finishMatch((tournamentId) =>
              navigate(postFinalizeTarget ?? `/admin/tournaments/${tournamentId}`),
            )
          }
          className="inline-flex items-center gap-2 px-5 py-3 bg-spk-red hover:bg-spk-red-dark rounded-sm text-sm font-bold uppercase shadow-[0_8px_24px_rgba(227,30,36,0.32)]"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          <Trophy className="w-4 h-4" aria-hidden="true" />
          Terminar partido
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
