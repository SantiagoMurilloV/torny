import { useEffect, useState } from 'react';
import { Bell, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../services/api';

/**
 * Invasive permission gate shown on the club panel. Renders as a
 * full-screen modal whenever:
 *
 *   · `Notification.permission` is `default` (the user hasn't decided
 *     yet) — every entry to /club-panel until they choose.
 *   · OR `Notification.permission` is `denied` AND we haven't shown
 *     them the "how to re-enable" copy this session.
 *
 * Why so aggressive: the club captain has to know the second a parent
 * inscribes a jugadora (so they can react / contact them / sanity
 * check the data). Missing those pings was the explicit complaint
 * from the org. The dismiss path is intentionally awkward — a tiny
 * "ahora no" link that only fades in after 3 s, so the user has to
 * read the "porqué importa" copy before they can skip.
 *
 * Closed states (granted or actively skipped this session) render
 * nothing.
 */

const DISMISSED_SESSION_KEY = 'spk.club.notifications.dismissed';

type Status = 'unsupported' | 'default' | 'granted' | 'denied';

export function ClubPushPermissionGate() {
  const [status, setStatus] = useState<Status>('unsupported');
  const [dismissed, setDismissed] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [busy, setBusy] = useState(false);

  // Initial status read + session-dismissed check.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setStatus('unsupported');
      return;
    }
    setStatus(Notification.permission as Status);
    setDismissed(sessionStorage.getItem(DISMISSED_SESSION_KEY) === '1');
  }, []);

  // Auto-resubscribe when the browser already has permission — covers
  // the case of a fresh PWA install / cleared browser data where the
  // server lost the subscription but the browser remembers consent.
  useEffect(() => {
    if (status === 'granted') {
      subscribeToPush().catch(() => {
        // Silent — we'll retry next time they visit the panel.
      });
    }
  }, [status]);

  // 3-second delay before the "ahora no" link appears, so the user
  // can't reflexively skip without reading. Re-arms whenever the
  // gate becomes visible.
  useEffect(() => {
    if (dismissed) return;
    if (status !== 'default' && status !== 'denied') return;
    setShowLater(false);
    const t = setTimeout(() => setShowLater(true), 3000);
    return () => clearTimeout(t);
  }, [status, dismissed]);

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = (await Notification.requestPermission()) as Status;
      setStatus(res);
      if (res === 'granted') {
        await subscribeToPush();
      }
    } catch {
      setStatus('denied');
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    sessionStorage.setItem(DISMISSED_SESSION_KEY, '1');
    setDismissed(true);
  };

  // Hide outright when we shouldn't gate.
  if (status === 'unsupported' || status === 'granted' || dismissed) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="club-push-gate"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Activá las notificaciones"
      >
        <motion.div
          initial={{ y: 24, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          className="bg-white rounded-sm shadow-2xl max-w-md w-full overflow-hidden"
        >
          <div className="bg-spk-red text-white px-6 py-5 flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-sm flex items-center justify-center flex-shrink-0">
              <Bell className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p
                className="text-[10px] uppercase tracking-wider text-white/70 font-bold"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Importante
              </p>
              <h2
                className="text-xl font-bold leading-tight"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Activá las notificaciones
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {status === 'denied' ? (
              <DeniedBody />
            ) : (
              <DefaultBody />
            )}

            <button
              type="button"
              onClick={handleEnable}
              disabled={busy || status === 'denied'}
              className="w-full bg-spk-red hover:bg-spk-red-dark text-white py-4 rounded-sm font-bold uppercase text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                letterSpacing: '0.08em',
              }}
            >
              {busy ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Conectando…
                </>
              ) : status === 'denied' ? (
                'Permisos bloqueados'
              ) : (
                <>
                  <Bell className="w-5 h-5" />
                  Activar notificaciones
                </>
              )}
            </button>

            <AnimatePresence>
              {showLater && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  type="button"
                  onClick={handleSkip}
                  className="block mx-auto text-[11px] text-black/40 hover:text-black/60 underline pt-1"
                >
                  Ahora no (perdés las alertas de esta sesión)
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function DefaultBody() {
  return (
    <>
      <p className="text-sm text-black/75 leading-relaxed">
        Te avisamos al instante cuando un acudiente inscribe a una
        jugadora en alguno de tus equipos. Sin esto vas a perderte
        inscripciones.
      </p>
      <ul className="text-sm text-black/70 space-y-1.5 pl-4 list-disc marker:text-spk-red">
        <li>Suena en tu celular y computador.</li>
        <li>Se ven sin abrir la app.</li>
        <li>Podés apagarlas desde el navegador cuando quieras.</li>
      </ul>
    </>
  );
}

function DeniedBody() {
  return (
    <>
      <div className="flex items-start gap-2 p-3 bg-red-50 border-l-2 border-red-500 rounded-sm">
        <AlertTriangle
          className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p className="text-sm text-black/80 leading-relaxed">
          El navegador bloqueó los permisos. Tenés que reactivarlos
          desde la configuración del sitio.
        </p>
      </div>
      <ol className="text-sm text-black/70 space-y-1.5 pl-5 list-decimal">
        <li>Tocá el candado o el ícono de información al lado de la URL.</li>
        <li>
          Buscá <b>Notificaciones</b> y cambiá la opción a{' '}
          <b>Permitir</b>.
        </li>
        <li>Recargá esta página.</li>
      </ol>
    </>
  );
}

/**
 * Subscribe the browser to the push channel. Idempotent on the
 * backend — re-runs are harmless. Tagged with the club captain's
 * `clubId` from the JWT so the public-registration endpoint can fan
 * the push back to the right club.
 */
async function subscribeToPush(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const { publicKey } = await api.getVapidPublicKey();
  if (!publicKey) return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api.subscribePush(subscription);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}
