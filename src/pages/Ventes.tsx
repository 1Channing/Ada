import { useEffect, useRef, useState } from 'react';
import { MessageSquare, FileText, MoreVertical, ExternalLink, Plus, Images, Loader2, Sparkles, Users, ArrowLeft, Share2, Trash2, Send } from 'lucide-react';
import { Administrative } from './Administrative';
import { useAuth } from '../services/auth';
import {
  Negotiation, listNegotiations, createNegotiation, updateNegotiation,
  deleteNegotiation, pushNegotiationToSale,
  NegoConflict, listNegotiationConflicts,
} from '../services/workflow';
import {
  OpenSpaceItem, OpenSpaceNote, listOpenSpace, listOpenSpaceNotes, pushToOpenSpace, removeFromOpenSpace,
  addOpenSpaceNote, deleteOpenSpaceNote, openSpaceUnseenCount, markOpenSpaceSeen,
} from '../services/openSpace';
import { NegotiationPhotosModal } from '../components/NegotiationPhotos';
import { resumeNegoExtractions, subscribeNegoExtractions, isExtracting, extractingCount, extractionError, startNegoExtraction } from '../services/negoExtraction';

/**
 * Ventes (ex-Administratif) : pipeline Négociations (perso) → Ventes (équipe).
 * Depuis le 05/09 (demande Channing) les deux onglets vivent dans le
 * Workflow, à la suite des études ; cette page reste le conteneur d'origine
 * (même composants) pour les anciens liens.
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

export function NegotiationsTab({ onPushed }: { onPushed: () => void }) {
  const [rows, setRows] = useState<Negotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Open space (05/09) : l'espace partagé, son badge de nouveautés et la
  // carte « quelle négo est déjà poussée » (menu ⋯ : partager / retirer).
  const [openSpace, setOpenSpace] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [shared, setShared] = useState<Map<string, string>>(new Map()); // negotiation_id → item id

  const [conflicts, setConflicts] = useState<NegoConflict[]>([]);
  const reload = () => {
    listNegotiations().then(setRows).finally(() => setLoading(false));
    listNegotiationConflicts().then(setConflicts);
    listOpenSpace().then((items) => setShared(new Map(items.map((i) => [i.negotiation_id, i.id]))));
    openSpaceUnseenCount().then(setUnseen);
  };
  useEffect(reload, []);
  // Badge Open space : rafraîchi toutes les 2 min tant que l'onglet est monté.
  useEffect(() => {
    const t = window.setInterval(() => { openSpaceUnseenCount().then(setUnseen); }, 120_000);
    return () => window.clearInterval(t);
  }, []);
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

  // Ajout par la SEULE URL (annonce hors ADA) : la négo se crée TOUT DE
  // SUITE et l'analyse part en ARRIÈRE-PLAN (demande Channing 31/08 — l'ancien
  // flux bloquait la fenêtre 2,5 min max et mobile.de dépassait : escalade
  // anti-bot 3 profils + miroir des photos = « Délai dépassé »). La fenêtre
  // se ferme, la ligne mouline, le suivi survit à la navigation (store
  // negoExtraction en localStorage). Ce que TU as tapé prime toujours : le
  // worker ne complète que les champs laissés vides.
  const analyze = async () => {
    const u = url.trim();
    if (!u.startsWith('http')) { setError("Colle d'abord l'URL de l'annonce"); return; }
    setAnalyzing(true); setError(null);
    try {
      const { id, error: err } = await createNegotiation(title.trim() || u, u, price ? Number(price) : null);
      if (err || !id) throw new Error(err || 'création impossible');
      await startNegoExtraction(id, u, { title: !title.trim(), price: !price });
      setAdding(false); setTitle(''); setUrl(''); setPrice(''); reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setAnalyzing(false);
  };

  if (openSpace) {
    return <OpenSpacePanel onBack={() => { setOpenSpace(false); reload(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Négociations en cours</h2>
          <p className="text-sm text-slate-600 mt-1">Tes annonces enregistrées — pousse-les en vente quand l'affaire se conclut.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setOpenSpace(true); setUnseen(0); void markOpenSpaceSeen(); }}
            title="L'espace partagé de l'équipe : les négociations poussées par chacun, avec les notes de tous"
            className="relative flex items-center gap-2 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 hover:text-brand-ocean px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Users className="w-4 h-4" /> Open space
            {unseen > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center shadow">
                {unseen > 99 ? '99+' : unseen}
              </span>
            )}
          </button>
          <button
            onClick={() => setAdding(!adding)}
            className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        </div>
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

      {/* Indicateur d'analyse PERSISTANT (demande 31/08) : visible tant que
          des analyses tournent, il revient tel quel si on change de page —
          le store vit en localStorage et reprend au montage. */}
      {extractingCount() > 0 && (
        <div className="flex items-center gap-2 text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <Sparkles className="w-4 h-4 shrink-0" />
          Analyse IA en cours — {extractingCount()} annonce{extractingCount() > 1 ? 's' : ''} (titre, prix et photos arrivent d'eux-mêmes, tu peux naviguer).
        </div>
      )}

      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Aucune négociation — enregistre une annonce depuis l'accueil (Nouvelles annonces) ou ajoute-la ici.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {rows.map((n) => <NegoRow key={n.id} n={n} conflicts={conflicts} sharedItemId={shared.get(n.id) ?? null} onChanged={reload} onPushed={onPushed} />)}
          </div>
        )}
    </div>
  );
}

function NegoRow({ n, conflicts, sharedItemId, onChanged, onPushed }: { n: Negotiation; conflicts: NegoConflict[]; sharedItemId: string | null; onChanged: () => void; onPushed: () => void }) {
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(n.notes);
  const [showNotes, setShowNotes] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const { userId } = useAuth();
  // Même annonce (URL identique) ouverte par un COLLÈGUE → anti-collision.
  const myUrl = (n.listing_url ?? '').trim();
  const others = myUrl
    ? conflicts.filter((c) => c.owner_id !== userId && c.listing_url.trim() === myUrl)
    : [];

  useEffect(() => {
    if (!showConflict) return;
    const close = (e: MouseEvent) => { if (!conflictRef.current?.contains(e.target as Node)) setShowConflict(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showConflict]);

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
          {/* Photo tout à gauche sous voile blanc — l'essai « décalée à
              droite » du 29/08 n'a pas plu, retour au premier placement. */}
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
            {sharedItemId && <span title="Visible par toute l'équipe dans l'Open space" className="flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 shrink-0"><Share2 className="w-3 h-3" /> Open space</span>}
            {others.length > 0 && (
              <div className="relative shrink-0" ref={conflictRef}>
                <button
                  onClick={() => setShowConflict(!showConflict)}
                  className="flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5 hover:bg-amber-100 transition-colors"
                >
                  <Users className="w-3 h-3" />
                  Déjà en négo · {others[0].owner_name}{others.length > 1 ? ` +${others.length - 1}` : ''}
                </button>
                {showConflict && (
                  <div className="absolute left-0 top-7 z-30 w-80 bg-white border border-amber-200 rounded-xl shadow-lg p-3 space-y-3">
                    {others.map((c, i) => (
                      <div key={i} className="text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800">{c.owner_name}</span>
                          <span className="text-slate-400">
                            depuis le {new Date(c.created_at).toLocaleDateString('fr-FR')} à {new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-600 whitespace-pre-wrap">
                          {c.notes?.trim() ? c.notes : <span className="italic text-slate-400">Pas de notes.</span>}
                        </p>
                        {c.updated_at !== c.created_at && (
                          <p className="text-[10px] text-slate-400">dernière activité le {new Date(c.updated_at).toLocaleDateString('fr-FR')} à {new Date(c.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">Lecture seule — parlez-vous avant de doubler l'offre.</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Prix affiché {fmtEur(n.asking_price)}
            {n.negotiated_price != null && <> · négocié <span className="text-emerald-700 font-medium">{fmtEur(n.negotiated_price)}</span></>}
            {' · '}{new Date(n.updated_at).toLocaleDateString('fr-FR')}
          </p>
          {/* Analyse d'ajout échouée : le dire SUR la ligne (la fenêtre
              d'ajout est fermée depuis longtemps). */}
          {extractionError(n.id) && (
            <p className="text-[11px] text-red-600 mt-0.5">Analyse : {extractionError(n.id)}</p>
          )}
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
              {sharedItemId ? (
                <MenuBtn onClick={async () => {
                  setMenu(false);
                  const err = await removeFromOpenSpace(sharedItemId);
                  if (err) alert(err); else onChanged();
                }}>Retirer de l'Open space</MenuBtn>
              ) : (
                <MenuBtn onClick={async () => {
                  setMenu(false);
                  const msg = prompt("Un mot pour l'équipe (facultatif) :", '') ?? '';
                  const err = await pushToOpenSpace(n.id, msg.trim());
                  if (err) alert(err); else onChanged();
                }}>Partager dans l'Open space</MenuBtn>
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

// ── Open space : l'espace partagé de l'équipe ───────────────────────────────

const fmtWhen = (iso: string) => `${new Date(iso).toLocaleDateString('fr-FR')} ${new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

function OpenSpacePanel({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<OpenSpaceItem[]>([]);
  const [notes, setNotes] = useState<OpenSpaceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    Promise.all([listOpenSpace(), listOpenSpaceNotes()])
      .then(([i, n]) => { setItems(i); setNotes(n); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);
  // Les nouveautés des collègues arrivent d'elles-mêmes tant qu'on est ici.
  useEffect(() => {
    const t = window.setInterval(reload, 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg text-slate-600 hover:bg-slate-100" title="Retour à mes négociations"><ArrowLeft className="w-4 h-4" /></button>
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Users className="w-5 h-5 text-brand-ocean" /> Open space</h2>
            <p className="text-sm text-slate-600 mt-1">Les négociations que l'équipe a choisi de partager — regarde, commente, coordonne.</p>
          </div>
        </div>
        <span className="text-xs text-slate-500">{items.length} annonce{items.length > 1 ? 's' : ''} partagée{items.length > 1 ? 's' : ''}</span>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p>
        : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
            Rien de partagé pour l'instant — depuis tes négociations, menu ⋯ → « Partager dans l'Open space ».
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((it) => (
              <OpenSpaceCard key={it.id} item={it} notes={notes.filter((n) => n.item_id === it.id)} onChanged={reload} onError={setError} />
            ))}
          </div>
        )}
    </div>
  );
}

function OpenSpaceCard({ item, notes, onChanged, onError }: { item: OpenSpaceItem; notes: OpenSpaceNote[]; onChanged: () => void; onError: (e: string | null) => void }) {
  const { userId, isAdmin } = useAuth();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const n = item.nego;
  const mine = item.pushed_by === userId;
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const err = await addOpenSpaceNote(item.id, body);
    setSending(false);
    if (err) { onError(err); return; }
    setDraft(''); onError(null); onChanged();
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex gap-4 p-4">
        {/* Vignette = ouvre l'atelier photos (ordre, rognage, ajout, PDF),
            le même que dans les négociations — l'équipe travaille les photos
            d'une annonce partagée (demande 05/09). */}
        <button
          onClick={() => n && setShowPhotos(true)}
          disabled={!n}
          title={n ? `Photos & PDF (${n.photos.length})` : ''}
          className="relative w-28 h-20 rounded-lg shrink-0 border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center text-slate-300 hover:ring-2 hover:ring-brand-ocean disabled:opacity-60"
        >
          {n?.photos[0]
            ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${n.photos[0]})` }} />
            : <Images className="w-6 h-6" />}
          {n && n.photos.length > 0 && (
            <span className="absolute bottom-1 right-1 flex items-center gap-1 text-[10px] font-semibold text-white bg-black/60 rounded px-1.5 py-0.5"><Images className="w-3 h-3" />{n.photos.length}</span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 truncate">{n?.title ?? 'Négociation retirée'}</span>
            {n?.status === 'pushed_to_sale' && <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Poussée en vente</span>}
            {n?.listing_url?.startsWith('http') && (
              <a href={n.listing_url} target="_blank" rel="noreferrer" title="Ouvrir l'annonce" className="p-1 rounded text-slate-500 hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></a>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {n && <>Prix affiché {fmtEur(n.asking_price)}{n.negotiated_price != null && <> · négocié <span className="text-emerald-700 font-medium">{fmtEur(n.negotiated_price)}</span></>}{n.photos.length > 0 && <> · {n.photos.length} photo{n.photos.length > 1 ? 's' : ''}</>} · </>}
            partagée par <span className="font-medium text-slate-700">{mine ? 'toi' : item.pushed_by_name}</span> le {fmtWhen(item.pushed_at)}
          </p>
          {item.message && <p className="text-sm text-slate-700 mt-1.5 whitespace-pre-wrap">« {item.message} »</p>}
          {n?.notes?.trim() && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap"><span className="font-medium">Notes de {mine ? 'ta' : 'sa'} négociation :</span> {n.notes}</p>}
        </div>
        {(mine || isAdmin) && (
          <button
            onClick={async () => { if (confirm("Retirer cette annonce de l'Open space ?")) { const err = await removeFromOpenSpace(item.id); if (err) onError(err); else onChanged(); } }}
            title="Retirer de l'Open space"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0 self-start"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {showPhotos && n && (
        <NegotiationPhotosModal nego={n} onClose={() => setShowPhotos(false)} onChanged={onChanged} />
      )}
      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-2">
        {notes.length === 0 && <p className="text-xs text-slate-400 italic">Pas encore de note — sois le premier.</p>}
        {notes.map((no) => (
          <div key={no.id} className="flex items-start gap-2 text-sm">
            <span className="text-xs font-semibold text-brand-ocean shrink-0 mt-0.5 w-20 truncate" title={no.author_name}>{no.author_id === userId ? 'toi' : no.author_name}</span>
            <p className="flex-1 text-slate-700 whitespace-pre-wrap">{no.body}</p>
            <span className="text-[11px] text-slate-400 shrink-0">{fmtWhen(no.created_at)}</span>
            {(no.author_id === userId || isAdmin) && (
              <button onClick={async () => { const err = await deleteOpenSpaceNote(no.id); if (err) onError(err); else onChanged(); }} className="text-slate-300 hover:text-red-600" title="Supprimer la note"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Laisser une note pour l'équipe…"
            className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          />
          <button onClick={send} disabled={sending || !draft.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-ocean text-white disabled:opacity-50">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Envoyer
          </button>
        </div>
      </div>
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
