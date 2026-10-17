/**
 * Sourcing de Dana (17/10, Channing : « plusieurs véhicules identiques, c'est
 * intéressant, il y a un sourcing là-bas peut-être ? » ; Dana cherche des
 * fournisseurs dans toute l'Europe, les lots d'abord).
 *
 * - Les lots : chez un même garage (toutes ses fiches réunies, tous pays),
 *   plusieurs véhicules identiques — même marque, même modèle, même année —
 *   lus dans les annonces qu'ADA voit déjà. Pour chacun : prix, km, depuis
 *   quand ADA le voit, et ce que ces véhicules valent dans nos pays de vente
 *   (annonces des garages et relevés des études) : un écart BRUT, avant
 *   taxes d'immatriculation, transport et frais.
 * - Découvrir : Dana lit les pages d'un site (tous pays, la France
 *   comprise) pour trouver d'autres garages et leurs lots. Sans IA.
 * - Qualifier (17/10, Haiku 5.5) : qui vend chez ce garage (VO, négoce,
 *   remarketing), son e-mail publié, son profil LinkedIn s'il est vu ; un
 *   groupe, un loueur, un leasing, une flotte = un grand compte.
 * - Premier contact (Opus 5.5) : un petit compte reçoit le mail d'achat de
 *   Dana (aucun prix : la négociation passe par Channing), à valider ; un
 *   grand compte est préparé pour vous (mail, note LinkedIn, fiche d'appel).
 * Rien n'est envoyé à personne d'ici.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Radar, ExternalLink, Phone, MapPin, Plus, ChevronDown, X, Sparkles, Crown } from 'lucide-react';
import {
  listLots, listTasks, queueDanaDiscovery, cancelTask, addLotDealerToMap, queueQualification, queueFirstMails, prospectDetails, setProspectStage, threadsOfProspects,
  type DealerLot, type AgentTask, type ProspectDetail, type ProspectStage,
} from '../../services/agents';
import { QualifCard } from './QualifCard';
import { DISCOVERY_SITES, DISCOVERY_SITE_LABEL, discoveryPages } from '../../lib/agents/discovery';
import { EXPORT_MARKETS } from '../../lib/agents/qualification';
import { SITE_LABEL } from '../../services/dealerDirectory';
import { fmtRelative, STAGE_LABEL, scoreTone } from './helpers';

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
  // Les fiches de Dana (par prospect) et leurs fils ; la fiche ouverte (par garage).
  const [details, setDetails] = useState<Map<string, ProspectDetail>>(new Map());
  const [threads, setThreads] = useState<Map<string, string>>(new Map());
  const [card, setCard] = useState<string | null>(null);

  const loadLots = useCallback(async () => {
    setLoading(true);
    const r = await listLots({ country, markets, min, brand: brand || null });
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

  const shown = useMemo(() => {
    const rows = gainOnly ? lots.filter((l) => (bestGap(l) ?? 0) > 0) : lots;
    return sort === 'ecart' ? [...rows].sort((a, b) => (bestGap(b) ?? -Infinity) - (bestGap(a) ?? -Infinity)) : rows;
  }, [lots, sort, gainOnly]);
  const countries = useMemo(() => [...new Set(lots.map((l) => l.dealer.country).filter(Boolean) as string[])].sort(), [lots]);
  const keyOf = (l: DealerLot) => `${l.dealer.id}|${l.brand}|${l.model}|${l.year}`;
  const discoveries = tasks.filter((t) => t.kind === 'decouverte_concessions');
  // Garages confiés à Dana, premiers contacts en cours de rédaction.
  const queued = useMemo(() => new Set(tasks.filter((t) => t.kind === 'qualification' && (t.status === 'en_attente' || t.status === 'en_cours')).flatMap((t) => t.params.dealer_ids ?? [])), [tasks]);
  const drafting = useMemo(() => new Set(tasks.filter((t) => t.kind === 'premier_mail' && (t.status === 'en_attente' || t.status === 'en_cours')).flatMap((t) => t.params.prospect_ids ?? [])), [tasks]);
  // Les prochains garages à qualifier : un par garage, pas encore fichés par Dana.
  const toQualify = useMemo(() => [...new Set(shown.filter((l) => !l.prospect && !queued.has(l.dealer.id)).map((l) => l.dealer.id))].slice(0, 10), [shown, queued]);

  const qualify = async (ids: string[]) => {
    const e = await queueQualification(ids, userId, 'dana');
    if (e) { onError(e); return; }
    onInfo(`${ids.length} garage${ids.length > 1 ? 's' : ''} confié${ids.length > 1 ? 's' : ''} à Dana : qui vend, e-mail publié, grand compte ou non. Comptez une minute environ par garage. Rien n'est envoyé à personne.`);
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

  const launch = async () => {
    const e = await queueDanaDiscovery({ site: disc.site, country: disc.country, brand: disc.brand.trim(), model: disc.model.trim() || undefined, pages: discoveryPages(disc.pages) }, userId);
    if (e) onError(e); else { onInfo(`Découverte de Dana lancée : ${siteLabel(disc.site)} ${COUNTRY_NAME[disc.country] ?? disc.country} · ${disc.brand}. Les lots apparaissent ici d'ici une à deux minutes.`); void loadTasks(); }
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
      {/* Les lots */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">Lots repérés par Dana</h3>
            <span className="text-xs text-slate-500">— plusieurs véhicules identiques (marque, modèle, année) chez un même garage, tous pays, vus ces 45 derniers jours.</span>
            <span className="ml-auto text-xs text-slate-400">{loading ? 'lecture…' : `${shown.length} lot${shown.length > 1 ? 's' : ''}`}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {toQualify.length > 0 && (
              <button onClick={() => void qualify(toQualify)} className="inline-flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-2.5 py-1 font-medium" title="Haiku 5.5 : qui vend chez eux, e-mail publié, profil LinkedIn s'il est vu, grand compte ou non. Quelques centimes par garage.">
                <Sparkles className="w-3.5 h-3.5" /> {toQualify.length > 1 ? `Qualifier les ${toQualify.length} premiers garages` : 'Qualifier 1 garage'}
              </button>
            )}
            {queued.size > 0 && <span className="text-teal-800 animate-pulse">Dana qualifie {queued.size} garage{queued.size > 1 ? 's' : ''}…</span>}
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
          {!loading && shown.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {lots.length === 0 ? 'Aucun lot pour l\'instant : les lots se repèrent dans les annonces qu\'ADA lit (études, découvertes). Lancez une découverte ci-dessous.' : 'Aucun lot ne correspond à ces filtres.'}
            </p>
          )}
          {shown.map((l) => {
            const k = keyOf(l);
            const isOpen = open === k;
            const days = Math.max(0, Math.round((Date.now() - Date.parse(l.first_seen_at)) / 86_400_000));
            const members = l.members.length ? l.members : [{ id: l.dealer.id, site: l.dealer.site ?? 'autoscout24', site_url: l.dealer.site_url }];
            const pr = l.prospect ?? null;
            const det = pr ? details.get(pr.id) ?? null : null;
            const cardOpen = card === k;
            return (
              <div key={k} className="px-4 py-3">
                <div className="flex items-start gap-x-3 gap-y-1.5 flex-wrap">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-teal-900">{l.count} × {nice(l.brand)} {l.model} {l.year}</span>
                      {(l.fuels ?? []).slice(0, 2).map((f) => <span key={f} className="text-[10px] rounded-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-slate-600">{f}</span>)}
                    </div>
                    <p className="text-sm text-slate-800 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{l.dealer.name}</span> <span className="text-xs text-slate-500">{FLAG[l.dealer.country ?? ''] ?? ''} {[l.dealer.zip, l.dealer.city].filter(Boolean).join(' ')}</span>
                      {pr && <span className={`rounded border px-1.5 text-[11px] font-semibold tabular-nums ${scoreTone(pr.score)}`} title="Score de Dana">{pr.score ?? '—'}</span>}
                      {pr && <span className="text-[11px] text-slate-500">{STAGE_LABEL[pr.stage] ?? pr.stage}</span>}
                      {pr?.key_account && <span className="inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 bg-violet-600 text-white"><Crown className="w-3 h-3" /> grand compte</span>}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">{eur(l.price_min)} à {eur(l.price_max)} (médiane {eur(l.price_median)}) · {km(l.km_min)} à {km(l.km_max)} · vu par ADA depuis {days} jour{days > 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {l.markets.length === 0 && <span className="text-[11px] text-slate-400">pas encore assez d'annonces comparables dans nos pays de vente</span>}
                      {l.markets.map((m) => (
                        <span key={m.market} title={`${m.n} annonces comparables`} className={`text-[11px] rounded-full px-2 py-0.5 border ${m.gap > 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                          {FLAG[m.market] ?? ''} {eur(m.median)} ({m.n}) · {m.gap > 0 ? '+' : ''}{eur(m.gap)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {l.dealer.phone && <a href={`tel:${l.dealer.phone}`} className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-ocean"><Phone className="w-3.5 h-3.5" /> {l.dealer.phone}</a>}
                    {members.map((m) => m.site_url
                      ? <a key={m.id} href={m.site_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> {SITE_LABEL[m.site] ?? m.site}</a>
                      : <span key={m.id} className="text-[11px] rounded-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-slate-500">{SITE_LABEL[m.site] ?? m.site}</span>)}
                    {l.dealer.website && <a href={l.dealer.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-ocean hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Site web</a>}
                    {pr ? (
                      <button onClick={() => setCard(cardOpen ? null : k)} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${cardOpen ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
                        <Sparkles className="w-3.5 h-3.5" /> Fiche de Dana
                      </button>
                    ) : queued.has(l.dealer.id) ? (
                      <span className="text-teal-800 animate-pulse">qualification…</span>
                    ) : (
                      <button onClick={() => void qualify([l.dealer.id])} className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-white px-2 py-1 text-teal-800 hover:bg-teal-50" title="Haiku 5.5 : qui vend chez eux, e-mail publié, grand compte ou non">
                        <Sparkles className="w-3.5 h-3.5" /> Qualifier
                      </button>
                    )}
                    {canEditMap && !added.has(l.dealer.id) && !pr && (
                      <button onClick={() => void toMap(l)} className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-teal-800 hover:bg-teal-100" title="Sur la carte du réseau, comme vendeur"><MapPin className="w-3.5 h-3.5" /><Plus className="w-3 h-3" /> Carte</button>
                    )}
                    <button onClick={() => setOpen(isOpen ? null : k)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} /> Annonces
                    </button>
                  </div>
                </div>
                {cardOpen && pr && (det
                  ? <QualifCard p={det} agentName="Dana" onStage={(st) => void changeStage(det, st)} onRequalify={() => void qualify([l.dealer.id])} requalifying={queued.has(l.dealer.id)}
                      threadId={threads.get(det.id) ?? null} onDraft={() => void draft(det)} drafting={drafting.has(det.id)} onOpenThread={onOpenThread} />
                  : <p className="mt-2 text-xs text-slate-400">Fiche en lecture…</p>)}
                {isOpen && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {l.urls.map((u, i) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline break-all">Annonce {i + 1}</a></li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Découvrir (Dana : tous pays) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap"><Radar className="w-4 h-4 text-teal-700" /><h3 className="text-sm font-semibold text-slate-900">Découvrir des fournisseurs</h3><span className="text-xs text-slate-500">— Dana lit les annonces d'un site, dans n'importe quel pays, et repère les lots des garages. Sans IA.</span></div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
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
        </div>
        {discoveries.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {discoveries.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-xs flex-wrap">
                <span className={`rounded-full px-2 py-0.5 ${TASK_STATUS[t.status].cls}`}>{TASK_STATUS[t.status].label}</span>
                <span className="font-medium text-slate-800">{FLAG[t.params.country ?? ''] ?? ''} {siteLabel(t.params.site)} · {t.params.brand}{t.params.model ? ` ${t.params.model}` : ''}</span>
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
