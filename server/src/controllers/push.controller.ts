import { Request, Response, NextFunction } from 'express';
import {
  pushService,
  getVapidPublicKey,
  ensureReady,
  StoredSubscription,
} from '../services/push.service';
import { ValidationError } from '../middleware/errorHandler';

/**
 * Expose the VAPID public key so the browser can register a subscription.
 * Calls `ensureReady()` so the very first request on a fresh deploy still
 * returns a usable key even if boot-time initialization hadn't run yet.
 */
export async function vapidPublicKey(_req: Request, res: Response): Promise<void> {
  await ensureReady();
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ message: 'Push notifications no están configuradas' });
    return;
  }
  res.json({ publicKey: key });
}

/** Persist a browser subscription — called right after the user grants permission. */
export async function subscribe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as {
      subscription?: StoredSubscription;
      role?: string;
      /** Per-tournament subscription (mig 039). Omit for global (club captains). */
      tournamentId?: string;
    };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new ValidationError('Subscripción inválida');
    }
    await pushService.save({
      endpoint: sub.endpoint,
      keys: sub.keys,
      userId: req.user?.userId ?? null,
      // Club captains (mig 028) don't have a users.id but their JWT
      // carries `clubId`. Tagging the subscription with the club lets
      // the parent-registration flow ping back the right club without
      // a sub broadcast.
      clubId: req.user?.clubId ?? null,
      role: body.role ?? req.user?.role ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
      // Tournament-scoped subscription (mig 039): spectator follows a specific tournament.
      tournamentId: body.tournamentId ?? null,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** Remove a subscription — called when the browser revokes or unsubscribes. */
export async function unsubscribe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) {
      throw new ValidationError('Falta el endpoint');
    }
    await pushService.remove(endpoint);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
