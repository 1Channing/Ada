/**
 * Sourcing de Dana (17/10, Channing : « plusieurs véhicules identiques, c'est
 * intéressant, il y a un sourcing là-bas peut-être ? » ; Dana cherche des
 * fournisseurs dans toute l'Europe, les lots d'abord).
 *
 * 18/10 (Channing : « ces lots en ligne ne nous indiquent rien tels quels. Il
 * faut aller plus loin… on peut garder ces lots en indiquant que ce sont
 * potentiellement des grands comptes, mais ces indications doivent servir
 * Dana à aller plus loin ! … à qui appartient cette concession ? qui
 * contacter chez eux pour de l'achat en lots ? qui gère le de-fleet ? ») :
 * la page parle des VENDEURS, le lot n'est qu'un indice. Pour chaque vendeur
 * — un garage, toutes ses fiches réunies —, ses lots (plusieurs véhicules
 * identiques : marque, modèle, année), ce qu'ils valent dans nos pays de
 * vente (écart BRUT, avant taxes, transport et frais), puis ce que Dana en
 * sait : à quel groupe il appartient, qui approcher, ce qui manque. Deux
 * gestes : « Préparer la fiche » (qui vend, son site, ses e-mails publiés,
 * grand compte ou non), puis « Recherche approfondie » (à qui il appartient,
 * qui décide des ventes en lots ou du de-fleet, comment l'approcher) — d'office
 * pour un grand compte à compléter. Les liens directs de Gaspedaal (refusés
 * hors de leur site) sont remplacés par la recherche du modèle sur Gaspedaal.
 * - Relevé ciblé (18/10 : Dana relève déjà les annonces toute seule si
 *   c'est coché dans ses Réglages) : tout de suite, une marque ou un modèle
 *   précis dans un pays (tous pays, la France comprise). Sans IA.
 * - Premier contact (Opus 5.5) : un petit compte reçoit le mail d'achat de
 *   Dana (aucun prix : la négociation passe par Channing), à valider ; un
 *   grand compte est préparé pour vous (mail, note LinkedIn, fiche d'appel).
 * Rien n'est envoyé à personne d'ici.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Radar, ExternalLink, Phone, MapPin, Plus, ChevronDown, X, Sparkles, Crown, Telescope, Search, AlertTriangle, User } from 'lucide-react';
import {
  listLots, listTasks, queueDanaDiscovery, cancelTask, addLotDealerToMap, queueQualification, queueFirstMails, prospectDetails, setProspectStage, threadsOfProspects, indexMeta, queueDeepResearch,
  type DealerLot, type AgentTask, type ProspectDetail, type ProspectStage,
} from '../../services/agents';
import { QualifCard } from './QualifCard';
import { DISCOVERY_SITES, DISCOVERY_SITE_LABEL, discoveryPages } from '../../lib/agents/discovery';
import { EXPORT_MARKETS } from '../../lib/agents/qualification';
import { looksLikeGroup } from '../../lib/agents/sourcing';
import { missingOf, lastDeepAt } from '../../lib/agents/deepResearch';
import { SITE_LABEL } from '../../services/dealerDirectory';
import { fmtRelative, fmtDateTime, STAGE_LABEL, scoreTone } from './helpers';

const FLAG: Record<string, string> = { FR: '🇫🇷', DE: '🇩🇪', NL: '🇳🇱', BE: '🇧🇪', ES: '🇪🇸', IT: '🇮🇹', DK: '🇩🇰', AT: '🇦🇹', LU: '🇱🇺', SE: '🇸🇪', HU: '🇭🇺', LT: '🇱🇹' };
const COUNTRY_NAME: Record<string, string> = { FR: 'France', DE: 'Allemagne', NL: 'Pays-Bas', BE: 'Belgique', ES: 'Espagne', IT: 'Italie', DK: 'Danemark', SE: 'Suède', HU: 'Hongrie', AT: 'Autriche', LU: 'Luxembourg', LT: 'Lituanie' };
const MARKET_CHOICES = ['NL', 'DK', 'BE', 'DE', 'ES', 'IT', 'SE', 'AT'];
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} km`);
const nice = (b: string) => b.charAt(0) + b.slice(1).toLowerCase();
const siteLabel = (s: string | undefined) => DISCOVERY_SITE_LABEL[String(s ?? 'AUTOSCOUT').toUpperCase()] ?? s ?? 'AutoScout24';
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';
const TASK_STATUS: Record<AgentTask['status'], { label: string; cls: string }> = {
  en_attente: { label: 'en attente', cls: 'bg-slate-100 text-slate-600' },
  en_cours: { label: 'en cours', cls: 'bg-blue-50 text-blue-800' },
  terminee: { label: 'terminée', cls: 'bg-emerald-50 text-emerald-800' },
  echec: { label: 'échec', cls: 'bg-red-50 text-red-800' },
  annulee: { label: 'annulée', cls: 'bg-slate-100 text-slate-400' },
};

/** Le meilleur écart brut d'un lot (pays de vente le mieux payé), ou null. */
const bestGap = (l: DealerLot) => (l.markets.length ? Math.max(...l.markets.map((m) => m.gap)) : null);

/** Un lien direct de Gaspedaal (api.gaspedaal.nl/redirect/…) : le site le refuse hors de ses pages (« Access Denied »). */
const isGaspedaalRedirect = (u: string | null | undefined) => /api\.gaspedaal\.nl\/redirect\//i.test(u ?? '');
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** À la place : le même modèle, la même année, sur Gaspedaal. */
const gaspedaalModelUrl = (l: Pick<DealerLot, 'brand' | 'model' | 'year'>) =>
  `https://www.gaspedaal.nl/${slug(l.brand)}?bmin=${l.year}&bmax=${l.year}&trefw=${encodeURIComponent(l.model)}&srt=df-a`;
const googleUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** Un vendeur repéré par ses lots : le garage (toutes ses fiches réunies) et ses lots. */
interface Seller { id: string; dealer: DealerLot['dealer']; members: DealerLot['members']; lots: DealerLot[]; prospect: DealerLot['prospect'] }

interface Props { userId: string | null; canEditMap: boolean; refreshKey: number; onError: (m: string) => void; onInfo: (m: string) => void; onOpenThread: (id: string) => void }

export function Sourcing({ userId, canEditMap, refreshKey, onError, onInfo, onOpenThread }: Props) {
  const [lots, setLots] = useState<DealerLot[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [min, setMin] = useState(3);
  const [markets, setMarkets] = useState<string[]>(EXPORT_MARKETS);
  const [sort, setSort] = useState<'taille' | 'ecart'>('taille');
  const [gainOnly, setGainOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [disc, setDisc] = useState({ site: 'AUTOSCOUT', country: 'FR', brand: 'Toyota', model: '', pages: 5 });
  const [targeted, setTargeted] = useState(false);
  // Les fiches de Dana (par prospect) et leurs fils ; la fiche ouverte (par vendeur).
  const [details, setDetails] = useState<Map<string, ProspectDetail>>(new Map());
  const [threads, setThreads] = useState<Map<string, string>>(new Map());
  const [card, setCard] = useState<string | null>(null);
  // Les lots sont précalculés par le serveur (SQL agents_index) : l'heure du dernier calcul.
  const [computedAt, setComputedAt] = useState<string | null>(null);

  const loadLots = useCallback(async () => {
    setLoading(true);
    const r = await listLots({ country, markets, min, brand: brand || null });
    void indexMeta().then((m) => setComputedAt(m?.computed_at ?? null));
    if (r.error) { setLoading(false); onError(r.error); return; }
    setLots(r.rows);
    const withProspect = r.rows.filter((l) => l.prospect);
    const det = await prospectDetails([...new Set(withProspect.map((l) => l.prospect?.dealer_id as string))], 'dana');
    setDetails(new Map(det.map((x) => [x.id, x])));
    setThreads(await threadsOfProspects(det.map((x) => x.id)));
    setLoading(false);
  }, [country, markets, min, brand, onError]);
  const loadTasks = useCallback(async () => {
    const r = await listTasks(30, 'dana');
    if (r.error) onError(r.error); else setTasks(r.rows);
  }, [onError]);
  useEffect(() => { const t = setTimeout(() => void loadLots(), 250); return () => clearTimeout(t); }, [loadLots, refreshKey]);
  useEffect(() => { void loadTasks(); }, [loadTasks, refreshKey]);
  const busy = tasks.some((t) => t.status === 'en_attente' || t.status === 'en_cours');
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => { void loadTasks(); void loadLots(); }, 10_000);
    return () => window.clearInterval(id);
  }, [busy, loadTasks, loadLots]);

  // Les vendeurs, dans l'ordre de leur meilleur lot (taille, ou écart brut).
  const sellers = useMemo(() => {
    const rows = gainOnly ? lots.filter((l) => (bestGap(l) ?? 0) > 0) : lots;
    const sorted = sort === 'ecart' ? [...rows].sort((a, b) => (bestGap(b) ?? -Infinity) - (bestGap(a) ?? -Infinity)) : rows;
    const by = new Map<string, Seller>();
    for (const l of sorted) {
      const s = by.get(l.dealer.id) ?? by.set(l.dealer.id, { id: l.dealer.id, dealer: l.dealer, members: l.members, lots: [], prospect: l.prospect ?? null }).get(l.dealer.id)!;
      s.lots.push(l);
      if (!s.prospect && l.prospect) s.prospect = l.prospect;
    }
    return [...by.values()];
  }, [lots, sort, gainOnly]);
  const countries = useMemo(() => [...new Set(lots.map((l) => l.dealer.country).filter(Boolean) as string[])].sort(), [lots]);
  const discoveries = tasks.filter((t) => t.kind === 'decouverte_concessions');
  const isOpenTask = (t: AgentTask) => t.status === 'en_attente' || t.status === 'en_cours';
  // Garages confiés à Dana, premiers contacts en rédaction, fiches en recherche approfondie.
  const queued = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && !t.params.approfondie && isOpenTask(t)).flatMap((t) => t.params.dealer_ids ?? [])), [tasks]);
  const drafting = useMemo(() => new Set(tasks.filter((t) => t.kind === 'premier_mail' && isOpenTask(t)).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  const deeping = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && t.params.approfondie && isOpenTask(t)).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  // Les prochains vendeurs à ficher : pas encore fichés par Dana.
  const toQualify = useMemo(() => sellers.filter((s) => !s.prospect && !queued.has(s.id)).map((s) => s.id).slice(0, 10), [sellers, queued]);

  const qualify = async (ids: string[]) => {
    const e = await queueQualification(ids, userId, 'dana');
    if (e) { onError(e); return; }
    onInfo(`Dana prépare ${ids.length > 1 ? `${ids.length} fiches` : 'la fiche'} : qui vend, à quel groupe il appartient, e-mails publiés, grand compte ou non. Une minute environ par fiche ; un grand compte à compléter passe ensuite en recherche approfondie. Rien n'est envoyé à personne.`);
    void loadTasks();
  };
  const draft = async (p: ProspectDetail) => {
    const e = await queueFirstMails([p.id], userId, 'dana');
    if (e) { onError(e); return; }
    onInfo(p.key_account
      ? `Dana prépare pour vous le grand compte ${p.name} (mail, note LinkedIn, fiche d'appel) : « À valider › Pour vous » d'ici une minute.`
      : `Dana rédige le premier mail pour ${p.name} : il arrivera dans « À valider » d'ici une minute. Rien ne part sans validation.`);
    void loadTasks();
  };
  const changeStage = async (p: ProspectDetail, stage: ProspectStage) => {
    const e = await setProspectStage(p.id, stage);
    if (e) { onError(e); return; }
    setDetails((m) => new Map(m).set(p.id, { ...p, stage }));
  };
  const deepen = async (p: ProspectDetail) => {
    const e = await queueDeepResearch([p.id], userId, 'dana');
    if (e) { onError(e); return; }
    onInfo(`Dana cherche plus loin pour ${p.name} : à qui appartient le garage, qui décide des ventes en lots ou du de-fleet, les e-mails et téléphones publiés. Une à deux minutes.`);
    void loadTasks();
  };

  const launch = async () => {
    const e = await queueDanaDiscovery({ site: disc.site, country: disc.country, brand: disc.brand.trim(), model: disc.model.trim() || undefined, pages: discoveryPages(disc.pages) }, userId);
    if (e) onError(e); else { onInfo(`Relevé de Dana lancé : ${siteLabel(disc.site)} ${COUNTRY_NAME[disc.country] ?? disc.country} · ${disc.brand}. Les lots apparaissent ici d'ici quelques minutes (ils sont recalculés après chaque relevé).`); void loadTasks(); }
  };
  const discSites = DISCOVERY_SITES[disc.country] ?? ['AUTOSCOUT'];
  const toMap = async (l: DealerLot) => {
    const r = await addLotDealerToMap(l, userId);
    if (r.error) { onError(r.error); return; }
    setAdded((s) => new Set(s).add(l.dealer.id));
    onInfo(`${l.dealer.name} ajouté à la carte comme vendeur (badge « IA · Dana »)${r.placed ? '' : ' — à placer sur la carte : adresse introuvable'}.`);
  };

  return (
    <div className="space-y-4">
      {/* Les vendeurs repérés par leurs lots */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">Vendeurs repérés par leurs lots</h3>
            <span className="ml-auto text-xs text-slate-400">{loading ? 'lecture…' : `${sellers.length} vendeur${sellers.length > 1 ? 's' : ''} · ${lots.length} lot${lots.length > 1 ? 's' : ''}`}{computedAt ? ` · recalculés ${fmtRelative(computedAt)}` : ''}</span>
          </div>
          <p className="text-xs text-slate-600">
            Un lot, ce sont plusieurs véhicules identiques (même marque, modèle, année) chez un même vendeur, vus ces 45 derniers jours : souvent le signe d'un professionnel qui écoule du stock — retours de location ou de leasing, stock d'un groupe. Le lot n'est qu'un point de départ :
            Dana <b>prépare la fiche</b> (qui vend, à quel groupe il appartient, ses e-mails publiés), puis <b>va plus loin</b> (qui décide des ventes en lots ou du de-fleet, comment l'approcher) — d'office pour un grand compte à compléter.
          </p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {toQualify.length > 0 && (
              <button onClick={() => void qualify(toQualify)} className="inline-flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-2.5 py-1 font-medium" title="Qui vend chez eux, à quel groupe ils appartiennent, e-mail publié, LinkedIn s'il est trouvé, grand compte ou non. Quelques centimes la fiche.">
                <Sparkles className="w-3.5 h-3.5" /> {toQualify.length > 1 ? `Préparer ${toQualify.length} fiches` : 'Préparer 1 fiche'}
              </button>
            )}
            {queued.size > 0 && <span className="text-teal-800 animate-pulse">Dana prépare {queued.size} fiche{queued.size > 1 ? 's' : ''}…</span>}
            {deeping.size > 0 && <span className="text-indigo-800 animate-pulse">Dana cherche plus loin sur {deeping.size} vendeur{deeping.size > 1 ? 's' : ''}…</span>}
            {drafting.size > 0 && <span className="text-violet-800 animate-pulse">Dana rédige {drafting.size} premier{drafting.size > 1 ? 's' : ''} contact{drafting.size > 1 ? 's' : ''}…</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setCountry(null)} className={`text-xs rounded-full px-2 py-0.5 border ${country === null ? 'bg-teal-700 text-white border-teal-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>Tous pays</button>
            {[...new Set([...countries, ...(country ? [country] : [])])].map((c) => (
              <button key={c} onClick={() => setCountry(country === c ? null : c)} className={`text-xs rounded-full px-2 py-0.5 border ${country === c ? 'bg-teal-700 text-white border-teal-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>{FLAG[c] ?? ''} {COUNTRY_NAME[c] ?? c}</button>
            ))}
            <input className={`${input} w-36 ml-auto`} placeholder="Marque" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <label className="inline-flex items-center gap-1 text-xs text-slate-700">
              À partir de
              <select value={min} onChange={(e) => setMin(Number(e.target.value))} className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs">
                {[2, 3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              véhicules
            </label>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-700">
            <span className="text-slate-500">Comparé à nos pays de vente :</span>
            {MARKET_CHOICES.map((m) => (
              <button key={m} onClick={() => setMarkets(markets.includes(m) ? markets.filter((x) => x !== m) : [...markets, m])}
                className={`rounded-full border px-2 py-0.5 ${markets.includes(m) ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-500'}`}>{FLAG[m]} {m}</button>
            ))}
            <label className="inline-flex items-center gap-1 ml-2"><input type="checkbox" checked={gainOnly} onChange={(e) => setGainOnly(e.target.checked)} /> Moins chers que dans nos pays de vente</label>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'taille' | 'ecart')} className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs">
              <option value="taille">Tri : taille du lot</option>
              <option value="ecart">Tri : écart brut</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-400">Écart brut = prix médian constaté dans le pays de vente (annonces des garages et relevés de vos études, même modèle, année à un an près, au moins 3 annonces) moins le prix médian du lot, avant taxes d'immatriculation, transport et frais.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {!loading && sellers.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {lots.length === 0 ? 'Aucun lot pour l\'instant : les lots se repèrent dans les annonces qu\'ADA lit (études, relevés). Lancez un relevé ci-dessous, ou cochez les relevés automatiques dans les Réglages.' : 'Aucun lot ne correspond à ces filtres.'}
            </p>
          )}
          {sellers.map((s) => {
            const pr = s.prospect ?? null;
            const det = pr ? details.get(pr.id) ?? null : null;
            const cardOpen = card === s.id;
            const lotsOpen = open === s.id;
            const biggest = Math.max(...s.lots.map((l) => l.count));
            const potential = !pr && (looksLikeGroup(s.dealer.name) || s.lots.length >= 2 || biggest >= 5);
            // Ce qui manque pour l'approcher (le téléphone des annonces compte ; LinkedIn, seulement pour un grand compte).
            const missing = det && ['qualifie', 'a_contacter'].includes(det.stage)
              ? missingOf({ ...det, phone: det.phone ?? s.dealer.phone }).filter((x) => det.key_account || !/LinkedIn/.test(x)) : [];
            const deepAt = det ? lastDeepAt(det.evidence) : null;
            const members = s.members.length ? s.members : [{ id: s.dealer.id, site: s.dealer.site ?? 'autoscout24', site_url: s.dealer.site_url }];
            const gaspedaal = members.some((m) => m.site === 'gaspedaal') || s.lots.some((l) => l.urls.some(isGaspedaalRedirect));
            const best = det?.best_contact;
            return (
              <div key={s.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-start gap-x-3 gap-y-1.5 flex-wrap">
                  <div className="min-w-0 flex-1 basis-full md:basis-0">
                    <p className="text-sm text-slate-900 flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold">{s.dealer.name}</span>
                      <span className="text-xs text-slate-500">{FLAG[s.dealer.country ?? ''] ?? ''} {[s.dealer.zip, s.dealer.city].filter(Boolean).join(' ')}</span>
                      {pr && <span className={`rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(pr.score)}`} title="Note de Dana">{pr.score ?? '—'}</span>}
                      {pr && <span className="text-[11px] text-slate-500">{STAGE_LABEL[pr.stage] ?? pr.stage}</span>}
                      {pr?.key_account && <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 bg-violet-600 text-white"><Crown className="w-3 h-3" /> grand compte</span>}
                      {potential && <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 border border-violet-300 text-violet-800" title="Un nom de groupe, plusieurs lots ou un gros lot : la fiche dira à qui il appartient"><Crown className="w-3 h-3" /> grand compte potentiel</span>}
                    </p>
                    {/* Ce que Dana sait du vendeur */}
                    {det ? (
                      <p className="text-xs text-slate-700 mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                        {det.group_name && <span>{/^groupe?\b/i.test(det.group_name) ? det.group_name : `Groupe ${det.group_name}`}{det.sites ? ` · ${det.sites} sites` : ''}</span>}
                        {best?.nom
                          ? <span className="inline-flex items-center gap-0.5"><User className="w-3 h-3 text-slate-400" /> à approcher : {best.nom}{best.fonction ? ` — ${best.fonction}` : ''}{best.email ? ` · ${best.email}` : ''}</span>
                          : <span className="text-slate-500">personne qui décide pas encore trouvée</span>}
                        {deepAt && <span className="inline-flex items-center gap-0.5 text-indigo-800"><Telescope className="w-3 h-3" /> recherche approfondie du {fmtDateTime(deepAt)}</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 mt-0.5">{queued.has(s.id) ? 'Dana prépare la fiche…' : 'Pas encore de fiche : à qui il appartient et qui décide, la fiche le dira.'}</p>
                    )}
                    {missing.length > 0 && <p className="text-[11px] text-amber-800 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> manque : {missing.join(', ')}</p>}
                    {/* Ses lots */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {s.lots.map((l) => {
                        const g = bestGap(l);
                        const days = Math.max(0, Math.round((Date.now() - Date.parse(l.first_seen_at)) / 86_400_000));
                        return (
                          <span key={`${l.brand}|${l.model}|${l.year}`} className="text-[11px] rounded-lg px-2 py-0.5 bg-teal-50 border border-teal-200 text-teal-900"
                            title={`${eur(l.price_min)} à ${eur(l.price_max)} (médiane ${eur(l.price_median)}) · ${km(l.km_min)} à ${km(l.km_max)} · vu par ADA depuis ${days} jour${days > 1 ? 's' : ''}`}>
                            <b>{l.count} × {nice(l.brand)} {l.model} {l.year}</b> · {eur(l.price_median)}{g != null ? <span className={g > 0 ? 'text-emerald-700' : 'text-slate-500'}> · {g > 0 ? '+' : ''}{eur(g)} {l.markets.find((m) => m.gap === g)?.market ?? ''}</span> : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs md:justify-end md:max-w-[22rem]">
                    {s.dealer.phone && <a href={`tel:${s.dealer.phone}`} className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-ocean"><Phone className="w-3.5 h-3.5" /> {s.dealer.phone}</a>}
                    {(det?.website ?? s.dealer.website) && <a href={(det?.website ?? s.dealer.website) as string} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Site web</a>}
                    {members.filter((m) => m.site_url && !isGaspedaalRedirect(m.site_url)).map((m) => (
                      <a key={m.id} href={m.site_url as string} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> {SITE_LABEL[m.site] ?? m.site}</a>
                    ))}
                    {gaspedaal && (
                      <a href={gaspedaalModelUrl(s.lots[0])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"
                        title="Gaspedaal refuse ses liens directs hors de son site (« Access Denied ») : la recherche du même modèle et de la même année sur Gaspedaal.">
                        <ExternalLink className="w-3.5 h-3.5" /> Gaspedaal (le modèle)
                      </a>
                    )}
                    <a href={googleUrl(`${s.dealer.name} ${s.dealer.city ?? ''}`.trim())} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-ocean" title="Chercher ce vendeur sur Google"><Search className="w-3.5 h-3.5" /> Google</a>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {pr ? (
                    <button onClick={() => setCard(cardOpen ? null : s.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${cardOpen ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
                      <Sparkles className="w-3.5 h-3.5" /> Fiche de Dana
                    </button>
                  ) : queued.has(s.id) ? (
                    <span className="text-teal-800 animate-pulse">fiche en cours…</span>
                  ) : (
                    <button onClick={() => void qualify([s.id])} className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-white px-2 py-1 text-teal-800 hover:bg-teal-50" title="Qui vend chez eux, à quel groupe ils appartiennent, e-mail publié, grand compte ou non">
                      <Sparkles className="w-3.5 h-3.5" /> Préparer la fiche
                    </button>
                  )}
                  {det && ['qualifie', 'a_contacter'].includes(det.stage) && (deeping.has(det.id)
                    ? <span className="text-indigo-700 animate-pulse">Dana cherche plus loin…</span>
                    : (
                      <button onClick={() => void deepen(det)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-2 py-1 font-medium text-indigo-800 hover:bg-indigo-50"
                        title="À qui appartient le garage, qui décide des ventes en lots ou du de-fleet (au niveau du groupe d'abord), les e-mails et téléphones publiés, des pistes pour l'approcher. Environ 0,10 $.">
                        <Telescope className="w-3.5 h-3.5" /> {deepAt ? 'Chercher encore plus loin' : 'Recherche approfondie'}
                      </button>
                    ))}
                  {canEditMap && !added.has(s.id) && !pr && (
                    <button onClick={() => void toMap(s.lots[0])} className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-teal-800 hover:bg-teal-100" title="Sur la carte du réseau, comme vendeur"><MapPin className="w-3.5 h-3.5" /><Plus className="w-3 h-3" /> Carte</button>
                  )}
                  <button onClick={() => setOpen(lotsOpen ? null : s.id)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                    <ChevronDown className={`w-4 h-4 transition-transform ${lotsOpen ? 'rotate-180' : ''}`} /> Annonces
                  </button>
                </div>
                {cardOpen && pr && (det
                  ? <QualifCard p={det} agentName="Dana" onStage={(st) => void changeStage(det, st)} onRequalify={() => void qualify([s.id])} requalifying={queued.has(s.id)}
                      threadId={threads.get(det.id) ?? null} onDraft={() => void draft(det)} drafting={drafting.has(det.id)} onOpenThread={onOpenThread}
                      onDeep={() => void deepen(det)} deeping={deeping.has(det.id)} />
                  : <p className="mt-2 text-xs text-slate-400">Fiche en lecture…</p>)}
                {lotsOpen && (
                  <div className="mt-1 space-y-1.5 text-xs">
                    {s.lots.map((l) => {
                      const days = Math.max(0, Math.round((Date.now() - Date.parse(l.first_seen_at)) / 86_400_000));
                      return (
                        <div key={`${l.brand}|${l.model}|${l.year}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5">
                          <p className="text-slate-800"><b>{l.count} × {nice(l.brand)} {l.model} {l.year}</b>{(l.fuels ?? []).length ? ` · ${(l.fuels ?? []).slice(0, 2).join(', ')}` : ''} · {eur(l.price_min)} à {eur(l.price_max)} · {km(l.km_min)} à {km(l.km_max)} · vu depuis {days} jour{days > 1 ? 's' : ''}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {l.markets.length === 0 && <span className="text-[11px] text-slate-400">pas encore assez d'annonces comparables dans nos pays de vente</span>}
                            {l.markets.map((m) => (
                              <span key={m.market} title={`${m.n} annonces comparables`} className={`text-[11px] rounded-full px-2 py-0.5 border ${m.gap > 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                {FLAG[m.market] ?? ''} {eur(m.median)} ({m.n}) · {m.gap > 0 ? '+' : ''}{eur(m.gap)}
                              </span>
                            ))}
                          </div>
                          <p className="mt-0.5 flex items-center gap-2 flex-wrap">
                            {l.urls.map((u, i) => isGaspedaalRedirect(u)
                              ? <span key={u} className="text-slate-400" title="Lien direct de Gaspedaal, refusé hors de leur site">Annonce {i + 1} (Gaspedaal)</span>
                              : <a key={u} href={u} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">Annonce {i + 1}</a>)}
                            {l.urls.some(isGaspedaalRedirect) && <a href={gaspedaalModelUrl(l)} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">voir le modèle sur Gaspedaal</a>}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Relevés d'annonces : automatiques (Réglages), ou ciblés ici, tout de suite */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Radar className="w-4 h-4 text-teal-700" />
          <h3 className="text-sm font-semibold text-slate-900">Relevés d'annonces</h3>
          <span className="text-xs text-slate-500">— Dana les fait toute seule si c'est coché dans ses Réglages. Un relevé ciblé ici : une marque ou un modèle précis, dans un pays, tout de suite. Sans IA.</span>
          <button onClick={() => setTargeted((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${targeted ? 'rotate-180' : ''}`} /> Relevé ciblé
          </button>
        </div>
        {targeted && <div className="flex items-center gap-2 flex-wrap text-sm">
          <select className={input} value={disc.country} onChange={(e) => { const c = e.target.value; const sites = DISCOVERY_SITES[c] ?? ['AUTOSCOUT']; setDisc({ ...disc, country: c, site: sites.includes(disc.site) ? disc.site : sites[0] }); }}>
            {Object.keys(DISCOVERY_SITES).map((c) => <option key={c} value={c}>{FLAG[c]} {COUNTRY_NAME[c] ?? c}</option>)}
          </select>
          <select className={input} value={disc.site} onChange={(e) => setDisc({ ...disc, site: e.target.value })}>
            {discSites.map((x) => <option key={x} value={x}>{siteLabel(x)}</option>)}
          </select>
          <input className={`${input} w-40`} placeholder="Marque" value={disc.brand} onChange={(e) => setDisc({ ...disc, brand: e.target.value })} />
          <input className={`${input} w-40`} placeholder="Modèle (facultatif)" value={disc.model} onChange={(e) => setDisc({ ...disc, model: e.target.value })} />
          <label className="inline-flex items-center gap-1 text-slate-700"><input type="number" min={1} max={10} className={`${input} w-16`} value={disc.pages} onChange={(e) => setDisc({ ...disc, pages: Number(e.target.value) })} /> pages</label>
          <button disabled={!disc.brand.trim()} onClick={() => void launch()} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"><Radar className="w-4 h-4" /> Lancer</button>
        </div>}
        {discoveries.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {discoveries.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs flex-wrap">
                <span className={`rounded-full px-2 py-0.5 ${TASK_STATUS[t.status].cls}`}>{TASK_STATUS[t.status].label}</span>
                <span className="font-medium text-slate-800">{FLAG[t.params.country ?? ''] ?? ''} {siteLabel(t.params.site)} · {t.params.brand}{t.params.model ? ` ${t.params.model}` : ''}</span>
                {!t.created_by && <span className="text-[10px] rounded-full px-1.5 bg-slate-50 border border-slate-200 text-slate-500">automatique</span>}
                {t.status === 'terminee' && t.result && <span className="text-slate-600">{t.result.annonces} annonces lues{t.result.avec_garage != null ? ` · ${t.result.avec_garage} avec leur garage` : ''} · {t.result.concessions} garages</span>}
                {t.status === 'echec' && <span className="text-red-700">{t.error}</span>}
                <span className="ml-auto text-slate-400">{fmtRelative(t.finished_at ?? t.created_at)}</span>
                {t.status === 'en_attente' && <button onClick={() => void cancelTask(t.id).then((e) => (e ? onError(e) : void loadTasks()))} className="text-slate-400 hover:text-rose-600" title="Annuler"><X className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
