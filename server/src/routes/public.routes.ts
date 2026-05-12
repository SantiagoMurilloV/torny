import { Router, Request, Response, NextFunction } from 'express';
import {
  getPublicView,
  registerPlayer,
} from '../services/publicRegistration.service';

/**
 * Public parent-registration surface (mig 029). Mounted at
 * `/api/public/*` so the `authMiddleware` bypass in middleware/auth.ts
 * recognises the path and lets the POST through without a bearer
 * token. The corresponding frontend page is `/torneo/:slug/inscripcion`.
 *
 * The routes are intentionally NOT cached:
 *
 *   · The GET response embeds tenant-leaning data (which clubs the
 *     parent can pick — distinct per tournament), and the roster
 *     counters move every time someone submits the form. A 30 s cache
 *     would either show stale "this team is full" badges or let two
 *     parents race past the cap. Both are user-facing bugs.
 *
 *   · The POST is a mutation by definition.
 *
 * We DO set `Cache-Control: no-store` + `Vary: Authorization` on every
 * response to defend against the edge (Fastly) caching them anyway —
 * the same lesson learnt in mig 028 with the /api/clubs/* routes.
 */
const router = Router();

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Origin, Accept-Encoding, Authorization');
  next();
});

router.get(
  '/tournaments/:slug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const view = await getPublicView(req.params.slug as string);
      res.json(view);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/tournaments/:slug/players',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Minimal shape check before the service does the heavy lifting.
      // Keeping it tight here lets us return a focused 400 instead of
      // a generic "validation failed" when the parent submits an
      // empty form (which the FE shouldn't let happen anyway).
      const teamId = typeof body.teamId === 'string' ? body.teamId : '';
      const firstName = typeof body.firstName === 'string' ? body.firstName : '';
      const lastName = typeof body.lastName === 'string' ? body.lastName : '';
      if (!teamId || !firstName || !lastName) {
        res
          .status(400)
          .json({ error: 'Faltan campos obligatorios (equipo, nombre, apellido)' });
        return;
      }
      const player = await registerPlayer(req.params.slug as string, {
        teamId,
        firstName,
        lastName,
        birthDate: typeof body.birthDate === 'string' ? body.birthDate : undefined,
        documentType:
          typeof body.documentType === 'string' ? body.documentType : undefined,
        documentNumber:
          typeof body.documentNumber === 'string' ? body.documentNumber : undefined,
        photo: typeof body.photo === 'string' ? body.photo : undefined,
        documentFile:
          typeof body.documentFile === 'string' ? body.documentFile : undefined,
        emergencyContactName:
          typeof body.emergencyContactName === 'string'
            ? body.emergencyContactName
            : undefined,
        emergencyContactPhone:
          typeof body.emergencyContactPhone === 'string'
            ? body.emergencyContactPhone
            : undefined,
        emergencyContactRelationship:
          typeof body.emergencyContactRelationship === 'string'
            ? body.emergencyContactRelationship
            : undefined,
      });
      // 201 Created — the parent's confetti screen is the user-facing
      // representation of the new resource so we don't bother
      // emitting a Location header.
      res.status(201).json(player);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
