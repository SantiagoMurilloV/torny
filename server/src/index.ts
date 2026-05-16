import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import cluster from 'node:cluster';
import os from 'node:os';
import multer from 'multer';
import { checkConnection, getPool, runMigrations } from './config/database';
import { ensureReady as ensurePushReady } from './services/push.service';
import { ensureSuperAdmin } from './services/platformBootstrap';
import { touchUser, touchVisitor } from './services/presence';
import { startPresenceReporter } from './services/telegram-reporter';
import { startAutoLive } from './services/autoLive';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth.routes';
import tournamentRoutes from './routes/tournament.routes';
import teamRoutes from './routes/team.routes';
import matchRoutes from './routes/match.routes';
import settingsRoutes from './routes/settings.routes';
import userRoutes from './routes/user.routes';
import pushRoutes from './routes/push.routes';
import adminRoutes from './routes/admin.routes';
import platformRoutes from './routes/platform.routes';
import clubRoutes from './routes/club.routes';
import publicRoutes from './routes/public.routes';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── CORS whitelist ────────────────────────────────────────────────
// Accepts four buckets of origins, in order:
//   1. Anything in the explicit `CORS_ORIGINS` env var (comma-separated).
//   2. Any `https://*.vercel.app` origin — we deploy the frontend there
//      and Vercel rotates preview URLs per deployment. Hardcoding each
//      one is painful, so we trust the whole subdomain family.
//   3. The production custom domain `torny.app` and any of its subdomains
//      (`www.torny.app`, future staging/preview hosts, etc).
//   4. In non-production (`NODE_ENV !== 'production'`), everything.
// Requests without an Origin header (same-origin, curl, server-to-server)
// are always allowed.
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Returns true when the origin looks like `https://<anything>.vercel.app`. */
function isVercelOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

/** Returns true for `https://torny.app` and any `https://*.torny.app` subdomain. */
function isTornyOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'torny.app' || url.hostname.endsWith('.torny.app');
  } catch {
    return false;
  }
}

const corsOptions: cors.CorsOptions = IS_PROD
  ? {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (corsOrigins.includes(origin)) return cb(null, true);
        if (isVercelOrigin(origin)) return cb(null, true);
        if (isTornyOrigin(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }
  : { origin: true, credentials: true };

// Express is behind Vercel's rewrite proxy in production. Without this,
// `req.ip` would report the Vercel edge IP (which rotates per request
// across edges), so the visitor fingerprint would treat every page
// refresh as a brand-new visitor. Trusting the proxy makes Express
// read the client IP from X-Forwarded-For, keeping the fingerprint
// stable across refreshes for the same human.
app.set('trust proxy', true);

app.use(cors(corsOptions));

// gzip / deflate compression for every response. Crucial on the public
// polling endpoints — a tournament with 200 spectators each pulling
// `/matches` (≈180 KB raw JSON) every 20 s gets ~5–6× smaller payloads
// here, dropping a 4-day torneo from ~320 GB egress to ~55 GB. The
// `compression` defaults already skip responses with `Cache-Control:
// no-transform` and bodies under ~1 KB, so there's no measurable cost
// on tiny payloads (auth, settings, single-team fetches).
app.use(compression());

// JSON body limit raised so team / tournament payloads can carry a
// base64-encoded logo (up to ~10 MB raw → ~14 MB encoded plus room for
// other fields).
app.use(express.json({ limit: '20mb' }));

// Presence tracking (anonymous visitors). Counts ONLY truly public
// traffic — requests that arrive without an Authorization header AND
// don't look like a bot. Authed users are tracked separately via
// touchUser() after authMiddleware resolves req.user, so an admin
// polling the API every 25 s doesn't double-count as a "visitor".
const BOT_UA_RE =
  /bot|crawler|spider|slurp|uptimerobot|pingdom|headlesschrome|node-fetch|curl|wget|axios|python-requests|healthcheck|ahrefs|semrush|facebookexternalhit/i;
app.use((req, _res, next) => {
  if (req.path === '/api/health') return next();
  // Drop anything that carries a bearer token — that's either an admin,
  // a judge or the super_admin, all handled by touchUser() below.
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  // Skip obvious bots and uptime monitors so they don't pad the number.
  const ua = (req.headers['user-agent'] ?? '').toString();
  if (BOT_UA_RE.test(ua)) return next();
  touchVisitor(req);
  next();
});

// Auth middleware — protects POST/PUT/DELETE (except login)
app.use(authMiddleware);

// Mark authed users active AFTER authMiddleware has populated req.user.
app.use((req, _res, next) => {
  if (req.user?.userId) touchUser(req.user.userId);
  next();
});

// Health check.
//
// Pings Postgres with a trivial `SELECT 1` so an external uptime monitor
// (UptimeRobot, Better Stack, etc) hitting this every few minutes keeps
// BOTH the Express container AND the pg connection pool warm. Without
// the DB ping, the pool would still close idle TCP connections and the
// next real request would pay a fresh handshake — exactly the cold-start
// feel we're trying to eliminate.
//
// We use a short statement_timeout so a wedged DB doesn't hold the
// health endpoint open and trip the monitor's own timeout.
// Build identifier injected via Railway's RAILWAY_GIT_COMMIT_SHA env
// var (auto-set on every deploy). Lets the keep-alive cron and humans
// confirm a redeploy actually rolled out without needing dashboard
// access.
const BUILD_SHA = (process.env.RAILWAY_GIT_COMMIT_SHA || 'dev').slice(0, 7);
const BUILD_TIME = new Date().toISOString();

app.get('/api/health', async (_req, res) => {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('SET statement_timeout = 2000');
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    res.json({
      status: 'ok',
      db: 'ok',
      build: BUILD_SHA,
      bootedAt: BUILD_TIME,
      poolMax: (pool as unknown as { options?: { max?: number } }).options?.max ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[health] DB ping failed:', err);
    res
      .status(503)
      .json({
        status: 'degraded',
        db: 'down',
        build: BUILD_SHA,
        bootedAt: BUILD_TIME,
        timestamp: new Date().toISOString(),
      });
  }
});

// ── Serve uploaded files with path-traversal guard ───────────────
// We resolve the requested file against the uploads root and refuse to serve
// anything that would escape it via "..", absolute paths, or symlinks.
const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
// Ensure the directory exists to avoid 500s on first run
fs.mkdirSync(path.join(UPLOADS_ROOT, 'logos'), { recursive: true });

app.get('/uploads/*', (req: Request, res: Response, next: NextFunction) => {
  try {
    const requested = req.params[0] ?? '';
    // Reject any request that contains a null byte or looks like a URL
    if (requested.includes('\0')) {
      return res.status(400).send('Invalid path');
    }

    const safePath = path.resolve(UPLOADS_ROOT, requested);
    // Confirm the resolved path is inside UPLOADS_ROOT
    if (!safePath.startsWith(UPLOADS_ROOT + path.sep) && safePath !== UPLOADS_ROOT) {
      return res.status(403).send('Forbidden');
    }

    // Resolve symlinks and re-check containment
    fs.realpath(safePath, (err, realPath) => {
      if (err) return res.status(404).send('Not found');
      if (!realPath.startsWith(UPLOADS_ROOT + path.sep) && realPath !== UPLOADS_ROOT) {
        return res.status(403).send('Forbidden');
      }
      res.sendFile(realPath, (sendErr) => {
        if (sendErr) next(sendErr);
      });
    });
  } catch (err) {
    next(err);
  }
});

// File upload endpoint — stores the image inline as a base64 data URL
// instead of writing to disk. Railway's default filesystem is ephemeral
// (wiped on every redeploy) so disk storage silently lost every upload.
// Data URLs live in Postgres (logo / cover_image are TEXT columns) so
// images survive deploys and Postgres restarts.
//
// Accept any MIME starting with `image/` — phones upload HEIC/HEIF, PCs
// send PNG/JPEG/WEBP/GIF, design tools export SVG, and occasionally the
// platform sends `application/octet-stream` (we validate that by falling
// back to the file extension).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    // Some mobile browsers / mail clients strip the MIME — fall back to
    // the extension so the upload isn't rejected for a benign reason.
    const ext = path.extname(file.originalname).toLowerCase();
    const imageExts = [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.svg',
      '.bmp',
      '.avif',
      '.heic',
      '.heif',
    ];
    cb(null, imageExts.includes(ext));
  },
});

/** Best-effort MIME inference from the original filename when the client sent a generic one. */
function mimeFromFilename(name: string): string | null {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.png':  return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif':  return 'image/gif';
    case '.svg':  return 'image/svg+xml';
    case '.bmp':  return 'image/bmp';
    case '.avif': return 'image/avif';
    case '.heic': return 'image/heic';
    case '.heif': return 'image/heif';
    default:      return null;
  }
}

app.post('/api/upload/logo', upload.single('logo'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'No se proporcionó un archivo de imagen válido' });
    return;
  }
  const mime =
    req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
      ? req.file.mimetype
      : mimeFromFilename(req.file.originalname) || 'image/jpeg';
  const base64 = req.file.buffer.toString('base64');
  const url = `data:${mime};base64,${base64}`;
  res.json({ url });
});

// Document upload — PDF (used for player identity documents). Same
// base64-in-Postgres strategy as images since Railway's FS is ephemeral.
// 10 MB cap so people can't dump full scanned folders into a TEXT column.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.pdf');
  },
});

app.post('/api/upload/document', documentUpload.single('document'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'Se requiere un archivo PDF válido' });
    return;
  }
  const base64 = req.file.buffer.toString('base64');
  const url = `data:application/pdf;base64,${base64}`;
  res.json({ url });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/clubs', clubRoutes);
// Public parent-registration endpoints (mig 029). The auth middleware
// bypasses POST /api/public/* by path prefix so this mount must stay at
// `/api/public` (NOT `/public`, NOT `/api/parent-registration`).
app.use('/api/public', publicRoutes);

// Error handler — must be last. Registering it up here (outside startServer)
// ensures it catches errors even if boot-time migration fails.
app.use(errorHandler);

async function startServer() {
  try {
    const connected = await checkConnection();
    if (!connected) {
      console.error('No se pudo conectar a la base de datos. Iniciando sin DB...');
    } else if (!cluster.isWorker) {
      // Single-process mode: run migrations here.
      // Clustered mode: primary already ran migrations before forking workers.
      console.log('Conexión a PostgreSQL establecida.');
      await runMigrations();
      console.log('Migraciones ejecutadas correctamente.');
      // Resolve / generate / persist VAPID keys right after migrations so
      // app_config exists. Safe to call before any request comes in;
      // getVapidPublicKey() / sendToAll() use the cached pair.
      await ensurePushReady();
      // Bootstrap the platform owner account so /super-admin/* works on
      // first boot without manual SQL. Idempotent.
      await ensureSuperAdmin();
    }
  } catch (error) {
    console.error('Error durante la inicialización de la base de datos:', error);
  }

  app.listen(PORT, () => {
    const label = cluster.isWorker ? `worker pid=${process.pid}` : 'single';
    console.log(`Servidor Torny corriendo en puerto ${PORT} [${label}]`);
    // Presence reporter runs once: in single-process mode it starts here;
    // in clustered mode the primary already started it before forking.
    if (!cluster.isWorker) {
      startPresenceReporter();
      startAutoLive();
    }
  });
}

// ── Cluster bootstrap ────────────────────────────────────────────────────────
// Railway sets WEB_CONCURRENCY automatically on paid plans to match the number
// of vCPUs available. On free/single-CPU plans it's unset, so we fall back to
// os.cpus().length (typically 1) and the else branch runs single-process mode.
// Override by setting WEB_CONCURRENCY=1 in Railway env vars to disable clustering.
const WEB_CONCURRENCY = parseInt(
  process.env.WEB_CONCURRENCY ?? String(os.cpus().length),
  10,
);

if (cluster.isPrimary && WEB_CONCURRENCY > 1) {
  // ── Primary process ──────────────────────────────────────────────────────
  // Runs DB migrations once so every worker starts with a ready schema,
  // then forks N HTTP workers and supervises them.
  (async () => {
    try {
      const connected = await checkConnection();
      if (connected) {
        console.log('[primary] Conexión a PostgreSQL establecida.');
        await runMigrations();
        console.log('[primary] Migraciones ejecutadas correctamente.');
        await ensurePushReady();
        await ensureSuperAdmin();
      } else {
        console.error('[primary] No se pudo conectar a la base de datos.');
      }
    } catch (err) {
      console.error('[primary] Error durante la inicialización:', err);
    }

    console.log(`[primary] Iniciando ${WEB_CONCURRENCY} workers.`);
    for (let i = 0; i < WEB_CONCURRENCY; i++) cluster.fork();

    // Restart a worker automatically if it dies unexpectedly.
    cluster.on('exit', (worker, code, signal) => {
      console.log(
        `[cluster] Worker ${worker.process.pid} terminó (code=${code} signal=${signal}). Reiniciando…`,
      );
      cluster.fork();
    });

    // Presence reporter runs on primary — one reporter, not one per worker.
    startPresenceReporter();
    // Auto-live scheduler: transitions matches to 'live' at their scheduled time.
    startAutoLive();
  })();
} else {
  // ── Worker / single-process mode ─────────────────────────────────────────
  // In Vercel / Lambda-like environments we'd skip listen() and export app;
  // Railway runs this as a long-lived process so we always boot.
  startServer();
}

export default app;
