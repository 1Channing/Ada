/**
 * PHOTOS D'UN PDF, DANS LE NAVIGATEUR (11/11, Channing : « sur les PDF, on peut ajouter les photos ? »).
 * Les images peintes par chaque page (pdf.js : liste d'opérations, objets image) ; gardées celles qui ressemblent
 * à une photo (largeur suffisante, pas un bandeau-logo), dans l'ordre du document, sans doublon. Rendues en JPEG.
 * Vérifié sur un rapport VTI : 3 photos 1024×768 en page 1, le logo 640×119 écarté.
 */
type PdfImage = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; bitmap?: ImageBitmap; ref?: string };

export async function extractPdfPhotos(file: Blob, opts: { minWidth?: number; maxCount?: number; maxRatio?: number; quality?: number } = {}): Promise<Blob[]> {
  const minWidth = opts.minWidth ?? 500, maxCount = opts.maxCount ?? 8, maxRatio = opts.maxRatio ?? 2.6, quality = opts.quality ?? 0.82;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: Blob[] = [];
  const seen = new Set<string>();
  try {
    for (let n = 1; n <= doc.numPages && out.length < maxCount; n++) {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length && out.length < maxCount; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const name = String(ops.argsArray[i]?.[0] ?? '');
        // Les images partagées par plusieurs pages (« g_… ») vivent dans les objets communs du document, les autres
        // dans ceux de la page (même règle que le rendu pdf.js) ; une image qui ne vient pas (3 s) est passée.
        const store = (name.startsWith('g_') ? page.commonObjs : page.objs) as { get: (n: string, cb: (o: PdfImage | null) => void) => void };
        let img: PdfImage | null = null;
        try {
          img = await new Promise<PdfImage | null>((res) => { const t = setTimeout(() => res(null), 3000); try { store.get(name, (o) => { clearTimeout(t); res(o); }); } catch { clearTimeout(t); res(null); } });
        } catch { img = null; }
        if (!img || !img.width || !img.height) continue;
        const key = img.ref ? String(img.ref) : `${n}:${name}`;
        if (seen.has(key)) continue;
        if (img.width < minWidth || img.width / img.height > maxRatio || img.height / img.width > maxRatio) continue;
        const blob = await toJpeg(img, quality);
        if (!blob) continue;
        // Même image répétée de page en page (logo, photo de couverture) : écartée par signature taille+poids.
        const sig = `${img.width}x${img.height}:${blob.size}`;
        if (seen.has(sig)) continue;
        seen.add(key); seen.add(sig);
        out.push(blob);
      }
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out;
}

async function toJpeg(img: PdfImage, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
    else if (img.data) {
      const px = img.width * img.height;
      const rgba = new Uint8ClampedArray(px * 4);
      const d = img.data;
      if (d.length >= px * 4) rgba.set(d.subarray(0, px * 4));                  // RGBA
      else if (d.length >= px * 3) for (let p = 0, q = 0; p < px; p++, q += 3) { rgba[p * 4] = d[q]; rgba[p * 4 + 1] = d[q + 1]; rgba[p * 4 + 2] = d[q + 2]; rgba[p * 4 + 3] = 255; } // RGB
      else if (d.length >= px) for (let p = 0; p < px; p++) { rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = d[p]; rgba[p * 4 + 3] = 255; } // gris
      else return null;
      ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    } else return null;
    return await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  } catch { return null; } finally { canvas.width = 0; canvas.height = 0; }
}
