import { Pool, PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';

let pool: Pool | null = null;

/**
 * Build the pg Pool config.
 *
 * Two modes, in order of precedence:
 *
 *  1. `DATABASE_URL` — connection string (used by Railway, Render, Heroku,
 *     Neon, Supabase). If the hostname is not localhost we also enable TLS
 *     with `rejectUnauthorized: false` so self-signed certs from managed
 *     providers don't break the connection.
 *  2. Individual `DB_*` vars — classic host / port / user / password /
 *     database, matching the local dev setup.
 */
function buildPoolConfig(): PoolConfig {
  // Default 50: a 400-spectator burst (5 parallel fetches each = 2000
  // concurrent queries) overwhelms a pool of 20, causing the 5s
  // connectionTimeoutMillis to fire and pile up 5xx errors. 50 is the
  // sweet spot for Railway's managed Postgres (default max_connections
  // is 100; we leave half for migrations, the keep-alive ping, and
  // headroom). Override with DB_POOL_SIZE env var if your Postgres
  // tier is bigger or smaller.
  const max = parseInt(process.env.DB_POOL_SIZE || '50', 10);

  // Shared pool tuning. The defaults of `pg` close idle connections after
  // ~10 s, which on Railway means every burst of traffic after a quiet
  // period pays a 150–400 ms TCP+TLS handshake against the managed
  // Postgres host. We override that:
  //   - idleTimeoutMillis: 0       → never close idle connections
  //   - keepAlive: true            → enable TCP keepalive on the socket
  //   - keepAliveInitialDelayMillis: 10s before the first keepalive probe
  //   - connectionTimeoutMillis: 5s → fail fast if the cluster is wedged
  //     instead of hanging the request indefinitely.
  const sharedTuning = {
    idleTimeoutMillis: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };

  if (process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL;
    // Naive hostname sniff — good enough to decide if SSL is needed.
    const isRemote = !/localhost|127\.0\.0\.1/.test(connectionString);
    return {
      connectionString,
      max,
      ssl: isRemote ? { rejectUnauthorized: false } : undefined,
      ...sharedTuning,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'spkcup',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max,
    ...sharedTuning,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
  }
  return pool;
}

export async function checkConnection(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Error al conectar con la base de datos:', error);
    return false;
  }
}

/**
 * Locate the directory with migration .sql files.
 *
 * When compiled with `tsc`, __dirname is `dist/config`, so the expected path
 * is `dist/db/migrations`. The build script (`npm run copy-sql`) copies the
 * SQL files into `dist/db/` so this works.
 *
 * But if the copy step didn't run (old build, running via ts-node, etc.) we
 * fall back to looking in the source tree at `src/db/migrations`. This keeps
 * dev mode working and makes the server resilient to misconfigured builds.
 */
function resolveDbAssetDir(relative: string): string | null {
  const candidates = [
    path.join(__dirname, '..', 'db', relative),          // dist/db/...  or  src/db/... (ts-node)
    path.join(__dirname, '..', '..', 'src', 'db', relative), // dist → src fallback
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function runMigrations(): Promise<void> {
  const db = getPool();

  // Create migrations tracking table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const migrationsDir = resolveDbAssetDir('migrations');
  if (!migrationsDir) {
    console.log('No se encontró directorio de migraciones. Saltando.');
    return;
  }
  console.log(`Leyendo migraciones de: ${migrationsDir}`);

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Check if migration has already been executed
    const result = await db.query(
      'SELECT id FROM _migrations WHERE name = $1',
      [file]
    );

    if (result.rows.length > 0) {
      console.log(`Migración ${file} ya ejecutada, omitiendo.`);
      continue;
    }

    // Read and execute migration
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`Ejecutando migración: ${file}...`);
    await db.query(sql);

    // Record migration
    await db.query(
      'INSERT INTO _migrations (name) VALUES ($1)',
      [file]
    );

    console.log(`Migración ${file} ejecutada exitosamente.`);
  }

  // Run seed if it exists and hasn't been run
  const seedPath = resolveDbAssetDir('seed.sql');
  if (seedPath) {
    const seedResult = await db.query(
      "SELECT id FROM _migrations WHERE name = 'seed.sql'"
    );

    if (seedResult.rows.length === 0) {
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      console.log('Ejecutando seed de datos iniciales...');
      await db.query(seedSql);
      await db.query(
        "INSERT INTO _migrations (name) VALUES ('seed.sql')"
      );
      console.log('Seed ejecutado exitosamente.');
    }
  }
}
