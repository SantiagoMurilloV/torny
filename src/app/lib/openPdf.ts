/**
 * Open a PDF that's stored as a `data:application/pdf;base64,...` URL in a
 * new browser tab.
 *
 * Why this helper exists:
 *   We persist player documents and tournament regulations as base64 data
 *   URLs (Railway's filesystem is ephemeral, so we keep them inside Postgres
 *   alongside the records that reference them). Displaying the document
 *   used to be `<a href={dataUrl} target="_blank">PDF</a>`, but modern
 *   browsers enforce a "data URLs cannot be top-frame navigated" rule:
 *
 *     · Chrome 60+ blocks top-frame navigation to data: URLs.
 *     · Safari blocks data: URLs in `target="_blank"` for documents > a few
 *       hundred KB.
 *     · Firefox warns then refuses for large payloads.
 *
 *   The standard workaround is to convert the data URL into a Blob, then
 *   open a blob URL — those are cross-origin-isolated and aren't subject
 *   to the data-URL navigation restriction. A scanned ID PDF that's
 *   ~3 MB renders perfectly via `URL.createObjectURL(blob)` even though
 *   clicking the raw `data:` link does nothing.
 *
 * Behavior:
 *   1. If the input looks like a regular HTTP(S) URL, just `window.open` it
 *      — the helper is safe to call with anything resembling a PDF link.
 *   2. If it's a data URL, decode the base64 payload into a Blob, generate
 *      a blob URL, and open it. We revoke the URL on a 60-second timer so
 *      the memory is reclaimed eventually but the tab has plenty of time
 *      to load the document first.
 *   3. If the popup is blocked, return false so callers can show a hint.
 *
 * Returns true when the new tab/window was successfully opened.
 */
export function openPdfFromDataUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  // HTTP(S) URLs (or relative paths) bypass the conversion — they navigate
  // fine on every browser. We only need the dance for data: URLs.
  if (!url.startsWith('data:')) {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    return Boolean(win);
  }

  const blobUrl = dataUrlToBlobUrl(url);
  if (!blobUrl) return false;

  const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  // Give the new tab time to load the blob before we revoke the URL —
  // revoking too early stops Chrome from rendering the PDF.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

  return Boolean(win);
}

/**
 * Convierte una data URL (`data:<mime>;base64,<payload>` o sin base64) a
 * un Object URL (`blob:...`). Devuelve null si el input no parsea o si
 * el navegador no expone `URL.createObjectURL` (SSR / entornos raros).
 *
 * El llamador es responsable de liberar el URL con
 * `URL.revokeObjectURL(url)` cuando ya no lo necesite — en un componente
 * React eso suele ir en el cleanup del `useEffect` que crea el blob.
 *
 * Usado por `openPdfFromDataUrl` (para abrir en pestaña nueva) y por el
 * `PdfViewerModal` (para embeber el PDF en un iframe inline). Tener una
 * sola función con la conversión evita que el viewer y el "abrir en
 * pestaña" se desincronicen si en el futuro hay que soportar otros
 * formatos (JPG, etc).
 */
export function dataUrlToBlobUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('data:')) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

  try {
    const commaIdx = url.indexOf(',');
    if (commaIdx === -1) return null;
    const meta = url.substring(5, commaIdx);
    const payload = url.substring(commaIdx + 1);
    const isBase64 = meta.includes(';base64');
    const mime = (meta.split(';')[0] || 'application/pdf').trim();

    let bytes: Uint8Array;
    if (isBase64) {
      const binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }

    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
