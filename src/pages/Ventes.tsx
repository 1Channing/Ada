import { useEffect, useRef, useState } from 'react';
import { MessageSquare, FileText, MoreVertical, ExternalLink, Plus } from 'lucide-react';
import { Administrative } from './Administrative';
import {
  Negotiation, listNegotiations, createNegotiation, updateNegotiation,
  deleteNegotiation, pushNegotiationToSale,
} from '../services/workflow';

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

  const reload = () => { listNegotiations().then(setRows).finally(() => setLoading(false)); };
  useEffect(reload, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = await createNegotiation(title.trim() || url.trim() || 'Négociation', url.trim(), price ? Number(price) : null);
    if (err) { setError(err); return; }
    setAdding(false); setTitle(''); setUrl(''); setPrice(''); setError(null); reload();
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const pushed = n.status === 'pushed_to_sale';

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
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
          onClick={() => setShowNotes(!showNotes)}
          className={`text-xs px-2 py-1 rounded-lg shrink-0 ${n.notes ? 'text-brand-ocean bg-blue-50' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Notes{n.notes ? ' •' : ''}
        </button>
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><MoreVertical className="w-4 h-4" /></button>
          {menu && (
            <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-56 text-sm">
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
      {showNotes && (
        <div className="mt-2 flex gap-2">
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
      className={`w-full text-left px-4 py-2 hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-slate-700'}`}
    >
      {children}
    </button>
  );
}
