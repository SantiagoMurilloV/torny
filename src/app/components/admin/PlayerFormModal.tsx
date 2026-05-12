import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload, FileText, User } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Player } from '../../types';
import { ApiError, api, type CreatePlayerDto, type UpdatePlayerDto } from '../../services/api';
import { CATEGORIES, withCurrentCategories } from '../../lib/categories';
import { getErrorMessage } from '../../lib/errors';

interface PlayerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful save. Gives the caller the saved Player so it can update its local list. */
  onSaved: (player: Player) => void;
  teamId: string;
  /** If set, the modal edits this player. Otherwise it creates a new one. */
  player?: Player;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  documentNumber?: string;
  shirtNumber?: string;
  emergencyContactPhone?: string;
  server?: string;
}

/** Supported document types. Keep in sync with validateCommon() on the backend. */
const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Sin documento' },
  { value: 'TI', label: 'TI — Tarjeta de Identidad' },
  { value: 'CC', label: 'CC — Cédula de Ciudadanía' },
  { value: 'CE', label: 'CE — Cédula de Extranjería' },
  { value: 'RC', label: 'RC — Registro Civil' },
  { value: 'PA', label: 'PA — Pasaporte' },
];

const POSITIONS: string[] = [
  'Punta',
  'Opuesto',
  'Central',
  'Armadora',
  'Líbero',
];

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

const RELATIONSHIP_OPTIONS = [
  '',
  'Mamá',
  'Papá',
  'Abuelo/a',
  'Tío/a',
  'Hermano/a',
  'Tutor/a legal',
  'Otro',
];

type FormState = {
  firstName: string;
  lastName: string;
  birthDate: string;
  documentType: string;
  documentNumber: string;
  category: string;
  position: string;
  shirtNumber: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

function emptyState(): FormState {
  return {
    firstName: '',
    lastName: '',
    birthDate: '',
    documentType: '',
    documentNumber: '',
    category: '',
    position: '',
    shirtNumber: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  };
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.firstName.trim()) errors.firstName = 'El nombre es obligatorio';
  if (!form.lastName.trim()) errors.lastName = 'El apellido es obligatorio';
  if (form.birthDate.trim()) {
    const iso = form.birthDate;
    const today = TODAY_ISO();
    if (iso > today) errors.birthDate = 'No puede ser futura';
    else if (iso < '1900-01-01') errors.birthDate = 'Fecha inválida';
  }
  if (form.shirtNumber.trim()) {
    const n = Number(form.shirtNumber);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      errors.shirtNumber = 'Número entre 0 y 99';
    }
  }
  if (form.emergencyContactPhone && form.emergencyContactPhone.length > 40) {
    errors.emergencyContactPhone = 'Demasiado largo';
  }
  return errors;
}

export function PlayerFormModal({ isOpen, onClose, onSaved, teamId, player }: PlayerFormModalProps) {
  const categoryOptions = withCurrentCategories(
    CATEGORIES,
    player?.category ? [player.category] : [],
  );
  const [form, setForm] = useState<FormState>(emptyState());
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  /** Name shown in the document row — either the freshly picked file name or the persisted flag "documento.pdf". */
  const [documentLabel, setDocumentLabel] = useState<string | null>(null);
  /** True when the persisted player already has a PDF stored. */
  const [hasExistingDocument, setHasExistingDocument] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSubmitting(false);
    if (player) {
      setForm({
        firstName: player.firstName,
        lastName: player.lastName,
        birthDate: player.birthDate ?? '',
        documentType: player.documentType ?? '',
        documentNumber: player.documentNumber ?? '',
        category: player.category ?? '',
        position: player.position ?? '',
        shirtNumber: player.shirtNumber != null ? String(player.shirtNumber) : '',
        emergencyContactName: player.emergencyContactName ?? '',
        emergencyContactPhone: player.emergencyContactPhone ?? '',
        emergencyContactRelationship: player.emergencyContactRelationship ?? '',
      });
      setPhotoPreview(player.photo ?? null);
      setHasExistingDocument(Boolean(player.documentFile));
      setDocumentLabel(player.documentFile ? 'Documento cargado' : null);
    } else {
      setForm(emptyState());
      setPhotoPreview(null);
      setHasExistingDocument(false);
      setDocumentLabel(null);
    }
    setPhotoFile(null);
    setDocumentFile(null);
  }, [isOpen, player]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('La foto no puede superar 10MB');
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('El PDF no puede superar 10MB');
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('El archivo debe ser PDF');
      return;
    }
    setDocumentFile(file);
    setDocumentLabel(file.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      // 1) Upload photo if changed
      let photoUrl = player?.photo;
      if (photoFile) {
        try {
          photoUrl = await api.uploadLogo(photoFile);
        } catch {
          toast.error('Error al subir la foto');
          setSubmitting(false);
          return;
        }
      }

      // 2) Upload document if changed
      let documentUrl = player?.documentFile;
      if (documentFile) {
        try {
          documentUrl = await api.uploadDocument(documentFile);
        } catch {
          toast.error('Error al subir el documento');
          setSubmitting(false);
          return;
        }
      }

      // 3) Build DTO. For updates we send undefined for fields the backend
      // should leave alone, and empty-string→null for cleared optionals.
      const basePayload: CreatePlayerDto = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: form.birthDate.trim() || undefined,
        documentType: form.documentType || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        category: form.category || undefined,
        position: form.position || undefined,
        shirtNumber: form.shirtNumber.trim() ? Number(form.shirtNumber) : undefined,
        photo: photoUrl,
        documentFile: documentUrl,
        emergencyContactName: form.emergencyContactName.trim() || undefined,
        emergencyContactPhone: form.emergencyContactPhone.trim() || undefined,
        emergencyContactRelationship:
          form.emergencyContactRelationship.trim() || undefined,
      };

      const saved = player
        ? await api.updatePlayer(teamId, player.id, basePayload as UpdatePlayerDto)
        : await api.createPlayer(teamId, basePayload);

      onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrors({ server: err.message });
      } else {
        toast.error(getErrorMessage(err, 'Error al guardar jugador@'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (field: keyof FieldErrors) =>
    `w-full px-4 py-2 border-2 rounded-sm focus:outline-none ${
      errors[field]
        ? 'border-red-500 focus:border-red-500'
        : 'border-black/10 focus:border-spk-red'
    }`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-sm shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto my-4"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 sm:px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-lg sm:text-xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            {player ? 'EDITAR JUGADOR@' : 'AGREGAR JUGADOR@'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-sm transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6" noValidate>
          {errors.server && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
              {errors.server}
            </div>
          )}

          {/* Photo picker */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative group">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Foto jugador@"
                  className="w-24 h-24 rounded-sm object-cover border-4 border-black/10"
                />
              ) : (
                <div className="w-24 h-24 rounded-sm flex items-center justify-center bg-black/5 text-black/40 border-4 border-black/10">
                  <User className="w-10 h-10" aria-hidden="true" />
                </div>
              )}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity rounded-sm"
                aria-label="Subir foto"
              >
                <Upload className="w-6 h-6 text-white" />
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
            </div>
            <p className="text-xs text-black/40 text-center">
              Foto opcional (máx 10MB)
            </p>
          </div>

          {/* First + Last name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Nombre *
              </label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => { setForm({ ...form, firstName: e.target.value }); setErrors((prev) => ({ ...prev, firstName: undefined, server: undefined })); }}
                className={inputClass('firstName')}
                placeholder="Ej: Laura"
              />
              {errors.firstName && <p className="mt-1 text-sm text-red-500">{errors.firstName}</p>}
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Apellido *
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => { setForm({ ...form, lastName: e.target.value }); setErrors((prev) => ({ ...prev, lastName: undefined, server: undefined })); }}
                className={inputClass('lastName')}
                placeholder="Ej: Gómez"
              />
              {errors.lastName && <p className="mt-1 text-sm text-red-500">{errors.lastName}</p>}
            </div>
          </div>

          {/* Birth date + shirt number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Fecha de nacimiento
              </label>
              <input
                type="date"
                value={form.birthDate}
                max={TODAY_ISO()}
                onChange={(e) => { setForm({ ...form, birthDate: e.target.value }); setErrors((prev) => ({ ...prev, birthDate: undefined, server: undefined })); }}
                className={inputClass('birthDate')}
              />
              {errors.birthDate && <p className="mt-1 text-sm text-red-500">{errors.birthDate}</p>}
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                # Camiseta
              </label>
              <input
                type="number"
                value={form.shirtNumber}
                onChange={(e) => { setForm({ ...form, shirtNumber: e.target.value }); setErrors((prev) => ({ ...prev, shirtNumber: undefined, server: undefined })); }}
                className={inputClass('shirtNumber')}
                placeholder="0–99"
                min={0}
                max={99}
              />
              {errors.shirtNumber && <p className="mt-1 text-sm text-red-500">{errors.shirtNumber}</p>}
            </div>
          </div>

          {/* Document type + number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Tipo de documento
              </label>
              <select
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
              >
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d.value || 'none'} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Número de documento
              </label>
              <input
                type="text"
                value={form.documentNumber}
                onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                placeholder="Ej: 1001234567"
              />
            </div>
          </div>

          {/* Category + position */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Categoría
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
              >
                <option value="">Sin categoría</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Posición
              </label>
              <select
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
              >
                <option value="">Sin posición</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Emergency contact — single contact (mig 029). Same fields the
              public parent form captures, surfaced here so the admin /
              captain can back-fill old rosters by hand. */}
          <div className="space-y-3 pt-2 border-t border-black/10">
            <h3
              className="text-xs font-bold uppercase text-black/55"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.08em' }}
            >
              Contacto de emergencia
            </h3>
            <div>
              <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Nombre completo
              </label>
              <input
                type="text"
                value={form.emergencyContactName}
                onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red"
                placeholder="Ej: María Pérez"
              />
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div>
                <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  Teléfono
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.emergencyContactPhone}
                  onChange={(e) => { setForm({ ...form, emergencyContactPhone: e.target.value }); setErrors((prev) => ({ ...prev, emergencyContactPhone: undefined, server: undefined })); }}
                  className={inputClass('emergencyContactPhone')}
                  placeholder="+57 300 000 0000"
                />
                {errors.emergencyContactPhone && <p className="mt-1 text-sm text-red-500">{errors.emergencyContactPhone}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  Relación
                </label>
                <select
                  value={form.emergencyContactRelationship}
                  onChange={(e) => setForm({ ...form, emergencyContactRelationship: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red bg-white"
                >
                  {RELATIONSHIP_OPTIONS.map((r) => (
                    <option key={r || 'none'} value={r}>
                      {r || '—'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Document file (PDF) */}
          <div>
            <label className="block text-sm font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Documento (PDF)
            </label>
            <button
              type="button"
              onClick={() => documentInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-black/20 rounded-sm hover:border-spk-red hover:bg-spk-red/5 transition-colors text-left"
            >
              <FileText className="w-5 h-5 text-black/60 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {documentLabel ?? 'Subir PDF'}
                </div>
                <div className="text-xs text-black/50">
                  {documentFile
                    ? 'Listo para guardar'
                    : hasExistingDocument
                      ? 'Toca para reemplazar (máx 10MB)'
                      : 'Opcional · máx 10MB'}
                </div>
              </div>
              <Upload className="w-4 h-4 text-black/40 flex-shrink-0" />
            </button>
            <input
              ref={documentInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleDocumentSelect}
              className="hidden"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 sm:flex-none px-4 py-3 bg-black/5 hover:bg-black/10 font-bold rounded-sm transition-colors disabled:opacity-50"
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
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {player ? 'Guardar Cambios' : 'Agregar Jugador@'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
