import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Check, Loader2, FolderPlus } from 'lucide-react';
import { useAuth } from '../services/auth';
import { canSeeTab } from '../lib/appTabs';
import { createNegotiation, listNegotiationFolders, createNegotiationFolder, moveNegotiationToFolder, updateNegotiation, listNegotiations, type NegotiationFolder } from '../services/workflow';
import { startNegoExtraction } from '../services/negoExtraction';
import { writeNote } from '../lib/noteJournal';
import { listingKey } from '../lib/listingKey';
import { humanListingUrl } from '../services/marketData';

/**
 * ENVOYER UNE ANNONCE EN NÉGOCIATION depuis le Market Intelligence (13/10,
 * Channing : « sous le bouton Ouvrir, envoyer un véhicule dans les
 * négociations, préciser un dossier ou non, une note ou non — gain de
 * temps »). Un clic ouvre une petite fenêtre : dossier (ou nouveau), note ;
 * « Envoyer » crée la négociation avec le titre et le prix déjà connus, la
 * range, pose la note datée, et lance la lecture des photos en arrière-plan.
 * Une annonce déjà dans tes négociations le dit avant d'en créer une seconde.
 * Visible seulement avec l'onglet Négociations.
 */
export function SendToNegotiation({ url, title, price }: { url: string; title: string; price: number | null }) {
  const { allowedTabs, isAdmin } = useAuth();
  const allowed = canSeeTab(allowedTabs, isAdmin, 'wf:negociations');
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<NegotiationFolder[]>([]);
  const [folderId, setFolderId] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void listNegotiationFolders().then(setFolders);
    const key = listingKey(url);
    void listNegotiations().then((rows) => setAlready(!!key && rows.some((n) => listingKey(n.listing_url) === key)));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, url]);
  if (!allowed || !url.startsWith('http')) return null;

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const clean = humanListingUrl(url);
      const { id, error: err } = await createNegotiation(title.trim() || clean, clean, price, [], null);
      if (err || !id) throw new Error(err || 'création impossible');
      let fid = folderId;
      if (fid === '__new__') {
        const name = prompt('Nom du nouveau dossier :', '');
        if (name?.trim()) { const r = await createNegotiationFolder(name); if (r.error) throw new Error(r.error); fid = r.id ?? ''; } else fid = '';
      }
      if (fid) { const e2 = await moveNegotiationToFolder(id, fid); if (e2) throw new Error(e2); }
      if (note.trim()) await updateNegotiation(id, { notes: writeNote(note.trim()) });
      // Photos en arrière-plan : titre et prix sont déjà connus, on ne les écrase pas.
      void startNegoExtraction(id, clean, { title: !title.trim(), price: price == null }).catch(() => undefined);
      setDone(true); setOpen(false); setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  if (done) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700" title="Dans tes négociations"><Check className="w-3 h-3" /> en négo</span>;
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="Envoyer dans mes négociations (dossier et note au choix)" className="inline-flex items-center gap-1 text-xs text-brand-ocean hover:underline">
        <MessageSquare className="w-3 h-3" /> Négo
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2 text-xs text-left" onClick={(e) => e.stopPropagation()}>
          <p className="font-semibold text-slate-800 truncate" title={title}>{title || 'Annonce'}</p>
          {already && <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Déjà dans tes négociations — « Envoyer » en crée une seconde.</p>}
          <label className="block text-slate-600">Dossier
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 bg-white">
              <option value="">Sans dossier</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              <option value="__new__">+ Nouveau dossier…</option>
            </select>
          </label>
          <label className="block text-slate-600">Note (facultative)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ex. à rappeler, vendeur pro…" className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300" />
          </label>
          {error && <p className="text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-800">Annuler</button>
            <button onClick={() => void send()} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-ocean text-white font-medium disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : folderId === '__new__' ? <FolderPlus className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />} Envoyer en négociation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
