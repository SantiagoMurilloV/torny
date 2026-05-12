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

/**
 * Normalize the WHOLE team name into an array of comparable words.
 * "San José Armenia A" → ["san", "jose", "armenia", "a"]. Used by
 * the recursive cluster algorithm to compare nth words across teams.
 */
function normalizeWords(name: string): string[] {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    );
}

/**
 * Longest word-level common prefix across a list of word lists.
 *   [["spike","rubi"], ["spike","esmeralda"]] → ["spike"]
 *   [["san","jose","armenia"], ["san","jose","circasia"]] → ["san","jose"]
 *   [[]]                                                  → []
 *
 * Used to propose a friendly cluster name (joins with spaces) instead
 * of just the first word.
 */
function longestCommonWordPrefix(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  const first = lists[0];
  let i = 0;
  while (i < first.length) {
    const word = first[i];
    if (lists.some((l) => normalizeWord(l[i]) !== normalizeWord(word))) break;
    i++;
  }
  return first.slice(0, i);
}

function normalizeWord(w: string | undefined): string {
  if (!w) return '';
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
   * Inspect the admin's teams and propose clusters using a recursive
   * word-prefix grouping. Why recursive instead of "first word only":
   *
   *   · "San José Armenia A", "San José Armenia B", "San José Circasia"
   *     all share "san" as the first word. With single-word grouping
   *     they'd land in ONE bucket, mixing two real clubs.
   *   · The recursive version groups by the FIRST word, then for each
   *     bucket looks at the SECOND word — if that splits into two
   *     sub-buckets where each has ≥2 teams, we keep the split (so
   *     "San José Armenia" and "San José Circasia" become two
   *     distinct clusters). If the deeper split fails (e.g. "Spike
   *     Rubi" + "Spike Esmeralda" split by 2nd word gives 1+1 →
   *     nothing useful), we keep the parent cluster.
   *
   * Skips teams already assigned to a club so re-running is idempotent.
   *
   * @returns clusters with at least 2 teams, sorted by size desc.
   */
  async detectClusters(ownerId: string): Promise<DetectedCluster[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, name FROM teams
        WHERE owner_id = $1 AND club_id IS NULL
        ORDER BY name`,
      [ownerId],
    );
    const all = res.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      // Pre-tokenize once so the recursive grouping doesn't re-split
      // per depth (cheap perf bonus on big libraries).
      words: (r.name as string).trim().split(/\s+/).filter(Boolean),
      normalizedWords: normalizeWords(r.name as string),
    }));

    type Team = (typeof all)[number];

    /**
     * Recursive grouping. At each depth, partition `teams` by their
     * `normalizedWords[depth]`. For buckets with 2+ teams, attempt to
     * sub-cluster at depth+1 — KEEP the sub-clustering only if it
     * produces ≥2 sub-buckets each with ≥2 teams. Otherwise return
     * the bucket as-is (the parent name is the natural club name).
     */
    function group(teams: Team[], depth: number): DetectedCluster[] {
      const buckets = new Map<string, Team[]>();
      for (const t of teams) {
        const word = t.normalizedWords[depth];
        if (!word) continue;
        const arr = buckets.get(word) ?? [];
        arr.push(t);
        buckets.set(word, arr);
      }
      const result: DetectedCluster[] = [];
      for (const [, teamsInBucket] of buckets) {
        if (teamsInBucket.length < 2) continue;
        // Try a deeper split. We only ACCEPT it when the next layer
        // produces ≥2 viable sub-clusters — otherwise we'd over-split
        // a club like "Spike" into 1-team buckets per second word.
        if (depth + 1 < 5) {
          const sub = group(teamsInBucket, depth + 1);
          const accountedFor = sub.reduce((n, c) => n + c.teamIds.length, 0);
          if (sub.length >= 2 && accountedFor >= teamsInBucket.length - 0) {
            result.push(...sub);
            continue;
          }
        }
        // Use the longest common word-prefix as the proposed name so
        // "San José Armenia" appears nicely in the modal instead of
        // just "San". Compute LCP across all teams in this bucket.
        const lcp = longestCommonWordPrefix(teamsInBucket.map((t) => t.words));
        const proposedName =
          lcp.length > 0 ? lcp.join(' ') : teamsInBucket[0].words[0] ?? '';
        const key = teamsInBucket
          .map((t) => t.normalizedWords.slice(0, lcp.length || 1).join('-'))
          .reduce((acc, k) => acc || k, '');
        result.push({
          key,
          proposedName,
          teamIds: teamsInBucket.map((t) => t.id),
          sampleTeamNames: teamsInBucket.slice(0, 5).map((t) => t.name),
        });
      }
      return result;
    }

    const out = group(all, 0);
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
   * Owner-scoped list of teams currently linked to a club. Used by
   * the admin's "Dividir club" modal so the user can pick which
   * teams should move out to a new club. Returns minimal fields
   * (id + name + initials + category + logo + colors) to keep the
   * payload small — no roster, no tournaments.
   */
  async getTeamsForClub(
    clubId: string,
    ownerId: string,
  ): Promise<Array<{
    id: string;
    name: string;
    initials: string;
    category: string | null;
    logo: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
  }>> {
    await this.getById(clubId, ownerId); // 404 on cross-tenant
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, name, initials, category, logo,
              primary_color, secondary_color
         FROM teams
        WHERE club_id = $1 AND owner_id = $2
        ORDER BY name`,
      [clubId, ownerId],
    );
    return res.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      initials: r.initials as string,
      category: (r.category as string | null) ?? null,
      logo: (r.logo as string | null) ?? null,
      primaryColor: (r.primary_color as string | null) ?? null,
      secondaryColor: (r.secondary_color as string | null) ?? null,
    }));
  }

  /**
   * Move a subset of one club's teams into a NEW club. Used to fix
   * the "auto-detect grouped two real clubs together" scenario:
   * admin clicks "Dividir club", picks the teams that belong to a
   * different club, types a name → this method creates the new club
   * row with auto-generated credentials and re-points the picked
   * teams' `club_id`.
   *
   * The original club survives with the unchecked teams intact (its
   * username/password don't rotate). Atomic — partial failures roll
   * back so we never leave teams pointing at a non-existent club.
   */
  async splitClub(
    sourceClubId: string,
    ownerId: string,
    newClubName: string,
    teamIdsToMove: string[],
  ): Promise<Club> {
    const trimmedName = (newClubName ?? '').trim();
    if (!trimmedName) {
      throw new ValidationError('El nombre del nuevo club es obligatorio');
    }
    if (!Array.isArray(teamIdsToMove) || teamIdsToMove.length === 0) {
      throw new ValidationError('Seleccioná al menos un equipo para mover');
    }
    await this.getById(sourceClubId, ownerId); // 404 on cross-tenant

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Tamper-check: every teamId must currently belong to the
      // source club AND be owned by the same admin. Otherwise an
      // attacker could smuggle teamIds from another tenant or from
      // an unrelated club into the move.
      const verifyRes = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM teams
          WHERE id = ANY($1) AND club_id = $2 AND owner_id = $3`,
        [teamIdsToMove, sourceClubId, ownerId],
      );
      const matched = verifyRes.rows[0]?.n ?? 0;
      if (matched !== teamIdsToMove.length) {
        throw new ValidationError(
          'Algún equipo seleccionado no pertenece a este club o no es tuyo',
        );
      }

      // Insert new club with retry on UNIQUE LOWER(username) collision.
      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);
      let row: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const username = generateClubUsername(trimmedName);
        try {
          const res = await client.query(
            `INSERT INTO clubs (owner_id, name, username, password_hash, password_recovery)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [ownerId, trimmedName, username, passwordHash, password],
          );
          row = res.rows[0];
          break;
        } catch (err) {
          if ((err as { code?: string }).code === '23505' && attempt < 4) continue;
          throw err;
        }
      }
      if (!row) {
        throw new ValidationError('No se pudo generar usuario único');
      }
      const newClubId = row.id as string;

      // Move the selected teams to the new club.
      await client.query(
        `UPDATE teams SET club_id = $1, updated_at = NOW()
          WHERE id = ANY($2) AND club_id = $3 AND owner_id = $4`,
        [newClubId, teamIdsToMove, sourceClubId, ownerId],
      );

      await client.query('COMMIT');
      return mapRow(row, teamIdsToMove.length);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
