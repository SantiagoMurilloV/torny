import { useEffect, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../services/api';

type NotificationStatus = 'unsupported' | 'default' | 'granted' | 'denied';

const DISMISS_KEY = 'spk.notifications.dismissed';

/**
 * NotificationPrompt — opt-in for real Web Push notifications.
 *
 * Flow when the user hits "Activar":
 *   1. Request Notification permission from the browser.
 *   2. Ask the SW for a PushSubscription using the VAPID public key
 *      fetched from /api/push/vapid-public-key.
 *   3. POST the subscription to /api/push/subscribe so the backend can
 *      later push "match live" / "set closed" / "final" events.
 *
 * On iOS this only works when the PWA is installed to the Home Screen on
 * iOS 16.4+. In the browser (Safari on iPhone without Home Screen), the
 * permission request succeeds but no SW push is delivered — we still show
 * the prompt because the user might install the PWA next.
 */
export function NotificationPrompt({
  tournamentId,
  tournamentName,
}: {
  /** Per-tournament subscription. When provided, only get notifs for this tournament. */
  tournamentId?: string;
  tournamentName?: string;
}) {
  const [status, setStatus] = useState<NotificationStatus>('default');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Per-tournament dismiss key so a user can dismiss for one tournament
  // without affecting others.
  const dismissKey = tournamentId
    ? `spk.notifications.dismissed.${tournamentId}`
    : DISMISS_KEY;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) {
      setStatus('unsupported');
      return;
    }
    const perm = Notification.permission as NotificationStatus;
    setStatus(perm);

    const dismissed = localStorage.getItem(dismissKey) === '1';
    // Show only if the user hasn't decided yet AND hasn't dismissed the card.
    if (perm === 'default' && !dismissed) {
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, [dismissKey]);

  // Re-subscribe on mount if permission already granted (e.g. cleared data).
  useEffect(() => {
    if (status === 'granted') {
      subscribeToPush(tournamentId).catch(() => {});
    }
  }, [status, tournamentId]);

  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await Notification.requestPermission();
      setStatus(res as NotificationStatus);
      if (res === 'granted') {
        await subscribeToPush(tournamentId);
      }
      if (res !== 'default') setVisible(false);
    } catch {
      setStatus('denied');
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      // ignore — private-mode Safari throws on localStorage.setItem
    }
  };

  if (status === 'unsupported' || status === 'granted' || status === 'denied') {
    return null;
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-40"
          role="dialog"
          aria-label="Activar notificaciones"
        >
          <div className="relative bg-spk-black text-white rounded-sm overflow-hidden border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.32)]">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-spk-red" aria-hidden="true" />
            <button
              type="button"
              onClick={dismiss}
              aria-label="Cerrar"
              className="absolute top-2 right-2 p-1 text-white/50 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-4 pl-5 pr-8 flex items-start gap-3">
              <div className="w-10 h-10 bg-spk-red rounded-sm flex items-center justify-center flex-shrink-0">
                <Bell className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="text-sm font-bold uppercase text-white"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
                >
                  {tournamentName
                    ? `Seguir ${tournamentName}`
                    : 'Activá las notificaciones'}
                </h3>
                <p className="text-[11px] text-white/70 mt-1 leading-relaxed">
                  {tournamentName
                    ? `Te avisamos de los partidos en vivo, marcadores y resultados de este torneo. Solo recibirás notificaciones de ${tournamentName}.`
                    : 'Te avisamos cuando un partido arranca, cuando cambia el marcador y cuando se define un resultado.'}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={request}
                    disabled={busy}
                    className="inline-flex items-center gap-2 bg-spk-red hover:bg-spk-red-dark text-white text-xs font-bold uppercase px-3 py-2 rounded-sm transition-colors disabled:opacity-60"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    {busy ? 'Conectando…' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-2 py-2 transition-colors"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em' }}
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    Ahora no
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Register the browser with the push server.
 *
 * Call only AFTER the user has granted Notification permission. Idempotent —
 * if a subscription already exists for this browser we just re-send it to
 * the backend (in case the server lost it) without going through the full
 * pushManager.subscribe flow, which can prompt on some platforms.
 */
async function subscribeToPush(tournamentId?: string): Promise<void> {
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
  await api.subscribePush(subscription, tournamentId);
}

/** Convert the VAPID base64url public key into the Uint8Array subscribe expects. */
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
