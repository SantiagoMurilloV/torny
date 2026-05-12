import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  Loader2,
  Plus,
  Edit,
  Trash2,
  Search,
  User,
  FileText,
  Users,
  Info,
  Upload,
  Camera,
  ArrowLeft,
  ArrowRightLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Player, Team, Tournament } from '../../types';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PlayerFormModal } from '../../components/admin/PlayerFormModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PdfViewerModal } from '../../components/PdfViewerModal';
import { getErrorMessage } from '../../lib/errors';
import { compressLogoImage } from '../../lib/compressImage';

/**
 * TeamPanel — the captain's home. Shows the team identity plus the full
 * roster with add / edit / delete. Reuses PlayerFormModal so the captain
 * gets the exact same input UI the admin gets, and the backend endpoint
 * (POST/PUT/DELETE /api/teams/:teamId/players) is gated by requireTeamAccess
 * so a captain can only touch THEIR team.
 *
 * Phase 3 intentionally keeps this page minimal: one team + its roster.
 * A later iteration will surface the enrollment_deadline of each enrolled
 * tournament and actually lock edits once those deadlines pass.
 */
export function TeamPanel() {
  const { logout } = useAuth();
  // Optional URL param. When present (route /team-panel/:teamId) we
  // resolve the team via the public /teams/:id endpoint — used by the
  // club_captain flow where one club login lands you at /club-panel
  // and clicking a card takes you here. When absent, we fall back to
  // the original captain flow that reads `me.team` from /auth/me.
  const { teamId: teamIdFromUrl } = useParams<{ teamId?: string }>();
  const [teamInfo, setTeamInfo] = useState<{
    id: string;
    name: string;
    initials: string;
    logo?: string;
    primaryColor: string;
    secondaryColor: string;
    category?: string;
  } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  // Tournaments where this team is enrolled. Drives the "Plantel (X / Y)"
  // counter — Y is the strictest playersPerTeam across them, the same
  // cap the captain has to respect. We tolerate a fetch failure here
  // (the panel still works, just without the cap badge) so a transient
  // /tournaments hiccup doesn't lock the captain out of editing.
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | undefined>();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Sibling teams = the other teams of the captain's club (mig 029).
  // Used to populate the "Mover a otro equipo" dropdown. Empty when the
  // user isn't a club_captain or has only one team (no transfer
  // target). Loaded lazily inside `load()` so a single-team captain
  // doesn't pay the extra request.
  const [siblingTeams, setSiblingTeams] = useState<Team[]>([]);
  const [transferringPlayer, setTransferringPlayer] = useState<Player | null>(null);
  const [transferTargetTeamId, setTransferTargetTeamId] = useState<string>('');
  const [transferring, setTransferring] = useState(false);
  // Free-text filter over the captain's roster — purely client-side so
  // the input stays responsive on the kind of slow networks that show
  // up at a stadium. Falls back to "no matches" copy when nothing hits.
  const [playerSearch, setPlayerSearch] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  // PDF preview — abre el PdfViewerModal con el documento de la jugadora
  // que el capitán pulse, sin sacarlo del panel.
  const [pdfPreview, setPdfPreview] = useState<
    { url: string; title: string; fileName: string } | null
  >(null);

  // Always read the team id from the freshly-fetched /auth/me payload so
  // an old session object in localStorage (from before the `teamId` field
  // was added to AuthUser) can't desync us from the real team identity.
  const teamId = teamInfo?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two paths:
      //   · No URL param → captain flow. /auth/me carries the team.
      //   · URL param present → club_captain flow (or admin opens a
      //     team's panel directly). Fetch the team via /teams/:id.
      //     The backend's requireTeamAccess permits a club_captain
      //     when teams.club_id matches their JWT clubId.
      let resolvedTeam: Team;
      if (teamIdFromUrl) {
        resolvedTeam = await api.getTeam(teamIdFromUrl);
      } else {
        const me = await api.getMe();
        if (me.role !== 'team_captain' || !me.team) {
          throw new Error('Sesión no válida para panel de equipo');
        }
        // Coerce me.team into a Team-shaped object so the rest of the
        // component reads the same fields regardless of source.
        resolvedTeam = {
          id: me.team.id,
          name: me.team.name,
          initials: me.team.initials,
          logo: me.team.logo,
          primaryColor: me.team.primaryColor,
          secondaryColor: me.team.secondaryColor,
          category: me.team.category,
        } as Team;
      }
      setTeamInfo({
        id: resolvedTeam.id,
        name: resolvedTeam.name,
        initials: resolvedTeam.initials,
        logo: resolvedTeam.logo,
        primaryColor: resolvedTeam.primaryColor,
        secondaryColor: resolvedTeam.secondaryColor,
        category: resolvedTeam.category,
      });
      // Fire roster + enrolled tournaments in parallel — they don't depend
      // on each other and the panel only renders when both have responded.
      // The tournaments call is wrapped so a transient failure (network /
      // 5xx) just hides the cap badge instead of blowing up the whole load.
      const [roster, enrolledTournaments] = await Promise.all([
        api.listTeamPlayers(resolvedTeam.id),
        api.getTeamTournaments(resolvedTeam.id).catch(() => [] as Tournament[]),
      ]);
      setPlayers(roster);
      setTournaments(enrolledTournaments);

      // Club captain: also load sibling teams so we can offer the
      // "transfer player to another team" action (mig 029). Best-
      // effort — a 401/403 here just means the regular team_captain
      // role and we silently skip the feature.
      try {
        const me = await api.getMe();
        if ((me as { role?: string }).role === 'club_captain') {
          const { teamIds } = await api.clubs.meTeams();
          const others = teamIds.filter((id) => id !== resolvedTeam.id);
          if (others.length > 0) {
            const teamsBatch = await Promise.all(
              others.map((id) => api.getTeam(id).catch(() => null)),
            );
            setSiblingTeams(teamsBatch.filter((t): t is Team => t !== null));
          } else {
            setSiblingTeams([]);
          }
        } else {
          setSiblingTeams([]);
        }
      } catch {
        setSiblingTeams([]);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Token rejected server-side — log out so the user sees /login.
        logout('Sesión expirada. Iniciá sesión de nuevo.');
        return;
      }
      setError(getErrorMessage(err, 'Error al cargar el panel'));
    } finally {
      // teamIdFromUrl is part of the dep array so a club_captain
      // navigating between teams (different :teamId) re-runs load()
      // and refreshes the panel for the freshly-picked team.
      setLoading(false);
    }
  }, [logout, teamIdFromUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = () => {
    setEditingPlayer(undefined);
    setFormOpen(true);
  };

  const handleEdit = (p: Player) => {
    setEditingPlayer(p);
    setFormOpen(true);
  };

  const handleSaved = (saved: Player) => {
    setPlayers((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx === -1) {
        return [...prev, saved].sort((a, b) => {
          const ln = a.lastName.localeCompare(b.lastName);
          return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
        });
      }
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    toast.success(editingPlayer ? 'Jugador@ actualizad@' : 'Jugador@ agregad@');
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires onChange again.
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (!file || !teamId) return;
    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('La imagen no puede superar 2MB');
      return;
    }
    setUploadingLogo(true);
    try {
      // Resize + recompress in the browser so the data URL we persist
      // in Postgres is small enough to ship in the public /teams
      // listing — same compressLogoImage helper the admin form uses.
      const compressed = await compressLogoImage(file);
      const url = await api.uploadLogo(compressed);
      const updated = await api.updateTeamLogo(teamId, url);
      setTeamInfo((prev) => (prev ? { ...prev, logo: updated.logo } : prev));
      toast.success('Logo actualizado');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al subir el logo'));
    } finally {
      setUploadingLogo(false);
    }
  };

  /**
   * Open the transfer modal for the chosen player. Defaults the
   * dropdown to the first sibling so the captain can confirm with
   * one click in the most common case (two teams in the club).
   */
  const handleOpenTransfer = (player: Player) => {
    setTransferringPlayer(player);
    setTransferTargetTeamId(siblingTeams[0]?.id ?? '');
  };

  const handleConfirmTransfer = async () => {
    if (!transferringPlayer || !teamId || !transferTargetTeamId) return;
    setTransferring(true);
    try {
      await api.transferPlayer(
        teamId,
        transferringPlayer.id,
        transferTargetTeamId,
      );
      const targetName =
        siblingTeams.find((t) => t.id === transferTargetTeamId)?.name ?? 'el equipo destino';
      toast.success(
        `${transferringPlayer.firstName} ${transferringPlayer.lastName} pasó a ${targetName}`,
      );
      // Drop the player from THIS team's local state — the move is
      // server-confirmed at this point.
      setPlayers((prev) => prev.filter((p) => p.id !== transferringPlayer.id));
      setTransferringPlayer(null);
      setTransferTargetTeamId('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo mover la jugadora'));
    } finally {
      setTransferring(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId || !teamId) return;
    const id = pendingDeleteId;
    setDeletingId(id);
    try {
      await api.deletePlayer(teamId, id);
      setPlayers((prev) => prev.filter((p) => p.id !== id));
      toast.success('Jugador@ eliminad@');
      setPendingDeleteId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al eliminar'));
      throw err;
    } finally {
      setDeletingId(null);
    }
  };

  const filteredPlayers = useMemo(() => {
    const term = playerSearch.trim().toLowerCase();
    if (term.length === 0) return players;
    return players.filter((p) => {
      const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
      return (
        fullName.includes(term) ||
        (p.position?.toLowerCase().includes(term) ?? false) ||
        (p.documentNumber?.toLowerCase().includes(term) ?? false) ||
        (p.shirtNumber != null && String(p.shirtNumber) === term)
      );
    });
  }, [players, playerSearch]);

  /**
   * Strictest roster cap across the team's enrolled tournaments. We use
   * the MIN (not MAX) so the captain sees the tightest constraint — if
   * one tournament allows 14 and another 12, going past 12 already
   * breaks the second one. `undefined` means "no enrolled tournament
   * has a configured cap" → we render the legacy "(N)" counter and keep
   * the add button enabled.
   *
   * Note: `playersPerTeam` is described in the admin form as "cupo
   * recomendado" — the backend doesn't enforce it on POST /players. We
   * still disable the button at the cap to nudge captains toward
   * compliance; if they really need to add one more they can ask the
   * admin to bump the tournament setting.
   */
  const playerCap = useMemo(() => {
    const caps = tournaments
      .map((t) => t.playersPerTeam)
      .filter((n): n is number => typeof n === 'number' && n > 0);
    if (caps.length === 0) return undefined;
    return Math.min(...caps);
  }, [tournaments]);

  const atRosterCap = playerCap !== undefined && players.length >= playerCap;
  // Which tournament drives the cap — used to label the hint when the
  // captain hits the limit. When two tournaments tie at the strictest
  // value we just show the first; that's a corner case for the rare
  // multi-tournament team and the helper text already says "más
  // restrictivo" so the wording stays accurate.
  const capTournamentName = useMemo(() => {
    if (playerCap === undefined) return undefined;
    return tournaments.find((t) => t.playersPerTeam === playerCap)?.name;
  }, [tournaments, playerCap]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" aria-hidden="true" />
      </div>
    );
  }

  if (error || !teamInfo) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-6 text-center">
        <div className="text-sm text-red-600 mb-3">{error ?? 'No hay equipo asociado a esta sesión'}</div>
        <button
          type="button"
          onClick={() => load()}
          className="px-4 py-2 bg-spk-red text-white rounded-sm font-bold uppercase"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Back link — only when a club_captain navigated in via
          /team-panel/:teamId. They land here from /club-panel; the
          link returns them to the team picker. Hidden for the regular
          team_captain flow which has only one team. */}
      {teamIdFromUrl && (
        <Link
          to="/club-panel"
          className="inline-flex items-center gap-2 text-sm text-black/55 hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Volver al panel del club
        </Link>
      )}
      {/* Team identity banner — the avatar doubles as a logo uploader so the
          captain can drop their crest in without bothering the admin. The
          hint copy below it keeps the affordance discoverable on touch
          (where there's no hover state to reveal the overlay). */}
      <section className="bg-white border border-black/10 rounded-sm p-4 sm:p-6 flex items-center gap-4 sm:gap-5">
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadingLogo}
            aria-label={teamInfo.logo ? 'Cambiar logo del equipo' : 'Subir logo del equipo'}
            title={teamInfo.logo ? 'Tocá para cambiar el logo' : 'Tocá para subir el logo'}
            className="relative group rounded-sm overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-spk-red disabled:opacity-60"
          >
            {teamInfo.logo ? (
              <img
                src={teamInfo.logo}
                alt={teamInfo.name}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-sm object-cover border border-black/10"
              />
            ) : (
              <div
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-sm flex items-center justify-center text-white font-bold text-2xl sm:text-3xl border border-black/10"
                style={{
                  backgroundColor: teamInfo.primaryColor,
                  fontFamily: 'Barlow Condensed, sans-serif',
                }}
              >
                {teamInfo.initials}
              </div>
            )}
            {/* Overlay — solid on touch (no hover state), fades in on hover
                for desktop. Uses bg-black/55 so the icons read on any logo
                color. */}
            <span
              className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            >
              {uploadingLogo ? (
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : teamInfo.logo ? (
                <Camera className="w-6 h-6 text-white" />
              ) : (
                <Upload className="w-6 h-6 text-white" />
              )}
            </span>
          </button>
          <span
            className="text-[10px] uppercase font-bold tracking-wider text-black/55 text-center leading-tight"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
          >
            {uploadingLogo
              ? 'Subiendo…'
              : teamInfo.logo
                ? 'Tocá para cambiar'
                : 'Tocá para subir el logo'}
          </span>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoSelect}
            className="hidden"
          />
        </div>
        <div className="min-w-0">
          <h1
            className="text-xl sm:text-3xl font-bold uppercase truncate"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '-0.01em' }}
          >
            {teamInfo.name}
          </h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-black/60 flex-wrap">
            <span className="font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {teamInfo.initials}
            </span>
            {teamInfo.category && (
              <>
                <span className="text-black/30">·</span>
                <span>{teamInfo.category}</span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Informational note — enrollment_deadline enforcement ships in a
          later phase; for now surface the intent so the captain knows the
          window matters. */}
      <div className="flex items-start gap-2 rounded-sm bg-spk-gold/10 border border-spk-gold/40 px-4 py-3 text-xs text-black/70">
        <Info className="w-4 h-4 flex-shrink-0 text-spk-gold mt-0.5" aria-hidden="true" />
        <span>
          Completá el plantel antes de la fecha límite de inscripción que te
          indicó el organizador. Cada cambio se guarda al instante.
        </span>
      </div>

      {/* Roster */}
      <section className="bg-white border border-black/10 rounded-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-black/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-black/60 flex-shrink-0" aria-hidden="true" />
            <h2
              className="text-sm sm:text-base font-bold uppercase"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
            >
              Plantel{' '}
              {/* Counter — when the team is enrolled in at least one
                  tournament with a configured cap we render "X / Y" so
                  the captain sees the strictest tournament's limit. We
                  highlight the count in red the moment it hits or
                  exceeds the cap so the visual cue lands before they
                  even try to click the disabled button below. */}
              <span
                className={`font-normal tabular-nums ${atRosterCap ? 'text-spk-red font-bold' : 'text-black/50'}`}
              >
                ({players.length}
                {playerCap !== undefined ? ` / ${playerCap}` : ''})
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={atRosterCap}
            // When the cap is hit we surface the reason in the tooltip
            // (most browsers show `title` on hover, and screen readers
            // pick up `aria-label` overrides). The button stays in the
            // DOM so the layout doesn't jump — just visually + behaviorally
            // disabled.
            title={
              atRosterCap
                ? `Alcanzaste el cupo de ${playerCap} jugador@s${
                    capTournamentName ? ` (torneo ${capTournamentName})` : ''
                  }.`
                : undefined
            }
            aria-label={
              atRosterCap
                ? `Cupo del plantel completo (${playerCap} jugador@s)`
                : undefined
            }
            className="self-end sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm text-xs sm:text-sm font-bold uppercase disabled:bg-black/30 disabled:cursor-not-allowed disabled:hover:bg-black/30"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar jugador@
          </button>
        </div>

        {/* Cap hint — only when there's a cap configured. Two flavours:
            · roster bajo el cupo → micro-copy gris explicando el cupo.
            · roster lleno        → micro-copy ámbar para reforzar por
              qué el botón quedó deshabilitado y cómo destrabarlo. */}
        {playerCap !== undefined && (
          <div
            className={`px-4 sm:px-5 py-2 text-[11px] border-b border-black/10 ${
              atRosterCap ? 'bg-spk-gold/10 text-black/75' : 'text-black/55'
            }`}
          >
            {atRosterCap ? (
              <>
                Alcanzaste el cupo de <strong>{playerCap}</strong> jugador@s
                {capTournamentName ? (
                  <>
                    {' '}del torneo <strong>{capTournamentName}</strong>
                  </>
                ) : null}
                . Para sumar más, eliminá una jugador@ o pedile al organizador
                que amplíe el cupo.
              </>
            ) : (
              <>
                Cupo del plantel: <strong>{playerCap}</strong>
                {capTournamentName
                  ? ` jugador@s (según torneo ${capTournamentName})`
                  : ' jugador@s (según el torneo más restrictivo donde estás inscrito)'}
                .
              </>
            )}
          </div>
        )}

        {/* Filter bar — only renders when the roster has enough rows that
            scrolling becomes painful. For brand-new teams the empty state
            copy below speaks more clearly without an extra control. */}
        {players.length >= 6 && (
          <div className="px-4 sm:px-5 pt-3 pb-1">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none" />
              <input
                type="text"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="Buscar por nombre, dorsal, posición…"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-sm border border-spk-hairline focus:border-spk-red focus:ring-2 focus:ring-spk-red/20 outline-none bg-white"
              />
            </div>
          </div>
        )}

        {players.length === 0 ? (
          <div className="py-10 text-center text-sm text-black/60 px-4">
            Aún no hay jugador@s registrad@s. Empezá agregando el plantel.
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="py-8 text-center text-sm text-black/60 px-4">
            Ningún@ jugador@ coincide con &ldquo;{playerSearch}&rdquo;.
          </div>
        ) : (
          <ul className="divide-y divide-black/10">
            {filteredPlayers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3 sm:p-4">
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={`${p.firstName} ${p.lastName}`}
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-sm object-cover border border-black/10 flex-shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-sm bg-black/5 border border-black/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-black/40" aria-hidden="true" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.shirtNumber != null && (
                      <span
                        className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 rounded-sm bg-black text-white text-[11px] font-bold tabular-nums flex-shrink-0"
                        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                      >
                        {p.shirtNumber}
                      </span>
                    )}
                    <span
                      className="font-bold truncate"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                    >
                      {p.firstName} {p.lastName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-black/60 flex-wrap">
                    {p.position && <span>{p.position}</span>}
                    {p.position && (p.category || p.birthDate) && (
                      <span className="text-black/30">·</span>
                    )}
                    {p.category && <span>{p.category}</span>}
                    {p.category && p.birthDate && <span className="text-black/30">·</span>}
                    {p.birthDate && (
                      <span title={p.birthDate}>{p.birthDate.slice(0, 4)}</span>
                    )}
                    {p.documentNumber && (
                      <>
                        <span className="text-black/30">·</span>
                        <span>
                          {p.documentType ?? 'DOC'} {p.documentNumber}
                        </span>
                      </>
                    )}
                    {p.documentFile && (
                      <>
                        <span className="text-black/30">·</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const slug = `${p.firstName} ${p.lastName}`
                              .toLowerCase()
                              .normalize('NFD')
                              .replace(/[\u0300-\u036f]/g, '')
                              .replace(/\s+/g, '-');
                            setPdfPreview({
                              url: p.documentFile!,
                              title: `Documento — ${p.firstName} ${p.lastName}`,
                              fileName: `documento-${slug || 'jugadora'}.pdf`,
                            });
                          }}
                          className="inline-flex items-center gap-1 text-spk-blue hover:underline"
                          aria-label="Ver documento PDF"
                        >
                          <FileText className="w-3 h-3" aria-hidden="true" />
                          PDF
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {siblingTeams.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenTransfer(p)}
                      aria-label={`Mover ${p.firstName} ${p.lastName} a otro equipo`}
                      title="Mover a otro equipo del club"
                      className="p-2 bg-spk-gold/10 text-spk-gold rounded-sm hover:bg-spk-gold/20 transition-colors"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleEdit(p)}
                    aria-label={`Editar ${p.firstName} ${p.lastName}`}
                    className="p-2 bg-spk-blue/10 text-spk-blue rounded-sm hover:bg-spk-blue/20 transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(p.id)}
                    disabled={deletingId === p.id}
                    aria-label={`Eliminar ${p.firstName} ${p.lastName}`}
                    className="p-2 bg-spk-red/10 text-spk-red rounded-sm hover:bg-spk-red/20 transition-colors disabled:opacity-50"
                  >
                    {deletingId === p.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {teamId && (
        <PlayerFormModal
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
          teamId={teamId}
          player={editingPlayer}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(openDialog) => {
          if (!openDialog) setPendingDeleteId(null);
        }}
        title="Eliminar jugador@"
        description="¿Estás seguro de que querés eliminar a este/a jugador/a? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deletingId !== null}
        onConfirm={confirmDelete}
      />

      <PdfViewerModal
        isOpen={pdfPreview !== null}
        onClose={() => setPdfPreview(null)}
        pdfDataUrl={pdfPreview?.url ?? ''}
        title={pdfPreview?.title ?? 'Documento'}
        downloadFileName={pdfPreview?.fileName ?? 'documento.pdf'}
      />

      {/* Transfer-between-teams modal (mig 029). Same-club guarantee is
          enforced by the backend (`requireTeamOwnership` + service-level
          club_id match); the FE only shows sibling teams that the
          captain already owns via /api/clubs/me/teams. */}
      {transferringPlayer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
          role="dialog"
          aria-label="Mover jugadora a otro equipo"
        >
          <div className="bg-white rounded-sm shadow-2xl max-w-sm w-full overflow-hidden">
            <header className="bg-spk-black text-white px-5 py-3.5">
              <p
                className="text-[10px] uppercase tracking-wider text-white/55 font-bold"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Mover a otro equipo
              </p>
              <h2
                className="text-lg font-bold leading-tight truncate"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {transferringPlayer.firstName} {transferringPlayer.lastName}
              </h2>
            </header>
            <div className="p-5 space-y-4">
              <p className="text-sm text-black/70 leading-relaxed">
                Elegí el equipo destino dentro del club. La jugadora
                deja de aparecer acá y pasa al plantel del otro
                equipo con su foto, documento y contacto intactos.
              </p>
              <label className="block">
                <span
                  className="block text-[11px] font-bold uppercase mb-1.5 text-black/55"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    letterSpacing: '0.08em',
                  }}
                >
                  Equipo destino
                </span>
                <select
                  value={transferTargetTeamId}
                  onChange={(e) => setTransferTargetTeamId(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white text-sm"
                >
                  {siblingTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.category ? ` — ${t.category}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setTransferringPlayer(null);
                    setTransferTargetTeamId('');
                  }}
                  disabled={transferring}
                  className="flex-1 px-4 py-2.5 bg-black/5 hover:bg-black/10 font-bold rounded-sm transition-colors disabled:opacity-50 text-sm uppercase"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    letterSpacing: '0.05em',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTransfer}
                  disabled={transferring || !transferTargetTeamId}
                  className="flex-1 px-4 py-2.5 bg-spk-red hover:bg-spk-red-dark text-white font-bold rounded-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2 text-sm uppercase"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    letterSpacing: '0.05em',
                  }}
                >
                  {transferring && <Loader2 className="w-4 h-4 animate-spin" />}
                  Mover
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
