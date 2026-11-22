/**
 * CHOIX DES PHOTOS D'INSPECTION À PUBLIER (21/11, Channing : « qu'on puisse choisir celles qui apparaissent »).
 * S'ouvre tout seul après une publication dans l'Intra (et depuis le menu ⋯ d'une bonne affaire) : pour chaque
 * véhicule, les photos de son inspection, toutes cochées (les photos de dommages décochées) ; « Publier » les copie
 * dans la bonne affaire — visibles sur l'Accueil et sur mc-export.com. Sans inspection, on le dit et on passe.
 */
import { useEffect, useState } from 'react';
import { Loader2, X, ImagePlus, Check } from 'lucide-react';
import type { IntraItem } from '../services/intra';
import { candidatePhotos, publishInspectionPhotos, type CandidatePhoto } from '../services/intraPhotos';

interface Props { items: IntraItem[]; onClose: () => void; onDone: (added: number, errors: string[]) => void }
type Row = { item: IntraItem; loading: boolean; photos: CandidatePhoto[]; why: string | null; picked: Set<string> };

export function IntraPhotoPicker({ items, onClose, onDone }: Props) {
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({ item, loading: true, photos: [], why: null, picked: new Set<string>() })));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all(items.map(async (item) => {
      const r = await candidatePhotos(item).catch((e) => ({ inspection: null, photos: [], why: e instanceof Error ? e.message : String(e) }));
      if (!alive) return;
      setRows((rs) => rs.map((x) => (x.item.id === item.id ? { ...x, loading: false, photos: r.photos, why: r.why, picked: new Set(r.photos.filter((p) => p.kind === 'photo').map((p) => p.key)) } : x)));
    }));
    return () => { alive = false; };
  }, [items]);
  const toggle = (id: string, key: string) => setRows((rs) => rs.map((x) => { if (x.item.id !== id) return x; const s = new Set(x.picked); if (s.has(key)) s.delete(key); else s.add(key); return { ...x, picked: s }; }));
  const setAll = (id: string, on: boolean) => setRows((rs) => rs.map((x) => (x.item.id === id ? { ...x, picked: new Set(on ? x.photos.map((p) => p.key) : []) } : x)));
  const total = rows.reduce((a, x) => a + x.picked.size, 0);
  const loading = rows.some((x) => x.loading);
  const publish = async () => {
    let added = 0;
    const errors: string[] = [];
    for (const x of rows) {
      const picked = x.photos.filter((p) => x.picked.has(p.key));
      if (picked.length === 0) continue;
      setBusy(`${x.item.vehicle.brand} ${x.item.vehicle.model} : 0/${picked.length}`);
      const r = await publishInspectionPhotos(x.item, picked, (n) => setBusy(`${x.item.vehicle.brand} ${x.item.vehicle.model} : ${n}/${picked.length}`));
      added += r.added;
      if (r.error) errors.push(`${x.item.vehicle.brand} ${x.item.vehicle.model} : ${r.error}`);
    }
    setBusy(null);
    onDone(added, errors);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <ImagePlus className="w-5 h-5 text-brand-ocean" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Photos de l'inspection à publier</h3>
            <p className="text-xs text-slate-500">Cochées : elles apparaissent sur l'Accueil et sur mc-export.com. Les photos de dommages sont décochées par défaut.</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="ml-auto p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          {rows.map((x) => (
            <section key={x.item.id}>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className="text-sm font-semibold text-slate-800">{x.item.title?.trim() || `${x.item.vehicle.brand} ${x.item.vehicle.model}`}</span>
                <span className="text-xs text-slate-500">{x.item.vehicle.vin || x.item.vehicle.version}</span>
                {(x.item.photos ?? []).length > 0 && <span className="text-[11px] text-slate-500">déjà {x.item.photos!.length} photo{x.item.photos!.length > 1 ? 's' : ''} publiée{x.item.photos!.length > 1 ? 's' : ''}</span>}
                {x.photos.length > 0 && (
                  <span className="ml-auto text-xs flex gap-2">
                    <button onClick={() => setAll(x.item.id, true)} className="text-brand-ocean hover:underline">toutes</button>
                    <button onClick={() => setAll(x.item.id, false)} className="text-brand-ocean hover:underline">aucune</button>
                  </span>
                )}
              </div>
              {x.loading ? <p className="text-xs text-slate-500 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> recherche de l'inspection et de ses photos…</p>
                : x.photos.length === 0 ? <p className="text-xs text-slate-500">Rien à proposer : {x.why ?? 'pas de photo'}. Vous pouvez toujours ajouter des photos à la main dans la liste.</p>
                  : (
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
                      {x.photos.map((p) => {
                        const on = x.picked.has(p.key);
                        return (
                          <button key={p.key} type="button" onClick={() => toggle(x.item.id, p.key)} title={p.kind === 'dommage' ? `Dommage${p.caption ? ` : ${p.caption}` : ''}` : 'Photo du rapport'}
                            className={`relative rounded-lg overflow-hidden border-2 ${on ? 'border-brand-ocean' : 'border-slate-200 opacity-60 hover:opacity-100'}`}>
                            <img src={p.url} alt="" loading="lazy" className="w-full h-24 object-cover" />
                            <span className={`absolute top-1 left-1 w-5 h-5 rounded grid place-items-center ${on ? 'bg-brand-ocean text-white' : 'bg-white/90 border border-slate-300'}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
                            {p.kind === 'dommage' && <span className="absolute bottom-0 inset-x-0 bg-amber-500/90 text-white text-[10px] px-1 truncate">dommage{p.caption ? ` · ${p.caption}` : ''}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
            </section>
          ))}
        </div>
        <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-200">
          <button onClick={() => void publish()} disabled={loading || !!busy || total === 0} className="inline-flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} {busy ? busy : `Publier ${total} photo${total > 1 ? 's' : ''}`}
          </button>
          <button onClick={onClose} disabled={!!busy} className="text-sm text-slate-500 hover:text-slate-800">{total === 0 && !loading ? 'Fermer' : 'Plus tard'}</button>
        </div>
      </div>
    </div>
  );
}
