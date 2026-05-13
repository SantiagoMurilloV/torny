import { useEffect, useState } from 'react';
import { Bell, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../services/api';

/**
 * MANDATORY permission gate for the club panel.
 *
 * Mounted at the top of `/club-panel`. Renders as an UN-DISMISSIBLE
 * full-screen modal until the browser's `Notification.permission`
 * flips to `granted`. There is no "ahora no" escape, no session
 * skip, no backdrop click — the captain literally has to accept
 * to use the panel.
 *
 * Why this aggressive: the captain needs to know the second a
 * parent inscribes a jugadora, a score updates, a schedule moves,
 * etc. The 2026-05-13 audit revealed that **zero of twelve clubs**
 * had subscriptions registered after a soft prompt — every captain
 * either reflex-skipped or never reached the panel. Forcing the
 * acceptance turns notifications from an opt-in into a precondition
 * of operating as a club captain.
 *
 * The only branch that allows the panel to render is `permission ===
 * 'granted'`. When the user previously denied (`'denied'`) we keep
 * the modal up but switch copy to instructions for re-enabling
 * from browser settings — the panel still stays locked behind it.
 */

type Status = 'unsupported' | 'default' | 'granted' | 'denied';

export function ClubPushPermissionGate() {
  const [status, setStatus] = useState<Status>('unsupported');
  const [busy, setBusy] = useState(false);

  // Initial status read. Re-syncs on focus/visibility so a user who
  // just flipped the permission from browser settings sees the
  // panel unlock without having to refresh the tab.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setStatus('unsupported');
      return;
    }
    const sync = () => setStatus(Notification.permission as Status);
    sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', sync);
    };
  }, []);

  // Auto-resubscribe whenever the browser already has permission —
  // covers a fresh PWA install / cleared browser data where the
  // server lost the subscription but the browser remembers consent.
  useEffect(() => {
    if (status === 'granted') {
      subscribeToPush().catch(() => {
        // Silent — we'll retry next time the gate mounts.
      });
    }
  }, [status]);

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

  // The ONLY exit. `unsupported` is rare enough that we let the
  // panel through too (the captain can't fix what their browser
  // doesn't support; blocking them out forever is worse than
  // silently degrading).
  if (status === 'unsupported' || status === 'granted') {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="club-push-gate"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        // Higher z than every other modal in the app so nothing can
        // overlap or steal focus from this gate. No `onClick` on the
        // backdrop on purpose — clicks outside the card do NOTHING,
        // the captain literally can't dismiss the modal without
        // accepting (or closing the tab / logging out manually).
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-lg p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Activá las notificaciones para continuar"
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
                className="text-[10px] uppercase tracking-wider text-white/80 font-bold"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Obligatorio para continuar
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
            {status === 'denied' ? <DeniedBody /> : <DefaultBody />}

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
                'Activá los permisos desde el navegador'
              ) : (
                <>
                  <Bell className="w-5 h-5" />
                  Activar notificaciones
                </>
              )}
            </button>

            {/* "Ahora no" retirado (2026-05-13) — el captain ya no
                puede seguir sin aceptar. La única salida es cerrar
                sesión, que es una decisión consciente y no un reflex
                tap. */}
            <p className="text-[11px] text-black/45 text-center leading-relaxed">
              Si no querés activarlas, tenés que <b>cerrar sesión</b>{' '}
              — el panel no se puede usar sin notificaciones.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function DefaultBody() {
  return (
    <>
      <p className="text-sm text-black/85 leading-relaxed">
        Las notificaciones son <b>obligatorias</b> para administrar
        tu club. Te avisamos al instante de todo lo que pasa con
        tus equipos:
      </p>
      <ul className="text-sm text-black/75 space-y-1.5 pl-4 list-disc marker:text-spk-red">
        <li>Cuando el organizador publica el cronograma del torneo.</li>
        <li>Cambios de horario, cancha o día.</li>
        <li>Cuando arranca un partido de uno de tus equipos.</li>
        <li>Cada set cerrado y el resultado final.</li>
        <li>Nuevas inscripciones de jugadoras.</li>
      </ul>
      <p className="text-[11px] text-black/55 leading-relaxed">
        El navegador te va a pedir permiso después de tocar el botón.
        Tenés que tocar <b>Permitir</b>.
      </p>
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
        <p className="text-sm text-black/85 leading-relaxed">
          <b>Bloqueaste las notificaciones.</b> Tenés que reactivarlas
          desde la configuración del navegador antes de poder usar
          el panel del club.
        </p>
      </div>
      <ol className="text-sm text-black/75 space-y-1.5 pl-5 list-decimal">
        <li>Tocá el candado o el ícono de información al lado de la URL.</li>
        <li>
          Buscá <b>Notificaciones</b> y cambiá la opción a <b>Permitir</b>.
        </li>
        <li>
          Recargá esta página — el panel se va a desbloquear automáticamente.
        </li>
      </ol>
    </>
  );
}

/**
 * Subscribe the browser to the push channel. Idempotent on the
 * backend — re-runs are harmless. Tagged with the club captain's
 * `clubId` from the JWT so the per-club fan-out (match score /
 * state / schedule changes + ad-hoc broadcasts) lands on the right
 * device.
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
