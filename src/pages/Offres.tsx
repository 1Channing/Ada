import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Upload, FileSpreadsheet, FileText, Trash2, Loader2, ExternalLink, Check, CloudOff, Search, SlidersHorizontal,
  PanelLeftOpen, X, StickyNote, Settings, Pencil, ArrowUp, ArrowDown, Plus, RotateCcw, BarChart3, ListChecks, Columns3, Megaphone, ImagePlus, MoreHorizontal,
} from 'lucide-react';
import { listShowcase, publishToShowcase, unpublishFromShowcase, reorderShowcase, setShowcaseNote, setShowcaseTitle, setShowcasePrice, setShowcaseVehicle, snapshotVehicle, addShowcasePhotos, removeShowcasePhoto, addManualShowcase, type IntraItem, type IntraDraft } from '../services/intra';
import { useAuth } from '../services/auth';
import { recordLearningCaseFromApp } from '../services/learningCases';
import { listRefBrandModels } from '../services/workflow';
import {
  parseSupplierWorkbook, readSupplierGrid, supplierHt,
  type ParsedSupplierFile, type OfferVehicle, type OfferField, type ColumnMapping,
} from '../lib/offers/parseSupplierFile';
import { loadLearnedModelsByBrand, mergeKnownModels } from '../lib/offers/knownModels';
import { pdfToLinesEx } from '../lib/pdfText';
import { isDealerExtractPdf, parseDealerExtractPdf } from '../lib/offers/parseSupplierPdf';
import { ADMIN_BUCKET, signedUrl } from '../services/storageAccess';
import { supabase } from '../lib/supabase';
import type { OfferSourceFile } from '../services/offers';
import { buildOfferWorkbook, downloadBlob, slugFile, fmtEur, fmtKm, fmtDate } from '../lib/offers/exportOfferXlsx';
import { buildOfferPdf } from '../lib/offers/exportOfferPdf';
import {
  ALL_BUILTIN_KEYS, BUILTIN_COLUMNS, cellValue, defaultExportColumns, displayLabel, effectiveColumns, isColumnEmpty, newCustomColumn,
  type ExportColumn, type ExportContext,
} from '../lib/offers/exportColumns';
import {
  EXPORT_TEXT, VAT_CHOICES, basisLabel, damagesEur, detectPriceSetup, fileMoney, fromShown, fxRateLabel, resolveSettings, supplierHtWith, supplierShown, supplierVatOf, todayFxRate, toShown,
  type OfferSettings, type ResolvedSettings,
} from '../lib/offers/offerSettings';
import { FILE_CURRENCIES, type FileCurrency } from '../lib/offers/parseSupplierFile';
import { colorLabel } from '../lib/offers/colorTranslate';
import { currentFx } from '../services/fxRates';
import { listOffers, saveOffer, deleteOffer, applyPriceRule, OFFER_COUNTRIES, type SupplierOffer, type PriceRule } from '../services/offers';
import {
  lotsOf, lotTargets, startLotJob, awaitLotJob, mergeCountry, verdictOf, applyLotCriteria, COUNTRY_CAVEAT,
  type OfferMarket, type OfferLot, type LotTarget, type SiteResult, type LotCriteria,
} from '../lib/offers/marketCheck';

/**
 * OFFRES FOURNISSEUR — refonte du 11/10 (directives Channing) :
 * - la liste des offres est un PANNEAU qu'on ouvre au besoin, l'offre prend la largeur ;
 * - trois vues : SÉLECTION (modèles par marque, véhicules corrigeables ligne
 *   par ligne), ANALYSE (ex-« Où vendre », relevés PAYS PAR PAYS à la demande)
 *   et EXPORT (colonnes de l'offre : ajouter, renommer, ordonner, retirer) ;
 * - plus d'écran de correspondance des colonnes : une valeur mal lue se
 *   corrige dans la ligne du véhicule, la correction survit à une relecture ;
 * - notes internes dans une fenêtre, enregistrement automatique partout.
 */

interface Draft {
  id?: string; title: string; supplier: string; source_filename: string; layout: string;
  mappings: ColumnMapping[]; vehicles: OfferVehicle[]; price_rule: PriceRule; countries: string[]; notes: string; status: SupplierOffer['status'];
  market?: OfferMarket;
  lot_criteria?: Record<string, LotCriteria>;
  source_grid?: unknown[][] | null;
  source_files?: OfferSourceFile[];
  export_columns?: ExportColumn[] | null;
  settings?: OfferSettings | null;
}
type View = 'selection' | 'analyse' | 'export' | 'intra';
type Msg = { tone: 'info' | 'error'; text: string } | null;

const FUEL_OPTIONS = ['ESSENCE', 'DIESEL', 'HYBRIDE', 'HYBRIDE RECHARGEABLE', 'ELECTRIQUE', 'GPL'];
const VERDICT_CLASS: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200', warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200', idle: 'bg-slate-50 text-slate-500 border-slate-200',
};
const SITE_LABEL = (key: string) => key.replace(/^autoscout24_/, 'AS24 ').replace(/_/g, ' ');
const EMPTY: Draft = { title: '', supplier: '', source_filename: '', layout: 'flat', mappings: [], vehicles: [], price_rule: { mode: 'margin', margin: 500 }, countries: ['FR', 'NL', 'DK'], notes: '', status: 'draft' };
const STATUS_LABEL: Record<SupplierOffer['status'], string> = { draft: 'brouillon', sent: 'envoyée', closed: 'clôturée' };
const STATUS_CLASS: Record<SupplierOffer['status'], string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-200', sent: 'bg-emerald-50 text-emerald-700 border-emerald-200', closed: 'bg-slate-100 text-slate-500 border-slate-200',
};
const countryLabel = (code: string) => OFFER_COUNTRIES.find((x) => x.code === code)?.label ?? code;
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));

export function Offres() {
  const { userId, displayName, email } = useAuth();
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [known, setKnown] = useState<Record<string, string[]>>({});
  const [parsed, setParsed] = useState<ParsedSupplierFile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; text?: string }>({ kind: 'idle' });
  /** Réglages appliqués mais pas encore gardés en base (SQL pas collé) : 'export_columns', 'settings'. */
  const [notSaved, setNotSaved] = useState<string[]>([]);
  const columnsNotSaved = notSaved.includes('export_columns');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>('selection');
  const [listOpen, setListOpen] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState<string | null>(null);
  /** Fenêtre d'un modèle : ses véhicules, à cocher et corriger sans quitter le choix des modèles (11/10). */
  const [modelPopup, setModelPopup] = useState<string | null>(null);
  // Modifier un critère pour TOUTE la liste d'un modèle (20/10, Channing : « changer les noms pour tous les
  // modèles en une seule fois… un critère commun à toute une liste d'un modèle donné, sur cette page uniquement »).
  const [bulk, setBulk] = useState<{ field: BulkField; value: string } | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  /** Onglet Sélection : par modèle (cartes par marque) ou liste complète — retenu sur ce poste. */
  const [selectionLayout, setSelectionLayout] = useState<'models' | 'list'>(() => {
    try { return localStorage.getItem('ada_offres_layout') === 'list' ? 'list' : 'models'; } catch { return 'models'; }
  });
  const setLayout = (l: 'models' | 'list') => { setSelectionLayout(l); try { localStorage.setItem('ada_offres_layout', l); } catch { /* stockage indisponible */ } };
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);
  const info = (text: string) => setMsg({ tone: 'info', text });
  const fail = (text: string) => setMsg({ tone: 'error', text });

  const reload = async () => { const r = await listOffers(); setOffers(r.rows); setListError(r.error); return r.rows; };
  // INTRA (12/10 soir) : la vitrine de l'Accueil MC Export — ce qui y est déjà, et ce que cette offre y publie.
  const [showcase, setShowcase] = useState<IntraItem[]>([]);
  const [showcaseError, setShowcaseError] = useState<string | null>(null);
  /** Bonne affaire dont les photos sont en cours d'envoi (13/10). */
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  /** Bonne affaire dépliée dans « Ce que l'Accueil montre » : prix, mot, réglages (13/10, Channing : « cliquer sur une ligne pour modifier »). */
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  /** AJOUT DIRECT d'une bonne affaire, sans liste fournisseur (14/10) : le véhicule saisi dans le crayon habituel. */
  const emptyManual = (): OfferVehicle => ({
    id: 'manual', vin: null, brand: '', model: '', version: '', reg_date: null, year: null, km: null, color: null, fuel: null, engine: null, power_ch: null,
    gearbox: null, co2: null, damages: null, report_url: null, location: null, price_ht: null, price_ttc: null, vat_recoverable: null, imported: null, extras: {}, selected: true, sale_price: null, quantity: 1,
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<OfferVehicle>(emptyManual);
  const [manualMeta, setManualMeta] = useState<{ price: string; title: string; note: string }>({ price: '', title: '', note: '' });
  const [manualBusy, setManualBusy] = useState(false);
  /** Menu ⋯ d'une bonne affaire, et véhicule en cours de correction (14/10, Channing : « modifier les critères via les trois petits points »). */
  const [dealMenu, setDealMenu] = useState<string | null>(null);
  const [editDeal, setEditDeal] = useState<{ id: string; v: OfferVehicle } | null>(null);
  const [editDealBusy, setEditDealBusy] = useState(false);
  const startEditDeal = (it: IntraItem) => {
    const s = it.vehicle;
    setEditDeal({ id: it.id, v: { ...emptyManual(), id: it.id, vin: s.vin, brand: s.brand, model: s.model, version: s.version, engine: s.engine, reg_date: s.reg_date, year: s.year, km: s.km, color: s.color, fuel: s.fuel, power_ch: s.power_ch, gearbox: s.gearbox, damages: s.damages, report_url: s.report_url, vat_recoverable: s.vat_recoverable, quantity: s.quantity } });
    setDealMenu(null); setOpenDeal(it.id);
  };
  const saveEditDeal = async () => {
    if (!editDeal) return;
    if (!editDeal.v.brand.trim() || !editDeal.v.model.trim()) { fail('Marque et modèle sont obligatoires.'); return; }
    setEditDealBusy(true);
    const v: OfferVehicle = { ...editDeal.v, brand: editDeal.v.brand.trim().toUpperCase(), model: editDeal.v.model.trim().toUpperCase(), version: editDeal.v.version.trim() || editDeal.v.model.trim().toUpperCase() };
    const err = await setShowcaseVehicle(editDeal.id, snapshotVehicle(v));
    setEditDealBusy(false);
    if (err) { fail(err); return; }
    info('Caractéristiques corrigées — Accueil et mc-export.com à jour.');
    setEditDeal(null);
    void reloadShowcase();
  };
  const submitManual = async () => {
    if (!manual.brand.trim() || !manual.model.trim()) { fail('Marque et modèle sont obligatoires.'); return; }
    setManualBusy(true);
    const v: OfferVehicle = { ...manual, brand: manual.brand.trim().toUpperCase(), model: manual.model.trim().toUpperCase(), version: manual.version.trim() || manual.model.trim().toUpperCase() };
    const price = manualMeta.price.trim() === '' ? null : Math.round(Number(manualMeta.price));
    const r = await addManualShowcase({ vehicle: snapshotVehicle(v), price_ht: price != null && Number.isFinite(price) ? price : null, title: manualMeta.title, note: manualMeta.note });
    setManualBusy(false);
    if (r.error) { fail(r.error); return; }
    info(`${v.brand} ${v.model} ajouté aux bonnes affaires — visible sur l'Accueil et sur mc-export.com. Ajoute ses photos ci-dessous.`);
    setManual(emptyManual()); setManualMeta({ price: '', title: '', note: '' }); setManualOpen(false);
    void reloadShowcase();
  };
  const reloadShowcase = async () => { const r = await listShowcase(); setShowcase(r.rows); setShowcaseError(r.error); };
  /** Flèches de la liste (29/10) : déplacer une bonne affaire d'un cran, l'ordre entier est réécrit (1..n). */
  const moveDeal = async (id: string, dir: -1 | 1) => {
    const i = showcase.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= showcase.length) return;
    const next = [...showcase];
    [next[i], next[j]] = [next[j], next[i]];
    setShowcase(next.map((x, k) => ({ ...x, position: k + 1 })));
    const err = await reorderShowcase(next.map((x) => x.id));
    if (err) { fail(err); void reloadShowcase(); }
  };
  useEffect(() => { void reloadShowcase(); }, []);
  // Ouverture par l'URL (/offres?offer=<id>&view=analyse — bouton « Étude de marché » de la vitrine).
  const [search, setSearch] = useState(window.location.search);
  const handledSearch = useRef<string | null>(null);
  useEffect(() => {
    const f = () => setSearch(window.location.search);
    window.addEventListener('locationchange', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('locationchange', f); window.removeEventListener('popstate', f); };
  }, []);
  // Modèles connus = référentiel des études + taxonomie moissonnée des sites
  // (le référentiel seul ignorait « ASTRA » : aucune étude Astra, 16/09).
  useEffect(() => {
    void reload();
    void Promise.all([
      listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)),
      loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>)),
    ]).then(([ref, learned]) => setKnown(mergeKnownModels(ref, learned)));
  }, []);

  // Panneau des offres et fenêtre des notes : Échap les referme.
  useEffect(() => {
    if (!listOpen && !notesOpen && !modelPopup && !settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setNotesOpen(false); setListOpen(false); setModelPopup(null); setSettingsOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listOpen, notesOpen, modelPopup, settingsOpen]);

  // ENREGISTREMENT AUTOMATIQUE : toute modification du brouillon part en base
  // 1,2 s après la dernière frappe ; la première sauvegarde crée l'offre.
  const persist = async (d: Draft) => {
    setSaveState({ kind: 'saving' });
    const r = await saveOffer(d);
    if (r.error) { setSaveState({ kind: 'error', text: r.error }); return; }
    setNotSaved(r.dropped.filter((c) => (c === 'export_columns' && d.export_columns != null) || (c === 'settings' && d.settings != null)));
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

  /** (Re)lecture d'une grille : nouvelle offre, ou relecture d'une offre existante avec les règles du jour.
   *  Sélection, prix MC Export, CORRECTIONS faites à la main et colonnes libres sont gardés véhicule par véhicule. */
  const buildDraftFromGrid = (src: { sheet: string; grid: unknown[][] }, name: string, ov: Record<string, OfferField>, base: Draft): Draft => {
    // Unité des kilométrages : celle réglée sur l'offre, sinon décidée sur le fichier (mil suédois ×10, 13/10).
    const p = parseSupplierWorkbook(src, known, ov, { kmUnit: base.settings?.kmUnit ?? 'auto' });
    setParsed(p);
    const prev = new Map(base.vehicles.map((v) => [v.id, v]));
    // Devise lue ou déduite du fichier (13/10, listes suédoises en SEK), posée une
    // fois pour toutes avec le taux BCE du jour, figé : un réglage fait à la main reste.
    const fx = currentFx();
    const cur = p.currency.currency;
    const currencyPatch: Partial<OfferSettings> = base.settings?.supplierCurrency == null
      ? { supplierCurrency: cur, supplierFxRate: cur === 'EUR' ? null : fx.rates[cur] ?? null, supplierFxDate: cur === 'EUR' ? null : fx.date }
      : {};
    const settings: OfferSettings = { ...(base.settings ?? {}), ...currencyPatch, kmUnit: p.kmUnit.unit };
    const baseSettings = resolveSettings(settings);
    const vehicles = applyPriceRule(p.vehicles, base.price_rule, (v) => supplierHtWith(v, baseSettings), true)
      .map((v) => {
        const o = prev.get(v.id);
        return o ? { ...v, ...(o.manual ?? {}), manual: o.manual, custom: o.custom, selected: o.selected, sale_price: o.sale_price } : v;
      });
    const models = [...new Set(vehicles.map((v) => `${v.brand} ${v.model}`))];
    const firstBrand = vehicles[0]?.brand ?? '';
    return {
      ...base,
      title: base.title || (models.length === 1 ? `${models[0]} — SÉLECTION PROFESSIONNELLE` : `${firstBrand ? firstBrand + ' & AUTRES' : 'SÉLECTION'} — OFFRE MC EXPORT`),
      supplier: base.supplier || name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40),
      source_filename: name, layout: p.layout, mappings: p.mappings, vehicles, source_grid: p.grid, settings,
      // Conditions écrites dans le fichier (« Minimum order: 4 cars », lieu
      // d'enlèvement…) → notes de l'offre, si rien n'y est encore (30/09).
      notes: base.notes || p.notes || '',
    };
  };
  const rereadFile = () => update((d) => (d.source_grid ? buildDraftFromGrid({ sheet: d.source_filename, grid: d.source_grid }, d.source_filename, Object.fromEntries(d.mappings.map((m) => [m.header, m.field])), d) : d));

  /**
   * LISTES PDF (07/10, listes allemandes reçues par Achille) : chaque PDF est
   * lu (pdf.js), les véhicules reconnus sont réunis dans UNE offre ; le nom de
   * l'offre dit d'où elle vient. Prix TTC (TVA allemande 19 %) → HT par la règle.
   */
  const buildDraftFromPdfs = async (files: File[]): Promise<{ draft: Draft; warnings: string[] }> => {
    const all: OfferVehicle[] = [];
    const warnings: string[] = [];
    const brands: string[] = [];
    const stored: OfferSourceFile[] = [];
    for (const f of files) {
      // Le PDF est GARDÉ (bucket admin-documents, URL signée à l'ouverture).
      try {
        const safe = f.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'liste';
        const path = `offres/${Date.now().toString(36)}_${safe}.pdf`;
        const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, f, { contentType: 'application/pdf' });
        if (up.error) warnings.push(`${f.name} : PDF non conservé (${up.error.message})`);
        else stored.push({ name: f.name, path, size: f.size });
      } catch (e) { warnings.push(`${f.name} : PDF non conservé (${e instanceof Error ? e.message : String(e)})`); }
      const { lines, ocr } = await pdfToLinesEx(f);
      if (ocr) warnings.push(`${f.name} : PDF sans texte, lu par reconnaissance optique — à vérifier.`);
      if (!isDealerExtractPdf(lines)) { warnings.push(`${f.name} : gabarit non reconnu (attendu : extrait de stock « Angebotstyp / Nr. »).`); continue; }
      const p = parseDealerExtractPdf(lines, { filename: f.name, knownModelsByBrand: known });
      const taken = new Set(all.map((v) => v.id));
      for (const v of p.vehicles) all.push(taken.has(v.id) ? { ...v, id: `${v.id}#${files.indexOf(f) + 1}` } : v);
      if (p.brand) brands.push(p.brand);
      warnings.push(...p.warnings.map((w) => `${f.name} : ${w}`));
    }
    // Rien de retenu au départ (07/10, Channing : « on choisit les modèles qu'on intègre »).
    const vehicles = applyPriceRule(all, EMPTY.price_rule, (v) => supplierHt(v), true).map((v) => ({ ...v, selected: false }));
    const brandSet = [...new Set(brands)];
    const names = files.map((f) => f.name);
    const draft: Draft = {
      ...EMPTY,
      title: `${brandSet.length === 1 ? brandSet[0] : brandSet.length > 1 ? brandSet.join(' & ') : 'SÉLECTION'} — OFFRE MC EXPORT`,
      supplier: names[0].replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40),
      source_filename: names.join(' + '), layout: 'pdf', mappings: [], vehicles, source_grid: null, source_files: stored,
      notes: 'Prix fournisseur TTC (TVA allemande 19 %), « MwSt.-Ausweis möglich » = TVA récupérable.',
    };
    return { draft, warnings };
  };

  /** À l'import : les paramètres de prix suivent ce que dit le fichier (HT/TTC, TVA, DEVISE), prix MC Export recalculés en conséquence. */
  const withDetectedSettings = (d: Draft): { draft: Draft; summary: string } => {
    const det = detectPriceSetup(d, resolveSettings(null));
    // La devise (et son taux figé) vient de buildDraftFromGrid ; un PDF allemand est en euros.
    const settings: OfferSettings = { ...(d.settings ?? {}), supplierBasis: det.basis ?? 'auto', supplierVat: det.vat };
    const st = resolveSettings(settings);
    const vehicles = applyPriceRule(d.vehicles, d.price_rule, (v) => supplierHtWith(v, st), true).map((v, i) => ({ ...v, selected: d.vehicles[i].selected }));
    const after = detectPriceSetup({ ...d, vehicles }, st);
    const curLabel = st.supplierCurrency === 'EUR' ? '' : ` en ${st.supplierCurrency} (${fxRateLabel(st)})`;
    const summary = `Prix lus en ${det.basis ? det.basis.toUpperCase() : '?'}${curLabel}${det.basis === 'ttc' ? `, TVA ${det.vat != null ? `${Math.round(det.vat * 100)} %` : '20 % supposée'}` : ''}${after.doubts.length ? ` — ${after.doubts.length} point${after.doubts.length > 1 ? 's' : ''} à vérifier (bandeau jaune).` : ' — rien à signaler.'}`;
    return { draft: { ...d, settings, vehicles }, summary };
  };

  /** Dépôt : un tableur (le premier) ou un ou plusieurs PDF. */
  const onFiles = async (list: FileList) => {
    const files = [...list];
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length === 0) { const f = files[0]; if (f) await onFile(f); return; }
    setBusy('lecture'); setMsg(null);
    try {
      const built = await buildDraftFromPdfs(pdfs);
      const warnings = built.warnings;
      const { draft: d, summary } = withDetectedSettings(built.draft);
      setParsed(null);
      setDraft(d); setView('selection'); setListOpen(false);
      await persist(d);
      if (d.vehicles.length === 0) {
        const saved = await recordLearningCaseFromApp({
          kind: 'offer_file_unparsed', key: pdfs.map((f) => f.name).join(' + '), title: `PDF fournisseur mal lu : ${pdfs.map((f) => f.name).join(' + ')} (0 véhicule)`,
          link: '/offres', actor: 'dev', submittedBy: displayName || email || null, detail: { warnings: warnings.slice(0, 12), files: pdfs.map((f) => f.name) },
        });
        fail(`PDF lu mais aucun véhicule reconnu${saved ? ' — enregistré dans la boîte à apprendre pour enseigner ce gabarit' : ''}.`);
      } else {
        info(`${d.vehicles.length} véhicule${d.vehicles.length > 1 ? 's' : ''} lus dans ${pdfs.length} PDF. ${summary} Rien n'est retenu au départ : choisis les modèles à intégrer.${warnings.length ? ` · ${warnings.slice(0, 4).join(' · ')}${warnings.length > 4 ? ` · +${warnings.length - 4}` : ''}` : ''}`);
      }
    } catch (e) {
      fail(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
  };

  /** Import = NOUVELLE offre, ouverte et enregistrée tout de suite. */
  const onFile = async (f: File) => {
    setBusy('lecture'); setMsg(null);
    try {
      const src = readSupplierGrid(await f.arrayBuffer());
      const { draft: d, summary } = withDetectedSettings(buildDraftFromGrid(src, f.name, {}, { ...EMPTY }));
      setDraft(d); setView('selection'); setListOpen(false);
      await persist(d);
      // Boîte à apprendre (02/10) : un fichier qui ne donne aucun véhicule, ou
      // sans marque ni modèle reconnus, est un format à enseigner au parseur.
      const fields = new Set(d.mappings.map((m) => m.field));
      if (d.vehicles.length === 0 || !(fields.has('brand') || fields.has('model') || fields.has('vin'))) {
        const saved = await recordLearningCaseFromApp({
          kind: 'offer_file_unparsed', key: f.name, title: `Fichier fournisseur mal lu : ${f.name} (${d.vehicles.length} véhicule${d.vehicles.length > 1 ? 's' : ''})`,
          link: '/offres', actor: 'dev', submittedBy: displayName || email || null,
          detail: { headers: d.mappings.map((m) => m.header).slice(0, 40), mapped: [...fields], vehicles: d.vehicles.length, layout: d.layout },
        });
        fail(`Fichier lu mais ${d.vehicles.length === 0 ? 'aucun véhicule reconnu' : 'ni marque, ni modèle, ni VIN reconnus'}${saved ? ' — enregistré dans la boîte à apprendre pour enseigner ce format' : ''}.`);
      } else {
        info(`${d.vehicles.length} véhicule${d.vehicles.length > 1 ? 's' : ''} lus dans ${f.name}. ${summary} Une valeur fausse se corrige dans la ligne du véhicule (crayon).`);
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const saved = await recordLearningCaseFromApp({ kind: 'offer_file_unparsed', key: f.name, title: `Fichier fournisseur illisible : ${f.name}`, link: '/offres', actor: 'dev', submittedBy: displayName || email || null, detail: { error: why.slice(0, 300) } });
      fail(`Lecture impossible : ${why}${saved ? ' — fichier enregistré dans la boîte à apprendre' : ''}`);
    }
    setBusy(null);
  };

  const setVehicle = (id: string, patch: Partial<OfferVehicle>) => update((d) => ({ ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  /** Correction à la main d'une valeur lue : appliquée et mémorisée (rejouée après une relecture du fichier). */
  const correctVehicle = (id: string, patch: Partial<OfferVehicle>) => update((d) => ({
    ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, ...patch, manual: { ...(v.manual ?? {}), ...patch } } : v)),
  }));
  const setCustomValue = (id: string, colId: string, value: string) => update((d) => ({
    ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, custom: { ...(v.custom ?? {}), [colId]: value } } : v)),
  }));
  const applyRule = (rule: PriceRule) => update((d) => { const st = resolveSettings(d.settings); return { ...d, price_rule: rule, vehicles: applyPriceRule(d.vehicles, rule, (v) => supplierHtWith(v, st), true) }; });
  /** Paramètres de l'offre. Prix du fichier ou TVA fournisseur changés : les prix MC Export sont recalculés avec la règle. */
  const updateSettings = (patch: Partial<OfferSettings>) => update((d) => {
    const settings = { ...(d.settings ?? {}), ...patch };
    // Unité des kilométrages changée : le fichier est relu avec cette unité (sélection, prix et corrections gardés).
    if ('kmUnit' in patch && d.source_grid) return buildDraftFromGrid({ sheet: d.source_filename, grid: d.source_grid }, d.source_filename, Object.fromEntries(d.mappings.map((m) => [m.header, m.field])), { ...d, settings });
    const supplierChanged = 'supplierBasis' in patch || 'supplierVat' in patch || 'supplierCurrency' in patch || 'supplierFxRate' in patch;
    if (!supplierChanged) return { ...d, settings };
    const st = resolveSettings(settings);
    return { ...d, settings, vehicles: applyPriceRule(d.vehicles, d.price_rule, (v) => supplierHtWith(v, st), true) };
  });
  /** Devise du fichier changée : taux BCE du jour figé avec elle. */
  const setCurrency = (c: FileCurrency) => updateSettings({ supplierCurrency: c, supplierFxRate: c === 'EUR' ? null : todayFxRate(c), supplierFxDate: c === 'EUR' ? null : currentFx().date });
  const S: ResolvedSettings = resolveSettings(draft?.settings);
  const B = basisLabel(S);
  const supHt = (v: OfferVehicle) => supplierHtWith(v, S);
  const dmgEur = (v: OfferVehicle) => damagesEur(v, S);
  const exportCtx: ExportContext = { lang: S.lang, basis: S.display, saleVat: S.saleVat, supplierHt: supHt, damagesEur: dmgEur };
  /** Ce que le fichier dit des prix, et ce qu'ADA a dû supposer — recalculé à chaque changement. */
  const detection = useMemo(() => (draft ? detectPriceSetup(draft, resolveSettings(draft.settings)) : null), [draft]);
  const pendingDoubts = detection && detection.doubts.length > 0 && draft?.settings?.priceCheckAck !== detection.signature ? detection.doubts : [];

  /** Bascule d'une offre à l'autre en un clic — l'offre quittée est déjà enregistrée (ou le sera dans la seconde). */
  const open = (o: SupplierOffer) => {
    if (saveTimer.current && draft && dirty.current) { window.clearTimeout(saveTimer.current); dirty.current = false; void persist(draft); }
    // RÉPARATION À L'OUVERTURE (25/09) : une offre lue avec d'anciennes règles
    // peut porter des dates impossibles ; si le fichier est conservé, on la
    // relit avec les règles du jour (sélection, prix et corrections gardés).
    const stale = Boolean(o.source_grid) && o.vehicles.some((v) => v.reg_date && Number.isNaN(new Date(v.reg_date).getTime()));
    const next: Draft = stale && o.source_grid
      ? buildDraftFromGrid({ sheet: o.source_filename, grid: o.source_grid }, o.source_filename, Object.fromEntries(o.mappings.map((m) => [m.header, m.field])), { ...o })
      : { ...o };
    if (stale) { info('Dates relues avec les règles du jour (fichier au format américain) — offre enregistrée.'); void persist(next); }
    setDraft(next); if (!stale) setParsed(null); setSaveState({ kind: 'idle' }); setTargetsOpen(null); setEditLot(null); setEditVehicle(null);
    if (!stale) setMsg(null);
    setNotSaved([]); setModelPopup(null); setModelQuery(''); setSettingsOpen(false);
    setView(next.vehicles.some((v) => v.selected) ? 'analyse' : 'selection');
    setListOpen(false);
    setSurvey((s) => (s && s.done < s.total && s.current !== 'arrêté' ? s : null));
  };
  useEffect(() => {
    if (handledSearch.current === search) return;
    const p = new URLSearchParams(search);
    const id = p.get('offer');
    if (!id) { handledSearch.current = search; return; }
    const o = offers.find((x) => x.id === id);
    if (!o) return; // la liste n'est pas encore là : on réessaie à sa lecture
    handledSearch.current = search;
    if (draft?.id !== id) open(o);
    const v = p.get('view');
    if (v === 'analyse' || v === 'export' || v === 'intra' || v === 'selection') setView(v);
  }, [search, offers]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (o: SupplierOffer) => {
    if (!confirm(`Supprimer l'offre « ${o.title || 'sans titre'} » ?`)) return;
    const err = await deleteOffer(o.id);
    if (err) { fail(err); return; }
    if (draft?.id === o.id) setDraft(null);
    await reload();
  };

  const selected = useMemo(() => (draft?.vehicles ?? []).filter((v) => v.selected), [draft]);
  // Exemplaires (07/10) : une ligne par modèle, la quantité à côté — les comptes parlent en véhicules.
  const qtyOf = (v: OfferVehicle) => Math.max(1, v.quantity ?? 1);
  const selectedUnits = selected.reduce((a, v) => a + qtyOf(v), 0);
  const totalUnits = (draft?.vehicles ?? []).reduce((a, v) => a + qtyOf(v), 0);
  const unitsLabel = (lines: number, units: number) => `${units} véhicule${units > 1 ? 's' : ''}${units !== lines ? ` (${lines} modèle${lines > 1 ? 's' : ''})` : ''}`;
  const openSourceFile = async (f: OfferSourceFile) => {
    try { window.open(await signedUrl(f.path), '_blank', 'noopener'); } catch (e) { fail(`Ouverture impossible : ${e instanceof Error ? e.message : String(e)}`); }
  };

  // ── CHOIX DES MODÈLES, regroupés par marque (refonte 11/10) ─────────────────
  const modelKeyOf = (v: OfferVehicle) => `${v.brand} ${v.model}`.trim();
  const brandGroups = useMemo(() => {
    type M = { key: string; model: string; units: number; selected: number; kmSum: number; kmN: number; priceSum: number; priceN: number };
    const brands = new Map<string, { brand: string; units: number; selected: number; models: Map<string, M> }>();
    for (const v of draft?.vehicles ?? []) {
      const brand = v.brand || '—';
      const b = brands.get(brand) ?? { brand, units: 0, selected: 0, models: new Map<string, M>() };
      const key = modelKeyOf(v);
      const m = b.models.get(key) ?? { key, model: v.model || '—', units: 0, selected: 0, kmSum: 0, kmN: 0, priceSum: 0, priceN: 0 };
      const q = qtyOf(v);
      m.units += q; b.units += q;
      if (v.selected) { m.selected += q; b.selected += q; }
      if (v.km != null) { m.kmSum += v.km; m.kmN++; }
      const p = v.sale_price != null ? toShown(v.sale_price, S) : supplierShown(v, S);
      if (p != null) { m.priceSum += p; m.priceN++; }
      b.models.set(key, m);
      brands.set(brand, b);
    }
    const q = modelQuery.trim().toLowerCase();
    return [...brands.values()]
      .map((b) => ({ ...b, models: [...b.models.values()].filter((m) => !q || m.key.toLowerCase().includes(q)).sort((x, y) => x.model.localeCompare(y.model, 'fr')) }))
      .filter((b) => b.models.length > 0)
      .sort((x, y) => x.brand.localeCompare(y.brand, 'fr'));
  }, [draft, modelQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Liste complète filtrée par la recherche (modèle, version, VIN/plaque, couleur, motorisation). */
  const listVehicles = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const all = draft?.vehicles ?? [];
    return q ? all.filter((v) => `${v.brand} ${v.model} ${v.version} ${v.vin ?? ''} ${v.color ?? ''} ${v.engine ?? ''}`.toLowerCase().includes(q)) : all;
  }, [draft, modelQuery]);
  const setModelSelected = (key: string, on: boolean) => update((d) => ({ ...d, vehicles: d.vehicles.map((v) => (modelKeyOf(v) === key ? { ...v, selected: on } : v)) }));
  /** Un critère corrigé pour tous les véhicules d'un modèle (même mécanique que le crayon : la correction est gardée dans `manual`). */
  const correctModel = (key: string, patch: Partial<OfferVehicle>) => {
    let nextKey = key;
    update((d) => ({
      ...d,
      vehicles: d.vehicles.map((v) => {
        if (modelKeyOf(v) !== key) return v;
        const nv = { ...v, ...patch, manual: { ...(v.manual ?? {}), ...patch } };
        nextKey = modelKeyOf(nv);
        return nv;
      }),
    }));
    // Marque ou modèle renommés : la fenêtre suit la liste sous son nouveau nom.
    if (nextKey !== key) setModelPopup(nextKey);
  };
  const setBrandSelected = (brand: string, on: boolean) => update((d) => ({ ...d, vehicles: d.vehicles.map((v) => ((v.brand || '—') === brand ? { ...v, selected: on } : v)) }));
  const setAllSelected = (on: boolean) => update((d) => ({ ...d, vehicles: d.vehicles.map((v) => ({ ...v, selected: on })) }));

  // ── COLONNES DE L'OFFRE EXPORTÉE ────────────────────────────────────────────
  const columns = draft?.export_columns ?? defaultExportColumns();
  const customColumns = columns.filter((c) => !c.builtin);
  const setColumns = (cols: ExportColumn[]) => update({ export_columns: cols });
  const moveColumn = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns]; [next[i], next[j]] = [next[j], next[i]]; setColumns(next);
  };
  const missingBuiltins = ALL_BUILTIN_KEYS.filter((k) => !columns.some((c) => c.builtin === k));
  const T = EXPORT_TEXT[S.lang];
  const docOf = () => ({
    title: (draft?.title || T.defaultTitle).toUpperCase(),
    subtitle: `${T.units(selectedUnits)} · ${draft?.price_rule.mode === 'none' ? T.noPrice : T.prices(S.display)} · ${T.terms}`,
    date: T.date(new Date()), vehicles: selected, showDamages: true, showSupplierPrice: false, showPrices: draft?.price_rule.mode !== 'none',
    footer: S.footer ?? T.footer,
    columns: draft?.export_columns ?? undefined,
    lang: S.lang, priceBasis: S.display, saleVat: S.saleVat, supplierHt: supHt, damagesEur: dmgEur,
  });
  const exportXlsx = () => { if (!draft) return; downloadBlob(buildOfferWorkbook(docOf()), `MC_Export_${slugFile(draft.title)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); };
  const exportPdf = async () => { if (!draft) return; setBusy('pdf'); try { downloadBlob(await buildOfferPdf(docOf()), `MC_Export_${slugFile(draft.title)}.pdf`, 'application/pdf'); } catch (e) { fail(`PDF : ${e instanceof Error ? e.message : String(e)}`); } setBusy(null); };
  const previewColumns = draft ? effectiveColumns(columns, selected, draft.price_rule.mode !== 'none', exportCtx) : [];
  const previewCell = (c: ExportColumn, v: OfferVehicle): string => {
    const x = cellValue(c, v, exportCtx);
    if (x === '' || x == null) return '—';
    if (typeof x === 'number') return c.builtin === 'km' ? fmtKm(x) : /price|damages/.test(c.builtin ?? '') ? fmtEur(x) : String(x);
    return c.builtin === 'reg' ? fmtDate(x) : x;
  };

  // ── ANALYSE (ex-« Où vendre ») ──────────────────────────────────────────────
  // Lots = véhicules RETENUS regroupés (marque, modèle, année, énergie, boîte).
  // Les relevés se lancent PAYS PAR PAYS (11/10) : bouton par colonne pays,
  // bouton par case vide, ou par lot. Chaque relevé passe par la file du worker.
  const lots = useMemo(() => (draft ? lotsOf(draft.vehicles).map((l) => applyLotCriteria(l, draft.lot_criteria?.[l.key])) : []), [draft]);

  // ── INTRA : publier dans la vitrine de l'Accueil ────────────────────────────
  const publishedHere = useMemo(() => new Map(showcase.filter((i) => draft?.id && i.offer_id === draft.id).map((i) => [i.vehicle_id, i])), [showcase, draft?.id]);
  const intraDraftOf = (v: OfferVehicle): IntraDraft | null => {
    if (!draft?.id) return null;
    const lot = lots.find((l) => l.vehicleIds.includes(v.id));
    return {
      offer_id: draft.id, offer_title: draft.title, vehicle_id: v.id, lot_key: lot?.key ?? null,
      // Dommages en euros dans la vitrine (fichier en couronnes, 13/10).
      vehicle: snapshotVehicle({ ...v, damages: dmgEur(v) }), price_ht: draft.price_rule.mode === 'none' ? null : v.sale_price ?? null,
      market: lot ? draft.market?.[lot.key] ?? null : null, note: publishedHere.get(v.id)?.note ?? '',
    };
  };
  const publishVehicles = async (list: OfferVehicle[]) => {
    if (!draft?.id) { fail("L'offre n'est pas encore enregistrée : attends la sauvegarde avant de publier."); return; }
    const items = list.map(intraDraftOf).filter((x): x is IntraDraft => !!x);
    const err = await publishToShowcase(items);
    if (err) { fail(err); return; }
    info(`${items.length} véhicule${items.length > 1 ? 's' : ''} publié${items.length > 1 ? 's' : ''} dans les bonnes affaires de l'Accueil (véhicule, prix MC Export HT et relevé de marché photographiés maintenant).`);
    void reloadShowcase();
  };
  const unpublishVehicles = async (ids: string[]) => {
    const err = await unpublishFromShowcase(ids);
    if (err) { fail(err); return; }
    void reloadShowcase();
  };
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
  /** État de chaque case modèle × pays pendant un relevé (11/10 : « savoir ce qu'on relève »). */
  const [cellState, setCellState] = useState<Record<string, 'queued' | 'running'>>({});
  const cellKey = (lot: OfferLot, country: string) => `${lot.key}|${country}`;
  // Cache des URLs : lot + critères (le libellé les porte tous) + PAYS.
  const targetKey = (lot: OfferLot, country: string) => `${lot.key}#${lot.label}#${country}`;
  const ensureTargets = async (lot: OfferLot, countries: string[]): Promise<LotTarget[]> => {
    const missing = countries.filter((c) => !targetsRef.current[targetKey(lot, c)]);
    if (missing.length) {
      const t = await lotTargets(lot, missing);
      const next = { ...targetsRef.current };
      for (const c of missing) next[targetKey(lot, c)] = t.filter((x) => x.country === c);
      targetsRef.current = next;
      setTargets(next);
    }
    return countries.flatMap((c) => targetsRef.current[targetKey(lot, c)] ?? []);
  };
  const toggleTargets = async (lot: OfferLot) => {
    if (targetsOpen === lot.key) { setTargetsOpen(null); return; }
    setTargetsOpen(lot.key);
    await ensureTargets(lot, draft?.countries ?? []);
  };
  /** Verrou synchrone : un double clic lançait deux relevés identiques (logs du 12/10 : six jobs Tonale NL à la même seconde). */
  const surveyLock = useRef(false);
  const runSurvey = async (list: OfferLot[], countries: string[]) => {
    if (surveyLock.current) return;
    surveyLock.current = true;
    try { await runSurveyInner(list, countries); } finally { surveyLock.current = false; }
  };
  const runSurveyInner = async (list: OfferLot[], countries: string[]) => {
    if (!draft?.id) { info('Offre pas encore enregistrée — réessaie dans une seconde.'); return; }
    if (countries.length === 0) { info('Ajoute au moins un pays à relever.'); return; }
    const offerId = draft.id;
    const plan: Array<{ lot: OfferLot; t: LotTarget }> = [];
    const skipped: string[] = [];
    setSurvey({ done: 0, total: 0, current: 'préparation des URLs…', errors: [] });
    for (const lot of list) {
      const ts = await ensureTargets(lot, countries);
      for (const t of ts) {
        if (t.url) plan.push({ lot, t });
        else skipped.push(`${lot.label} · ${t.country} ${SITE_LABEL(t.site)} : pas d'URL${t.warnings[0] ? ` (${t.warnings[0]})` : ''}`);
      }
    }
    if (plan.length === 0) { setSurvey(null); info(`Aucune URL à relever. ${skipped[0] ?? ''}`.trim()); return; }
    if (plan.length > 30 && !confirm(`${plan.length} recherches vont partir dans la file du worker (compte ≈ ${Math.ceil(plan.length / 2)} min au minimum). Continuer ?`)) { setSurvey(null); return; }
    cancelSurvey.current = false;
    setSurvey({ done: 0, total: plan.length, current: '', errors: skipped });
    const remaining = new Map<string, number>();
    for (const p of plan) remaining.set(cellKey(p.lot, p.t.country), (remaining.get(cellKey(p.lot, p.t.country)) ?? 0) + 1);
    setCellState(Object.fromEntries([...remaining.keys()].map((k) => [k, 'queued' as const])));
    const byLot = new Map<string, Array<{ lot: OfferLot; t: LotTarget }>>();
    for (const p of plan) byLot.set(p.lot.key, [...(byLot.get(p.lot.key) ?? []), p]);
    let done = 0;
    for (const items of byLot.values()) {
      if (cancelSurvey.current) break;
      setSurvey((s) => s && { ...s, current: `${items[0].lot.brand} ${items[0].lot.model} · ${[...new Set(items.map((x) => countryLabel(x.t.country)))].join(', ')}` });
      setCellState((cs) => { const next = { ...cs }; for (const it of items) next[cellKey(it.lot, it.t.country)] = 'running'; return next; });
      await Promise.all(items.map(async ({ lot, t }) => {
        const url = t.url as string;
        let r: SiteResult;
        try { const jobId = await startLotJob(url, lot); r = await awaitLotJob(jobId, t.site, url, { model: lot.model, strict: t.brandPageOnly, trim: lot.trim, powerMin: lot.powerMin }); }
        catch (e) { r = { site: t.site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: e instanceof Error ? e.message : String(e) }; }
        done += 1;
        const ck = cellKey(lot, t.country);
        remaining.set(ck, (remaining.get(ck) ?? 1) - 1);
        if ((remaining.get(ck) ?? 0) <= 0) setCellState((cs) => { const next = { ...cs }; delete next[ck]; return next; });
        setSurvey((s) => s && { ...s, done, errors: r.error ? [...s.errors, `${lot.label} · ${t.country} ${SITE_LABEL(t.site)} : ${r.error}`] : s.errors });
        update((d) => (d.id !== offerId ? d : {
          ...d,
          market: { ...(d.market ?? {}), [lot.key]: { ...(d.market?.[lot.key] ?? {}), [t.country]: mergeCountry(d.market?.[lot.key]?.[t.country], t.country, r) } },
        }));
      }));
    }
    setCellState({});
    setSurvey((s) => s && { ...s, current: cancelSurvey.current ? 'arrêté' : 'terminé', done: cancelSurvey.current ? s.total : s.done });
  };
  const lastSurveyAt = useMemo(() => {
    const dates = Object.values(draft?.market ?? {}).flatMap((byCountry) => Object.values(byCountry).map((c) => c.at)).sort();
    return dates.length ? new Date(dates[dates.length - 1]) : null;
  }, [draft]);
  const surveyedIn = (c: string) => lots.filter((l) => draft?.market?.[l.key]?.[c]).length;
  /** Critères de recherche d'un modèle, en puces lisibles (année, énergie, boîte, finition, puissance, km). */
  const lotChips = (l: OfferLot): string[] => [
    l.yearFrom != null && l.yearTo != null && l.yearFrom !== l.yearTo ? `${l.yearFrom}–${l.yearTo}` : String(l.yearFrom ?? l.yearTo ?? ''),
    l.fuel ? l.fuel.toLowerCase() : '',
    l.gearbox === 'AUTOMATIQUE' ? 'auto' : l.gearbox === 'MANUELLE' ? 'manuelle' : '',
    l.trim ? `finition ${l.trim.toUpperCase()}` : '',
    l.powerMin ? `≥ ${l.powerMin} ch` : '',
    l.kmMax ? `≤ ${l.kmMax.toLocaleString('fr-FR')} km` : '',
  ].filter(Boolean);

  /** Critères de recherche de marché d'un lot — le même formulaire dans l'Analyse et dans l'Intra
   *  (13/10, Channing : « modifier les critères des études de marché présents avec les véhicules »). */
  const lotCriteriaForm = (lot: OfferLot) => (
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
        <label className="text-slate-600" title="Chaque mot doit figurer dans le titre ou la version de l'annonce (« GT » écarte les GT-Line)">Finition
          <input value={lot.trim ?? ''} placeholder="GT, Sportline…" onChange={(e) => setLotCriteria(lot, { trim: e.target.value })} className="block mt-0.5 w-32 px-2 py-1 rounded border border-slate-300 bg-white" />
        </label>
        <label className="text-slate-600" title="Posée dans l'URL des sites qui la filtrent, et vérifiée sur chaque annonce dont la puissance est lue">Puissance mini (ch)
          <input type="number" step={5} value={lot.powerMin ?? ''} onChange={(e) => setLotCriteria(lot, { powerMin: e.target.value === '' ? null : Number(e.target.value) })} className="block mt-0.5 w-24 px-2 py-1 rounded border border-slate-300 bg-white" />
        </label>
        {lot.adjusted && <button onClick={() => setLotCriteria(lot, null)} className="text-slate-500 hover:underline pb-1.5">Rétablir les critères du fichier</button>}
        <span className="text-[11px] text-slate-500 pb-1.5 basis-full">Ces critères ne changent que la recherche de marché (pas l'offre exportée). Un changement efface le relevé du lot ; vérifie les recherches puis relance.</span>
      </div>
  );

  // ── RENDU ───────────────────────────────────────────────────────────────────
  const filteredOffers = offers.filter((o) => !listQuery.trim() || `${o.title} ${o.supplier}`.toLowerCase().includes(listQuery.trim().toLowerCase()));
  const uploadButton = (compact = false) => (
    <button onClick={() => fileRef.current?.click()} disabled={busy === 'lecture'} className={`flex items-center justify-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${compact ? 'px-3 py-2' : 'w-full px-4 py-2.5'}`}>
      {busy === 'lecture' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Nouvelle offre
    </button>
  );
  const tabButton = (id: View, label: string, Icon: typeof BarChart3, badge: string) => (
    <button onClick={() => setView(id)} role="tab" aria-selected={view === id}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${view === id ? 'border-brand-ocean text-brand-encre font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
      <Icon className="w-4 h-4" /> {label} <span className={`text-xs px-1.5 py-0.5 rounded-full ${view === id ? 'bg-blue-50 text-brand-encre' : 'bg-slate-100 text-slate-500'}`}>{badge}</span>
    </button>
  );

  /** Tableau des véhicules (corrections au crayon, prix, colonnes libres) — dans la fenêtre d'un modèle ou en liste complète. */
  const vehicleTable = (list: OfferVehicle[]) => {
    if (!draft) return null;
    return (
      <div className="overflow-x-auto">
        <table className="text-xs w-full min-w-[1100px]">
          <thead><tr className="text-left text-slate-400 border-b border-slate-100">
            <th className="py-1.5 px-3"><span className="sr-only">Retenu</span></th><th className="py-1.5 pr-3">Véhicule</th><th className="py-1.5 pr-3 text-right">Qté</th><th className="py-1.5 pr-3">Motorisation · version</th><th className="py-1.5 pr-3">Immat.</th>
            <th className="py-1.5 pr-3 text-right">Km</th><th className="py-1.5 pr-3">Énergie · boîte</th><th className="py-1.5 pr-3 text-right">Ch</th>
            <th className="py-1.5 pr-3 text-right">Dommages</th><th className="py-1.5 pr-3">TVA</th><th className="py-1.5 pr-3 text-right">Fournisseur {B}</th><th className="py-1.5 pr-3 text-right">MC Export {B}</th>
            {customColumns.map((c) => <th key={c.id} className="py-1.5 pr-3 text-brand-encre">{c.label}</th>)}
            <th className="py-1.5 pr-3">Rapport</th><th className="py-1.5 pr-3"><span className="sr-only">Corriger</span></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((v) => {
              const base = supplierShown(v, S);
              const corrected = Object.keys(v.manual ?? {}).length > 0;
              return (
                <Fragment key={v.id}>
                  <tr className={v.selected ? '' : 'opacity-50'}>
                    <td className="py-1.5 px-3"><input type="checkbox" aria-label={`Retenir ${v.brand} ${v.model}`} checked={v.selected} onChange={(e) => setVehicle(v.id, { selected: e.target.checked })} /></td>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><span className="font-medium text-slate-800">{v.brand} {v.model}</span>{corrected && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-blue-50 text-brand-encre border border-blue-200" title={`Corrigé à la main : ${Object.keys(v.manual ?? {}).join(', ')}`}>corrigé</span>}{v.vin && <span className="block text-[10px] text-slate-400">{v.vin}</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums"><input type="number" min={1} aria-label="Quantité" value={qtyOf(v)} onChange={(e) => correctVehicle(v.id, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className={`w-14 px-1.5 py-1 rounded border text-right tabular-nums ${qtyOf(v) > 1 ? 'border-slate-300 font-semibold text-slate-800' : 'border-slate-200 text-slate-400'}`} /></td>
                    <td className="py-1.5 pr-3 max-w-[260px]"><span className="block truncate text-slate-700" title={v.engine ?? ''}>{v.engine || '—'}</span><span className="block truncate text-[10px] text-slate-500" title={`${v.version}${v.color ? ` · couleur du fichier : ${v.color}` : ''}`}>{v.version}{v.color ? ` · ${colorLabel(v.color, S.lang)}` : ''}</span></td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600" title={!v.reg_date && v.year != null ? 'Année seule : le fichier ne donne pas la date' : ''}>{v.reg_date ? fmtDate(v.reg_date) : v.year ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">{fmtKm(v.km)}</td>
                    <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap">{v.fuel ?? '—'} · {v.gearbox === 'AUTOMATIQUE' ? 'Auto' : v.gearbox === 'MANUELLE' ? 'Manuelle' : v.gearbox ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{v.power_ch ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={v.damages != null && S.supplierCurrency !== 'EUR' ? `Fichier : ${fileMoney(v.damages, S)}` : ''}>{fmtEur(dmgEur(v))}</td>
                    <td className="py-1.5 pr-3">{v.vat_recoverable == null ? '—' : v.vat_recoverable ? <span className="text-emerald-700">récup.</span> : <span className="text-amber-700">marge</span>}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={[v.price_ttc != null ? `Fichier TTC : ${fileMoney(v.price_ttc, S)}` : '', v.price_ht != null ? `Fichier HT : ${fileMoney(v.price_ht, S)}` : '', S.supplierCurrency !== 'EUR' ? fxRateLabel(S) : ''].filter(Boolean).join(' · ')}>{fmtEur(base)}</td>
                    <td className="py-1.5 pr-3 text-right"><input type="number" aria-label={`Prix MC Export ${B}`} value={toShown(v.sale_price, S) ?? ''} onChange={(e) => setVehicle(v.id, { sale_price: fromShown(e.target.value === '' ? null : Number(e.target.value), S) })} className="w-24 px-2 py-1 rounded border border-slate-300 text-right tabular-nums font-semibold text-brand-encre" /></td>
                    {customColumns.map((c) => (
                      <td key={c.id} className="py-1.5 pr-3"><input aria-label={`${c.label} — ${v.brand} ${v.model}`} value={v.custom?.[c.id] ?? ''} onChange={(e) => setCustomValue(v.id, c.id, e.target.value)} className="w-28 px-2 py-1 rounded border border-blue-200 bg-blue-50/40" /></td>
                    ))}
                    <td className="py-1.5 pr-3">{v.report_url ? <a href={v.report_url} target="_blank" rel="noreferrer" className="text-brand-ocean inline-flex" aria-label="Ouvrir le rapport"><ExternalLink className="w-3.5 h-3.5" /></a> : '—'}</td>
                    <td className="py-1.5 pr-3"><button onClick={() => setEditVehicle(editVehicle === v.id ? null : v.id)} aria-label={`Corriger ${v.brand} ${v.model}`} aria-expanded={editVehicle === v.id} className={`p-1 rounded ${editVehicle === v.id ? 'bg-blue-100 text-brand-encre' : 'text-slate-400 hover:text-brand-ocean hover:bg-slate-100'}`}><Pencil className="w-3.5 h-3.5" /></button></td>
                  </tr>
                  {editVehicle === v.id && (
                    <tr className="bg-blue-50/40">
                      <td colSpan={15 + customColumns.length} className="px-3 py-3">
                        <VehicleEditor v={v} onChange={(patch) => correctVehicle(v.id, patch)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={15 + customColumns.length} className="py-6 text-center text-slate-400">Aucun véhicule dans cette offre.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  const offerList = (inDrawer: boolean) => (
    <>
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-slate-900">Offres <span className="text-slate-400 font-normal">{offers.length}</span></span>
          {inDrawer && <button onClick={() => setListOpen(false)} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="w-4 h-4" /></button>}
        </div>
        {uploadButton()}
        <p className="text-[11px] text-slate-500 text-center">Excel, CSV, ou plusieurs PDF à la fois</p>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm">
          <Search className="w-4 h-4 text-slate-400" />
          <span className="sr-only">Chercher une offre</span>
          <input value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder="Chercher une offre, un fournisseur…" className="flex-1 outline-none bg-transparent" />
        </label>
      </div>
      {listError && <p className="m-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{listError}</p>}
      <div className={`divide-y divide-slate-100 ${inDrawer ? 'flex-1 overflow-y-auto' : 'max-h-[70vh] overflow-y-auto'}`}>
        {filteredOffers.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400 text-center">{offers.length ? 'Aucune offre ne correspond.' : 'Aucune offre. Dépose un fichier fournisseur pour créer la première.'}</p>
        ) : filteredOffers.map((o) => {
          const active = draft?.id === o.id;
          const n = (o.vehicles ?? []).length, sel = (o.vehicles ?? []).filter((v) => v.selected).length;
          return (
            <div key={o.id} className={`group flex items-start gap-2 px-4 py-3 ${active ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}>
              <button onClick={() => open(o)} className="min-w-0 flex-1 text-left">
                <span className={`block text-sm truncate ${active ? 'font-semibold text-brand-encre' : 'font-medium text-slate-800'}`}>{o.title || 'Sans titre'}</span>
                <span className="block text-xs text-slate-500 truncate">{o.supplier || 'fournisseur ?'} · {sel}/{n} véh. · {new Date(o.updated_at).toLocaleDateString('fr-FR')}</span>
                <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_CLASS[o.status] ?? STATUS_CLASS.draft}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
              </button>
              {o.user_id === userId && (
                <button onClick={() => void remove(o)} className="p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Supprimer ${o.title || 'cette offre'}`}><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" multiple className="hidden" onChange={(e) => { const l = e.target.files; if (l && l.length) void onFiles(l); e.currentTarget.value = ''; }} />

      {/* ── Panneau des offres (s'ouvre au besoin, l'offre garde la largeur) ──── */}
      {listOpen && draft && (
        <div className="fixed inset-0 z-40 flex">
          <button aria-label="Fermer la liste des offres" className="absolute inset-0 bg-slate-900/30" onClick={() => setListOpen(false)} />
          <aside aria-label="Offres" className="relative w-[340px] max-w-[90vw] h-full bg-white shadow-2xl flex flex-col">
            {offerList(true)}
          </aside>
        </div>
      )}

      {/* ── Paramètres de l'offre ────────────────────────────────────────────── */}
      {settingsOpen && draft && (() => {
        const sample = draft.vehicles.find((v) => v.price_ttc != null || v.price_ht != null);
        const sampleHt = sample ? supHt(sample) : null;
        const rawLabel = sample ? (sample.price_ttc != null ? `${fileMoney(sample.price_ttc, S)} (colonne TTC)` : `${fileMoney(sample.price_ht!, S)} (colonne HT)`) : '';
        const kmSample = draft.vehicles.find((v) => v.km != null);
        const radio = (on: boolean) => `flex-1 px-3 py-2 rounded-lg border text-sm text-left ${on ? 'border-brand-ocean bg-blue-50 text-brand-encre font-semibold' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`;
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-10">
            <button aria-label="Fermer les paramètres" className="absolute inset-0 bg-slate-900/30" onClick={() => setSettingsOpen(false)} />
            <div role="dialog" aria-modal="true" aria-labelledby="offer-settings-title" className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 id="offer-settings-title" className="text-lg font-semibold text-slate-900">Paramètres de l'offre</h2>
                <button onClick={() => setSettingsOpen(false)} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
              </div>
              {notSaved.includes('settings') && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Paramètres appliqués mais pas encore gardés en base : SQL du 11/10 (offres_parametres) à coller.</p>}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">1. Prix du fichier fournisseur</h3>
                {detection && (
                  <div className={`rounded-lg border px-3 py-2 text-xs ${detection.doubts.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                    <p className="font-semibold">{detection.doubts.length ? `Détecté dans le fichier — ${detection.doubts.length} point${detection.doubts.length > 1 ? 's' : ''} supposé${detection.doubts.length > 1 ? 's' : ''}` : 'Détecté dans le fichier — rien de supposé'}</p>
                    {detection.facts.map((f) => <p key={f}>✓ {f}</p>)}
                    {detection.doubts.map((d) => <p key={d}>⚠ {d}</p>)}
                    {detection.doubts.length > 0 && draft.settings?.priceCheckAck === detection.signature && <p className="mt-1 text-emerald-800">Validé par l'équipe.</p>}
                  </div>
                )}
                <div className="flex gap-2" role="group" aria-label="Prix du fichier fournisseur">
                  <button onClick={() => updateSettings({ supplierBasis: 'auto' })} aria-pressed={S.supplierBasis === 'auto'} className={radio(S.supplierBasis === 'auto')}>Comme lus<span className="block text-[11px] font-normal text-slate-500">selon l'en-tête de colonne</span></button>
                  <button onClick={() => updateSettings({ supplierBasis: 'ttc' })} aria-pressed={S.supplierBasis === 'ttc'} className={radio(S.supplierBasis === 'ttc')}>TTC<span className="block text-[11px] font-normal text-slate-500">la TVA est retirée</span></button>
                  <button onClick={() => updateSettings({ supplierBasis: 'ht' })} aria-pressed={S.supplierBasis === 'ht'} className={radio(S.supplierBasis === 'ht')}>HT<span className="block text-[11px] font-normal text-slate-500">pris tels quels</span></button>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">TVA du fournisseur
                  <select value={S.supplierVat ?? ''} onChange={(e) => updateSettings({ supplierVat: e.target.value === '' ? null : Number(e.target.value) })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                    <option value="">Lue dans le fichier ({Math.round((sample ? supplierVatOf(sample, { ...S, supplierVat: null }) : 0.2) * 100)} %)</option>
                    {VAT_CHOICES.map((c) => <option key={c.rate} value={c.rate}>{c.label}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">Devise du fichier
                  <select value={S.supplierCurrency} onChange={(e) => setCurrency(e.target.value as FileCurrency)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                    {FILE_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                  {S.supplierCurrency !== 'EUR' && (
                    <span className="text-xs text-slate-500">{fxRateLabel(S)}
                      {todayFxRate(S.supplierCurrency) != null && todayFxRate(S.supplierCurrency) !== S.supplierFxRate && <button onClick={() => setCurrency(S.supplierCurrency)} className="ml-2 text-brand-ocean hover:underline">Prendre le taux du jour ({currentFx().date.split('-').reverse().join('/')})</button>}
                    </span>
                  )}
                </label>
                {sample && <p className="text-xs text-slate-500">Exemple, {sample.brand} {sample.model} : {rawLabel} → <strong className="text-slate-700">{fmtEur(sampleHt)} HT</strong> fournisseur{sample.vat_recoverable === false ? ' (régime de la marge : pas de TVA retirée)' : ''}.</p>}
                <p className="text-[11px] text-slate-500">Changer ces réglages recalcule les prix MC Export avec la règle de prix (onglet Export). Le taux de change est figé à l'import : les prix ne bougent pas d'un jour à l'autre.</p>
                {draft.layout !== 'pdf' && draft.mappings.some((m) => m.field === 'km') && (
                  <div className="flex items-center gap-2 text-sm text-slate-700 pt-1">Unité des kilométrages
                    <div className="flex gap-2" role="group" aria-label="Unité des kilométrages">
                      <button onClick={() => updateSettings({ kmUnit: 'km' })} aria-pressed={(S.kmUnit ?? 'km') === 'km'} className={radio((S.kmUnit ?? 'km') === 'km')}>km</button>
                      <button onClick={() => updateSettings({ kmUnit: 'mil' })} aria-pressed={S.kmUnit === 'mil'} className={radio(S.kmUnit === 'mil')}>mil suédois<span className="block text-[11px] font-normal text-slate-500">1 mil = 10 km</span></button>
                    </div>
                    {kmSample && <span className="text-xs text-slate-500">{S.kmUnit === 'mil' ? `ex. ${Math.round(kmSample.km! / 10).toLocaleString('fr-FR')} dans le fichier → ${fmtKm(kmSample.km)}` : `ex. ${fmtKm(kmSample.km)}`}</span>}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">2. Affichage de nos prix</h3>
                <div className="flex gap-2" role="group" aria-label="Affichage de nos prix">
                  <button onClick={() => updateSettings({ display: 'ht' })} aria-pressed={S.display === 'ht'} className={radio(S.display === 'ht')}>HT<span className="block text-[11px] font-normal text-slate-500">hors taxes</span></button>
                  <button onClick={() => updateSettings({ display: 'ttc' })} aria-pressed={S.display === 'ttc'} className={radio(S.display === 'ttc')}>TTC<span className="block text-[11px] font-normal text-slate-500">avec notre TVA</span></button>
                </div>
                {S.display === 'ttc' && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">Notre TVA
                    <select value={S.saleVat} onChange={(e) => updateSettings({ saleVat: Number(e.target.value) })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                      {VAT_CHOICES.map((c) => <option key={c.rate} value={c.rate}>{c.label}</option>)}
                    </select>
                  </label>
                )}
                <p className="text-xs text-slate-500">S'applique aux tableaux, aux colonnes « Notre » de l'Analyse et à l'export. Le verdict de l'Analyse, lui, compare toujours notre HT + la TVA du pays de revente au prix affiché (TTC). La règle de prix reste calculée en HT.</p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">3. Offre exportée</h3>
                <div className="flex gap-2" role="group" aria-label="Langue de l'export">
                  <button onClick={() => updateSettings({ lang: 'fr' })} aria-pressed={S.lang === 'fr'} className={radio(S.lang === 'fr')}>Français</button>
                  <button onClick={() => updateSettings({ lang: 'en' })} aria-pressed={S.lang === 'en'} className={radio(S.lang === 'en')}>English</button>
                </div>
                <label className="block text-sm text-slate-700">Pied de page
                  <textarea value={draft.settings?.footer ?? ''} onChange={(e) => updateSettings({ footer: e.target.value })} rows={2} placeholder={T.footer} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                </label>
                <p className="text-[11px] text-slate-500">Vide = texte par défaut de la langue. En anglais, les en-têtes non renommés, énergies et boîtes sont traduits ; les colonnes renommées gardent ton libellé.</p>
              </section>

              <div className="flex justify-end">
                <button onClick={() => setSettingsOpen(false)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-ocean text-white text-sm"><Check className="w-4 h-4" /> Terminé</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Fenêtre des notes ───────────────────────────────────────────────── */}
      {notesOpen && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Fermer les notes" className="absolute inset-0 bg-slate-900/30" onClick={() => setNotesOpen(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="offer-notes-title" className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="offer-notes-title" className="text-base font-semibold text-slate-900">Notes internes</h2>
              <button onClick={() => setNotesOpen(false)} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Jamais exportées. Contact fournisseur, délai, conditions… Enregistrées automatiquement.</p>
            <textarea autoFocus value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={8} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Contact fournisseur, délai, conditions…" />
          </div>
        </div>
      )}

      {!draft ? (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Offres fournisseur</h1>
            <p className="text-sm text-slate-600 mt-1">Une liste fournisseur déposée devient une offre MC Export : lue, analysée pays par pays, exportée à nos prix. Tout s'enregistre tout seul.</p>
          </div>
          {msg && <p className={`text-sm rounded-lg px-3 py-2 border ${msg.tone === 'error' ? 'text-red-700 bg-red-50 border-red-200' : 'text-blue-900 bg-blue-50 border-blue-200'}`}>{msg.text}</p>}
          <div className="max-w-xl bg-white rounded-xl border border-slate-200 shadow-sm">{offerList(false)}</div>
        </div>
      ) : (
        <>
          {/* ── En-tête de l'offre ──────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <button onClick={() => setListOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50" title="Toutes les offres">
                <PanelLeftOpen className="w-4 h-4" /> Offres <span className="text-slate-400">{offers.length}</span>
              </button>
              <div className="flex-1 min-w-[260px]">
                <label className="sr-only" htmlFor="offer-title">Titre de l'offre</label>
                <input id="offer-title" value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="OPEL ASTRA — SÉLECTION PROFESSIONNELLE"
                  className="w-full text-xl font-bold text-slate-900 bg-transparent rounded-lg px-2 py-1 -mx-2 hover:bg-slate-50 focus:bg-slate-50 outline-none" />
                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mt-0.5">
                  <label className="flex items-center gap-1">Fournisseur
                    <input value={draft.supplier} onChange={(e) => update({ supplier: e.target.value })} style={{ width: `${Math.min(40, Math.max(8, draft.supplier.length + 2))}ch` }} className="px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 focus:border-slate-300 text-slate-800 font-medium outline-none" />
                  </label>
                  <span aria-hidden="true">·</span>
                  {draft.source_files?.length
                    ? draft.source_files.map((f) => <button key={f.path} type="button" onClick={() => void openSourceFile(f)} className="text-brand-ocean hover:underline" title="Ouvrir le fichier déposé">{f.name}</button>)
                    : <span>{draft.source_filename || 'aucun fichier'}</span>}
                  <span aria-hidden="true">·</span>
                  <span>{unitsLabel(draft.vehicles.length, totalUnits)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 flex items-center gap-1.5 min-w-[110px]">
                  {saveState.kind === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enregistrement…</>}
                  {saveState.kind === 'saved' && <><Check className="w-3.5 h-3.5 text-emerald-600" /> Enregistré à {saveState.at}</>}
                  {saveState.kind === 'error' && <span className="text-red-600 flex items-center gap-1"><CloudOff className="w-3.5 h-3.5" /> {saveState.text}</span>}
                  {saveState.kind === 'idle' && draft.id && <><Check className="w-3.5 h-3.5 text-slate-400" /> Enregistrée</>}
                </span>
                <div role="group" aria-label="Statut de l'offre" className="flex rounded-lg bg-slate-100 p-0.5">
                  {(['draft', 'sent', 'closed'] as const).map((s) => (
                    <button key={s} onClick={() => update({ status: s })} aria-pressed={draft.status === s}
                      className={`px-2.5 py-1 rounded-md text-xs capitalize ${draft.status === s ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
                <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50" title="Prix HT / TTC, TVA, langue de l'export">
                  <Settings className="w-4 h-4" /> Paramètres <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{B}{S.lang === 'en' ? ' · EN' : ''}</span>
                  {pendingDoubts.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">⚠ {pendingDoubts.length}</span>}
                </button>
                <button onClick={() => setNotesOpen(true)} className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
                  <StickyNote className="w-4 h-4" /> Notes
                  {draft.notes.trim() && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white" aria-label="Notes présentes" />}
                </button>
                <button onClick={exportXlsx} disabled={selected.length === 0} className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
                <button onClick={() => void exportPdf()} disabled={selected.length === 0 || busy === 'pdf'} className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">{busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF</button>
              </div>
            </div>
            <div role="tablist" aria-label="Vues de l'offre" className="flex gap-1 border-b border-slate-200 -mx-4 px-4">
              {tabButton('selection', 'Sélection', ListChecks, `${selectedUnits}/${totalUnits}`)}
              {tabButton('analyse', 'Analyse', BarChart3, `${lotsOf(draft.vehicles).length} lot${lotsOf(draft.vehicles).length > 1 ? 's' : ''}`)}
              {tabButton('export', 'Export', Columns3, `${previewColumns.length} col.`)}
              {tabButton('intra', 'Intra', Megaphone, `${publishedHere.size} publié${publishedHere.size > 1 ? 's' : ''}`)}
            </div>
          </div>

          {pendingDoubts.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <p className="font-semibold">Prix du fichier à vérifier avant d'analyser ou d'envoyer l'offre</p>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">{pendingDoubts.map((d) => <li key={d}>{d}</li>)}</ul>
                  {detection && detection.facts.length > 0 && <p className="mt-1 text-xs text-amber-800">Lu dans le fichier : {detection.facts.join(' ')}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSettingsOpen(true)} className="px-3 py-1.5 rounded-lg border border-amber-400 bg-white text-amber-900 hover:bg-amber-100">Ouvrir les paramètres</button>
                  <button onClick={() => detection && updateSettings({ priceCheckAck: detection.signature })} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">C'est vérifié</button>
                </div>
              </div>
            </div>
          )}

          {msg && (
            <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${msg.tone === 'error' ? 'text-red-700 bg-red-50 border-red-200' : 'text-blue-900 bg-blue-50 border-blue-200'}`}>
              <span className="flex-1">{msg.text}</span>
              <button onClick={() => setMsg(null)} aria-label="Fermer le message" className="p-0.5 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* ══ SÉLECTION ══════════════════════════════════════════════════════ */}
          {view === 'selection' && (
            <div className="space-y-4">
              {/* Choix des véhicules : par modèle OU liste complète (bascule, 11/10) */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                  <div role="group" aria-label="Affichage des véhicules" className="flex rounded-lg bg-slate-100 p-0.5">
                    <button onClick={() => setLayout('models')} aria-pressed={selectionLayout === 'models'} className={`px-3 py-1.5 rounded-md text-sm ${selectionLayout === 'models' ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}>Par modèle</button>
                    <button onClick={() => setLayout('list')} aria-pressed={selectionLayout === 'list'} className={`px-3 py-1.5 rounded-md text-sm ${selectionLayout === 'list' ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}>Liste complète</button>
                  </div>
                  <span className="text-xs text-slate-500">{selectedUnits} / {totalUnits} véhicules retenus · {selectionLayout === 'models' ? 'case = retenir tout le modèle · nom = ouvrir ses véhicules' : 'crayon en bout de ligne = corriger une valeur mal lue'}</span>
                  <label className="ml-auto flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm">
                    <Search className="w-3.5 h-3.5 text-slate-400" />
                    <span className="sr-only">{selectionLayout === 'models' ? 'Chercher un modèle' : 'Chercher un véhicule'}</span>
                    <input value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder={selectionLayout === 'models' ? 'Chercher un modèle' : 'Modèle, VIN, plaque, couleur…'} className="w-48 outline-none bg-transparent" />
                  </label>
                  <button onClick={() => setAllSelected(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Tout retenir</button>
                  <button onClick={() => setAllSelected(false)} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Aucun</button>
                  <span className="flex items-center gap-3 text-xs">
                    {parsed?.warnings.length ? (
                      <details className="relative">
                        <summary className="cursor-pointer text-amber-700">{parsed.warnings.length} avertissement{parsed.warnings.length > 1 ? 's' : ''} de lecture</summary>
                        <div className="absolute right-0 z-10 mt-1 w-96 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg p-3 space-y-1">
                          {parsed.warnings.map((w, i) => <p key={i} className="text-amber-800">{w}</p>)}
                        </div>
                      </details>
                    ) : null}
                    {draft.source_grid && <button onClick={rereadFile} className="text-brand-ocean hover:underline" title="Relit le fichier conservé avec les règles de lecture actuelles — sélection, prix et corrections gardés">Relire le fichier</button>}
                  </span>
                </div>
                {selectionLayout === 'models' ? (
                  <>
                {brandGroups.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-400 text-center">{draft.vehicles.length ? 'Aucun modèle ne correspond.' : 'Aucun véhicule dans cette offre.'}</p>
                ) : (
                  <div className="p-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                    {brandGroups.map((b) => {
                      const all = b.selected === b.units, none = b.selected === 0;
                      return (
                        <div key={b.brand} className={`rounded-xl border ${none ? 'border-slate-200' : 'border-blue-200'} overflow-hidden`}>
                          <label className={`flex items-center gap-2 px-3 py-2 ${none ? 'bg-slate-50' : 'bg-blue-50/60'}`}>
                            <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && !none; }} onChange={(e) => setBrandSelected(b.brand, e.target.checked)} />
                            <span className="text-sm font-semibold text-slate-900 flex-1">{b.brand}</span>
                            <span className="text-xs tabular-nums text-slate-500">{b.selected}/{b.units}</span>
                          </label>
                          <ul className="divide-y divide-slate-100">
                            {b.models.map((m) => {
                              const mAll = m.selected === m.units, mNone = m.selected === 0;
                              return (
                                <li key={m.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                                  <input type="checkbox" aria-label={`Retenir ${m.key}`} checked={mAll} ref={(el) => { if (el) el.indeterminate = !mAll && !mNone; }} onChange={(e) => setModelSelected(m.key, e.target.checked)} />
                                  <button onClick={() => { setEditVehicle(null); setModelPopup(m.key); }} className={`flex-1 min-w-0 text-left ${mNone ? 'text-slate-500' : 'text-slate-900 font-medium'}`} title="Voir, choisir et corriger les véhicules de ce modèle">
                                    <span className="block text-sm truncate">{m.model}</span>
                                    <span className="block text-[11px] text-slate-500 font-normal tabular-nums">
                                      {m.kmN ? `≈ ${fmtKm(m.kmSum / m.kmN)}` : 'km ?'} · {m.priceN ? `≈ ${fmtEur(m.priceSum / m.priceN)} ${B}` : 'prix ?'}
                                    </span>
                                  </button>
                                  <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-full ${mNone ? 'bg-slate-100 text-slate-500' : mAll ? 'bg-brand-ocean text-white' : 'bg-blue-100 text-brand-encre'}`}>{mNone || mAll ? m.units : `${m.selected}/${m.units}`}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
                  </>
                ) : vehicleTable(listVehicles)}
              </div>

              {/* Fichier d'origine, brut */}
              <SourceViewer grid={draft.source_grid ?? null} files={draft.source_files ?? []} filename={draft.source_filename} />

              {/* Fenêtre d'un modèle : ses véhicules au même endroit que le choix des modèles */}
              {modelPopup && (() => {
                const list = draft.vehicles.filter((v) => modelKeyOf(v) === modelPopup);
                const units = list.reduce((a, v) => a + qtyOf(v), 0);
                const sel = list.filter((v) => v.selected).reduce((a, v) => a + qtyOf(v), 0);
                return (
                  <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8">
                    <button aria-label="Fermer" className="absolute inset-0 bg-slate-900/40" onClick={() => setModelPopup(null)} />
                    <div role="dialog" aria-modal="true" aria-labelledby="model-popup-title" className="relative w-full max-w-[1400px] max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl">
                      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                        <h2 id="model-popup-title" className="text-lg font-bold text-slate-900">{modelPopup}</h2>
                        <span className="text-sm text-slate-500">{sel} / {units} véhicule{units > 1 ? 's' : ''} retenu{sel > 1 ? 's' : ''}</span>
                        <button onClick={() => setModelSelected(modelPopup, true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Tout retenir</button>
                        <button onClick={() => setModelSelected(modelPopup, false)} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Aucun</button>
                        <button onClick={() => setBulk((b) => (b ? null : { field: 'model', value: list[0]?.model ?? '' }))} className={`text-xs px-2.5 py-1.5 rounded-lg border ${bulk ? 'border-brand-ocean text-brand-ocean bg-sky-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`} title="Corriger un critère d'un coup pour tous les véhicules de cette liste (marque, modèle, version, énergie, boîte…)">
                          <Pencil className="inline w-3 h-3 -mt-0.5 mr-1" />Modifier pour tous ({list.length})
                        </button>
                        <button onClick={() => { setBulk(null); setModelPopup(null); }} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean text-white text-sm"><Check className="w-4 h-4" /> Terminé</button>
                      </div>
                      {bulk && (
                        <BulkEditor
                          bulk={bulk} count={list.length} sample={list[0]}
                          onChange={setBulk}
                          onApply={(patch) => { correctModel(modelPopup, patch); setBulk(null); }}
                          onCancel={() => setBulk(null)}
                        />
                      )}
                      <div className="overflow-auto">{vehicleTable(list)}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ══ ANALYSE ════════════════════════════════════════════════════════ */}
          {view === 'analyse' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900">Analyse</h2>
                <span className="text-xs text-slate-500">
                  {lots.length} modèle{lots.length > 1 ? 's' : ''} à analyser · {selectedUnits} véhicule{selectedUnits > 1 ? 's' : ''} retenu{selectedUnits > 1 ? 's' : ''}
                  {lastSurveyAt ? ` · dernier relevé ${lastSurveyAt.toLocaleDateString('fr-FR')} ${lastSurveyAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ' · aucun relevé'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {surveyRunning && <button onClick={() => { cancelSurvey.current = true; }} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600">Arrêter après ce modèle</button>}
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Plus className="w-3.5 h-3.5" /><span className="sr-only">Ajouter un pays</span>
                    <select value="" onChange={(e) => { const c = e.target.value; if (c) update({ countries: [...draft.countries, c] }); }} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                      <option value="">Ajouter un pays</option>
                      {OFFER_COUNTRIES.filter((c) => !draft.countries.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <p className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600 bg-slate-50/60">
                Chaque <strong>ligne</strong> est un modèle retenu, avec ses critères de recherche. Chaque <strong>case</strong> donne le verdict de ce modèle dans ce pays,
                en comparant <strong>notre prix HT + la TVA du pays</strong> au prix d'attaque affiché sur les sites (TTC) :
                son bouton <strong>« Relever »</strong> relance la recherche de ce modèle dans ce pays seulement. Le bouton d'une <strong>colonne</strong> relève tous les modèles dans ce pays ;
                celui d'une <strong>ligne</strong>, ce modèle dans tous les pays.
              </p>
              {survey && (
                <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-brand-ocean transition-all" style={{ width: `${survey.total ? Math.round((survey.done / survey.total) * 100) : 0}%` }} /></div>
                    <span className="tabular-nums">{survey.done}/{survey.total} recherches</span>
                    <span className="text-slate-500 truncate max-w-[40%]">{surveyRunning ? `en cours : ${survey.current}` : survey.current}</span>
                    {!surveyRunning && <button onClick={() => setSurvey(null)} aria-label="Masquer la progression" className="p-0.5 text-slate-400 hover:text-slate-700"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  {survey.errors.length > 0 && (
                    <details className="mt-1"><summary className="text-amber-700 cursor-pointer">{survey.errors.length} recherche{survey.errors.length > 1 ? 's' : ''} sans résultat</summary>
                      {survey.errors.map((e, i) => <p key={i} className="text-amber-800 mt-0.5">{e}</p>)}
                    </details>
                  )}
                </div>
              )}
              {lots.length === 0 ? (
                <div className="px-4 py-10 text-center space-y-2">
                  <p className="text-sm text-slate-500">Aucun véhicule retenu : choisis d'abord les modèles à analyser dans l'onglet Sélection.</p>
                  <button onClick={() => setView('selection')} className="text-sm px-3 py-1.5 rounded-lg bg-brand-ocean text-white">Choisir les modèles</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs w-full min-w-[900px]">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-100 align-bottom">
                      <th className="py-2 px-3 font-medium">Modèle et critères de recherche</th><th className="py-2 pr-3 text-right font-medium">Notre {B}</th>
                      {draft.countries.map((c) => (
                        <th key={c} className="py-2 pr-3 font-medium min-w-[190px]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-900">{countryLabel(c)}</span>
                            {COUNTRY_CAVEAT[c] ? <span title={COUNTRY_CAVEAT[c]} className="text-amber-600">⚠</span> : null}
                            <button onClick={() => update({ countries: draft.countries.filter((x) => x !== c) })} aria-label={`Retirer la colonne ${countryLabel(c)}`} title={`Retirer la colonne ${countryLabel(c)} (les relevés sont gardés)`} className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <span className="block text-[11px] font-normal text-slate-500">{surveyedIn(c)} modèle{surveyedIn(c) > 1 ? 's' : ''} sur {lots.length} déjà relevé{surveyedIn(c) > 1 ? 's' : ''}</span>
                          <button onClick={() => void runSurvey(lots, [c])} disabled={surveyRunning} title={surveyRunning ? 'Un relevé est en cours' : undefined} className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-brand-ocean text-brand-ocean hover:bg-blue-50 disabled:opacity-40 font-normal">
                            <Search className="w-3 h-3" /> Relever les {lots.length} modèles ici
                          </button>
                        </th>
                      ))}
                      <th className="py-2 pr-3 font-medium text-right">Ce modèle</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {lots.map((lot) => {
                        const opened = targetsOpen === lot.key;
                        const ts = draft.countries.every((c) => targets[targetKey(lot, c)]) ? draft.countries.flatMap((c) => targets[targetKey(lot, c)]) : undefined;
                        return (
                          <Fragment key={lot.key}>
                            <tr>
                              <td className="py-3 px-3 align-top">
                                <span className="block text-sm font-semibold text-slate-900">{lot.brand} {lot.model}</span>
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {lotChips(lot).map((chip) => <span key={chip} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{chip}</span>)}
                                  {lot.adjusted && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-brand-encre border border-blue-200">critères réglés</span>}
                                </span>
                                <span className="block mt-1 text-[11px] text-slate-500">{lot.count} véhicule{lot.count > 1 ? 's' : ''} de l'offre</span>
                              </td>
                              <td className="py-3 pr-3 text-right tabular-nums text-slate-700 whitespace-nowrap align-top">{lot.ourPriceMin != null && lot.ourPriceMax != null && lot.ourPriceMin !== lot.ourPriceMax ? `${fmtEur(toShown(lot.ourPriceMin, S))} – ${fmtEur(toShown(lot.ourPriceMax, S))}` : fmtEur(toShown(lot.ourPriceAvg, S))}</td>
                              {draft.countries.map((c) => {
                                const res = draft.market?.[lot.key]?.[c];
                                const state = cellState[cellKey(lot, c)];
                                const v = res ? verdictOf(lot.ourPriceAvg, res, c) : null;
                                const siteError = res && res.medianTtc == null && !v?.empty ? Object.values(res.sites).find((x) => x.error) : undefined;
                                // Marché vide : les critères qui ont pu le vider, à élargir d'un clic.
                                const narrowing = [lot.kmMax ? `≤ ${lot.kmMax.toLocaleString('fr-FR')} km` : '', lot.powerMin ? `≥ ${lot.powerMin} ch` : '', lot.trim ? `finition ${lot.trim.toUpperCase()}` : ''].filter(Boolean);
                                return (
                                  <td key={c} className="py-3 pr-3 align-top">
                                    <div className={`rounded-lg border p-2 flex flex-col gap-1 min-h-[86px] ${state ? 'border-brand-ocean bg-blue-50/40' : 'border-slate-200'}`}>
                                      {state === 'running' ? (
                                        <span className="flex items-center gap-1.5 text-[11px] text-brand-encre font-medium"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Relevé en cours…</span>
                                      ) : state === 'queued' ? (
                                        <span className="text-[11px] text-brand-encre">En attente dans la file…</span>
                                      ) : v && res ? (
                                        <>
                                          <span className={`self-start px-1.5 py-0.5 rounded border text-[11px] ${VERDICT_CLASS[v.tone]}`}>{v.text}</span>
                                          {res.medianTtc != null && (
                                            <span className="text-[10px] text-slate-500 whitespace-nowrap" title="Prix d'attaque = médiane des annonces les moins chères (3, 5 ou 8 selon la taille du marché), là où une annonce est compétitive : c'est lui qui donne le pourcentage. La médiane (milieu du marché) est indicative.">
                                              {v?.ourTtc != null && <span className="block text-slate-700">notre TTC {c} : <span className="font-semibold">{fmtEur(v.ourTtc)}</span> <span className="text-slate-400">(HT + TVA {Math.round((v.vat ?? 0.2) * 100)} %)</span></span>}
                                              {res.attackTtc != null
                                                ? <>attaque <span className="text-slate-800 font-semibold">{fmtEur(res.attackTtc)}</span> · méd. {fmtEur(res.medianTtc)} · {res.competitors} conc.</>
                                                : <>méd. {fmtEur(res.medianTtc)} · {res.competitors} conc. · <span className="text-amber-700">relancer pour le prix d'attaque</span></>}
                                            </span>
                                          )}
                                          {siteError && <span className="text-[10px] text-amber-700">{SITE_LABEL(siteError.site)} : {siteError.error}</span>}
                                          {v.empty && (
                                            <span className="text-[10px] text-slate-600">
                                              {v.empty.proven > 0 && <span className="block">{v.empty.proven} site{v.empty.proven > 1 ? 's' : ''} sur {v.empty.sites} {v.empty.proven > 1 ? 'ont' : 'a'} confirmé « aucun résultat »</span>}
                                              {v.empty.errors.map((e) => <span key={e} className="block text-amber-700">{e}</span>)}
                                              {narrowing.length > 0 && v.empty.errors.length < v.empty.sites && (
                                                <span className="block">critères : {narrowing.join(' · ')} — <button onClick={() => setEditLot(lot.key)} className="text-brand-ocean hover:underline">élargir</button></span>
                                              )}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <span className="text-[11px] text-slate-400">Pas encore relevé</span>
                                      )}
                                      <div className="mt-auto flex items-center justify-between gap-2">
                                        <span className="text-[10px] text-slate-400">{res ? `relevé le ${new Date(res.at).toLocaleDateString('fr-FR')}` : ''}</span>
                                        <button onClick={() => void runSurvey([lot], [c])} disabled={surveyRunning} title={surveyRunning ? 'Un relevé est en cours' : `Relever ${lot.brand} ${lot.model} en ${countryLabel(c)}`} aria-label={`Relever ${lot.brand} ${lot.model} en ${countryLabel(c)}`}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-300 text-slate-600 hover:border-brand-ocean hover:text-brand-ocean disabled:opacity-40">
                                          <Search className="w-3 h-3" /> Relever
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="py-3 pr-3 align-top text-right">
                                <div className="flex flex-col items-end gap-1.5">
                                  <button onClick={() => void runSurvey([lot], draft.countries)} disabled={surveyRunning || draft.countries.length === 0} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-brand-ocean text-brand-ocean hover:bg-blue-50 disabled:opacity-40 whitespace-nowrap">
                                    <Search className="w-3 h-3" /> Relever dans les {draft.countries.length} pays
                                  </button>
                                  <button onClick={() => setEditLot(editLot === lot.key ? null : lot.key)} className={`inline-flex items-center gap-1 ${editLot === lot.key ? 'text-brand-encre font-medium' : 'text-brand-ocean'} hover:underline`}><SlidersHorizontal className="w-3 h-3" /> {editLot === lot.key ? 'Fermer les critères' : 'Régler les critères'}</button>
                                  <button onClick={() => void toggleTargets(lot)} className="text-brand-ocean hover:underline">{opened ? 'Masquer les recherches' : 'Voir les recherches'}</button>
                                </div>
                              </td>
                            </tr>
                            {editLot === lot.key && (
                              <tr className="bg-blue-50/40">
                                <td colSpan={3 + draft.countries.length} className="px-3 py-2">
                                  {lotCriteriaForm(lot)}
                                </td>
                              </tr>
                            )}
                            {opened && (
                              <tr className="bg-slate-50/60">
                                <td colSpan={3 + draft.countries.length} className="px-3 py-2">
                                  {!ts ? <span className="text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> génération des URLs…</span> : ts.length === 0 ? <span className="text-slate-400">Aucun site pour les pays de l'analyse.</span> : (
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
                                              {sr && <span className="block text-[10px] text-slate-500">{sr.error ? <span className="text-amber-700">{sr.error}</span> : <>{sr.count} annonce{sr.count > 1 ? 's' : ''}{sr.total != null && sr.total !== sr.count ? ` sur ${sr.total}` : ''} · méd. {fmtEur(sr.median)}{sr.attack != null ? <> · attaque {fmtEur(sr.attack)}<span className="text-slate-400">/{sr.attackWindow}</span></> : null} · 1er quart {fmtEur(sr.p25)} · mini {fmtEur(sr.min)}</>} · {new Date(sr.at).toLocaleDateString('fr-FR')}</span>}
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
              <details className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-500">
                <summary className="cursor-pointer text-slate-600">Comment lire le verdict ?</summary>
                <p className="mt-1">
                  Prix d'attaque du pays (médiane des 3, 5 ou 8 annonces les moins chères selon la taille du marché, prix affichés en euros, donc TTC) face à notre prix HT moyen du lot augmenté de la TVA du pays (France 20 %, Allemagne 19 %, Pays-Bas et Belgique 21 %, Italie 22 %, Danemark et Suède 25 %…) : <span className="text-emerald-700">bon</span> si le marché est ≥ 15 % au-dessus, <span className="text-amber-700">juste</span> entre 5 et 15 %, <span className="text-red-700">trop cher</span> en dessous. Un relevé d'avant ce réglage garde la médiane jusqu'à sa relance.
                  {draft.countries.some((c) => COUNTRY_CAVEAT[c]) && <> ⚠ Danemark : {COUNTRY_CAVEAT.DK}.</>} Les recherches passent par la même file que le Market Intelligence : compte quelques minutes par lot et par pays.
                </p>
              </details>
            </div>
          )}

          {/* ══ EXPORT ═════════════════════════════════════════════════════════ */}
          {view === 'export' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
                <span className="font-semibold text-slate-800">Règle de prix MC Export <span className="font-normal text-slate-500">(calculée en HT)</span></span>
                <select value={draft.price_rule.mode} onChange={(e) => applyRule({ ...draft.price_rule, mode: e.target.value as PriceRule['mode'] })} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                  <option value="margin">Prix fournisseur HT + marge</option>
                  <option value="fixed">Prix fixe pour tous</option>
                  <option value="none">Sans prix — le client propose</option>
                </select>
                {draft.price_rule.mode !== 'none' && <>
                  <input type="number" aria-label="Montant" value={draft.price_rule.margin} onChange={(e) => update({ price_rule: { ...draft.price_rule, margin: Number(e.target.value) || 0 } })} className="w-24 px-2 py-1.5 rounded-lg border border-slate-300 text-right" />
                  <span className="text-slate-500">€</span>
                  <button onClick={() => applyRule(draft.price_rule)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 text-white">Appliquer à tous</button>
                </>}
                <span className="ml-auto text-slate-500">Total {B} retenu : <span className="font-semibold text-slate-900">{draft.price_rule.mode === 'none' ? 'sans prix' : fmtEur(toShown(selected.reduce((a, v) => a + (v.sale_price ?? 0) * qtyOf(v), 0), S))}</span></span>
              </div>

            <div className="grid lg:grid-cols-[400px_1fr] gap-4 items-start">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-800 flex-1">Colonnes de l'offre</h2>
                  {draft.export_columns && <button onClick={() => update({ export_columns: null })} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" title="Revenir aux colonnes par défaut"><RotateCcw className="w-3 h-3" /> Par défaut</button>}
                </div>
                {columnsNotSaved && <p className="mx-4 mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Réglage des colonnes appliqué à l'export mais pas encore gardé en base : SQL du 11/10 (offres_colonnes_export) à coller.</p>}
                <ul className="divide-y divide-slate-100">
                  {columns.map((c, i) => {
                    const empty = isColumnEmpty(c, selected);
                    const priceHidden = draft.price_rule.mode === 'none' && (c.builtin === 'price' || c.builtin === 'supplier_price');
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                        <div className="flex flex-col">
                          <button onClick={() => moveColumn(i, -1)} disabled={i === 0} aria-label={`Monter ${c.label}`} className="text-slate-400 hover:text-slate-800 disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
                          <button onClick={() => moveColumn(i, 1)} disabled={i === columns.length - 1} aria-label={`Descendre ${c.label}`} className="text-slate-400 hover:text-slate-800 disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
                        </div>
                        <label className="flex-1 min-w-0">
                          <span className="sr-only">Libellé de la colonne</span>
                          <input value={c.label} onChange={(e) => setColumns(columns.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} className={`w-full px-2 py-1 rounded border text-sm ${empty || priceHidden ? 'border-slate-200 text-slate-400' : 'border-slate-300 text-slate-800'}`} />
                        </label>
                        {!c.builtin && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-brand-encre border border-blue-200">libre</span>}
                        {(empty || priceHidden) && <span className="text-[10px] text-slate-400" title={priceHidden ? 'Offre sans prix' : 'Vide pour tous les véhicules retenus'}>non exportée</span>}
                        <button onClick={() => setColumns(columns.filter((x) => x.id !== c.id))} aria-label={`Retirer ${c.label}`} className="p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50"><X className="w-3.5 h-3.5" /></button>
                      </li>
                    );
                  })}
                </ul>
                <div className="px-4 py-3 border-t border-slate-100 space-y-2">
                  {missingBuiltins.length > 0 && (
                    <select value="" onChange={(e) => { const k = e.target.value as keyof typeof BUILTIN_COLUMNS; if (k) setColumns([...columns, { id: k, builtin: k, label: BUILTIN_COLUMNS[k].label }]); }} className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
                      <option value="">Ajouter une colonne du fichier…</option>
                      {missingBuiltins.map((k) => <option key={k} value={k}>{BUILTIN_COLUMNS[k].label}</option>)}
                    </select>
                  )}
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newColumnLabel.trim()) return; setColumns([...columns, newCustomColumn(newColumnLabel)]); setNewColumnLabel(''); }}>
                    <label className="flex-1"><span className="sr-only">Nom de la colonne libre</span>
                      <input value={newColumnLabel} onChange={(e) => setNewColumnLabel(e.target.value)} placeholder="Colonne libre (ex. Disponibilité)" className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-sm" />
                    </label>
                    <button type="submit" disabled={!newColumnLabel.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-ocean text-white text-sm disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Ajouter</button>
                  </form>
                  <p className="text-[11px] text-slate-500">Les colonnes libres se remplissent dans l'onglet Sélection, une case par véhicule. Une colonne du fichier vide pour tous les véhicules n'est pas exportée.</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                  <h2 className="text-sm font-semibold text-slate-800">Aperçu de l'offre</h2>
                  <span className="text-xs text-slate-500">{unitsLabel(selected.length, selectedUnits)} · {draft.price_rule.mode === 'none' ? 'sans prix' : `prix ${B}`}{S.lang === 'en' ? ' · export en anglais' : ''}</span>
                  <div className="ml-auto flex gap-2">
                    <button onClick={exportXlsx} disabled={selected.length === 0} className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-brand-ocean text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
                    <button onClick={() => void exportPdf()} disabled={selected.length === 0 || busy === 'pdf'} className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">{busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF MC Export</button>
                  </div>
                </div>
                {selected.length === 0 ? (
                  <p className="px-4 py-10 text-sm text-slate-400 text-center">Aucun véhicule retenu : rien à exporter.</p>
                ) : (
                  <div className="overflow-auto max-h-[75vh] p-3">
                    <p className="text-sm font-bold text-slate-900 uppercase">{draft.title || 'OFFRE MC EXPORT'}</p>
                    <table className="mt-2 text-xs w-full">
                      <thead className="sticky top-0"><tr className="bg-slate-800 text-white text-left">{previewColumns.map((c) => <th key={c.id} className="px-2 py-1.5 font-semibold whitespace-nowrap">{displayLabel(c, exportCtx)}</th>)}</tr></thead>
                      <tbody>
                        {selected.map((v, i) => (
                          <tr key={v.id} className={i % 2 ? 'bg-slate-50' : ''}>
                            {previewColumns.map((c) => <td key={c.id} className={`px-2 py-1 border-b border-slate-100 max-w-[220px] truncate ${c.builtin === 'price' ? 'font-semibold text-brand-encre' : 'text-slate-700'}`}>{previewCell(c, v)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!draft.export_columns && <p className="mt-2 text-[11px] text-slate-500">Colonnes par défaut : le PDF garde sa mise en page habituelle. Dès qu'une colonne est modifiée, Excel et PDF suivent exactement cette liste.</p>}
                  </div>
                )}
              </div>
            </div>
            </div>
          )}

          {/* ══ INTRA : la vitrine de l'Accueil MC Export ═══════════════════════ */}
          {view === 'intra' && (() => {
            const allPublished = selected.length > 0 && selected.every((v) => publishedHere.has(v.id));
            const stale = (v: OfferVehicle) => {
              const it = publishedHere.get(v.id);
              if (!it) return false;
              const now = intraDraftOf(v);
              return !!now && (it.price_ht !== now.price_ht || JSON.stringify(it.market ?? null) !== JSON.stringify(now.market ?? null));
            };
            const others = showcase.filter((i) => i.offer_id !== draft.id);
            return (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 text-sm text-slate-600 flex items-start gap-3 flex-wrap">
                  <Megaphone className="w-5 h-5 text-brand-ocean shrink-0 mt-0.5" />
                  <p className="flex-1 min-w-[280px]">L'Intra, ce sont les <strong>bonnes affaires de l'Accueil</strong> de tous les utilisateurs d'ADA, toutes organisations : les véhicules disponibles que l'équipe MC Export choisit de montrer, avec le prix MC Export {B} et le relevé du marché FRANÇAIS du lot (verdict France, recherches françaises cliquables ; les autres pays restent ici ; étude complète pour ceux qui ont l'onglet Offres). Publier photographie le véhicule tel qu'il est maintenant ; republier rafraîchit.</p>
                  {showcaseError && <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{showcaseError}</span>}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                    <h2 className="text-sm font-semibold text-slate-800">Véhicules de l'offre</h2>
                    <span className="text-xs text-slate-500">{unitsLabel(selected.length, selectedUnits)} retenus · {publishedHere.size} en bonne affaire</span>
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => void publishVehicles(selected)} disabled={selected.length === 0} className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"><Megaphone className="w-4 h-4" /> {allPublished ? 'Republier tous les retenus' : 'Publier tous les retenus'}</button>
                      <button onClick={() => void unpublishVehicles([...publishedHere.values()].map((i) => i.id))} disabled={publishedHere.size === 0} className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-red-400 hover:text-red-700 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"><X className="w-4 h-4" /> Tout retirer des bonnes affaires</button>
                    </div>
                  </div>
                  {selected.length === 0 ? (
                    <p className="px-4 py-10 text-sm text-slate-400 text-center">Aucun véhicule retenu : rien à publier. Retiens des véhicules dans l'onglet Sélection.</p>
                  ) : (
                    <div className="overflow-auto max-h-[70vh] p-3" data-intra-table>
                      <table className="text-xs w-full">
                        <thead className="sticky top-0"><tr className="bg-slate-800 text-white text-left">
                          <th className="px-2 py-1.5 font-semibold whitespace-nowrap">Bonne affaire</th>
                          {previewColumns.map((c) => <th key={c.id} className="px-2 py-1.5 font-semibold whitespace-nowrap">{displayLabel(c, exportCtx)}</th>)}
                          <th className="px-2 py-1.5 font-semibold whitespace-nowrap">Relevé de marché</th>
                          <th className="px-2 py-1.5 font-semibold whitespace-nowrap">Mot pour la bonne affaire</th>
                        </tr></thead>
                        <tbody>
                          {selected.map((v, i) => {
                            const it = publishedHere.get(v.id);
                            const lot = lots.find((l) => l.vehicleIds.includes(v.id));
                            const countries = lot ? Object.keys(draft.market?.[lot.key] ?? {}) : [];
                            return (
                              <Fragment key={v.id}>
                              <tr className={i % 2 ? 'bg-slate-50' : ''}>
                                <td className="px-2 py-1 border-b border-slate-100 whitespace-nowrap">
                                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" checked={!!it} onChange={(e) => (e.target.checked ? void publishVehicles([v]) : it && void unpublishVehicles([it.id]))} aria-label={`Publier ${v.brand} ${v.model} en bonne affaire`} />
                                    {it ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${stale(v) ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`} title={stale(v) ? 'Le prix ou le relevé a changé depuis la publication — recoche ou « Republier » pour rafraîchir' : `Publié le ${new Date(it.published_at).toLocaleDateString('fr-FR')}`}>{stale(v) ? 'à rafraîchir' : 'publié'}</span> : <span className="text-[10px] text-slate-400">non</span>}
                                  </label>
                                </td>
                                {previewColumns.map((c) => <td key={c.id} className={`px-2 py-1 border-b border-slate-100 max-w-[220px] truncate ${c.builtin === 'price' ? 'font-semibold text-brand-encre' : 'text-slate-700'}`}>{previewCell(c, v)}</td>)}
                                <td className="px-2 py-1 border-b border-slate-100 whitespace-nowrap">
                                  {countries.length === 0 ? <span className="text-slate-400">aucun relevé</span> : countries.map((c) => {
                                    const vd = verdictOf(draft.price_rule.mode === 'none' ? null : v.sale_price, draft.market?.[lot!.key]?.[c], c);
                                    return <span key={c} className={`inline-block mr-1 text-[10px] px-1.5 py-0.5 rounded-full border ${VERDICT_CLASS[vd.tone]}`} title={vd.text}>{c} {vd.marginPct != null ? `${vd.marginPct >= 0 ? '+' : ''}${vd.marginPct} %` : vd.text}</span>;
                                  })}
                                  {lot && (
                                    <button onClick={() => setEditLot(editLot === lot.key ? null : lot.key)} title={`Critères de l'étude de marché : ${lot.label}`} aria-expanded={editLot === lot.key} className={`ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${editLot === lot.key ? 'border-brand-encre bg-blue-50 text-brand-encre' : 'border-slate-300 text-slate-600 hover:text-brand-ocean hover:border-brand-ocean'}`}>
                                      <SlidersHorizontal className="w-3 h-3" /> {lot.adjusted ? 'critères réglés' : 'critères'}
                                    </button>
                                  )}
                                </td>
                                <td className="px-2 py-1 border-b border-slate-100">
                                  {it ? <input defaultValue={it.note} onBlur={async (e) => { const note = e.target.value.trim(); if (note === it.note) return; const err = await setShowcaseNote(it.id, note); if (err) fail(err); else void reloadShowcase(); }} placeholder="ex. dispo immédiate, 2 exemplaires" className="w-48 px-2 py-1 rounded border border-slate-300" /> : <span className="text-slate-300">—</span>}
                                </td>
                              </tr>
                              {lot && editLot === lot.key && (
                                <tr className="bg-blue-50/40">
                                  <td colSpan={previewColumns.length + 3} className="px-3 py-2 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap text-xs">
                                      <span className="font-semibold text-slate-800">Étude de marché du lot</span>
                                      <span className="text-slate-600">{lot.label}</span>
                                      <span className="text-slate-400">· {lot.count} véhicule{lot.count > 1 ? 's' : ''} de l'offre dans ce lot</span>
                                      <button onClick={() => void runSurvey([lot], draft.countries)} disabled={surveyRunning || draft.countries.length === 0} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-brand-ocean text-brand-ocean hover:bg-blue-50 disabled:opacity-40 whitespace-nowrap">
                                        <Search className="w-3 h-3" /> Relever dans les {draft.countries.length} pays
                                      </button>
                                    </div>
                                    {lotCriteriaForm(lot)}
                                    {survey && surveyRunning && <p className="text-[11px] text-slate-500">Relevé en cours : {survey.done}/{survey.total} · {survey.current}</p>}
                                    <p className="text-[11px] text-slate-500">Un véhicule déjà publié garde l'ancien relevé dans les bonnes affaires jusqu'à ce que tu le republies (il passe « à rafraîchir »).</p>
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
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                    <h2 className="text-sm font-semibold text-slate-800">Ce que l'Accueil montre aujourd'hui</h2>
                    <span className="text-xs text-slate-500">{showcase.length} véhicule{showcase.length > 1 ? 's' : ''} en bonnes affaires, toutes offres confondues{others.length ? ` · ${others.length} d'autres offres` : ''}</span>
                    {/* AJOUT DIRECT (14/10, Channing : « ajouter un véhicule en bonne affaire sans passer une liste »). */}
                    <button onClick={() => setManualOpen((o) => !o)} aria-expanded={manualOpen} className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${manualOpen ? 'border-brand-encre bg-blue-50 text-brand-encre' : 'border-brand-ocean text-brand-ocean hover:bg-blue-50'}`}>
                      <Plus className="w-4 h-4" /> Ajouter un véhicule sans liste
                    </button>
                  </div>
                  {manualOpen && (
                    <div className="px-4 py-3 border-b border-slate-100 bg-blue-50/40 space-y-3">
                      <p className="text-xs text-slate-600">Un véhicule saisi à la main : il n'appartient à aucune offre et n'a pas de relevé de marché. Il apparaît sur l'Accueil d'ADA et sur mc-export.com comme les autres ; photos, titre et mot se règlent ensuite dans la liste ci-dessous.</p>
                      <VehicleEditor v={manual} onChange={(patch) => setManual((m) => ({ ...m, ...patch }))} />
                      <div className="flex flex-wrap items-end gap-3 text-xs">
                        <label className="text-slate-600">Prix MC Export HT (€)
                          <input type="number" value={manualMeta.price} onChange={(e) => setManualMeta((m) => ({ ...m, price: e.target.value }))} placeholder="vide = sur proposition" className="block mt-0.5 w-40 px-2 py-1 rounded border border-slate-300 bg-white tabular-nums font-semibold text-brand-encre" />
                        </label>
                        <label className="text-slate-600">Titre (facultatif)
                          <input value={manualMeta.title} onChange={(e) => setManualMeta((m) => ({ ...m, title: e.target.value }))} placeholder="vide = marque + modèle" className="block mt-0.5 w-64 px-2 py-1 rounded border border-slate-300 bg-white" />
                        </label>
                        <label className="text-slate-600">Mot pour la bonne affaire
                          <input value={manualMeta.note} onChange={(e) => setManualMeta((m) => ({ ...m, note: e.target.value }))} placeholder="ex. dispo immédiate" className="block mt-0.5 w-64 px-2 py-1 rounded border border-slate-300 bg-white" />
                        </label>
                        <button onClick={() => void submitManual()} disabled={manualBusy || !manual.brand.trim() || !manual.model.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white text-sm font-medium disabled:opacity-50">
                          {manualBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} Publier en bonne affaire
                        </button>
                        <button onClick={() => { setManualOpen(false); setManual(emptyManual()); }} className="text-slate-500 hover:text-slate-800 pb-1.5">Annuler</button>
                      </div>
                    </div>
                  )}
                  {showcase.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-slate-400 text-center">Aucune bonne affaire publiée.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {showcase.map((it, idx) => {
                        const isOpen = openDeal === it.id;
                        const sameOffer = !!draft.id && it.offer_id === draft.id;
                        const otherOffer = !sameOffer && it.offer_id ? offers.find((o) => o.id === it.offer_id) : undefined;
                        /** Un clic sur la ligne (hors champs et boutons) déplie les réglages. */
                        const toggle = (e: ReactMouseEvent) => { if ((e.target as HTMLElement).closest('input,button,a,label,textarea')) return; setOpenDeal(isOpen ? null : it.id); };
                        return (
                        <li key={it.id} className={`px-4 py-2 text-xs space-y-1.5 cursor-pointer ${isOpen ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`} onClick={toggle} title={isOpen ? '' : 'Cliquer pour modifier le prix, le mot et les réglages'}>
                          <div className="flex items-center gap-3">
                            {/* Ordre (29/10) : flèches, même ordre sur l'Accueil et sur le site. */}
                            <span className="flex flex-col shrink-0 -my-1">
                              <button onClick={() => void moveDeal(it.id, -1)} disabled={idx === 0} aria-label="Monter" title="Monter d'un cran" className="text-slate-400 hover:text-slate-800 disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
                              <button onClick={() => void moveDeal(it.id, 1)} disabled={idx === showcase.length - 1} aria-label="Descendre" title="Descendre d'un cran" className="text-slate-400 hover:text-slate-800 disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums w-5 shrink-0">{idx + 1}</span>
                            {/* Titre libre (13/10, Channing : « modifier les titres des annonces ») — repris sur l'Accueil et sur le site ; vide = marque + modèle. */}
                            <input defaultValue={it.title ?? ''} placeholder={`${it.vehicle.brand} ${it.vehicle.model}`} title="Titre de la bonne affaire (Accueil + site) — vide : marque + modèle" aria-label="Titre de la bonne affaire"
                              onBlur={async (e) => { const t = e.target.value.trim(); if (t === (it.title ?? '').trim()) return; const err = await setShowcaseTitle(it.id, t); if (err) fail(err); else void reloadShowcase(); }}
                              className="w-56 px-2 py-1 rounded border border-slate-200 font-medium text-slate-800 placeholder:text-slate-800 placeholder:font-medium hover:border-slate-400 focus:border-brand-ocean" />
                            <span className="text-slate-500 truncate">{it.vehicle.engine || it.vehicle.version}</span>
                            <span className="tabular-nums font-semibold text-brand-encre shrink-0">{it.price_ht != null ? fmtEur(it.price_ht) + ' HT' : 'sur proposition'}</span>
                            <span className="text-slate-400 shrink-0">{it.offer_title || 'offre'} · {it.published_by_name} · {new Date(it.published_at).toLocaleDateString('fr-FR')}</span>
                            {it.note && <span className="text-slate-600 truncate">« {it.note} »</span>}
                            {/* Trois petits points (14/10) : corriger les caractéristiques, retirer. */}
                            <span className="relative ml-auto shrink-0">
                              <button onClick={() => setDealMenu(dealMenu === it.id ? null : it.id)} title="Options de la bonne affaire" aria-haspopup="menu" aria-expanded={dealMenu === it.id} className={`p-1 rounded ${dealMenu === it.id ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}><MoreHorizontal className="w-4 h-4" /></button>
                              {dealMenu === it.id && (
                                <div role="menu" className="absolute right-0 top-7 z-30 w-60 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-xs text-left">
                                  <button role="menuitem" onClick={() => startEditDeal(it)} className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"><Pencil className="w-3.5 h-3.5 text-brand-ocean" /> Modifier les caractéristiques…</button>
                                  <button role="menuitem" onClick={() => { setDealMenu(null); setOpenDeal(it.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"><SlidersHorizontal className="w-3.5 h-3.5 text-brand-ocean" /> Prix, mot, réglages</button>
                                  <button role="menuitem" onClick={() => { setDealMenu(null); void unpublishVehicles([it.id]); }} className="w-full flex items-center gap-2 px-3 py-2 text-red-700 hover:bg-red-50"><X className="w-3.5 h-3.5" /> Retirer des bonnes affaires</button>
                                </div>
                              )}
                            </span>
                          </div>
                          {editDeal?.id === it.id && (
                            <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                              <p className="text-[11px] text-slate-600">Caractéristiques de la bonne affaire — ce que l'Accueil et le site montrent. Un véhicule venu d'une offre n'est pas modifié dans l'offre.</p>
                              <VehicleEditor v={editDeal.v} onChange={(patch) => setEditDeal((d) => (d ? { ...d, v: { ...d.v, ...patch } } : d))} />
                              <div className="flex items-center gap-3">
                                <button onClick={() => void saveEditDeal()} disabled={editDealBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white text-sm font-medium disabled:opacity-50">{editDealBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer</button>
                                <button onClick={() => setEditDeal(null)} className="text-slate-500 hover:text-slate-800 text-xs">Annuler</button>
                              </div>
                            </div>
                          )}
                          {/* PHOTOS (13/10) : montrées sur l'Accueil d'ADA et sur mc-export.com ; jpeg / png / webp, 8 Mo max. */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(it.photos ?? []).map((url, n) => (
                              <span key={url} className="relative group">
                                <img src={url} alt={`${it.vehicle.brand} ${it.vehicle.model} photo ${n + 1}`} className="h-12 w-16 object-cover rounded border border-slate-200" loading="lazy" />
                                <button onClick={async () => { const err = await removeShowcasePhoto(it, url); if (err) fail(err); else void reloadShowcase(); }} className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-white border border-slate-300 text-slate-500 hover:text-red-600" title="Retirer cette photo" aria-label="Retirer cette photo"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                            <label className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed cursor-pointer ${photoBusy === it.id ? 'opacity-50' : 'border-slate-300 text-slate-600 hover:border-brand-ocean hover:text-brand-ocean'}`}>
                              {photoBusy === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />} {(it.photos ?? []).length ? 'Ajouter des photos' : 'Photos (site + Accueil)'}
                              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={photoBusy === it.id} onChange={async (e) => {
                                const files = [...(e.target.files ?? [])]; e.currentTarget.value = '';
                                if (files.length === 0) return;
                                setPhotoBusy(it.id);
                                const r = await addShowcasePhotos(it, files);
                                setPhotoBusy(null);
                                if (r.error) fail(r.error); else info(`${files.length} photo${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''} — visible${files.length > 1 ? 's' : ''} sur l'Accueil et sur mc-export.com.`);
                                void reloadShowcase();
                              }} />
                            </label>
                            {(it.photos ?? []).length === 0 && <span className="text-[10px] text-slate-400">Sans photo, le site montre la carte sans image.</span>}
                          </div>
                          {/* RÉGLAGES DE LA BONNE AFFAIRE (13/10) : prix publié, mot, et le chemin vers l'offre pour les critères de l'étude. */}
                          {isOpen && (
                            <div className="flex items-end gap-3 flex-wrap rounded-lg border border-blue-200 bg-white px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <label className="text-slate-600">Prix MC Export HT publié
                                <input type="number" defaultValue={it.price_ht ?? ''} placeholder="sur proposition" aria-label="Prix MC Export HT publié"
                                  onBlur={async (e) => {
                                    const p = e.target.value === '' ? null : Math.round(Number(e.target.value));
                                    if (p === (it.price_ht ?? null)) return;
                                    const err = await setShowcasePrice(it.id, p);
                                    if (err) { fail(err); return; }
                                    // Même offre : le prix du véhicule suit, pour que le tableau au-dessus ne dise pas « à rafraîchir ».
                                    if (sameOffer && draft.vehicles.some((v) => v.id === it.vehicle_id)) setVehicle(it.vehicle_id, { sale_price: p });
                                    void reloadShowcase();
                                  }}
                                  className="block mt-0.5 w-32 px-2 py-1 rounded border border-slate-300 tabular-nums font-semibold text-brand-encre" />
                              </label>
                              <label className="text-slate-600">Mot pour la bonne affaire
                                <input defaultValue={it.note} placeholder="ex. dispo immédiate, 2 exemplaires" aria-label="Mot pour la bonne affaire"
                                  onBlur={async (e) => { const note = e.target.value.trim(); if (note === it.note) return; const err = await setShowcaseNote(it.id, note); if (err) fail(err); else void reloadShowcase(); }}
                                  className="block mt-0.5 w-64 px-2 py-1 rounded border border-slate-300" />
                              </label>
                              {sameOffer && it.lot_key && (
                                <button onClick={() => { setEditLot(it.lot_key); document.querySelector('[data-intra-table]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:border-brand-ocean hover:text-brand-ocean">
                                  <SlidersHorizontal className="w-3 h-3" /> Critères de l'étude (tableau ci-dessus)
                                </button>
                              )}
                              {otherOffer && (
                                <button onClick={() => { open(otherOffer); setView('intra'); }} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-brand-ocean text-brand-ocean hover:bg-blue-50">
                                  <ExternalLink className="w-3 h-3" /> Ouvrir l'offre « {otherOffer.title || 'sans titre'} »
                                </button>
                              )}
                              {!sameOffer && !otherOffer && <span className="text-[11px] text-slate-400 pb-1.5">{it.offer_id ? "Offre d'origine introuvable (supprimée ?) : le prix et le mot restent modifiables ici." : 'Ajout direct, sans liste ni relevé de marché : le prix et le mot se règlent ici.'}</span>}
                              <span className="basis-full text-[11px] text-slate-500">Le prix et le mot changent tout de suite sur l'Accueil et sur mc-export.com. Les critères de l'étude et le relevé se règlent dans l'offre, puis « Republier ».</span>
                            </div>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

/** Correction à la main des valeurs lues d'un véhicule (11/10 — remplace l'écran de correspondance des colonnes). */
type BulkField = 'brand' | 'model' | 'version' | 'engine' | 'fuel' | 'gearbox' | 'power_ch' | 'color' | 'vat_recoverable' | 'damages' | 'year';
const BULK_FIELDS: Array<{ id: BulkField; label: string }> = [
  { id: 'brand', label: 'Marque' }, { id: 'model', label: 'Modèle' }, { id: 'version', label: 'Version' }, { id: 'engine', label: 'Motorisation' },
  { id: 'fuel', label: 'Énergie' }, { id: 'gearbox', label: 'Boîte' }, { id: 'power_ch', label: 'Ch' }, { id: 'color', label: 'Couleur' },
  { id: 'vat_recoverable', label: 'TVA' }, { id: 'damages', label: 'Dommages (€)' }, { id: 'year', label: 'Année' },
];
/** La valeur actuelle d'un véhicule pour un champ, en texte (pré-remplit le formulaire). */
function bulkCurrent(v: OfferVehicle | undefined, f: BulkField): string {
  if (!v) return '';
  if (f === 'vat_recoverable') return v.vat_recoverable == null ? '' : v.vat_recoverable ? 'oui' : 'non';
  const x = v[f];
  return x == null ? '' : String(x);
}
/** Le correctif à appliquer à chaque véhicule, depuis le champ et la valeur saisie. */
function bulkPatch(f: BulkField, value: string): Partial<OfferVehicle> {
  const t = value.trim();
  if (f === 'brand' || f === 'model') return { [f]: t.toUpperCase() };
  if (f === 'version') return { version: t };
  if (f === 'engine' || f === 'color') return { [f]: t || null };
  if (f === 'fuel' || f === 'gearbox') return { [f]: t || null };
  if (f === 'vat_recoverable') return { vat_recoverable: t === '' ? null : t === 'oui' };
  return { [f]: numOrNull(t) };
}
/**
 * UN CRITÈRE POUR TOUTE LA LISTE D'UN MODÈLE (20/10, Channing). Un champ, une valeur, « Appliquer » : les N
 * véhicules reçoivent la même correction, gardée comme celle du crayon. Marque / modèle renommés : la
 * fenêtre suit la liste sous son nouveau nom. Rien n'est écrit tant qu'on n'applique pas.
 */
function BulkEditor({ bulk, count, sample, onChange, onApply, onCancel }: {
  bulk: { field: BulkField; value: string }; count: number; sample: OfferVehicle | undefined;
  onChange: (b: { field: BulkField; value: string }) => void; onApply: (patch: Partial<OfferVehicle>) => void; onCancel: () => void;
}) {
  const field = 'px-2 py-1 rounded border border-slate-300 bg-white text-sm';
  const f = bulk.field;
  const setField = (nf: BulkField) => onChange({ field: nf, value: bulkCurrent(sample, nf) });
  const label = BULK_FIELDS.find((x) => x.id === f)?.label ?? f;
  const input = f === 'fuel' ? (
    <select value={bulk.value} onChange={(e) => onChange({ ...bulk, value: e.target.value })} className={field}>
      <option value="">—</option>{FUEL_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  ) : f === 'gearbox' ? (
    <select value={bulk.value} onChange={(e) => onChange({ ...bulk, value: e.target.value })} className={field}>
      <option value="">—</option><option value="AUTOMATIQUE">Automatique</option><option value="MANUELLE">Manuelle</option>
    </select>
  ) : f === 'vat_recoverable' ? (
    <select value={bulk.value} onChange={(e) => onChange({ ...bulk, value: e.target.value })} className={field}>
      <option value="">—</option><option value="oui">Récupérable</option><option value="non">Régime de la marge</option>
    </select>
  ) : (
    <input
      type={f === 'power_ch' || f === 'damages' || f === 'year' ? 'number' : 'text'} value={bulk.value} autoFocus
      onChange={(e) => onChange({ ...bulk, value: e.target.value })}
      onKeyDown={(e) => { if (e.key === 'Enter') onApply(bulkPatch(f, bulk.value)); }}
      className={`${field} ${f === 'version' ? 'w-72' : 'w-44'} ${f === 'brand' || f === 'model' ? 'uppercase' : ''}`}
    />
  );
  return (
    <div className="px-5 py-2.5 border-b border-sky-100 bg-sky-50/60 flex items-center gap-3 flex-wrap text-sm">
      <span className="text-slate-700">Pour les <b>{count}</b> véhicules de cette liste :</span>
      <select value={f} onChange={(e) => setField(e.target.value as BulkField)} className={field}>
        {BULK_FIELDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <span className="text-slate-500">=</span>
      {input}
      <button onClick={() => onApply(bulkPatch(f, bulk.value))} className="px-3 py-1 rounded-lg bg-brand-ocean text-white text-sm">Appliquer à tous</button>
      <button onClick={onCancel} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-white">Annuler</button>
      <span className="text-xs text-slate-500">{label} remplacé pour chaque véhicule, comme avec le crayon ; les autres colonnes ne bougent pas.</span>
    </div>
  );
}

function VehicleEditor({ v, onChange }: { v: OfferVehicle; onChange: (patch: Partial<OfferVehicle>) => void }) {
  const field = 'block mt-0.5 px-2 py-1 rounded border border-slate-300 bg-white';
  const regYear = (iso: string) => { const y = Number(iso.slice(0, 4)); return Number.isFinite(y) && y > 1900 ? y : null; };
  return (
    <div className="flex flex-wrap items-end gap-3 text-xs">
      <label className="text-slate-600">Marque<input value={v.brand} onChange={(e) => onChange({ brand: e.target.value.toUpperCase() })} className={`${field} w-28 uppercase`} /></label>
      <label className="text-slate-600">Modèle<input value={v.model} onChange={(e) => onChange({ model: e.target.value.toUpperCase() })} className={`${field} w-36 uppercase`} /></label>
      <label className="text-slate-600">Version<input value={v.version} onChange={(e) => onChange({ version: e.target.value })} className={`${field} w-56`} /></label>
      <label className="text-slate-600">Motorisation<input value={v.engine ?? ''} onChange={(e) => onChange({ engine: e.target.value || null })} className={`${field} w-40`} /></label>
      <label className="text-slate-600">VIN<input value={v.vin ?? ''} onChange={(e) => onChange({ vin: e.target.value.toUpperCase() || null })} className={`${field} w-44 uppercase font-mono`} /></label>
      <label className="text-slate-600">1re immat.<input type="date" value={v.reg_date ?? ''} onChange={(e) => onChange({ reg_date: e.target.value || null, year: e.target.value ? regYear(e.target.value) : v.year })} className={field} /></label>
      <label className="text-slate-600" title="Millésime, quand le fichier ne donne pas la date">Année<input type="number" min={1980} max={2100} value={v.year ?? ''} disabled={!!v.reg_date} onChange={(e) => onChange({ year: numOrNull(e.target.value) })} className={`${field} w-20 disabled:opacity-50`} /></label>
      <label className="text-slate-600">Km<input type="number" value={v.km ?? ''} onChange={(e) => onChange({ km: numOrNull(e.target.value) })} className={`${field} w-24`} /></label>
      <label className="text-slate-600">Énergie
        <select value={v.fuel ?? ''} onChange={(e) => onChange({ fuel: e.target.value || null })} className={field}>
          <option value="">—</option>
          {FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          {v.fuel && !FUEL_OPTIONS.includes(v.fuel) && <option value={v.fuel}>{v.fuel}</option>}
        </select>
      </label>
      <label className="text-slate-600">Boîte
        <select value={v.gearbox ?? ''} onChange={(e) => onChange({ gearbox: e.target.value || null })} className={field}>
          <option value="">—</option><option value="AUTOMATIQUE">Automatique</option><option value="MANUELLE">Manuelle</option>
          {v.gearbox && !['AUTOMATIQUE', 'MANUELLE'].includes(v.gearbox) && <option value={v.gearbox}>{v.gearbox}</option>}
        </select>
      </label>
      <label className="text-slate-600">Ch<input type="number" value={v.power_ch ?? ''} onChange={(e) => onChange({ power_ch: numOrNull(e.target.value) })} className={`${field} w-20`} /></label>
      <label className="text-slate-600">Couleur<input value={v.color ?? ''} onChange={(e) => onChange({ color: e.target.value || null })} className={`${field} w-28`} /></label>
      <label className="text-slate-600">Dommages (€)<input type="number" value={v.damages ?? ''} onChange={(e) => onChange({ damages: numOrNull(e.target.value) })} className={`${field} w-24`} /></label>
      <label className="text-slate-600">TVA
        <select value={v.vat_recoverable == null ? '' : v.vat_recoverable ? 'oui' : 'non'} onChange={(e) => onChange({ vat_recoverable: e.target.value === '' ? null : e.target.value === 'oui' })} className={field}>
          <option value="">—</option><option value="oui">Récupérable</option><option value="non">Régime de la marge</option>
        </select>
      </label>
      <label className="text-slate-600">Prix fournisseur HT (€)<input type="number" value={v.price_ht ?? ''} onChange={(e) => onChange({ price_ht: numOrNull(e.target.value) })} className={`${field} w-28`} /></label>
      <label className="text-slate-600">Prix fournisseur TTC (€)<input type="number" value={v.price_ttc ?? ''} onChange={(e) => onChange({ price_ttc: numOrNull(e.target.value) })} className={`${field} w-28`} /></label>
      <span className="text-[11px] text-slate-500 pb-1.5 basis-full">Chaque correction est enregistrée et rejouée si le fichier est relu. Un prix fournisseur corrigé ne change pas le prix MC Export : « Appliquer à tous » (onglet Export) le recalcule.</span>
    </div>
  );
}

/**
 * FICHIER D'ORIGINE, BRUT (11/10, demande Channing : « un visualiseur de l'offre
 * initiale pour étudier le brut ») : la feuille telle que reçue (grille conservée
 * avec l'offre) ou les PDF déposés, affichés sans aucune interprétation.
 */
function SourceViewer({ grid, files, filename }: { grid: unknown[][] | null; files: OfferSourceFile[]; filename: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const MAX_ROWS = 1000;
  if (!grid?.length && files.length === 0) return null;
  const width = grid ? Math.max(0, ...grid.map((r) => (Array.isArray(r) ? r.length : 0))) : 0;
  const colName = (i: number) => { let n = i + 1, out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
  const cell = (x: unknown) => (x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const showPdf = async (f: OfferSourceFile) => {
    try { const u = await signedUrl(f.path); setUrls((cur) => ({ ...cur, [f.path]: u })); setError(null); }
    catch (e) { setError(`Ouverture impossible : ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <details className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-sm">
        <FileSpreadsheet className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-slate-800">Fichier d'origine, brut</span>
        <span className="text-xs text-slate-500">{filename || files.map((f) => f.name).join(' + ')} · tel que reçu, sans interprétation</span>
      </summary>
      <div className="border-t border-slate-100">
        {grid && grid.length > 0 && (
          <div className="overflow-auto max-h-[70vh]">
            <table className="text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-slate-500">
                  <th className="sticky left-0 bg-slate-100 px-2 py-1 border border-slate-200 font-medium"></th>
                  {Array.from({ length: width }, (_, i) => <th key={i} className="px-2 py-1 border border-slate-200 font-medium">{colName(i)}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.slice(0, MAX_ROWS).map((row, ri) => (
                  <tr key={ri} className="hover:bg-blue-50/40">
                    <td className="sticky left-0 bg-slate-50 px-2 py-0.5 border border-slate-200 text-slate-400 text-right tabular-nums">{ri + 1}</td>
                    {Array.from({ length: width }, (_, ci) => (
                      <td key={ci} className="px-2 py-0.5 border border-slate-200 whitespace-nowrap max-w-[320px] truncate text-slate-700" title={cell(Array.isArray(row) ? row[ci] : '')}>{cell(Array.isArray(row) ? row[ci] : '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {grid.length > MAX_ROWS && <p className="px-3 py-2 text-xs text-slate-500">{grid.length - MAX_ROWS} lignes de plus non affichées.</p>}
          </div>
        )}
        {files.length > 0 && (
          <div className="p-3 space-y-3">
            {error && <p className="text-xs text-red-700">{error}</p>}
            {files.map((f) => (
              <div key={f.path} className="space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span className="font-medium text-slate-800">{f.name}</span>
                  {!urls[f.path]
                    ? <button onClick={() => void showPdf(f)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Afficher ici</button>
                    : <a href={urls[f.path]} target="_blank" rel="noreferrer" className="text-xs text-brand-ocean hover:underline inline-flex items-center gap-1">Ouvrir dans un onglet <ExternalLink className="w-3 h-3" /></a>}
                </div>
                {urls[f.path] && <iframe title={f.name} src={urls[f.path]} className="w-full h-[75vh] rounded-lg border border-slate-200" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
