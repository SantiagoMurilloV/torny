import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { TornyTrophy } from '../../components/brand/TornyTrophy';
import { NotificationBell } from '../../components/NotificationBell';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Fixed top-of-page chrome for the public tournament-detail view.
 * Shows the Torny mark + a back button + the follow CTA. The
 * backdrop darkens as the user scrolls past the hero.
 *
 * The follow button used to be a decorative local-state toggle. It
 * now drives a real Web Push subscription via NotificationBell so a
 * spectator who taps "Bell" actually receives the same `sendToAll`
 * notifications that the match.service fires on score / status
 * changes — same flow as the club captain's bell in the panel.
 */
export function Header({
  tournamentName,
  tournamentId,
}: {
  tournamentName: string;
  tournamentId?: string;
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

            {/* Wordmark unified — TornyTrophy + Barlow Condensed
                font-black tracking-tight, matching the public Home,
                Admin, Judge and Login layouts. */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 rounded-sm bg-white flex items-center justify-center flex-shrink-0 text-black">
                <TornyTrophy className="w-5 h-5" />
              </div>
              <h1
                className="text-base sm:text-lg md:text-xl font-black tracking-wide leading-none text-white truncate"
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

            <NotificationBell variant="public" theme="dark" tournamentId={tournamentId} />
          </div>
        </div>
      </div>
    </motion.header>
  );
}
