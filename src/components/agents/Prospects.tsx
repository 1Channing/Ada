/**
 * Prospects d'Ada (17/10, Channing : « nos acheteurs idéaux sont ceux qui
 * vendent les voitures que nous vendons, plus chères ! … les pays de nos
 * ventes, Toyota, Suzuki, Peugeot, Opel… multimarques, et des vendeurs de
 * van, Ford, Mercedes »).
 *
 * - Vos ventes : pays et marques du Workflow → Ventes (cibles par défaut).
 * - Découvrir : un site + un pays + une marque → le worker lit les pages
 *   (AutoScout24 : les plus récentes d'abord ; Marktplaats, Leboncoin,
 *   mobile.de… : la recherche des études) et l'annuaire garde chaque garage.
 * - L'annuaire : garages vus sur toutes les pages qu'ADA lit, tous sites
 *   (un même garage vu sur plusieurs sites = une ligne et ses sources), avec « client
 *   actuel » et « déjà dans le réseau » écartés par défaut, et les annonces
 *   plus chères que nos offres (vitrine des bonnes affaires, HT + TVA du pays).
 * - Phase 2.2 : « Qualifier » confie un garage à Ada (Haiku 5.5) — site,
 *   e-mails publiés vérifiés, à qui écrire, score et raison (QualifCard).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Radar, Building2, Phone, ExternalLink, MapPin, ChevronDown, X, Plus, TrendingUp, Sparkles, Mail, Telescope } from 'lucide-react';
import {
  listDealers, dealerListings, salesProfile, ourOffers, listTasks, queueDiscovery, cancelTask, addDealerToMap,
  queueQualification, prospectDetails, setProspectStage, queueFirstMails, threadsOfProspects, indexMeta, queueDeepResearch, SITES_SQL_HINT,
  type DealerRow, type DealerListing, type SalesProfile, type AgentTask, type ProspectDetail, type ProspectStage,
} from '../../services/agents';
import { opportunities, type OfferLite, type Opportunity } from '../../lib/agents/opportunity';
import { DISCOVERY_SITES, DISCOVERY_SITE_LABEL, discoveryPages } from '../../lib/agents/discovery';
import { SITE_LABEL } from '../../services/dealerDirectory';
import { countryVat } from '../../lib/offers/vat';
import { isoOfCountry as isoOf } from '../../lib/agents/keys';
import { HOME_COUNTRY } from '../../lib/agents/qualification';
import { fmtDateTime, fmtRelative, STAGE_LABEL, scoreTone } from './helpers';
import { QualifCard } from './QualifCard';
import { fmtUsd } from '../../lib/agents/aiCost';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹' };
const COUNTRY_NAME: Record<string, string> = { FR: 'France', DE: 'Allemagne', NL: 'Pays-Bas', BE: 'Belgique', ES: 'Espagne', IT: 'Italie', DK: 'Danemark', SE: 'Suède', HU: 'Hongrie', AT: 'Autriche', LU: 'Luxembourg', LT: 'Lituanie' };
const siteLabel = (s: string | undefined) => DISCOVERY_SITE_LABEL[String(s ?? 'AUTOSCOUT').toUpperCase()] ?? s ?? 'AutoScout24';
/** Les fiches d'un garage (une seule avant le SQL « tous sites »). */
const membersOf = (d: DealerRow) => d.members?.length ? d.members : [{ id: d.id, site: d.site ?? 'autoscout24', name: d.name, site_url: d.site_url, imprint_url: d.imprint_url, website: d.website, phone: d.phone, city: d.city }];
const DEFAULT_BRANDS = ['Toyota', 'Suzuki', 'Peugeot', 'Opel', 'Ford', 'Mercedes-Benz', 'Renault', 'Volkswagen', 'Citroën', 'Kia', 'Hyundai', 'Skoda'];
const nice = (b: string) => b.charAt(0) + b.slice(1).toLowerCase();
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';
const TASK_STATUS: Record<AgentTask['status'], { label: string; cls: string }> = {
  en_attente: { label: 'en attente', cls: 'bg-slate-100 text-slate-600' },
  en_cours: { label: 'en cours', cls: 'bg-blue-50 text-blue-800' },
  terminee: { label: 'terminée', cls: 'bg-emerald-50 text-emerald-800' },
  echec: { label: 'échec', cls: 'bg-red-50 text-red-800' },
  annulee: { label: 'annulée', cls: 'bg-slate-100 text-slate-400' },
};

interface Props { userId: string | null; canEditMap: boolean; refreshKey: number; onError: (m: string) => void; onInfo: (m: string) => void; onOpenThread: (id: string) => void }

export function Prospects({ userId, canEditMap, refreshKey, onError, onInfo, onOpenThread }: Props) {
  const [profile, setProfile] = useState<SalesProfile | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [rows, setRows] = useState<DealerRow[]>([]);
  const [listings, setListings] = useState<DealerListing[]>([]);
  const [offers, setOffers] = useState<OfferLite[]>([]);
  const [loading, setLoading] = useState(false);
  // L'annuaire est précalculé par le serveur (SQL agents_index) : l'heure du dernier calcul.
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [brand, setBrand] = useState<string>('');
  const [query, setQuery] = useState('');
  const [hideClients, setHideClients] = useState(true);
  const [hideNetwork, setHideNetwork] = useState(true);
  const [multiOnly, setMultiOnly] = useState(false);
  const [vansOnly, setVansOnly] = useState(false);
  const [dearerOnly, setDearerOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, ProspectDetail>>(new Map());
  const [threads, setThreads] = useState<Map<string, string>>(new Map());
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const [sort, setSort] = useState<'activite' | 'score'>('activite');
  const [added, setAdded] = useState<Set<string>>(new Set());
  // Ada vend à l'export (17/10) : la découverte part des Pays-Bas, jamais de la France (pays d'achat).
  const [disc, setDisc] = useState({ site: 'AUTOSCOUT', country: 'NL', brand: 'Toyota', model: '', vans: false, pages: 5 });

  // Les recherches de comptes se suivent dans l'onglet Recherche.
  const loadTasks = useCallback(async () => { const r = await listTasks(30, 'ada'); if (r.error) onError(r.error); else setTasks(r.rows.filter((t) => t.kind !== 'recherche_comptes')); }, [onError]);
  const loadDirectory = useCallback(async () => {
    setLoading(true);
    const r = await listDealers({ country, brand: brand || null, query, exclude: [HOME_COUNTRY] });
    void indexMeta().then((m) => setComputedAt(m?.computed_at ?? null));
    if (r.error) { onError(r.error); setLoading(false); return; }
    setRows(r.rows);
    // Un garage vu sur plusieurs sites : ses annonces et sa fiche d'Ada sont rangées sous sa ligne.
    const rootOf = new Map<string, string>();
    for (const d of r.rows) for (const m of membersOf(d)) rootOf.set(m.id, d.id);
    const [ls, det] = await Promise.all([
      dealerListings([...rootOf.keys()]),
      prospectDetails(r.rows.filter((x) => x.prospect).map((x) => x.prospect?.dealer_id ?? x.id)),
    ]);
    setListings(ls.map((l) => ({ ...l, dealer_id: rootOf.get(l.dealer_id) ?? l.dealer_id })));
    setDetails(new Map(det.filter((x) => x.dealer_id).map((x) => [rootOf.get(x.dealer_id as string) ?? (x.dealer_id as string), x])));
    setThreads(await threadsOfProspects(det.map((x) => x.id)));
    setLoading(false);
  }, [country, brand, query, onError]);

  useEffect(() => { void salesProfile().then(setProfile); void ourOffers().then(setOffers); }, []);
  useEffect(() => { void loadTasks(); }, [loadTasks, refreshKey]);
  useEffect(() => { const t = setTimeout(() => void loadDirectory(), 250); return () => clearTimeout(t); }, [loadDirectory, refreshKey]);
  // Une découverte en cours : on relit plus souvent.
  const busy = tasks.some((t) => t.status === 'en_attente' || t.status === 'en_cours');
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => { void loadTasks(); void loadDirectory(); }, 10_000);
    return () => window.clearInterval(id);
  }, [busy, loadTasks, loadDirectory]);

  const byDealer = useMemo(() => {
    const m = new Map<string, DealerListing[]>();
    for (const l of listings) (m.get(l.dealer_id) ?? m.set(l.dealer_id, []).get(l.dealer_id)!).push(l);
    return m;
  }, [listings]);
  const oppOf = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const d of rows) m.set(d.id, opportunities(byDealer.get(d.id) ?? [], offers, countryVat(d.country ?? 'FR')));
    return m;
  }, [rows, byDealer, offers]);
  // Garages confiés à Ada et pas encore rendus.
  const queued = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && (t.status === 'en_attente' || t.status === 'en_cours')).flatMap((t) => t.params.dealer_ids ?? [])), [tasks]);
  const drafting = useMemo(() => new Set(tasks.filter((t) => t.kind === 'premier_mail' && (t.status === 'en_attente' || t.status === 'en_cours')).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  // Fiches en recherche approfondie (18/10).
  const deeping = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && t.params.approfondie && (t.status === 'en_attente' || t.status === 'en_cours')).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  const onMap = (d: DealerRow) => d.in_network || !!d.prospect?.in_map || added.has(d.id);
  // Un garage qu'Ada a qualifié reste visible même une fois sur la carte (c'est souvent elle qui l'y a mis).
  const filtered = rows.filter((d) => (!hideClients || !d.is_client) && (!hideNetwork || !d.in_network || !!d.prospect)
    && (!multiOnly || d.nb_brands >= 3) && (!vansOnly || d.vans > 0) && (!dearerOnly || (oppOf.get(d.id)?.length ?? 0) > 0)
    && (!qualifiedOnly || !!d.prospect));
  const shown = sort === 'score' ? [...filtered].sort((a, b) => (b.prospect?.score ?? -1) - (a.prospect?.score ?? -1)) : filtered;
  const toQualify = shown.filter((d) => !d.prospect && !queued.has(d.id) && !d.is_client).slice(0, 10);
  const countries = useMemo(() => [...new Set(rows.map((d) => d.country).filter(Boolean) as string[])].sort(), [rows]);
  const brandChoices = useMemo(() => {
    const set = new Set<string>(DEFAULT_BRANDS);
    for (const b of profile?.brands ?? []) set.add(nice(b.brand));
    return [...set];
  }, [profile]);

  const launch = async () => {
    const vans = disc.site === 'AUTOSCOUT' && disc.vans;
    const e = await queueDiscovery({ site: disc.site, country: disc.country, brand: disc.brand.trim(), model: disc.model.trim() || undefined, vans, pages: discoveryPages(disc.pages) }, userId);
    if (e) onError(e); else { onInfo(`Découverte lancée : ${siteLabel(disc.site)} ${COUNTRY_NAME[disc.country] ?? disc.country} · ${disc.brand}${vans ? ' (utilitaires)' : ''}. Résultat d'ici quelques minutes (l'annuaire est recalculé après chaque découverte).`); void loadTasks(); }
  };
  const discSites = DISCOVERY_SITES[disc.country] ?? ['AUTOSCOUT'];
  const qualify = async (ids: string[]) => {
    const e = await queueQualification(ids, userId);
    if (e) { onError(e); return; }
    onInfo(`Ada prépare ${ids.length > 1 ? `${ids.length} fiches` : 'la fiche'} : qui décide, e-mail publié, LinkedIn s'il est trouvé. Une minute environ par fiche. Rien n'est envoyé à personne.`);
    void loadTasks();
  };
  const draft = async (p: ProspectDetail) => {
    const e = await queueFirstMails([p.id], userId);
    if (e) { onError(e); return; }
    onInfo(`Ada rédige le premier mail pour ${p.name} : il arrivera dans « À valider » d'ici une minute. Rien ne part sans validation.`);
    void loadTasks();
  };
  const changeStage = async (p: ProspectDetail, stage: ProspectStage) => {
    const e = await setProspectStage(p.id, stage);
    if (e) { onError(e); return; }
    setDetails((m) => new Map(m).set(p.dealer_id as string, { ...p, stage }));
  };
  const deepen = async (p: ProspectDetail) => {
    const e = await queueDeepResearch([p.id], userId, 'ada');
    if (e) { onError(e); return; }
    onInfo(`Ada cherche plus loin pour ${p.name} : à qui il appartient, qui décide des achats, les e-mails et téléphones publiés. Une à deux minutes.`);
    void loadTasks();
  };
  const addToMap = async (d: DealerRow) => {
    const r = await addDealerToMap(d, userId);
    if (r.error) { onError(r.error); return; }
    setAdded((s) => new Set(s).add(d.id));
    onInfo(`${d.name} ajouté à la carte (badge « IA · Ada »)${r.placed ? '' : ' — à placer sur la carte : adresse introuvable'}.`);
  };

  return (
    <div className="space-y-4">
      {/* Vos ventes */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-2">
        <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-brand-ocean" /><h3 className="text-sm font-semibold text-slate-900">Vos ventes (Workflow)</h3><span className="text-xs text-slate-500">— les pays et marques où vous vendez déjà : les cibles d'Ada.</span></div>
        {!profile ? <p className="text-xs text-slate-400">Pas encore lisible (SQL du 17/10, ou aucune vente enregistrée).</p> : (
          <div className="flex flex-wrap gap-1.5 items-center text-xs">
            <span className="text-slate-500">Pays :</span>
            {profile.countries.length === 0 && <span className="text-slate-400">aucun renseigné sur les fiches acheteurs</span>}
            {profile.countries.map((c) => { const iso = isoOf(c.country); return iso === HOME_COUNTRY ? (
              <span key={c.country} className="rounded-full border border-dashed border-slate-200 px-2 py-0.5 text-slate-400" title="Votre pays d'achat : Ada n'y cherche pas d'acheteurs">{FLAG[iso]} {c.country} <span className="opacity-60">{c.n}</span> · pays d'achat</span>
            ) : (
              <button key={c.country} onClick={() => iso && setCountry(country === iso ? null : iso)} className={`rounded-full border px-2 py-0.5 ${iso && country === iso ? 'border-brand-ocean bg-blue-50 text-brand-encre' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{iso ? FLAG[iso] ?? '' : ''} {c.country} <span className="opacity-60">{c.n}</span></button>
            ); })}
            <span className="text-slate-500 ml-2">Marques :</span>
            {profile.brands.slice(0, 12).map((b) => (
              <button key={b.brand} onClick={() => setBrand(brand === b.brand ? '' : b.brand)} className={`rounded-full border px-2 py-0.5 ${brand === b.brand ? 'border-brand-ocean bg-blue-50 text-brand-encre' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{nice(b.brand)} <span className="opacity-60">{b.n}</span></button>
            ))}
          </div>
        )}
      </div>

      {/* Découvrir */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap"><Radar className="w-4 h-4 text-brand-ocean" /><h3 className="text-sm font-semibold text-slate-900">Découvrir des concessions</h3><span className="text-xs text-slate-500">— Ada lit les annonces d'un site (AutoScout24, Marktplaats, Leboncoin, mobile.de…) et garde chaque garage, rapproché de ses fiches des autres sites. Sans IA.</span></div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <select className={input} value={disc.country} onChange={(e) => { const c = e.target.value; const sites = DISCOVERY_SITES[c] ?? ['AUTOSCOUT']; setDisc({ ...disc, country: c, site: sites.includes(disc.site) ? disc.site : sites[0] }); }}>
            {Object.keys(DISCOVERY_SITES).filter((c) => c !== HOME_COUNTRY).map((c) => <option key={c} value={c}>{FLAG[c]} {COUNTRY_NAME[c] ?? c}</option>)}
          </select>
          <select className={input} value={disc.site} onChange={(e) => setDisc({ ...disc, site: e.target.value })} title="Le site d'annonces à lire">
            {discSites.map((x) => <option key={x} value={x}>{siteLabel(x)}</option>)}
          </select>
          <input className={`${input} w-40`} list="ada-brands" placeholder="Marque" value={disc.brand} onChange={(e) => setDisc({ ...disc, brand: e.target.value })} />
          <datalist id="ada-brands">{brandChoices.map((b) => <option key={b} value={b} />)}</datalist>
          <input className={`${input} w-40`} placeholder="Modèle (facultatif)" value={disc.model} onChange={(e) => setDisc({ ...disc, model: e.target.value })} />
          <label className={`inline-flex items-center gap-1 ${disc.site === 'AUTOSCOUT' ? 'text-slate-700' : 'text-slate-400'}`} title={disc.site === 'AUTOSCOUT' ? '' : 'Utilitaires : AutoScout24 seulement pour l\'instant'}>
            <input type="checkbox" disabled={disc.site !== 'AUTOSCOUT'} checked={disc.site === 'AUTOSCOUT' && disc.vans} onChange={(e) => setDisc({ ...disc, vans: e.target.checked })} /> Utilitaires (vans)
          </label>
          <label className="inline-flex items-center gap-1 text-slate-700"><input type="number" min={1} max={10} className={`${input} w-16`} value={disc.pages} onChange={(e) => setDisc({ ...disc, pages: Number(e.target.value) })} /> pages</label>
          <button disabled={!disc.brand.trim()} onClick={() => void launch()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"><Radar className="w-4 h-4" /> Lancer</button>
          <span className="text-xs text-slate-400">{discoveryPages(disc.pages)} page{discoveryPages(disc.pages) > 1 ? 's' : ''} ≈ {discoveryPages(disc.pages) * 20} à {discoveryPages(disc.pages) * 35} annonces</span>
        </div>
        {tasks.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {tasks.slice(0, 8).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs flex-wrap">
                <span className={`rounded-full px-2 py-0.5 ${TASK_STATUS[t.status].cls}`}>{TASK_STATUS[t.status].label}</span>
                {t.kind === 'premier_mail' ? (
                  <span className="font-medium text-violet-900"><Mail className="inline w-3.5 h-3.5 mr-0.5" />Premiers mails · {t.params.prospect_ids?.length ?? 0} garage{(t.params.prospect_ids?.length ?? 0) > 1 ? 's' : ''}</span>
                ) : t.kind === 'qualification' && t.params.approfondie ? (
                  <span className="font-medium text-indigo-900"><Telescope className="inline w-3.5 h-3.5 mr-0.5" />Recherche approfondie · {t.params.prospect_ids?.length ?? 0} fiche{(t.params.prospect_ids?.length ?? 0) > 1 ? 's' : ''}</span>
                ) : t.kind === 'qualification' ? (
                  <span className="font-medium text-violet-900"><Sparkles className="inline w-3.5 h-3.5 mr-0.5" />Fiches · {[
                    t.params.dealer_ids?.length ? `${t.params.dealer_ids.length} garage${t.params.dealer_ids.length > 1 ? 's' : ''}` : '',
                    t.params.account_ids?.length ? `${t.params.account_ids.length} compte${t.params.account_ids.length > 1 ? 's' : ''}` : '',
                  ].filter(Boolean).join(' et ') || '0 garage'}</span>
                ) : (
                  <span className="font-medium text-slate-800">{FLAG[t.params.country ?? ''] ?? ''} {siteLabel(t.params.site)} · {t.params.brand}{t.params.model ? ` ${t.params.model}` : ''}{t.params.vans ? ' · utilitaires' : ''}</span>
                )}
                {!t.created_by && <span className="text-[10px] rounded-full px-1.5 bg-slate-50 border border-slate-200 text-slate-500">automatique</span>}
                {t.status === 'terminee' && t.result && t.kind === 'qualification' && t.params.approfondie && (
                  <span className="text-slate-600">{t.result.enrichies ?? 0} complétée{(t.result.enrichies ?? 0) > 1 ? 's' : ''}{t.result.rien ? ` · ${t.result.rien} sans rien de plus` : ''}{t.result.preparees ? ` · ${t.result.preparees} préparée${t.result.preparees > 1 ? 's' : ''} pour vous` : ''} · {fmtUsd(t.result.cout_usd ?? 0)}{t.result.arret ? ` · arrêt : ${t.result.arret}` : ''}</span>
                )}
                {t.status === 'terminee' && t.result && t.kind === 'qualification' && !t.params.approfondie && (
                  <span className="text-slate-600">{t.result.qualifies ?? 0} prête{(t.result.qualifies ?? 0) > 1 ? 's' : ''}, {t.result.ecartes ?? 0} écarté{(t.result.ecartes ?? 0) > 1 ? 's' : ''}{t.result.echecs ? `, ${t.result.echecs} en échec` : ''}{t.result.carte ? `, ${t.result.carte} sur la carte` : ''} · {fmtUsd(t.result.cout_usd ?? 0)}{t.result.arret ? ` · arrêt : ${t.result.arret}` : ''}</span>
                )}
                {t.status === 'terminee' && t.result && t.kind === 'premier_mail' && (
                  <span className="text-slate-600">{t.result.rediges ?? 0} rédigé{(t.result.rediges ?? 0) > 1 ? 's' : ''}, à valider{t.result.ignores ? ` · ${t.result.ignores} ignoré${t.result.ignores > 1 ? 's' : ''}` : ''}{t.result.echecs ? ` · ${t.result.echecs} en échec` : ''} · {fmtUsd(t.result.cout_usd ?? 0)}{t.result.arret ? ` · arrêt : ${t.result.arret}` : ''}</span>
                )}
                {t.status === 'terminee' && t.result && t.kind === 'decouverte_concessions' && (
                  <span className="text-slate-600">
                    {t.result.annonces} annonces lues{t.result.avec_garage != null ? ` · ${t.result.avec_garage} avec leur garage` : ''} · {t.result.concessions} concessions, dont {t.result.nouvelles} nouvelles
                    {t.result.avec_garage === 0 && (t.result.annonces ?? 0) > 0 && <span className="ml-1 text-amber-700">— le site n'a nommé aucun garage sur ces pages</span>}
                  </span>
                )}
                {t.status === 'echec' && <span className="text-red-700">{t.error}</span>}
                <span className="ml-auto text-slate-400">{fmtRelative(t.finished_at ?? t.created_at)}</span>
                {t.status === 'en_attente' && <button onClick={() => void cancelTask(t.id).then((e) => (e ? onError(e) : void loadTasks()))} className="text-slate-400 hover:text-rose-600" title="Annuler"><X className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Annuaire */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Building2 className="w-4 h-4 text-brand-ocean" />
            <h3 className="text-sm font-semibold text-slate-900">Annuaire des concessions</h3>
            <span className="text-xs text-slate-500">— acheteurs possibles hors de France, vus sur les pages qu'ADA lit (90 derniers jours). Les garages français sont des fournisseurs : onglet Sourcing (Dana).</span>
            <span className="ml-auto text-xs text-slate-400">{loading ? 'lecture…' : `${shown.length} / ${rows.length}`}{computedAt ? ` · recalculé ${fmtRelative(computedAt)}` : ''}</span>
          </div>
          {rows.length > 0 && !rows.some((d) => Array.isArray(d.members)) && <p className="text-[11px] text-amber-700">{SITES_SQL_HINT}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setCountry(null)} className={`text-xs rounded-full px-2 py-0.5 border ${country === null ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>Tous pays</button>
            {[...new Set([...countries, ...(country ? [country] : [])])].map((c) => (
              <button key={c} onClick={() => setCountry(country === c ? null : c)} className={`text-xs rounded-full px-2 py-0.5 border ${country === c ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>{FLAG[c] ?? ''} {COUNTRY_NAME[c] ?? c}</button>
            ))}
            <div className="relative ml-auto">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400" />
              <input className={`${input} pl-7 w-48`} placeholder="Nom ou ville" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <input className={`${input} w-36`} list="ada-brands" placeholder="Marque" value={brand} onChange={(e) => setBrand(e.target.value.toUpperCase())} />
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-700">
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={hideClients} onChange={(e) => setHideClients(e.target.checked)} /> Masquer nos clients actuels</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={hideNetwork} onChange={(e) => setHideNetwork(e.target.checked)} /> Masquer ceux déjà sur la carte</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} /> Multimarques</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={vansOnly} onChange={(e) => setVansOnly(e.target.checked)} /> Vendent des utilitaires</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={dearerOnly} onChange={(e) => setDearerOnly(e.target.checked)} /> Plus chers que nos offres</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={qualifiedOnly} onChange={(e) => setQualifiedOnly(e.target.checked)} /> Avec une fiche d'Ada</label>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'activite' | 'score')} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              <option value="activite">Tri : annonces</option>
              <option value="score">Tri : score d'Ada</option>
            </select>
            <button disabled={toQualify.length === 0} onClick={() => void qualify(toQualify.map((d) => d.id))}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              title="Ada lit leurs annonces et leur site, et trouve à qui écrire (quelques centimes la fiche). Rien n'est envoyé.">
              <Sparkles className="w-3.5 h-3.5" /> {toQualify.length === 0 ? 'Aucune fiche à préparer ici' : toQualify.length === 1 ? 'Préparer 1 fiche' : `Préparer ${toQualify.length} fiches`}
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {!loading && shown.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {rows.length === 0 ? 'L\'annuaire se remplit à chaque page d\'annonces qu\'ADA lit, sur tous les sites (études quotidiennes, études, offres) — ou tout de suite avec « Découvrir » ci-dessus.' : 'Aucun garage ne correspond à ces filtres.'}
            </p>
          )}
          {shown.map((d) => {
            const opp = oppOf.get(d.id) ?? [];
            const ls = byDealer.get(d.id) ?? [];
            const isOpen = open === d.id;
            return (
              <div key={d.id} className="px-4 py-3">
                <div className="flex items-start gap-x-3 gap-y-1.5 flex-wrap">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{d.name}</span>
                      {d.is_client && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200">client actuel</span>}
                      {onMap(d) && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">sur la carte</span>}
                      {d.prospect && (
                        <button onClick={() => setOpen(isOpen ? null : d.id)} className={`text-[10px] rounded-full px-1.5 py-0.5 border ${d.prospect.stage === 'ecarte' ? 'bg-rose-50 text-rose-700 border-rose-200' : scoreTone(d.prospect.score)}`} title="Fiche d'Ada">
                          <Sparkles className="inline w-3 h-3 mr-0.5" />{d.prospect.stage === 'ecarte' ? 'écarté par Ada' : `Ada ${d.prospect.score ?? '—'}/100`}{d.prospect.stage !== 'qualifie' && d.prospect.stage !== 'ecarte' ? ` · ${STAGE_LABEL[d.prospect.stage]}` : ''}
                        </button>
                      )}
                      {queued.has(d.id) && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 animate-pulse">fiche en cours…</span>}
                      {d.nb_brands >= 3 && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-sky-50 text-sky-800 border border-sky-200">multimarques</span>}
                      {d.vans > 0 && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">utilitaires</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{FLAG[d.country ?? ''] ?? ''} {[d.zip, d.city].filter(Boolean).join(' ')}{d.contact_name ? ` · ${d.contact_name}` : ''} · vu {fmtRelative(d.last_listing_at ?? d.last_seen_at)}</p>
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {(d.brands ?? []).slice(0, 6).map((b) => <span key={b} className="text-[10px] rounded-full px-1.5 py-0 bg-slate-50 border border-slate-200 text-slate-600">{nice(b)}</span>)}
                      <span className="text-[11px] text-slate-500">{d.listings} annonce{d.listings > 1 ? 's' : ''}{d.median_price ? ` · prix médian ${eur(d.median_price)}` : ''}</span>
                    </div>
                    {d.prospect?.email && <p className="mt-1 text-xs text-slate-700"><Mail className="inline w-3.5 h-3.5 mr-1 text-slate-400" />{d.prospect.email}</p>}
                    {opp.length > 0 && (
                      <p className="mt-1 text-xs text-emerald-800">
                        {opp.length} annonce{opp.length > 1 ? 's' : ''} plus chère{opp.length > 1 ? 's' : ''} que nos offres, jusqu'à +{eur(opp[0].gap)} ({opp[0].offer.title})
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {d.phone && <a href={`tel:${d.phone}`} className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-ocean"><Phone className="w-3.5 h-3.5" /> {d.phone}</a>}
                    {membersOf(d).map((m) => m.site_url
                      ? <a key={m.id} href={m.site_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline" title={m.site === 'gaspedaal' ? 'Son annonce, chez lui (lien Gaspedaal)' : `Sa page sur ${SITE_LABEL[m.site] ?? m.site}`}><ExternalLink className="w-3.5 h-3.5" /> {SITE_LABEL[m.site] ?? m.site}</a>
                      : <span key={m.id} className="text-[11px] rounded-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-slate-500" title="Vu sur ce site">{SITE_LABEL[m.site] ?? m.site}</span>)}
                    {d.imprint_url && <a href={d.imprint_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Mentions légales</a>}
                    {d.website && <a href={d.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Site web</a>}
                    {!d.prospect && !queued.has(d.id) && (
                      <button onClick={() => void qualify([d.id])} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-violet-800 hover:bg-violet-50" title="Ada lit ses annonces et son site, et trouve à qui écrire">
                        <Sparkles className="w-3.5 h-3.5" /> Préparer la fiche
                      </button>
                    )}
                    {canEditMap && !onMap(d) && (
                      <button onClick={() => void addToMap(d)} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-violet-800 hover:bg-violet-100"><MapPin className="w-3.5 h-3.5" /><Plus className="w-3 h-3" /> Carte</button>
                    )}
                    <button onClick={() => setOpen(isOpen ? null : d.id)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} /> Annonces
                    </button>
                  </div>
                </div>
                {isOpen && details.get(d.id) && (
                  <QualifCard p={details.get(d.id) as ProspectDetail} onStage={(st) => void changeStage(details.get(d.id) as ProspectDetail, st)} onRequalify={() => void qualify([d.id])} requalifying={queued.has(d.id)}
                    threadId={threads.get((details.get(d.id) as ProspectDetail).id) ?? null} onDraft={() => void draft(details.get(d.id) as ProspectDetail)}
                    drafting={drafting.has((details.get(d.id) as ProspectDetail).id)} onOpenThread={onOpenThread}
                    onDeep={() => void deepen(details.get(d.id) as ProspectDetail)} deeping={deeping.has((details.get(d.id) as ProspectDetail).id)} />
                )}
                {isOpen && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs">
                      <thead><tr className="text-left text-slate-400"><th className="py-1 pr-2 font-normal">Véhicule</th><th className="pr-2 font-normal">Année</th><th className="pr-2 font-normal">Km</th><th className="pr-2 font-normal text-right">Prix affiché</th><th className="pr-2 font-normal">Face à nos offres</th><th className="font-normal">Vu</th></tr></thead>
                      <tbody>
                        {ls.slice(0, 40).map((l) => {
                          const o = opp.find((x) => x.listing.listing_url === l.listing_url);
                          return (
                            <tr key={l.listing_url} className="border-t border-slate-100">
                              <td className="py-1 pr-2"><a href={l.listing_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">{l.brand ? nice(l.brand) : ''} {l.model ?? l.title}</a></td>
                              <td className="pr-2 tabular-nums">{l.year ?? '—'}</td>
                              <td className="pr-2 tabular-nums">{l.mileage != null ? l.mileage.toLocaleString('fr-FR') : '—'}</td>
                              <td className="pr-2 tabular-nums text-right">{eur(l.price_eur)}</td>
                              <td className="pr-2">{o ? <span className="text-emerald-800">+{eur(o.gap)} ({o.gapPct} %) face à {o.offer.title} à {eur(o.ourTtc)} TTC</span> : <span className="text-slate-300">—</span>}</td>
                              <td className="text-slate-400">{fmtDateTime(l.last_seen_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {ls.length > 40 && <p className="text-[11px] text-slate-400 mt-1">40 annonces affichées sur {ls.length}.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
