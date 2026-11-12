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
import { ClipboardList, ExternalLink, FileDown, FileUp, Loader2, RefreshCw, Trash2, Search, AlertTriangle, Check, Archive, ArchiveRestore, Images, Send, X, Pencil, Car } from 'lucide-react';
import { SingleUnitModal, type SingleUnitOptions } from '../components/SingleUnitModal';
import { unitToInspectionFields, type SingleUnit } from '../lib/offers/singleUnit';
import { isExternalReport } from '../lib/fycLinks';
import { SUPPLIER_REPORT_KEY } from '../components/OfferFiches';
import { useAuth } from '../services/auth';
import { listInspections, addInspections, addInspectionFile, createUnitInspection, updateInspection, deleteInspection, retryInspection, rereadInspection, readInspection, attachPhotos, photosPending, filtersFromInspection, fuelTokenOf, type FycInspection } from '../services/fyc';
import { useSignedUrls } from '../services/storageAccess';
import { buildFiche, publishFiche, prefetchTranslations, engineOfInspection, ficheLangOf, ficheFileName } from '../services/fycFiche';
import type { FycEditableField } from '../services/fyc';
import { saveOffer } from '../services/offers';
import { BUILTIN_COLUMNS, type ExportColumn } from '../lib/offers/exportColumns';
import type { OfferVehicle } from '../lib/offers/parseSupplierFile';
import { damageSummary } from '../lib/fycReport';
import { loadObservationsForStudy, loadSnapshots, pruneVanishedListings, latestPerListing, filterObservations, priceStats, attackPrice as miAttackPrice, canonKey, canonicalizeGearbox, fuelFilterMatches, FUEL_TOKEN_TO_CRITERIA, GEARBOX_LABELS, type MarketFilters, type Observation, type Snapshot, type GearboxToken } from '../services/marketData';
import { canonicalizeBody } from '../lib/study-core/bodyTypes';
import { BODY_TYPES } from '../lib/study-core/bodyTypes';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { loadNetwork, type NetworkContact } from '../services/network';
import { listLatestStockRuns, listStockVehicles, type LatestStockRun, type StockVehicle } from '../services/dealerStock';
import { COUNTRY_NAMES } from '../data/cities';
import { langOfCountry } from '../lib/fycPdf';

const FUEL_LABEL: Record<string, string> = { electric: 'Électrique', petrol: 'Essence', diesel: 'Diesel', hybrid: 'Hybride', mild_hybrid: 'Micro-hybride', phev: 'Hybride rechargeable', lpg: 'GPL', cng: 'GNV' };
const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR'));
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const LAST_COUNTRY_KEY = 'ada_fyc_country';
let snapshotsPromise: Promise<Snapshot[]> | null = null;
const snapshotsOnce = () => (snapshotsPromise ??= loadSnapshots().catch((e) => { snapshotsPromise = null; throw e; }));
const inp = 'px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white w-full';

/** `active` : la vue FYC est affichée (le switch MI | FYC) — au retour du MI, les annonces sont relues. */
export function FycView({ onOpenMarket, active = true }: { onOpenMarket: (f: MarketFilters) => void; active?: boolean }) {
  const { displayName, email } = useAuth();
  const [rows, setRows] = useState<FycInspection[]>([]);
  // Contacts de la Carte : le client comparé (liste des archives) et le choix du client cible (dossier).
  const [contacts, setContacts] = useState<NetworkContact[]>([]);
  useEffect(() => { void loadNetwork().then((n) => setContacts(n.contacts)); }, []);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => { if (active) setRefreshTick((t) => t + 1); }, [active]);
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
    // Photos des PDF lus par le worker (12/11) : ajoutées ici, une ligne à la fois, jamais bloquant.
    for (const row of r.rows) {
      if (photosPending(row) && !reading.current.has(row.id)) {
        reading.current.add(row.id);
        void attachPhotos(row).finally(() => { reading.current.delete(row.id); void reload(); });
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
  // SINGLE UNIT DANS LE FYC (12/11, Channing : « ajouter des single units dans le FYC, de la même manière que dans les
  // offres ») : même fenêtre, l'inspection est créée tout de suite (champs du bloc, photos de l'album), sans prix.
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitStatus, setUnitStatus] = useState<string | null>(null);
  const addUnits = async (units: SingleUnit[], opts: SingleUnitOptions) => {
    if (!units.length) return;
    setUnitBusy(true); setUnitStatus(null); setNotice(null);
    let ok = 0; const notes: string[] = []; let lastId: string | null = null;
    for (const u of units) {
      const label = `${u.brand} ${u.model}`;
      const r = await createUnitInspection(unitToInspectionFields(u), units.length === 1 ? opts.files : [], (st) => setUnitStatus(`${label} : ${st}`));
      if (r.error || !r.row) notes.push(`${label} : ${r.error ?? 'inspection non créée'}`); else { ok++; lastId = r.row.id; if (r.note) notes.push(`${label} : ${r.note}`); }
    }
    setUnitBusy(false); setUnitStatus(null); setUnitOpen(false);
    setNotice(`${ok} inspection${ok > 1 ? 's' : ''} créée${ok > 1 ? 's' : ''} depuis ${units.length > 1 ? 'les unités' : 'l\'unité'}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    await reload();
    if (lastId) setSelectedId(lastId);
  };
  const selected = rows.find((r) => r.id === selectedId) ?? shown[0] ?? null;
  const archive = async (r: FycInspection, on: boolean) => { await updateInspection(r.id, { archived_at: on ? new Date().toISOString() : null }); await reload(); };
  // SÉLECTION DE LIGNES (11/11, Channing : « sélectionner chacune des lignes d'inspection et les transférer dans
  // Offres ») : cases à cocher, barre d'actions ; la sélection reste quand on passe par Offres ou le MI (page gardée).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => setChecked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const checkedRows = shown.filter((r) => checked.has(r.id));
  const transferable = checkedRows.filter((r) => r.status === 'read');
  const [transferOpen, setTransferOpen] = useState(false);
  // CRAYON SUR LA LIGNE (11/11, Channing : « ajuster les infos de la voiture si l'inspection est inexacte ») : ouvre le
  // dossier avec la correction champ par champ dépliée.
  const [editRequest, setEditRequest] = useState(0);
  // TRANSFERT EN ARRIÈRE-PLAN (11/11, Channing : « cette page est très longue, il faudrait pouvoir la quitter sans
  // interrompre ») : le travail est porté par la vue (gardée montée), pas par la fenêtre — on peut la fermer, changer
  // d'onglet ; une bannière suit l'avancement et ouvre la liste à la fin.
  const [job, setJob] = useState<TransferJob | null>(null);
  const startTransfer = (rows: FycInspection[], title: string, prices: Record<string, number | null>) => {
    const init: TransferJob = { title, rows, prices, progress: {}, done: 0, running: true, offerId: null, error: null, notes: [] };
    setJob(init);
    const set = (patch: Partial<TransferJob> | ((j: TransferJob) => TransferJob)) => setJob((j) => (j ? (typeof patch === 'function' ? patch(j) : { ...j, ...patch }) : j));
    void (async () => {
      try {
        await prefetchTranslations(rows.map((r) => ({ insp: r, lang: ficheLangOf(r) })));
        const vehicles: OfferVehicle[] = [];
        for (const r of rows) {
          const lang = ficheLangOf(r);
          const { blob, note } = await buildFiche(r, lang, { name: displayName || email || '', email: email ?? null }, (s) => set((j) => ({ ...j, progress: { ...j.progress, [r.id]: s } })));
          if (note) set((j) => ({ ...j, notes: [...j.notes, `${[r.brand, r.model].filter(Boolean).join(' ')} : ${note}`] }));
          set((j) => ({ ...j, progress: { ...j.progress, [r.id]: 'publication…' } }));
          const pub = await publishFiche(r, lang, blob);
          if (pub.error) throw new Error(pub.error);
          set((j) => ({ ...j, done: j.done + 1, progress: { ...j.progress, [r.id]: `fiche ${lang.toUpperCase()} publiée` } }));
          vehicles.push({
            id: r.vin ?? r.id, vin: r.vin, brand: (r.brand ?? '').toUpperCase(), model: r.model ?? '', version: r.version ?? '', reg_date: r.first_registration, year: r.year, km: r.km,
            color: r.color, fuel: r.fuel, engine: engineOfInspection(r), power_ch: r.power_ch, gearbox: r.gearbox, co2: null, damages: r.repair_cost ?? null, report_url: pub.url, location: null,
            // Lien du rapport d'origine gardé en colonne libre : « Fiches MC Export » dans l'offre repart de lui, jamais de notre fiche (12/11).
            price_ht: null, price_ttc: null, vat_recoverable: null, imported: null, extras: isExternalReport(r.source_url) ? { [SUPPLIER_REPORT_KEY]: r.source_url } : {}, selected: true, sale_price: prices[r.id] ?? null, quantity: 1,
          });
        }
        const today = new Date().toLocaleDateString('fr-FR');
        const cols: ExportColumn[] = (['vehicle', 'reg', 'km', 'damages', 'vin', 'price', 'report'] as const).map((k) => ({ id: k, builtin: k, label: BUILTIN_COLUMNS[k].label }));
        const saved = await saveOffer({ title, supplier: 'FYC — inspections', source_filename: '', layout: 'flat', mappings: [], vehicles, price_rule: { mode: 'margin', margin: 0 }, countries: [], notes: `Créée depuis le FYC le ${today} (${rows.length} inspection${rows.length > 1 ? 's' : ''}). Prix de revente saisis au transfert ; fiche PDF MC Export de chaque véhicule en dernière colonne.`, status: 'draft', export_columns: cols });
        if (saved.error || !saved.id) throw new Error(saved.error ?? 'offre non créée');
        set({ running: false, offerId: saved.id });
        setChecked(new Set());
      } catch (e) { set({ running: false, error: e instanceof Error ? e.message : String(e) }); }
    })();
  };
  const openOffer = (id: string) => window.history.pushState({}, '', `/offres?offer=${id}&view=export`);
  // ARCHIVER / REMETTRE EN COURS EN LOT (12/11, Channing : « relancer en inspection en cours des véhicules qui sont
  // dans les archives ») : la sélection de l'onglet courant bascule d'un coup.
  const archiveChecked = async (on: boolean) => {
    for (const r of checkedRows) await updateInspection(r.id, { archived_at: on ? new Date().toISOString() : null });
    setNotice(`${checkedRows.length} inspection${checkedRows.length > 1 ? 's' : ''} ${on ? 'archivée' : 'remise en cours'}${checkedRows.length > 1 ? 's' : ''}.`);
    setChecked(new Set());
    await reload();
  };
  const rereadChecked = async () => {
    let n = 0;
    for (const r of checkedRows) if (r.status === 'read' && r.pdf_path) { const err = await rereadInspection(r); if (!err) n++; }
    setNotice(`${n} rapport${n > 1 ? 's' : ''} en relecture (champs et photos), quelques secondes chacun.`);
    await reload();
  };

  return (
    <div className="space-y-5">
      {/* Inspections */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <button onClick={() => setTab('current')} className={`px-2.5 py-1 rounded-md ${tab === 'current' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Inspections en cours · {rows.filter((r) => !r.archived_at).length}</button>
            <button onClick={() => setTab('archives')} className={`px-2.5 py-1 rounded-md flex items-center gap-1 ${tab === 'archives' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Archive className="w-3.5 h-3.5" /> Archives · {rows.filter((r) => !!r.archived_at).length}</button>
          </div>
          <span className="text-xs text-slate-500">{tab === 'current' ? 'Colle un lien de rapport (VTI / Macadam, page DEKRA partagée), un par ligne, ou dépose le fichier du rapport (PDF, export .docx de VWFS). Ada en sort la voiture, les photos et les défauts.' : 'Les dossiers archivés : un clic sur une ligne rouvre tout le FYC (prix, marché, client).'}</span>
          <button onClick={() => void reload()} className="ml-auto text-xs text-brand-ocean hover:underline flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button>
        </div>
        {tab === 'current' && <div className="flex gap-2 items-start flex-wrap">
          <textarea value={addText} onChange={(e) => setAddText(e.target.value)} rows={2} placeholder="https://admin.vti-easi.eu/reportviewer/… ou https://cdn-prod.dekra-starfleet.com/secure/…" className={`${inp} flex-1 min-w-[320px] font-mono text-xs`} />
          <button onClick={() => void add()} disabled={adding || !addText.trim()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">{adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} Lire les rapports</button>
          <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileInput.current?.click()} disabled={adding} title="Un rapport exporté en fichier : PDF, ou .docx (export GIS@WEB de VWFS)" className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileUp className="w-4 h-4" /> Déposer un fichier (PDF, DOCX)</button>
          <button onClick={() => setUnitOpen(true)} disabled={adding} title="Une single unit : bloc texte collé + album photos" className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-brand-ocean bg-white text-brand-ocean hover:bg-blue-50 disabled:opacity-50"><Car className="w-4 h-4" /> Unité</button>
        </div>}
        {(unitOpen || unitBusy) && <SingleUnitModal mode="fyc" busy={unitBusy} status={unitStatus} hidden={!unitOpen} onAdd={(units, opts) => { void addUnits(units, opts); }} onClose={() => setUnitOpen(false)} />}
        {unitBusy && !unitOpen && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 text-brand-encre px-4 py-2.5 text-sm flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="flex-1 truncate">Single unit en cours{unitStatus ? ` — ${unitStatus}` : '…'}</span>
            <button onClick={() => setUnitOpen(true)} className="text-sm font-medium underline-offset-2 hover:underline">Voir</button>
          </div>
        )}
        {notice && <p className="text-xs text-slate-600">{notice}</p>}
        {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
        {loading ? <p className="text-sm text-slate-400 py-4 text-center">Chargement…</p> : shown.length === 0 ? (
          <p className="text-sm text-slate-500">{tab === 'current' ? 'Aucune inspection en cours.' : 'Aucun dossier archivé.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tab === 'archives'
                ? <thead><tr className="text-left text-xs text-slate-400"><th className="py-2 pr-2 w-6"><input type="checkbox" checked={shown.length > 0 && shown.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} className="rounded border-slate-300" /></th><th className="py-2 pr-3">Inspection analysée</th><th className="py-2 pr-3">Année · km</th><th className="py-2 pr-3 text-right">Prix d'achat</th><th className="py-2 pr-3 text-right">Prix d'attaque</th><th className="py-2 pr-3">Client comparé</th><th className="py-2 pr-3">Archivée</th><th></th></tr></thead>
                : <thead><tr className="text-left text-xs text-slate-400"><th className="py-2 pr-2 w-6"><input type="checkbox" checked={shown.length > 0 && shown.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} className="rounded border-slate-300" /></th><th className="py-2 pr-3">Véhicule (du rapport)</th><th className="py-2 pr-3">1re immat.</th><th className="py-2 pr-3 text-right">Km</th><th className="py-2 pr-3 text-right">Ch</th><th className="py-2 pr-3">Énergie · boîte</th><th className="py-2 pr-3">État</th><th className="py-2 pr-3 text-right">Achat</th><th className="py-2 pr-3 text-right">Attaque</th><th className="py-2 pr-3">Par</th><th></th></tr></thead>}
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const car = [r.brand, r.model].filter(Boolean).join(' ');
                  const sel = selected?.id === r.id;
                  // ARCHIVES (11/11, Channing : « juste la liste des inspections analysées, le prix d'achat, le prix
                  // d'attaque, client comparé ») : une ligne compacte ; le clic rouvre tout le dossier.
                  if (tab === 'archives') {
                    const cl = r.client_contact_id ? contacts.find((c) => c.id === r.client_contact_id) : null;
                    return (
                      <tr key={r.id} onClick={() => setSelectedId(r.id)} className={`cursor-pointer ${sel ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
                        <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} className="rounded border-slate-300" /></td>
                        <td className="py-2 pr-3"><div className="font-medium text-slate-900">{car || 'Rapport non lu'}</div><div className="text-[11px] text-slate-500">{[r.fuel, r.gearbox, r.power_ch ? `${r.power_ch} ch` : null].filter(Boolean).join(' · ')}{r.vin ? ` · VIN ${r.vin}` : ''}</div></td>
                        <td className="py-2 pr-3 whitespace-nowrap">{r.year ?? '—'} · {fmtNum(r.km)} km</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtEur(r.purchase_price)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-slate-900">{fmtEur(r.attack_price)}</td>
                        <td className="py-2 pr-3">{cl ? `${cl.name} (${COUNTRY_NAMES[cl.country] ?? cl.country})` : r.client_contact_id ? 'contact retiré de la Carte' : <span className="text-slate-400">aucun</span>}</td>
                        <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.archived_at)}<br />{r.created_by_name || ''}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button onClick={(e) => { e.stopPropagation(); void archive(r, false); }} title="Remettre en cours" className="inline-flex p-1 text-slate-400 hover:text-brand-ocean"><ArchiveRestore className="w-4 h-4" /></button>
                          <button onClick={async (e) => { e.stopPropagation(); if (!confirm('Supprimer cette inspection de FYC ?')) return; await deleteInspection(r.id); if (selectedId === r.id) setSelectedId(null); await reload(); }} title="Supprimer" className="inline-flex p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.id} onClick={() => setSelectedId(r.id)} className={`cursor-pointer ${sel ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
                      <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} className="rounded border-slate-300" /></td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-900">{car || (r.status === 'failed' ? 'Rapport non lu' : 'Lecture en cours…')}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[360px]">{r.vin ? `VIN ${r.vin} · ` : ''}{r.report_number ? `rapport n° ${r.report_number} du ${fmtDate(r.report_date)}` : r.source_url}</div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.first_registration)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.km)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.power_ch ?? '—'}</td>
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
                        {r.status === 'read' && <button onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); setEditRequest((n) => n + 1); }} title="Corriger les données de la voiture (marque, modèle, immat., km, énergie, boîte, puissance…)" className="inline-flex p-1 text-slate-400 hover:text-brand-ocean"><Pencil className="w-4 h-4" /></button>}
                        {r.status === 'read' && r.pdf_path && <button onClick={async (e) => { e.stopPropagation(); const err = await rereadInspection(r); setNotice(err ?? 'Rapport relu dans quelques secondes (champs et photos).'); await reload(); }} title={r.photos.length ? `Relire le rapport (champs et ${r.photos.length} photos)` : 'Relire le rapport : champs et photos (dossier lu avant les photos)'} className={`inline-flex p-1 ${r.photos.length ? 'text-slate-400' : 'text-amber-500'} hover:text-brand-ocean`}><Images className="w-4 h-4" /></button>}
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
        {checkedRows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-700">{checkedRows.length} sélectionnée{checkedRows.length > 1 ? 's' : ''}{transferable.length < checkedRows.length ? ` (${checkedRows.length - transferable.length} non lue${checkedRows.length - transferable.length > 1 ? 's' : ''}, ignorée${checkedRows.length - transferable.length > 1 ? 's' : ''})` : ''}</span>
            <button onClick={() => setTransferOpen(true)} disabled={transferable.length === 0} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50"><Send className="w-4 h-4" /> Transférer dans Offres ({transferable.length})</button>
            <button onClick={() => void rereadChecked()} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><Images className="w-4 h-4" /> Relire les rapports</button>
            {tab === 'archives'
              ? <button onClick={() => void archiveChecked(false)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><ArchiveRestore className="w-4 h-4" /> Remettre en cours ({checkedRows.length})</button>
              : <button onClick={() => void archiveChecked(true)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><Archive className="w-4 h-4" /> Archiver ({checkedRows.length})</button>}
            <button onClick={() => setChecked(new Set())} className="ml-auto text-xs text-slate-500 hover:underline">Tout décocher</button>
          </div>
        )}
      </div>

      {job && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-3 flex-wrap ${job.error ? 'bg-red-50 border-red-200 text-red-800' : job.offerId ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
          {job.running ? <Loader2 className="w-4 h-4 animate-spin" /> : job.error ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          <span className="font-medium">Transfert vers Offres « {job.title} »</span>
          <span>{job.running ? `${job.done} / ${job.rows.length} fiches publiées — ${Object.values(job.progress).slice(-1)[0] ?? 'préparation…'} — tu peux changer de page, ça continue.` : job.error ? `échec : ${job.error}` : `${job.done} fiches publiées, liste créée.`}</span>
          {job.offerId && <button onClick={() => openOffer(job.offerId!)} className="text-sm px-3 py-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white">Ouvrir la liste</button>}
          {job.running && <button onClick={() => setTransferOpen(true)} className="text-xs underline">détail</button>}
          {!job.running && <button onClick={() => setJob(null)} className="ml-auto text-xs text-slate-500 hover:underline">Fermer</button>}
        </div>
      )}
      {transferOpen && (job?.running || transferable.length > 0) && <TransferModal rows={job?.running ? job.rows : transferable} contacts={contacts} job={job} onStart={(title, prices) => { startTransfer(transferable, title, prices); }} onClose={() => setTransferOpen(false)} />}

      {selected && selected.status === 'read' && <InspectionPanel key={selected.id} insp={selected} contacts={contacts} refreshTick={refreshTick} editRequest={editRequest} onChanged={reload} onOpenMarket={onOpenMarket} author={displayName || email || ''} authorEmail={email ?? null} />}
      {selected && selected.status === 'failed' && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 inline mr-1" /> Rapport non lu : {selected.error ?? 'sans détail'}. Vérifie le lien (il doit ouvrir le rapport sans mot de passe), puis « Réessayer ».</p>}
    </div>
  );
}

function InspectionPanel({ insp, contacts, refreshTick, editRequest, onChanged, onOpenMarket, author, authorEmail }: { insp: FycInspection; contacts: NetworkContact[]; refreshTick: number; editRequest: number; onChanged: () => Promise<void>; onOpenMarket: (f: MarketFilters) => void; author: string; authorEmail: string | null }) {
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
  const [obsTick, setObsTick] = useState(0);
  useEffect(() => {
    if (!filters.brand || !filters.country) { setObs(null); return; }
    const t = setTimeout(() => {
      setObsLoading(true);
      loadObservationsForStudy({ ...filters, trim: undefined, yearMin: null, yearMax: null, mileageMax: null, powerMin: null, gearbox: undefined, vehicleType: undefined, fuel: undefined })
        .then((o) => setObs(o)).catch(() => setObs([])).finally(() => setObsLoading(false));
    }, 800);
    return () => clearTimeout(t);
  }, [filters.brand, filters.model, filters.country, filters.site, refreshTick, obsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Les scans (couverture) : comme le MI, une annonce absente du dernier scan de son segment est sortie de l'état du
  // marché. Chargés une fois par session (même jeu que la page MI).
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  useEffect(() => { if (obs && !snapshots) void snapshotsOnce().then(setSnapshots).catch(() => setSnapshots([])); }, [obs, snapshots]);
  const market = useMemo(() => {
    if (!obs) return null;
    // EXACTEMENT LES CHIFFRES DU MI (11/11, Channing : « le MI ne colle pas avec ce qu'on a dans le FYC ») : mêmes
    // filtres (filterObservations), dernière observation par annonce, annonces disparues écartées
    // (pruneVanishedListings), prix d'attaque par la même règle sur le même jeu. Plus de règle cachée « année ±1,
    // km ±30 % » : les comparables, ce sont les filtres affichés, modifiables.
    const inBase = latestPerListing(obs).length;
    const latest = pruneVanishedListings(latestPerListing(filterObservations(obs, filters)), snapshots ?? [], obs);
    const stats = priceStats(latest);
    const mi = miAttackPrice(latest);
    const effective = typedAttack ?? mi?.price ?? null;
    const priced = latest.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    const below = effective != null ? priced.filter((p) => p < effective).length : 0;
    const pct = effective != null && priced.length ? Math.round((below / priced.length) * 100) : null;
    const lastScan = latest.reduce<string | null>((m, o) => (!m || o.scraped_at > m ? o.scraped_at : m), null);
    const position = effective == null || pct == null ? 'pas d\'annonce avec prix' : pct === 0 ? 'sous toutes les annonces' : `${pct} % des annonces sont moins chères`;
    return { inBase, latest, stats, mi, effective, pct, lastScan, position, cheapest: [...latest].filter((o) => o.price).sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, 5) };
  }, [obs, snapshots, filtersKey, typedAttack]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Le prix d'attaque EFFECTIF : saisi, sinon celui que le MI calcule sur les mêmes annonces. */
  const attackPrice = typedAttack ?? market?.mi?.price ?? null;
  const attackFromMi = typedAttack == null && market?.mi != null;
  const takeMiPrice = async () => { if (!market?.mi) return; setAttack(String(market.mi.price)); await updateInspection(insp.id, { attack_price: market.mi.price }); await onChanged(); };

  // ── Client cible : vitrines lues seulement.
  const [runs, setRuns] = useState<Map<string, LatestStockRun>>(new Map());
  useEffect(() => { void listLatestStockRuns().then((r) => setRuns(r)); }, []);
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
  // STOCK DU CLIENT AUX MÊMES CRITÈRES QUE LE MARCHÉ (11/11, Channing : « il ne faut pas comparer un 2015 avec un
  // 2026 : prendre en compte au moins le kilométrage et l'année, plus si on peut ») : années, km max, énergie, boîte,
  // carrosserie, puissance et finition des filtres MI, appliqués au stock relevé (valeurs canonisées, une donnée
  // absente sur la voiture du client ne l'écarte pas). Désactivable d'un clic pour revoir tout son stock du modèle.
  const [sameCriteria, setSameCriteria] = useState(true);
  const clientAll = useMemo(() => {
    if (!stock) return [];
    const b = canonKey(insp.brand ?? ''); const m = canonKey(insp.model ?? '');
    return stock.filter((v) => !v.gone_at && canonKey(v.brand ?? '') === b && (!m || canonKey(v.model ?? '').includes(m) || m.includes(canonKey(v.model ?? '')))).sort((a, c) => (a.price ?? 1e12) - (c.price ?? 1e12));
  }, [stock, insp.brand, insp.model]);
  const clientRows = useMemo(() => {
    if (!sameCriteria) return clientAll;
    const gb = filters.gearbox ? canonicalizeGearbox(filters.gearbox) : '';
    const body = filters.vehicleType ? canonicalizeBody(filters.vehicleType) : '';
    const trim = (filters.trim ?? '').trim().toLowerCase();
    return clientAll.filter((v) =>
      (filters.yearMin == null || v.year == null || v.year >= filters.yearMin)
      && (filters.yearMax == null || v.year == null || v.year <= filters.yearMax)
      && (filters.mileageMax == null || v.km == null || v.km <= filters.mileageMax)
      && (!filters.fuel || !v.fuel || !fuelTokenOf(v.fuel) || fuelFilterMatches(fuelTokenOf(v.fuel) ?? '', filters.fuel))
      && (!gb || !canonicalizeGearbox(v.gearbox) || canonicalizeGearbox(v.gearbox) === gb)
      && (!body || !canonicalizeBody(v.body) || canonicalizeBody(v.body) === body)
      && (filters.powerMin == null || v.power_ch == null || v.power_ch >= filters.powerMin)
      && (!trim || `${v.title ?? ''}`.toLowerCase().includes(trim)));
  }, [clientAll, sameCriteria, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const criteriaLabel = [filters.yearMin != null || filters.yearMax != null ? `${filters.yearMin ?? '…'}–${filters.yearMax ?? '…'}` : null, filters.mileageMax != null ? `≤ ${fmtNum(filters.mileageMax)} km` : null, filters.fuel ? FUEL_LABEL[filters.fuel] ?? filters.fuel : null, filters.gearbox ? GEARBOX_LABELS[filters.gearbox as GearboxToken] ?? filters.gearbox : null, filters.vehicleType || null, filters.powerMin != null ? `≥ ${filters.powerMin} ch` : null, filters.trim || null].filter(Boolean).join(' · ');
  const clientPrices = clientRows.map((v) => v.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const clientMin = clientPrices.length ? clientPrices[0] : null;
  const clientMedian = clientPrices.length ? clientPrices[Math.floor(clientPrices.length / 2)] : null;
  const chooseClient = async (id: string | null) => { setClientId(id); await updateInspection(insp.id, { client_contact_id: id }); };

  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const pdfLang = langOfCountry(filters.country);
  const photoUrls = useSignedUrls(insp.photos);
  const defectUrls = useSignedUrls(insp.defect_photos.map((d) => d.path));
  /** Fiche PDF (services/fycFiche.ts) : photos, dommages, valeurs traduites (attente du worker ≤ 90 s). */
  const exportPdf = async () => {
    setExportNote(null);
    try {
      const { blob, note } = await buildFiche(insp, pdfLang, { name: author, email: authorEmail }, setExporting);
      if (note) { setExportNote(note); void onChanged(); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ficheFileName(insp, pdfLang); a.click(); URL.revokeObjectURL(a.href);
    } finally { setExporting(null); }
  };

  const car = [insp.brand, insp.model].filter(Boolean).join(' ');
  // DONNÉES CORRIGEABLES (11/11, Channing : « certaines inspections sont incomplètes, modifier les infos ligne par
  // ligne, critère par critère ») : chaque champ du rapport se corrige ici, enregistré à la sortie du champ ; ouvert
  // d'office quand le modèle manque (3 Bigster DEKRA sans titre).
  const [editData, setEditData] = useState(!insp.model);
  const editRequestSeen = useRef(editRequest);
  useEffect(() => { if (editRequest !== editRequestSeen.current) { editRequestSeen.current = editRequest; setEditData(true); } }, [editRequest]);
  return (
    <div className="space-y-5">
      {/* Voiture + nos prix */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-slate-900">{car || 'Modèle absent du rapport'} — nos prix</h2>
          <button onClick={() => setEditData((v) => !v)} className={`text-xs px-2 py-1 rounded-lg border ${editData ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`} title="Corriger les données lues dans le rapport, champ par champ">{editData ? 'Fermer la correction' : 'Corriger les données'}</button>
          {insp.archived_at && <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">archivée le {fmtDate(insp.archived_at)}</span>}
          <span className="text-xs text-slate-500">{insp.year ?? '—'} · {fmtNum(insp.km)} km · {insp.fuel ?? '—'} · {insp.gearbox ?? '—'}{insp.power_ch ? ` · ${insp.power_ch} ch` : ''}{insp.color ? ` · ${insp.color}` : ''}</span>
          <button onClick={() => void exportPdf()} disabled={!!exporting} title={`Fiche véhicule à la charte MC Export, dans la langue du pays cible (${pdfLang.toUpperCase()}) : photos, données, équipements, pneus, état (valeurs traduites), notre prix d'attaque, nos coordonnées — jamais le prix d'achat ni les notes`} className="ml-auto flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {exporting ?? `Fiche PDF client (${pdfLang.toUpperCase()})`}</button>
        </div>
        {editData && <FieldEditor insp={insp} onChanged={onChanged} />}
        {exportNote && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{exportNote}</p>}
        {(photoUrls.length > 0 || defectUrls.length > 0) && <div className="flex gap-2 overflow-x-auto">
          {photoUrls.map((u, i) => <a key={`p${i}`} href={u} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt="" className="h-20 w-auto rounded-md border border-slate-200 object-cover" /></a>)}
          {defectUrls.map((u, i) => <a key={`d${i}`} href={u} target="_blank" rel="noreferrer" title={insp.defect_photos[i]?.caption ?? ''} className="shrink-0 relative"><img src={u} alt="" className="h-20 w-auto rounded-md border-2 border-orange-300 object-cover" /><span className="absolute bottom-0 left-0 right-0 text-[9px] leading-tight bg-orange-50/90 text-orange-900 px-1 truncate rounded-b-md">{insp.defect_photos[i]?.caption ?? ''}</span></a>)}
        </div>}
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
          <button onClick={() => setObsTick((t) => t + 1)} disabled={obsLoading} title="Relire les annonces en base (après une recherche MI)" className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${obsLoading ? 'animate-spin' : ''}`} /> Annonces</button>
          <button onClick={() => onOpenMarket(filters)} disabled={!filters.country || !filters.brand} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50"><Search className="w-4 h-4" /> Voir dans le MI (lance la recherche)</button>
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
              <Tile label={`Annonces · ${COUNTRY_NAMES[filters.country ?? ''] ?? filters.country} · mêmes filtres que le MI`} value={String(market.latest.length)} hint={market.stats.count ? `de ${fmtEur(market.stats.min)} à ${fmtEur(market.stats.max)} · P25–P75 ${fmtEur(market.stats.p25)} – ${fmtEur(market.stats.p75)}${market.lastScan ? ` · scan ${fmtDate(market.lastScan)}` : ''}` : 'aucune annonce avec prix'} />
              <Tile label={attackFromMi ? 'Prix d\'attaque proposé par le MI' : 'Notre prix d\'attaque'} value={fmtEur(attackPrice)} hint={`${market.position}${attackFromMi && market.mi ? ` · règle MI sur les ${market.mi.window} moins chères — saisis le tien pour le remplacer` : !attackFromMi && market.mi ? ` · le MI proposerait ${fmtEur(market.mi.price)}` : ''}`} strong />
            </div>
            {market.stats.count > 0 && <PriceStrip stats={market.stats} prices={market.latest.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0)} ours={attackPrice} mi={market.mi?.price ?? null} typed={typedAttack != null} />}
            <p className="text-xs text-slate-500">Les 5 moins chères (mêmes annonces que le MI) : {market.cheapest.map((o, i) => <span key={i}>{i ? ' · ' : ''}{o.listing_url ? <a href={o.listing_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline">{fmtEur(o.price)}</a> : fmtEur(o.price)} ({o.year ?? '—'}, {fmtNum(o.mileage)} km)</span>)}</p>
          </>
        ) : market ? <p className="text-sm text-slate-500">{market.inBase > 0 ? `${market.inBase} annonces en base pour ${filters.brand} ${filters.model ?? ''} (${COUNTRY_NAMES[filters.country ?? ''] ?? filters.country}), aucune ne passe les filtres (énergie, boîte, carrosserie, années, km, puissance) : assouplis-les, ou lance la recherche dans le MI.` : 'Aucune annonce en base pour ce modèle dans ce pays : clique « Voir dans le MI (lance la recherche) », puis reviens ici (les annonces sont relues au retour).'}</p> : <p className="text-sm text-slate-500">Choisis un pays et une marque.</p>}
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
                <Tile label={sameCriteria ? `${car} comparables (critères du marché)` : `${car} en stock`} value={String(clientRows.length)} hint={clientRows.length ? `de ${fmtEur(clientMin)} à ${fmtEur(clientPrices[clientPrices.length - 1])}${sameCriteria ? ` · ${clientAll.length} ${car} au total` : ''}` : sameCriteria ? `aucun aux critères du marché · ${clientAll.length} ${car} au total` : 'aucun exemplaire'} />
                <Tile label="Leur prix le plus bas / médiane" value={fmtEur(clientMin)} hint={`médiane ${fmtEur(clientMedian)}`} />
                <Tile label={attackFromMi ? 'Prix d\'attaque proposé par le MI' : 'Notre prix d\'attaque'} value={fmtEur(attackPrice)} hint={attackPrice != null && clientMin != null ? (attackPrice < clientMin ? `${Math.round(((clientMin - attackPrice) / clientMin) * 100)} % sous leur prix le plus bas` : `${Math.round(((attackPrice - clientMin) / clientMin) * 100)} % au-dessus de leur prix le plus bas`) : attackPrice == null ? 'ni saisi, ni calculable (pas d\'annonce en base)' : 'pas de comparable chez lui'} strong />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={sameCriteria} onChange={(e) => setSameCriteria(e.target.checked)} className="rounded border-slate-300" />
                Mêmes critères que le marché cible{criteriaLabel ? ` (${criteriaLabel})` : ' (aucun critère saisi : tout le stock du modèle)'} — une voiture du client sans la donnée n'est pas écartée
              </label>
              {clientRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-400"><th className="py-1.5 pr-3">Chez le client</th><th className="py-1.5 pr-3">Année</th><th className="py-1.5 pr-3 text-right">Km</th><th className="py-1.5 pr-3 text-right">Ch</th><th className="py-1.5 pr-3">Énergie · boîte</th><th className="py-1.5 pr-3 text-right">Prix affiché</th><th className="py-1.5 pr-3 text-right">Écart vs notre attaque</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {clientRows.slice(0, 25).map((v) => (
                        <tr key={v.id}>
                          <td className="py-1.5 pr-3">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="text-slate-800 hover:text-brand-ocean hover:underline">{v.title ?? [v.brand, v.model].filter(Boolean).join(' ')}</a> : v.title}</td>
                          <td className="py-1.5 pr-3">{v.year ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtNum(v.km)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{v.power_ch ?? '—'}</td>
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
        {client && stock && clientRows.length === 0 && clientAll.length > 0 && sameCriteria && (
          <p className="text-sm text-slate-600">Aucun {car} de son stock ne répond aux critères du marché ({criteriaLabel || 'aucun'}) : élargis les filtres ci-dessus, ou décoche pour voir ses {clientAll.length} {car}.</p>
        )}
        {client && stock && clientRows.length > 0 && attackPrice != null && clientMin != null && (
          <p className="text-sm"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs font-medium ${attackPrice < clientMin ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-orange-50 text-orange-800 border-orange-200'}`}>{attackPrice < clientMin ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} {attackPrice < clientMin ? 'Notre prix passe sous tout son stock comparable' : 'Notre prix est au-dessus de son exemplaire le moins cher'}</span></p>
        )}
      </div>
    </div>
  );
}

/** TRANSFERT VERS OFFRES (11/11, Channing : « les transférer dans Offres avec marque, modèle, 1re immatriculation,
 *  kilométrage, dommages estimés (vide s'il n'y en a pas), VIN, prix de revente (à demander avant d'envoyer),
 *  puis le lien de la fiche PDF MC Export ; chaque envoi = une nouvelle liste, avec un titre »). La fiche de chaque
 *  véhicule est construite ici (photos, dommages, traduction dans la langue de son pays cible), publiée dans le
 *  bucket public fyc-fiches, et l'offre créée s'ouvre dans l'onglet Offres. */
/** Les champs du rapport, un par un : texte, nombre ou date ; enregistré à la sortie du champ (vide = inconnu). */
const EDIT_FIELDS: Array<{ key: FycEditableField; label: string; kind: 'text' | 'number' | 'date' }> = [
  { key: 'brand', label: 'Marque', kind: 'text' }, { key: 'model', label: 'Modèle', kind: 'text' }, { key: 'version', label: 'Version', kind: 'text' }, { key: 'vin', label: 'VIN', kind: 'text' },
  { key: 'first_registration', label: '1re immatriculation', kind: 'date' }, { key: 'year', label: 'Année', kind: 'number' }, { key: 'km', label: 'Kilométrage', kind: 'number' },
  { key: 'fuel', label: 'Énergie', kind: 'text' }, { key: 'gearbox', label: 'Boîte', kind: 'text' }, { key: 'power_ch', label: 'Puissance (ch)', kind: 'number' },
  { key: 'body', label: 'Carrosserie', kind: 'text' }, { key: 'color', label: 'Couleur', kind: 'text' }, { key: 'doors', label: 'Portes', kind: 'number' }, { key: 'seats', label: 'Places', kind: 'number' },
  { key: 'repair_cost', label: 'Dommages estimés (€)', kind: 'number' }, { key: 'asking_price', label: 'Prix demandé (€)', kind: 'number' },
  { key: 'report_number', label: 'N° de rapport', kind: 'text' }, { key: 'report_date', label: 'Date du rapport', kind: 'date' },
];
function FieldEditor({ insp, onChanged }: { insp: FycInspection; onChanged: () => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, insp[f.key] == null ? '' : String(insp[f.key])])));
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (f: typeof EDIT_FIELDS[number]) => {
    const raw = (vals[f.key] ?? '').trim();
    const cur = insp[f.key] == null ? '' : String(insp[f.key]);
    if (raw === cur) return;
    let v: string | number | null = raw === '' ? null : raw;
    if (f.kind === 'number' && v != null) { const n = Number(String(v).replace(/[^\d.]/g, '')); if (!Number.isFinite(n)) return; v = n; }
    const err = await updateInspection(insp.id, { [f.key]: v } as Partial<Pick<FycInspection, FycEditableField>>);
    setSaved(err ? `${f.label} : ${err}` : `${f.label} enregistré`);
    if (!err) await onChanged();
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs text-slate-600">Corrige ce qui manque ou qui est faux ; chaque champ s'enregistre quand tu le quittes et part dans la fiche, les filtres MI et le transfert vers Offres. Vide = inconnu.</p>
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs text-slate-600">
        {EDIT_FIELDS.map((f) => (
          <label key={f.key}>{f.label}<input type={f.kind === 'date' ? 'date' : 'text'} value={vals[f.key] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} onBlur={() => void save(f)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${inp} mt-1 ${f.kind === 'number' ? 'text-right' : ''} ${!(vals[f.key] ?? '').trim() ? 'border-amber-300' : ''}`} /></label>
        ))}
      </div>
      {saved && <p className="text-[11px] text-slate-500">{saved}</p>}
    </div>
  );
}

interface TransferJob { title: string; rows: FycInspection[]; prices: Record<string, number | null>; progress: Record<string, string>; done: number; running: boolean; offerId: string | null; error: string | null; notes: string[] }

function TransferModal({ rows, contacts, job, onStart, onClose }: { rows: FycInspection[]; contacts: NetworkContact[]; job: TransferJob | null; onStart: (title: string, prices: Record<string, number | null>) => void; onClose: () => void }) {
  const today = new Date().toLocaleDateString('fr-FR');
  const running = !!job?.running;
  const [title, setTitle] = useState(() => { const cl = rows.map((r) => contacts.find((c) => c.id === r.client_contact_id)?.name).filter(Boolean); return cl.length ? `${cl[0]} — ${today}` : `Inspections FYC — ${today}`; });
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.attack_price != null ? String(r.attack_price) : ''])));
  const progress = job?.progress ?? {};
  const error = job?.error ?? null;
  const notes = job?.notes ?? [];
  const num = (s: string) => { const n = Number((s ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  const missing = rows.filter((r) => num(prices[r.id]) == null);
  const run = () => { onStart(title.trim() || `Inspections FYC — ${today}`, Object.fromEntries(rows.map((r) => [r.id, num(prices[r.id])]))); };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">Transférer dans Offres — nouvelle liste</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700" title={running ? 'Fermer : le transfert continue en arrière-plan' : 'Fermer'}><X className="w-4 h-4" /></button>
        </div>
        {running && <p className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">{job!.done} / {rows.length} fiches publiées. Tu peux fermer cette fenêtre ou changer de page : le transfert continue, la bannière du FYC ouvrira la liste à la fin.</p>}
        <p className="text-xs text-slate-500">Chaque envoi crée une nouvelle liste dans Offres : marque, modèle, 1re immatriculation, kilométrage, dommages estimés (vide si le rapport n'en chiffre pas), VIN, prix de revente, puis le lien de la fiche PDF MC Export de chaque véhicule (publiée, ouvrable par le client sans compte, dans la langue de son pays cible).</p>
        <label className="block text-xs text-slate-600">Titre de la liste<input value={running ? job!.title : title} onChange={(e) => setTitle(e.target.value)} disabled={running} className={`${inp} mt-1`} /></label>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400"><th className="py-1.5 pr-3">Véhicule</th><th className="py-1.5 pr-3">1re immat. · km</th><th className="py-1.5 pr-3">VIN</th><th className="py-1.5 pr-3 text-right">Dommages (€)</th><th className="py-1.5 pr-3 text-right">Prix de revente (€)</th><th className="py-1.5 pr-3">Fiche</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5 pr-3 font-medium text-slate-900">{[r.brand, r.model].filter(Boolean).join(' ')}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.first_registration)} · {fmtNum(r.km)}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-500">{r.vin ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.repair_cost != null ? fmtNum(r.repair_cost) : ''}</td>
                <td className="py-1.5 pr-3 text-right"><input value={running ? String(job!.prices[r.id] ?? '') : (prices[r.id] ?? '')} onChange={(e) => setPrices((p) => ({ ...p, [r.id]: e.target.value }))} placeholder={r.attack_price != null ? String(r.attack_price) : 'à saisir'} disabled={running} className={`${inp} text-right w-32 inline-block ${!running && num(prices[r.id]) == null ? 'border-amber-400' : ''}`} /></td>
                <td className="py-1.5 pr-3 text-xs text-slate-500 whitespace-nowrap">{progress[r.id] ?? `PDF ${ficheLangOf(r).toUpperCase()}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!running && missing.length > 0 && <p className="text-xs text-amber-800">{missing.length} prix de revente manquant{missing.length > 1 ? 's' : ''} : le prix d'attaque est proposé quand il existe, sinon saisis-le.</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {notes.map((n, i) => <p key={i} className="text-xs text-amber-800">{n}</p>)}
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">{running ? 'Fermer (continue en arrière-plan)' : 'Annuler'}</button>
          <button onClick={run} disabled={running || missing.length > 0 || !title.trim()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {running ? `Fiches en cours… ${job!.done} / ${rows.length}` : `Créer la liste (${rows.length})`}</button>
        </div>
      </div>
    </div>
  );
}

/** LE MARCHÉ EN UNE BANDE (11/11, Channing : « améliorer le visuel, couleurs d'Ada, plus clair, plus lisible ») : chaque
 *  annonce est un trait fin, la bande P25–P75 en océan clair avec min / P25 / médiane / P75 / max écrits, notre prix en
 *  repère encre avec son étiquette, la proposition du MI en pointillé quand elle diffère. Rien n'est porté par la
 *  couleur seule : tout est écrit. */
export function PriceStrip({ stats, prices, ours, mi, typed }: { stats: { min: number; max: number; p25: number; p75: number; median: number; count: number }; prices: number[]; ours: number | null; mi: number | null; typed: boolean }) {
  const lo = Math.min(stats.min, ours ?? stats.min), hi = Math.max(stats.max, ours ?? stats.max), span = Math.max(1, hi - lo);
  const x = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const ourX = ours != null ? x(ours) : null;
  const labelAlign = (px: number) => (px < 12 ? 'translate-x-0' : px > 88 ? '-translate-x-full' : '-translate-x-1/2');
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 pt-11 pb-7">
      <div className="relative h-16">
        {/* Rangée haute : min, médiane (centrée sur son trait), max */}
        <div className="absolute -top-9 left-0 text-[10px] text-slate-500 whitespace-nowrap">min <span className="text-slate-700">{fmtEur(stats.min)}</span></div>
        <div className="absolute -top-9 right-0 text-[10px] text-slate-500 whitespace-nowrap">max <span className="text-slate-700">{fmtEur(stats.max)}</span></div>
        <div className={`absolute -top-9 text-[10px] text-brand-ocean font-semibold whitespace-nowrap ${labelAlign(x(stats.median))}`} style={{ left: `${x(stats.median)}%` }}>médiane {fmtEur(stats.median)}</div>
        {/* Rangée basse : P25 à gauche de la bande, P75 à sa droite (jamais l'un sur l'autre) */}
        <div className="absolute -top-5 text-[10px] text-brand-ocean whitespace-nowrap -translate-x-full pr-1" style={{ left: `${x(stats.p25)}%` }}><span className="text-slate-500">P25</span> {fmtEur(stats.p25)}</div>
        <div className="absolute -top-5 text-[10px] text-brand-ocean whitespace-nowrap pl-1" style={{ left: `${x(stats.p75)}%` }}><span className="text-slate-500">P75</span> {fmtEur(stats.p75)}</div>
        {/* Bande P25–P75 */}
        <div className="absolute top-5 h-7 rounded-md bg-brand-ocean/15 border border-brand-ocean/30" style={{ left: `${x(stats.p25)}%`, width: `${Math.max(0.6, x(stats.p75) - x(stats.p25))}%` }} />
        {/* Médiane */}
        <div className="absolute top-4 h-9 w-px bg-brand-ocean" style={{ left: `${x(stats.median)}%` }} />
        {/* Une annonce = un trait */}
        {prices.map((p, i) => <div key={i} className="absolute top-7 h-3 w-px bg-brand-encre/40" style={{ left: `${x(p)}%` }} />)}
        {/* Axe */}
        <div className="absolute top-[3.25rem] left-0 right-0 h-px bg-slate-300" />
        {/* Proposition du MI (quand un prix saisi en diffère) */}
        {typed && mi != null && ours !== mi && (
          <div className="absolute top-2 h-11 border-l border-dashed border-brand-ocean" style={{ left: `${x(mi)}%` }} title={`Proposition du MI : ${fmtEur(mi)}`} />
        )}
        {/* Notre prix */}
        {ourX != null && (
          <>
            <div className="absolute top-1 h-12 w-0.5 bg-brand-encre rounded" style={{ left: `${ourX}%` }} />
            <div className={`absolute top-[3.6rem] text-[11px] font-semibold text-white bg-brand-encre rounded px-1.5 py-0.5 whitespace-nowrap ${labelAlign(ourX)}`} style={{ left: `${ourX}%` }}>{typed ? 'Notre prix' : 'Prix d\'attaque MI'} {fmtEur(ours)}</div>
          </>
        )}
      </div>
      {typed && mi != null && ours !== mi && <p className="text-[10px] text-slate-500 text-right mt-1">pointillé : proposition du MI {fmtEur(mi)}</p>}
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
