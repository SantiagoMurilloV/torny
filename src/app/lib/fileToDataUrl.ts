/**
 * Convert a browser `File` / `Blob` into a `data:` URL (base64 payload).
 *
 * Why this helper exists:
 *   The parent-registration flow (`/torneo/:slug/inscripcion`) is the
 *   only place in the app where an unauthenticated visitor needs to
 *   ship binary content (player photo + identity PDF). Our regular
 *   `POST /api/upload/{logo,document}` endpoints sit behind the JWT
 *   gate (a 401 with "Token de autenticación requerido" was the bug
 *   that triggered this helper). Exposing those endpoints publicly
 *   would invite anonymous abuse with no rate-limit; instead we let
 *   the client base64-encode the bytes locally and ship the data URL
 *   inside the existing public `register` JSON body — the backend
 *   already accepts `photo?: string` / `documentFile?: string` as
 *   data URLs (mig 011 stores them in TEXT columns either way).
 *
 *   Photos are tiny after `compressLogoImage` (~5-25 KB), and PDFs
 *   are capped at 10 MB on the client — base64 inflates ~33 %, so a
 *   worst-case body stays under the server's `express.json({ limit:
 *   '20mb' })` ceiling.
 *
 *   Wrapped in a Promise so call sites can `await` it alongside other
 *   async work (e.g. parallel photo + PDF encoding inside a
 *   `Promise.all`).
 */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned a non-string result'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed to read the file'));
    };
    reader.readAsDataURL(file);
  });
}
