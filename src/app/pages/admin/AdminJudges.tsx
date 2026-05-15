import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, UserCog, Key, Pencil, MapPin, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Judge } from '../../services/api';
import type { Tournament } from '../../types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../lib/errors';

/**
 * AdminJudges — admin-only CRUD for "juez" accounts.
 *
 * Features:
 *  · Crear juez con nombre, usuario, contraseña + asignación de torneo/cancha opcional.
 *  · Lista muestra usuario y contraseña siempre visible (cuando PLATFORM_RECOVERY_KEY está activo).
 *  · Modal de edición para cambiar la asignación de cancha.
 *  · Reset de contraseña actualiza la contraseña en la lista al instante.
 */
export function AdminJudges() {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Passwords visibility toggle (per-judge)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // ── Create ──────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newShowPassword, setNewShowPassword] = useState(true);
  // Tournament + court for creation
  const [createTournaments, setCreateTournaments] = useState<Tournament[]>([]);
  const [createLoadingTournaments, setCreateLoadingTournaments] = useState(false);
  const [newTournamentId, setNewTournamentId] = useState('');
  const [newCourt, setNewCourt] = useState('');

  // ── Delete ──────────────────────────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Reset password ───────────────────────────────────────────────────────
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetShowPassword, setResetShowPassword] = useState(true);
  const [resetting, setResetting] = useState(false);

  // ── Edit / court assignment ──────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<Judge | null>(null);
  const [editTournamentId, setEditTournamentId] = useState('');
  const [editCourt, setEditCourt] = useState('');
  const [editTournaments, setEditTournaments] = useState<Tournament[]>([]);
  const [editLoadingTournaments, setEditLoadingTournaments] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await api.listJudges();
      setJudges(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Error al cargar jueces'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resetCreateForm = () => {
    setNewUsername('');
    setNewDisplayName('');
    setNewPassword('');
    setNewTournamentId('');
    setNewCourt('');
  };

  // ── Open create modal ─────────────────────────────────────────────────────
  const openCreate = async () => {
    setShowCreate(true);
    setCreateLoadingTournaments(true);
    try {
      const tournaments = await api.getTournaments();
      setCreateTournaments(tournaments);
    } catch {
      // Non-fatal — torneo/cancha are optional at creation
    } finally {
      setCreateLoadingTournaments(false);
    }
  };

  // ── Create handler ─────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await api.createJudge({
        username: newUsername.trim(),
        password: newPassword,
        displayName: newDisplayName.trim() || undefined,
        assignedTournamentId: newTournamentId || null,
        assignedCourt: newCourt || null,
      });
      toast.success('Juez creado');
      setShowCreate(false);
      resetCreateForm();
      // Prepend new judge so it appears at top; show password immediately
      setJudges((prev) => [created, ...prev]);
      setVisiblePasswords((prev) => ({ ...prev, [created.id]: true }));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al crear juez'));
    } finally {
      setCreating(false);
    }
  };

  // ── Delete handler ─────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setDeletingId(id);
    try {
      await api.deleteJudge(id);
      toast.success('Juez eliminado');
      setPendingDeleteId(null);
      setJudges((prev) => prev.filter((j) => j.id !== id));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al eliminar juez'));
      throw err;
    } finally {
      setDeletingId(null);
    }
  };

  // ── Reset password handler ────────────────────────────────────────────────
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetId) return;
    setResetting(true);
    try {
      const updated = await api.resetJudgePassword(resetTargetId, resetPassword);
      toast.success('Contraseña actualizada');
      setJudges((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      setVisiblePasswords((prev) => ({ ...prev, [updated.id]: true }));
      setResetTargetId(null);
      setResetPassword('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo cambiar la contraseña'));
    } finally {
      setResetting(false);
    }
  };

  // ── Edit / court assignment handlers ─────────────────────────────────────
  const openEdit = async (judge: Judge) => {
    setEditTarget(judge);
    setEditTournamentId(judge.assignedTournamentId ?? '');
    setEditCourt(judge.assignedCourt ?? '');
    setEditLoadingTournaments(true);
    try {
      const tournaments = await api.getTournaments();
      setEditTournaments(tournaments);
    } catch {
      toast.error('No se pudieron cargar los torneos');
    } finally {
      setEditLoadingTournaments(false);
    }
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditTournamentId('');
    setEditCourt('');
    setEditTournaments([]);
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const updated = await api.updateJudge(editTarget.id, {
        assignedTournamentId: editTournamentId || null,
        assignedCourt: editCourt || null,
      });
      toast.success('Cancha asignada correctamente');
      setJudges((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      closeEdit();
    } catch (err) {
      toast.error(getErrorMessage(err, 'No se pudo guardar la asignación'));
    } finally {
      setEditSaving(false);
    }
  };

  const newAvailableCourts =
    createTournaments.find((t) => t.id === newTournamentId)?.courts ?? [];
  const editAvailableCourts =
    editTournaments.find((t) => t.id === editTournamentId)?.courts ?? [];

  const togglePassword = (id: string) =>
    setVisiblePasswords((prev) => ({ ...prev, [id]: !prev[id] }));

  if (loading && judges.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
      </div>
    );
  }

  if (loadError && judges.length === 0) {
    return (
      <div className="p-6 text-center py-16">
        <p className="text-red-600 mb-4">{loadError}</p>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-spk-red text-white rounded-sm hover:bg-spk-red-dark transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            GESTIÓN DE JUECES
          </h1>
          <p className="text-black/60">
            Crea cuentas para los jueces que van a marcar los partidos en vivo.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          <span
            style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.05em' }}
            className="uppercase font-bold"
          >
            Nuevo Juez
          </span>
        </button>
      </div>

      {/* Empty state */}
      {judges.length === 0 ? (
        <div className="bg-white border-2 border-black/10 rounded-sm text-center py-16 px-4">
          <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserCog className="w-8 h-8 text-black/40" />
          </div>
          <h3
            className="text-lg font-bold mb-2"
            style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
          >
            Aún no hay jueces
          </h3>
          <p className="text-black/60">Creá el primer juez para que pueda marcar partidos en vivo.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border-2 border-black/10 rounded-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-black/5 border-b-2 border-black/10">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    NOMBRE
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    USUARIO
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    CONTRASEÑA
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    CANCHA ASIGNADA
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    ACCIONES
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black/10">
                {judges.map((j) => (
                  <tr key={j.id} className="hover:bg-black/5 transition-colors">
                    <td className="px-6 py-4 font-medium">{j.displayName || '—'}</td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm font-bold">{j.username}</span>
                    </td>
                    <td className="px-6 py-4">
                      <PasswordCell
                        password={j.password}
                        visible={visiblePasswords[j.id] ?? false}
                        onToggle={() => togglePassword(j.id)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      {j.assignedCourt ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-spk-blue">
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                          {j.assignedCourt}
                        </span>
                      ) : (
                        <span className="text-sm text-black/40">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(j)}
                          aria-label={`Asignar cancha a ${j.username}`}
                          title="Asignar cancha"
                          className="p-2 hover:bg-black/10 text-black/60 rounded-sm transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setResetTargetId(j.id); setResetPassword(''); }}
                          aria-label={`Cambiar contraseña de ${j.username}`}
                          title="Cambiar contraseña"
                          className="p-2 hover:bg-spk-blue/10 text-spk-blue rounded-sm transition-colors"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(j.id)}
                          disabled={deletingId === j.id}
                          aria-label={`Eliminar ${j.username}`}
                          className="p-2 hover:bg-spk-red/10 text-spk-red rounded-sm transition-colors disabled:opacity-50"
                        >
                          {deletingId === j.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card grid */}
          <div className="md:hidden space-y-3">
            {judges.map((j) => (
              <div key={j.id} className="bg-white border-2 border-black/10 rounded-sm p-4 space-y-3">
                {/* Top row: avatar + name + actions */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-sm bg-spk-red/10 text-spk-red flex items-center justify-center flex-shrink-0">
                    <UserCog className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold uppercase truncate" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                      {j.displayName || j.username}
                    </div>
                    {j.assignedCourt && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-spk-blue">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {j.assignedCourt}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onClick={() => openEdit(j)} className="p-2 bg-black/5 text-black/60 rounded-sm active:bg-black/10 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => { setResetTargetId(j.id); setResetPassword(''); }} className="p-2 bg-spk-blue/10 text-spk-blue rounded-sm active:bg-spk-blue/20 transition-colors">
                      <Key className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId(j.id)} disabled={deletingId === j.id} className="p-2 bg-spk-red/10 text-spk-red rounded-sm active:bg-spk-red/20 transition-colors disabled:opacity-50">
                      {deletingId === j.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {/* Credentials row */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/10">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-black/40 mb-0.5">Usuario</p>
                    <span className="font-mono text-sm font-bold">{j.username}</span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-black/40 mb-0.5">Contraseña</p>
                    <PasswordCell
                      password={j.password}
                      visible={visiblePasswords[j.id] ?? false}
                      onToggle={() => togglePassword(j.id)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Create modal ────────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-sm shadow-2xl max-w-lg w-full my-4"
          >
            <div className="bg-black text-white px-4 sm:px-6 py-3 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-bold tracking-wider uppercase" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Nuevo Juez
              </h2>
              <button type="button" onClick={() => { setShowCreate(false); resetCreateForm(); }} aria-label="Cerrar" className="p-1 hover:bg-white/10 rounded-sm transition-colors">
                ×
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              {/* Display name */}
              <div>
                <label className="block text-sm font-medium mb-1">Nombre para mostrar</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50"
                />
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm font-medium mb-1">Usuario *</label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="jperez"
                  className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50 font-mono"
                />
                <p className="text-xs text-black/50 mt-1">Letras, números, puntos, guiones o guiones bajos. Mínimo 3 caracteres.</p>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium mb-1">Contraseña *</label>
                <div className="relative">
                  <input
                    type={newShowPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3 py-2 pr-10 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setNewShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black/70 transition-colors"
                    aria-label={newShowPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {newShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-black/50 mt-1">La podés compartir con el juez por WhatsApp. Se guarda encriptada.</p>
              </div>

              {/* Divider */}
              <div className="border-t border-black/10 pt-4">
                <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">Asignación de cancha (opcional)</p>

                {/* Tournament selector */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Torneo</label>
                    {createLoadingTournaments ? (
                      <div className="flex items-center gap-2 text-sm text-black/50 py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cargando torneos…
                      </div>
                    ) : (
                      <select
                        value={newTournamentId}
                        onChange={(e) => { setNewTournamentId(e.target.value); setNewCourt(''); }}
                        className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50"
                      >
                        <option value="">Sin asignar</option>
                        {createTournaments.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Court selector */}
                  {newTournamentId && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Cancha</label>
                      {newAvailableCourts.length === 0 ? (
                        <p className="text-sm text-black/50 py-1">Este torneo no tiene canchas configuradas.</p>
                      ) : (
                        <select
                          value={newCourt}
                          onChange={(e) => setNewCourt(e.target.value)}
                          className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50"
                        >
                          <option value="">Elegir cancha…</option>
                          {newAvailableCourts.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 p-4 sm:p-6 border-t-2 border-black/10">
              <button
                type="button"
                onClick={() => { setShowCreate(false); resetCreateForm(); }}
                className="flex-1 px-4 py-2 bg-black/5 hover:bg-black/10 rounded-sm transition-colors font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 px-4 py-2 bg-spk-red hover:bg-spk-red-dark text-white rounded-sm transition-colors font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Crear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Edit / court assignment modal ────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleEditSave}
            className="bg-white rounded-sm shadow-2xl max-w-lg w-full my-4"
          >
            <div className="bg-black text-white px-4 sm:px-6 py-3 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-bold tracking-wider uppercase" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Asignar Cancha
              </h2>
              <button type="button" onClick={closeEdit} aria-label="Cerrar" className="p-1 hover:bg-white/10 rounded-sm transition-colors">×</button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <p className="text-sm text-black/60">
                Juez: <span className="font-semibold text-black">{editTarget.displayName || editTarget.username}</span>
              </p>
              <p className="text-sm text-black/60">
                El juez solo verá la programación y los partidos en vivo de la cancha asignada.
                Elegí "Sin asignar" para quitarle la restricción.
              </p>

              <div>
                <label className="block text-sm font-medium mb-1">Torneo</label>
                {editLoadingTournaments ? (
                  <div className="flex items-center gap-2 text-sm text-black/50 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cargando torneos…
                  </div>
                ) : (
                  <select
                    value={editTournamentId}
                    onChange={(e) => { setEditTournamentId(e.target.value); setEditCourt(''); }}
                    className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50"
                  >
                    <option value="">Sin asignar</option>
                    {editTournaments.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {editTournamentId && (
                <div>
                  <label className="block text-sm font-medium mb-1">Cancha *</label>
                  {editAvailableCourts.length === 0 ? (
                    <p className="text-sm text-black/50 py-1">Este torneo no tiene canchas configuradas.</p>
                  ) : (
                    <select
                      value={editCourt}
                      onChange={(e) => setEditCourt(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50"
                    >
                      <option value="">Elegir cancha…</option>
                      {editAvailableCourts.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 p-4 sm:p-6 border-t-2 border-black/10">
              <button type="button" onClick={closeEdit} className="flex-1 px-4 py-2 bg-black/5 hover:bg-black/10 rounded-sm transition-colors font-medium">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={editSaving || (!!editTournamentId && !editCourt)}
                className="flex-1 px-4 py-2 bg-spk-red hover:bg-spk-red-dark text-white rounded-sm transition-colors font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Reset password modal ─────────────────────────────────────────── */}
      {resetTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
          <form onSubmit={handleReset} className="bg-white rounded-sm shadow-2xl max-w-md w-full">
            <div className="bg-black text-white px-4 sm:px-6 py-3">
              <h2 className="text-lg sm:text-xl font-bold tracking-wider uppercase" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Cambiar Contraseña
              </h2>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nueva contraseña</label>
                <div className="relative">
                  <input
                    type={resetShowPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3 py-2 pr-10 bg-white border-2 border-black/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-spk-red/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setResetShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black/70 transition-colors"
                    aria-label={resetShowPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {resetShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 p-4 sm:p-6 border-t-2 border-black/10">
              <button
                type="button"
                onClick={() => { setResetTargetId(null); setResetPassword(''); }}
                className="flex-1 px-4 py-2 bg-black/5 hover:bg-black/10 rounded-sm transition-colors font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="flex-1 px-4 py-2 bg-spk-red hover:bg-spk-red-dark text-white rounded-sm transition-colors font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {resetting && <Loader2 className="w-4 h-4 animate-spin" />}
                Actualizar
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title="Eliminar juez"
        description="¿Seguro que querés eliminar este juez? No podrá volver a iniciar sesión. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deletingId !== null}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PasswordCell({
  password,
  visible,
  onToggle,
}: {
  password?: string | null;
  visible: boolean;
  onToggle: () => void;
}) {
  if (!password) {
    return <span className="text-sm text-black/30 italic">no disponible</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-sm font-bold">
        {visible ? password : '••••••••'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="p-1 text-black/40 hover:text-black/70 transition-colors flex-shrink-0"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
