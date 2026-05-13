import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { TornyTrophy } from '../../components/brand/TornyTrophy';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Fixed top navigation for the public home. Transparent at the top,
 * darkens with a blur as the user scrolls past the hero. The login
 * entry-point is rendered as an invisible hit-area on the right edge:
 * deliberately undiscoverable for casual visitors, accessible by
 * keyboard and to anyone who knows where to click.
 */
export function HomeHeader() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? 'backdrop-blur-2xl' : ''
      }`}
      style={{
        backgroundColor: scrolled ? 'rgba(0, 0, 0, 0.8)' : 'transparent',
        borderBottom: scrolled ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
      }}
    >
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="flex items-center justify-between gap-3 h-16 sm:h-20 md:h-24">
          <motion.div
            className="flex items-center gap-2 sm:gap-3 cursor-pointer group min-w-0"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            whileHover={{ x: 2 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <motion.div
              className="w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-sm bg-white flex items-center justify-center flex-shrink-0 text-black"
              whileHover={{ scale: 1.06 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            >
              <TornyTrophy className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8" />
            </motion.div>
            <div className="min-w-0">
              <h1
                className="text-2xl sm:text-3xl md:text-4xl font-black tracking-wide leading-none truncate"
                style={FONT}
              >
                Torn<span className="text-spk-red">y</span>
              </h1>
              <motion.div
                className="h-0.5 bg-spk-red mt-1"
                initial={{ width: 0 }}
                animate={{ width: scrolled ? '0%' : '100%' }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>

          <motion.button
            type="button"
            onClick={() => navigate('/login')}
            aria-label="Acceso administrador"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            className="group relative h-10 w-10 rounded-full bg-white/5 border border-white/15 backdrop-blur-sm flex items-center justify-center outline-none transition-colors hover:bg-white/10 hover:border-spk-red/60 focus-visible:ring-2 focus-visible:ring-spk-red/50"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-spk-red transition-all duration-300 group-hover:h-2.5 group-hover:w-2.5 group-hover:shadow-[0_0_8px_rgba(220,38,38,0.7)]"
            />
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}
