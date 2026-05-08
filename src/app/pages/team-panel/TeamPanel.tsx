import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Plus,
  Edit,
  Trash2,
  User,
  FileText,
  Users,
  Info,
  Upload,
  Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Player } from '../../types';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | undefined>();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
      // /auth/me returns the team payload for captains; use it as the
      // source of truth so a stale teamId in localStorage gets corrected.
      const me = await api.getMe();
      if (me.role !== 'team_captain' || !me.team) {
        throw new Error('Sesión no válida para panel de equipo');
      }
      setTeamInfo({
        id: me.team.id,
        name: me.team.name,
        initials: me.team.initials,
        logo: me.team.logo,
        primaryColor: me.team.primaryColor,
        secondaryColor: me.team.secondaryColor,
        category: me.team.category,
      });
      const roster = await api.listTeamPlayers(me.team.id);
      setPlayers(roster);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Token rejected server-side — log out so the user sees /login.
        logout('Sesión expirada. Iniciá sesión de nuevo.');
        return;
      }
      setError(getErrorMessage(err, 'Error al cargar el panel'));
    } finally {
      setLoading(false);
    }
  }, [logout]);

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
        <div className="px-4 sm:px-5 py-3 border-b border-black/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-black/60 flex-shrink-0" aria-hidden="true" />
            <h2
              className="text-sm sm:text-base font-bold uppercase"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
            >
              Plantel{' '}
              <span className="text-black/50 font-normal tabular-nums">({players.length})</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm text-xs sm:text-sm font-bold uppercase"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar jugador@
          </button>
        </div>

        {players.length === 0 ? (
          <div className="py-10 text-center text-sm text-black/60 px-4">
            Aún no hay jugador@s registrad@s. Empezá agregando el plantel.
          </div>
        ) : (
          <ul className="divide-y divide-black/10">
            {players.map((p) => (
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
                    {p.position && (p.category || p.birthYear) && (
                      <span className="text-black/30">·</span>
                    )}
                    {p.category && <span>{p.category}</span>}
                    {p.category && p.birthYear && <span className="text-black/30">·</span>}
                    {p.birthYear && <span>{p.birthYear}</span>}
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
    </div>
  );
}
