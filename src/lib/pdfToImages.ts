/**
 * PDF → une image JPEG par page (01/10, demande Channing : « ajouter des
 * photos via PDF sur les photos de nos dossiers dans les négociations »).
 *
 * Les dossiers photos reçus des vendeurs sont des PDF « une photo par
 * page » (exemple fourni : Toyota Yaris Cross Trail, 43 pages de 1066 × 800).
 * On rend chaque page dans un canvas avec pdf.js, côté navigateur, et on
 * exporte en JPEG — même format que les photos ajoutées à la main. Marche
 * aussi sur un PDF mixte (pages de texte, scans) : chaque page devient une
 * photo, à l'utilisateur de retirer celles qui ne servent pas.
 *
 * pdf.js est chargé à la demande (module séparé) : rien ne pèse sur la page
 * tant qu'on n'ajoute pas de PDF.
 */

export interface PdfToImagesOptions {
  /** Plus grand côté de l'image produite, en px (défaut 1600 ; jamais en dessous de la taille native de la page). */
  maxEdge?: number;
  /** Qualité JPEG 0–1 (défaut 0,92, comme les autres photos). */
  quality?: number;
  /** Appelé après chaque page rendue. */
  onProgress?: (done: number, total: number) => void;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export async function pdfPagesToJpegs(file: Blob, opts: PdfToImagesOptions = {}): Promise<Blob[]> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.92;
  // Build « legacy » = polyfills inclus (Promise.withResolvers…) : le build
  // moderne exige Safari 17.4+ / Chrome 119+, trop récent pour un iPhone ou
  // un Mac pas à jour.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: Blob[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // Échelle : atteindre maxEdge sans jamais réduire sous la taille native.
      const scale = Math.max(1, Math.min(4, maxEdge / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas indisponible');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height); // pages transparentes → fond blanc, pas noir en JPEG
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(`page ${n} : export JPEG impossible`))), 'image/jpeg', quality)));
      page.cleanup();
      canvas.width = 0; canvas.height = 0; // libère la mémoire tout de suite (43 pages × 1600 px)
      opts.onProgress?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
