import { Calendar, MapPin } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Tournament } from '../../types';
import { ImageWithFallback } from '../../components/figma/ImageWithFallback';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

const STATUS_CAPTION: Record<Tournament['status'], { text: string; withDot: boolean }> = {
  ongoing: { text: 'TORNEO EN CURSO', withDot: true },
  upcoming: { text: 'PRÓXIMAMENTE', withDot: false },
  completed: { text: 'FINALIZADO', withDot: false },
};

const HERO_IMG =
  'https://images.unsplash.com/photo-1765109350739-ed25db5757be?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2xsZXliYWxsJTIwZ2FtZSUyMGludGVuc2UlMjBjb21wZXRpdGlvbnxlbnwxfHx8fDE3NzU1NzU1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080';

/**
 * Big parallax hero with tournament title + description + quick stats.
 * Opacity and scale are driven by scrollY so the hero fades into the
 * sticky header smoothly as the user moves into the tabs.
 */
export function Hero({
  tournament,
  matchesCount,
  enrolledCount,
}: {
  tournament: Tournament;
  matchesCount: number;
  enrolledCount: number;
}) {
  // "Jugadoras" replaces the old "En vivo" counter (2026-05-13). The
  // live-matches count was almost always 0 outside game day, which
  // made the slot read as empty in the hero; "jugadoras" is the
  // single most-asked stat by visitors and stays meaningful from the
  // moment the parent-registration flow opens.
  const playersCount = tournament.playersCount ?? 0;
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 200], [1, 0]);
  const scale = useTransform(scrollY, [0, 300], [1, 1.15]);
  const caption = STATUS_CAPTION[tournament.status];

  return (
    <section className="relative overflow-hidden bg-black">
      <motion.div style={{ scale }} className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black z-10" />
        <ImageWithFallback src={HERO_IMG} alt="Tournament" className="w-full h-full object-cover opacity-50" />
      </motion.div>

      {/* Content lives in normal flow so it dictates section height — the
          parallax bg above is absolute and just paints behind. We pad
          below the fixed h-16 header so the status badge isn't clipped,
          and pad the bottom so the last row of stats clears the sticky
          tab nav cleanly. md:min-h-[70vh] keeps the desktop poster look. */}
      <motion.div
        style={{ opacity }}
        className="relative z-20 px-4 sm:px-6 md:px-12 pt-24 sm:pt-28 md:pt-32 pb-10 sm:pb-12 md:pb-16 md:min-h-[70vh] md:flex md:items-center"
      >
        <div className="max-w-[1600px] mx-auto w-full">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-sm mb-4 sm:mb-6"
            >
              {caption.withDot && (
                <motion.div
                  className="w-2 h-2 bg-spk-red rounded-full flex-shrink-0"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              <span className="text-[11px] sm:text-sm font-bold text-white tracking-wide" style={FONT}>
                {caption.text}
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold mb-3 sm:mb-6 leading-[0.95] sm:leading-[0.9] tracking-tighter text-white break-words hyphens-auto"
              style={FONT}
            >
              {tournament.name}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-sm sm:text-xl md:text-2xl text-white/80 mb-5 sm:mb-10 max-w-3xl leading-relaxed"
            >
              {tournament.description}
            </motion.p>

            {/* 2×2 grid on phones so all four stats land inside the hero
                without bleeding into the sticky tabs below. Switches to a
                single row of four on sm+ where the viewport is wide
                enough. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-4 sm:gap-8 md:gap-12"
            >
              <Stat label="Equipos" value={enrolledCount || tournament.teamsCount} />
              <Stat label="Partidos" value={matchesCount} />
              <Stat label="Jugadoras" value={playersCount} />
              <Stat label="Canchas" value={tournament.courts.length} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex flex-wrap gap-3 sm:gap-6 mt-5 sm:mt-10 text-white/70"
            >
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <Calendar className="w-4 h-4 flex-shrink-0" />
                <span>
                  {format(tournament.startDate, 'd MMM', { locale: es })} -{' '}
                  {format(tournament.endDate, 'd MMM yyyy', { locale: es })}
                </span>
              </div>
              {(tournament.city || tournament.courts[0]) && (
                <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  {/* Prefer the tournament's `city` (e.g. "Armenia,
                      Quindío") as the locality label — it reads
                      better than a court name like "INEM Cancha 1"
                      and is what the public expects. Fall back to
                      the first court when no city has been set so
                      legacy tournaments don't show blank. */}
                  <span className="truncate">
                    {tournament.city ?? tournament.courts[0]}
                  </span>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl sm:text-4xl md:text-5xl font-bold mb-0.5 sm:mb-1 text-white tabular-nums leading-none" style={FONT}>
        {value}
      </div>
      <div className="text-[10px] sm:text-sm text-white/60 uppercase tracking-wider">{label}</div>
    </div>
  );
}
