import { motion, useScroll, useTransform } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { ImageWithFallback } from '../../components/figma/ImageWithFallback';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1765109260914-de67ccbbcab3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1920';

/**
 * Full-viewport hero: static volleyball shot with parallax + brand
 * color wash, the bold VIVE LA COMPETENCIA title, and a single CTA
 * (jump to the tournaments grid). Stats + scroll indicator at the
 * bottom.
 */
export function HeroSection({
  totalTournaments,
  ongoingTournaments,
  onViewTournaments,
}: {
  totalTournaments: number;
  ongoingTournaments: number;
  onViewTournaments: () => void;
}) {
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 1.2]);
  const heroY = useTransform(scrollY, [0, 300], [0, 100]);

  return (
    <section className="relative h-screen overflow-hidden">
      <motion.div style={{ scale: heroScale, y: heroY }} className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black z-10" />
        <ImageWithFallback
          src={HERO_IMAGE}
          alt="Acción deportiva"
          className="w-full h-full object-cover opacity-60"
        />
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(227, 30, 36, 0.2), transparent, rgba(0, 48, 135, 0.2))',
          }}
          animate={{ opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>

      <motion.div
        style={{ opacity: heroOpacity }}
        className="relative z-20 h-full flex items-center"
      >
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12 w-full">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full mb-6 sm:mb-8"
            >
              <motion.div
                className="w-2 h-2 bg-spk-red rounded-full"
                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-xs sm:text-sm font-medium tracking-wide">
                {ongoingTournaments} TORNEOS EN VIVO
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 100 }}
              className="text-[2.75rem] sm:text-6xl md:text-8xl lg:text-9xl font-bold mb-4 sm:mb-6 leading-[0.95] sm:leading-[0.9] tracking-tighter"
              style={FONT}
            >
              VIVE LA
              <br />
              <span className="relative inline-block">
                COMPETENCIA
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-2 sm:h-3 md:h-5 bg-spk-red"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.8, duration: 0.8, ease: 'easeOut' }}
                  style={{ originX: 0, zIndex: -1 }}
                />
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="text-base sm:text-xl md:text-2xl text-white/80 mb-6 sm:mb-10 max-w-2xl leading-relaxed"
            >
              Consulta torneos, resultados en vivo, clasificaciones y toda la acción deportiva en
              tiempo real
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4"
            >
              <motion.button
                whileHover={{ scale: 1.05, x: 5 }}
                whileTap={{ scale: 0.98 }}
                onClick={onViewTournaments}
                className="flex items-center justify-center gap-3 px-6 sm:px-8 py-3.5 sm:py-4 bg-white text-black text-base sm:text-lg font-bold rounded-sm hover:bg-white/90 transition-colors"
                style={FONT}
              >
                VER TORNEOS
                <ArrowRight className="w-5 h-5" />
              </motion.button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="flex flex-wrap gap-6 sm:gap-8 md:gap-12 mt-10 sm:mt-16"
            >
              <HeroStat label="Torneos" value={totalTournaments} />
              <HeroStat label="En vivo" value={ongoingTournaments} />
            </motion.div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20"
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 border-2 border-white/30 rounded-full flex items-start justify-center p-2"
        >
          <motion.div
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-2 bg-white rounded-full"
          />
        </motion.div>
      </motion.div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        className="text-3xl sm:text-4xl md:text-5xl font-bold mb-1 tabular-nums"
        style={{ ...FONT, letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
      <div className="text-xs sm:text-sm text-white/60 uppercase tracking-wider">{label}</div>
    </div>
  );
}
