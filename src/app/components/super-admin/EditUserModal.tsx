import { useEffect, useState } from 'react';
import { X, Loader2, Check, Pencil, Zap, Eye, EyeOff, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  api,
  ApiError,
  type PlatformUser,
  type UpdatePlatformUserDto,
} from '../../services/api';
import { generatePassword } from '../../lib/passwordGen';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called after a successful update. If a password was set during this
   * save, `newPassword` holds the plaintext so the caller can open a
   * show-once confirmation modal with it. Otherwise it's null.
   */
  onSaved: (args: { newPassword: string | null }) => void | Promise<void>;
  user: PlatformUser | null;
}

/**
 * Edit an existing user's identity + credentials.
 *
 * The password field starts "locked": it displays a fake masked
 * placeholder so the super_admin sees there's a password on file,
 * but the real value is impossible to retrieve (bcrypt, one-way).
 * Clicking Reemplazar unlocks the field — they can either type one
 * manually or hit Generar for a random readable one.
 *
 * On save, if a new password was set we pass it back to the parent
 * so it can show the NewPasswordModal receipt.
 */
export function EditUserModal({ isOpen, onClose, onSaved, user }: EditUserModalProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [newPassword, setNewPassword] = useState('');
  /** Password value we pre-loaded from the backend (if recovery is on).
   *  Used to detect whether the super_admin actually changed it — we only
   *  POST a new password when the field differs from what was fetched. */
  const [loadedPassword, setLoadedPassword] = useState('');
  /** When `false` the password input shows a locked placeholder and
   *  disables editing — matches the "not retrievable" reality but
   *  still gives a clear "click to replace" affordance. */
  const [passwordUnlocked, setPasswordUnlocked] = useState(false);
  const [showPasswordValue, setShowPasswordValue] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!(isOpen && user)) return;
    setUsername(user.username);
    setDisplayName(user.displayName ?? '');
    setAdminNote(user.adminNote ?? '');
    setNewPassword('');
    setLoadedPassword('');
    setPasswordUnlocked(false);
    setShowPasswordValue(false);
    setSubmitting(false);

    // Try to pre-fetch the current password. If the recovery feature is
    // disabled (no env key) OR this user's row has no ciphertext yet
    // (legacy, pre-feature) we silently fall back to the locked •••••• view.
    let cancelled = false;
    api
      .revealUserPassword(user.id)
      .then((r) => {
        if (cancelled) return;
        if (r.enabled && r.password) {
          setNewPassword(r.password);
          setLoadedPassword(r.password);
          setPasswordUnlocked(true);
          setShowPasswordValue(false); // start masked; super_admin clicks 👁 to peek
        }
      })
      .catch(() => {
        // ignore — the modal keeps working in "reset only" mode
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user]);

  const handleGenerate = () => {
    setNewPassword(generatePassword());
    setPasswordUnlocked(true);
    // Show the generated value so the super_admin can verify / memorize
    // before they hit Guardar. The post-save receipt repeats it anyway.
    setShowPasswordValue(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    try {
      const dto: UpdatePlatformUserDto = {};
      const trimmedUsername = username.trim();
      const trimmedDisplay = displayName.trim();
      const trimmedNote = adminNote.trim();
      if (trimmedUsername !== user.username) dto.username = trimmedUsername;
      if (trimmedDisplay !== (user.displayName ?? '')) {
        dto.displayName = trimmedDisplay;
      }
      if (trimmedNote !== (user.adminNote ?? '')) {
        dto.adminNote = trimmedNote;
      }
      // Only send a new password if the field was actually edited. If we
      // pre-loaded the current password from the recovery endpoint and
      // the super_admin didn't change it, we skip the update to avoid
      // rehashing the same value.
      const pwChanged =
        passwordUnlocked &&
        newPassword.trim().length > 0 &&
        newPassword !== loadedPassword;
      if (pwChanged) dto.password = newPassword;

      if (Object.keys(dto).length === 0) {
        toast.info('No hay cambios para guardar');
        onClose();
        return;
      }

      await api.updatePlatformUser(user.id, dto);
      toast.success('Usuario actualizado');
      await onSaved({
        newPassword: pwChanged ? newPassword : null,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-sm shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto my-4"
        role="dialog"
        aria-labelledby="edit-user-title"
      >
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-spk-blue" aria-hidden="true" />
            <h2
              id="edit-user-title"
              className="text-lg sm:text-xl font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              EDITAR USUARIO
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
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
            />
          </Field>

          <Field label="Nombre visible">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Opcional"
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
            />
          </Field>

          {/* Password — locked by default, replaceable via button */}
          <Field label="Contraseña">
            {!passwordUnlocked ? (
              <div className="flex items-stretch gap-2">
                <div className="flex-1 px-4 py-2 border-2 border-black/10 bg-black/[0.03] rounded-sm flex items-center gap-2 text-black/50">
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span className="font-mono tracking-[0.3em] select-none">••••••••</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPasswordUnlocked(true)}
                  className="px-3 py-2 bg-black/5 hover:bg-black/10 rounded-sm text-xs font-bold uppercase whitespace-nowrap"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
                >
                  Reemplazar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showPasswordValue ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Mín 8 chars, con letra y número"
                      autoComplete="new-password"
                      className="w-full px-4 py-2 pr-10 border-2 border-spk-red/40 rounded-sm focus:outline-none focus:border-spk-red font-mono"
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
                <button
                  type="button"
                  onClick={() => {
                    setPasswordUnlocked(false);
                    setNewPassword('');
                    setShowPasswordValue(false);
                  }}
                  className="text-xs text-black/50 hover:text-black/80 underline"
                >
                  Cancelar cambio de contraseña
                </button>
              </div>
            )}
          </Field>

          {/* Super_admin's private note */}
          <Field label="Nota privada (solo vos la ves)">
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder='Ej: "cliente del torneo X, contraseña basada en su año"'
              rows={2}
              className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red resize-y"
            />
            <p className="mt-1 text-xs text-black/50">
              Memoria personal. No es la contraseña — es solo texto para que
              te acuerdes qué usaste. Nunca se muestra a nadie más.
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
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Guardar cambios
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
