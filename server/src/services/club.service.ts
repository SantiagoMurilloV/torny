import bcrypt from 'bcrypt';
import { getPool } from '../config/database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import {
  generateClubUsername,
  generatePassword,
} from '../lib/passwordGen';

/**
 * Club-level credentials (migration 028). One row per (admin, club)
 * with a username/password that grants access to every team whose
 * `club_id` points here. Admin-owned: an admin only ever sees their
 * own clubs; super_admin sees all (not yet implemented but the
 * `ownerId` filter is everywhere so adding it is a one-liner).
 *
 * Coexists with the per-team captain credentials — a team can have
 * BOTH a club account (via club_id) and an individual captain login
 * (via teams.captain_username). The two channels are independent.
 */

export interface Club {
  id: string;
  ownerId: string;
  name: string;
  username: string;
  /**
   * Plaintext password. Returned ONLY by owner-scoped reads (the
   * admin needs it for the Excel export + to hand off to the club).
   * Never leaked through public endpoints. NULL when the legacy
   * recovery field hasn't been populated (e.g. manual SQL insert).
   */
  passwordRecovery: string | null;
  credentialsGeneratedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Decorated count of teams pointing at this club. */
  teamsCount?: number;
}

export interface DetectedCluster {
  /** Normalized first-word key. Internal — not shown to the admin. */
  key: string;
  /**
   * Editable display name proposed to the admin (the actual first
   * word, untouched). `bulkCreate` accepts a name override per
   * cluster so the admin can rename "spike" → "Spike Cup VC".
   */
  proposedName: string;
  teamIds: string[];
  /** Sample team names for the UI preview ("Spike Rubi, Spike Esmeralda…"). */
  sampleTeamNames: string[];
}

export interface BulkCreateInput {
  /** ASCII normalized first-word key (matches detectClusters output). */
  key: string;
  /** Final club display name (admin may have edited the proposed value). */
  name: string;
}

/**
 * Lowercase + strip diacritics + collapse whitespace. Used to derive
 * the cluster key from a team name so "Águilas A" and "aguilas b"
 * land in the same bucket. Mirrors the categoryOfMatch helper's
 * normalisation pattern so the UI's auto-detection is predictable.
 */
function normalizeFirstWord(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  return firstWord
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function mapRow(row: Record<string, unknown>, teamsCount?: number): Club {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    username: row.username as string,
    passwordRecovery: (row.password_recovery as string | null) ?? null,
    credentialsGeneratedAt: row.credentials_generated_at as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    teamsCount,
  };
}

export class ClubService {
  /**
   * Inspect the admin's teams and propose clusters keyed by the
   * normalized first word of each team's name. Skips teams already
   * assigned to a club (those have `club_id != NULL`) so re-running
   * the detector is idempotent — admin clicks the button as many
   * times as they want, only NEW unclustered teams show up.
   */
  async detectClusters(ownerId: string): Promise<DetectedCluster[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, name FROM teams
        WHERE owner_id = $1 AND club_id IS NULL
        ORDER BY name`,
      [ownerId],
    );
    const buckets = new Map<string, { proposed: string; ids: string[]; samples: string[] }>();
    for (const row of res.rows) {
      const name = row.name as string;
      const key = normalizeFirstWord(name);
      if (!key) continue;
      const proposed = name.trim().split(/\s+/)[0];
      const bucket = buckets.get(key) ?? { proposed, ids: [], samples: [] };
      bucket.ids.push(row.id as string);
      if (bucket.samples.length < 5) bucket.samples.push(name);
      buckets.set(key, bucket);
    }
    // Only surface clusters with 2+ teams — single-team "clubs"
    // would be redundant with the captain credentials they already
    // have. Admin can manually create a 1-team club later if needed.
    const out: DetectedCluster[] = [];
    for (const [key, b] of buckets) {
      if (b.ids.length < 2) continue;
      out.push({
        key,
        proposedName: b.proposed,
        teamIds: b.ids,
        sampleTeamNames: b.samples,
      });
    }
    out.sort((a, b) => b.teamIds.length - a.teamIds.length);
    return out;
  }

  /**
   * For each cluster: insert a clubs row, generate credentials,
   * UPDATE every team in the cluster to point its `club_id` at the
   * new row. All clusters are processed in a single transaction so
   * a partial failure rolls back cleanly.
   *
   * Re-runs the username retry loop on the rare UNIQUE collision
   * (the index is on LOWER(username); ~9000 suffixes per slug means
   * collisions are vanishingly rare but not impossible).
   */
  async bulkCreate(
    ownerId: string,
    clusters: BulkCreateInput[],
    teamsByKey: Map<string, string[]>,
  ): Promise<Club[]> {
    if (clusters.length === 0) return [];
    const pool = getPool();
    const client = await pool.connect();
    const created: Club[] = [];
    try {
      await client.query('BEGIN');
      for (const c of clusters) {
        const teamIds = teamsByKey.get(c.key) ?? [];
        if (teamIds.length === 0) continue;

        // Retry loop on UNIQUE LOWER(username) collision.
        const password = generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);
        let row: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const username = generateClubUsername(c.name);
          try {
            const res = await client.query(
              `INSERT INTO clubs (owner_id, name, username, password_hash, password_recovery)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`,
              [ownerId, c.name.trim() || c.key, username, passwordHash, password],
            );
            row = res.rows[0];
            break;
          } catch (err) {
            // 23505 = unique_violation. Retry with a different suffix.
            if ((err as { code?: string }).code === '23505' && attempt < 4) continue;
            throw err;
          }
        }
        if (!row) {
          throw new ValidationError(
            `No se pudo generar usuario único para ${c.name} después de varios intentos`,
          );
        }

        const clubId = row.id as string;
        // Link teams. Scoped by owner_id so an admin can never
        // hijack another admin's teams via spoofed teamIds (defence
        // in depth — the controller already validates ownership).
        await client.query(
          `UPDATE teams SET club_id = $1, updated_at = NOW()
            WHERE id = ANY($2) AND owner_id = $3 AND club_id IS NULL`,
          [clubId, teamIds, ownerId],
        );

        created.push(mapRow(row, teamIds.length));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return created;
  }

  /** Owner-scoped list with team counts (decorated for the admin grid). */
  async listForOwner(ownerId: string): Promise<Club[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM teams t WHERE t.club_id = c.id) AS teams_count
         FROM clubs c
        WHERE c.owner_id = $1
        ORDER BY c.name`,
      [ownerId],
    );
    return res.rows.map((r) =>
      mapRow(r, (r.teams_count as number | null) ?? undefined),
    );
  }

  async getById(id: string, ownerId: string | null): Promise<Club> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM teams t WHERE t.club_id = c.id) AS teams_count
         FROM clubs c WHERE c.id = $1`,
      [id],
    );
    if (res.rows.length === 0) throw new NotFoundError('Club');
    const row = res.rows[0];
    // Owner check — 404 (not 403) on cross-tenant access so we
    // don't leak existence. Same convention as access.ts.
    if (ownerId !== null && (row.owner_id as string) !== ownerId) {
      throw new NotFoundError('Club');
    }
    return mapRow(row, (row.teams_count as number | null) ?? undefined);
  }

  /**
   * Find the teams that belong to a club. Used by the club-panel
   * page after login to render the team picker, and by the auth
   * scope checks (a club_captain can only manage teams in this
   * list).
   */
  async getTeamIdsForClub(clubId: string): Promise<string[]> {
    const pool = getPool();
    const res = await pool.query(
      'SELECT id FROM teams WHERE club_id = $1 ORDER BY name',
      [clubId],
    );
    return res.rows.map((r) => r.id as string);
  }

  /**
   * Username + password lookup used by /auth/login when the user
   * isn't found in the `users` table. Case-insensitive on the
   * username (the UNIQUE index is on LOWER(username)).
   */
  async findByUsername(usernameRaw: string): Promise<{
    id: string;
    ownerId: string;
    name: string;
    passwordHash: string;
  } | null> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, owner_id, name, password_hash
         FROM clubs WHERE LOWER(username) = LOWER($1)`,
      [usernameRaw],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id as string,
      ownerId: r.owner_id as string,
      name: r.name as string,
      passwordHash: r.password_hash as string,
    };
  }

  async regenerateCredentials(id: string, ownerId: string): Promise<Club> {
    const pool = getPool();
    const club = await this.getById(id, ownerId);
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    // Username is preserved — only the password rotates. Easier for
    // clubs that already memorised their user; if collisions ever
    // become a concern the admin can delete + re-create the club.
    const res = await pool.query(
      `UPDATE clubs SET password_hash = $1, password_recovery = $2,
                       credentials_generated_at = NOW(), updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [passwordHash, password, id],
    );
    return mapRow(res.rows[0], club.teamsCount);
  }

  /**
   * Rename a club. Only the display name + the team-club
   * association change; credentials stay put. Admin uses this
   * after the bulk creation when they want to spell out a club
   * fully (e.g. "spike" → "Spike Cup VC").
   */
  async rename(id: string, ownerId: string, name: string): Promise<Club> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new ValidationError('El nombre no puede estar vacío');
    await this.getById(id, ownerId); // 404 on cross-tenant
    const pool = getPool();
    const res = await pool.query(
      `UPDATE clubs SET name = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [trimmed, id],
    );
    const teamIds = await this.getTeamIdsForClub(id);
    return mapRow(res.rows[0], teamIds.length);
  }

  /**
   * Delete a club. teams.club_id FK is ON DELETE SET NULL so member
   * teams survive untouched (only their group association is reset).
   * Captain credentials on the teams remain intact.
   */
  async deleteClub(id: string, ownerId: string): Promise<void> {
    await this.getById(id, ownerId); // 404 on cross-tenant
    const pool = getPool();
    await pool.query('DELETE FROM clubs WHERE id = $1', [id]);
  }
}

export const clubService = new ClubService();
