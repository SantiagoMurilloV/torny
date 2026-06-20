import { request } from './client';

/**
 * Web-Push subscription endpoints. The VAPID public key is fetched at
 * the start of the opt-in flow so the Service Worker can generate the
 * right subscription. Subscribe / unsubscribe are authenticated but
 * also tolerate anonymous callers (see server/middleware/auth.ts).
 */
export const pushApi = {
  async getVapidPublicKey(): Promise<{ publicKey: string }> {
    return request<{ publicKey: string }>('/push/vapid-public-key');
  },

  async subscribePush(
    subscription: PushSubscription,
    /** Tournament ID for per-tournament subscriptions (mig 039). Omit for global. */
    tournamentId?: string,
  ): Promise<void> {
    await request<void>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        ...(tournamentId ? { tournamentId } : {}),
      }),
    });
  },

  async unsubscribePush(endpoint: string): Promise<void> {
    await request<void>('/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  },
};
