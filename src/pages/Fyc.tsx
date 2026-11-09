/**
 * FYC — FIND YOUR CUSTOMER (10/11, Channing : « une inspection comparée en quelques clics à tout un marché et à un
 * client cible »). Vit dans la page Market Intelligence, derrière le switch « MI | FYC » ; reste montée quand on
 * bascule (rien ne disparaît).
 *
 * 1. Inspections : liens de rapports (VTI / Macadam…), lus par le worker (PDF) puis ici (champs).
 * 2. Nos prix : prix d'achat et prix d'attaque, saisis et gardés avec l'inspection. Pas de marge calculée (décision
 *    Channing 10/11 : « cela nous appartient »).
 * 3. Marché cible : TOUS les filtres MI, pré-remplis depuis le rapport et modifiables ; chiffres des annonces déjà
 *    en base ; « Voir dans le MI » bascule côté MI avec la recherche lancée.
 * 4. Client cible : un contact de la Carte dont la vitrine est lue ; son stock comparable face à notre prix.
 * Export PDF à la charte (src/lib/fycPdf.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, ExternalLink, FileDown, FileUp, Loader2, RefreshCw, Trash2, Search, AlertTriangle, Check, Archive, ArchiveRestore } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listInspections, addInspections, addInspectionFile, updateInspection, deleteInspection, retryInspection, readInspection, filtersFromInspection, type FycInspection } from '../services/fyc';
import { damageSummary } from '../lib/fycReport';
import { loadObservationsForStudy, latestPerListing, priceStats, attackPrice as miAttackPrice, canonKey, FUEL_TOKEN_TO_CRITERIA, GEARBOX_LABELS, type MarketFilters, type Observation, type GearboxToken } from '../services/marketData';
import { BODY_TYPES } from '../lib/study-core/bodyTypes';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { loadNetwork, type NetworkContact } from '../services/network';
import { listLatestStockRuns, listStockVehicles, type LatestStockRun, type StockVehicle } from '../services/dealerStock';
import { COUNTRY_NAMES } from '../data/cities';
import { buildFycPdf, langOfCountry } from '../lib/fycPdf';

const FUEL_LABEL: Record<string, string> = { electric: 'Électrique', petrol: 'Essence', diesel: 'Diesel', hybrid: 'Hybride', mild_hybrid: 'Micro-hybride', phev: 'Hybride rechargeable', lpg: 'GPL', cng: 'GNV' };
const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR'));
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const LAST_COUNTRY_KEY = 'ada_fyc_country';
const inp = 'px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white w-full';

function fuelMatches(obsFuel: string, want: string): boolean {
  if (!want) return true;
  const o = (obsFuel ?? '').toLowerCase();
  if (want === 'hybrid') return o.startsWith('hybrid') || o === 'mild_hybrid' || o === 'phev';
  return o === want;
}

export function FycView({ onOpenMarket }: { onOpenMarket: (f: MarketFilters) => void }) {
  const { displayName, email } = useAuth();
  const [rows, setRows] = useState<FycInspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => { try { return sessionStorage.getItem('ada_fyc_selected'); } catch { return null; } });
  const reading = useRef(new Set<string>());

  const reload = async () => {
    const r = await listInspections();
    setRows(r.rows); setError(r.error); setLoading(false);
    // Rapports téléchargés par le worker : lus ici (champs), un à la fois.
    for (const row of r.rows) {
      if (row.status === 'fetched' && !reading.current.has(row.id)) {
        reading.current.add(row.id);
        void readInspection(row).finally(() => { reading.current.delete(row.id); void reload(); });
        break;
      }
    }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = rows.some((r) => r.status === 'queued' || r.status === 'fetched');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { if (selectedId) sessionStorage.setItem('ada_fyc_selected', selectedId); } catch { /* rien */ } }, [selectedId]);

  const add = async () => {
    setAdding(true); setNotice(null);
    const r = await addInspections(addText);
    setAdding(false);
    if (r.error) { setNotice(r.error); return; }
    setAddText('');
    setNotice(`${r.added} lien${r.added > 1 ? 's' : ''} déposé${r.added > 1 ? 's' : ''}${r.existing ? ` · ${r.existing} déjà présent${r.existing > 1 ? 's' : ''}` : ''} — Ada télécharge le rapport puis le lit (moins d'une minute).`);
    await reload();
  };
  // ARCHIVES (10/11 soir, Channing : « retrouver l'historique de l'ensemble des inspections analysées, un petit onglet
  // archive ; un clic sur une ligne rouvre tout le FYC du dossier »).
  const [tab, setTab] = useState<'current' | 'archives'>('current');
  const shown = rows.filter((r) => (tab === 'archives') === !!r.archived_at);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAdding(true); setNotice(null);
    let ok = 0; let last: string | null = null;
    for (const f of Array.from(files)) { const r = await addInspectionFile(f); if (r.error) last = r.error; else { ok++; last = null; } }
    setAdding(false);
    setNotice(last ? last : `${ok} fichier${ok > 1 ? 's' : ''} déposé${ok > 1 ? 's' : ''} — lecture en cours.`);
    await reload();
  };
  const selected = rows.find((r) => r.id === selectedId) ?? shown[0] ?? null;
  const archive = async (r: FycInspection, on: boolean) => { await updateInspection(r.id, { archived_at: on ? new Date().toISOString() : null }); await reload(); };

  return (
    <div className="space-y-5">
      {/* Inspections */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <button onClick={() => setTab('current')} className={`px-2.5 py-1 rounded-md ${tab === 'current' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Inspections en cours · {rows.filter((r) => !r.archived_at).length}</button>
            <button onClick={() => setTab('archives')} className={`px-2.5 py-1 rounded-md flex items-center gap-1 ${tab === 'archives' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Archive className="w-3.5 h-3.5" /> Archives · {rows.filter((r) => !!r.archived_at).length}</button>
          </div>
          <span className="text-xs text-slate-500">{tab === 'current' ? 'Colle un lien de rapport (VTI / Macadam), un par ligne, ou dépose le fichier du rapport (PDF, export .docx de VWFS). Ada en sort la voiture.' : 'Les dossiers archivés : un clic sur une ligne rouvre tout le FYC (prix, marché, client).'}</span>
          <button onClick={() => void reload()} className="ml-auto text-xs text-brand-ocean hover:underline flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button>
        </div>
        {tab === 'current' && <div className="flex gap-2 items-start flex-wrap">
          <textarea value={addText} onChange={(e) => setAddText(e.target.value)} rows={2} placeholder="https://admin.vti-easi.eu/reportviewer/…" className={`${inp} flex-1 min-w-[320px] font-mono text-xs`} />
          <button onClick={() => void add()} disabled={adding || !addText.trim()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">{adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} Lire les rapports</button>
          <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileInput.current?.click()} disabled={adding} title="Un rapport exporté en fichier : PDF, ou .docx (export GIS@WEB de VWFS)" className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileUp className="w-4 h-4" /> Déposer un fichier (PDF, DOCX)</button>
        </div>}
        {notice && <p className="text-xs text-slate-600">{notice}</p>}
        {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
        {loading ? <p className="text-sm text-slate-400 py-4 text-center">Chargement…</p> : shown.length === 0 ? (
          <p className="text-sm text-slate-500">{tab === 'current' ? 'Aucune inspection en cours.' : 'Aucun dossier archivé.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400"><th className="py-2 pr-3">Véhicule (du rapport)</th><th className="py-2 pr-3">1re immat.</th><th className="py-2 pr-3 text-right">Km</th><th className="py-2 pr-3">Énergie · boîte</th><th className="py-2 pr-3">État</th><th className="py-2 pr-3 text-right">Achat</th><th className="py-2 pr-3 text-right">Attaque</th><th className="py-2 pr-3">Par</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const car = [r.brand, r.model].filter(Boolean).join(' ');
                  const sel = selected?.id === r.id;
                  return (
                    <tr key={r.id} onClick={() => setSelectedId(r.id)} className={`cursor-pointer ${sel ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-900">{car || (r.status === 'failed' ? 'Rapport non lu' : 'Lecture en cours…')}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[360px]">{r.vin ? `VIN ${r.vin} · ` : ''}{r.report_number ? `rapport n° ${r.report_number} du ${fmtDate(r.report_date)}` : r.source_url}</div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.first_registration)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.km)}</td>
                      <td className="py-2 pr-3">{[r.fuel, r.gearbox].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="py-2 pr-3">
                        {r.status === 'queued' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">téléchargement…</span>}
                        {r.status === 'fetched' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">lecture…</span>}
                        {r.status === 'failed' && <span title={r.error ?? ''} className="text-[11px] rounded-full px-2 py-0.5 bg-red-50 text-red-700 border border-red-200">échec</span>}
                        {r.status === 'read' && damageSummary(r.damages).map((s) => <span key={s} className={`mr-1 text-[11px] rounded-full px-2 py-0.5 border ${/rien/.test(s) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : /usage/.test(s) ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-orange-50 text-orange-800 border-orange-200'}`}>{s}</span>)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtEur(r.purchase_price)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-slate-900">{fmtEur(r.attack_price)}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">{r.created_by_name || '—'}<br />{fmtDate(r.created_at)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {/^https?:/.test(r.source_url) && <a href={r.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir le rapport" className="inline-flex p-1 text-slate-400 hover:text-brand-ocean"><ExternalLink className="w-4 h-4" /></a>}
                        {r.status === 'failed' && <button onClick={async (e) => { e.stopPropagation(); await retryInspection(r.id); await reload(); }} title="Réessayer" className="inline-flex p-1 text-slate-400 hover:text-brand-ocean"><RefreshCw className="w-4 h-4" /></button>}
                        <button onClick={(e) => { e.stopPropagation(); void archive(r, !r.archived_at); }} title={r.archived_at ? 'Remettre en cours' : 'Archiver'} className="inline-flex p-1 text-slate-400 hover:text-brand-ocean">{r.archived_at ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}</button>
                        <button onClick={async (e) => { e.stopPropagation(); if (!confirm('Supprimer cette inspection de FYC ?')) return; await deleteInspection(r.id); if (selectedId === r.id) setSelectedId(null); await reload(); }} title="Supprimer" className="inline-flex p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && selected.status === 'read' && <InspectionPanel key={selected.id} insp={selected} onChanged={reload} onOpenMarket={onOpenMarket} author={displayName || email || ''} authorEmail={email ?? null} />}
      {selected && selected.status === 'failed' && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 inline mr-1" /> Rapport non lu : {selected.error ?? 'sans détail'}. Vérifie le lien (il doit ouvrir le rapport sans mot de passe), puis « Réessayer ».</p>}
    </div>
  );
}

function InspectionPanel({ insp, onChanged, onOpenMarket, author, authorEmail }: { insp: FycInspection; onChanged: () => Promise<void>; onOpenMarket: (f: MarketFilters) => void; author: string; authorEmail: string | null }) {
  const [purchase, setPurchase] = useState(insp.purchase_price != null ? String(insp.purchase_price) : '');
  const [attack, setAttack] = useState(insp.attack_price != null ? String(insp.attack_price) : '');
  const [notes, setNotes] = useState(insp.notes);
  const typedAttack = Number(attack.replace(/[^\d.]/g, '')) || null;
  const saveNum = async (field: 'purchase_price' | 'attack_price', v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); await updateInspection(insp.id, { [field]: v.trim() === '' || !Number.isFinite(n) ? null : n }); await onChanged(); };

  // ── Filtres MI : tous modifiables, gardés sur l'inspection.
  const countries = useMemo(() => [...new Set(allSiteAdapters().map((a) => (a as { countryCode?: string }).countryCode).filter((c): c is string => !!c))].sort(), []);
  const lastCountry = (() => { try { return sessionStorage.getItem(LAST_COUNTRY_KEY) ?? ''; } catch { return ''; } })();
  const [filters, setFilters] = useState<MarketFilters>(() => (Object.keys(insp.market_filters ?? {}).length ? insp.market_filters : filtersFromInspection(insp, lastCountry || countries[0])));
  const filtersKey = JSON.stringify(filters);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => { void updateInspection(insp.id, { market_filters: filters }); try { if (filters.country) sessionStorage.setItem(LAST_COUNTRY_KEY, filters.country); } catch { /* rien */ } }, 600);
    return () => clearTimeout(t);
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const setF = (p: Partial<MarketFilters>) => setFilters((f) => ({ ...f, ...p }));
  const sitesOfCountry = useMemo(() => allSiteAdapters().filter((a) => (a as { countryCode?: string }).countryCode === filters.country).map((a) => (a as { key: string }).key), [filters.country]);

  // ── Marché : annonces déjà en base pour ces filtres (le scrape se lance côté MI).
  const [obs, setObs] = useState<Observation[] | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  useEffect(() => {
    if (!filters.brand || !filters.country) { setObs(null); return; }
    const t = setTimeout(() => {
      setObsLoading(true);
      loadObservationsForStudy({ ...filters, trim: undefined, yearMin: null, yearMax: null, mileageMax: null, powerMin: null, gearbox: undefined, vehicleType: undefined, fuel: undefined })
        .then((o) => setObs(o)).catch(() => setObs([])).finally(() => setObsLoading(false));
    }, 800);
    return () => clearTimeout(t);
  }, [filters.brand, filters.model, filters.country, filters.site]); // eslint-disable-line react-hooks/exhaustive-deps
  const market = useMemo(() => {
    if (!obs) return null;
    const latest = latestPerListing(obs).filter((o) =>
      (!filters.country || o.country?.toUpperCase() === filters.country) && (!filters.site || o.site === filters.site)
      && (!filters.model || canonKey(o.model ?? '').includes(canonKey(filters.model)) || canonKey(filters.model).includes(canonKey(o.model ?? '')))
      && fuelMatches(o.fuel, filters.fuel ?? '')
      && (!filters.trim || canonKey(`${o.trim ?? ''} ${o.title ?? ''}`).includes(canonKey(filters.trim)))
      && (!filters.gearbox || (o.gearbox ?? '').toLowerCase().startsWith(filters.gearbox.slice(0, 4).toLowerCase()))
      && (!filters.vehicleType || (o.vehicle_type ?? '') === filters.vehicleType)
      && (filters.yearMin == null || (o.year != null && o.year >= filters.yearMin)) && (filters.yearMax == null || (o.year != null && o.year <= filters.yearMax))
      && (filters.mileageMax == null || (o.mileage != null && o.mileage <= filters.mileageMax)) && (filters.powerMin == null || (o.power_din != null && o.power_din >= filters.powerMin)));
    const stats = priceStats(latest);
    const comp = latest.filter((o) => insp.year != null && o.year != null && Math.abs(o.year - insp.year) <= 1 && insp.km != null && o.mileage != null && Math.abs(o.mileage - insp.km) <= insp.km * 0.3);
    const compStats = priceStats(comp);
    // La comparaison se fait sur les COMPARABLES (Channing 10/11 soir : « c'est là qu'on fait les comparaisons ») ;
    // sans comparable, sur toutes les annonces filtrées.
    const base = comp.length ? comp : latest;
    const baseStats = comp.length ? compStats : stats;
    // PRIX D'ATTAQUE DU MI (10/11 soir, Channing : « que le prix d'attaque s'affiche en fonction du MI ») : la règle
    // du Market Intelligence (médiane de la tranche basse des annonces) appliquée aux comparables.
    const mi = miAttackPrice(base);
    const effective = typedAttack ?? mi?.price ?? null;
    const priced = base.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    const below = effective != null ? priced.filter((p) => p < effective).length : 0;
    const pct = effective != null && priced.length ? Math.round((below / priced.length) * 100) : null;
    const lastScan = latest.reduce<string | null>((m, o) => (!m || o.scraped_at > m ? o.scraped_at : m), null);
    const position = effective == null ? 'pas d\'annonce avec prix' : pct == null ? 'pas d\'annonce avec prix' : pct === 0 ? `sous ${comp.length ? 'tous les comparables' : 'toutes les annonces'}` : `${pct} % ${comp.length ? 'des comparables' : 'des annonces'} sont moins chers`;
    return { latest, stats, comp, compStats, baseStats, usingComparables: comp.length > 0, mi, effective, pct, lastScan, position, cheapest: [...base].filter((o) => o.price).sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 5) };
  }, [obs, filtersKey, typedAttack, insp.year, insp.km]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Le prix d'attaque EFFECTIF : saisi, sinon celui que le MI calcule sur les comparables. */
  const attackPrice = typedAttack ?? market?.mi?.price ?? null;
  const attackFromMi = typedAttack == null && market?.mi != null;
  const takeMiPrice = async () => { if (!market?.mi) return; setAttack(String(market.mi.price)); await updateInspection(insp.id, { attack_price: market.mi.price }); await onChanged(); };

  // ── Client cible : vitrines lues seulement.
  const [contacts, setContacts] = useState<NetworkContact[]>([]);
  const [runs, setRuns] = useState<Map<string, LatestStockRun>>(new Map());
  useEffect(() => { void Promise.all([loadNetwork(), listLatestStockRuns()]).then(([n, r]) => { setContacts(n.contacts); setRuns(r); }); }, []);
  const eligible = useMemo(() => {
    const b = canonKey(insp.brand ?? ''); const m = canonKey(insp.model ?? '');
    return contacts
      .filter((c) => c.website && !c.showcase_unreadable && runs.get(c.id)?.total != null && !runs.get(c.id)?.failed)
      .map((c) => ({ c, score: c.models.reduce((s, x) => s + (canonKey(x.brand) === b ? (m && canonKey(x.model ?? '').includes(m) ? 3 : 1) : 0), 0) }))
      .sort((a, b2) => b2.score - a.score || a.c.name.localeCompare(b2.c.name));
  }, [contacts, runs, insp.brand, insp.model]);
  const [clientId, setClientId] = useState<string | null>(insp.client_contact_id);
  const [clientSearch, setClientSearch] = useState('');
  const client = contacts.find((c) => c.id === clientId) ?? null;
  const [stock, setStock] = useState<StockVehicle[] | null>(null);
  useEffect(() => {
    if (!clientId) { setStock(null); return; }
    void listStockVehicles(clientId).then((r) => setStock(r.vehicles));
  }, [clientId]);
  const clientRows = useMemo(() => {
    if (!stock) return [];
    const b = canonKey(insp.brand ?? ''); const m = canonKey(insp.model ?? '');
    return stock.filter((v) => !v.gone_at && canonKey(v.brand ?? '') === b && (!m || canonKey(v.model ?? '').includes(m) || m.includes(canonKey(v.model ?? '')))).sort((a, c) => (a.price ?? 1e12) - (c.price ?? 1e12));
  }, [stock, insp.brand, insp.model]);
  const clientPrices = clientRows.map((v) => v.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const clientMin = clientPrices.length ? clientPrices[0] : null;
  const clientMedian = clientPrices.length ? clientPrices[Math.floor(clientPrices.length / 2)] : null;
  const chooseClient = async (id: string | null) => { setClientId(id); await updateInspection(insp.id, { client_contact_id: id }); };

  const [exporting, setExporting] = useState(false);
  const pdfLang = langOfCountry(filters.country);
  const exportPdf = async () => {
    setExporting(true);
    try {
      const blob = await buildFycPdf(insp, pdfLang, { name: author, email: authorEmail });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `MC-Export-${[insp.brand, insp.model].filter(Boolean).join('-') || 'vehicule'}-${pdfLang.toUpperCase()}-${new Date().toISOString().slice(0, 10)}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  };

  const car = [insp.brand, insp.model].filter(Boolean).join(' ');
  return (
    <div className="space-y-5">
      {/* Voiture + nos prix */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-slate-900">{car} — nos prix</h2>
          {insp.archived_at && <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">archivée le {fmtDate(insp.archived_at)}</span>}
          <span className="text-xs text-slate-500">{insp.year ?? '—'} · {fmtNum(insp.km)} km · {insp.fuel ?? '—'} · {insp.gearbox ?? '—'}{insp.power_ch ? ` · ${insp.power_ch} ch` : ''}{insp.color ? ` · ${insp.color}` : ''}</span>
          <button onClick={() => void exportPdf()} disabled={exporting} title={`Fiche véhicule à la charte MC Export, dans la langue du pays cible (${pdfLang.toUpperCase()}) : données, équipements, pneus, état, notre prix d'attaque, nos coordonnées — jamais le prix d'achat ni les notes`} className="ml-auto flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Fiche PDF client ({pdfLang.toUpperCase()})</button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <label className="block text-xs text-slate-600">Prix d'achat (€)<input value={purchase} onChange={(e) => setPurchase(e.target.value)} onBlur={() => void saveNum('purchase_price', purchase)} placeholder="ex. 17 500" className={`${inp} mt-1 text-right`} /></label>
          <label className="block text-xs text-slate-600">Prix d'attaque (€) <span className="text-slate-400">— notre prix face au marché</span>
            <div className="mt-1 flex items-center gap-1.5">
              <input value={attack} onChange={(e) => setAttack(e.target.value)} onBlur={() => void saveNum('attack_price', attack)} placeholder={market?.mi ? `MI : ${fmtNum(market.mi.price)}` : 'ex. 23 900'} className={`${inp} text-right font-semibold`} />
              {market?.mi && <button type="button" onClick={() => void takeMiPrice()} title={`Reprendre le prix d'attaque calculé par le MI (${fmtEur(market.mi.price)}, sur les ${market.mi.window} annonces les moins chères)`} className="shrink-0 text-xs px-2 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap">← MI {fmtEur(market.mi.price)}</button>}
            </div>
          </label>
          <label className="block text-xs text-slate-600 lg:col-span-2">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={async () => { await updateInspection(insp.id, { notes }); }} placeholder="remise en état, transport, remarque…" className={`${inp} mt-1`} /></label>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-700">
          <p><span className="text-slate-500">Rapport : </span>{insp.report_number ? `n° ${insp.report_number} du ${fmtDate(insp.report_date)}` : insp.source_url.replace(/^fichier:/, '')}{/^https?:/.test(insp.source_url) && <> · <a href={insp.source_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">ouvrir</a></>}{insp.asking_price != null && <> · <span className="text-slate-500">prix demandé par la plateforme : </span>{fmtEur(insp.asking_price)}</>}{insp.repair_cost != null && <> · <span className="text-slate-500">remise en état chiffrée : </span>{fmtEur(insp.repair_cost)}</>}</p>
          <p><span className="text-slate-500">VIN : </span>{insp.vin ?? '—'} · <span className="text-slate-500">1re immat. : </span>{fmtDate(insp.first_registration)}</p>
          <p><span className="text-slate-500">Dévaluation : </span>{insp.damages.devaluation.length ? insp.damages.devaluation.map((d) => d.raw).join(' ; ') : 'rien'}</p>
          <p><span className="text-slate-500">Usage : </span>{insp.damages.usage.length ? insp.damages.usage.map((d) => d.raw).join(' ; ') : 'rien'}{insp.repainted ? ' · repeinte' : ''}</p>
          {insp.tyres.length > 0 && <p><span className="text-slate-500">Pneus : </span>{insp.tyres.join(' ; ')}</p>}
          {insp.equipment.length > 0 && <p><span className="text-slate-500">Équipements : </span>{insp.equipment.length} dans le rapport (repris dans la fiche PDF)</p>}
        </div>
      </div>

      {/* 3. Marché cible */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-slate-900">Marché cible</h2>
          <span className="text-xs text-slate-500">Filtres MI pré-remplis depuis le rapport, tous modifiables. Les chiffres viennent des annonces déjà en base ; « Voir dans le MI » lance la recherche.</span>
          <button onClick={() => onOpenMarket(filters)} disabled={!filters.country || !filters.brand} className="ml-auto flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50"><Search className="w-4 h-4" /> Voir dans le MI (lance la recherche)</button>
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs text-slate-600">
          <label>Pays<select value={filters.country ?? ''} onChange={(e) => setF({ country: e.target.value || undefined, site: undefined })} className={`${inp} mt-1`}><option value="">—</option>{countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}</select></label>
          <label>Site<select value={filters.site ?? ''} onChange={(e) => setF({ site: e.target.value || undefined })} className={`${inp} mt-1`}><option value="">tous ({sitesOfCountry.length})</option>{sitesOfCountry.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Marque<input value={filters.brand ?? ''} onChange={(e) => setF({ brand: e.target.value.toUpperCase() || undefined })} className={`${inp} mt-1`} /></label>
          <label>Modèle<input value={filters.model ?? ''} onChange={(e) => setF({ model: e.target.value.toUpperCase() || undefined })} className={`${inp} mt-1`} /></label>
          <label>Finition<input value={filters.trim ?? ''} onChange={(e) => setF({ trim: e.target.value || undefined })} placeholder="toutes" className={`${inp} mt-1`} /></label>
          <label>Carburant<select value={filters.fuel ?? ''} onChange={(e) => setF({ fuel: (e.target.value || undefined) as MarketFilters['fuel'] })} className={`${inp} mt-1`}><option value="">tous</option>{Object.keys(FUEL_TOKEN_TO_CRITERIA).map((k) => <option key={k} value={k}>{FUEL_LABEL[k] ?? k}</option>)}</select></label>
          <label>Boîte<select value={filters.gearbox ?? ''} onChange={(e) => setF({ gearbox: e.target.value || undefined })} className={`${inp} mt-1`}><option value="">toutes</option>{(Object.keys(GEARBOX_LABELS) as GearboxToken[]).map((k) => <option key={k} value={k}>{GEARBOX_LABELS[k]}</option>)}</select></label>
          <label>Carrosserie<select value={filters.vehicleType ?? ''} onChange={(e) => setF({ vehicleType: e.target.value || undefined })} className={`${inp} mt-1`}><option value="">toutes</option>{BODY_TYPES.map((b) => <option key={b.token} value={b.token}>{b.label}</option>)}</select></label>
          <label>Année min<input type="number" value={filters.yearMin ?? ''} onChange={(e) => setF({ yearMin: e.target.value ? Number(e.target.value) : null })} className={`${inp} mt-1`} /></label>
          <label>Année max<input type="number" value={filters.yearMax ?? ''} onChange={(e) => setF({ yearMax: e.target.value ? Number(e.target.value) : null })} className={`${inp} mt-1`} /></label>
          <label>Km max<input type="number" value={filters.mileageMax ?? ''} onChange={(e) => setF({ mileageMax: e.target.value ? Number(e.target.value) : null })} className={`${inp} mt-1`} /></label>
          <label>Puissance min (ch)<input type="number" value={filters.powerMin ?? ''} onChange={(e) => setF({ powerMin: e.target.value ? Number(e.target.value) : null })} className={`${inp} mt-1`} /></label>
        </div>
        {obsLoading ? <p className="text-sm text-slate-400 py-2">Lecture des annonces en base…</p> : market && market.stats.count > 0 ? (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Tile label={`Comparables · ${COUNTRY_NAMES[filters.country ?? ''] ?? filters.country} (année ±1, km ±30 %)`} value={String(market.comp.length)} hint={market.compStats.count ? `de ${fmtEur(market.compStats.min)} à ${fmtEur(market.compStats.max)} · P25–P75 ${fmtEur(market.compStats.p25)} – ${fmtEur(market.compStats.p75)}${market.lastScan ? ` · scan ${fmtDate(market.lastScan)}` : ''}` : `aucun comparable, ${market.stats.count} annonces filtrées${market.lastScan ? ` · scan ${fmtDate(market.lastScan)}` : ''}`} />
              <Tile label={attackFromMi ? 'Prix d\'attaque proposé par le MI' : 'Notre prix d\'attaque'} value={fmtEur(attackPrice)} hint={`${market.position}${attackFromMi && market.mi ? ` · règle MI sur les ${market.mi.window} moins chères — saisis le tien pour le remplacer` : !attackFromMi && market.mi ? ` · le MI proposerait ${fmtEur(market.mi.price)}` : ''}`} strong />
            </div>
            {attackPrice != null && market.baseStats.count > 0 && (
              <div className="relative h-12 rounded-lg bg-slate-50 border border-slate-200" title={market.usingComparables ? 'Les comparables, du moins cher au plus cher' : 'Toutes les annonces filtrées'}>
                {(() => { const lo = market.baseStats.min, hi = market.baseStats.max, span = Math.max(1, hi - lo); const x = (v: number) => `${Math.min(98, Math.max(1, ((v - lo) / span) * 100))}%`; return (<>
                  <div className="absolute top-5 h-3 rounded bg-blue-100" style={{ left: x(market.baseStats.p25), width: `calc(${x(market.baseStats.p75)} - ${x(market.baseStats.p25)})` }} />
                  <div className="absolute top-2 w-1 h-9 bg-emerald-600 rounded" style={{ left: x(attackPrice) }} title={`notre prix ${fmtEur(attackPrice)}`} />
                  <span className="absolute left-1 bottom-0.5 text-[10px] text-slate-500">{fmtEur(lo)}</span>
                  <span className="absolute right-1 bottom-0.5 text-[10px] text-slate-500">{fmtEur(hi)}</span>
                </>); })()}
              </div>
            )}
            <p className="text-xs text-slate-500">Les 5 moins chères : {market.cheapest.map((o, i) => <span key={i}>{i ? ' · ' : ''}{o.listing_url ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">{fmtEur(o.price)}</a> : fmtEur(o.price)} ({o.year ?? '—'}, {fmtNum(o.mileage)} km)</span>)}</p>
          </>
        ) : market ? <p className="text-sm text-slate-500">Aucune annonce en base pour ces filtres : clique « Voir dans le MI (lance la recherche) », puis reviens ici.</p> : <p className="text-sm text-slate-500">Choisis un pays et une marque.</p>}
      </div>

      {/* 4. Client cible */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-slate-900">Client cible</h2>
          <span className="text-xs text-slate-500">Un contact de la Carte dont la vitrine est lue (jamais en échec ni non lisible). Ceux qui vendent la marque sont en tête.</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Chercher un contact…" className={`${inp} w-64`} />
          <select value={clientId ?? ''} onChange={(e) => void chooseClient(e.target.value || null)} className={`${inp} flex-1 min-w-[280px]`}>
            <option value="">— aucun —</option>
            {eligible.filter(({ c }) => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())).map(({ c, score }) => <option key={c.id} value={c.id}>{c.name} — {COUNTRY_NAMES[c.country] ?? c.country} · {fmtNum(runs.get(c.id)?.total)} relevés le {fmtDate(runs.get(c.id)?.at)}{score ? ' · vend la marque' : ''}</option>)}
          </select>
          <span className="text-xs text-slate-500">{eligible.length} vitrines lisibles</span>
        </div>
        {client && (
          stock == null ? <p className="text-sm text-slate-400 py-2">Lecture du stock…</p> : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label={`${client.name} · stock relevé`} value={fmtNum(runs.get(client.id)?.total)} hint={`le ${fmtDate(runs.get(client.id)?.at)}`} />
                <Tile label={`${car} en stock`} value={String(clientRows.length)} hint={clientRows.length ? `de ${fmtEur(clientMin)} à ${fmtEur(clientPrices[clientPrices.length - 1])}` : 'aucun exemplaire'} />
                <Tile label="Leur prix le plus bas / médiane" value={fmtEur(clientMin)} hint={`médiane ${fmtEur(clientMedian)}`} />
                <Tile label={attackFromMi ? 'Prix d\'attaque proposé par le MI' : 'Notre prix d\'attaque'} value={fmtEur(attackPrice)} hint={attackPrice != null && clientMin != null ? (attackPrice < clientMin ? `${Math.round(((clientMin - attackPrice) / clientMin) * 100)} % sous leur prix le plus bas` : `${Math.round(((attackPrice - clientMin) / clientMin) * 100)} % au-dessus de leur prix le plus bas`) : attackPrice == null ? 'ni saisi, ni calculable (pas d\'annonce en base)' : 'pas de comparable chez lui'} strong />
              </div>
              {clientRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-400"><th className="py-1.5 pr-3">Chez le client</th><th className="py-1.5 pr-3">Année</th><th className="py-1.5 pr-3 text-right">Km</th><th className="py-1.5 pr-3">Énergie · boîte</th><th className="py-1.5 pr-3 text-right">Prix affiché</th><th className="py-1.5 pr-3 text-right">Écart vs notre attaque</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {clientRows.slice(0, 25).map((v) => (
                        <tr key={v.id}>
                          <td className="py-1.5 pr-3">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="text-slate-800 hover:text-brand-ocean hover:underline">{v.title ?? [v.brand, v.model].filter(Boolean).join(' ')}</a> : v.title}</td>
                          <td className="py-1.5 pr-3">{v.year ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtNum(v.km)}</td>
                          <td className="py-1.5 pr-3">{[v.fuel, v.gearbox].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtEur(v.price)}</td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums ${attackPrice != null && v.price != null ? (v.price > attackPrice ? 'text-emerald-700' : 'text-red-700') : 'text-slate-400'}`}>{attackPrice != null && v.price != null ? `${v.price > attackPrice ? '+' : ''}${fmtEur(v.price - attackPrice)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}
        {client && stock && clientRows.length > 0 && attackPrice != null && clientMin != null && (
          <p className="text-sm"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs font-medium ${attackPrice < clientMin ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-orange-50 text-orange-800 border-orange-200'}`}>{attackPrice < clientMin ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} {attackPrice < clientMin ? 'Notre prix passe sous tout son stock comparable' : 'Notre prix est au-dessus de son exemplaire le moins cher'}</span></p>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${strong ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${strong ? 'text-emerald-800' : 'text-slate-900'}`}>{value}</p>
      {hint ? <p className="text-[11px] text-slate-500 truncate" title={hint}>{hint}</p> : null}
    </div>
  );
}

export function filtersLabel(f: MarketFilters): string {
  return [f.brand, f.model, f.trim, f.fuel ? FUEL_LABEL[f.fuel] ?? f.fuel : null, f.gearbox ? GEARBOX_LABELS[f.gearbox as GearboxToken] ?? f.gearbox : null,
    f.yearMin != null || f.yearMax != null ? `${f.yearMin ?? '…'}–${f.yearMax ?? '…'}` : null, f.mileageMax != null ? `≤ ${fmtNum(f.mileageMax)} km` : null, f.powerMin != null ? `≥ ${f.powerMin} ch` : null]
    .filter(Boolean).join(' · ');
}
