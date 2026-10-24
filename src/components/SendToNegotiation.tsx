import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Check, Loader2, FolderPlus, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../services/auth';
import { canSeeTab } from '../lib/appTabs';
import { createNegotiation, listNegotiationFolders, createNegotiationFolder, moveNegotiationToFolder, updateNegotiation, listNegotiations, type NegotiationFolder } from '../services/workflow';
import { startNegoExtraction } from '../services/negoExtraction';
import { writeNote } from '../lib/noteJournal';
import { listingKey } from '../lib/listingKey';
import { humanListingUrl } from '../services/marketData';
import { resolveListingLink } from '../services/listingLink';

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
  /** 'menu' = les trois points ouverts ; 'form' = la fenêtre dossier + note. */
  const [open, setOpen] = useState<false | 'menu' | 'form'>(false);
  const [folders, setFolders] = useState<NegotiationFolder[]>([]);
  const [folderId, setFolderId] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open !== 'form') return;
    void listNegotiationFolders().then(setFolders);
    const key = listingKey(url);
    void listNegotiations().then((rows) => setAlready(!!key && rows.some((n) => listingKey(n.listing_url) === key)));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, url]);
  useEffect(() => {
    if (open !== 'menu') return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!allowed || !url.startsWith('http')) return null;

  const send = async () => {
    setBusy(true); setError(null);
    try {
      // Lien Gaspedaal bloqué (21/10) : la fiche chez le vendeur si le worker la trouve, sinon le lien tel quel.
      const human = humanListingUrl(url);
      const clean = (await resolveListingLink(human)) ?? human;
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

  // Trois petits points (13/10, Channing : « un bouton d'options, sans toucher au bouton Ouvrir ») — le menu porte l'action.
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen((o) => (o ? false : 'menu'))} title="Options de l'annonce" aria-haspopup="menu" aria-expanded={!!open} className={`p-0.5 rounded ${open ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open === 'menu' && (
        <div role="menu" className="absolute right-0 top-6 z-30 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-xs text-left">
          {done
            ? <span className="flex items-center gap-2 px-3 py-2 text-emerald-700"><Check className="w-3.5 h-3.5" /> Dans tes négociations</span>
            : <button role="menuitem" onClick={() => setOpen('form')} className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"><MessageSquare className="w-3.5 h-3.5 text-brand-ocean" /> Envoyer en négociation…</button>}
        </div>
      )}
      {open === 'form' && (
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
