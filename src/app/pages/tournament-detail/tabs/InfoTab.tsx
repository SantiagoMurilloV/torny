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
      className="max-w-4xl space-y-12"
    >
      <div>
        <h3 className="text-3xl font-bold mb-6" style={FONT}>
          SOBRE EL TORNEO
        </h3>
        <p className="text-lg text-black/70 leading-relaxed">{tournament.description}</p>
      </div>

      <div className={hasRegulation ? 'grid md:grid-cols-2 gap-8' : ''}>
        <div>
          <h4 className="text-xl font-bold mb-4" style={FONT}>
            CANCHAS
          </h4>
          <div className="space-y-3">
            {tournament.courts.map((court, index) => (
              <div key={index} className="flex items-center gap-3 text-black/70">
                <MapPin className="w-5 h-5 text-spk-red" />
                <span className="text-lg">{court}</span>
              </div>
            ))}
          </div>
        </div>

        {hasRegulation && (
          <div>
            <h4 className="text-xl font-bold mb-4" style={FONT}>
              REGLAMENTO
            </h4>
            {regulationText && (
              <p className="text-base text-black/70 leading-relaxed whitespace-pre-wrap mb-4">
                {regulationText}
              </p>
            )}
            {regulationPdf && (
              <button
                type="button"
                onClick={() => setPdfOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-spk-red text-white hover:bg-spk-red-dark font-bold rounded-sm transition-colors text-sm"
                style={FONT}
              >
                <FileText className="w-4 h-4" />
                Ver reglamento (PDF)
              </button>
            )}
          </div>
        )}
      </div>

      <div className="pt-8 border-t border-black/10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <Counter label="Equipos" value={enrolledCount || tournament.teamsCount} />
          <Counter label="Partidos" value={matchesCount} />
          <Counter label="Canchas" value={tournament.courts.length} />
          <Counter label="Días" value={days} />
        </div>
      </div>

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
      <div className="text-4xl font-bold mb-2" style={FONT}>
        {value}
      </div>
      <div className="text-sm text-black/60 uppercase tracking-wider">{label}</div>
    </div>
  );
}
