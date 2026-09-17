import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, FileText, Trash2, Loader2, ChevronDown, ChevronRight, ExternalLink, Check, CloudOff, Search, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listRefBrandModels } from '../services/workflow';
import {
  parseSupplierWorkbook, readSupplierGrid, supplierHt, OFFER_FIELD_LABELS,
  type ParsedSupplierFile, type OfferVehicle, type OfferField, type ColumnMapping,
} from '../lib/offers/parseSupplierFile';
import { loadLearnedModelsByBrand, mergeKnownModels } from '../lib/offers/knownModels';
import { buildOfferWorkbook, downloadBlob, slugFile, fmtEur, fmtKm } from '../lib/offers/exportOfferXlsx';
import { buildOfferPdf } from '../lib/offers/exportOfferPdf';
import { listOffers, saveOffer, deleteOffer, applyPriceRule, OFFER_COUNTRIES, type SupplierOffer, type PriceRule } from '../services/offers';
import {
  lotsOf, lotTargets, startLotJob, awaitLotJob, mergeCountry, verdictOf, applyLotCriteria, COUNTRY_CAVEAT,
  type OfferMarket, type OfferLot, type LotTarget, type SiteResult, type LotCriteria,
} from '../lib/offers/marketCheck';

/**
 * OFFRES FOURNISSEUR (page test, 14/09 — droit « offres » sur autorisation
 * explicite). Espace de travail (retour Channing 14/09 soir : « revenir sur
 * un tableau ou un autre en un clic, bien organiser ») : la liste des offres
 * à gauche, l'offre ouverte à droite, ENREGISTREMENT AUTOMATIQUE à chaque
 * modification (plus de bouton à ne pas oublier). Import → nouvelle offre
 * ouverte et déjà enregistrée. Étage « OÙ VENDRE » (demande Channing 14/09
 * soir) : les véhicules retenus sont regroupés en lots, chaque lot a ses URLs
 * de recherche par pays coché (vérifiables avant de lancer), le relevé part
 * dans la file du worker et le verdict par pays (médiane TTC → HT équivalent
 * face à notre HT) s'enregistre avec l'offre.
 */

interface Draft {
  id?: string; title: string; supplier: string; source_filename: string; layout: string;
  mappings: ColumnMapping[]; vehicles: OfferVehicle[]; price_rule: PriceRule; countries: string[]; notes: string; status: SupplierOffer['status'];
  market?: OfferMarket;
  lot_criteria?: Record<string, LotCriteria>;
  source_grid?: unknown[][] | null;
}
const FUEL_OPTIONS = ['ESSENCE', 'DIESEL', 'HYBRIDE', 'HYBRIDE RECHARGEABLE', 'ELECTRIQUE', 'GPL'];
const VERDICT_CLASS: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200', warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200', idle: 'bg-slate-50 text-slate-500 border-slate-200',
};
const SITE_LABEL = (key: string) => key.replace(/^autoscout24_/, 'AS24 ').replace(/_/g, ' ');
const EMPTY: Draft = { title: '', supplier: '', source_filename: '', layout: 'flat', mappings: [], vehicles: [], price_rule: { mode: 'margin', margin: 500 }, countries: ['FR', 'NL', 'DK'], notes: '', status: 'draft' };
const todayFr = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const STATUS_LABEL: Record<SupplierOffer['status'], string> = { draft: 'brouillon', sent: 'envoyée', closed: 'clôturée' };

export function Offres() {
  const { userId } = useAuth();
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [known, setKnown] = useState<Record<string, string[]>>({});
  const [parsed, setParsed] = useState<ParsedSupplierFile | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; text?: string }>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);

  const reload = async () => { const r = await listOffers(); setOffers(r.rows); setListError(r.error); return r.rows; };
  // Modèles connus = référentiel des études + taxonomie moissonnée des sites
  // (le référentiel seul ignorait « ASTRA » : aucune étude Astra, 16/09).
  useEffect(() => {
    void reload();
    void Promise.all([
      listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)),
      loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>)),
    ]).then(([ref, learned]) => setKnown(mergeKnownModels(ref, learned)));
  }, []);

  // ENREGISTREMENT AUTOMATIQUE : toute modification du brouillon part en base
  // 1,2 s après la dernière frappe ; la première sauvegarde crée l'offre.
  const persist = async (d: Draft) => {
    setSaveState({ kind: 'saving' });
    const r = await saveOffer(d);
    if (r.error) { setSaveState({ kind: 'error', text: r.error }); return; }
    if (!d.id && r.id) setDraft((cur) => (cur && !cur.id ? { ...cur, id: r.id! } : cur));
    setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });
    void reload();
  };
  const update = (patch: Partial<Draft> | ((d: Draft) => Draft)) => {
    setDraft((d) => {
      if (!d) return d;
      const next = typeof patch === 'function' ? patch(d) : { ...d, ...patch };
      dirty.current = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { dirty.current = false; void persist(next); }, 1200);
      return next;
    });
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  /** (Re)lecture d'une grille : nouvelle offre, ou correspondance modifiée sur une offre existante
   *  (la grille est conservée dans l'offre ; sélection et prix saisis sont gardés véhicule par véhicule). */
  const buildDraftFromGrid = (src: { sheet: string; grid: unknown[][] }, name: string, ov: Record<string, OfferField>, base: Draft): Draft => {
    const p = parseSupplierWorkbook(src, known, ov);
    setParsed(p);
    const prev = new Map(base.vehicles.map((v) => [v.id, v]));
    const vehicles = applyPriceRule(p.vehicles, base.price_rule, (v) => supplierHt(v), true)
      .map((v) => { const o = prev.get(v.id); return o ? { ...v, selected: o.selected, sale_price: o.sale_price } : v; });
    const models = [...new Set(vehicles.map((v) => `${v.brand} ${v.model}`))];
    const firstBrand = vehicles[0]?.brand ?? '';
    return {
      ...base,
      title: base.title || (models.length === 1 ? `${models[0]} — SÉLECTION PROFESSIONNELLE` : `${firstBrand ? firstBrand + ' & AUTRES' : 'SÉLECTION'} — OFFRE MC EXPORT`),
      supplier: base.supplier || name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40),
      source_filename: name, layout: p.layout, mappings: p.mappings.map((m) => ({ ...m, field: ov[m.header] ?? m.field })), vehicles, source_grid: p.grid,
    };
  };

  /** Import = NOUVELLE offre, ouverte et enregistrée tout de suite. */
  const onFile = async (f: File) => {
    setBusy('lecture'); setMsg(null);
    try {
      const src = readSupplierGrid(await f.arrayBuffer());
      const d = buildDraftFromGrid(src, f.name, {}, { ...EMPTY });
      setDraft(d);
      await persist(d);
    } catch (e) { setMsg(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  };
  /** Changement de correspondance : toutes les correspondances actuelles sont rejouées, plus la nouvelle. */
  const remap = (header: string, field: OfferField) => {
    if (!draft?.source_grid) return;
    const ov: Record<string, OfferField> = { ...Object.fromEntries(draft.mappings.map((m) => [m.header, m.field])), [header]: field };
    update((d) => (d.source_grid ? buildDraftFromGrid({ sheet: d.source_filename, grid: d.source_grid }, d.source_filename, ov, d) : d));
  };
  const setVehicle = (id: string, patch: Partial<OfferVehicle>) => update((d) => ({ ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const applyRule = (rule: PriceRule) => update((d) => ({ ...d, price_rule: rule, vehicles: applyPriceRule(d.vehicles, rule, (v) => supplierHt(v), true) }));

  /** Bascule d'une offre à l'autre en un clic — l'offre quittée est déjà enregistrée (ou le sera dans la seconde). */
  const open = (o: SupplierOffer) => {
    if (saveTimer.current && draft && dirty.current) { window.clearTimeout(saveTimer.current); dirty.current = false; void persist(draft); }
    setDraft({ ...o }); setParsed(null); setMsg(null); setSaveState({ kind: 'idle' }); setTargetsOpen(null); setEditLot(null);
    setSurvey((s) => (s && s.done < s.total && s.current !== 'arrêté' ? s : null));
  };
  const remove = async (o: SupplierOffer) => {
    if (!confirm(`Supprimer l'offre « ${o.title || 'sans titre'} » ?`)) return;
    const err = await deleteOffer(o.id);
    if (err) { setMsg(err); return; }
    if (draft?.id === o.id) setDraft(null);
    await reload();
  };

  const selected = useMemo(() => (draft?.vehicles ?? []).filter((v) => v.selected), [draft]);
  const docOf = () => ({
    title: (draft?.title || 'OFFRE MC EXPORT').toUpperCase(),
    subtitle: `${selected.length} véhicule${selected.length > 1 ? 's' : ''} · prix HT · transport à la charge de l'acheteur · vendus en l'état`,
    date: todayFr(), vehicles: selected, showDamages: true, showSupplierPrice: false,
    footer: 'MC EXPORT — offre valable sous réserve de disponibilité. Dommages : chiffrages du fournisseur, conservés à l’identique.',
  });
  const exportXlsx = () => { if (!draft) return; downloadBlob(buildOfferWorkbook(docOf()), `MC_Export_${slugFile(draft.title)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); };
  const exportPdf = async () => { if (!draft) return; setBusy('pdf'); try { downloadBlob(await buildOfferPdf(docOf()), `MC_Export_${slugFile(draft.title)}.pdf`, 'application/pdf'); } catch (e) { setMsg(`PDF : ${e instanceof Error ? e.message : String(e)}`); } setBusy(null); };

  // ── OÙ VENDRE ────────────────────────────────────────────────────────────
  // Lots = véhicules retenus regroupés (marque, modèle, année, énergie, boîte).
  // Les URLs par pays/site sont générées à la demande (cache par lot + pays
  // cochés) et VISIBLES avant tout relevé. Le relevé enchaîne les lots un par
  // un (les sites d'un lot en parallèle) pour ne pas noyer la file du worker,
  // et écrit le résultat dans l'offre au fil de l'eau (autosave).
  const lots = useMemo(() => (draft ? lotsOf(draft.vehicles).map((l) => applyLotCriteria(l, draft.lot_criteria?.[l.key])) : []), [draft]);
  const [editLot, setEditLot] = useState<string | null>(null);
  /** Critères réglés à la main : le relevé du lot est effacé (il répondait à d'autres critères) et ses URLs se régénèrent. */
  const setLotCriteria = (lot: OfferLot, patch: LotCriteria | null) => {
    targetsRef.current = Object.fromEntries(Object.entries(targetsRef.current).filter(([k]) => !k.startsWith(`${lot.key}#`)));
    setTargets(targetsRef.current);
    update((d) => {
      const lot_criteria = { ...(d.lot_criteria ?? {}) };
      if (patch === null) delete lot_criteria[lot.key]; else lot_criteria[lot.key] = { ...(lot_criteria[lot.key] ?? {}), ...patch };
      const market = { ...(d.market ?? {}) }; delete market[lot.key];
      return { ...d, lot_criteria, market };
    });
  };
  const [targets, setTargets] = useState<Record<string, LotTarget[]>>({});
  const targetsRef = useRef<Record<string, LotTarget[]>>({});
  const [targetsOpen, setTargetsOpen] = useState<string | null>(null);
  const [survey, setSurvey] = useState<{ done: number; total: number; current: string; errors: string[] } | null>(null);
  const cancelSurvey = useRef(false);
  const surveyRunning = !!survey && survey.done < survey.total && survey.current !== 'arrêté';
  // Clé de cache = lot + critères (le libellé les porte tous) + pays cochés.
  const targetKey = (lot: OfferLot) => `${lot.key}#${lot.label}#${(draft?.countries ?? []).join(',')}`;
  const ensureTargets = async (lot: OfferLot): Promise<LotTarget[]> => {
    const k = targetKey(lot);
    if (targetsRef.current[k]) return targetsRef.current[k];
    const t = await lotTargets(lot, draft?.countries ?? []);
    targetsRef.current = { ...targetsRef.current, [k]: t };
    setTargets(targetsRef.current);
    return t;
  };
  const toggleTargets = async (lot: OfferLot) => {
    if (targetsOpen === lot.key) { setTargetsOpen(null); return; }
    setTargetsOpen(lot.key);
    await ensureTargets(lot);
  };
  const runSurvey = async (list: OfferLot[]) => {
    if (!draft?.id) { setMsg('Offre pas encore enregistrée — réessaie dans une seconde.'); return; }
    if (draft.countries.length === 0) { setMsg('Coche au moins un pays à relever.'); return; }
    const offerId = draft.id;
    const plan: Array<{ lot: OfferLot; t: LotTarget }> = [];
    const skipped: string[] = [];
    setSurvey({ done: 0, total: 0, current: 'préparation des URLs…', errors: [] });
    for (const lot of list) {
      const ts = await ensureTargets(lot);
      for (const t of ts) {
        if (t.url) plan.push({ lot, t });
        else skipped.push(`${lot.label} · ${t.country} ${SITE_LABEL(t.site)} : pas d'URL${t.warnings[0] ? ` (${t.warnings[0]})` : ''}`);
      }
    }
    if (plan.length === 0) { setSurvey(null); setMsg(`Aucune URL à relever. ${skipped[0] ?? ''}`.trim()); return; }
    if (plan.length > 30 && !confirm(`${plan.length} recherches vont partir dans la file du worker (compte ≈ ${Math.ceil(plan.length / 2)} min au minimum). Continuer ?`)) { setSurvey(null); return; }
    cancelSurvey.current = false;
    setSurvey({ done: 0, total: plan.length, current: '', errors: skipped });
    const byLot = new Map<string, Array<{ lot: OfferLot; t: LotTarget }>>();
    for (const p of plan) byLot.set(p.lot.key, [...(byLot.get(p.lot.key) ?? []), p]);
    let done = 0;
    for (const items of byLot.values()) {
      if (cancelSurvey.current) break;
      setSurvey((s) => s && { ...s, current: items[0].lot.label });
      await Promise.all(items.map(async ({ lot, t }) => {
        const url = t.url as string;
        let r: SiteResult;
        try { const jobId = await startLotJob(url, lot); r = await awaitLotJob(jobId, t.site, url, { model: lot.model, strict: t.brandPageOnly }); }
        catch (e) { r = { site: t.site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: e instanceof Error ? e.message : String(e) }; }
        done += 1;
        setSurvey((s) => s && { ...s, done, errors: r.error ? [...s.errors, `${lot.label} · ${t.country} ${SITE_LABEL(t.site)} : ${r.error}`] : s.errors });
        update((d) => (d.id !== offerId ? d : {
          ...d,
          market: { ...(d.market ?? {}), [lot.key]: { ...(d.market?.[lot.key] ?? {}), [t.country]: mergeCountry(d.market?.[lot.key]?.[t.country], t.country, r) } },
        }));
      }));
    }
    setSurvey((s) => s && { ...s, current: cancelSurvey.current ? 'arrêté' : 'terminé', done: cancelSurvey.current ? s.total : s.done });
  };
  const lastSurveyAt = useMemo(() => {
    const dates = Object.values(draft?.market ?? {}).flatMap((byCountry) => Object.values(byCountry).map((c) => c.at)).sort();
    return dates.length ? new Date(dates[dates.length - 1]) : null;
  }, [draft]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Offres fournisseur</h1>
          <p className="text-sm text-slate-600 mt-1">Une liste fournisseur déposée devient une offre MC Export : normalisée, à nos prix, exportable en Excel et PDF. Tout s'enregistre tout seul.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.currentTarget.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy === 'lecture'} className="flex items-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {busy === 'lecture' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Nouvelle offre depuis un fichier
          </button>
        </div>
      </div>

      {msg && <p className="text-sm rounded-lg px-3 py-2 border text-red-700 bg-red-50 border-red-200">{msg}</p>}
      {listError && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{listError}</p>}

      <div className="grid md:grid-cols-[270px_1fr] gap-4 items-start">
        {/* ── Liste des offres : un clic = l'offre s'ouvre ─────────────────── */}
        <aside className="bg-white rounded-xl border border-slate-200 shadow-sm md:sticky md:top-4">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">Offres</span>
            <span className="text-xs text-slate-400">{offers.length}</span>
          </div>
          {offers.length === 0 ? (
            <p className="px-3 py-6 text-xs text-slate-400 text-center">Aucune offre. Dépose un fichier fournisseur pour créer la première.</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
              {offers.map((o) => {
                const active = draft?.id === o.id;
                const n = (o.vehicles ?? []).length, sel = (o.vehicles ?? []).filter((v) => v.selected).length;
                return (
                  <div key={o.id} className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer ${active ? 'bg-blue-50/70 border-l-2 border-brand-ocean' : 'hover:bg-slate-50 border-l-2 border-transparent'}`} onClick={() => open(o)}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${active ? 'font-semibold text-brand-encre' : 'font-medium text-slate-800'}`}>{o.title || 'Sans titre'}</p>
                      <p className="text-[11px] text-slate-500 truncate">{o.supplier || 'fournisseur ?'} · {sel}/{n} véh. · {new Date(o.updated_at).toLocaleDateString('fr-FR')}</p>
                      <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border ${o.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : o.status === 'closed' ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    </div>
                    {o.user_id === userId && (
                      <button onClick={(e) => { e.stopPropagation(); void remove(o); }} className="p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* ── L'offre ouverte ───────────────────────────────────────────────── */}
        {!draft ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
            Choisis une offre à gauche, ou dépose un fichier fournisseur pour en créer une nouvelle.
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            {/* Barre d'état + actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                {saveState.kind === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enregistrement…</>}
                {saveState.kind === 'saved' && <><Check className="w-3.5 h-3.5 text-emerald-600" /> Enregistré à {saveState.at}</>}
                {saveState.kind === 'error' && <span className="text-red-600 flex items-center gap-1"><CloudOff className="w-3.5 h-3.5" /> {saveState.text}</span>}
                {saveState.kind === 'idle' && draft.id && <><Check className="w-3.5 h-3.5 text-slate-400" /> Enregistrée</>}
              </span>
              <select value={draft.status} onChange={(e) => update({ status: e.target.value as SupplierOffer['status'] })} className="text-xs px-2 py-1 rounded-lg border border-slate-300 bg-white">
                <option value="draft">Brouillon</option><option value="sent">Envoyée</option><option value="closed">Clôturée</option>
              </select>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={exportXlsx} disabled={selected.length === 0} className="flex items-center gap-2 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
                <button onClick={exportPdf} disabled={selected.length === 0 || busy === 'pdf'} className="flex items-center gap-2 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">{busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF MC Export</button>
              </div>
            </div>

            {/* Identité */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid md:grid-cols-[2fr_1fr] gap-3">
              <label className="text-xs text-slate-600">Titre de l'offre
                <input value={draft.title} onChange={(e) => update({ title: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="OPEL ASTRA — SÉLECTION PROFESSIONNELLE" />
              </label>
              <label className="text-xs text-slate-600">Fournisseur
                <input value={draft.supplier} onChange={(e) => update({ supplier: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </label>
              <p className="md:col-span-2 text-[11px] text-slate-500">
                {draft.source_filename ? <>Fichier : <span className="text-slate-700">{draft.source_filename}</span> · {draft.layout === 'blocks' ? 'blocs par marque' : 'tableau plat'} · {draft.vehicles.length} véhicule{draft.vehicles.length > 1 ? 's' : ''}</> : 'Aucun fichier'}
              </p>
            </div>

            {/* Correspondance des colonnes */}
            {draft.mappings.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <button onClick={() => setMappingOpen(!mappingOpen)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                  {mappingOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <span className="text-sm font-semibold text-slate-800">Correspondance des colonnes</span>
                  <span className="text-xs text-slate-500">{draft.mappings.filter((m) => m.field !== 'ignore').length} reconnues · {draft.mappings.filter((m) => m.field === 'ignore').length} gardées telles quelles</span>
                  {parsed?.warnings.length ? <span className="ml-auto text-xs text-amber-700">{parsed.warnings.length} avertissement{parsed.warnings.length > 1 ? 's' : ''}</span> : null}
                </button>
                {mappingOpen && (
                  <div className="px-4 pb-3 border-t border-slate-100">
                    {parsed?.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800 mt-2">{w}</p>)}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                      {draft.mappings.map((m) => (
                        <div key={m.header} className="flex items-center gap-2 text-xs">
                          <span className="w-36 truncate font-medium text-slate-700" title={m.header}>{m.header}</span>
                          <span className="w-24 truncate text-slate-400" title={m.sample}>{m.sample}</span>
                          <select value={m.field} onChange={(e) => remap(m.header, e.target.value as OfferField)} disabled={!draft.source_grid} className="flex-1 px-2 py-1 rounded border border-slate-300 bg-white">
                            {(Object.keys(OFFER_FIELD_LABELS) as OfferField[]).map((f) => <option key={f} value={f}>{OFFER_FIELD_LABELS[f]}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                    {!draft.source_grid && <p className="text-[11px] text-amber-700 mt-2">Offre créée avant le 17/09 : le fichier n'a pas été conservé — dépose-le de nouveau (nouvelle offre) pour changer la correspondance. Les offres importées désormais restent modifiables.</p>}
                  </div>
                )}
              </div>
            )}

            {/* Règle de prix + pays */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">Règle de prix MC Export (HT)</p>
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <select value={draft.price_rule.mode} onChange={(e) => applyRule({ ...draft.price_rule, mode: e.target.value as PriceRule['mode'] })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
                    <option value="margin">Prix fournisseur HT + marge</option>
                    <option value="fixed">Prix fixe pour tous</option>
                  </select>
                  <input type="number" value={draft.price_rule.margin} onChange={(e) => update({ price_rule: { ...draft.price_rule, margin: Number(e.target.value) || 0 } })} className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 text-sm text-right" />
                  <span className="text-slate-500">€</span>
                  <button onClick={() => applyRule(draft.price_rule)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 text-white">Appliquer à tous</button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">TTC fournisseur converti en HT (÷ 1,20) quand la TVA est récupérable. Un prix modifié à la main est gardé tant que tu n'appliques pas la règle.</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">Pays à relever pour savoir où vendre</p>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_COUNTRIES.map((c) => {
                    const on = draft.countries.includes(c.code);
                    return <button key={c.code} onClick={() => update({ countries: on ? draft.countries.filter((x) => x !== c.code) : [...draft.countries, c.code] })} className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-white text-slate-600 border-slate-300'}`}>{c.label}</button>;
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">Le relevé se lance dans la section « Où vendre » ci-dessous, lot par lot, après vérification des recherches.</p>
              </div>
            </div>

            {/* Véhicules */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold text-slate-800">{selected.length}/{draft.vehicles.length} véhicules retenus</span>
                <button onClick={() => update({ vehicles: draft.vehicles.map((v) => ({ ...v, selected: true })) })} className="text-xs text-brand-ocean hover:underline">Tout retenir</button>
                <button onClick={() => update({ vehicles: draft.vehicles.map((v) => ({ ...v, selected: false })) })} className="text-xs text-slate-500 hover:underline">Tout écarter</button>
                <span className="ml-auto text-xs text-slate-500">Total HT retenu : <span className="font-semibold text-slate-800">{fmtEur(selected.reduce((a, v) => a + (v.sale_price ?? 0), 0))}</span></span>
              </div>
              <div className="overflow-x-auto">
                <table className="text-xs w-full min-w-[1100px]">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="py-1.5 px-3"></th><th className="py-1.5 pr-3">Véhicule</th><th className="py-1.5 pr-3">Version</th><th className="py-1.5 pr-3">Immat.</th>
                    <th className="py-1.5 pr-3 text-right">Km</th><th className="py-1.5 pr-3">Énergie</th><th className="py-1.5 pr-3 text-right">Ch</th><th className="py-1.5 pr-3">Boîte</th>
                    <th className="py-1.5 pr-3 text-right">Dommages</th><th className="py-1.5 pr-3">TVA</th><th className="py-1.5 pr-3 text-right">Fournisseur HT</th><th className="py-1.5 pr-3 text-right">MC Export HT</th><th className="py-1.5 pr-3">Rapport</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.vehicles.map((v) => {
                      const base = supplierHt(v);
                      return (
                        <tr key={v.id} className={v.selected ? '' : 'opacity-50'}>
                          <td className="py-1.5 px-3"><input type="checkbox" checked={v.selected} onChange={(e) => setVehicle(v.id, { selected: e.target.checked })} /></td>
                          <td className="py-1.5 pr-3 whitespace-nowrap"><span className="font-medium text-slate-800">{v.brand} {v.model}</span>{v.vin && <span className="block text-[10px] text-slate-400">{v.vin}</span>}</td>
                          <td className="py-1.5 pr-3 max-w-[260px] truncate text-slate-600" title={v.version}>{v.version}{v.color ? ` · ${v.color}` : ''}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">{v.reg_date ? new Date(v.reg_date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">{fmtKm(v.km)}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{v.fuel ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{v.power_ch ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{v.gearbox === 'AUTOMATIQUE' ? 'Auto' : v.gearbox === 'MANUELLE' ? 'Manuelle' : v.gearbox ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{fmtEur(v.damages)}</td>
                          <td className="py-1.5 pr-3">{v.vat_recoverable == null ? '—' : v.vat_recoverable ? <span className="text-emerald-700">récup.</span> : <span className="text-amber-700">marge</span>}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={v.price_ttc != null ? `TTC ${fmtEur(v.price_ttc)}` : ''}>{fmtEur(base)}</td>
                          <td className="py-1.5 pr-3 text-right"><input type="number" value={v.sale_price ?? ''} onChange={(e) => setVehicle(v.id, { sale_price: e.target.value === '' ? null : Number(e.target.value) })} className="w-24 px-2 py-1 rounded border border-slate-300 text-right tabular-nums font-semibold text-brand-encre" /></td>
                          <td className="py-1.5 pr-3">{v.report_url ? <a href={v.report_url} target="_blank" rel="noreferrer" className="text-brand-ocean inline-flex"><ExternalLink className="w-3.5 h-3.5" /></a> : '—'}</td>
                        </tr>
                      );
                    })}
                    {draft.vehicles.length === 0 && <tr><td colSpan={13} className="py-6 text-center text-slate-400">Aucun véhicule dans cette offre.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Où vendre : lots × pays, URLs vérifiables, relevé, verdict */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold text-slate-800">Où vendre</span>
                <span className="text-xs text-slate-500">
                  {lots.length} lot{lots.length > 1 ? 's' : ''} · {draft.countries.length} pays
                  {lastSurveyAt ? ` · dernier relevé ${lastSurveyAt.toLocaleDateString('fr-FR')} ${lastSurveyAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ' · aucun relevé'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {surveyRunning && <button onClick={() => { cancelSurvey.current = true; }} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600">Arrêter après ce lot</button>}
                  <button onClick={() => void runSurvey(lots)} disabled={surveyRunning || lots.length === 0 || draft.countries.length === 0} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white font-medium disabled:opacity-50">
                    {surveyRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Relever tous les lots
                  </button>
                </div>
              </div>
              {survey && (
                <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-brand-ocean transition-all" style={{ width: `${survey.total ? Math.round((survey.done / survey.total) * 100) : 0}%` }} /></div>
                    <span className="tabular-nums">{survey.done}/{survey.total} recherches</span>
                    <span className="text-slate-500 truncate max-w-[40%]">{survey.current}</span>
                  </div>
                  {survey.errors.length > 0 && (
                    <details className="mt-1"><summary className="text-amber-700 cursor-pointer">{survey.errors.length} recherche{survey.errors.length > 1 ? 's' : ''} sans résultat</summary>
                      {survey.errors.map((e, i) => <p key={i} className="text-amber-800 mt-0.5">{e}</p>)}
                    </details>
                  )}
                </div>
              )}
              {lots.length === 0 ? (
                <p className="px-4 py-6 text-xs text-slate-400 text-center">Retiens des véhicules ci-dessus : ils seront regroupés en lots (marque, modèle, année, énergie, boîte).</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs w-full min-w-[900px]">
                    <thead><tr className="text-left text-slate-400 border-b border-slate-100">
                      <th className="py-1.5 px-3">Lot</th><th className="py-1.5 pr-3 text-right">Véh.</th><th className="py-1.5 pr-3 text-right">Notre HT</th>
                      {draft.countries.map((c) => <th key={c} className="py-1.5 pr-3">{OFFER_COUNTRIES.find((x) => x.code === c)?.label ?? c}{COUNTRY_CAVEAT[c] ? <span title={COUNTRY_CAVEAT[c]}> ⚠</span> : null}</th>)}
                      <th className="py-1.5 pr-3"></th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {lots.map((lot) => {
                        const opened = targetsOpen === lot.key;
                        const ts = targets[targetKey(lot)];
                        return (
                          <Fragment key={lot.key}>
                            <tr>
                              <td className="py-2 px-3 whitespace-nowrap font-medium text-slate-800">
                                {lot.label}
                                {lot.adjusted && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-50 text-brand-encre border-blue-200 font-normal">critères réglés</span>}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{lot.count}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-slate-700 whitespace-nowrap">{lot.ourPriceMin != null && lot.ourPriceMax != null && lot.ourPriceMin !== lot.ourPriceMax ? `${fmtEur(lot.ourPriceMin)} – ${fmtEur(lot.ourPriceMax)}` : fmtEur(lot.ourPriceAvg)}</td>
                              {draft.countries.map((c) => {
                                const res = draft.market?.[lot.key]?.[c];
                                const v = verdictOf(lot.ourPriceAvg, res, c);
                                return (
                                  <td key={c} className="py-2 pr-3 align-top">
                                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] ${VERDICT_CLASS[v.tone]}`}>{v.text}</span>
                                    {res && res.medianTtc != null && (
                                      <span className="block text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">méd. {fmtEur(res.medianTtc)} TTC · {fmtEur(res.medianHt)} HT · {res.competitors} conc.</span>
                                    )}
                                    {res && res.medianTtc == null && Object.values(res.sites).some((s) => s.error) && (
                                      <span className="block text-[10px] text-amber-700 mt-0.5">{(() => { const s = Object.values(res.sites).find((x) => x.error); return s ? `${SITE_LABEL(s.site)} : ${s.error}` : ''; })()}</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="py-2 pr-3 whitespace-nowrap text-right">
                                <button onClick={() => setEditLot(editLot === lot.key ? null : lot.key)} className={`inline-flex items-center gap-1 mr-3 ${editLot === lot.key ? 'text-brand-encre font-medium' : 'text-brand-ocean'} hover:underline`}><SlidersHorizontal className="w-3 h-3" /> {editLot === lot.key ? 'Fermer' : 'Régler les critères'}</button>
                                <button onClick={() => void toggleTargets(lot)} className="text-brand-ocean hover:underline mr-3">{opened ? 'Masquer' : 'Voir les recherches'}</button>
                                <button onClick={() => void runSurvey([lot])} disabled={surveyRunning || draft.countries.length === 0} className="text-slate-700 hover:underline disabled:opacity-40">Relever ce lot</button>
                              </td>
                            </tr>
                            {editLot === lot.key && (
                              <tr className="bg-blue-50/40">
                                <td colSpan={4 + draft.countries.length} className="px-3 py-2">
                                  <div className="flex flex-wrap items-end gap-3 text-xs">
                                    <label className="text-slate-600">Marque
                                      <input list="offer-brands" value={lot.brand} onChange={(e) => setLotCriteria(lot, { brand: e.target.value })} className="block mt-0.5 w-32 px-2 py-1 rounded border border-slate-300 bg-white uppercase" />
                                    </label>
                                    <label className="text-slate-600">Modèle
                                      <input list={`offer-models-${lot.key}`} value={lot.model} onChange={(e) => setLotCriteria(lot, { model: e.target.value })} className="block mt-0.5 w-40 px-2 py-1 rounded border border-slate-300 bg-white uppercase" />
                                      <datalist id={`offer-models-${lot.key}`}>{(known[lot.brand] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
                                    </label>
                                    <label className="text-slate-600">Année de
                                      <input type="number" value={lot.yearFrom ?? ''} onChange={(e) => setLotCriteria(lot, { yearFrom: e.target.value === '' ? null : Number(e.target.value) })} className="block mt-0.5 w-20 px-2 py-1 rounded border border-slate-300 bg-white" />
                                    </label>
                                    <label className="text-slate-600">à
                                      <input type="number" value={lot.yearTo ?? ''} onChange={(e) => setLotCriteria(lot, { yearTo: e.target.value === '' ? null : Number(e.target.value) })} className="block mt-0.5 w-20 px-2 py-1 rounded border border-slate-300 bg-white" />
                                    </label>
                                    <label className="text-slate-600">Km maxi
                                      <input type="number" step={10000} value={lot.kmMax ?? ''} onChange={(e) => setLotCriteria(lot, { kmMax: e.target.value === '' ? null : Number(e.target.value) })} className="block mt-0.5 w-24 px-2 py-1 rounded border border-slate-300 bg-white" />
                                    </label>
                                    <label className="text-slate-600">Énergie
                                      <select value={lot.fuel ?? ''} onChange={(e) => setLotCriteria(lot, { fuel: e.target.value || null })} className="block mt-0.5 px-2 py-1 rounded border border-slate-300 bg-white">
                                        <option value="">— toutes —</option>
                                        {FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                                        {lot.fuel && !FUEL_OPTIONS.includes(lot.fuel) && <option value={lot.fuel}>{lot.fuel}</option>}
                                      </select>
                                    </label>
                                    <label className="text-slate-600">Boîte
                                      <select value={lot.gearbox ?? ''} onChange={(e) => setLotCriteria(lot, { gearbox: e.target.value || null })} className="block mt-0.5 px-2 py-1 rounded border border-slate-300 bg-white">
                                        <option value="">— toutes —</option><option value="AUTOMATIQUE">Automatique</option><option value="MANUELLE">Manuelle</option>
                                      </select>
                                    </label>
                                    {lot.adjusted && <button onClick={() => setLotCriteria(lot, null)} className="text-slate-500 hover:underline pb-1.5">Rétablir les critères du fichier</button>}
                                    <span className="text-[11px] text-slate-500 pb-1.5 basis-full">Ces critères ne changent que la recherche de marché (pas l'offre exportée). Un changement efface le relevé du lot ; vérifie les recherches puis relance.</span>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {opened && (
                              <tr className="bg-slate-50/60">
                                <td colSpan={4 + draft.countries.length} className="px-3 py-2">
                                  {!ts ? <span className="text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> génération des URLs…</span> : ts.length === 0 ? <span className="text-slate-400">Aucun site pour les pays cochés.</span> : (
                                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-1">
                                      {ts.map((t) => {
                                        const sr = draft.market?.[lot.key]?.[t.country]?.sites[t.site];
                                        return (
                                          <div key={`${t.country}-${t.site}`} className="flex items-start gap-2 min-w-0">
                                            <span className="w-24 shrink-0 text-slate-500">{t.country} · {SITE_LABEL(t.site)}</span>
                                            <div className="min-w-0 flex-1">
                                              {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline break-all inline-flex items-center gap-1">{t.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 110)}{t.url.length > 118 ? '…' : ''} <ExternalLink className="w-3 h-3 shrink-0" /></a> : <span className="text-red-700">pas d'URL</span>}
                                              {t.warnings.map((w, i) => <span key={i} className="block text-[10px] text-amber-700">{w}</span>)}
                                              {t.brandPageOnly && <span className="block text-[10px] text-slate-500">page marque : seules les annonces dont le titre nomme « {lot.model} » comptent</span>}
                                              {sr && <span className="block text-[10px] text-slate-500">{sr.error ? <span className="text-amber-700">{sr.error}</span> : <>{sr.count} annonce{sr.count > 1 ? 's' : ''}{sr.total != null && sr.total !== sr.count ? ` sur ${sr.total}` : ''} · méd. {fmtEur(sr.median)} · 1er quart {fmtEur(sr.p25)} · mini {fmtEur(sr.min)}</>} · {new Date(sr.at).toLocaleDateString('fr-FR')}</span>}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <datalist id="offer-brands">{Object.keys(known).map((b) => <option key={b} value={b} />)}</datalist>
              <p className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-500">
                Verdict = médiane des annonces du pays (TTC → HT avec la TVA locale) face à notre prix HT moyen du lot : <span className="text-emerald-700">bon</span> si le marché est ≥ 15 % au-dessus, <span className="text-amber-700">juste</span> entre 5 et 15 %, <span className="text-red-700">trop cher</span> en dessous.
                {draft.countries.some((c) => COUNTRY_CAVEAT[c]) && <> ⚠ Danemark : {COUNTRY_CAVEAT.DK}.</>} Les recherches passent par la même file que le Market Intelligence : compte quelques minutes par lot.
              </p>
            </div>

            <label className="block bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-xs text-slate-600">Notes internes (jamais exportées)
              <textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Contact fournisseur, délai, conditions…" />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
