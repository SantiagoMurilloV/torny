// === Domain Models ===

export interface Tournament {
  id: string;           // UUID
  name: string;         // 3-100 chars
  /**
   * URL-safe public slug (migration 029). Auto-generated from `name`
   * on insert and unique across the system. Drives the public parent-
   * registration link `/torneo/:slug/inscripcion`. Optional in the
   * type only because legacy SELECTs may not include the column —
   * every row in the DB has a value.
   */
  slug?: string;
  sport: string;
  club: string;
  startDate: string;    // ISO date
  endDate: string;      // ISO date
  description?: string;
  coverImage?: string;
  logo?: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  teamsCount: number;   // 2-32
  format: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  courts: string[];
  /**
   * Tournament locality (mig 031). Shown in the public Hero as the
   * "place" of the event — e.g. "Armenia, Quindío". When unset the
   * Hero falls back to `courts[0]`, preserving legacy behaviour for
   * older tournaments without the field populated.
   */
  city?: string;
  /** Mapa opcional { nombreCancha: ubicación } (dirección o descripción). */
  courtLocations?: Record<string, string>;
  /**
   * Divisions the tournament accepts. Values come from the app category list. Empty /
   * omitted means "no filter" — every team is enrollable.
   */
  categories?: string[];
  /**
   * UUID of the admin (tenant) that owns this tournament. NULL means
   * the row predates multitenancy or was created by a super_admin
   * without assigning an owner. Drives admin-dashboard scoping.
   */
  ownerId?: string;
  /**
   * Deadline for team captains to keep their roster editable (ISO
   * date). When set, passes it to the future team-panel login flow
   * — after this date the captain's credentials won't be usable.
   * NULL means no deadline (captains can always edit).
   */
  enrollmentDeadline?: string;
  /**
   * Recommended roster cap per team (defaults to 12). Only used by the
   * captain panel to show "N / max" — it's advisory, no enforcement
   * at create time so a team can exceed if the admin allows.
   */
  playersPerTeam?: number;
  /**
   * Which post-groups bracket strategy this tournament uses:
   *   · 'manual'     → admin picks matchups manually from the drag UI
   *   · 'divisions'  → auto VNL seeding, produces Oro + Plata from the
   *                    standings table.
   * Defaults to 'manual' so legacy tournaments keep their prior flow.
   */
  bracketMode?: 'manual' | 'divisions';
  /**
   * Divisions-only: how many teams per group advance to each tier.
   * Top `goldClassifiersPerGroup` of every group enter the Oro
   * bracket; the next `silverClassifiersPerGroup` enter Plata. Sum
   * times groupCount = total classifiers (the bracket size for each
   * tier is the next power of two of that). Defaults: 2 + 2.
   */
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  /**
   * Reglamento del torneo, mostrado en la pestaña pública "Info" (la
   * sección que antes era "FORMATO"). Ambos opcionales y combinables —
   * el admin puede mandar texto, un PDF, ambos o ninguno.
   *   · regulationText → texto plano largo (markdown-ish, render como pre-wrap).
   *   · regulationPdf  → data URL (`data:application/pdf;base64,...`)
   *                       producida por POST /api/upload/document. Mismo
   *                       patrón que coverImage / logo para sobrevivir
   *                       redeploys de Railway (filesystem efímero).
   */
  regulationText?: string;
  regulationPdf?: string;
  /**
   * Per-tournament schedule defaults — persisted by migration 024 so
   * the admin sets them once in Ajustes Generales instead of re-typing
   * for every fixture generation. They drive both the original
   * scheduler (calculateMatchTimes) and the schedule reparator
   * (matchService.repairTeamConflicts).
   *
   *   · matchDurationMinutes → global per-match length (5 ≤ x ≤ 600).
   *   · matchBreakMinutes    → global between-matches gap (0 ≤ x ≤ 240).
   *   · dailySchedules       → optional per-day override of the active
   *                             window. Keyed by YYYY-MM-DD; days not
   *                             present in the map fall back to the
   *                             historic 08:00–18:00 default. Lets the
   *                             admin model "Saturday runs late, Sunday
   *                             ends early" without forcing a global
   *                             setting.
   *
   * All optional in TS because internal helpers / partial selects may
   * skip them; the DB has NOT NULL defaults so reads are always safe.
   */
  matchDurationMinutes?: number;
  matchBreakMinutes?: number;
  dailySchedules?: Record<string, { start: string; end: string }>;
  /**
   * Schedule constraints added by migration 025 — the admin form was
   * already exposing these, this round wired them through to the DB
   * and the scheduler so they actually take effect:
   *   · maxMatchesPerDay  → 0 = no cap; >0 stops the scheduler from
   *                          packing more than N matches into a single
   *                          calendar day.
   *   · deadTimeBlocks    → array of { start, end } windows the
   *                          scheduler must skip every day (lunch,
   *                          ceremonies, etc.). Day-agnostic — per-day
   *                          calendar shape lives in `dailySchedules`.
   *   · categoryPriority  → ordered category names; the scheduler
   *                          places higher-priority categories on the
   *                          earlier slots of each day. Categories not
   *                          in the list keep their natural order
   *                          AFTER the prioritised ones.
   */
  maxMatchesPerDay?: number;
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  categoryPriority?: string[];
  /**
   * Preferred court for semifinals and finals (migration 026). The
   * bracket materializer tries to pin "semi" / "final" rounds onto
   * this court before falling back to the normal rotation. NULL /
   * undefined means "no preference" — the legacy rotation wins.
   */
  finalsCourt?: string;
  /**
   * Per-category match duration overrides (migration 027). Keyed by
   * category name with the value in MINUTES. Categories not present
   * fall back to `matchDurationMinutes`, which falls back to 60. The
   * scheduler reads this when computing each match's slot length so
   * mixed tournaments (Sub-13 short matches alongside Senior long
   * matches) don't have to force a single global value.
   */
  matchDurationsByCategory?: Record<string, number>;
  /**
   * Decorated by the SELECT in tournament.service (LIST_SELECT). The
   * home cards / public detail use these instead of the static
   * `teamsCount` cap so the numbers reflect reality.
   *   · enrolledCount → COUNT(tournament_teams WHERE tournament_id = id)
   *   · matchesCount  → COUNT(matches          WHERE tournament_id = id)
   *   · playersCount  → COUNT(DISTINCT players whose team is enrolled)
   * Optional because internal helpers / writes still mapRow off bare
   * tournaments rows that don't carry the counts.
   */
  enrolledCount?: number;
  matchesCount?: number;
  playersCount?: number;
  /**
   * ISO timestamp set when the admin pressed "Enviar programación a
   * clubes" (mig 032). NULL → no enviada todavía. The club panel
   * uses this flag to gate its own cronograma view + the per-club
   * push notifications fired by the same endpoint.
   */
  scheduleSentToClubsAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Team {
  id: string;           // UUID
  name: string;
  initials: string;     // 1-3 uppercase letters
  logo?: string;
  primaryColor: string;   // Hex #RRGGBB
  secondaryColor: string; // Hex #RRGGBB
  city?: string;
  department?: string;
  category?: string;
  /** Admin user that owns this team. NULL for legacy / platform-shared rows. */
  ownerId?: string;
  /**
   * Club the team belongs to (mig 028). NULL when the team isn't grouped
   * under any club yet — admins can then assign one from the team form.
   */
  clubId?: string;
  /** Captain handle (lowercase, unique). Populated after "Generar credenciales". */
  captainUsername?: string;
  /** ISO timestamp when credentials were generated/regenerated. */
  credentialsGeneratedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Payload returned from POST /teams/:teamId/credentials (fresh generation)
 * and from GET /teams/:teamId/credentials (subsequent admin lookups).
 *
 *   · password: string          → plaintext, on POST always; on GET only
 *                                 when PLATFORM_RECOVERY_KEY is set and
 *                                 the AES-GCM blob decrypts cleanly.
 *   · password: null            → recovery feature is off or the blob is
 *                                 missing/corrupt. Admin sees the username
 *                                 but has to regenerate to see a password.
 *   · recoveryEnabled: false    → tells the UI to label the missing
 *                                 password as "feature desactivada" vs
 *                                 "credenciales no generadas".
 */
export interface TeamCredentialsReceipt {
  teamId: string;
  username: string;
  password: string | null;
  generatedAt: string;
  recoveryEnabled: boolean;
}

export interface Match {
  id: string;           // UUID
  tournamentId: string; // FK
  // NULLABLE since mig 030: bracket slots that depend on an upstream
  // round materialize with team ids unresolved until `advanceWinner`
  // writes them back. The admin's cronograma renders these slots
  // blurred so the placeholder isn't misread as a real matchup.
  team1Id: string | null; // FK (NULL = upstream round pending)
  team2Id: string | null; // FK (NULL = upstream round pending)
  date: string;         // ISO date
  time: string;
  court: string;
  referee?: string;
  status: 'upcoming' | 'live' | 'completed';
  scoreTeam1?: number;
  scoreTeam2?: number;
  phase: string;
  groupName?: string;
  duration?: number;    // minutes
  sets?: SetScore[];
  /**
   * For materialized bracket-stage matches: pointer to the bracket_matches
   * row that produced this match. NULL on group / liga rows. The pairing
   * is one-to-one (unique partial index) and the score / status edited
   * here propagates back to the bracket via the post-update sync hook.
   */
  bracketMatchId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SetScore {
  id: string;
  matchId: string;
  setNumber: number;    // 1-5
  team1Points: number;  // >= 0
  team2Points: number;  // >= 0
}

export interface StandingsRow {
  id: string;
  tournamentId: string;
  teamId: string;
  groupName?: string;
  position: number;
  played: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  /** Cumulative rally points scored across every set of every group-
   *  phase match. Used by the FIVB rally-ratio tiebreaker (third tier
   *  after points + set diff). */
  pointsFor: number;
  pointsAgainst: number;
  points: number;
  isQualified: boolean;
  team?: Team;          // populated via join
}

export interface BracketMatch {
  id: string;
  tournamentId: string;
  team1Id?: string;
  team2Id?: string;
  winnerId?: string;
  scoreTeam1?: number;
  scoreTeam2?: number;
  status: 'upcoming' | 'live' | 'completed';
  round: string;
  position: number;
  team1?: Team;         // populated via join
  team2?: Team;         // populated via join
  team1Placeholder?: string;
  team2Placeholder?: string;
}

export interface SystemSettings {
  id: string;
  systemName: string;
  clubName?: string;
  location?: string;
  language: string;
  contactEmail?: string;
  website?: string;
  updatedAt?: string;
}

// === DTOs ===

export interface CreateTournamentDto {
  name: string;           // 3-100 chars
  sport: string;
  club: string;
  startDate: string;      // ISO date
  endDate: string;        // ISO date, >= startDate
  description?: string;
  coverImage?: string;
  logo?: string;
  status: 'upcoming' | 'ongoing' | 'completed';
  teamsCount: number;     // 2-32
  format: 'groups' | 'knockout' | 'groups+knockout' | 'league';
  courts: string[];
  /**
   * Locality of the tournament (mig 031). Free-text, max 160 chars.
   * Shown in the public Hero — e.g. "Armenia, Quindío". Optional;
   * passing null or an empty string leaves it unset and the Hero
   * falls back to `courts[0]`.
   */
  city?: string | null;
  /** Mapa opcional { nombreCancha: ubicación } (dirección o descripción). */
  courtLocations?: Record<string, string>;
  /**
   * Divisions the tournament accepts. Values come from the app category list. Empty /
   * omitted disables the enrolment category filter.
   */
  categories?: string[];
  /** ISO date; captain credentials stop working after this day. */
  enrollmentDeadline?: string | null;
  /** Recommended roster cap (default 12). */
  playersPerTeam?: number;
  /** 'manual' = drag-pairs flow · 'divisions' = auto VNL Oro/Plata. */
  bracketMode?: 'manual' | 'divisions';
  /** Divisions-only: classifiers per group going to Oro / Plata. */
  goldClassifiersPerGroup?: number;
  silverClassifiersPerGroup?: number;
  /** Reglamento en texto plano. Opcional. */
  regulationText?: string | null;
  /** Reglamento en PDF (data URL). Opcional. */
  regulationPdf?: string | null;
  /**
   * Schedule defaults persisted on the tournament so the admin sets
   * them once instead of re-typing per generation. See `Tournament`
   * above for the full doc — the DTO mirrors the same optionality.
   */
  matchDurationMinutes?: number;
  matchBreakMinutes?: number;
  dailySchedules?: Record<string, { start: string; end: string }>;
  /** See `Tournament.maxMatchesPerDay` — 0 = no cap. */
  maxMatchesPerDay?: number;
  /** See `Tournament.deadTimeBlocks` — array of { start, end } HH:MM windows. */
  deadTimeBlocks?: Array<{ start: string; end: string }>;
  /** See `Tournament.categoryPriority` — ordered category names. */
  categoryPriority?: string[];
  /** See `Tournament.finalsCourt` — preferred court for semis + finals.
   *  `null` clears the column; `undefined` leaves it untouched. */
  finalsCourt?: string | null;
  /**
   * See `Tournament.matchDurationsByCategory` — keyed by category, value
   * in minutes. Send `null` or `{}` to clear all overrides. Categories
   * not present fall back to `matchDurationMinutes`.
   */
  matchDurationsByCategory?: Record<string, number> | null;
}

export type UpdateTournamentDto = Partial<CreateTournamentDto>;

export interface CreateTeamDto {
  name: string;
  initials: string;       // 1-3 uppercase letters
  logo?: string;
  primaryColor: string;   // Hex #RRGGBB
  secondaryColor: string; // Hex #RRGGBB
  city?: string;
  department?: string;
  category?: string;
  /**
   * Optional club assignment (mig 028). Validated server-side against
   * the caller's owner scope — passing a club from another admin's
   * tenant is rejected with 404 (leak-safe).
   *   · `undefined` → leave column untouched on PATCH / null on INSERT
   *   · `null`      → clear the club assignment
   *   · `<uuid>`    → assign to that club (must belong to same owner)
   */
  clubId?: string | null;
}

export type UpdateTeamDto = Partial<CreateTeamDto>;

export interface CreateMatchDto {
  tournamentId: string;   // UUID, must exist
  team1Id: string;        // UUID, must exist, != team2Id
  team2Id: string;        // UUID, must exist, != team1Id
  date: string;           // ISO date
  time: string;
  court: string;
  referee?: string;
  phase: string;
  groupName?: string;
}

export type UpdateMatchDto = Partial<CreateMatchDto> & {
  status?: 'upcoming' | 'live' | 'completed';
  scoreTeam1?: number;
  scoreTeam2?: number;
  duration?: number;
};

export interface ScoreUpdate {
  status?: 'live' | 'completed';
  scoreTeam1?: number;
  scoreTeam2?: number;
  sets?: Array<{ setNumber: number; team1Points: number; team2Points: number }>;
  duration?: number;
}

// === Auth ===

export type AppRole = 'super_admin' | 'admin' | 'judge' | 'team_captain' | 'club_captain';

export interface JwtPayload {
  /**
   * For admin/judge/super_admin: users.id.
   * For team_captain: teams.id (we don't create a users row for captains —
   * the team itself is the account). Consumers decide what to do with it
   * using the `role` field.
   * For club_captain (mig 028): clubs.id (club is its own account).
   */
  userId: string;
  role: AppRole | string;
  /**
   * For judges: the admin (userId) that created this account — used to
   * scope their match feed. Null for admins / super_admins.
   * For club_captain: the admin (users.id) that owns the club row, so
   * downstream queries can scope to the same admin's tenant.
   */
  createdBy?: string | null;
  /**
   * For team_captain: the team's id (same as userId for captains, kept
   * as a named field so routes that already read `teamId` from params can
   * compare against `req.user.teamId` unambiguously).
   */
  teamId?: string | null;
  /**
   * For club_captain: the club's id (same as userId for clubs).
   * Routes scoped to a club use this for ownership checks and
   * `requireTeamAccess` will accept any team whose `club_id` equals it.
   */
  clubId?: string | null;
  iat: number;
  exp: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    role: string;
    /** Team id when role is team_captain; absent for app-side users. */
    teamId?: string;
    /** Club id when role is club_captain (mig 028). */
    clubId?: string;
    /** Club display name — surfaced so the UI can title the panel
     *  with the club name without an extra round-trip. */
    clubName?: string;
  };
}

// === Validation ===

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// === User ===

export interface User {
  id: string;
  username: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

// === Enrollment & Fixtures ===

export interface EnrolledTeam {
  id: string;
  tournamentId: string;
  teamId: string;
  team: Team;
}

export interface FixtureResult {
  matches: Match[];
  bracketMatches: BracketMatch[];
  generatedAt: string;
}
