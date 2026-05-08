/**
 * Compress and downscale a logo image client-side before uploading.
 *
 * Why this exists:
 *   Team logos used to be uploaded as-is — a 2 MB PNG straight from the
 *   user's photo library would land in Postgres as a base64 data URL
 *   that bloated `GET /teams` past 9 MB on a midsize tournament. The
 *   short-term fix was to drop the `logo` column from the listing, but
 *   that left match cards / brackets / standings with no logos because
 *   the team cache only ever sees the slim payload.
 *
 *   This helper makes that dilemma go away: we accept the same friendly
 *   2 MB upload limit, but the bytes that actually leave the browser
 *   are a 256×256 WebP at quality ~0.82, which lands at roughly 5–25 KB
 *   per logo. With 32 teams that's <1 MB total in the listing — small
 *   enough to ship the column back and let every view show the logo.
 *
 * Behavior:
 *   · Decoded once via `createImageBitmap` (faster + skips EXIF) with a
 *     `<img>` fallback for browsers that don't support it.
 *   · Drawn into an off-screen `<canvas>` resized so the longest side is
 *     at most `MAX_DIMENSION` (default 256). Aspect ratio preserved.
 *   · Serialized with `canvas.toBlob('image/webp', 0.82)`. WebP gives the
 *     smallest size for sharp logo edges without visible artifacts.
 *   · If WebP encoding isn't supported (some old Safari versions), we
 *     fall back to JPEG at the same quality.
 *   · SVGs are returned untouched — they're already vector and tiny.
 *   · If anything in the pipeline fails (corrupt image, security error
 *     on a cross-origin source, etc.), we return the original `File` so
 *     the upload still works; the caller never sees an exception.
 *
 *   The output File keeps `lastModified` so React inputs that compare
 *   identity don't loop, and uses a `.webp` / `.jpg` extension so the
 *   server's MIME inference (server/src/index.ts mimeFromFilename) lines
 *   up if the multipart layer dropped the type.
 */

const MAX_DIMENSION = 256;
const QUALITY = 0.82;

export async function compressLogoImage(file: File): Promise<File> {
  // SVGs: vector, already small, and rasterizing them would lose
  // quality at every zoom level. Pass them through.
  if (file.type === 'image/svg+xml') return file;

  // Anything that isn't an image (defensive — call sites already check):
  // bypass compression so we don't corrupt the upload.
  if (!file.type.startsWith('image/')) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = fitInside(bitmap.width, bitmap.height, MAX_DIMENSION);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // High-quality downscale. The default smoothing is fine but we set
    // it explicitly so different browsers don't pick low-quality.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Try WebP first (smaller for logos with hard edges); fall back to
    // JPEG if the browser refuses to encode WebP. Either way the output
    // is a fraction of the original PNG/JPEG straight from the camera.
    const webpBlob = await canvasToBlob(canvas, 'image/webp', QUALITY);
    if (webpBlob && webpBlob.size > 0) {
      return blobToFile(webpBlob, file.name, 'webp');
    }

    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
    if (jpegBlob && jpegBlob.size > 0) {
      return blobToFile(jpegBlob, file.name, 'jpg');
    }

    return file;
  } catch {
    // Any failure (CORS-tainted bitmap, decoder error, OOM on a huge
    // image) → upload the original so the user isn't blocked. The
    // server still enforces the 2 MB cap.
    return file;
  }
}

/** Load the file into an ImageBitmap, falling back to <img> for older browsers. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path — Firefox sometimes refuses
      // bitmap creation on certain corrupted files.
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-decode-failed'));
    };
    img.src = url;
  });
}

/**
 * Compute target width/height that fits inside a `max × max` square
 * while preserving aspect ratio. Skips upscaling — a tiny 64×64 logo
 * stays 64×64 instead of being blown up to 256×256.
 */
function fitInside(srcW: number, srcH: number, max: number): { width: number; height: number } {
  if (srcW <= max && srcH <= max) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW / srcH;
  if (srcW >= srcH) {
    return { width: max, height: Math.round(max / ratio) };
  }
  return { width: Math.round(max * ratio), height: max };
}

/** Promise wrapper around `canvas.toBlob` so it's awaitable. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      type,
      quality
    );
  });
}

/** Wrap a Blob in a File with a sane name + extension. */
function blobToFile(blob: Blob, originalName: string, extension: 'webp' | 'jpg'): File {
  const base = originalName.replace(/\.[^.]+$/, '') || 'logo';
  const name = `${base}.${extension}`;
  return new File([blob], name, { type: blob.type, lastModified: Date.now() });
}
