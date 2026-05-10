import { Download, X, Share2, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation } from 'react-router';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

/**
 * InstallPrompt — floating card that offers to install the PWA.
 *
 * - Chrome/Edge/Android → one-tap native prompt via `beforeinstallprompt`.
 * - iOS Safari → a lightweight instructions card (Compartir → Añadir a inicio).
 * - Snoozes 7 days on dismissal (see `useInstallPrompt`).
 * - Hidden on admin/login so we don't nag organizers mid-task.
 */
export function InstallPrompt() {
  const { isAvailable, isIOS, prompt, dismiss } = useInstallPrompt();
  const location = useLocation();

  const hiddenRoute =
    location.pathname.startsWith('/admin') || location.pathname === '/login';

  if (!isAvailable || hiddenRoute) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 240 }}
        className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-40"
        role="dialog"
        aria-label="Instalar Torny"
      >
        <div className="relative bg-spk-black text-white rounded-sm shadow-[0_20px_60px_rgba(0,0,0,0.32)] overflow-hidden border border-white/10">
          {/* red accent rail */}
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-spk-red" aria-hidden="true" />

          <div className="p-4 pl-5 pr-3 flex items-start gap-3">
            <div className="w-10 h-10 bg-spk-red rounded-sm flex items-center justify-center flex-shrink-0">
              <Download className="w-5 h-5" aria-hidden="true" />
            </div>

            <div className="flex-1 min-w-0">
              <h3
                className="text-sm font-bold uppercase text-white"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
              >
                Instala Torn<span className="text-spk-red">y</span>
              </h3>
              {isIOS ? (
                <p className="text-[11px] text-white/70 mt-1 leading-relaxed">
                  Toca <Share2 className="w-3 h-3 inline mx-0.5 -mt-0.5" aria-hidden="true" />{' '}
                  <strong>Compartir</strong> y luego{' '}
                  <Plus className="w-3 h-3 inline mx-0.5 -mt-0.5" aria-hidden="true" />{' '}
                  <strong>Añadir a pantalla de inicio</strong> para acceder como app.
                </p>
              ) : (
                <p className="text-[11px] text-white/70 mt-1 leading-relaxed">
                  Accede más rápido, recibe notificaciones y sigue los torneos sin abrir el navegador.
                </p>
              )}

              {!isIOS && (
                <button
                  type="button"
                  onClick={prompt}
                  className="mt-3 inline-flex items-center gap-2 bg-spk-red hover:bg-spk-red-dark text-white text-xs font-bold uppercase px-3 py-2 rounded-sm transition-colors"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
                >
                  Instalar ahora
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={dismiss}
              className="p-1.5 text-white/50 hover:text-white transition-colors flex-shrink-0"
              aria-label="Descartar"
              title="Descartar"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
