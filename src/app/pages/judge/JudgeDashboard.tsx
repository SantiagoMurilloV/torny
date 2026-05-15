import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Radio, Loader2, Clock, MapPin, CalendarDays } from 'lucide-react';
import { motion } from 'motion/react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { TeamAvatar } from '../../components/TeamAvatar';
import { LiveBadge } from '../../components/LiveBadge';

/**
 * JudgeDashboard — landing page for the 'juez' role.
 *
 * mig 036: when the judge is assigned to a specific court, their feed is
 * narrowed at the API level to live + scheduled matches on that court.
 * The dashboard then renders two sections:
 *   · "En vivo"       — status='live' matches (tap to open the scoring console)
 *   · "Programación"  — status='scheduled' matches (read-only schedule)
 *
 * Unassigned judges keep the legacy view: only live matches, all courts.
 */
export function JudgeDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { matches, tournaments, teams, loading } = useData();

  const assignedCourt = user?.assignedCourt ?? null;
  const isCourtAssigned = Boolean(assignedCourt);

  const liveMatches = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'live')
        .map((m) => ({ ...m, tournament: tournaments.find((t) => t.id === m.tournamentId) }))
        .sort((a, b) => {
          const aKey = `${a.date} ${a.time}`;
          const bKey = `${b.date} ${b.time}`;
          return bKey.localeCompare(aKey);
        }),
    [matches, tournaments],
  );

  const scheduledMatches = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'upcoming')
        .map((m) => ({ ...m, tournament: tournaments.find((t) => t.id === m.tournamentId) }))
        .sort((a, b) => {
          // Sort by date then time — soonest first
          const dateDiff = a.date.getTime() - b.date.getTime();
          if (dateDiff !== 0) return dateDiff;
          return (a.time ?? '').localeCompare(b.time ?? '');
        }),
    [matches, tournaments],
  );

  const isLoading = loading.matches && matches.length === 0;
  const hasTeamData = teams.length > 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-12 space-y-10 md:space-y-14">

      {/* Assigned court banner */}
      {isCourtAssigned && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.05] border border-white/10 rounded-sm w-fit">
          <MapPin className="w-4 h-4 text-spk-red flex-shrink-0" aria-hidden="true" />
          <span className="text-sm text-white/70">
            Tu cancha:{' '}
            <span
              className="font-bold text-white uppercase tracking-wide"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {assignedCourt}
            </span>
          </span>
        </div>
      )}

      {/* ── LIVE section ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-6 md:mb-8">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 bg-spk-red/10 border border-spk-red/30 rounded-full text-xs uppercase tracking-[0.18em] text-spk-red"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-spk-red spk-live-dot" aria-hidden="true" />
            Partidos en vivo
          </div>
          <h1
            className="mt-3 text-3xl sm:text-4xl md:text-5xl font-bold leading-[0.95] tracking-tighter"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            {isCourtAssigned ? `EN VIVO — ${assignedCourt}` : 'ELEGÍ EL PARTIDO QUE VAS A MARCAR'}
          </h1>
          <p className="mt-2 text-white/55 text-sm md:text-base max-w-2xl">
            {isCourtAssigned
              ? 'Partidos en vivo de tu cancha. Tocá uno para abrir la consola de marcador.'
              : 'Solo verás acá los partidos que el administrador puso en vivo. Tocá uno para abrir la consola de marcador.'}
          </p>
        </div>

        {isLoading ? (
          <div className="min-h-[240px] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
          </div>
        ) : liveMatches.length === 0 ? (
          <div className="bg-white/[0.03] border border-white/10 rounded-sm py-16 px-6 text-center">
            <Radio className="w-12 h-12 text-white/20 mx-auto mb-4" aria-hidden="true" />
            <h2
              className="text-xl sm:text-2xl font-bold mb-2 uppercase"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              No hay partidos en vivo
            </h2>
            <p className="text-white/50 max-w-md mx-auto">
              {isCourtAssigned
                ? `Cuando el administrador ponga un partido de ${assignedCourt} en vivo lo vas a ver acá.`
                : 'Cuando el administrador marque un partido como "En vivo" lo vas a ver acá.'}
              {' '}Probá refrescar en unos minutos.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {liveMatches.map((m, idx) => (
              <motion.button
                key={m.id}
                type="button"
                onClick={() => navigate(`/judge/match/${m.id}`)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05, duration: 0.3 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                className="group relative text-left p-5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 hover:border-spk-red/60 rounded-sm transition-colors overflow-hidden"
              >
                {/* Top meta: LIVE badge + tournament */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <LiveBadge size="sm" />
                  <span
                    className="text-[10px] uppercase tracking-[0.14em] text-white/50 truncate"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                  >
                    {m.tournament?.name ?? 'Torneo'}
                  </span>
                </div>

                {/* Teams + current sets */}
                <div className="space-y-2">
                  <TeamRow team={m.team1} score={m.score?.team1} hasTeamData={hasTeamData} />
                  <TeamRow team={m.team2} score={m.score?.team2} hasTeamData={hasTeamData} />
                </div>

                {/* Footer meta */}
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-4 text-[11px] text-white/50">
                  {m.court && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {m.court}
                    </span>
                  )}
                  {m.time && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {m.time}
                    </span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 text-spk-red font-bold tracking-[0.18em] text-[10px] uppercase">
                    Marcar
                    <span aria-hidden="true">→</span>
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      {/* ── SCHEDULE section (only when court-assigned) ───────────────────── */}
      {isCourtAssigned && (
        <section>
          <div className="mb-6 md:mb-8">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 bg-white/[0.06] border border-white/10 rounded-full text-xs uppercase tracking-[0.18em] text-white/60"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              <CalendarDays className="w-3 h-3" aria-hidden="true" />
              Programación
            </div>
            <h2
              className="mt-3 text-2xl sm:text-3xl md:text-4xl font-bold leading-[0.95] tracking-tighter"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              PRÓXIMOS PARTIDOS — {assignedCourt?.toUpperCase()}
            </h2>
            <p className="mt-2 text-white/55 text-sm max-w-2xl">
              Partidos programados para tu cancha. Son de solo lectura.
            </p>
          </div>

          {isLoading ? (
            <div className="min-h-[120px] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-white/40" />
            </div>
          ) : scheduledMatches.length === 0 ? (
            <div className="bg-white/[0.03] border border-white/10 rounded-sm py-10 px-6 text-center">
              <CalendarDays className="w-10 h-10 text-white/20 mx-auto mb-3" aria-hidden="true" />
              <p className="text-white/50 text-sm">
                No hay partidos programados para {assignedCourt} todavía.
              </p>
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/10 rounded-sm overflow-hidden">
              {scheduledMatches.map((m, idx) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.06] last:border-b-0"
                >
                  {/* Time + date */}
                  <div className="flex-shrink-0 w-20 text-right">
                    <div
                      className="text-base font-bold tabular-nums text-white"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                    >
                      {m.time || '—'}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {m.date instanceof Date
                        ? m.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
                        : ''}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-px h-8 bg-white/10 flex-shrink-0" />

                  {/* Teams */}
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-4">
                    <ScheduleTeamCell
                      team={m.team1}
                      hasTeamData={hasTeamData}
                      align="left"
                    />
                    <span className="text-white/30 font-bold text-xs flex-shrink-0">VS</span>
                    <ScheduleTeamCell
                      team={m.team2}
                      hasTeamData={hasTeamData}
                      align="right"
                    />
                  </div>

                  {/* Tournament label */}
                  {m.tournament && (
                    <div className="hidden sm:block flex-shrink-0 max-w-[120px]">
                      <span
                        className="text-[10px] uppercase tracking-[0.12em] text-white/35 truncate block text-right"
                        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                      >
                        {m.tournament.name}
                      </span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TeamRow({
  team,
  score,
  hasTeamData,
}: {
  team: { id: string; name: string; initials: string; colors: { primary: string; secondary: string }; logo?: string };
  score?: number;
  hasTeamData: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <TeamAvatar team={team} size="sm" />
        <span
          className="font-bold uppercase truncate text-white/95"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '-0.01em' }}
        >
          {hasTeamData ? team.name : team.initials}
        </span>
      </div>
      <span
        className="font-bold text-2xl tabular-nums text-white"
        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
      >
        {score ?? 0}
      </span>
    </div>
  );
}

function ScheduleTeamCell({
  team,
  hasTeamData,
  align,
}: {
  team: { id: string; name: string; initials: string; colors: { primary: string; secondary: string }; logo?: string };
  hasTeamData: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div
      className={`flex items-center gap-2 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      <TeamAvatar team={team} size="sm" />
      <span
        className="font-bold uppercase truncate text-white/90 text-sm"
        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
      >
        {hasTeamData ? team.name : team.initials}
      </span>
    </div>
  );
}
