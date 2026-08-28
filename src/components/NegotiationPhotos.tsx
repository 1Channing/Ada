import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, ImagePlus, Loader2, Paintbrush, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Negotiation, extractListingDetail, updateNegotiation } from '../services/workflow';

/**
 * Photos d'une négociation → PDF « photos seules » (28/08).
 *
 * Le PDF de sortie copie l'exemple humain fourni : UNE photo par page, la
 * page aux dimensions EXACTES de l'image — pas de fond, pas de marge, pas de
 * texte. Les photos vivent dans notre storage (miroir posé par le worker ou
 * ajout manuel) : indispensable, les CDN des sites refusent le CORS et un
 * canvas « tainted » ne peut plus rien exporter.
 */

const BUCKET = 'admin-documents';

/** Ré-encode côté client en JPEG ≤1600 px (poids du PDF, formats exotiques). */
async function toJpeg(file: Blob, maxEdge = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encodage JPEG impossible'))), 'image/jpeg', 0.92));
}

async function uploadPhoto(negoId: string, blob: Blob, label: string): Promise<string> {
  const path = `negotiations/${negoId}/${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(`Upload en échec : ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** PDF photos-only : une page par photo, page = image, rien d'autre. */
async function buildPhotosPdf(photoUrls: string[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (const url of photoUrls) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Photo inaccessible (${resp.status})`);
    const blob = await resp.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let img;
    try {
      img = await doc.embedJpg(bytes);
    } catch {
      try {
        img = await doc.embedPng(bytes);
      } catch {
        // Format non géré par pdf-lib (webp…) → ré-encodage JPEG via canvas.
        img = await doc.embedJpg(new Uint8Array(await (await toJpeg(blob)).arrayBuffer()));
      }
    }
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return await doc.save();
}

interface Props { nego: Negotiation; onClose: () => void; onChanged: () => void }

export function NegotiationPhotosModal({ nego, onClose, onChanged }: Props) {
  const [photos, setPhotos] = useState<string[]>(nego.photos ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maskIdx, setMaskIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = async (next: string[]) => {
    setPhotos(next);
    await updateNegotiation(nego.id, { photos: next } as Partial<Negotiation>);
    onChanged();
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j], next[i]];
    void persist(next);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const extract = () => run('extract', async () => {
    const r = await extractListingDetail(nego.listing_url);
    if (r.photos.length === 0) throw new Error("Aucune photo extraite de l'annonce");
    const next = [...photos, ...r.photos.filter((p) => !photos.includes(p))];
    await persist(next);
  });

  const addFiles = (files: FileList | null) => run('add', async () => {
    if (!files || files.length === 0) return;
    const added: string[] = [];
    for (const f of Array.from(files)) {
      added.push(await uploadPhoto(nego.id, await toJpeg(f), 'upload'));
    }
    await persist([...photos, ...added]);
  });

  const genPdf = () => run('pdf', async () => {
    if (photos.length === 0) throw new Error('Aucune photo — extrais-les de l\'annonce ou ajoutes-en');
    const bytes = await buildPhotosPdf(photos);
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(nego.title || 'photos').replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'photos'}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">Photos — {nego.title}</h3>
            <p className="text-xs text-slate-500">{photos.length} photo{photos.length > 1 ? 's' : ''} · l'ordre affiché = l'ordre du PDF</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-slate-100">
          {nego.listing_url?.startsWith('http') && (
            <ActionBtn onClick={extract} busy={busy === 'extract'} icon={RefreshCw}>Extraire de l'annonce</ActionBtn>
          )}
          <ActionBtn onClick={() => fileRef.current?.click()} busy={busy === 'add'} icon={ImagePlus}>Ajouter des photos</ActionBtn>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <ActionBtn onClick={genPdf} busy={busy === 'pdf'} icon={Download} primary>Générer le PDF</ActionBtn>
        </div>
        {error && <p className="mx-5 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="p-5 overflow-y-auto">
          {photos.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">
              Aucune photo. « Extraire de l'annonce » va chercher celles de l'annonce ; tu peux aussi en ajouter depuis ton appareil.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((url, i) => (
                <div key={url} className="relative group rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                  <img src={url} alt={`photo ${i + 1}`} loading="lazy" className="w-full h-36 object-cover" />
                  <span className="absolute top-1.5 left-1.5 text-[11px] font-semibold bg-black/60 text-white rounded px-1.5 py-0.5">{i + 1}</span>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconBtn title="Reculer" onClick={() => move(i, -1)} disabled={i === 0}><ArrowLeft className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Avancer" onClick={() => move(i, 1)} disabled={i === photos.length - 1}><ArrowRight className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Masquer une zone (bordereau, plaque…)" onClick={() => setMaskIdx(i)}><Paintbrush className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Retirer" onClick={() => void persist(photos.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></IconBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {maskIdx != null && photos[maskIdx] && (
        <MaskEditor
          url={photos[maskIdx]}
          onCancel={() => setMaskIdx(null)}
          onSave={async (blob) => {
            const masked = await uploadPhoto(nego.id, blob, 'masked');
            const next = photos.map((p, j) => (j === maskIdx ? masked : p));
            setMaskIdx(null);
            await persist(next);
          }}
        />
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, busy, icon: Icon, primary }: {
  children: React.ReactNode; onClick: () => void; busy?: boolean;
  icon: React.ComponentType<{ className?: string }>; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
        primary ? 'bg-brand-ocean hover:bg-brand-encre text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
      }`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

function IconBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean; title: string;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      disabled={disabled}
      className="p-1 rounded text-white hover:bg-white/20 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Masquage MANUEL : rectangles noirs dessinés à la souris/au doigt sur la
 * photo (bordereaux, plaques pro, logos vendeur). Enregistrer produit une
 * NOUVELLE image dans le storage — l'originale n'est jamais réécrite.
 * (Masquage automatique = détection visuelle, prévu avec l'étage vision.)
 */
function MaskEditor({ url, onSave, onCancel }: { url: string; onSave: (b: Blob) => Promise<void>; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rectsRef = useRef<Array<[number, number, number, number]>>([]);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // storage Supabase : CORS ouvert — canvas exportable
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setErr('Photo inaccessible pour édition');
    img.src = url;
  }, [url]);

  const redraw = () => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = '#000';
    for (const [x, y, w, h] of rectsRef.current) ctx.fillRect(x, y, w, h);
  };

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const canvasPoint = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h4 className="font-semibold text-slate-900">Masquer des zones</h4>
            <p className="text-xs text-slate-500">Trace un rectangle sur chaque info à cacher (bordereau, plaque, logo…).</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-auto flex-1 bg-slate-100">
          {err ? <p className="text-sm text-red-600">{err}</p> : (
            <canvas
              ref={canvasRef}
              className="max-w-full h-auto mx-auto rounded-lg shadow touch-none cursor-crosshair"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                const [x, y] = canvasPoint(e);
                dragRef.current = { x, y };
                rectsRef.current = [...rectsRef.current, [x, y, 0, 0]];
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                const [x, y] = canvasPoint(e);
                const start = dragRef.current;
                const rects = rectsRef.current;
                rects[rects.length - 1] = [
                  Math.min(start.x, x), Math.min(start.y, y),
                  Math.abs(x - start.x), Math.abs(y - start.y),
                ];
                redraw();
              }}
              onPointerUp={() => {
                dragRef.current = null;
                // Rectangle-clic minuscule = raté — on l'enlève.
                const rects = rectsRef.current;
                const last = rects[rects.length - 1];
                if (last && (last[2] < 4 || last[3] < 4)) rectsRef.current = rects.slice(0, -1);
                redraw();
                forceRender((n) => n + 1);
              }}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200">
          <button
            onClick={() => { rectsRef.current = rectsRef.current.slice(0, -1); redraw(); forceRender((n) => n + 1); }}
            disabled={rectsRef.current.length === 0}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
          >
            Annuler le dernier
          </button>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700">Abandonner</button>
            <button
              onClick={async () => {
                const c = canvasRef.current;
                if (!c || rectsRef.current.length === 0) { onCancel(); return; }
                setSaving(true); setErr(null);
                try {
                  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('export impossible'))), 'image/jpeg', 0.92));
                  await onSave(blob);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                  setSaving(false);
                }
              }}
              disabled={saving || !ready}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Enregistrer la photo masquée
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
