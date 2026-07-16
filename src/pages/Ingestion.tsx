import { useState } from 'react';
import { Upload, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { findSiteAdapterByDomain, decomposeUrl } from '../lib/study-core/marketplaces';
import type { SiteAdapter, SearchCriteria } from '../lib/study-core/marketplaces';
import { analyzeIngestion, INGESTION_MIN_SAMPLE, INGESTION_CONFIRM_THRESHOLD } from '../lib/study-core/ingestion';
import type { IngestionAnalysis } from '../lib/study-core/ingestion';
import { persistIngestionResult } from '../lib/linkgen/ingestion';
import type { PersistIngestionOutcome } from '../lib/linkgen/ingestion';
import type { ScrapedListing } from '../lib/study-core/types';

const FUEL_OPTIONS = [
  { value: '', label: '— non filtré —' },
  { value: 'ESSENCE', label: 'Essence' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'HYBRIDE', label: 'Hybride' },
  { value: 'PLUG_IN_HYBRID', label: 'Hybride rechargeable' },
  { value: 'ELECTRIQUE', label: 'Électrique' },
  { value: 'GPL', label: 'GPL' },
];

const FIELD_LABELS: Record<string, string> = {
  brand: 'Marque',
  model: 'Modèle',
  fuel: 'Carburant',
  year: 'Année',
  mileage: 'Kilométrage',
  trim: 'Finition',
  gearbox: 'Boîte de vitesse',
  power: 'Puissance DIN',
  doors: 'Portes',
  seats: 'Places',
  color: 'Couleur',
  vehicleType: 'Type de véhicule',
};

const GEARBOX_OPTIONS = [
  { value: '', label: '— non filtré —' },
  { value: 'Manuelle', label: 'Manuelle' },
  { value: 'Automatique', label: 'Automatique' },
];

const MEMORY_ACTION_LABELS: Record<string, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  inserted: { text: 'Nouveau mapping enregistré en mémoire (human_verified)', tone: 'ok' },
  reinforced: { text: 'Mapping existant renforcé (confirmation supplémentaire)', tone: 'ok' },
  upgraded_from_csv: { text: 'Mapping CSV existant promu en human_verified', tone: 'ok' },
  conflict_kept_existing: { text: 'Conflit avec un mapping vérifié existant — existant conservé, conflit journalisé', tone: 'warn' },
  none: { text: 'Rien écrit en mémoire (marque + modèle non confirmés tous les deux)', tone: 'muted' },
};

interface FormState {
  brand: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  mileage: string;
  fuel: string;
  trim: string;
  gearbox: string;
  powerFrom: string;
  powerTo: string;
  doors: string;
  seats: string;
  color: string;
  vehicleType: string;
  submittedBy: string;
}

const EMPTY_FORM: FormState = {
  brand: '', model: '', yearFrom: '', yearTo: '', mileage: '', fuel: '', trim: '',
  gearbox: '', powerFrom: '', powerTo: '', doors: '', seats: '', color: '', vehicleType: '',
  submittedBy: '',
};

export function Ingestion() {
  const [url, setUrl] = useState('');
  const [adapter, setAdapter] = useState<SiteAdapter | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [prefilled, setPrefilled] = useState<string[]>([]);
  const [phase, setPhase] = useState<'idle' | 'form' | 'scraping' | 'done'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [sample, setSample] = useState<ScrapedListing[]>([]);
  const [analysis, setAnalysis] = useState<IngestionAnalysis | null>(null);
  const [outcome, setOutcome] = useState<PersistIngestionOutcome | null>(null);

  const setField = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleAnalyzeUrl = () => {
    setUrlError(null);
    setAnalysis(null);
    setOutcome(null);
    setScrapeError(null);
    setSample([]);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    const found = findSiteAdapterByDomain(trimmedUrl);
    if (!found) {
      setAdapter(null);
      setPhase('idle');
      setUrlError('Marketplace non supporté — sites connus : ' +
        'Leboncoin (FR), Marktplaats (NL), Bilbasen (DK).');
      return;
    }

    const pre = found.prefillCriteriaFromUrl?.(trimmedUrl) ?? {};
    const next: FormState = {
      ...EMPTY_FORM,
      submittedBy: form.submittedBy,
      brand: pre.brand ? String(pre.brand) : '',
      model: pre.model ? String(pre.model) : '',
      yearFrom: pre.yearFrom ? String(pre.yearFrom) : '',
      yearTo: pre.yearTo ? String(pre.yearTo) : '',
      mileage: pre.mileage ? String(pre.mileage) : '',
      fuel: pre.fuel ? String(pre.fuel) : '',
      trim: pre.trim ? String(pre.trim) : '',
      gearbox: pre.gearbox ? String(pre.gearbox) : '',
      powerFrom: pre.powerFrom ? String(pre.powerFrom) : '',
      powerTo: pre.powerTo ? String(pre.powerTo) : '',
      doors: pre.doors ? String(pre.doors) : '',
      seats: pre.seats ? String(pre.seats) : '',
      color: pre.color ? String(pre.color) : '',
      vehicleType: pre.vehicleType ? String(pre.vehicleType) : '',
    };

    setAdapter(found);
    setForm(next);
    setPrefilled(Object.entries({
      brand: next.brand, model: next.model, yearFrom: next.yearFrom,
      yearTo: next.yearTo, mileage: next.mileage, fuel: next.fuel, trim: next.trim,
      gearbox: next.gearbox, power: next.powerFrom, doors: next.doors,
      seats: next.seats, color: next.color, vehicleType: next.vehicleType,
    }).filter(([, v]) => v).map(([k]) => k));
    setPhase('form');
  };

  const handleVerify = async () => {
    if (!adapter) return;
    setPhase('scraping');
    setScrapeError(null);
    setAnalysis(null);
    setOutcome(null);

    const criteria: SearchCriteria = {
      brand: form.brand.trim(),
      model: form.model.trim(),
      yearFrom: form.yearFrom.trim() || undefined,
      yearTo: form.yearTo.trim() || undefined,
      mileage: form.mileage.trim() || undefined,
      fuel: form.fuel || undefined,
      trim: form.trim.trim() || undefined,
      gearbox: form.gearbox || undefined,
      powerFrom: form.powerFrom.trim() || undefined,
      powerTo: form.powerTo.trim() || undefined,
      doors: form.doors.trim() || undefined,
      seats: form.seats.trim() || undefined,
      color: form.color.trim() || undefined,
      vehicleType: form.vehicleType.trim() || undefined,
    };

    const detectedParams = decomposeUrl(url.trim());

    try {
      const { data, error } = await supabase.functions.invoke('ingest-url', {
        body: { url: url.trim() },
      });

      if (error) throw new Error(error.message ?? 'Edge Function error');

      const listings: ScrapedListing[] = data?.listings ?? [];
      const remoteError: string | null = data?.error ?? null;
      setSample(listings);

      if (remoteError && listings.length === 0) {
        setScrapeError(`${remoteError}${data?.errorReason ? ` — ${data.errorReason}` : ''}`);
        const persistResult = await persistIngestionResult({
          url: url.trim(),
          site: adapter.key,
          country: adapter.countryCode,
          criteria,
          analysis: null,
          sampleSize: 0,
          scrapeError: remoteError,
          detectedParams,
          submittedBy: form.submittedBy.trim() || undefined,
        });
        setOutcome(persistResult);
        setPhase('done');
        return;
      }

      const result = analyzeIngestion(url.trim(), criteria, listings, adapter);
      setAnalysis(result);

      const persistResult = await persistIngestionResult({
        url: url.trim(),
        site: adapter.key,
        country: adapter.countryCode,
        criteria,
        analysis: result,
        sampleSize: listings.length,
        detectedParams,
        submittedBy: form.submittedBy.trim() || undefined,
      });
      setOutcome(persistResult);
      setPhase('done');
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : String(err));
      setPhase('done');
    }
  };

  const canVerify = phase === 'form' || phase === 'done'
    ? form.brand.trim().length > 0 && form.model.trim().length > 0
    : false;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Upload className="w-6 h-6 text-blue-500" />
          Ingestion
        </h1>
        <p className="text-zinc-400 mt-1 text-sm">
          Collez une URL de recherche filtrée manuellement sur un marketplace. ADA scrape la page,
          confirme empiriquement chaque critère (min {INGESTION_MIN_SAMPLE} annonces, ≥{INGESTION_CONFIRM_THRESHOLD * 100}% de cohérence)
          et ne mémorise que les correspondances certaines.
        </p>
      </div>

      {/* URL bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <label className="block text-sm font-medium text-zinc-300">URL de recherche marketplace</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyzeUrl(); }}
            placeholder="https://www.marktplaats.nl/toyota/f/yaris+hybride/1232+13838/"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAnalyzeUrl}
            disabled={!url.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg font-medium text-sm"
          >
            Analyser
          </button>
        </div>
        {urlError && (
          <p className="text-sm text-red-400 flex items-center gap-2"><XCircle className="w-4 h-4" />{urlError}</p>
        )}
        {adapter && phase !== 'idle' && (
          <p className="text-sm text-zinc-400">
            Site détecté : <span className="text-zinc-100 font-medium">{adapter.displayName}</span> ({adapter.country})
            {prefilled.length > 0
              ? <> — champs pré-remplis depuis l'URL : <span className="text-emerald-400">{prefilled.join(', ')}</span>. Vérifiez et complétez.</>
              : <> — URL à identifiants opaques : saisissez les critères que vous aviez filtrés.</>}
          </p>
        )}
      </div>

      {/* Declared criteria form */}
      {adapter && phase !== 'idle' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-zinc-200">Critères déclarés (ce que vous aviez filtré sur le site)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Marque *</label>
              <input value={form.brand} onChange={setField('brand')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Modèle *</label>
              <input value={form.model} onChange={setField('model')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Année min</label>
              <input value={form.yearFrom} onChange={setField('yearFrom')} placeholder="2021"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Année max</label>
              <input value={form.yearTo} onChange={setField('yearTo')} placeholder="2023"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Km max</label>
              <input value={form.mileage} onChange={setField('mileage')} placeholder="80000"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Carburant</label>
              <select value={form.fuel} onChange={setField('fuel')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {FUEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Finition</label>
              <input value={form.trim} onChange={setField('trim')} placeholder="GR Sport"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Boîte de vitesse</label>
              <select value={form.gearbox} onChange={setField('gearbox')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {GEARBOX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Puissance DIN min (ch)</label>
              <input value={form.powerFrom} onChange={setField('powerFrom')} placeholder="160"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Puissance DIN max (ch)</label>
              <input value={form.powerTo} onChange={setField('powerTo')} placeholder="—"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Nombre de portes</label>
              <input value={form.doors} onChange={setField('doors')} placeholder="5"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Nombre de places</label>
              <input value={form.seats} onChange={setField('seats')} placeholder="5"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Couleur</label>
              <input value={form.color} onChange={setField('color')} placeholder="Noir"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Type de véhicule</label>
              <input value={form.vehicleType} onChange={setField('vehicleType')} placeholder="Berline"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Votre nom (audit, optionnel)</label>
              <input value={form.submittedBy} onChange={setField('submittedBy')}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <button
            onClick={handleVerify}
            disabled={!canVerify || phase === 'scraping'}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg font-medium text-sm"
          >
            {phase === 'scraping' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {phase === 'scraping' ? 'Scraping de découverte en cours…' : 'Vérifier par scraping'}
          </button>
        </div>
      )}

      {/* Scrape error */}
      {scrapeError && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Scraping de découverte échoué — rien n'a été mémorisé.</p>
            <p className="text-red-400/80">{scrapeError}</p>
            <p className="text-red-400/60 mt-1">La tentative a été journalisée pour audit.</p>
          </div>
        </div>
      )}

      {/* Results */}
      {analysis && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-zinc-200">
            Confirmation champ par champ — échantillon de {sample.length} annonces
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-4">Champ</th>
                  <th className="py-2 pr-4">Déclaré</th>
                  <th className="py-2 pr-4">Méthode</th>
                  <th className="py-2 pr-4">Cohérence</th>
                  <th className="py-2 pr-4">Verdict</th>
                  <th className="py-2">Détail</th>
                </tr>
              </thead>
              <tbody>
                {analysis.confirmations.map((c) => (
                  <tr key={c.field} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4 font-medium">{FIELD_LABELS[c.field] ?? c.field}</td>
                    <td className="py-2 pr-4 text-zinc-300">{c.declaredValue}</td>
                    <td className="py-2 pr-4 text-zinc-400">{c.method === 'structured' ? 'donnée structurée' : 'texte'}</td>
                    <td className="py-2 pr-4 text-zinc-300">{c.matchCount}/{c.sampleSize}</td>
                    <td className="py-2 pr-4">
                      {c.status === 'confirmed'
                        ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-4 h-4" />retenu</span>
                        : <span className="inline-flex items-center gap-1 text-red-400"><XCircle className="w-4 h-4" />jeté</span>}
                    </td>
                    <td className="py-2 text-zinc-500 text-xs">{c.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-sm text-zinc-400">
            URL validée réutilisable telle quelle :{' '}
            {analysis.validatedUrl
              ? <span className="text-emerald-400">oui</span>
              : <span className="text-amber-400">non (au moins un champ jeté — seuls les fragments confirmés sont mémorisés)</span>}
          </div>

          {sample.length > 0 && (
            <details className="text-sm text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">Aperçu de l'échantillon ({Math.min(sample.length, 5)} premières annonces)</summary>
              <ul className="mt-2 space-y-1">
                {sample.slice(0, 5).map((l, i) => (
                  <li key={i} className="truncate">
                    {l.title} — {l.price.toLocaleString('fr-FR')} {l.currency} · {l.year ?? '?'} · {l.mileage != null ? `${l.mileage.toLocaleString('fr-FR')} km` : '? km'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Memory outcome */}
      {outcome && (
        <div className={`border rounded-xl p-4 text-sm flex items-start gap-2 ${
          MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'ok'
            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
            : MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'warn'
              ? 'bg-amber-950/40 border-amber-800 text-amber-300'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
        }`}>
          {MEMORY_ACTION_LABELS[outcome.memoryAction]?.tone === 'warn'
            ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
          <div>
            <p className="font-medium">{MEMORY_ACTION_LABELS[outcome.memoryAction]?.text ?? outcome.memoryAction}</p>
            {outcome.conflicts.length > 0 && (
              <ul className="mt-1 text-xs opacity-80">
                {outcome.conflicts.map((c, i) => (
                  <li key={i}>{FIELD_LABELS[c.field] ?? c.field} : existant {c.existing} ≠ proposé {c.incoming}</li>
                ))}
              </ul>
            )}
            {outcome.memoryError && <p className="text-xs text-red-400 mt-1">Erreur d'écriture mémoire : {outcome.memoryError}</p>}
            {outcome.eventError && <p className="text-xs text-red-400 mt-1">Erreur d'écriture audit : {outcome.eventError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
