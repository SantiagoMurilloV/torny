import ExcelJS from 'exceljs';
import { getPool } from '../config/database';

/**
 * Build a XLSX workbook with TWO sheets — "Clubs" and "Equipos" —
 * carrying the credentials the admin needs to hand off. Both sheets
 * scoped to the admin's owner_id so cross-tenant data never leaks.
 *
 *   · Clubs sheet:    name | username | password | nº equipos
 *   · Equipos sheet:  team name | category | club | captain user |
 *                      captain password
 *
 * Plaintext passwords come from the *_password_recovery columns —
 * the same fields the show-once modals already display. If a club
 * or captain has a NULL recovery (legacy row generated before mig
 * 028 / before the recovery field was tracked), the cell shows
 * "(no disponible — regenerar para ver)" so the admin knows what to
 * do.
 */
export async function buildClubsExcel(ownerId: string): Promise<Buffer> {
  const pool = getPool();

  const clubsRes = await pool.query(
    `SELECT c.id, c.name, c.username, c.password_recovery,
            (SELECT COUNT(*)::int FROM teams t WHERE t.club_id = c.id) AS teams_count
       FROM clubs c
      WHERE c.owner_id = $1
      ORDER BY c.name`,
    [ownerId],
  );
  const teamsRes = await pool.query(
    `SELECT t.id, t.name, t.category, t.captain_username,
            t.captain_password_recovery,
            c.name AS club_name
       FROM teams t
       LEFT JOIN clubs c ON c.id = t.club_id
      WHERE t.owner_id = $1
      ORDER BY c.name NULLS LAST, t.name`,
    [ownerId],
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Torny';
  wb.created = new Date();

  // ── Clubs sheet ──────────────────────────────────────────────
  const clubsSheet = wb.addWorksheet('Clubs');
  clubsSheet.columns = [
    { header: 'Club', key: 'name', width: 32 },
    { header: 'Usuario', key: 'username', width: 24 },
    { header: 'Contraseña', key: 'password', width: 28 },
    { header: 'Nº equipos', key: 'count', width: 12 },
  ];
  clubsSheet.getRow(1).font = { bold: true };
  for (const r of clubsRes.rows) {
    clubsSheet.addRow({
      name: r.name as string,
      username: r.username as string,
      password:
        (r.password_recovery as string | null) ??
        '(no disponible — regenerar para ver)',
      count: (r.teams_count as number | null) ?? 0,
    });
  }

  // ── Equipos sheet ────────────────────────────────────────────
  const teamsSheet = wb.addWorksheet('Equipos');
  teamsSheet.columns = [
    { header: 'Equipo', key: 'name', width: 32 },
    { header: 'Categoría', key: 'category', width: 22 },
    { header: 'Club', key: 'club', width: 22 },
    { header: 'Usuario capitán', key: 'captainUser', width: 24 },
    { header: 'Contraseña capitán', key: 'captainPass', width: 28 },
  ];
  teamsSheet.getRow(1).font = { bold: true };
  for (const r of teamsRes.rows) {
    teamsSheet.addRow({
      name: r.name as string,
      category: (r.category as string | null) ?? '—',
      club: (r.club_name as string | null) ?? '(sin club)',
      captainUser: (r.captain_username as string | null) ?? '(sin generar)',
      captainPass:
        (r.captain_password_recovery as string | null) ??
        ((r.captain_username as string | null)
          ? '(no disponible — regenerar para ver)'
          : '(sin generar)'),
    });
  }

  // Buffer write — exceljs returns ArrayBuffer-ish; force Buffer for
  // express's res.send.
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
