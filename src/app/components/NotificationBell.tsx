import { useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePushSubscription } from '../hooks/usePushSubscription';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * One-click "follow" affordance that gates the Web Push subscribe
 * flow behind a confirm dialog so a misclick can't trigger an OS
 * permission prompt the user doesn't want.
 *
 * Visual states:
 *   · `subscribed=true`           → red bell (filled) — "ya estás
 *                                    recibiendo notificaciones"
 *   · `permission='denied'`       → gray bell crossed out + tooltip
 *                                    pointing at browser settings
 *   · `permission='unsupported'`  → bell hidden (the runtime can't
 *                                    deliver the notif anyway)
 *   · default (gray)              → click → confirm → enable()
 *
 * Mounted on:
 *   · `Header.tsx`        (public tournament view)
 *   · `ClubPanel.tsx`     (next to the captain's "Cerrar sesión")
 *
 * The hook handles everything except the dialog + visual states so
 * the two call sites stay one-liners.
 */
export function NotificationBell({
  size = 'md',
  variant = 'public',
  theme = 'light',
}: {
  size?: 'sm' | 'md';
  /**
   * Slightly different copy depending on audience:
   *   · 'public' → "te avisamos de los partidos y resultados"
   *   · 'club'   → "te avisamos de tus equipos: marcadores,
   *                 cambios de horario, estados de partido."
   */
  variant?: 'public' | 'club';
  /**
   * Light backgrounds (default) → dark icon + soft gray hover.
   * Dark backgrounds (public header, sticky top bar) → white icon
   * + white/10 hover so the bell reads against the black chrome.
   * The subscribed-red state is identical in both themes — the red
   * pop is intentional.
   */
  theme?: 'light' | 'dark';
}) {
  const { permission, subscribed, loading, enable, disable } = usePushSubscription();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (permission === 'unsupported') {
    // Nothing to subscribe to in this runtime. Hide the bell so the
    // UI doesn't suggest an affordance that can't be honoured.
    return null;
  }

  const dimensions = size === 'sm' ? 'w-9 h-9' : 'w-10 h-10';
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';

  // Subscribed → red bell with confirm dialog to UNsubscribe.
  // Default / not subscribed → gray bell, confirm dialog to enable.
  // Denied → gray bell with a denied-specific toast.
  const onClick = () => {
    if (subscribed) {
      setConfirmOpen(true);
      return;
    }
    if (permission === 'denied') {
      toast.error(
        'Las notificaciones están bloqueadas en este navegador. Activalas desde el ícono de candado en la barra de direcciones y volvé a intentar.',
      );
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (subscribed) {
      await disable();
      toast.success('Notificaciones desactivadas');
      setConfirmOpen(false);
      return;
    }
    const next = await enable();
    if (next === 'granted') {
      toast.success(
        variant === 'club'
          ? 'Listo. Te avisamos de cada cambio en tus equipos.'
          : 'Listo. Te avisamos cuando arranquen partidos y cuando haya resultados.',
      );
      setConfirmOpen(false);
      return;
    }
    if (next === 'denied') {
      toast.error(
        'No se concedió el permiso. Podés activarlo desde la configuración del navegador.',
      );
      setConfirmOpen(false);
      return;
    }
    // 'default' → user closed the prompt without choosing. Leave the
    // dialog open so they can retry without re-clicking the bell.
  };

  const Icon = subscribed ? BellRing : permission === 'denied' ? BellOff : Bell;
  // Subscribed → red pops the same on both themes. Idle / denied
  // states swap fg + hover so the bell stays legible on the
  // black sticky header.
  const colorClass = subscribed
    ? 'text-spk-red bg-spk-red/15 hover:bg-spk-red/25'
    : theme === 'dark'
      ? permission === 'denied'
        ? 'text-white/40 hover:bg-white/10'
        : 'text-white/85 hover:bg-white/10'
      : permission === 'denied'
        ? 'text-black/40 hover:bg-black/5'
        : 'text-black/60 hover:bg-black/5';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-label={subscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'}
        title={
          subscribed
            ? 'Notificaciones activas. Tocá para desactivarlas.'
            : permission === 'denied'
              ? 'Notificaciones bloqueadas — activalas desde el navegador.'
              : 'Activar notificaciones'
        }
        className={`inline-flex items-center justify-center ${dimensions} rounded-sm transition-colors ${colorClass} disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {loading ? (
          <Loader2 className={`${iconSize} animate-spin`} aria-hidden="true" />
        ) : (
          <Icon className={iconSize} aria-hidden="true" />
        )}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !loading) setConfirmOpen(false);
        }}
        title={
          subscribed
            ? '¿Desactivar las notificaciones?'
            : '¿Activar las notificaciones?'
        }
        description={
          subscribed
            ? 'Vas a dejar de recibir avisos en este dispositivo. Podés volver a activarlas en cualquier momento.'
            : variant === 'club'
              ? 'Te avisaremos al instante cuando haya cambios en tus equipos: ' +
                'cuando arranque un partido, cuando se cargue un marcador, cuando el organizador cambie un horario o cuando termine el partido. ' +
                'El navegador te va a pedir permiso después de aceptar.'
              : 'Te avisaremos cuando empiecen los partidos, cuando se cierren sets y cuando haya resultados. ' +
                'El navegador te va a pedir permiso después de aceptar.'
        }
        confirmLabel={subscribed ? 'Desactivar' : 'Activar'}
        variant="default"
        loading={loading}
        onConfirm={handleConfirm}
      />
    </>
  );
}
