import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Crop, Download, ImagePlus, Loader2, Paintbrush, RefreshCw, Trash2, X } from 'lucide-react';
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
  const [cropIdx, setCropIdx] = useState<number | null>(null);
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
    // RE-extraire = rafraîchir le jeu scrapé : les photos brutes du scrape
    // précédent (photo_NN) sont REMPLACÉES — chaque miroir a une URL neuve,
    // les additionner dupliquait tout (constat 28/08). Ajouts manuels,
    // masquées et rognées sont préservés.
    const kept = photos.filter((p) => !/\/negotiations\/[^/]+\/photo_\d+\./.test(p));
    await persist([...kept, ...r.photos]);
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
                    <IconBtn title="Rogner" onClick={() => setCropIdx(i)}><Crop className="w-4 h-4" /></IconBtn>
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
      {cropIdx != null && photos[cropIdx] && (
        <CropEditor
          url={photos[cropIdx]}
          onCancel={() => setCropIdx(null)}
          onSave={async (blob) => {
            const cropped = await uploadPhoto(nego.id, blob, 'crop');
            const next = photos.map((p, j) => (j === cropIdx ? cropped : p));
            setCropIdx(null);
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
 * photo (bordereaux, plaques pro, logos vendeur). Chaque rectangle reste un
 * OBJET éditable tant qu'on n'enregistre pas : clic pour le sélectionner,
 * glisser pour le DÉPLACER, poignée ronde au-dessus pour le faire TOURNER
 * (plaques photographiées de biais — demande 28/08). Enregistrer produit une
 * NOUVELLE image dans le storage — l'originale n'est jamais réécrite.
 * (Masquage automatique = détection visuelle, prévu avec l'étage vision.)
 */
interface MaskRect { cx: number; cy: number; w: number; h: number; a: number }

function MaskEditor({ url, onSave, onCancel }: { url: string; onSave: (b: Blob) => Promise<void>; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rectsRef = useRef<MaskRect[]>([]);
  const selRef = useRef<number | null>(null);
  const dragRef = useRef<
    | { mode: 'draw'; x0: number; y0: number }
    | { mode: 'move'; dx: number; dy: number }
    | { mode: 'rotate' }
    | null
  >(null);
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

  // Taille des poignées PROPORTIONNELLE à l'image (une 1600 px affichée en
  // 800 rendrait une poignée fixe deux fois trop petite au doigt).
  const handleR = () => Math.max(12, Math.round((canvasRef.current?.width ?? 800) / 70));

  /** Point du pointeur → coordonnées internes du canvas. */
  const canvasPoint = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  /** Point exprimé dans le repère LOCAL du rectangle (centre, dé-tourné). */
  const toLocal = (r: MaskRect, x: number, y: number): [number, number] => {
    const dx = x - r.cx, dy = y - r.cy;
    const cos = Math.cos(-r.a), sin = Math.sin(-r.a);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  };

  const hitRect = (r: MaskRect, x: number, y: number): boolean => {
    const [lx, ly] = toLocal(r, x, y);
    return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2;
  };

  const hitRotateHandle = (r: MaskRect, x: number, y: number): boolean => {
    const [lx, ly] = toLocal(r, x, y);
    const hy = -r.h / 2 - handleR() * 2.2;
    return Math.hypot(lx, ly - hy) <= handleR() * 1.4;
  };

  /** withOverlays=false : rendu EXPORT — jamais de poignées dans le fichier. */
  const redraw = (withOverlays = true) => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, 0, 0);
    rectsRef.current.forEach((r, i) => {
      ctx.save();
      ctx.translate(r.cx, r.cy);
      ctx.rotate(r.a);
      ctx.fillStyle = '#000';
      ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      if (withOverlays && selRef.current === i) {
        const hr = handleR();
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = Math.max(2, hr / 5);
        ctx.setLineDash([hr / 1.5, hr / 2.5]);
        ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
        ctx.setLineDash([]);
        // Poignée de rotation au-dessus du bord haut.
        ctx.beginPath();
        ctx.moveTo(0, -r.h / 2);
        ctx.lineTo(0, -r.h / 2 - hr * 2.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -r.h / 2 - hr * 2.2, hr, 0, Math.PI * 2);
        ctx.fillStyle = '#60a5fa';
        ctx.fill();
      }
      ctx.restore();
    });
  };

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h4 className="font-semibold text-slate-900">Masquer des zones</h4>
            <p className="text-xs text-slate-500">Trace un rectangle sur chaque info à cacher — clique-le pour le déplacer, poignée ronde pour le faire pivoter.</p>
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
                const rects = rectsRef.current;
                const sel = selRef.current;
                // 1. Poignée de rotation du rectangle sélectionné ?
                if (sel != null && rects[sel] && hitRotateHandle(rects[sel], x, y)) {
                  dragRef.current = { mode: 'rotate' };
                  return;
                }
                // 2. Un rectangle existant (le plus récent au-dessus) ?
                for (let i = rects.length - 1; i >= 0; i--) {
                  if (hitRect(rects[i], x, y)) {
                    selRef.current = i;
                    dragRef.current = { mode: 'move', dx: x - rects[i].cx, dy: y - rects[i].cy };
                    redraw(); forceRender((n) => n + 1);
                    return;
                  }
                }
                // 3. Zone vide → nouveau rectangle.
                selRef.current = null;
                dragRef.current = { mode: 'draw', x0: x, y0: y };
                rectsRef.current = [...rects, { cx: x, cy: y, w: 0, h: 0, a: 0 }];
                redraw(); forceRender((n) => n + 1);
              }}
              onPointerMove={(e) => {
                const drag = dragRef.current;
                if (!drag) return;
                const [x, y] = canvasPoint(e);
                const rects = rectsRef.current;
                if (drag.mode === 'draw') {
                  const r = rects[rects.length - 1];
                  r.cx = (drag.x0 + x) / 2; r.cy = (drag.y0 + y) / 2;
                  r.w = Math.abs(x - drag.x0); r.h = Math.abs(y - drag.y0);
                } else if (drag.mode === 'move' && selRef.current != null) {
                  const r = rects[selRef.current];
                  r.cx = x - drag.dx; r.cy = y - drag.dy;
                } else if (drag.mode === 'rotate' && selRef.current != null) {
                  const r = rects[selRef.current];
                  // La poignée vit au-dessus du centre : angle du pointeur + π/2.
                  r.a = Math.atan2(y - r.cy, x - r.cx) + Math.PI / 2;
                }
                redraw();
              }}
              onPointerUp={() => {
                const drag = dragRef.current;
                dragRef.current = null;
                if (drag?.mode === 'draw') {
                  const rects = rectsRef.current;
                  const last = rects[rects.length - 1];
                  if (last && (last.w < 4 || last.h < 4)) {
                    rectsRef.current = rects.slice(0, -1); // clic minuscule = raté
                  } else {
                    selRef.current = rectsRef.current.length - 1;
                  }
                }
                redraw();
                forceRender((n) => n + 1);
              }}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200">
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (selRef.current != null) {
                  rectsRef.current = rectsRef.current.filter((_, i) => i !== selRef.current);
                  selRef.current = null;
                } else {
                  rectsRef.current = rectsRef.current.slice(0, -1);
                }
                redraw(); forceRender((n) => n + 1);
              }}
              disabled={rectsRef.current.length === 0}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
            >
              {selRef.current != null ? 'Supprimer la zone' : 'Annuler le dernier'}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700">Abandonner</button>
            <button
              onClick={async () => {
                const c = canvasRef.current;
                if (!c || rectsRef.current.length === 0) { onCancel(); return; }
                setSaving(true); setErr(null);
                try {
                  // EXPORT sans poignées ni pointillés — rendu propre seul.
                  selRef.current = null;
                  redraw(false);
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

/**
 * Rognage (demande 28/08) : UN cadre — coins et bords pour redimensionner,
 * intérieur pour déplacer, extérieur assombri. Enregistrer exporte la seule
 * zone cadrée en NOUVELLE image (l'originale n'est jamais réécrite).
 */
function CropEditor({ url, onSave, onCancel }: { url: string; onSave: (b: Blob) => Promise<void>; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  const dragRef = useRef<{ kind: string; x0: number; y0: number; box0: { x: number; y: number; w: number; h: number } } | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setErr('Photo inaccessible pour édition');
    img.src = url;
  }, [url]);

  const handleR = () => Math.max(12, Math.round((canvasRef.current?.width ?? 800) / 70));
  const MIN = 40; // taille minimale du cadre (px image)

  const canvasPoint = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  const redraw = () => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, 0, 0);
    const b = boxRef.current;
    // Extérieur assombri (4 bandes autour du cadre).
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, c.width, b.y);
    ctx.fillRect(0, b.y + b.h, c.width, c.height - b.y - b.h);
    ctx.fillRect(0, b.y, b.x, b.h);
    ctx.fillRect(b.x + b.w, b.y, c.width - b.x - b.w, b.h);
    const hr = handleR();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = Math.max(2, hr / 5);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    // Poignées : coins pleins, milieux de bords.
    ctx.fillStyle = '#60a5fa';
    for (const [hx, hy] of [
      [b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h],
      [b.x + b.w / 2, b.y], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2],
    ]) {
      ctx.beginPath(); ctx.arc(hx, hy, hr * 0.8, 0, Math.PI * 2); ctx.fill();
    }
  };

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    // Cadre initial : image entière — on ne rogne que ce qu'on retire.
    boxRef.current = { x: 0, y: 0, w: c.width, h: c.height };
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** Quelle prise au point (x,y) ? nw/ne/sw/se, n/s/w/e, move, ou rien. */
  const hitKind = (x: number, y: number): string | null => {
    const b = boxRef.current, t = handleR() * 1.6;
    const nearX0 = Math.abs(x - b.x) <= t, nearX1 = Math.abs(x - (b.x + b.w)) <= t;
    const nearY0 = Math.abs(y - b.y) <= t, nearY1 = Math.abs(y - (b.y + b.h)) <= t;
    const inX = x >= b.x - t && x <= b.x + b.w + t;
    const inY = y >= b.y - t && y <= b.y + b.h + t;
    if (nearX0 && nearY0) return 'nw';
    if (nearX1 && nearY0) return 'ne';
    if (nearX0 && nearY1) return 'sw';
    if (nearX1 && nearY1) return 'se';
    if (nearY0 && inX) return 'n';
    if (nearY1 && inX) return 's';
    if (nearX0 && inY) return 'w';
    if (nearX1 && inY) return 'e';
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return 'move';
    return null;
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h4 className="font-semibold text-slate-900">Rogner la photo</h4>
            <p className="text-xs text-slate-500">Ajuste le cadre par ses coins/bords, déplace-le depuis l'intérieur — seul le cadre est conservé.</p>
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
                const kind = hitKind(x, y);
                if (kind) dragRef.current = { kind, x0: x, y0: y, box0: { ...boxRef.current } };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                const c = canvasRef.current;
                if (!d || !c) return;
                const [x, y] = canvasPoint(e);
                const dx = x - d.x0, dy = y - d.y0;
                const b0 = d.box0;
                let { x: bx, y: by, w: bw, h: bh } = b0;
                if (d.kind === 'move') {
                  bx = Math.min(Math.max(0, b0.x + dx), c.width - b0.w);
                  by = Math.min(Math.max(0, b0.y + dy), c.height - b0.h);
                } else {
                  let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
                  if (d.kind.includes('w')) x0 = Math.min(Math.max(0, b0.x + dx), x1 - MIN);
                  if (d.kind.includes('e')) x1 = Math.max(Math.min(c.width, b0.x + b0.w + dx), x0 + MIN);
                  if (d.kind.includes('n')) y0 = Math.min(Math.max(0, b0.y + dy), y1 - MIN);
                  if (d.kind.includes('s')) y1 = Math.max(Math.min(c.height, b0.y + b0.h + dy), y0 + MIN);
                  bx = x0; by = y0; bw = x1 - x0; bh = y1 - y0;
                }
                boxRef.current = { x: bx, y: by, w: bw, h: bh };
                redraw();
              }}
              onPointerUp={() => { dragRef.current = null; }}
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700">Abandonner</button>
          <button
            onClick={async () => {
              const img = imgRef.current;
              const b = boxRef.current;
              if (!img) return;
              const c = canvasRef.current;
              if (c && b.w >= c.width - 1 && b.h >= c.height - 1) { onCancel(); return; } // rien rogné
              setSaving(true); setErr(null);
              try {
                const out = document.createElement('canvas');
                out.width = Math.round(b.w); out.height = Math.round(b.h);
                // Recadrage depuis l'IMAGE source (jamais depuis le canvas
                // d'aperçu — il porte l'assombrissement et les poignées).
                out.getContext('2d')!.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
                const blob = await new Promise<Blob>((res, rej) => out.toBlob((bl) => (bl ? res(bl) : rej(new Error('export impossible'))), 'image/jpeg', 0.92));
                await onSave(blob);
              } catch (e2) {
                setErr(e2 instanceof Error ? e2.message : String(e2));
                setSaving(false);
              }
            }}
            disabled={saving || !ready}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer la photo rognée
          </button>
        </div>
      </div>
    </div>
  );
}
