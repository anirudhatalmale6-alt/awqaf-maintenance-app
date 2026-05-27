/**
 * PDF to Image renderer utility
 *
 * Worker loading strategy:
 * We use Vite's `?url` import to bundle the worker as a hashed asset under
 * `/assets/`. This is the most reliable approach in production because:
 *  - The hashed asset path under `/assets/` always carries a real file
 *    extension and is served with the correct `text/javascript` MIME type
 *    (no SPA `index.html` fallback can intercept it).
 *  - The worker is fetched from the SAME origin as the bundle, so no CDN
 *    or cross-origin issues.
 *  - Vite handles dependency tracking automatically — bumping `pdfjs-dist`
 *    just works without any manual `cp` steps.
 *
 * Production deployments behind Lambda / CloudFront / nginx often rewrite
 * unknown paths (including `/pdf.worker.min.mjs` at the root) back to
 * `index.html`, which causes pdfjs to load HTML as JS and fail with
 * "non-JavaScript MIME type 'text/html'". Hashed `/assets/...` paths are
 * exempt from this rewrite, so they always work.
 *
 * Fallbacks (in order of preference):
 *  1. Vite-bundled hashed worker URL (primary).
 *  2. Static `/pdf.worker.min.mjs` from public/ (legacy).
 *  3. Retry without a worker (slow but always works).
 */

// Vite handles this `?url` import: at build time it emits the worker as a
// hashed asset (e.g. `/assets/pdf.worker.min-<hash>.mjs`) and replaces this
// import with the resolved URL string. Works in dev (served by Vite) and prod
// (served as a hashed asset).
import bundledWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const STATIC_WORKER_URL = '/pdf.worker.min.mjs';

let pdfjsModule: typeof import('pdfjs-dist') | null = null;
let workerInitialized = false;

async function getPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist');
  }

  if (!workerInitialized) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsAny = pdfjsModule as any;
    // Primary: Vite-bundled hashed asset URL — guaranteed correct MIME type.
    pdfjsAny.GlobalWorkerOptions.workerSrc = bundledWorkerUrl || STATIC_WORKER_URL;
    workerInitialized = true;
    console.log('[pdfRenderer] worker initialized at:', pdfjsAny.GlobalWorkerOptions.workerSrc);
  }

  return pdfjsModule;
}

export interface PdfPageImage {
  file_name: string;
  url: string;
}

/**
 * Render a single page of a loaded PDF document to a JPEG data URL.
 * Compatible with both pdfjs-dist v4 (canvasContext) and v5 (canvas).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPageToDataUrl(page: any, scale: number): Promise<string | null> {
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // pdfjs-dist v5 requires `canvas`; older versions used `canvasContext`.
    // Pass both so it works across versions.
    const renderParams: Record<string, unknown> = {
      canvas,
      canvasContext: ctx,
      viewport,
    };

    await page.render(renderParams).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Clean up
    canvas.width = 0;
    canvas.height = 0;

    return dataUrl;
  } catch (err) {
    console.warn('Failed to render PDF page:', err);
    return null;
  }
}

/**
 * Render a PDF from a proxy URL or ArrayBuffer to an array of JPEG data URLs (one per page).
 * @param source - Either a URL string to fetch the PDF from, OR a pre-fetched ArrayBuffer of the PDF bytes.
 *                 In deployed environments where the frontend is on a different domain than the
 *                 backend, the caller should pre-fetch the PDF bytes (e.g. via a presigned download URL)
 *                 and pass the ArrayBuffer directly to avoid the relative-URL mismatch.
 * @param fileName - Original file name for labeling
 * @param maxPages - Maximum pages to render (default 10)
 * @param scale - Render scale factor (default 2.0 for good print quality)
 */
export async function renderPdfToImages(
  source: string | ArrayBuffer | Uint8Array,
  fileName: string,
  maxPages = 10,
  scale = 2.0
): Promise<PdfPageImage[]> {
  try {
    const pdfjs = await getPdfjs();

    // Resolve PDF binary data: from ArrayBuffer/Uint8Array directly, or by fetching the URL.
    let buf: ArrayBuffer;
    if (source instanceof ArrayBuffer) {
      buf = source;
    } else if (source instanceof Uint8Array) {
      // Copy into a fresh ArrayBuffer to satisfy pdfjs typing (it expects ArrayBuffer-backed data)
      buf = source.slice().buffer;
    } else {
      // String URL — fetch it. Note: relies on the URL being reachable from the current origin.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let resp: Response;
      try {
        resp = await fetch(source, {
          signal: controller.signal,
          credentials: 'same-origin',
        });
        clearTimeout(timeoutId);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        console.warn('PDF fetch failed:', fetchErr);
        return [];
      }

      if (!resp.ok) {
        console.warn('PDF proxy returned non-OK status:', resp.status);
        return [];
      }

      buf = await resp.arrayBuffer();
    }

    if (buf.byteLength < 100) {
      console.warn('PDF data too small, likely invalid');
      return [];
    }

    // Try loading with worker first, fall back to disabling worker
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdf: any;
    try {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buf),
        useSystemFonts: true,
        disableAutoFetch: true,
        disableStream: true,
      });
      pdf = await loadingTask.promise;
    } catch (workerErr) {
      console.warn('PDF loading with bundled worker failed, retrying with static path:', workerErr);
      // First retry: switch to static `/public` path (in case the bundled
      // hashed asset is unreachable on this host for some reason).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pdfjs as any).GlobalWorkerOptions.workerSrc = STATIC_WORKER_URL;

      try {
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(buf),
          useSystemFonts: true,
          disableAutoFetch: true,
          disableStream: true,
        });
        pdf = await loadingTask.promise;
      } catch (staticErr) {
        console.warn('PDF loading with static worker also failed, retrying without worker:', staticErr);
        // Final retry: disable worker entirely (slower but always works).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pdfjs as any).GlobalWorkerOptions.workerSrc = '';
        workerInitialized = false;

        try {
          const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(buf),
            useSystemFonts: true,
            isEvalSupported: false,
            disableAutoFetch: true,
            disableStream: true,
          });
          pdf = await loadingTask.promise;
        } catch (retryErr) {
          console.warn('PDF loading without worker also failed:', retryErr);
          return [];
        }
      }
    }

    const results: PdfPageImage[] = [];
    const pagesToRender = Math.min(pdf.numPages, maxPages);

    for (let p = 1; p <= pagesToRender; p++) {
      try {
        const page = await pdf.getPage(p);
        const dataUrl = await renderPageToDataUrl(page, scale);
        if (!dataUrl) {
          console.warn(`Page ${p} rendered empty, skipping`);
          continue;
        }
        const pageLabel = pdf.numPages > 1 ? ` (صفحة ${p}/${pdf.numPages})` : '';
        results.push({ file_name: `${fileName}${pageLabel}`, url: dataUrl });
      } catch (pageErr) {
        console.warn(`Failed to render page ${p}:`, pageErr);
        // Continue with other pages
      }
    }

    return results;
  } catch (err) {
    console.warn('PDF rendering failed completely:', err);
    return [];
  }
}