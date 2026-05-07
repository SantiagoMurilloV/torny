import type { RefObject } from 'react';
import { FileText, Trash2 } from 'lucide-react';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Reglamento del torneo. Combina dos inputs opcionales:
 *   · textarea de texto plano (lo que el admin quiere comunicar a los
 *     equipos: sistema de puntuación, sets, sanciones, fechas, etc).
 *   · dropzone de PDF — al seleccionar, el archivo queda en memoria y se
 *     sube en el submit del form (vía /api/upload/document, mismo
 *     endpoint que usa el roster). El persistido viaja como data URL.
 *
 * Ambos pueden coexistir; la vista pública decide qué renderizar (texto +
 * link al PDF, solo texto, solo PDF, o nada). Ningún campo es obligatorio.
 */
export function RegulationField({
  text,
  onTextChange,
  hasFile,
  fileName,
  inputRef,
  onSelect,
  onClear,
}: {
  text: string;
  onTextChange: (next: string) => void;
  hasFile: boolean;
  fileName: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-bold mb-2" style={FONT}>
          Reglamento (opcional)
        </label>
        <p className="text-xs text-black/55 mb-2">
          Lo que aquí escribas o subas se mostrará en la pestaña “Info” del torneo público.
          Podés dejar uno, los dos o ninguno.
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-black/70 mb-2" style={FONT}>
          Texto del reglamento
        </label>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Ej: Partidos al mejor de 3 sets a 25 puntos, tercer set a 15. Llegada con 15 min de anticipación..."
          className="w-full px-4 py-2 border-2 border-black/10 rounded-sm focus:outline-none focus:border-spk-red min-h-[140px] text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-black/70 mb-2" style={FONT}>
          PDF del reglamento
        </label>
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 rounded-sm border-2 border-black/10 overflow-hidden bg-black/5 flex items-center justify-center flex-shrink-0">
            <FileText
              className={hasFile ? 'w-6 h-6 text-spk-red' : 'w-6 h-6 text-black/25'}
              aria-hidden="true"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-2 bg-black/5 hover:bg-black/10 text-black rounded-sm font-medium text-sm"
            >
              {hasFile ? 'Cambiar PDF' : 'Subir PDF'}
            </button>
            {hasFile && (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-black/10 hover:border-spk-red hover:text-spk-red text-black rounded-sm font-medium text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Quitar
              </button>
            )}
            {hasFile && fileName && (
              <span className="text-xs text-black/60 truncate max-w-full">{fileName}</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
            />
            <p className="w-full text-xs text-black/50 mt-1">
              PDF — hasta 10 MB. Los espectadores podrán abrirlo en una pestaña aparte.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
