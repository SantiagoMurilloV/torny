import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Trophy } from 'lucide-react';

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
              className="w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-sm bg-white flex items-center justify-center flex-shrink-0"
              whileHover={{ rotate: 180 }}
              transition={{ duration: 0.4 }}
            >
              <Trophy className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-black" />
            </motion.div>
            <div className="min-w-0">
              <h1
                className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tighter leading-none truncate"
                style={FONT}
              >
                SetPoint
              </h1>
              <motion.div
                className="h-0.5 bg-spk-red mt-1"
                initial={{ width: 0 }}
                animate={{ width: scrolled ? '0%' : '100%' }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>

          <button
            type="button"
            onClick={() => navigate('/login')}
            aria-label="Acceso administrador"
            title=""
            className="group relative h-9 w-9 rounded-sm bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            <span
              aria-hidden="true"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-spk-red opacity-0 transition-opacity duration-300 group-hover:opacity-60 group-focus-visible:opacity-80"
            />
          </button>
        </div>
      </div>
    </motion.header>
  );
}
