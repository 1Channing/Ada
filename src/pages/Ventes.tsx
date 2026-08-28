import { useEffect, useRef, useState } from 'react';
import { MessageSquare, FileText, MoreVertical, ExternalLink, Plus, Images, Loader2, Sparkles } from 'lucide-react';
import { Administrative } from './Administrative';
import {
  Negotiation, listNegotiations, createNegotiation, updateNegotiation,
  deleteNegotiation, pushNegotiationToSale, extractListingDetail,
} from '../services/workflow';
import { NegotiationPhotosModal } from '../components/NegotiationPhotos';
import { resumeNegoExtractions, subscribeNegoExtractions, isExtracting } from '../services/negoExtraction';

/**
 * Ventes (ex-Administratif) : pipeline Négociations (perso) → Ventes (équipe).
 * L'onglet Ventes est la page administrative existante, intacte.
 */

type Tab = 'negotiations' | 'sales';

export function Ventes() {
  const [tab, setTab] = useState<Tab>('negotiations');
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {[
            { id: 'negotiations' as Tab, label: 'Négociations', icon: MessageSquare },
            { id: 'sales' as Tab, label: 'Ventes', icon: FileText },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-3 flex items-center gap-2 border-b-2 transition-colors ${
                tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-700'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'negotiations' && <NegotiationsTab onPushed={() => setTab('sales')} />}
      {tab === 'sales' && <Administrative />}
    </div>
  );
}

const fmtEur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);

function NegotiationsTab({ onPushed }: { onPushed: () => void }) {
  const [rows, setRows] = useState<Negotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const reload = () => { listNegotiations().then(setRows).finally(() => setLoading(false)); };
  useEffect(reload, []);
  // Extractions d'arrière-plan : reprise des jobs interrompus (navigation,
  // rechargement) + re-render à chaque changement d'état (spinner de ligne,
  // compteur de photos à l'arrivée).
  useEffect(() => {
    resumeNegoExtractions();
    return subscribeNegoExtractions(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error: err } = await createNegotiation(title.trim() || url.trim() || 'Négociation', url.trim(), price ? Number(price) : null);
    if (err) { setError(err); return; }
    setAdding(false); setTitle(''); setUrl(''); setPrice(''); setError(null); reload();
  };

  // Ajout par la SEULE URL (annonce hors ADA) : le worker lit la page —
  // titre, prix affiché, photos re-hébergées — et la négo se crée pré-remplie.
  // Ce que TU as tapé (titre/prix) prime toujours sur ce que lit ADA.
  const analyze = async () => {
    const u = url.trim();
    if (!u.startsWith('http')) { setError("Colle d'abord l'URL de l'annonce"); return; }
    setAnalyzing(true); setError(null);
    try {
      const r = await extractListingDetail(u);
      const { id, error: err } = await createNegotiation(
        title.trim() || r.title || u,
        u,
        price ? Number(price) : r.price,
        r.photos,
      );
      if (err) throw new Error(err);
      void id;
      setAdding(false); setTitle(''); setUrl(''); setPrice(''); reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setAnalyzing(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Négociations en cours</h2>
          <p className="text-sm text-slate-600 mt-1">Tes annonces enregistrées — pousse-les en vente quand l'affaire se conclut.</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Ajouter
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Titre</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="BMW iX1 xLine — Munich" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL de l'annonce</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Prix affiché (€)</label>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white self-end transition-colors">OK</button>
          </div>
          <div className="md:col-span-4 flex items-center gap-2">
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing || !url.trim().startsWith('http')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-50 transition-colors"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {analyzing ? 'Lecture de l\'annonce…' : "Analyser l'annonce"}
            </button>
            <span className="text-xs text-slate-500">Colle juste l'URL : ADA lit titre, prix et photos, puis crée la négociation.</span>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Aucune négociation — enregistre une annonce depuis l'accueil (Nouvelles annonces) ou ajoute-la ici.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {rows.map((n) => <NegoRow key={n.id} n={n} onChanged={reload} onPushed={onPushed} />)}
          </div>
        )}
    </div>
  );
}

function NegoRow({ n, onChanged, onPushed }: { n: Negotiation; onChanged: () => void; onPushed: () => void }) {
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(n.notes);
  const [showNotes, setShowNotes] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const pushed = n.status === 'pushed_to_sale';

  return (
    <div className="relative px-4 py-3 group">
      {/* Première photo en fond du bord gauche, fondue vers le blanc (même
          esprit que les cartes du site MC Export) — le voile blanc garde
          titre et icônes lisibles par-dessus. Le rognage vit sur CE calque
          (jamais sur la bande : un overflow-hidden de ligne coupait le menu
          ⋯ — régression du 28/08), arrondi seulement aux lignes extrêmes. */}
      {n.photos[0] && (
        <div aria-hidden className="absolute inset-0 overflow-hidden group-first:rounded-t-xl group-last:rounded-b-xl">
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[45%] bg-cover bg-center"
            style={{ backgroundImage: `url(${n.photos[0]})` }}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[45%] bg-gradient-to-r from-white/65 via-white/85 to-white" />
        </div>
      )}
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 truncate">{n.title}</span>
            {pushed && <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">Poussée en vente</span>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Prix affiché {fmtEur(n.asking_price)}
            {n.negotiated_price != null && <> · négocié <span className="text-emerald-700 font-medium">{fmtEur(n.negotiated_price)}</span></>}
            {' · '}{new Date(n.updated_at).toLocaleDateString('fr-FR')}
          </p>
        </div>
        {n.listing_url?.startsWith('http') && (
          <a href={n.listing_url} target="_blank" rel="noreferrer" title="Ouvrir l'annonce" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"><ExternalLink className="w-4 h-4" /></a>
        )}
        <button
          onClick={() => setShowPhotos(true)}
          title={isExtracting(n.id) ? 'Extraction des photos en cours…' : 'Photos & PDF'}
          className={`flex items-center gap-1 p-1.5 rounded-lg shrink-0 ${n.photos.length ? 'text-brand-ocean bg-blue-50 hover:bg-blue-100' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          <Images className="w-4 h-4" />
          {n.photos.length > 0 && <span className="text-[11px] font-semibold">{n.photos.length}</span>}
          {/* Extraction en cours, fenêtre fermée → le témoin vit sur la ligne. */}
          {isExtracting(n.id) && !showPhotos && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-ocean" />}
        </button>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className={`text-xs px-2 py-1 rounded-lg shrink-0 ${n.notes ? 'text-brand-ocean bg-blue-50' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Notes{n.notes ? ' •' : ''}
        </button>
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><MoreVertical className="w-4 h-4" /></button>
          {menu && (
            // Mobile : feuille ancrée en bas d'écran — uniquement des ajouts max-md: (inertes sur PC).
            <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-56 text-sm max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2">
              {!pushed && (
                <MenuBtn onClick={async () => {
                  setMenu(false);
                  const { error } = await pushNegotiationToSale(n);
                  if (error) alert(error);
                  else { onChanged(); onPushed(); }
                }}>Ajouter aux ventes (dossier)</MenuBtn>
              )}
              <MenuBtn onClick={async () => {
                setMenu(false);
                const t = prompt('Nouveau nom :', n.title);
                if (t?.trim()) { await updateNegotiation(n.id, { title: t.trim() }); onChanged(); }
              }}>Changer le nom</MenuBtn>
              <MenuBtn onClick={async () => {
                setMenu(false);
                const p = prompt('Prix d’achat négocié (€) :', String(n.negotiated_price ?? n.asking_price ?? ''));
                if (p != null && p.trim() !== '') { await updateNegotiation(n.id, { negotiated_price: Number(p) || null }); onChanged(); }
              }}>Modifier le prix négocié</MenuBtn>
              <MenuBtn danger onClick={async () => {
                setMenu(false);
                if (confirm(`Supprimer la négociation « ${n.title} » ?`)) { await deleteNegotiation(n.id); onChanged(); }
              }}>Supprimer</MenuBtn>
            </div>
          )}
        </div>
      </div>
      {showPhotos && (
        <NegotiationPhotosModal nego={n} onClose={() => setShowPhotos(false)} onChanged={onChanged} />
      )}
      {showNotes && (
        <div className="relative mt-2 flex gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Contact vendeur, contre-offre, état réel…"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <button
            onClick={async () => { await updateNegotiation(n.id, { notes }); setShowNotes(false); onChanged(); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-ocean text-white self-end"
          >
            Enregistrer
          </button>
        </div>
      )}
    </div>
  );
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 max-md:py-3 hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-slate-700'}`}
    >
      {children}
    </button>
  );
}
