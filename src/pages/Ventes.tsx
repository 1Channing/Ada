import { useEffect, useRef, useState } from 'react';
import { MessageSquare, FileText, MoreVertical, ExternalLink, Plus, Images, Loader2, Sparkles, Users, ArrowLeft, Share2, Trash2, Send, Folder, FolderPlus, ChevronDown, ChevronRight, Check, AlarmClock } from 'lucide-react';
import { listingKey } from '../lib/listingKey';
import { readNote, writeNote, lastNoteDate, agoLabel, worthRelaunch, RELANCE_AFTER_DAYS } from '../lib/noteJournal';
import { canSeeTab } from '../lib/appTabs';
import { createReminder } from '../services/userTasks';
import { defaultReminderWhen } from '../components/ReminderCenter';
import { Administrative } from './Administrative';
import { useAuth } from '../services/auth';
import {
  Negotiation, listNegotiations, createNegotiation, updateNegotiation,
  deleteNegotiation, pushNegotiationToSale, normalizeSaleReference,
  NegoConflict, listNegotiationConflicts,
  NegotiationFolder, listNegotiationFolders, createNegotiationFolder, renameNegotiationFolder,
  deleteNegotiationFolder, moveNegotiationToFolder,
} from '../services/workflow';
import {
  OpenSpaceItem, OpenSpaceNote, listOpenSpace, listOpenSpaceNotes, pushToOpenSpace, removeFromOpenSpace,
  addOpenSpaceNote, deleteOpenSpaceNote,
} from '../services/openSpace';
import { useOpenSpaceUnseen, clearOpenSpaceUnseen, refreshOpenSpaceUnseen } from '../hooks/useOpenSpaceUnseen';
import { NegotiationPhotosModal } from '../components/NegotiationPhotos';
import { StorageBg } from '../components/StorageLink';
import { contactSeller } from '../services/contactSeller';
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
  const { userId, allowedTabs, isAdmin } = useAuth();
  // Compte de prospection seule (Weecars, 12/10) : pas d'études → les textes
  // ne renvoient pas vers un onglet qu'il n'a pas.
  const hasStudies = canSeeTab(allowedTabs, isAdmin, 'wf:etudes') || canSeeTab(allowedTabs, isAdmin, 'wf:resultats');
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
  // Compteur partagé avec le bandeau et l'onglet (hooks/useOpenSpaceUnseen).
  const openSpaceNew = useOpenSpaceUnseen();
  const [shared, setShared] = useState<Map<string, string>>(new Map()); // negotiation_id → item id

  const [conflicts, setConflicts] = useState<NegoConflict[]>([]);
  // UN SEUL panneau de notes ouvert à la fois (12/10, Channing) : l'onglet
  // tient l'identifiant de la ligne ouverte, chaque ligne ferme (et
  // enregistre) quand une autre s'ouvre ou qu'on clique ailleurs.
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);
  // Dossiers (10/09) : personnels, nommés librement ; l'état replié/déplié
  // est un confort local (localStorage), jamais une donnée.
  const [folders, setFolders] = useState<NegotiationFolder[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nego:folders:collapsed') ?? '[]') as string[]); } catch { return new Set(); }
  });
  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('nego:folders:collapsed', JSON.stringify([...next])); } catch { /* stockage indispo */ }
      return next;
    });
  };
  const newFolder = async (): Promise<string | null> => {
    const name = prompt('Nom du nouveau dossier :', '');
    if (!name?.trim()) return null;
    const { id, error: err } = await createNegotiationFolder(name);
    if (err) { setError(err); return null; }
    reload();
    return id;
  };
  const reload = () => {
    listNegotiations().then(setRows).finally(() => setLoading(false));
    listNegotiationFolders().then(setFolders);
    listNegotiationConflicts().then(setConflicts);
    listOpenSpace().then((items) => setShared(new Map(items.map((i) => [i.negotiation_id, i.id]))));
    void refreshOpenSpaceUnseen();
  };
  useEffect(reload, []);
  // Extractions d'arrière-plan : reprise des jobs interrompus (navigation,
  // rechargement) + re-render à chaque changement d'état (spinner de ligne,
  // compteur de photos à l'arrivée).
  useEffect(() => {
    resumeNegoExtractions();
    return subscribeNegoExtractions(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * DÉJÀ SUR L'ANNONCE (12/10, Channing pour Weecars) : même annonce (clé
   * d'URL — identifiant Leboncoin, UUID AutoScout…, pas l'URL brute) déjà
   * chez moi ou chez un collègue (RPC anti-collision) → on PRÉVIENT, avec la
   * date de sa dernière note : « si le dernier contact date de 3 semaines, ça
   * vaut le coup de relancer ». On n'empêche rien : « Ajouter quand même ».
   */
  const [dupWarn, setDupWarn] = useState<{ text: string; relaunch: boolean } | null>(null);
  const findDuplicate = (u: string): { text: string; relaunch: boolean } | null => {
    const key = listingKey(u);
    if (!key) return null;
    const mine = rows.find((r) => listingKey(r.listing_url) === key);
    if (mine) {
      const last = lastNoteDate(mine.notes, mine.updated_at);
      return { text: `Déjà dans tes négociations : « ${mine.title} » (ajoutée le ${new Date(mine.created_at).toLocaleDateString('fr-FR')}${last ? `, dernière note ${agoLabel(last)}` : ''}).`, relaunch: worthRelaunch(last) };
    }
    const other = conflicts.find((c) => c.owner_id !== userId && listingKey(c.listing_url) === key);
    if (other) {
      const last = lastNoteDate(other.notes, other.updated_at);
      return { text: `${other.owner_name} est déjà sur cette annonce depuis le ${new Date(other.created_at).toLocaleDateString('fr-FR')}${last ? ` — dernière note ${agoLabel(last)} (${last.toLocaleDateString('fr-FR')})` : ' — sans note'}.`, relaunch: worthRelaunch(last) };
    }
    return null;
  };

  // UN SEUL GESTE (12/10, Channing : « même s'ils cliquent sur Enregistrer
  // plutôt qu'Analyser, ça analyse ») : Enregistrer crée la négociation TOUT
  // DE SUITE et, dès qu'il y a une URL, l'analyse part en ARRIÈRE-PLAN
  // (demande 31/08 : la fenêtre se ferme, la ligne mouline, le suivi survit à
  // la navigation — store negoExtraction). Ce que TU as tapé prime toujours :
  // le worker ne complète que les champs laissés vides.
  const add = (e: React.FormEvent) => { e.preventDefault(); void submit(false); };
  const submit = async (force: boolean) => {
    const u = url.trim();
    if (!u && !title.trim()) { setError("Colle l'URL de l'annonce (ou au moins un titre)."); return; }
    if (!force) {
      const dup = u ? findDuplicate(u) : null;
      if (dup) { setDupWarn(dup); return; }
    }
    setDupWarn(null);
    setAnalyzing(true); setError(null);
    try {
      const { id, error: err } = await createNegotiation(title.trim() || u || 'Négociation', u, price ? Number(price) : null);
      if (err || !id) throw new Error(err || 'création impossible');
      if (u.startsWith('http')) await startNegoExtraction(id, u, { title: !title.trim(), price: !price });
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
            onClick={() => { void newFolder(); }}
            title="Créer un dossier pour classer tes négociations (nom libre)"
            className="flex items-center gap-2 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 hover:text-brand-ocean px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <FolderPlus className="w-4 h-4" /> Nouveau dossier
          </button>
          <button
            onClick={() => { setOpenSpace(true); clearOpenSpaceUnseen(); }}
            title="L'espace partagé de l'équipe : les négociations poussées par chacun, avec les notes de tous"
            className="relative flex items-center gap-2 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 hover:text-brand-ocean px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Users className="w-4 h-4" /> Open space
            {openSpaceNew > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center shadow">
                {openSpaceNew > 99 ? '99+' : openSpaceNew}
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
            <button type="submit" disabled={analyzing} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white self-end transition-colors disabled:opacity-50">
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Enregistrer
            </button>
          </div>
          <div className="md:col-span-4 text-xs text-slate-500">
            Colle l'URL : ADA enregistre tout de suite, puis lit l'annonce en arrière-plan (titre, prix, photos). Si quelqu'un est déjà sur l'annonce, ADA le dit, avec la date de sa dernière note.
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {dupWarn && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-3 flex-wrap">
          <Users className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <span className="flex-1 min-w-[240px]">
            {dupWarn.text}
            {dupWarn.relaunch
              ? <span className="block text-xs mt-0.5 text-emerald-800 font-medium">Plus de {RELANCE_AFTER_DAYS} jours sans note : une relance vaut le coup.</span>
              : <span className="block text-xs mt-0.5 text-amber-800">Parlez-vous avant de doubler l'offre.</span>}
          </span>
          <span className="flex items-center gap-2">
            <button onClick={() => void submit(true)} disabled={analyzing} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Ajouter quand même</button>
            <button onClick={() => setDupWarn(null)} className="text-xs text-slate-600 hover:text-slate-900">Annuler</button>
          </span>
        </div>
      )}

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
            {hasStudies ? "Aucune négociation — enregistre une annonce depuis l'accueil (Nouvelles annonces) ou ajoute-la ici." : "Aucune négociation — clique sur « Ajouter » et colle l'URL de l'annonce."}
          </div>
        ) : folders.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {rows.map((n) => <NegoRow key={n.id} n={n} folders={folders} onNewFolder={newFolder} conflicts={conflicts} sharedItemId={shared.get(n.id) ?? null} onChanged={reload} onPushed={onPushed} notesOpen={openNotesId === n.id} onNotesOpen={(open) => setOpenNotesId(open ? n.id : null)} />)}
          </div>
        ) : (
          // Regroupement par dossier (10/09) : les dossiers dans leur ordre,
          // puis « Sans dossier ». Un dossier dont l'id n'existe plus (supprimé
          // depuis un autre onglet) se lit comme « sans dossier ».
          <div className="space-y-3">
            {(() => {
              const known = new Set(folders.map((f) => f.id));
              const byFolder = new Map<string, Negotiation[]>();
              const loose: Negotiation[] = [];
              for (const n of rows) {
                if (n.folder_id && known.has(n.folder_id)) byFolder.set(n.folder_id, [...(byFolder.get(n.folder_id) ?? []), n]);
                else loose.push(n);
              }
              const sections: { id: string; folder: NegotiationFolder | null; items: Negotiation[] }[] = [
                ...folders.map((f) => ({ id: f.id, folder: f, items: byFolder.get(f.id) ?? [] })),
                { id: '__none__', folder: null, items: loose },
              ];
              return sections.map(({ id, folder, items }) => {
                if (!folder && items.length === 0) return null;
                const open = !collapsed.has(id);
                return (
                  <div key={id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
                    <FolderHeader
                      folder={folder} count={items.length} open={open}
                      onToggle={() => toggleFolder(id)}
                      onRename={folder ? async () => {
                        const name = prompt('Nouveau nom du dossier :', folder.name);
                        if (!name?.trim() || name.trim() === folder.name) return;
                        const err = await renameNegotiationFolder(folder.id, name);
                        if (err) setError(err); else reload();
                      } : undefined}
                      onDelete={folder ? async () => {
                        const what = items.length
                          ? `Supprimer le dossier « ${folder.name} » ? Ses ${items.length} négociation${items.length > 1 ? 's' : ''} restent en cours, simplement sans dossier.`
                          : `Supprimer le dossier « ${folder.name} » (vide) ?`;
                        if (!confirm(what)) return;
                        const err = await deleteNegotiationFolder(folder.id);
                        if (err) setError(err); else reload();
                      } : undefined}
                    />
                    {open && (
                      items.length === 0
                        ? <p className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">Dossier vide — range une négociation ici depuis son menu ⋯ → « Ranger dans un dossier ».</p>
                        : (
                          <div className="divide-y divide-slate-100 border-t border-slate-100">
                            {items.map((n) => <NegoRow key={n.id} n={n} folders={folders} onNewFolder={newFolder} conflicts={conflicts} sharedItemId={shared.get(n.id) ?? null} onChanged={reload} onPushed={onPushed} notesOpen={openNotesId === n.id} onNotesOpen={(open) => setOpenNotesId(open ? n.id : null)} />)}
                          </div>
                        )
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
    </div>
  );
}

function FolderHeader({ folder, count, open, onToggle, onRename, onDelete }: {
  folder: NegotiationFolder | null; count: number; open: boolean;
  onToggle: () => void; onRename?: () => void; onDelete?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-lg px-1 py-1 hover:bg-slate-50">
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        <Folder className={`w-4 h-4 shrink-0 ${folder ? 'text-amber-500' : 'text-slate-300'}`} />
        <span className={`font-semibold truncate ${folder ? 'text-slate-900' : 'text-slate-500'}`}>{folder ? folder.name : 'Sans dossier'}</span>
        <span className="text-xs text-slate-400 shrink-0">{count}</span>
      </button>
      {folder && (
        <div className="relative shrink-0" ref={ref}>
          <button onClick={() => setMenu(!menu)} title="Renommer ou supprimer le dossier" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><MoreVertical className="w-4 h-4" /></button>
          {menu && (
            <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-56 text-sm">
              <MenuBtn onClick={() => { setMenu(false); onRename?.(); }}>Renommer le dossier</MenuBtn>
              <MenuBtn danger onClick={() => { setMenu(false); onDelete?.(); }}>Supprimer le dossier</MenuBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NegoRow({ n, folders, onNewFolder, conflicts, sharedItemId, onChanged, onPushed, notesOpen, onNotesOpen }: {
  n: Negotiation; folders: NegotiationFolder[]; onNewFolder: () => Promise<string | null>;
  conflicts: NegoConflict[]; sharedItemId: string | null; onChanged: () => void; onPushed: () => void;
  notesOpen: boolean; onNotesOpen: (open: boolean) => void;
}) {
  const [askDelete, setAskDelete] = useState(false);
  // Passage en vente SOUS RÉFÉRENCE (18/09) : petite fenêtre qui demande la
  // REF du tableau — clé anti-doublon partagée avec la synchro du tableur.
  const [askRef, setAskRef] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const submitRef = async () => {
    const ref = normalizeSaleReference(refInput);
    if (!ref) { setRefError('Lettres et chiffres, comme dans le tableau : YC575, BM191.'); return; }
    setRefBusy(true); setRefError(null);
    const r = await pushNegotiationToSale(n, ref);
    setRefBusy(false);
    if (r.error) { setRefError(r.error); return; }
    setAskRef(false); setRefInput('');
    if (r.linked) alert(`Vente ${ref} déjà connue (tableur ou collègue) : la négociation a été rattachée à ce dossier, sans doublon.`);
    onChanged(); onPushed();
  };
  const [menu, setMenu] = useState(false);
  // Sous-menu « Ranger dans un dossier » : la liste des dossiers remplace le
  // menu principal (une seule feuille sur mobile).
  const [pickFolder, setPickFolder] = useState(false);
  const moveTo = async (folderId: string | null) => {
    setMenu(false); setPickFolder(false);
    if (folderId === (n.folder_id ?? null)) return;
    const err = await moveNegotiationToFolder(n.id, folderId);
    if (err) alert(err); else onChanged();
  };
  // UNE NOTE PAR ANNONCE, DATÉE À LA MODIFICATION (12/10, Channing : « plutôt
  // que d'empiler des notes, on modifie la note en cours et ça met à jour la
  // date »). Enregistrée toute seule : 1 s après la dernière frappe, à la
  // sortie du champ, quand le panneau se ferme (clic ailleurs, autre ligne,
  // Fermer), au démontage, quand l'onglet du navigateur se cache. La date
  // ne bouge que si le texte a changé. Les refs portent la vérité entre
  // deux rendus.
  const initialNote = readNote(n.notes);
  const [noteText, setNoteText] = useState(initialNote.text);
  const [noteAt, setNoteAt] = useState<Date | null>(initialNote.at);
  const [noteState, setNoteState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const noteTextRef = useRef(initialNote.text);
  const savedNotesRef = useRef(n.notes ?? '');
  const notesTimer = useRef<number | null>(null);
  const flushNotes = async () => {
    if (notesTimer.current) { window.clearTimeout(notesTimer.current); notesTimer.current = null; }
    const t = noteTextRef.current;
    if (t.trim() === readNote(savedNotesRef.current).text.trim()) return; // texte inchangé : la date reste
    const next = writeNote(t);
    setNoteState('saving');
    await updateNegotiation(n.id, { notes: next });
    savedNotesRef.current = next; setNoteAt(readNote(next).at);
    setNoteState('saved'); onChanged();
  };
  const onNotesChange = (v: string) => {
    setNoteText(v); noteTextRef.current = v; setNoteState('dirty');
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => void flushNotes(), 1000);
  };
  /** Note réécrite par ADA (trace « contacté le ») : état, refs et base déjà alignés. */
  const adoptNotes = (notes: string) => {
    const r = readNote(notes);
    setNoteText(r.text); noteTextRef.current = r.text; savedNotesRef.current = notes; setNoteAt(r.at); setNoteState('saved');
  };
  useEffect(() => () => {
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    if (noteTextRef.current.trim() !== readNote(savedNotesRef.current).text.trim()) void updateNegotiation(n.id, { notes: writeNote(noteTextRef.current) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Panneau fermé (autre ligne ouverte, clic ailleurs) → la note part.
  useEffect(() => { if (!notesOpen) void flushNotes(); }, [notesOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clic AILLEURS que dans le panneau ou son bouton : enregistre et ferme.
  const notesPanelRef = useRef<HTMLDivElement>(null);
  const notesBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!notesOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notesPanelRef.current?.contains(t) || notesBtnRef.current?.contains(t)) return;
      onNotesOpen(false);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') void flushNotes(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
  }, [notesOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rappel depuis l'annonce (12/10) : échéance + texte, visible dans la cloche.
  const [askReminder, setAskReminder] = useState(false);
  const [remTitle, setRemTitle] = useState('');
  const [remWhen, setRemWhen] = useState(defaultReminderWhen);
  const [remBusy, setRemBusy] = useState(false);
  const [remError, setRemError] = useState<string | null>(null);
  const submitReminder = async () => {
    if (!remWhen) { setRemError('Choisis une date.'); return; }
    setRemBusy(true); setRemError(null);
    const err = await createReminder({ title: remTitle.trim() || `Relancer : ${n.title}`, dueAt: new Date(remWhen).toISOString(), negotiationId: n.id, link: '/workflow' });
    setRemBusy(false);
    if (err) { setRemError(err); return; }
    setAskReminder(false);
  };
  const [showPhotos, setShowPhotos] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const { userId } = useAuth();
  // Même annonce (URL identique) ouverte par un COLLÈGUE → anti-collision.
  // Rapprochement par CLÉ d'annonce (12/10) : l'identifiant du site, pas
  // l'URL brute — deux URLs différentes de la même annonce Leboncoin se voient.
  const myKey = listingKey(n.listing_url);
  const others = myKey
    ? conflicts.filter((c) => c.owner_id !== userId && listingKey(c.listing_url) === myKey)
    : [];

  useEffect(() => {
    if (!showConflict) return;
    const close = (e: MouseEvent) => { if (!conflictRef.current?.contains(e.target as Node)) setShowConflict(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showConflict]);

  useEffect(() => {
    if (!menu) { setPickFolder(false); return; }
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
          <StorageBg path={n.photos[0]} className="absolute inset-y-0 left-0 w-72 max-w-[45%] bg-cover bg-center" />
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
                        {(() => {
                          const r = readNote(c.notes);
                          const last = lastNoteDate(c.notes, c.updated_at);
                          return (
                            <>
                              {last && (
                                <p className={`text-[11px] font-medium ${worthRelaunch(last) ? 'text-emerald-700' : 'text-slate-600'}`}>
                                  Note modifiée {agoLabel(last)} ({last.toLocaleDateString('fr-FR')}){worthRelaunch(last) ? ` — plus de ${RELANCE_AFTER_DAYS} j, une relance vaut le coup` : ''}
                                </p>
                              )}
                              {r.text ? <p className="text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{r.text}</p> : <p className="italic text-slate-400">Pas de notes.</p>}
                            </>
                          );
                        })()}
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
          ref={notesBtnRef}
          onClick={() => onNotesOpen(!notesOpen)}
          title={noteAt ? `Note modifiée le ${noteAt.toLocaleDateString('fr-FR')}` : 'Notes'}
          className={`text-xs px-2 py-1 rounded-lg shrink-0 ${n.notes ? 'text-brand-ocean bg-blue-50' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          Notes{n.notes ? ' •' : ''}
        </button>
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenu(!menu)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><MoreVertical className="w-4 h-4" /></button>
          {menu && (
            // Mobile : feuille ancrée en bas d'écran — uniquement des ajouts max-md: (inertes sur PC).
            <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-56 text-sm max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:z-50 max-md:rounded-t-2xl max-md:rounded-b-none max-md:shadow-2xl max-md:max-h-[70vh] max-md:overflow-y-auto max-md:py-2">
              {pickFolder ? (
                <>
                  <button onClick={() => setPickFolder(false)} className="w-full text-left px-4 py-2 max-md:py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 flex items-center gap-1">
                    <ArrowLeft className="w-3 h-3" /> Ranger dans un dossier
                  </button>
                  <MenuBtn onClick={() => moveTo(null)}>
                    <span className="flex items-center gap-2"><span className="w-4 shrink-0">{!n.folder_id && <Check className="w-4 h-4 text-brand-ocean" />}</span><span className="text-slate-500">Sans dossier</span></span>
                  </MenuBtn>
                  {folders.map((f) => (
                    <MenuBtn key={f.id} onClick={() => moveTo(f.id)}>
                      <span className="flex items-center gap-2"><span className="w-4 shrink-0">{n.folder_id === f.id && <Check className="w-4 h-4 text-brand-ocean" />}</span><Folder className="w-4 h-4 text-amber-500 shrink-0" /><span className="truncate">{f.name}</span></span>
                    </MenuBtn>
                  ))}
                  <MenuBtn onClick={async () => {
                    setMenu(false); setPickFolder(false);
                    const id = await onNewFolder();
                    if (id) await moveTo(id);
                  }}>
                    <span className="flex items-center gap-2 text-brand-ocean"><FolderPlus className="w-4 h-4 shrink-0" /> Nouveau dossier…</span>
                  </MenuBtn>
                </>
              ) : (
              <>
              <MenuBtn onClick={() => setPickFolder(true)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Folder className="w-4 h-4 text-amber-500 shrink-0" /> Ranger dans un dossier</span>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </span>
              </MenuBtn>
              {!pushed && (
                <MenuBtn onClick={() => { setMenu(false); setRefInput(''); setRefError(null); setAskRef(true); }}>Ajouter aux ventes (dossier)</MenuBtn>
              )}
              {n.listing_url?.startsWith('http') && (
                <MenuBtn onClick={async () => {
                  setMenu(false);
                  // Contact ASSISTÉ (05/09) : message copié dans la langue du
                  // pays de l'annonce, annonce ouverte, trace « contacté le »
                  // dans les notes pour la relance. Jamais d'envoi automatique.
                  const r = await contactSeller({ title: n.title, url: n.listing_url });
                  if (!r.copied) prompt('Presse-papiers indisponible — copie le message :', r.message);
                  // Trace dans la note, qui prend la date du jour (12/10).
                  const cur = noteTextRef.current.trim();
                  const next = writeNote(`${cur ? `${cur}\n` : ''}Contacté le ${new Date().toLocaleDateString('fr-FR')} (message copié)`);
                  await updateNegotiation(n.id, { notes: next });
                  adoptNotes(next); onChanged();
                }}>Contacter le vendeur</MenuBtn>
              )}
              <MenuBtn onClick={() => { setMenu(false); setRemTitle(`Relancer : ${n.title}`); setRemWhen(defaultReminderWhen()); setRemError(null); setAskReminder(true); }}>
                <span className="flex items-center gap-2"><AlarmClock className="w-4 h-4 text-rose-500 shrink-0" /> Ajouter un rappel</span>
              </MenuBtn>
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
              <MenuBtn danger onClick={() => { setMenu(false); setAskDelete(true); }}>Supprimer</MenuBtn>
              </>
              )}
            </div>
          )}
        </div>
      </div>
      {askRef && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4" onClick={() => !refBusy && setAskRef(false)}>
          <form onSubmit={(e) => { e.preventDefault(); void submitRef(); }} className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">Ajouter aux ventes « {n.title} »</h3>
            <p className="text-sm text-slate-600">Référence de la vente, la même que dans le tableau des ventes. C'est elle qui évite les doublons : la synchro du tableur retrouvera ce dossier au lieu d'en créer un deuxième.</p>
            <label className="block text-xs text-slate-600">Référence (REF du tableau)
              <input autoFocus value={refInput} onChange={(e) => { setRefInput(e.target.value.toUpperCase()); setRefError(null); }} placeholder="YC575" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono uppercase tracking-wide" />
            </label>
            {refError && <p className="text-xs text-red-600">{refError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={refBusy || !refInput.trim()} className="flex-1 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{refBusy ? 'Enregistrement…' : 'Créer la vente'}</button>
              <button type="button" onClick={() => setAskRef(false)} disabled={refBusy} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Annuler</button>
            </div>
            <p className="text-[11px] text-slate-500">Pas encore de REF ? Attribue-la d'abord dans le tableau, puis reviens : sans référence, la vente ne peut pas être créée depuis une négociation.</p>
          </form>
        </div>
      )}
      {askDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4" onClick={() => setAskDelete(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900">Supprimer « {n.title} »</h3>
            <p className="text-sm text-slate-600">Pas de deal. Que devient l'annonce dans les résultats de tes études ?</p>
            <button onClick={async () => { setAskDelete(false); await deleteNegotiation(n.id, 'flux'); onChanged(); }}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-brand-ocean hover:bg-blue-50/40 px-4 py-3 transition-colors">
              <span className="block text-sm font-medium text-slate-900">Remettre dans le flux</span>
              <span className="block text-xs text-slate-500">Le véhicule reste intéressant : une vraie baisse de prix le ramènera dans la boîte.</span>
            </button>
            <button onClick={async () => { setAskDelete(false); await deleteNegotiation(n.id, 'archive'); onChanged(); }}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50/40 px-4 py-3 transition-colors">
              <span className="block text-sm font-medium text-slate-900">Archiver définitivement</span>
              <span className="block text-xs text-slate-500">« Pas de deal » : ne sera plus jamais re-présentée, même en baisse.</span>
            </button>
            <button onClick={() => setAskDelete(false)} className="w-full text-sm text-slate-500 hover:text-slate-700 py-1">Annuler</button>
          </div>
        </div>
      )}
      {showPhotos && (
        <NegotiationPhotosModal nego={n} onClose={() => setShowPhotos(false)} onChanged={onChanged} />
      )}
      {notesOpen && (
        <div ref={notesPanelRef} className="relative mt-2 flex gap-2">
          <textarea
            autoFocus
            value={noteText}
            onChange={(e) => onNotesChange(e.target.value)}
            onBlur={() => void flushNotes()}
            rows={Math.min(8, Math.max(2, noteText.split('\n').length + 1))}
            placeholder="Vendeur joint, contre-offre, état réel… (enregistrée toute seule, datée à la modification)"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <div className="flex flex-col items-end gap-1 self-end">
            <span className="text-[10px] text-slate-400 text-right">
              {noteAt ? `modifiée le ${noteAt.toLocaleDateString('fr-FR')} à ${noteAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'visible par l’équipe'}
              {noteState === 'saving' ? ' · enregistrement…' : noteState === 'dirty' ? ' · modifié' : noteState === 'saved' ? ' · enregistré ✓' : ''}
            </span>
            <button
              onClick={() => onNotesOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-ocean text-white"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {askReminder && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4" onClick={() => !remBusy && setAskReminder(false)}>
          <form onSubmit={(e) => { e.preventDefault(); void submitReminder(); }} className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900 flex items-center gap-2"><AlarmClock className="w-4 h-4 text-rose-500" /> Rappel pour « {n.title} »</h3>
            <p className="text-sm text-slate-600">Il apparaîtra dans la cloche Rappels à l'échéance, avec un lien vers tes négociations. Compte @mc-export.com : tu reçois aussi un e-mail à ce moment-là, avec le texte ci-dessous.</p>
            <label className="block text-xs text-slate-600">Quoi
              <input autoFocus value={remTitle} onChange={(e) => setRemTitle(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </label>
            <label className="block text-xs text-slate-600">Quand
              <input type="datetime-local" value={remWhen} onChange={(e) => setRemWhen(e.target.value)} className="mt-1 px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </label>
            {remError && <p className="text-xs text-red-600">{remError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={remBusy} className="flex-1 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{remBusy ? 'Enregistrement…' : 'Poser le rappel'}</button>
              <button type="button" onClick={() => setAskReminder(false)} disabled={remBusy} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Annuler</button>
            </div>
          </form>
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
            ? <StorageBg path={n.photos[0]} className="absolute inset-0 bg-cover bg-center" />
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
          {readNote(n?.notes).text && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap"><span className="font-medium">Notes de {mine ? 'ta' : 'sa'} négociation{readNote(n?.notes).at ? ` (${agoLabel(readNote(n?.notes).at!)})` : ''} :</span> {readNote(n?.notes).text}</p>}
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
