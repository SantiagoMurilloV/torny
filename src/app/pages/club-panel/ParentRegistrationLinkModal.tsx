import { useEffect, useState } from 'react';
import { X, Copy, Check, ExternalLink, Share2, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Tournament } from '../../types';

interface ParentRegistrationLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournament: Tournament;
}

/**
 * Show-once modal opened from the club panel's "Generar link para
 * acudientes" button. Surfaces the full URL + a one-click copy + a
 * "Compartir" handoff to the native share sheet on mobile.
 *
 * The link IS the same for every parent who registers a jugadora in
 * this torneo — there's no per-parent token by design (product call,
 * to keep the parents' flow frictionless). The club captain shares it
 * via WhatsApp / mail / wherever, then waits for the push pings.
 */
export function ParentRegistrationLinkModal({
  isOpen,
  onClose,
  tournament,
}: ParentRegistrationLinkModalProps) {
  const [copied, setCopied] = useState(false);

  // Compute the absolute URL using the live origin. Works in dev
  // (localhost:5173) and prod (torny.app) without hardcoding either.
  // If the tournament has no slug (super edge case: pre-mig 029 row
  // somehow still around), we fall back to the id which is at least
  // unique. The public endpoint accepts both.
  const slug = tournament.slug ?? tournament.id;
  const url = `${window.location.origin}/torneo/${encodeURIComponent(slug)}/inscripcion`;

  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copiado al portapapeles');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Some legacy iOS Safari versions reject writeText() outside a
      // direct user gesture. Fall back to selecting an input box.
      toast.error('No pudimos copiar. Selecciona y copia manualmente.');
    }
  };

  const handleShare = async () => {
    // navigator.share is iOS Safari 12.2+ / Chrome 89+. Falls back to
    // copy on browsers that don't have it.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Inscripción ${tournament.name}`,
          text: `Inscribí a tu jugadora en ${tournament.name}:`,
          url,
        });
        return;
      } catch {
        // User dismissed the share sheet — no toast, no fallback.
        return;
      }
    }
    await handleCopy();
  };

  const formattedStart = formatHumanDate(tournament.startDate);

  // Cutoff copy: prefer the explicit registrationClosesAt when the admin
  // configured one (mig 035); fall back to the legacy "noche anterior al inicio".
  const cutoffLine = (() => {
    if (tournament.registrationClosesAt) {
      return (
        <>
          <b>Cierre configurado:</b> El link deja de aceptar inscripciones
          el {formatHumanDatetime(new Date(tournament.registrationClosesAt))}.
        </>
      );
    }
    return (
      <>
        <b>Cierre automático:</b> El link deja de aceptar inscripciones
        el día anterior al inicio del torneo
        {formattedStart ? ` (${formattedStart})` : ''}.
      </>
    );
  })();

  // Opening gate copy (mig 035): only shown when the link hasn't opened yet.
  const notOpenYet =
    tournament.registrationOpensAt &&
    Date.now() < new Date(tournament.registrationOpensAt).getTime();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/55 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="bg-white rounded-sm shadow-2xl max-w-md w-full overflow-hidden"
        role="dialog"
        aria-label="Link de inscripción para acudientes"
      >
        <header className="bg-spk-black text-white px-5 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider text-white/55 font-bold"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Link para acudientes
            </p>
            <h2
              className="text-lg font-bold leading-tight truncate"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {tournament.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          <p className="text-sm text-black/70 leading-relaxed">
            Compartí este link con los papás. Ellos llenan los datos de
            la jugadora, eligen el equipo y aparece en tu plantel al
            instante. El link se cierra automáticamente la noche antes
            del torneo.
          </p>

          {/* URL display + copy */}
          <div>
            <label
              className="block text-[11px] font-bold uppercase mb-1.5 text-black/55"
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                letterSpacing: '0.08em',
              }}
            >
              URL de inscripción
            </label>
            <div className="flex items-stretch border-2 border-black/10 rounded-sm overflow-hidden">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-black/[0.03] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copiar link"
                className="px-3 bg-spk-red text-white hover:bg-spk-red-dark transition-colors flex items-center gap-1.5"
              >
                {copied ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4" aria-hidden="true" />
                )}
                <span
                  className="text-xs font-bold uppercase"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    letterSpacing: '0.05em',
                  }}
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </span>
              </button>
            </div>
          </div>

          {/* Not-open-yet warning (mig 035) */}
          {notOpenYet && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border-l-2 border-blue-400 rounded-sm">
              <Calendar
                className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-xs text-black/75 leading-relaxed">
                <b>Aún no disponible:</b> El link abre el{' '}
                {formatHumanDatetime(new Date(tournament.registrationOpensAt!))}.
                Podés compartirlo antes, pero no funcionará hasta esa fecha.
              </p>
            </div>
          )}

          {/* Cutoff reminder */}
          <div className="flex items-start gap-2 p-3 bg-spk-gold/10 border-l-2 border-spk-gold rounded-sm">
            <Calendar
              className="w-4 h-4 text-spk-gold flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-black/75 leading-relaxed">
              {cutoffLine}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleShare}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-spk-black text-white font-bold rounded-sm uppercase text-sm"
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                letterSpacing: '0.06em',
              }}
            >
              <Share2 className="w-4 h-4" />
              Compartir
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-black/5 hover:bg-black/10 text-black font-bold rounded-sm uppercase text-sm"
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                letterSpacing: '0.06em',
              }}
            >
              <ExternalLink className="w-4 h-4" />
              Vista previa
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Render a JS Date as "8 de mayo de 2026". Returns empty when the
 * input is missing so the caller can render `${date ? ` (${date})` : ''}`
 * inline without conditional logic.
 */
function formatHumanDate(date: Date | undefined): string {
  if (!date) return '';
  try {
    return date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Render a JS Date as "8 de mayo de 2026 a las 9:00 a. m." in Spanish.
 * Used for the mig-035 configured opens/closes timestamps.
 */
function formatHumanDatetime(date: Date): string {
  try {
    const datePart = date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timePart = date.toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${datePart} a las ${timePart}`;
  } catch {
    return date.toISOString();
  }
}
