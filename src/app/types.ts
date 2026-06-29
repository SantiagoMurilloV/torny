export interface Team {
  id: string;
  name: string;
  logo?: string;
  initials: string;
  colors: {
    primary: string;
    secondary: string;
  };
  city?: string;
  department?: string;
  category?: string;
  /**
   * Club this team belongs to (mig 028). When undefined, the team
   * isn't linked to any club yet — the team form surfaces a picker so
   * the admin can assign one.
   */
  clubId?: string;
  /** Captain login handle once credentials have been generated. */
  captainUsername?: string;
  /** ISO timestamp of the last credentials (re)generation. */
  credentialsGeneratedAt?: string;
}

/**
 * Returned only from POST /teams/:id/credentials. Plaintext password is
 * shown ONCE in the show-once modal and discarded — we never persist it
 * client-side.
 */
export interface TeamCredentialsReceipt {
  teamId: string;
  username: string;
  /**
   * Plaintext password. Always present on POST (fresh generation). On GET
   * only when the backend has PLATFORM_RECOVERY_KEY set AND decrypted the
   * stored AES blob cleanly. Null → regenerar para ver la contraseña.
   */
  password: string | null;
  generatedAt: string;
  /**
   * Whether the server currently has the recovery key and the blob is
   * decryptable. Lets the UI show "feature desactivada" vs "aún no
   * generadas" with the right copy.
   */
  recoveryEnabled: boolean;
}

/**
 * Roster jugadora. Stored per team. Photo and the identity document are
 * persisted as base64 data URLs (same strategy as team / tournament logos).
 */
export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  /** ISO 'YYYY-MM-DD'. Replaces the legacy birthYear field (mig 029). */
  birthDate?: string;
  /** Documento: 'TI' | 'CC' | 'CE' | 'RC' | 'PA'. */
  documentType?: string;
  documentNumber?: string;
  category?: string;
  position?: string;
  /** Foto cuadrada (data URL). */
  photo?: string;
  /** Documento escaneado en PDF (data URL). */
  documentFile?: string;
  shirtNumber?: number;
  /**
   * Single contacto de emergencia captured by the public inscripción
   * flow (mig 029). The admin / captain panel also gained these
   * fields so existing rosters can be back-filled by hand.
   */
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  /** True for jugadoras who came in via /torneo/:slug/inscripcion. */
  registeredViaPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SetScore {
  team1: number;
  team2: number;
}

export type MatchStatus = 'upcoming' | 'live' | 'completed';

export interface Match {
  id: string;
  tournamentId: string;
  team1: Team;
  team2: Team;
  date: Date;
  time: string;
  court: string;
  referee?: string;
  status: MatchStatus;
  score?: {
    team1: number;
    team2: number;
  };
  sets?: SetScore[];
  phase: string;
  group?: string;
  duration?: number; // en minutos
}

export interface StandingsRow {
  position: number;
  team: Team;
  played: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  points: number;
  isQualified?: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  /**
   * Public URL slug (mig 029). Auto-generated from `name` on insert,
   * unique across the system. Drives the parent-registration link
   * `/torneo/:slug/inscripcion`. Optional in the type because legacy
   * SELECTs may not include the column — every row in the DB has a
   * value after the migration.
   */
  slug?: string;
  logo?: string;
  startDate: Date;
  endDate: Date;
  sport: string;
  club: string;
  description: string;
  coverImage?: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  teamsCount: number;
  format: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  courts: string[];
  /**
   * Locality del torneo (mig 031). Aparece en el Hero público como el
   * "lugar" del evento (ej. "Armenia, Quindío"). Cuando está vacío el
   * Hero cae al primer court como fallback para no romper la línea
   * con el icono de pin.
   */
  city?: string;
  /** Mapa opcional { nombreCancha: ubicación } (dirección o referencia). */
  courtLocations?: Record<string, string>;
  /**
   * Divisions accepted by the tournament. Values come from CATEGORIES. When
   * non-empty the enrolment UI filters the team dropdown to teams whose
   * `category` matches one of these values. Empty / undefined → no filter.
   */
  categories?: string[];
  /** UUID of the admin (tenant) that owns this tournament. Null for legacy
   *  or platform-owned tournaments. */
  ownerId?: string;
  /** ISO yyyy-mm-dd date; captain credentials stop working after this day. */
  enrollmentDeadline?: string;
  /** ISO timestamp when the public registration link opens (mig 035). */
  registrationOpensAt?: string | null;
  /** ISO timestamp when the public registration link closes (mig 035). */
  registrationClosesAt?: string | null;
  /** Recommended roster cap per team. Default 12. */
  playersPerTeam?: number;
  /**
   * Post-groups bracket strategy:
   *   · 'manual'     → admin picks matchups from the drag-pairs modal
   *                    (single bracket, no Oro/Plata tier).
   *   · 'divisions'  → crossings auto-generated VNL-style from the
   *                    standings; produces Oro + Plata brackets.
   * Defaults to 'manual' on the server for back-compat.
   */
  bracketMode?: 'manual' | 'divisions';
  /**
   * Divisions-only: classifiers per group that advance to each tier.
   * Top `goldClassifiersPerGroup` of every group enter Oro; the next
   * `silverClassifiersPerGroup` enter Plata. Defaults to 2 + 2 on the
   * server. Set silver to 0 to disable Plata entirely.
   */
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  /**
   * Reglamento del torneo (mostrado en la pestaña pública "Info" en
   * lugar de la copia automática del formato técnico). Ambos campos son
   * opcionales y combinables — el admin puede cargar texto, un PDF, los
   * dos o ninguno.
   *   · regulationText → texto plano, render con `whitespace-pre-wrap`.
   *   · regulationPdf  → data URL (`data:application/pdf;base64,...`)
   *                       producida por POST /api/upload/document.
   */
  regulationText?: string;
  regulationPdf?: string;
  /**
   * Schedule defaults persisted on the tournament (migration 024) so the
   * admin sets them once in Ajustes Generales instead of re-typing them
   * every fixture generation. Both the original scheduler and the
   * `repairTournamentConflicts` tool read these.
   *   · matchDurationMinutes — global per-match length (default 60).
   *   · matchBreakMinutes    — global between-matches gap (default 15).
   *   · dailySchedules       — per-date `{start, end}` overrides keyed
   *                             by 'YYYY-MM-DD'. Days not in the map
   *                             use the global 08:00–18:00 default.
   *                             Lets the admin model "Sat 08:00–22:00,
   *                             Sun 08:00–14:00" without splitting the
   *                             tournament.
   */
  matchDurationMinutes?: number;
  matchBreakMinutes?: number;
  dailySchedules?: Record<string, { start: string; end: string }>;
  /** Maximum matches per day across all courts (0 = unlimited). */
  maxMatchesPerDay?: number;
  /** Dead-time blocks where no matches are scheduled (e.g. lunch break).
   *  Array of { start: "HH:MM", end: "HH:MM" } in local time. */
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  /** Category play order — first in array plays earliest each day. */
  categoryPriority?: string[];
  /**
   * Preferred court for semifinal + final bracket matches (migration
   * 026). When set, the bracket materializer pins those rounds onto
   * this court instead of the normal rotation. Empty / undefined =
   * no preference.
   */
  finalsCourt?: string;
  /**
   * Per-category match duration overrides (migration 027). Keyed by
   * category name with the value in MINUTES. Categories not present
   * fall back to `matchDurationMinutes`, which falls back to 60. Mixed
   * tournaments (Sub-13 short matches + Senior long matches) use this
   * to avoid a single global value either wasting court time on short
   * matches or bleeding long ones into the next slot.
   */
  matchDurationsByCategory?: Record<string, number>;
  /**
   * Real counts populated by the backend SELECT (LIST_SELECT) — used by
   * the home cards and the public detail hero so the numbers reflect
   * actual enrollment / scheduled matches instead of the cap configured
   * at create time. Optional because writes / internal mappers still
   * round-trip Tournament objects without these fields.
   */
  enrolledCount?: number;
  matchesCount?: number;
  /** Total jugadoras inscritas en los teams enrolled (DISTINCT por
   *  jugadora). Reemplaza "En vivo" en el Hero público desde
   *  2026-05-13 — métrica más útil para visitantes que el contador
   *  transiente de partidos en curso. */
  playersCount?: number;
  /**
   * ISO timestamp set cuando el admin presionó "Enviar programación
   * a clubes" (mig 032). NULL → no enviada todavía. El club panel
   * usa esto para gatillar la vista de cronograma + recibe el push
   * que dispara este mismo endpoint.
   */
  scheduleSentToClubsAt?: string | null;
  /**
   * Segundos para una vuelta completa del carrusel de
   * patrocinadores (mig 034). 10-300. NULL → el carrusel usa el
   * fallback algorítmico (longitud del strip × 2.5s).
   */
  sponsorsSpeedSeconds?: number | null;
  /**
   * Bracket phase buckets whose upcoming matches are no longer blurred
   * in the public schedule (mig 037). Values are PhaseBucket keys:
   * 'cuartos', 'semifinal', 'final', 'tercer-puesto'. Empty array
   * (default) means everything stays blurred as before.
   */
  revealedPhases?: string[];
  /**
   * Secondary group phase configuration (mig 038). When enabled, a
   * second round-robin phase ("triangulares") runs between the primary
   * groups and the bracket. null means disabled.
   */
  secondaryPhase?: {
    enabled: boolean;
    groupsPerDivision: number;
    teamsPerGroup: number;
    classifiersPerGroup: number;
    /**
     * Seeding for the second group stage. 'balanced' (default) builds
     * pools mixing one team per finishing position from different
     * primary groups; 'divisions' keeps the legacy Copa Oro / Plata.
     */
    seedingMode?: 'balanced' | 'divisions';
  } | null;
}

export interface BracketMatch {
  id: string;
  team1?: Team;
  team2?: Team;
  winner?: Team;
  score?: {
    team1: number;
    team2: number;
  };
  status: MatchStatus;
  round: string;
  team1Placeholder?: string;
  team2Placeholder?: string;
}

export interface FixtureResult {
  matches: Match[];
  bracketMatches: BracketMatch[];
  generatedAt: string;
}

/**
 * Tournament sponsor (mig 033). The admin curates these from the
 * "Patrocinadores" tab; logos render in the public Hero / Info
 * strip. Logo is a base64 data URL or http(s) URL.
 */
export interface TournamentSponsor {
  id: string;
  tournamentId: string;
  name: string | null;
  logo: string;
  link: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}
