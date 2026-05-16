import { Target } from 'lucide-react';
import { motion } from 'motion/react';
import type { Team } from '../../../types';
import { TeamAvatar } from '../../../components/TeamAvatar';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

interface TeamScorePanelProps {
  team: Team;
  score: number;
  sets: number;
  setNumber: number;
  serving: boolean;
  onPlus: () => void;
  onMinus: () => void;
  onServe: () => void;
}

/**
 * Per-team scoring panel — team header + giant score + +/- buttons
 * + sets-won counter. Two instances render side-by-side in the
 * RefereeScore console.
 */
export function TeamScorePanel({
  team,
  score,
  sets,
  setNumber,
  serving,
  onPlus,
  onMinus,
  onServe,
}: TeamScorePanelProps) {
  return (
    <div
      className="relative bg-spk-black p-6 md:p-10 flex flex-col gap-6 justify-between overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(180deg, ${team.colors.primary}22 0%, transparent 55%)`,
      }}
    >
      <div className="relative flex items-center gap-3">
        <TeamAvatar team={team} size="lg" />
        <div className="flex-1 min-w-0">
          <div
            className="font-extrabold uppercase leading-[0.95]"
            style={{
              ...FONT,
              fontSize: 'clamp(1.25rem, 5vw, 2.75rem)',
              letterSpacing: '0.02em',
              color: 'white',
              textShadow: `0 0 20px ${team.colors.primary}88, 0 2px 8px rgba(0,0,0,0.5)`,
            }}
          >
            {team.name}
          </div>
          {team.city && (
            <div className="text-xs text-white/55 mt-1 truncate">{team.city}</div>
          )}
        </div>
        <button
          onClick={onServe}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase transition-colors ${
            serving
              ? 'bg-spk-red text-white'
              : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
          style={{ ...FONT, letterSpacing: '0.12em' }}
          aria-pressed={serving}
          aria-label={serving ? `${team.name} tiene el saque` : `Marcar saque para ${team.name}`}
        >
          <Target className="w-3 h-3" aria-hidden="true" />
          Saque
        </button>
      </div>

      <div className="relative text-center flex-1 flex flex-col justify-center">
        <motion.div
          key={score}
          initial={{ scale: 0.9, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          className="text-white tabular-nums"
          style={{
            ...FONT,
            fontWeight: 800,
            fontSize: 'clamp(96px, 22vw, 240px)',
            lineHeight: 0.88,
            letterSpacing: '-0.06em',
            textShadow: `0 4px 40px ${team.colors.primary}66`,
          }}
        >
          {score}
        </motion.div>
        <div
          className="text-xs text-white/45 mt-2 font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.2em' }}
        >
          Puntos · Set {setNumber}
        </div>
      </div>

      <div className="relative flex gap-2">
        <button
          onClick={onMinus}
          className="flex-1 py-4 md:py-5 border-2 border-white/10 bg-white/5 hover:bg-white/10 rounded-sm text-white font-bold uppercase inline-flex items-center justify-center gap-2"
          style={{ ...FONT, letterSpacing: '0.08em' }}
          aria-label={`Restar punto a ${team.name}`}
        >
          <span className="text-2xl leading-none">–</span>
          Punto
        </button>
        <button
          onClick={onPlus}
          className="flex-[2] py-4 md:py-5 bg-spk-red hover:bg-spk-red-dark rounded-sm text-white font-bold uppercase inline-flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(227,30,36,0.32)]"
          style={{ ...FONT, letterSpacing: '0.08em' }}
          aria-label={`Sumar punto a ${team.name}`}
        >
          <span className="text-2xl leading-none">+</span>
          Punto
        </button>
      </div>

      <div className="relative flex items-center justify-between border-t border-white/10 px-1 pt-3">
        <span className="flex items-center gap-2">
          <span
            className="text-[11px] text-white font-bold uppercase"
            style={{ ...FONT, letterSpacing: '0.18em' }}
          >
            Sets ganados
          </span>
          <span className="text-white/50 text-sm">&rsaquo;&rsaquo;</span>
        </span>
        <span
          className="text-3xl md:text-4xl font-extrabold tabular-nums"
          style={{
            ...FONT,
            color: 'white',
            textShadow: `0 0 14px ${team.colors.primary}99`,
          }}
        >
          {sets}
        </span>
      </div>
    </div>
  );
}
