import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, ExternalLink } from 'lucide-react';
import { dataUrlToBlobUrl } from '../lib/openPdf';

const FONT = { fontFamily: 'Barlow Condensed, sans-serif' };

/**
 * Detección barata de iOS Safari/Chrome (que comparten el mismo
 * WebKit). En esos navegadores el `<iframe src=blob:...>` con un PDF
 * no renderiza por una restricción histórica del visor PDF nativo —
 * mostramos un fallback con un botón "Abrir en pestaña" que sí
 * funciona porque iOS abre blob URLs en una pestaña nueva con su
 * visor nativo.
 */
function detectIsIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ se identifica como Mac, distinguido por touchpoints.
  const isIPadOS =
    ua.includes('Macintosh') &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}

interface PdfViewerModalProps {
  /** Controla la visibilidad del modal. */
  isOpen: boolean;
  /** Callback al cerrar (X, backdrop, Esc). */
  onClose: () => void;
  /** Data URL del PDF a mostrar (`data:application/pdf;base64,...`). */
  pdfDataUrl: string;
  /** Título mostrado en el header del modal. Default: "Reglamento". */
  title?: string;
  /** Nombre sugerido para descargar. Default: "reglamento.pdf". */
  downloadFileName?: string;
}

/**
 * Modal que muestra un PDF (entregado como data URL) embebido en un
 * iframe inline, sin sacar al usuario de la página. El visor PDF que se
 * usa es el nativo del browser — ofrece zoom, scroll, descarga y
 * búsqueda sin que tengamos que embed pdf.js.
 *
 * Por qué iframe + blob URL en lugar de iframe + data URL directo:
 * Chrome y Safari rechazan data URLs > ~2MB en `<iframe src=...>` y
 * Firefox bloquea cualquier data URL en iframes desde el documento
 * principal. Convertir el data URL a blob URL salta la restricción
 * porque los blob URLs son same-origin.
 *
 * iOS recibe un fallback porque el embed PDF nativo no funciona en
 * iframes WebKit — un botón "Abrir reglamento" abre en pestaña aparte
 * donde sí renderiza.
 */
export function PdfViewerModal({
  isOpen,
  onClose,
  pdfDataUrl,
  title = 'Reglamento',
  downloadFileName = 'reglamento.pdf',
}: PdfViewerModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setIsIOS(detectIsIOS());
  }, []);

  // (Re)genera el blob URL cuando el modal se abre o cambia el PDF.
  // Lo revoca al cerrar para no dejar memoria viva (un PDF de 5MB queda
  // como ~5MB en el heap del browser hasta que se libere).
  useEffect(() => {
    if (!isOpen) return;
    const url = dataUrlToBlobUrl(pdfDataUrl);
    setBlobUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
      setBlobUrl(null);
    };
  }, [isOpen, pdfDataUrl]);

  // Cerrar con Escape para que el modal sea accesible desde teclado.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="bg-white rounded-sm shadow-2xl w-full max-w-5xl h-[92vh] sm:h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-black/10 flex-shrink-0">
              <h2 className="text-lg sm:text-xl font-bold uppercase truncate" style={FONT}>
                {title}
              </h2>
              <div className="flex items-center gap-2 flex-shrink-0">
                {blobUrl && (
                  <>
                    <a
                      href={blobUrl}
                      download={downloadFileName}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/5 hover:bg-black/10 rounded-sm text-sm font-medium transition-colors"
                      title="Descargar"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Descargar</span>
                    </a>
                    <a
                      href={blobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/5 hover:bg-black/10 rounded-sm text-sm font-medium transition-colors"
                      title="Abrir en pestaña nueva"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="hidden sm:inline">Pestaña</span>
                    </a>
                  </>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-black/5 rounded-sm transition-colors"
                  aria-label="Cerrar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-black/5 min-h-0">
              {!blobUrl ? (
                <div className="h-full flex items-center justify-center text-black/55 text-sm">
                  Cargando PDF…
                </div>
              ) : isIOS ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
                  <p className="text-black/70 max-w-sm">
                    Tu navegador móvil no embebe PDFs. Tocá el botón para abrirlo en una pestaña aparte.
                  </p>
                  <a
                    href={blobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-3 bg-spk-red text-white hover:bg-spk-red-dark font-bold rounded-sm transition-colors"
                    style={FONT}
                  >
                    <ExternalLink className="w-5 h-5" />
                    Abrir reglamento
                  </a>
                </div>
              ) : (
                <iframe
                  src={blobUrl}
                  title={title}
                  className="w-full h-full border-0 bg-white"
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
