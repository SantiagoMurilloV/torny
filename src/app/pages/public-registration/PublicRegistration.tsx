import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — canvas-confetti ships no types
import confetti from 'canvas-confetti';
import {
  Loader2,
  User,
  Upload,
  FileText,
  PartyPopper,
  Lock,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { motion } from 'motion/react';
import { api } from '../../services/api';
import type {
  PublicTournamentView,
  PublicTeamSummary,
} from '../../services/api/publicRegistration';
import { compressLogoImage } from '../../lib/compressImage';
import { fileToDataUrl } from '../../lib/fileToDataUrl';
import { getErrorMessage } from '../../lib/errors';

/**
 * `/torneo/:slug/inscripcion` — public parent (acudiente) form. Lives
 * OUTSIDE the auth shell so anybody with the URL can fill it in. The
 * URL is per-tournament: closes automatically the day the torneo
 * starts (00:00 of `tournament.startDate`).
 *
 * Flow:
 *   1. GET /api/public/tournaments/:slug → tournament + clubs+teams
 *   2. Form: foto, datos personales, club/equipo (dropdowns
 *      dependientes), contacto de emergencia, PDF del documento.
 *   3. On submit: upload foto + PDF → POST register → confetti +
 *      success screen.
 *
 * Mobile-first because most parents will open this on their phone
 * from a WhatsApp link.
 */

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };
const BRAND = ['#E31E24', '#FFB300', '#FFFFFF', '#003087'];

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Tipo de documento' },
  { value: 'TI', label: 'TI — Tarjeta de Identidad' },
  { value: 'RC', label: 'RC — Registro Civil' },
  { value: 'CC', label: 'CC — Cédula de Ciudadanía' },
  { value: 'CE', label: 'CE — Cédula de Extranjería' },
  { value: 'PA', label: 'PA — Pasaporte' },
];

const RELATIONSHIP_OPTIONS = [
  'Mamá',
  'Papá',
  'Abuelo/a',
  'Tío/a',
  'Hermano/a',
  'Tutor/a legal',
  'Otro',
];

interface FormState {
  firstName: string;
  lastName: string;
  birthDate: string;
  documentType: string;
  documentNumber: string;
  clubId: string;
  teamId: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
}

function emptyForm(): FormState {
  return {
    firstName: '',
    lastName: '',
    birthDate: '',
    documentType: '',
    documentNumber: '',
    clubId: '',
    teamId: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  };
}

/** Light field-level error tracking. Keys match FormState. */
type FieldErrors = Partial<Record<keyof FormState, string>> & { server?: string };

export function PublicRegistration() {
  const { slug } = useParams<{ slug: string }>();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<PublicTournamentView | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ firstName: string; lastName: string } | null>(
    null,
  );

  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Load the public view once on mount.
  useEffect(() => {
    if (!slug) {
      setLoadError('Link inválido');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.publicRegistration.getTournamentBySlug(slug);
        if (cancelled) return;
        setView(data);
      } catch (err) {
        if (cancelled) return;
        setLoadError(getErrorMessage(err, 'No pudimos cargar el torneo'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Team options depend on the chosen club. When the parent switches
  // club we always clear `teamId` so they don't accidentally submit a
  // team from a different club.
  const teamOptions = useMemo<PublicTeamSummary[]>(() => {
    if (!view || !form.clubId) return [];
    const club = view.clubs.find((c) => c.id === form.clubId);
    return club?.teams ?? [];
  }, [view, form.clubId]);

  /** Fire a single celebratory tri-burst confetti when the submission succeeds. */
  const fireConfetti = () => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    confetti({ particleCount: 120, angle: 60, spread: 70, origin: { x: 0, y: 1 }, colors: BRAND });
    confetti({ particleCount: 120, angle: 120, spread: 70, origin: { x: 1, y: 1 }, colors: BRAND });
    setTimeout(() => {
      confetti({ particleCount: 180, spread: 100, origin: { x: 0.5, y: 0.55 }, colors: BRAND });
    }, 350);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, server: 'La foto no puede superar 10MB' }));
      return;
    }
    const compressed = await compressLogoImage(file);
    setPhotoFile(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, server: 'El PDF no puede superar 10MB' }));
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrors((prev) => ({ ...prev, server: 'El archivo debe ser PDF' }));
      return;
    }
    setDocumentFile(file);
    setDocumentName(file.name);
  };

  const validate = (state: FormState): FieldErrors => {
    const next: FieldErrors = {};
    if (!state.firstName.trim()) next.firstName = 'Obligatorio';
    if (!state.lastName.trim()) next.lastName = 'Obligatorio';
    if (!state.clubId) next.clubId = 'Selecciona el club';
    if (!state.teamId) next.teamId = 'Selecciona el equipo';
    if (state.birthDate) {
      // Lightweight client check: a parent can still submit an out-of-
      // range date but the backend will reject it. We just block the
      // really weird stuff (future dates, year < 1900).
      const today = new Date().toISOString().slice(0, 10);
      if (state.birthDate > today) next.birthDate = 'No puede ser futura';
      else if (state.birthDate < '1900-01-01') next.birthDate = 'Fecha inválida';
    }
    if (state.documentType && !state.documentNumber.trim()) {
      next.documentNumber = 'Ingresá el número';
    }
    if (state.emergencyContactPhone && state.emergencyContactPhone.length > 40) {
      next.emergencyContactPhone = 'Demasiado largo';
    }
    return next;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !view) return;
    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      // 1) Encode foto + PDF as data URLs CLIENT-SIDE. We deliberately
      // bypass `/api/upload/{logo,document}` because those endpoints
      // sit behind the JWT middleware (the public form has no token,
      // so the upload returned 401 "Token de autenticación requerido"
      // — the bug this branch fixes). The backend's public
      // `register` endpoint accepts `photo`/`documentFile` as
      // data: URLs directly, so we ship the bytes in the same body
      // and avoid exposing the multer endpoints to anonymous callers.
      const [photoUrl, documentUrl] = await Promise.all([
        photoFile ? fileToDataUrl(photoFile) : Promise.resolve<string | undefined>(undefined),
        documentFile
          ? fileToDataUrl(documentFile)
          : Promise.resolve<string | undefined>(undefined),
      ]);

      // 2) Submit the registration. The backend validates the cutoff +
      // roster cap + that teamId is enrolled in this tournament, so
      // we don't duplicate those checks here.
      await api.publicRegistration.register(slug, {
        teamId: form.teamId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: form.birthDate || undefined,
        documentType: form.documentType || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        photo: photoUrl,
        documentFile: documentUrl,
        emergencyContactName: form.emergencyContactName.trim() || undefined,
        emergencyContactPhone: form.emergencyContactPhone.trim() || undefined,
        emergencyContactRelationship:
          form.emergencyContactRelationship.trim() || undefined,
      });

      setSuccess({ firstName: form.firstName.trim(), lastName: form.lastName.trim() });
      // Wait one frame so the success screen is mounted before confetti
      // fires; otherwise the burst originates off-screen.
      requestAnimationFrame(() => fireConfetti());
    } catch (err) {
      setErrors({ server: getErrorMessage(err, 'No pudimos guardar la inscripción') });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render branches ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" aria-hidden="true" />
      </div>
    );
  }

  if (loadError || !view) {
    return (
      <CenteredCard
        icon={<AlertCircle className="w-7 h-7" />}
        tone="error"
        title="No encontramos este torneo"
        body={loadError ?? 'Revisá el enlace o contactá al club que te lo compartió.'}
      />
    );
  }

  if (view.notOpenYet) {
    return (
      <CenteredCard
        icon={<Lock className="w-7 h-7" />}
        tone="muted"
        title="Inscripciones aún no disponibles"
        body={
          <>
            Las inscripciones para <b>{view.tournament.name}</b> abren el{' '}
            {view.opensAt ? formatHumanDatetime(view.opensAt) : 'próximamente'}.
            Guardá este enlace y volvé en esa fecha.
          </>
        }
      />
    );
  }

  if (!view.isOpen) {
    return (
      <CenteredCard
        icon={<Lock className="w-7 h-7" />}
        tone="muted"
        title="Inscripciones cerradas"
        body={
          <>
            Las inscripciones para <b>{view.tournament.name}</b> cerraron el{' '}
            {view.closedAt.length > 10
              ? formatHumanDatetime(view.closedAt)
              : formatHumanDate(view.closedAt)}
            . Si todavía necesitás registrar a tu jugadora, contactá directamente al club.
          </>
        }
      />
    );
  }

  if (success) {
    return (
      <CenteredCard
        icon={<PartyPopper className="w-8 h-8" />}
        tone="success"
        title={`¡Felicitaciones, ${success.firstName}!`}
        body={
          <>
            Tu inscripción a <b>{view.tournament.name}</b> fue exitosa.
            El club recibe la notificación al instante. ¡Nos vemos en
            la cancha!
          </>
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <header className="bg-spk-black text-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          {view.tournament.logo ? (
            <img
              src={view.tournament.logo}
              alt={`Logo ${view.tournament.name}`}
              className="w-12 h-12 rounded-sm object-contain bg-white p-1 flex-shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-sm bg-spk-red flex items-center justify-center flex-shrink-0">
              <Calendar className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider text-white/55 font-bold"
              style={FONT}
            >
              Inscripción de jugadora
            </p>
            <h1
              className="text-xl sm:text-2xl font-bold leading-tight truncate"
              style={FONT}
            >
              {view.tournament.name}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        <p className="text-sm text-black/70 mb-6">
          Completá los datos de tu jugadora para inscribirla. El club
          revisará los datos y aparecerá en su plantel al instante.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {errors.server && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errors.server}</span>
            </div>
          )}

          {/* ── Foto ─────────────────────────────────────────────── */}
          <Section title="Foto de la jugadora">
            <div className="flex items-center gap-4">
              <div className="relative">
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt="Foto"
                    className="w-24 h-24 rounded-sm object-cover border-2 border-black/10"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-sm bg-black/5 border-2 border-dashed border-black/15 flex items-center justify-center">
                    <User className="w-10 h-10 text-black/30" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-spk-black text-white text-sm font-bold rounded-sm uppercase"
                  style={{ ...FONT, letterSpacing: '0.06em' }}
                >
                  <Upload className="w-4 h-4" />
                  {photoPreview ? 'Cambiar foto' : 'Subir foto'}
                </button>
                <p className="text-[11px] text-black/45 mt-2 leading-relaxed">
                  Opcional · La comprimimos a 256px y la subimos en webp,
                  máx 10MB.
                </p>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
            </div>
          </Section>

          {/* ── Datos personales ─────────────────────────────────── */}
          <Section title="Datos de la jugadora">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Nombre"
                required
                error={errors.firstName}
              >
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className={inputClass(!!errors.firstName)}
                  placeholder="Ej: Laura"
                  autoComplete="given-name"
                />
              </Field>
              <Field
                label="Apellido"
                required
                error={errors.lastName}
              >
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className={inputClass(!!errors.lastName)}
                  placeholder="Ej: Gómez"
                  autoComplete="family-name"
                />
              </Field>
            </div>

            <Field
              label="Fecha de nacimiento"
              error={errors.birthDate}
            >
              <input
                type="date"
                value={form.birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                className={inputClass(!!errors.birthDate)}
              />
            </Field>

            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field label="Tipo de documento">
                <select
                  value={form.documentType}
                  onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                  className={inputClass(false) + ' bg-white'}
                >
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d.value || 'none'} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Número de documento"
                error={errors.documentNumber}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.documentNumber}
                  onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                  className={inputClass(!!errors.documentNumber)}
                  placeholder="Ej: 1001234567"
                />
              </Field>
            </div>
          </Section>

          {/* ── Club + equipo ────────────────────────────────────── */}
          <Section title="Club y equipo">
            <Field label="Club" required error={errors.clubId}>
              <select
                value={form.clubId}
                onChange={(e) => {
                  // Switching clubs nukes the team selection so the
                  // parent can't submit a team that doesn't belong to
                  // the new club.
                  setForm({ ...form, clubId: e.target.value, teamId: '' });
                }}
                className={inputClass(!!errors.clubId) + ' bg-white'}
              >
                <option value="">Selecciona el club</option>
                {view.clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Equipo / Categoría" required error={errors.teamId}>
              <select
                value={form.teamId}
                disabled={!form.clubId}
                onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                className={inputClass(!!errors.teamId) + ' bg-white disabled:bg-black/5 disabled:cursor-not-allowed'}
              >
                <option value="">
                  {form.clubId
                    ? 'Selecciona el equipo'
                    : 'Primero elegí un club'}
                </option>
                {teamOptions.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.isFull}>
                    {t.name}
                    {t.category ? ` — ${t.category}` : ''}
                    {t.isFull ? ' (lleno)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {view.clubs.length === 0 && (
              <p className="text-xs text-black/55 mt-2">
                Todavía no hay clubs inscritos en este torneo. Si pensás
                que es un error, contactá al organizador.
              </p>
            )}
          </Section>

          {/* ── Contacto de emergencia ───────────────────────────── */}
          <Section
            title="Contacto de emergencia"
            subtitle="Quien firme la responsabilidad por la jugadora."
          >
            <Field label="Nombre completo">
              <input
                type="text"
                value={form.emergencyContactName}
                onChange={(e) =>
                  setForm({ ...form, emergencyContactName: e.target.value })
                }
                className={inputClass(false)}
                placeholder="Ej: María Pérez"
              />
            </Field>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Field label="Teléfono" error={errors.emergencyContactPhone}>
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.emergencyContactPhone}
                  onChange={(e) =>
                    setForm({ ...form, emergencyContactPhone: e.target.value })
                  }
                  className={inputClass(!!errors.emergencyContactPhone)}
                  placeholder="+57 300 000 0000"
                />
              </Field>
              <Field label="Relación">
                <select
                  value={form.emergencyContactRelationship}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      emergencyContactRelationship: e.target.value,
                    })
                  }
                  className={inputClass(false) + ' bg-white'}
                >
                  <option value="">—</option>
                  {RELATIONSHIP_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          {/* ── Documento PDF ────────────────────────────────────── */}
          <Section
            title="Copia del documento (PDF)"
            subtitle="Subí el documento de identidad de la jugadora en PDF."
          >
            <button
              type="button"
              onClick={() => documentInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-black/20 rounded-sm hover:border-spk-red hover:bg-spk-red/5 transition-colors text-left"
            >
              <FileText
                className="w-5 h-5 text-black/60 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {documentName ?? 'Tocá para subir el PDF'}
                </div>
                <div className="text-xs text-black/50">
                  {documentFile
                    ? 'Listo para guardar'
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
          </Section>

          {/* ── Submit ───────────────────────────────────────────── */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={submitting}
            className="w-full bg-spk-red hover:bg-spk-red-dark text-white py-4 rounded-sm font-bold uppercase text-base flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ ...FONT, letterSpacing: '0.06em' }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Inscribiendo…
              </>
            ) : (
              'Inscribir jugadora'
            )}
          </motion.button>

          <p className="text-[11px] text-black/45 text-center leading-relaxed pt-2">
            Al enviar, autorizás al club a usar estos datos
            exclusivamente para la participación deportiva en este
            torneo.
          </p>
        </form>
      </main>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-black/10 rounded-sm p-4 sm:p-5 space-y-4">
      <header>
        <h2
          className="text-sm font-bold uppercase"
          style={{ ...FONT, letterSpacing: '0.08em' }}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-[11px] text-black/55 mt-0.5">{subtitle}</p>
        )}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="block text-[12px] font-bold mb-1.5"
        style={{ ...FONT, letterSpacing: '0.02em' }}
      >
        {label}
        {required && <span className="text-spk-red ml-1">*</span>}
      </span>
      {children}
      {error && (
        <span className="block text-[11px] text-red-600 mt-1">{error}</span>
      )}
    </label>
  );
}

function inputClass(hasError: boolean): string {
  return [
    'w-full px-3 py-2.5 border-2 rounded-sm focus:outline-none text-sm',
    hasError
      ? 'border-red-500 focus:border-red-500'
      : 'border-black/10 focus:border-spk-red',
  ].join(' ');
}

interface CenteredCardProps {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  tone: 'success' | 'error' | 'muted';
}

function CenteredCard({ icon, title, body, tone }: CenteredCardProps) {
  const ringClass =
    tone === 'success'
      ? 'bg-spk-red/10 text-spk-red'
      : tone === 'error'
        ? 'bg-red-50 text-red-600'
        : 'bg-black/5 text-black/55';
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-black/10 rounded-sm p-6 sm:p-8 max-w-md w-full text-center space-y-4 shadow-md"
      >
        <div
          className={`w-14 h-14 mx-auto rounded-sm flex items-center justify-center ${ringClass}`}
        >
          {icon}
        </div>
        <h1
          className="text-2xl font-bold leading-tight"
          style={FONT}
        >
          {title}
        </h1>
        <p className="text-sm text-black/70 leading-relaxed">{body}</p>
      </motion.div>
    </div>
  );
}

/**
 * Render a 'YYYY-MM-DD' as "8 de mayo de 2026" in Spanish. Used only
 * for the "inscripciones cerraron el …" copy on the lock screen.
 */
function formatHumanDate(iso: string): string {
  try {
    const [year, month, day] = iso.split('-').map((n) => Number(n));
    if (!year || !month || !day) return iso;
    // Anchor at noon UTC to avoid timezone drift on the day side.
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return d.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Render an ISO timestamp as "8 de mayo de 2026 a las 9:00 a. m." in Spanish.
 * Falls back to the raw string on parse errors.
 */
function formatHumanDatetime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const time = d.toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${date} a las ${time}`;
  } catch {
    return iso;
  }
}
