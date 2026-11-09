/**
 * VEILLES DE PROSPECTION PAR ADRESSE (29/10, Channing) — le mode d'études quotidiennes des
 * organisations de prospection (Mon agence automobile, Weecars) : leur manager colle l'adresse d'une
 * page de recherche (Leboncoin, particuliers, son secteur, ses filtres), choisit l'heure ; chaque jour
 * les nouvelles annonces tombent dans les leads de tous ses commerciaux (onglet Résultats). Rien de
 * commun avec les études quotidiennes MC Export.
 *
 *   WatchesSection    : créer, modifier, lancer, mettre en pause, supprimer ses veilles (manager).
 *   WatchLeadsSection : les leads des veilles de l'organisation, à prendre (tout le monde).
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Play, Pause, Pencil, Trash2, ExternalLink, MapPin, Loader2, X, ChevronRight, Search } from 'lucide-react';
import { managerScope, useAuth } from '../services/auth';
import { listMyWatches, saveWatch, deleteWatch, forceRunWatch, listWatchLeads, listOrgWatches, listTwinCandidates, sameVehicle, takeWatchLead, rejectWatchLead, type ProspectWatch, type WatchLead, type TwinHit } from '../services/prospectWatches';
import { ListingLink } from './ListingLink';

const fmtEur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);
/** Âge en jours (Paris) d'une date d'acquisition, et son libellé « Reçus aujourd'hui / hier / le 28/10 ». */
const dayAge = (iso: string) => Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
/** « Leads du 01/11 · annonces des 24 h précédant le passage » ; les jours passés : « encore à traiter ». */
const dayLabel = (iso: string) => { const a = dayAge(iso); const d = new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); return `Leads du ${d}${a <= 0 ? ' (aujourd\'hui)' : a === 1 ? ' (hier)' : ''} · annonces mises en ligne dans les 24 h précédant le passage${a >= 1 ? ' — encore à traiter' : ''}`; };
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

export function WatchesSection({ organisation }: { organisation: string }) {
  const scope = managerScope();
  const [rows, setRows] = useState<Array<ProspectWatch & { author_name?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<ProspectWatch> | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { void listMyWatches().then((r) => { setRows(r.rows); setError(r.error); }).finally(() => setLoading(false)); };
  useEffect(reload, []);
  // Une veille demandée ou en cours : relecture toutes les 10 s jusqu'au bilan (30/10 : « il ne se passe rien »).
  const pending = rows.some((w) => w.force_requested_at || w.last_summary === 'passage en cours…');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [pending]);
  /** État lisible d'une veille : demandée → en cours → bilan. */
  const stateOf = (w: ProspectWatch): { text: string; tone: 'wait' | 'run' | 'ok' | 'ko' | 'none' } => {
    if (w.force_requested_at) return { text: 'lancement demandé — le worker la prend dès qu\'il est disponible (moins d\'une minute)', tone: 'wait' };
    if (w.last_summary === 'passage en cours…') return { text: 'passage en cours — lecture des pages, page par page jusqu\'au déjà-vu ; le bilan s\'affiche ici à la fin', tone: 'run' };
    if (w.last_run_at) return { text: `dernier passage ${new Date(w.last_run_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${w.last_summary ? ` — ${w.last_summary}` : ''}`, tone: /^échec/.test(w.last_summary ?? '') ? 'ko' : 'ok' };
    return { text: 'jamais passée — « Lancer » pour un premier passage', tone: 'none' };
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.url) return;
    const err = await saveWatch({ ...editing, url: editing.url });
    if (err) { setError(err); return; }
    setEditing(null); setError(null); reload();
  };
  const set = (patch: Partial<ProspectWatch>) => setEditing((s) => ({ ...s, ...patch }));
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-brand-ocean" /> Veilles de prospection</h2>
          <p className="text-xs text-slate-500 mt-0.5">Une adresse de page de recherche (particuliers, ton secteur, tes filtres), une heure : chaque jour, les annonces nouvelles tombent dans les leads de {organisation}. Premier passage : les annonces des dernières 24 h. Les veilles des autres managers de l'organisation sont ici aussi, modifiables.</p>
        </div>
        <button onClick={() => setEditing({ label: '', url: '', run_hour: 7, active: true })} className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Nouvelle veille
        </button>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {editing && (
        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 className="font-semibold text-slate-900">{editing.id ? 'Modifier la veille' : 'Nouvelle veille'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_140px] gap-3">
            <label className="text-xs text-slate-600 space-y-1"><span>Nom (libre)</span>
              <input value={editing.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Particuliers · Les Ponts-de-Cé 30 km" className={inputCls} /></label>
            <label className="text-xs text-slate-600 space-y-1"><span>Adresse de la page de recherche *</span>
              <input value={editing.url ?? ''} onChange={(e) => set({ url: e.target.value })} required placeholder="https://www.leboncoin.fr/recherche?category=2&locations=…&owner_type=private" className={inputCls} /></label>
            <label className="text-xs text-slate-600 space-y-1"><span>Heure du passage</span>
              <select value={editing.run_hour ?? 7} onChange={(e) => set({ run_hour: Number(e.target.value) })} className={inputCls}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')} h 00</option>)}
              </select></label>
          </div>
          {/* L'organisation qui reçoit les leads de cette veille (30/10) : toujours visible ; les autres agences
              n'apparaissent que si un admin les a confiées à ce manager (Admin → « Manager aussi de… »). */}
          <label className="text-xs text-slate-600 space-y-1 block md:w-96"><span>Leads pour (l'organisation dont les commerciaux reçoivent cette veille)</span>
            <select value={editing.lead_org || organisation} onChange={(e) => set({ lead_org: e.target.value === organisation ? null : e.target.value })} className={inputCls}>
              {scope.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {scope.length === 1 && <span className="block text-[11px] text-slate-400">Une seule organisation disponible : pour en gérer une autre, un admin te l'attribue dans Admin (« Manager aussi de… »), puis reconnecte-toi.</span>}
          </label>
          <p className="text-[11px] text-slate-500">Règle tes filtres sur le site (année, kilométrage, vendeur particulier, rayon…) puis colle l'adresse telle quelle. Sur Leboncoin, Ada lit les annonces par ordre de mise en ligne, page après page, jusqu'à retomber sur des annonces déjà vues par cette veille.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Annuler</button>
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-ocean hover:bg-brand-encre text-white">Enregistrer</button>
          </div>
        </form>
      )}
      {loading ? <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>
        : rows.length === 0 && !editing ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">Aucune veille. Crée la première : colle l'adresse d'une recherche de ton secteur, Ada la relit chaque jour.</div>
        ) : rows.map((w) => (
          <div key={w.id} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 truncate">{w.label || hostOf(w.url)} <span className="text-xs font-normal text-slate-400">· {hostOf(w.url)} · {String(w.run_hour).padStart(2, '0')} h 00{w.lead_org ? ` · leads pour ${w.lead_org}` : ''}{w.author_name ? ` · veille de ${w.author_name}` : ''}{w.active ? '' : ' · en pause'}</span></p>
              {(() => { const st = stateOf(w); return (
                <p className={`text-xs truncate ${st.tone === 'wait' ? 'text-amber-700' : st.tone === 'run' ? 'text-brand-ocean' : st.tone === 'ko' ? 'text-rose-700' : 'text-slate-500'}`}>
                  {(st.tone === 'wait' || st.tone === 'run') && <Loader2 className="inline w-3 h-3 mr-1 animate-spin align-[-2px]" />}{st.text}
                </p>
              ); })()}
            </div>
            <a href={w.url} target="_blank" rel="noreferrer" title="Ouvrir la page de recherche" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></a>
            <button title="Lancer maintenant" disabled={!!w.force_requested_at || w.last_summary === 'passage en cours…'} onClick={async () => { const err = await forceRunWatch(w.id); if (err) setError(err); else { setError(null); reload(); } }} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Play className="w-4 h-4" /></button>
            <button title={w.active ? 'Mettre en pause' : 'Réactiver'} onClick={async () => { const err = await saveWatch({ ...w, active: !w.active }); if (err) setError(err); reload(); }} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">{w.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 text-emerald-600" />}</button>
            <button title="Modifier" onClick={() => setEditing(w)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
            <button title="Supprimer" onClick={async () => { if (!confirm(`Supprimer la veille « ${w.label || hostOf(w.url)} » et sa mémoire ? Les leads déjà pris restent en négociation.`)) return; const err = await deleteWatch(w.id); if (err) setError(err); reload(); }} className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
    </div>
  );
}

/** LOGO DE LA PLATEFORME d'un lead (09/11, Channing : « un petit logo Le bon coin ou La centrale ») : pastille aux
 *  couleurs du site, dessinée ici (pas d'image externe). */
function SiteLogo({ site, url }: { site?: string | null; url?: string | null }) {
  const key = `${site ?? ''} ${url ?? ''}`.toLowerCase();
  if (/leboncoin/.test(key)) return <span title="Leboncoin" className="shrink-0 inline-grid place-items-center w-5 h-5 rounded-md bg-[#ff6e14] text-white text-[9px] font-black leading-none">lbc</span>;
  if (/lacentrale/.test(key)) return <span title="La Centrale" className="shrink-0 inline-grid place-items-center w-5 h-5 rounded-md bg-[#c8102e] text-white text-[9px] font-black leading-none">LC</span>;
  if (/autoscout/.test(key)) return <span title="AutoScout24" className="shrink-0 inline-grid place-items-center w-5 h-5 rounded-md bg-[#f7a600] text-white text-[9px] font-black leading-none">AS</span>;
  if (/mobile\.de/.test(key)) return <span title="mobile.de" className="shrink-0 inline-grid place-items-center w-5 h-5 rounded-md bg-[#f7941d] text-white text-[9px] font-black leading-none">mb</span>;
  const host = hostOf(url ?? site ?? '').replace(/\..*$/, '');
  return <span title={host} className="shrink-0 inline-grid place-items-center w-5 h-5 rounded-md bg-slate-500 text-white text-[9px] font-black leading-none uppercase">{host.slice(0, 2) || '?'}</span>;
}

/** Mots de la recherche, sans accents : un lead correspond s'il contient tous les mots dans son titre. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const matchesQuery = (title: string, q: string) => { const t = norm(title); return norm(q).split(/\s+/).filter(Boolean).every((w) => t.includes(w)); };

/** Les leads des veilles de l'organisation : groupés par veille, les plus récents d'abord ; « Prendre en négociation » les retire pour tous. */
export function WatchLeadsSection({ onTaken, onCount }: { onTaken: () => void; onCount: (n: number) => void }) {
  const { isMcExport } = useAuth();
  // RECHERCHE (09/11, Channing : « une barre de recherche qui cherche dans les titres des leads, puis propose les
  // leads de toutes les veilles avec un petit logo Le bon coin ou La centrale ») — comptes de prospection, manager compris.
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<WatchLead[]>([]);
  // Toutes les veilles de l'organisation, même sans lead (01/11 : « que les commerciaux sachent qu'une étude est en place »).
  const [watches, setWatches] = useState<Awaited<ReturnType<typeof listOrgWatches>>>([]);
  // Doublons entre plateformes (01/11) : la même voiture vue par une autre veille (Leboncoin ↔ La Centrale).
  const [twins, setTwins] = useState<TwinHit[]>([]);
  // Groupes REPLIABLES (01/11, Channing : « réduire la recherche pour voir aussi les leads de La Centrale ») :
  // le choix est retenu sur ce navigateur, ouvert par défaut.
  const [closed, setClosed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('ada_watch_leads_closed') ?? '{}'); } catch { return {}; } });
  const toggleGroup = (id: string) => setClosed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem('ada_watch_leads_closed', JSON.stringify(n)); } catch { /* stockage indispo */ } return n; });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => {
    listWatchLeads().then((l) => { setLeads(l); onCount(l.length); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void listOrgWatches().then(setWatches);
    void listTwinCandidates().then(setTwins);
  };
  useEffect(() => {
    reload();
    const t = setInterval(reload, 60_000);
    window.addEventListener('focus', reload);
    return () => { clearInterval(t); window.removeEventListener('focus', reload); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const groups = useMemo(() => {
    const by = new Map<string, { watch: WatchLead['watch']; list: WatchLead[] }>();
    for (const l of leads) (by.get(l.watch_id) ?? by.set(l.watch_id, { watch: l.watch, list: [] }).get(l.watch_id)!).list.push(l);
    // Par DATE D'ACQUISITION (30/10 soir, Channing : « si les leads de la veille ne sont pas traités, ça fait une
    // différence et on peut les trouver ») : jour de première vue, les plus récents d'abord ; dans un jour, par
    // mise en ligne décroissante. Un en-tête par jour dans la liste.
    const key = (l: WatchLead) => `${l.first_seen_at.slice(0, 10)}|${l.published_at ?? l.first_seen_at}`;
    // Les veilles sans lead gardent leur bloc (passage du …, aucun lead) ; une veille connue par ses leads seuls aussi.
    for (const w of watches) if (!by.has(w.id)) by.set(w.id, { watch: w, list: [] });
    const meta = new Map(watches.map((w) => [w.id, w]));
    return [...by.values()].map((g) => ({ ...g, watch: { ...g.watch, ...(meta.get(g.watch.id) ?? {}) }, list: g.list.sort((a, b) => key(b).localeCompare(key(a))) }));
  }, [leads, watches]);
  /** Les jumeaux d'un lead : même véhicule, autre veille (donc l'autre plateforme), avec leur état. */
  const twinsOf = (l: WatchLead) => twins.filter((t) => t.watch_id !== l.watch_id && t.id !== l.id && sameVehicle(l, t));
  const take = async (l: WatchLead) => {
    setBusy(l.id);
    const err = await takeWatchLead(l);
    setBusy(null);
    if (err) { setError(err); reload(); return; }
    setLeads((cur) => cur.filter((x) => x.id !== l.id));
    onTaken();
  };
  const reject = async (l: WatchLead) => {
    setBusy(l.id);
    const err = await rejectWatchLead(l);
    setBusy(null);
    if (err) { setError(err); reload(); return; }
    setLeads((cur) => cur.filter((x) => x.id !== l.id));
  };
  if (groups.length === 0 && !error) return null;
  const q = query.trim();
  const found = q.length >= 2 ? leads.filter((l) => matchesQuery(l.title || l.listing_url, q)).sort((a, b) => (b.published_at ?? b.first_seen_at).localeCompare(a.published_at ?? a.first_seen_at)) : null;
  const leadRow = (l: WatchLead, withSite: boolean) => (
    <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
      {withSite && <SiteLogo site={l.site} url={l.watch?.url ?? l.listing_url} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <ListingLink href={l.listing_url} className="font-medium text-slate-900 hover:text-blue-600 hover:underline truncate">{l.title || l.listing_url}</ListingLink>
          {twinsOf(l).map((t) => (
            <a key={t.id} href={t.listing_url} target="_blank" rel="noreferrer" title={`${t.title || t.listing_url} — ${t.year ?? '—'} · ${t.mileage != null ? `${t.mileage.toLocaleString('fr-FR')} km` : '—'} · ${t.price != null ? `${t.price.toLocaleString('fr-FR')} €` : '—'}`}
              className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium rounded-full border px-1.5 py-0.5 ${t.status === 'saved' ? 'bg-amber-50 border-amber-200 text-amber-800' : t.status === 'rejected' ? 'bg-slate-50 border-slate-200 text-slate-500' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
              Doublon {hostOf(t.watch.url).replace(/\.fr$|\.nl$|\.de$/, '')} · {t.status === 'saved' ? `pris par ${t.taken_by_name ?? 'un collègue'}` : t.status === 'rejected' ? `rejeté par ${t.taken_by_name ?? 'un collègue'}` : 'lead disponible'}
            </a>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {withSite ? `${l.watch?.label || hostOf(l.watch?.url ?? '')} · ` : ''}{l.year ?? '—'} · {l.mileage != null ? `${l.mileage.toLocaleString('fr-FR')} km` : '—'}{l.fuel ? ` · ${l.fuel}` : ''}
          {l.published_at ? ` · mise en ligne ${new Date(l.published_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
          {` · vue ${new Date(l.first_seen_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
        </p>
      </div>
      <span className="font-semibold text-slate-900 shrink-0">{fmtEur(l.price)}</span>
      <ListingLink href={l.listing_url} title="Ouvrir l'annonce" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"><ExternalLink className="w-4 h-4" /></ListingLink>
      <button onClick={() => void take(l)} disabled={busy === l.id} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-ocean hover:bg-brand-encre text-white transition-colors disabled:opacity-50">
        {busy === l.id ? '…' : 'Prendre en négociation'}
      </button>
      <button onClick={() => void reject(l)} disabled={busy === l.id} title="Rejeter : hors critères — disparaît pour toute l'organisation, ne reviendra pas" className="shrink-0 p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"><X className="w-4 h-4" /></button>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-700">Leads de prospection</h2>
          <p className="text-xs text-slate-500">Les annonces nouvelles trouvées par les veilles de l'organisation, par jour de réception (les plus récentes d'abord ; les jours passés restent visibles tant qu'il y a des leads à traiter). Prendre un lead le fait disparaître pour les autres ; rejeter (✕) l'écarte pour tout le monde, définitivement.</p>
        </div>
        {!isMcExport && (
          <div className="relative w-80 max-w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher un lead : marque, modèle, finition…" className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            {query && <button onClick={() => setQuery('')} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600" aria-label="Effacer"><X className="w-4 h-4" /></button>}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {found && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <span className="font-semibold text-slate-900">« {q} »</span>
            <span className="text-xs text-slate-500">{found.length ? `${found.length} lead${found.length > 1 ? 's' : ''} à prendre, toutes veilles confondues` : 'aucun lead à prendre ne correspond'}</span>
            <button onClick={() => setQuery('')} className="ml-auto text-xs text-brand-ocean hover:underline">Revenir aux veilles</button>
          </div>
          {found.length > 0 && <div className="divide-y divide-slate-100">{found.map((l) => leadRow(l, true))}</div>}
        </div>
      )}
      {!found && groups.map(({ watch: w, list }) => (
        <div key={w.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <button onClick={() => toggleGroup(w.id)} className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors ${closed[w.id] ? 'rounded-xl' : 'rounded-t-xl border-b border-slate-100'}`} aria-expanded={!closed[w.id]}>
            <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${closed[w.id] ? '' : 'rotate-90'}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900 truncate">{w.label || hostOf(w.url)}</span>
              <span className="block text-xs text-slate-500">{hostOf(w.url)} · {list.length ? `${list.length} lead${list.length > 1 ? 's' : ''} à prendre` : 'aucun lead à prendre'}{w.last_run_at ? ` · passage du ${new Date(w.last_run_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · jamais passée'}{(w as { active?: boolean }).active === false ? ' · en pause' : ''}</span>
            </span>
          </button>
          {!closed[w.id] && list.length === 0 && (
            <p className="px-4 py-4 text-xs text-slate-500">
              {w.last_run_at
                ? `Veille en place : au dernier passage, aucune annonce nouvelle${(w as { last_summary?: string | null }).last_summary ? ` (${(w as { last_summary?: string | null }).last_summary})` : ''}. Les prochaines tomberont ici.`
                : 'Veille en place : premier passage à venir à l\'heure programmée.'}
            </p>
          )}
          {!closed[w.id] && list.length > 0 && <div className="divide-y divide-slate-100">
            {list.map((l, i) => (
              <Fragment key={l.id}>
              {(i === 0 || list[i - 1].first_seen_at.slice(0, 10) !== l.first_seen_at.slice(0, 10)) && (
                <div className={`px-4 py-1 text-[11px] font-medium ${dayAge(l.first_seen_at) >= 1 ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>{dayLabel(l.first_seen_at)}</div>
              )}
              {leadRow(l, false)}
              </Fragment>
            ))}
          </div>}
        </div>
      ))}
    </div>
  );
}
