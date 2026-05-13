import { useState } from 'react';
import { motion } from 'motion/react';
import { MapPin, FileText } from 'lucide-react';
import type { Tournament } from '../../../types';
import { PdfViewerModal } from '../../../components/PdfViewerModal';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * "Info" tab — static tournament metadata: descripción, canchas,
 * reglamento (texto y/o PDF) y los contadores de cabecera.
 *
 * Antes había un bloque "Formato" que mostraba la copia automática del
 * enum técnico del torneo (groups / knockout / etc). Ese campo se sigue
 * usando internamente para generar fixtures pero no aporta información
 * real al espectador, así que lo reemplazamos por un Reglamento que el
 * admin compone — texto, PDF, ambos o ninguno. Si no hay nada, ocultamos
 * la sección entera para no dejar un hueco vacío.
 *
 * El PDF se muestra en un visor inline (PdfViewerModal) en lugar de
 * abrirse en pestaña nueva — Chrome bloquea la apertura directa de
 * data URLs grandes y el resultado era una pestaña en blanco. El modal
 * convierte el data URL a blob URL y lo embebe en un iframe usando el
 * visor PDF nativo del browser.
 */
export function InfoTab({
  tournament,
  enrolledCount,
  matchesCount,
}: {
  tournament: Tournament;
  enrolledCount: number;
  matchesCount: number;
}) {
  const days = Math.ceil(
    (tournament.endDate.getTime() - tournament.startDate.getTime()) / DAY_MS,
  );

  const regulationText = tournament.regulationText?.trim();
  const regulationPdf = tournament.regulationPdf;
  const hasRegulation = Boolean(regulationText || regulationPdf);

  const [pdfOpen, setPdfOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl space-y-8"
    >
      {/* Section headers replaced with quiet eyebrow labels — uppercase
          Barlow Condensed at text-[11px] over a hairline divider. The
          old display-style h3/h4 (text-3xl/xl) overpowered the actual
          body content; subtle labels let the description, courts and
          counters carry the page. */}
      <section>
        <h3
          className="text-[11px] font-bold uppercase text-black/50 tracking-[0.16em] pb-1.5 border-b border-black/10 mb-3"
          style={FONT}
        >
          Sobre el torneo
        </h3>
        <p className="text-sm sm:text-base text-black/75 leading-relaxed">
          {tournament.description}
        </p>
      </section>

      <div className={hasRegulation ? 'grid md:grid-cols-2 gap-6 sm:gap-8' : ''}>
        <section>
          <h4
            className="text-[11px] font-bold uppercase text-black/50 tracking-[0.16em] pb-1.5 border-b border-black/10 mb-3"
            style={FONT}
          >
            Canchas
          </h4>
          <ul className="space-y-2">
            {tournament.courts.map((court, index) => (
              <li
                key={index}
                className="flex items-center gap-2 text-sm text-black/75"
              >
                <MapPin className="w-4 h-4 text-spk-red/80 flex-shrink-0" aria-hidden="true" />
                <span>{court}</span>
              </li>
            ))}
          </ul>
        </section>

        {hasRegulation && (
          <section>
            <h4
              className="text-[11px] font-bold uppercase text-black/50 tracking-[0.16em] pb-1.5 border-b border-black/10 mb-3"
              style={FONT}
            >
              Reglamento
            </h4>
            {regulationText && (
              <p className="text-sm text-black/75 leading-relaxed whitespace-pre-wrap mb-3">
                {regulationText}
              </p>
            )}
            {regulationPdf && (
              <button
                type="button"
                onClick={() => setPdfOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-black text-white hover:bg-spk-red font-bold rounded-sm transition-colors text-xs uppercase tracking-wider"
                style={FONT}
              >
                <FileText className="w-3.5 h-3.5" />
                Ver reglamento (PDF)
              </button>
            )}
          </section>
        )}
      </div>

      {/* Counters — reduced from text-4xl jumbo to text-2xl with a
          tighter label so they read as quiet stats, not a hero
          dashboard. The pt-6/border-t still separates the block. */}
      <section className="pt-6 border-t border-black/10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
          <Counter label="Equipos" value={enrolledCount || tournament.teamsCount} />
          <Counter label="Partidos" value={matchesCount} />
          <Counter label="Canchas" value={tournament.courts.length} />
          <Counter label="Días" value={days} />
        </div>
      </section>

      {regulationPdf && (
        <PdfViewerModal
          isOpen={pdfOpen}
          onClose={() => setPdfOpen(false)}
          pdfDataUrl={regulationPdf}
          title={`Reglamento — ${tournament.name}`}
          downloadFileName={`reglamento-${tournament.name.toLowerCase().replace(/\s+/g, '-')}.pdf`}
        />
      )}
    </motion.div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        className="text-2xl sm:text-3xl font-bold mb-1 tabular-nums"
        style={FONT}
      >
        {value}
      </div>
      <div
        className="text-[11px] text-black/55 uppercase tracking-[0.14em]"
        style={FONT}
      >
        {label}
      </div>
    </div>
  );
}
