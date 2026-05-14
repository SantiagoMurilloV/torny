import { useEffect, useState } from 'react';
import { X, Loader2, Plus, UserPlus, Zap, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  api,
  ApiError,
  type CreatePlatformUserDto,
  type PlatformUser,
} from '../../services/api';
import { generatePassword } from '../../lib/passwordGen';
import { isAdmin, isJudge } from '../../lib/roles';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called after a successful create. `newPassword` holds the plaintext
   * that was just assigned so the caller can show it in the receipt modal.
   */
  onCreated: (args: { newPassword: string }) => void | Promise<void>;
  /** Admin options shown in the "Admin dueño del juez" dropdown when role=judge. */
  admins: PlatformUser[];
}

/**
 * Create-user modal. The password can either be typed or generated on
 * the spot; either way the plaintext is handed back to the parent so
 * it can surface a show-once receipt with a copy button.
 */
export function CreateUserModal({ isOpen, onClose, onCreated, admins }: CreateUserModalProps) {
  const [form, setForm] = useState<CreatePlatformUserDto>({
    username: '',
    password: '',
    role: 'admin',
    displayName: '',
    tournamentQuota: 1,
    createdBy: null,
    adminNote: '',
  });
  const [showPasswordValue, setShowPasswordValue] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({
        username: '',
        password: '',
        role: 'admin',
        displayName: '',
        tournamentQuota: 1,
        createdBy: null,
        adminNote: '',
      });
      setShowPasswordValue(false);
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleGenerate = () => {
    setForm((f) => ({ ...f, password: generatePassword() }));
    setShowPasswordValue(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const dto: CreatePlatformUserDto = {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        displayName: form.displayName?.trim() || undefined,
        tournamentQuota:
          isAdmin(form.role) ? Number(form.tournamentQuota ?? 1) : undefined,
        createdBy: isJudge(form.role) ? form.createdBy ?? null : null,
        adminNote: form.adminNote?.trim() || null,
      };
      await api.createPlatformUser(dto);
      toast.success(`Usuario ${dto.username} creado`);
      await onCreated({ newPassword: dto.password });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-sm shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto my-4"
        role="dialog"
        aria-labelledby="create-user-title"
      >
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-spk-red" aria-hidden="true" />
            <h2
              id="create-user-title"
              className="text-lg sm:text-xl font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              CREAR USUARIO
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 hover:bg-black/5 rounded-sm transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5" noValidate>
          <Field label="Usuario *">
            <input
              type="text"
              required
              autoFocus
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="Ej: juan.perez"
              autoComplete="off"
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
            />
          </Field>

          <Field label="Contraseña *">
            <div className="flex items-stretch gap-2">
              <div className="flex-1 relative">
                <input
                  type={showPasswordValue ? 'text' : 'password'}
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Mín 8 chars, con letra y número"
                  autoComplete="new-password"
                  className="w-full px-4 py-2 pr-10 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordValue((v) => !v)}
                  aria-label={showPasswordValue ? 'Ocultar' : 'Mostrar'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-black/40 hover:text-black"
                >
                  {showPasswordValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                className="px-3 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm text-xs font-bold uppercase whitespace-nowrap inline-flex items-center gap-1"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                Generar
              </button>
            </div>
          </Field>

          <Field label="Nombre visible">
            <input
              type="text"
              value={form.displayName ?? ''}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Opcional"
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
            />
          </Field>

          <Field label="Rol *">
            <select
              value={form.role}
              onChange={(e) =>
                setForm({
                  ...form,
                  role: e.target.value as CreatePlatformUserDto['role'],
                })
              }
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
            >
              <option value="admin">Administrador de torneos</option>
              <option value="judge">Juez</option>
              <option value="super_admin">Super administrador</option>
            </select>
          </Field>

          {isAdmin(form.role) && (
            <Field label="Cupo de torneos">
              <input
                type="number"
                min={0}
                value={form.tournamentQuota ?? 1}
                onChange={(e) =>
                  setForm({ ...form, tournamentQuota: Number(e.target.value) })
                }
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
              />
            </Field>
          )}

          {isJudge(form.role) && (
            <Field label="Admin dueño del juez">
              <select
                value={form.createdBy ?? ''}
                onChange={(e) =>
                  setForm({ ...form, createdBy: e.target.value || null })
                }
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
              >
                <option value="">Sin admin (plataforma)</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Nota privada (solo vos la ves)">
            <textarea
              value={form.adminNote ?? ''}
              onChange={(e) => setForm({ ...form, adminNote: e.target.value })}
              placeholder='Ej: "cliente del torneo X, usa su año de nacimiento"'
              rows={2}
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red resize-y"
            />
            <p className="mt-1 text-xs text-black/50">
              Memoria personal. No es la contraseña.
            </p>
          </Field>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="sm:flex-none px-4 py-3 bg-black/5 hover:bg-black/10 font-bold rounded-sm transition-colors disabled:opacity-50"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-3 bg-spk-red text-white hover:bg-spk-red-dark font-bold rounded-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Crear usuario
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-bold uppercase tracking-wider mb-1.5"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
