import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

/**
 * Permission state for the Web Push API. Same vocabulary as
 * `Notification.permission` plus an `unsupported` bucket for
 * browsers that don't expose the API at all (older Safari versions,
 * Firefox in private mode, locked-down corporate builds).
 *
 *   · 'unsupported' → no `serviceWorker` / `PushManager` available
 *                     in this runtime; no UI affordance can flip it.
 *   · 'default'     → user hasn't decided yet; calling
 *                     `enable()` triggers the browser prompt.
 *   · 'granted'     → user accepted; we either already subscribed
 *                     or will on the next call.
 *   · 'denied'      → user rejected; reopening the prompt is a
 *                     no-op (browsers persist the denial), the UI
 *                     must point them at OS / browser settings.
 */
export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/**
 * Reusable wrapper around the Web Push subscription dance.
 *
 * Why a hook?
 *   The ClubPanel needs a manual bell toggle, the public tournament
 *   page needs a "follow" bell, and the club gate modal needs the
 *   same flow. Three call sites with subtle differences (where to
 *   read the public key, when to fire the toast) were diverging —
 *   this consolidates the source of truth.
 *
 * Behavior:
 *   · `permission` reflects the browser state and refreshes when
 *      the page regains focus (useful when the user changed it
 *      from OS / browser settings without reloading).
 *   · `subscribed` is true ONLY when (a) permission is `granted`
 *      AND (b) the registered service worker reports an existing
 *      `pushManager.getSubscription()`. Lets the UI light up the
 *      bell red without the user clicking it again on each refresh.
 *   · `enable()` triggers the browser prompt (if `default`), then
 *      calls `pushManager.subscribe(...)` with our VAPID key and
 *      persists the resulting subscription to the backend via
 *      `api.subscribePush()`. Idempotent — re-running on an
 *      already-subscribed client is harmless. Returns the new
 *      permission state so callers can branch UX (e.g. show a
 *      "permite las notificaciones del navegador" hint on denial).
 *   · `disable()` removes the local subscription (the browser
 *      stops getting pushes for this origin) AND tells the backend
 *      to drop the row. Permission stays `granted` so re-enabling
 *      doesn't prompt again.
 */
export function usePushSubscription(): {
  permission: PushPermission;
  subscribed: boolean;
  loading: boolean;
  enable: () => Promise<PushPermission>;
  disable: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PushPermission>(() => readPermission());
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Keep permission state fresh when the user toggles it from
  // browser settings or returns to the tab.
  useEffect(() => {
    const sync = () => setPermission(readPermission());
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

  // Probe the SW for an existing subscription on mount + after any
  // permission flip. `subscribed=true` requires both a positive
  // permission AND a real push subscription registered with the SW.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      if (typeof navigator === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setSubscribed(false);
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setSubscribed(Boolean(sub) && permission === 'granted');
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, [permission]);

  const enable = useCallback(async (): Promise<PushPermission> => {
    if (typeof window === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      return 'unsupported';
    }
    setLoading(true);
    try {
      // 1) Request OS-level permission. `Notification.requestPermission`
      //    returns the new state synchronously (Promise resolves with
      //    the final value). On `denied` the browser won't prompt
      //    again on subsequent calls — callers must point the user
      //    at browser settings.
      const next = await Notification.requestPermission();
      setPermission(next as PushPermission);
      if (next !== 'granted') return next as PushPermission;
      // 2) Subscribe to push via the SW. `getSubscription` first so
      //    we don't re-register on every click (idempotent).
      const { publicKey } = await api.getVapidPublicKey();
      if (!publicKey) return 'granted';
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      // 3) Persist server-side. The backend reads role + clubId from
      //    the JWT so unauthenticated public visitors land in the
      //    `sendToAll` bucket, club captains in `sendToClub`.
      await api.subscribePush(sub);
      setSubscribed(true);
      return 'granted';
    } catch (err) {
      // Silently downgrade to current permission state. The caller's
      // toast / UI handles the user-visible failure.
      console.warn('[push] enable failed', err);
      return readPermission();
    } finally {
      setLoading(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Best-effort: tell the backend to drop the row BEFORE the
        // browser revokes the subscription so we don't leave an
        // orphan endpoint that would fail on every dispatch.
        try {
          await api.unsubscribePush(sub.endpoint);
        } catch (err) {
          console.warn('[push] backend unsubscribe failed', err);
        }
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.warn('[push] disable failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { permission, subscribed, loading, enable, disable };
}

function readPermission(): PushPermission {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  return Notification.permission as PushPermission;
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
