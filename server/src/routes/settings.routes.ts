import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settings.controller';
import { cacheGet } from '../middleware/cache';

const router = Router();

// System settings (system name, branding, etc.) change extremely
// rarely. Cache aggressively so every public page load doesn't hit
// the database for the same row.
router.get('/', cacheGet(300), getSettings);
router.put('/', updateSettings);

export default router;
