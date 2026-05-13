import { Outlet, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NotificationPrompt } from './NotificationPrompt';
import { TornyTrophy } from './brand/TornyTrophy';

/**
 * JudgeLayout — minimal shell for the judge role. Shows the Torny mark, the
 * judge's display name and a logout button. No sidebar, no admin chrome — a
 * judge only needs to see live matches and score them.
 */
export function JudgeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col">
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-10 h-16 flex items-center justify-between">
          {/* Wordmark unified — same TornyTrophy + Barlow Condensed
              font-black tracking-tight as every other layout. Subtitle
              "Panel de Juez" sits in its own row below the wordmark so
              the brand mark reads identical to the public/admin/login
              headers. */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-white flex items-center justify-center text-black">
              <TornyTrophy className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div
                className="text-base sm:text-lg font-black tracking-wide"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Torn<span className="text-spk-red">y</span>
              </div>
              <div className="text-[10px] sm:text-[11px] text-white/55 uppercase tracking-[0.16em] mt-0.5">
                Panel de Juez · {user?.username ?? 'Juez'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <NotificationPrompt />
    </div>
  );
}
