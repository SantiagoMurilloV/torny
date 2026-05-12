import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Download, RefreshCw, KeyRound, Trash2, Pencil } from 'lucide-react';
import { api } from '../../services/api';
import type { Club, DetectedCluster } from '../../services/api/clubs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../lib/errors';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Admin tab for club-level credentials (mig 028). Two main flows:
 *
 *   1. "Detectar y crear clubs" — runs the auto-grouping by first
 *      word of every team name. Opens a modal where the admin can
 *      rename each cluster + skip the ones that aren't real clubs
 *      before bulk-creating them. Re-runnable any time (only NEW
 *      unclustered teams show up on a re-run).
 *
 *   2. "Exportar Excel" — downloads a single XLSX with two sheets
 *      (Clubs + Equipos), each carrying the credentials needed to
 *      hand off accounts to the actual clubs. Plaintext passwords
 *      come from `*_password_recovery` (same fields the show-once
 *      modals already display); regen rotates them.
 *
 * The list below shows every existing club with its username, a
 * masked password (full plaintext available via copy-to-clipboard
 * button), team count, plus per-row actions: rename, regenerate
 * credentials, delete.
 */
export function AdminClubs() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [detectOpen, setDetectOpen] = useState(false);
  const [renamingClub, setRenamingClub] = useState<Club | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Club | null>(null);
  const [exporting, setExporting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.clubs.list();
      setClubs(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudieron cargar los clubs'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.clubs.downloadExcel();
      toast.success('Excel descargado');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al descargar Excel'));
    } finally {
      setExporting(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2" style={FONT}>
            <Building2 className="w-6 h-6 text-spk-red" aria-hidden="true" />
            CLUBS
          </h1>
          <p className="text-sm text-black/55 mt-1 max-w-prose">
            Un único usuario y contraseña por club que ve TODOS sus equipos —
            facilita el alta de plantel y logos. Detectado automáticamente
            por la primera palabra del nombre de cada equipo. Convive con
            las credenciales individuales de capitán que ya tenés generadas.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setDetectOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-spk-red text-white font-bold rounded-sm hover:bg-spk-red-dark transition-colors text-sm"
            style={FONT}
          >
            <Building2 className="w-4 h-4" aria-hidden="true" />
            Detectar y crear clubs
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || clubs.length === 0}
            title={
              clubs.length === 0
                ? 'Necesitás al menos un club creado'
                : 'Descarga clubs-y-equipos.xlsx con 2 hojas'
            }
            className="inline-flex items-center gap-2 px-3 py-2 bg-black text-white font-bold rounded-sm hover:bg-black/85 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            style={FONT}
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting ? 'Generando…' : 'Exportar Excel'}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-black/50 italic">Cargando…</div>
      ) : clubs.length === 0 ? (
        <div className="border-2 border-dashed border-black/15 rounded-sm p-8 text-center">
          <Building2 className="w-10 h-10 text-black/25 mx-auto mb-3" aria-hidden="true" />
          <p className="text-black/60 mb-1">Aún no hay clubs creados</p>
          <p className="text-xs text-black/40">
            Tocá <span className="font-bold">&ldquo;Detectar y crear clubs&rdquo;</span>{' '}
            para que detectemos los clubs por la primera palabra de cada equipo.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {clubs.map((club) => (
            <div
              key={club.id}
              className="flex items-center justify-between gap-3 bg-white border border-black/10 rounded-sm px-4 py-3 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-base truncate" style={FONT}>
                    {club.name}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-black text-white text-[10px] font-bold">
                    {club.teamsCount ?? 0} equipos
                  </span>
                </div>
                <div className="mt-1 text-xs text-black/60 flex gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => copy(club.username, 'Usuario')}
                    className="inline-flex items-center gap-1 hover:text-black"
                    title="Copiar usuario"
                  >
                    <span className="font-bold text-black/55">Usuario:</span>{' '}
                    <span className="font-mono">{club.username}</span>
                  </button>
                  {club.passwordRecovery ? (
                    <button
                      type="button"
                      onClick={() => copy(club.passwordRecovery!, 'Contraseña')}
                      className="inline-flex items-center gap-1 hover:text-black"
                      title="Copiar contraseña"
                    >
                      <span className="font-bold text-black/55">Pass:</span>{' '}
                      <span className="font-mono">{club.passwordRecovery}</span>
                    </button>
                  ) : (
                    <span className="italic text-black/40">
                      contraseña: regenerá para verla
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setRenamingClub(club)}
                  title="Renombrar"
                  className="p-2 text-black/55 hover:text-black hover:bg-black/5 rounded-sm transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const fresh = await api.clubs.regenerateCredentials(club.id);
                      setClubs((prev) => prev.map((c) => (c.id === club.id ? fresh : c)));
                      toast.success('Contraseña regenerada');
                    } catch (err) {
                      toast.error(getErrorMessage(err, 'No se pudo regenerar'));
                    }
                  }}
                  title="Regenerar contraseña"
                  className="p-2 text-spk-red hover:bg-spk-red/10 rounded-sm transition-colors"
                >
                  <KeyRound className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(club)}
                  title="Borrar club (los equipos quedan sin club)"
                  className="p-2 text-black/40 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detectOpen && (
        <DetectClubsModal
          onClose={() => setDetectOpen(false)}
          onDone={async () => {
            setDetectOpen(false);
            await reload();
          }}
        />
      )}

      {renamingClub && (
        <RenameClubModal
          club={renamingClub}
          onClose={() => setRenamingClub(null)}
          onSaved={(updated) => {
            setClubs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setRenamingClub(null);
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="¿Borrar club?"
        description={
          pendingDelete
            ? `Vas a borrar el club "${pendingDelete.name}". Sus ${
                pendingDelete.teamsCount ?? 0
              } equipo(s) sobreviven (solo se desvinculan). Las credenciales individuales de capitán quedan intactas. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (!pendingDelete) return;
          await api.clubs.deleteClub(pendingDelete.id);
          setClubs((prev) => prev.filter((c) => c.id !== pendingDelete.id));
          setPendingDelete(null);
          toast.success('Club borrado');
        }}
      />
    </div>
  );
}

interface DetectClubsModalProps {
  onClose: () => void;
  onDone: () => void;
}

function DetectClubsModal({ onClose, onDone }: DetectClubsModalProps) {
  const [clusters, setClusters] = useState<DetectedCluster[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-cluster name override + skip flag. Map keyed by cluster.key.
  const [overrides, setOverrides] = useState<Map<string, { name: string; skip: boolean }>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.clubs.detect();
        setClusters(data);
        setOverrides(
          new Map(data.map((c) => [c.key, { name: c.proposedName, skip: false }])),
        );
      } catch (err) {
        toast.error(getErrorMessage(err, 'No se pudo detectar clubs'));
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateName = (key: string, name: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, { ...(next.get(key) ?? { name, skip: false }), name });
      return next;
    });
  };
  const toggleSkip = (key: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const cur = next.get(key) ?? { name: '', skip: false };
      next.set(key, { ...cur, skip: !cur.skip });
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = clusters
        .map((c) => {
          const o = overrides.get(c.key) ?? { name: c.proposedName, skip: false };
          return { key: c.key, name: o.name.trim() || c.proposedName, skip: o.skip };
        })
        .filter((c) => !c.skip)
        .map(({ key, name }) => ({ key, name }));
      if (payload.length === 0) {
        toast.error('Marcá al menos un club para crear');
        setSubmitting(false);
        return;
      }
      const created = await api.clubs.bulkCreate(payload);
      toast.success(`${created.length} club(s) creado(s)`);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al crear clubs'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-0" onClick={onClose}>
      <div
        className="bg-white rounded-sm shadow-xl w-full max-w-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-black/10">
          <h2 className="text-xl font-bold" style={FONT}>
            CLUBS DETECTADOS
          </h2>
          <p className="text-xs text-black/55 mt-1">
            Agrupados por la primera palabra del nombre de cada equipo. Editá el
            nombre del club si querés (ej: &ldquo;spike&rdquo; → &ldquo;Spike Cup VC&rdquo;) o desmarcá
            los que no son clubs reales.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {loading ? (
            <div className="text-sm text-black/50 italic py-8 text-center">
              Detectando…
            </div>
          ) : clusters.length === 0 ? (
            <div className="text-center py-8 text-sm text-black/55">
              No hay equipos sin club asignado, o todos son únicos por primera
              palabra (no se detectaron grupos de 2+).
            </div>
          ) : (
            <div className="space-y-2">
              {clusters.map((c) => {
                const o = overrides.get(c.key) ?? { name: c.proposedName, skip: false };
                return (
                  <div
                    key={c.key}
                    className={`border rounded-sm p-3 transition-opacity ${
                      o.skip ? 'opacity-40 bg-black/[0.02]' : 'bg-white border-black/10'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <input
                        type="checkbox"
                        checked={!o.skip}
                        onChange={() => toggleSkip(c.key)}
                        className="w-4 h-4 accent-spk-red"
                        aria-label="Crear este club"
                      />
                      <input
                        type="text"
                        value={o.name}
                        onChange={(e) => updateName(c.key, e.target.value)}
                        disabled={o.skip}
                        className="flex-1 min-w-[160px] px-2 py-1 text-sm font-bold bg-white border border-black/15 rounded-sm focus:outline-none focus:border-spk-red disabled:bg-black/[0.02]"
                        style={FONT}
                      />
                      <span className="text-xs font-bold text-black/55 tabular-nums">
                        {c.teamIds.length} equipos
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-black/50 pl-7">
                      {c.sampleTeamNames.join(', ')}
                      {c.teamIds.length > c.sampleTeamNames.length && '…'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-black/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-sm font-bold text-black/70 hover:bg-black/5 rounded-sm"
            style={FONT}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || clusters.length === 0}
            className="px-3 py-2 text-sm font-bold bg-spk-red text-white rounded-sm hover:bg-spk-red-dark disabled:opacity-40"
            style={FONT}
          >
            {submitting ? 'Creando…' : 'Crear seleccionados'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenameClubModalProps {
  club: Club;
  onClose: () => void;
  onSaved: (club: Club) => void;
}

function RenameClubModal({ club, onClose, onSaved }: RenameClubModalProps) {
  const [name, setName] = useState(club.name);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await api.clubs.rename(club.id, name.trim());
      onSaved(updated);
      toast.success('Club renombrado');
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo renombrar'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-0" onClick={onClose}>
      <div
        className="bg-white rounded-sm shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-3" style={FONT}>
          RENOMBRAR CLUB
        </h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 text-base bg-white border-2 border-black/15 rounded-sm focus:outline-none focus:border-spk-red"
        />
        <p className="text-[11px] text-black/50 mt-2">
          Cambia solo el nombre visible — el usuario y la contraseña no
          rotan. Los equipos asociados siguen vinculados.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm font-bold text-black/70 hover:bg-black/5 rounded-sm"
            style={FONT}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim()}
            className="px-3 py-2 text-sm font-bold bg-spk-red text-white rounded-sm hover:bg-spk-red-dark disabled:opacity-40 inline-flex items-center gap-1"
            style={FONT}
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
