import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, Bell, Trophy } from 'lucide-react';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Fixed top-of-page chrome for the public tournament-detail view.
 * Shows the Torny mark + a back button + the follow CTA. The
 * backdrop darkens as the user scrolls past the hero.
 */
export function Header({
  tournamentName,
  isFollowing,
  onToggleFollow,
}: {
  tournamentName: string;
  isFollowing: boolean;
  onToggleFollow: () => void;
}) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? 'backdrop-blur-2xl' : 'backdrop-blur-md'
      }`}
      style={{
        backgroundColor: scrolled ? 'rgba(0, 0, 0, 0.95)' : 'rgba(0, 0, 0, 0.8)',
        borderBottom: scrolled ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
      }}
    >
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="flex items-center justify-between gap-2 h-16">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <motion.button
              onClick={() => navigate('/')}
              whileHover={{ scale: 1.05, x: -3 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 text-white/70 hover:text-white transition-colors flex-shrink-0"
              aria-label="Volver al inicio"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden md:inline text-sm font-medium">Volver</span>
            </motion.button>

            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
                <Trophy className="w-4 h-4 text-black" />
              </div>
              <h1
                className="text-base sm:text-lg md:text-xl font-bold tracking-tighter leading-none text-white truncate"
                style={FONT}
              >
                Torn<span className="text-spk-red">y</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <motion.div
              className="hidden lg:block text-white font-medium truncate max-w-[300px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: scrolled ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            >
              {tournamentName}
            </motion.div>

            <motion.button
              onClick={onToggleFollow}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-sm transition-colors ${
                isFollowing ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              aria-label={isFollowing ? 'Dejar de seguir' : 'Seguir torneo'}
            >
              <Bell className={`w-4 h-4 ${isFollowing ? 'fill-current' : ''}`} />
              <span className="hidden md:inline text-sm font-medium">
                {isFollowing ? 'Siguiendo' : 'Seguir'}
              </span>
            </motion.button>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
