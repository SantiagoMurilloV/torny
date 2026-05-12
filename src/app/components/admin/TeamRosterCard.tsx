import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  Edit,
  Trash2,
  Loader2,
  Plus,
  Search,
  User,
  FileText,
  Users,
  KeyRound,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import type { Team, Player } from '../../types';
import { api } from '../../services/api';
import { TeamAvatar } from '../TeamAvatar';
import { PlayerFormModal } from './PlayerFormModal';
import { ConfirmDialog } from '../ConfirmDialog';
import { TeamCredentialsModal } from './TeamCredentialsModal';
import { useTeamCaptainCredentials } from '../../hooks/useTeamCaptainCredentials';
import { getErrorMessage } from '../../lib/errors';
import { PdfViewerModal } from '../PdfViewerModal';

interface TeamRosterCardProps {
  team: Team;
  onEditTeam: (team: Team) => void;
  onDeleteTeam: (team: Team) => void;
  /** Whether the parent is currently deleting this team (disables the row). */
  deletingTeam?: boolean;
  /**
   * Accessible name and tooltip for the "delete" button. Used when the
   * card lives inside a tournament so the button reads "Desinscribir" /
   * "Quitar del torneo" instead of the default "Eliminar equipo".
   */
  deleteButtonLabel?: (team: Team) => string;
}

/**
 * TeamRosterCard — collapsible team row that renders team metadata in the
 * header and the roster (jugadoras) in the body. The roster is fetched
 * lazily the first time the card is expanded so a page with many teams
 * doesn't hammer the API on mount.
 *
 * Team-level edit/delete live in the header. Player-level create/edit/delete
 * live inside the body and talk directly to the backend — there's no DataContext
 * slice for players because the data is team-scoped and only shown here.
 */
export function TeamRosterCard({
  team,
  onEditTeam,
  onDeleteTeam,
  deletingTeam,
  deleteButtonLabel,
}: TeamRosterCardProps) {
  const resolvedDeleteLabel = deleteButtonLabel
    ? deleteButtonLabel(team)
    : `Eliminar ${team.name}`;
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once so we don't re-fetch on every re-open. */
  const [fetched, setFetched] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | undefined>();
  const [pendingDeletePlayerId, setPendingDeletePlayerId] = useState<string | null>(null);
  const [deletingPlayerId, setDeletingPlayerId] = useState<string | null>(null);
  // Free-text filter over the roster — purely client-side to avoid a
  // round-trip per keystroke (rosters are small enough that filter-in-
  // JS is faster than re-querying for each ?search= variant).
  const [playerSearch, setPlayerSearch] = useState('');
  // PDF preview — abre el PdfViewerModal con el documento de la jugadora
  // que el admin pulse, sin sacarlo del flujo del listado.
  const [pdfPreview, setPdfPreview] = useState<
    { url: string; title: string; fileName: string } | null
  >(null);

  // Captain credentials — extracted to a hook so this card stays slim.
  const creds = useTeamCaptainCredentials(team);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listTeamPlayers(team.id);
      setPlayers(rows);
      setFetched(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Error al cargar plantel'));
    } finally {
      setLoading(false);
    }
  }, [team.id]);

  // Lazy-load the roster the first time the card is opened.
  useEffect(() => {
    if (open && !fetched && !loading) {
      loadRoster();
    }
  }, [open, fetched, loading, loadRoster]);

  const handleCreate = () => {
    setEditingPlayer(undefined);
    setFormOpen(true);
  };

  const handleEditPlayer = (player: Player) => {
    setEditingPlayer(player);
    setFormOpen(true);
  };

  const handlePlayerSaved = (saved: Player) => {
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

  /**
   * Primary credentials action: lookup if already generated, fresh if not.
   * The KeyRound button in the header calls this; the modal shown below
   * adapts its copy via `mode: 'fresh' | 'lookup'`.
   */
  const handleClickCredentials = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (creds.hasCredentials) {
      await creds.reveal();
      return;
    }
    try {
      await creds.generate();
    } catch {
      // toast already shown by the hook
    }
  };

  const confirmDeletePlayer = async () => {
    if (!pendingDeletePlayerId) return;
    const id = pendingDeletePlayerId;
    setDeletingPlayerId(id);
    try {
      await api.deletePlayer(team.id, id);
      setPlayers((prev) => prev.filter((p) => p.id !== id));
      toast.success('Jugador@ eliminad@');
      setPendingDeletePlayerId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al eliminar'));
      throw err;
    } finally {
      setDeletingPlayerId(null);
    }
  };

  const locationLine = [team.city, team.department].filter(Boolean).join(', ');
  const contentId = `roster-body-${team.id}`;

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

  return (
    <div className="bg-white border-2 border-black/10 rounded-sm overflow-hidden">
      {/* Header row — click toggles body; action buttons stop propagation */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 transition-colors"
      >
        <TeamAvatar team={team} size="md" />

        <div className="flex-1 min-w-0">
          <div
            className="font-bold uppercase truncate"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '-0.01em' }}
          >
            {team.name}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-black/60 flex-wrap">
            <span className="font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {team.initials}
            </span>
            {team.category && (
              <>
                <span className="text-black/30">·</span>
                <span className="truncate">{team.category}</span>
              </>
            )}
            {locationLine && (
              <>
                <span className="text-black/30">·</span>
                <span className="truncate">{locationLine}</span>
              </>
            )}
            {team.captainUsername && (
              <>
                <span className="text-black/30">·</span>
                <span
                  className="inline-flex items-center gap-1 text-black/50 font-mono"
                  title="Usuario del capitán"
                >
                  <KeyRound className="w-3 h-3" aria-hidden="true" />
                  {team.captainUsername}
                </span>
              </>
            )}
          </div>
        </div>

        {fetched && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-xs text-black/60"
            title={`${players.length} jugador@s`}
          >
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-bold tabular-nums">{players.length}</span>
          </span>
        )}

        <div
          className="flex items-center gap-1 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleClickCredentials}
            disabled={creds.busy}
            aria-label={
              creds.hasCredentials
                ? `Ver credenciales de ${team.name}`
                : `Generar credenciales para ${team.name}`
            }
            title={
              creds.hasCredentials
                ? 'Ver credenciales del capitán'
                : 'Generar credenciales del capitán'
            }
            className={`p-2 rounded-sm transition-colors disabled:opacity-50 ${
              creds.hasCredentials
                ? 'bg-spk-gold/20 text-spk-gold hover:bg-spk-gold/30'
                : 'bg-black/5 text-black/60 hover:bg-black/10'
            }`}
          >
            {creds.busy ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEditTeam(team); }}
            aria-label={`Editar ${team.name}`}
            className="p-2 bg-spk-blue/10 text-spk-blue rounded-sm hover:bg-spk-blue/20 transition-colors"
          >
            <Edit className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteTeam(team); }}
            disabled={deletingTeam}
            aria-label={resolvedDeleteLabel}
            title={resolvedDeleteLabel}
            className="p-2 bg-spk-red/10 text-spk-red rounded-sm hover:bg-spk-red/20 transition-colors disabled:opacity-50"
          >
            {deletingTeam ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="inline-flex ml-1 text-black/60"
            aria-hidden="true"
          >
            <ChevronDown className="w-5 h-5" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden border-t border-black/10"
          >
            <div className="p-4 space-y-3 bg-black/[0.02]">
              <div className="flex items-center justify-between gap-2">
                <h4
                  className="font-bold text-sm uppercase"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
                >
                  Plantel
                </h4>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors text-sm font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }} className="uppercase font-bold">
                    Agregar jugador@
                  </span>
                </button>
              </div>

              {/* Filter input — only render when the roster has enough
                  rows that scanning becomes painful. Keeps the card slim
                  for small teams. */}
              {players.length >= 6 && (
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
              )}

              {loading && players.length === 0 ? (
                <div className="py-8 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-spk-red" />
                </div>
              ) : error ? (
                <div className="py-6 text-center text-sm">
                  <p className="text-red-600 mb-2">{error}</p>
                  <button
                    type="button"
                    onClick={() => loadRoster()}
                    className="px-3 py-1.5 bg-spk-red text-white rounded-sm hover:bg-spk-red-dark transition-colors text-sm font-medium"
                  >
                    Reintentar
                  </button>
                </div>
              ) : players.length === 0 ? (
                <div className="py-8 text-center text-sm text-black/60">
                  Aún no hay jugador@s registrad@s. Empezá agregando.
                </div>
              ) : filteredPlayers.length === 0 ? (
                <div className="py-6 text-center text-sm text-black/60">
                  Ningún@ jugador@ coincide con &ldquo;{playerSearch}&rdquo;.
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredPlayers.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 p-2.5 bg-white border border-black/10 rounded-sm"
                    >
                      {p.photo ? (
                        <img
                          src={p.photo}
                          alt={`${p.firstName} ${p.lastName}`}
                          className="w-10 h-10 rounded-sm object-cover border border-black/10 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-black/5 border border-black/10 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-black/40" aria-hidden="true" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {p.shirtNumber != null && (
                            <span
                              className="inline-flex items-center justify-center min-w-[24px] h-[20px] px-1.5 rounded-sm bg-black text-white text-[11px] font-bold tabular-nums flex-shrink-0"
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
                            <span title={p.birthDate}>
                              {/* Just the year — fits the existing one-line
                                  pill density; the full date lives in the
                                  edit modal + hover tooltip. */}
                              {p.birthDate.slice(0, 4)}
                            </span>
                          )}
                          {p.documentNumber && (
                            <>
                              <span className="text-black/30">·</span>
                              <span>{p.documentType ?? 'DOC'} {p.documentNumber}</span>
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
                        <button
                          type="button"
                          onClick={() => handleEditPlayer(p)}
                          aria-label={`Editar ${p.firstName} ${p.lastName}`}
                          className="p-2 bg-spk-blue/10 text-spk-blue rounded-sm hover:bg-spk-blue/20 transition-colors"
                        >
                          <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeletePlayerId(p.id)}
                          disabled={deletingPlayerId === p.id}
                          aria-label={`Eliminar ${p.firstName} ${p.lastName}`}
                          className="p-2 bg-spk-red/10 text-spk-red rounded-sm hover:bg-spk-red/20 transition-colors disabled:opacity-50"
                        >
                          {deletingPlayerId === p.id ? (
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PlayerFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handlePlayerSaved}
        teamId={team.id}
        player={editingPlayer}
      />

      <ConfirmDialog
        open={pendingDeletePlayerId !== null}
        onOpenChange={(openDialog) => {
          if (!openDialog) setPendingDeletePlayerId(null);
        }}
        title="Eliminar jugador@"
        description="¿Estás seguro de que querés eliminar a este/a jugador/a? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deletingPlayerId !== null}
        onConfirm={confirmDeletePlayer}
      />

      <ConfirmDialog
        open={creds.pendingRegenerate}
        onOpenChange={(openDialog) => {
          if (!openDialog) creds.cancelRegenerate();
        }}
        title="Regenerar credenciales"
        description="Se van a generar un usuario y contraseña nuevos para el capitán. Las credenciales anteriores dejarán de funcionar de inmediato. ¿Continuar?"
        confirmLabel="Regenerar"
        loading={creds.busy}
        onConfirm={creds.confirmRegenerate}
      />

      <TeamCredentialsModal
        teamName={team.name}
        receipt={creds.receipt}
        onClose={creds.closeReceipt}
        onRegenerate={creds.requestRegenerate}
      />

      <PdfViewerModal
        isOpen={pdfPreview !== null}
        onClose={() => setPdfPreview(null)}
        pdfDataUrl={pdfPreview?.url ?? ''}
        title={pdfPreview?.title ?? 'Documento'}
        downloadFileName={pdfPreview?.fileName ?? 'documento.pdf'}
      />
    </div>
  );
}
