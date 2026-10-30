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
import { useEffect, useMemo, useState } from 'react';
import { Plus, Play, Pause, Pencil, Trash2, ExternalLink, MapPin, Loader2, X } from 'lucide-react';
import { useAuth, managerScope } from '../services/auth';
import { listMyWatches, saveWatch, deleteWatch, forceRunWatch, listWatchLeads, takeWatchLead, rejectWatchLead, type ProspectWatch, type WatchLead } from '../services/prospectWatches';
import { ListingLink } from './ListingLink';

const fmtEur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

export function WatchesSection({ organisation }: { organisation: string }) {
  const scope = managerScope();
  const [rows, setRows] = useState<ProspectWatch[]>([]);
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
          <p className="text-xs text-slate-500 mt-0.5">Une adresse de page de recherche (particuliers, ton secteur, tes filtres), une heure : chaque jour, les annonces nouvelles tombent dans les leads de {organisation}. Premier passage : les annonces des dernières 24 h.</p>
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
              <p className="font-semibold text-slate-900 truncate">{w.label || hostOf(w.url)} <span className="text-xs font-normal text-slate-400">· {hostOf(w.url)} · {String(w.run_hour).padStart(2, '0')} h 00{w.lead_org ? ` · leads pour ${w.lead_org}` : ''}{w.active ? '' : ' · en pause'}</span></p>
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

/** Les leads des veilles de l'organisation : groupés par veille, les plus récents d'abord ; « Prendre en négociation » les retire pour tous. */
export function WatchLeadsSection({ onTaken, onCount }: { onTaken: () => void; onCount: (n: number) => void }) {
  const { userId } = useAuth();
  const [leads, setLeads] = useState<WatchLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => {
    listWatchLeads().then((l) => { setLeads(l); onCount(l.length); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
    // Par ordre de MISE EN LIGNE (30/10, Channing), les plus récentes d'abord ; sans date, par première vue.
    const key = (l: WatchLead) => l.published_at ?? l.first_seen_at;
    return [...by.values()].map((g) => ({ ...g, list: g.list.sort((a, b) => key(b).localeCompare(key(a))) }));
  }, [leads]);
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
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Leads de prospection</h2>
        <p className="text-xs text-slate-500">Les annonces nouvelles trouvées par les veilles de l'organisation, les plus récentes d'abord. Prendre un lead le fait disparaître pour les autres ; rejeter (✕) l'écarte pour tout le monde, définitivement.</p>
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {groups.map(({ watch: w, list }) => (
        <div key={w.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-semibold text-slate-900">{w.label || hostOf(w.url)}</p>
            <p className="text-xs text-slate-500">{hostOf(w.url)} · {list.length} lead{list.length > 1 ? 's' : ''} à prendre{w.user_id === userId ? ' · ma veille' : ''}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {list.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <ListingLink href={l.listing_url} className="font-medium text-slate-900 hover:text-blue-600 hover:underline truncate block">{l.title || l.listing_url}</ListingLink>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    {l.year ?? '—'} · {l.mileage != null ? `${l.mileage.toLocaleString('fr-FR')} km` : '—'}{l.fuel ? ` · ${l.fuel}` : ''}
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
