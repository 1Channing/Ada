import { useState, useRef } from 'react';
import {
  Link2,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Check,
  Zap,
  Clock,
  Shield,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Info,
  BookOpen,
  Upload,
  Save,
  Brain,
  Sparkles,
} from 'lucide-react';
import { generateSearchUrls, generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { validateAllUrls } from '../lib/linkgen/validator';
import {
  parseCSV,
  normalizeCsvRow,
  analyzeCsvBatch,
  saveMappingsBatch,
} from '../lib/linkgen/csvMappingLearner';
import { analyzeUrlWithGPT } from '../lib/linkgen/analyzeUrlWithGpt';
import type {
  LinkGenParams,
  LinkGenUrlResult,
  SiteKey,
  LinkGenCorrectionRecord,
  CsvAnalysisResult,
  CsvBatchResult,
} from '../lib/linkgen/types';

const FUEL_OPTIONS: { label: string; value: string }[] = [
  { label: 'Essence / Petrol', value: 'ESSENCE' },
  { label: 'Diesel', value: 'DIESEL' },
  { label: 'Hybrid', value: 'HYBRID' },
  { label: 'Plug-in Hybrid', value: 'PLUG_IN_HYBRID' },
  { label: 'Electric', value: 'ELECTRIC' },
  { label: 'GPL', value: 'GPL' },
];

interface SiteOption {
  label: string;
  value: SiteKey;
  flag: string;
  country: string;
}

const SITE_OPTIONS: SiteOption[] = [
  { label: 'Leboncoin', value: 'LEBONCOIN', flag: '🇫🇷', country: 'France' },
  { label: 'Marktplaats', value: 'MARKTPLAATS', flag: '🇳🇱', country: 'Netherlands' },
  { label: 'Bilbasen', value: 'BILBASEN', flag: '🇩🇰', country: 'Denmark' },
];

interface HistoryEntry {
  results: LinkGenUrlResult[];
  params: LinkGenParams;
  timestamp: Date;
  corrections: LinkGenCorrectionRecord[];
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LinkGenUrlResult['validationStatus'] }) {
  if (status === 'not_checked') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded-full">
        Generated
      </span>
    );
  }
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-900/40 text-green-400 border border-green-700/40 px-2 py-0.5 rounded-full">
        <Check className="w-3 h-3" />
        Valid
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-900/40 text-amber-400 border border-amber-700/40 px-2 py-0.5 rounded-full">
        <AlertTriangle className="w-3 h-3" />
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-900/40 text-red-400 border border-red-700/40 px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" />
      Invalid
    </span>
  );
}

// ─── URL row (used for both original and corrected) ───────────────────────────

function UrlRow({
  url,
  label,
  status,
  score,
  listingCount,
  listingCountMethod,
  isCorrection = false,
}: {
  url: string;
  label: string;
  status?: LinkGenUrlResult['validationStatus'];
  score?: number;
  listingCount?: number;
  listingCountMethod?: string;
  isCorrection?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        isCorrection
          ? 'border-blue-800/50 bg-blue-950/20'
          : 'border-zinc-800 bg-zinc-950'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-xs font-medium ${
            isCorrection ? 'text-blue-400' : 'text-zinc-500'
          }`}
        >
          {label}
        </span>
        <div className="flex items-center gap-2">
          {status && <StatusBadge status={status} />}
          {score !== undefined && (
            <span
              className={`text-xs font-semibold tabular-nums ${
                score >= 70
                  ? 'text-green-400'
                  : score >= 40
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {score}/100
            </span>
          )}
          {listingCount !== undefined && (
            <span className="text-xs text-zinc-500">
              {listingCount} listings
              {listingCountMethod && (
                <span className="text-zinc-700"> ({listingCountMethod})</span>
              )}
            </span>
          )}
        </div>
      </div>

      <code className="block text-xs text-blue-300 break-all leading-relaxed font-mono">
        {url}
      </code>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </button>
      </div>
    </div>
  );
}

// ─── Full URL card (per site) ─────────────────────────────────────────────────

function UrlCard({
  result,
  validating,
}: {
  result: LinkGenUrlResult;
  validating: boolean;
}) {
  const [debugOpen, setDebugOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const site = SITE_OPTIONS.find((s) => s.value === result.site);
  const hasValidation = result.validationStatus !== 'not_checked';
  const hasCorrectedUrl = !!result.correctedUrl;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      {/* Site header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{site?.flag}</span>
          <div>
            <p className="text-sm font-semibold text-zinc-100">{site?.label}</p>
            <p className="text-xs text-zinc-500">{result.country}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.mappingSource === 'learned' && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-900/30 text-green-400 border border-green-700/40 px-2 py-0.5 rounded-full">
              <Brain className="w-3 h-3" />
              Learned
            </span>
          )}
          {result.mappingSource === 'default_template' && (
            <span className="inline-flex items-center gap-1 text-xs bg-zinc-800 text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded-full">
              Template
            </span>
          )}
          {validating ? (
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking...
            </span>
          ) : hasValidation ? (
            <StatusBadge status={result.validationStatus} />
          ) : null}
        </div>
      </div>

      {/* Issues summary */}
      {!validating && result.validationIssues && result.validationIssues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.validationIssues.map((issue, i) => (
            <span
              key={i}
              className="text-xs bg-zinc-800 text-amber-400 border border-zinc-700 px-2 py-0.5 rounded font-mono"
            >
              {issue.type}
            </span>
          ))}
        </div>
      )}

      {/* Original URL */}
      <UrlRow
        url={result.url}
        label="Original URL"
        status={hasValidation ? result.validationStatus : undefined}
        score={result.validationScore}
        listingCount={result.listingCount}
        listingCountMethod={result.listingCountMethod}
      />

      {/* Corrected URL (if available) */}
      {hasCorrectedUrl && result.correctedUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-medium">Correction applied</span>
            {result.correctionReason && (
              <span className="text-zinc-500 italic">— {result.correctionReason}</span>
            )}
          </div>
          <UrlRow
            url={result.correctedUrl}
            label="Corrected URL"
            status={result.validationAfter}
            score={result.validationScoreAfter}
            isCorrection
          />
        </div>
      )}

      {/* Correction reason when no retry was possible */}
      {!hasCorrectedUrl && result.correctionReason && (
        <p className="text-xs text-zinc-500 italic">
          Correction: {result.correctionReason}
        </p>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-500 font-mono">{w}</p>
          ))}
        </div>
      )}

      {/* Diagnostics panel */}
      {!validating && result.diagnostics && (
        <div>
          <button
            onClick={() => setDiagOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {diagOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Info className="w-3.5 h-3.5" />
            Diagnostics
          </button>

          {diagOpen && (
            <div className="mt-3 bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                {[
                  ['expectedDomain', result.diagnostics.expectedDomain],
                  ['actualDomain', result.diagnostics.actualDomain],
                  ['brand', result.diagnostics.brandApplied ? 'yes' : 'NO'],
                  ['model', result.diagnostics.modelApplied ? 'yes' : 'NO'],
                  ['trim', result.diagnostics.trimApplied ? 'yes' : result.diagnostics.trimApplied === false ? 'NO' : '—'],
                  ['fuel', result.diagnostics.fuelApplied ? 'yes' : 'NO'],
                  ['year', result.diagnostics.yearApplied ? 'yes' : 'NO'],
                  ['mileage', result.diagnostics.mileageApplied ? 'yes' : 'NO'],
                  ['sort', result.diagnostics.sortApplied ? 'yes' : 'NO'],
                  ['listings', String(result.diagnostics.listingCount)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="text-zinc-500 w-28 shrink-0">{k}</span>
                    <span
                      className={
                        v === 'NO'
                          ? 'text-red-400 font-semibold'
                          : v === 'yes'
                          ? 'text-green-400'
                          : 'text-zinc-400'
                      }
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              {result.diagnostics.sampleTitles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Sample titles</p>
                  {result.diagnostics.sampleTitles.map((t, i) => (
                    <p key={i} className="text-xs text-zinc-400 font-mono truncate">
                      {i + 1}. {t}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Debug logs */}
      <div>
        <button
          onClick={() => setDebugOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {debugOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Debug logs ({result.debugLogs.length})
        </button>

        {debugOpen && (
          <div className="mt-3 space-y-2">
            {result.debugLogs.map((log, i) => {
              const color =
                log.level === 'INPUT'
                  ? 'text-amber-400'
                  : log.level === 'MAPPING'
                  ? 'text-cyan-400'
                  : log.level === 'WARNING'
                  ? 'text-orange-400'
                  : log.level === 'VALIDATION'
                  ? 'text-sky-400'
                  : 'text-green-400';
              return (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                  <p className={`text-xs font-mono font-semibold ${color}`}>{log.message}</p>
                  {log.data && (
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {Object.entries(log.data).map(([k, v]) => (
                          <tr key={k}>
                            <td className="text-zinc-500 pr-4 py-0.5 align-top whitespace-nowrap">{k}</td>
                            <td className="text-zinc-300 py-0.5 break-all">{String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LinkGenerator() {
  const [selectedSites, setSelectedSites] = useState<SiteKey[]>(['MARKTPLAATS']);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState('');
  const [trim, setTrim] = useState('');
  const [minPower, setMinPower] = useState('');
  const [useMemory, setUseMemory] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [results, setResults] = useState<LinkGenUrlResult[]>([]);
  const [validating, setValidating] = useState(false);
  const [validatingSet, setValidatingSet] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // CSV Learner state
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvBatchResult, setCsvBatchResult] = useState<CsvBatchResult | null>(null);
  const [csvAnalyzing, setCsvAnalyzing] = useState(false);
  const [csvSaving, setCsvSaving] = useState(false);
  const [csvSaveResult, setCsvSaveResult] = useState<{ saved: number; skipped: number; errors: number } | null>(null);
  const [gptLoadingIdx, setGptLoadingIdx] = useState<number | null>(null);
  const [gptResults, setGptResults] = useState<Record<number, { explanation?: string; confidence?: number; status: string }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasZyteKey = !!(
    (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
    (import.meta.env.ZYTE_API_KEY as string | undefined)
  );

  const toggleSite = (site: SiteKey) =>
    setSelectedSites((prev) =>
      prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]
    );

  const selectAll = () => setSelectedSites(SITE_OPTIONS.map((s) => s.value));
  const clearAll = () => setSelectedSites([]);

  const handleYearFromChange = (val: string) => {
    setYearFrom(val);
    if (!yearTo || yearTo === yearFrom) setYearTo(val);
  };

  const buildParams = (): LinkGenParams => ({
    selectedSites,
    brand: brand.trim(),
    model: model.trim(),
    yearFrom: yearFrom.trim() || undefined,
    yearTo: yearTo.trim() || undefined,
    mileage: mileage.trim() || undefined,
    fuel: fuel || undefined,
    trim: trim.trim() || undefined,
    minPower: minPower.trim() || undefined,
  });

  const handleGenerate = async () => {
    if (selectedSites.length === 0) return;
    setGenerating(true);
    const params = buildParams();
    try {
      const generated = useMemory
        ? await generateSearchUrlsWithMemory(params)
        : generateSearchUrls(params);
      setResults(generated);
      setHistory((prev) => [
        { results: generated, params, timestamp: new Date(), corrections: [] },
        ...prev.slice(0, 4),
      ]);
    } finally {
      setGenerating(false);
    }
  };

  const handleScoutCheck = async () => {
    if (!results.length || validating) return;
    const params = buildParams();

    setValidating(true);
    setValidatingSet(new Set(results.map((r) => r.site)));

    try {
      const validated = await validateAllUrls(results, params);
      setResults(validated);

      // Build correction records for session history
      const corrections: LinkGenCorrectionRecord[] = validated
        .filter((r) => r.correctedUrl || r.validationStatus !== 'not_checked')
        .map((r) => ({
          site: r.site,
          inputParams: params,
          originalUrl: r.url,
          issues: r.validationIssues ?? [],
          correctedUrl: r.correctedUrl,
          correctionReason: r.correctionReason,
          validationBefore: r.validationStatus,
          validationAfter: r.validationAfter,
          createdAt: new Date(),
        }));

      setHistory((prev) => {
        const [latest, ...rest] = prev;
        if (!latest) return prev;
        return [{ ...latest, results: validated, corrections }, ...rest];
      });
    } finally {
      setValidating(false);
      setValidatingSet(new Set());
    }
  };

  const isFormValid =
    brand.trim().length > 0 && model.trim().length > 0 && selectedSites.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-600/10 rounded-lg border border-blue-600/20">
          <Link2 className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Link Generator</h1>
          <p className="text-sm text-zinc-500">
            Generate and validate multi-market search URLs for ADA studies
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">

        {/* Site selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Markets</label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                Select all
              </button>
              <span className="text-zinc-700">·</span>
              <button onClick={clearAll} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                Clear
              </button>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {SITE_OPTIONS.map((opt) => {
              const active = selectedSites.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleSite(opt.value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                  }`}
                >
                  <span>{opt.flag}</span>
                  {opt.label}
                </button>
              );
            })}
          </div>
          {selectedSites.length === 0 && (
            <p className="mt-2 text-xs text-amber-500">Select at least one market.</p>
          )}
        </div>

        {/* Brand & Model */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Brand <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="ex: TOYOTA"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Model <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="ex: RAV4"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Year range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Year From</label>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => handleYearFromChange(e.target.value)}
              placeholder="ex: 2020"
              min="1990"
              max="2030"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Year To</label>
            <input
              type="number"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              placeholder="ex: 2023"
              min="1990"
              max="2030"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Mileage & Min Power */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Max Mileage (km)</label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="ex: 100000"
              min="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Min Power (CV)</label>
            <input
              type="number"
              value={minPower}
              onChange={(e) => setMinPower(e.target.value)}
              placeholder="ex: 150"
              min="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {minPower && (
              <p className="mt-1 text-xs text-amber-500">minPower will be ignored — site mapping pending.</p>
            )}
          </div>
        </div>

        {/* Fuel & Trim */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Fuel</label>
            <select
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
            >
              <option value="">— Optional —</option>
              {FUEL_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Trim / Version</label>
            <input
              type="text"
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              placeholder="ex: GR SPORT"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Memory toggle */}
        <div className="flex items-center justify-between py-2 px-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
          <div className="flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-zinc-300">Use learned mappings (memory-first)</span>
          </div>
          <button
            onClick={() => setUseMemory((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              useMemory ? 'bg-green-600' : 'bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                useMemory ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!isFormValid || generating}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isFormValid && !generating
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {generating
            ? (useMemory ? 'Checking memory...' : 'Generating...')
            : `Generate URLs${selectedSites.length > 1 ? ` (${selectedSites.length} markets)` : ''}`}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
              Generated URLs
              <span className="ml-2 text-zinc-500 normal-case font-normal text-xs">
                {results.length} market{results.length > 1 ? 's' : ''}
              </span>
            </h2>

            <button
              onClick={handleScoutCheck}
              disabled={!hasZyteKey || validating}
              title={
                !hasZyteKey
                  ? 'Set VITE_ZYTE_API_KEY in your .env to enable Scout Check'
                  : 'Validate URLs by fetching a sample of real listings (max 1 retry per URL)'
              }
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-medium transition-colors ${
                hasZyteKey && !validating
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-blue-500 hover:text-blue-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {validating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Shield className="w-3.5 h-3.5" />
              )}
              {validating
                ? 'Checking...'
                : hasZyteKey
                ? 'Scout Check'
                : 'Scout Check — Zyte key required'}
            </button>
          </div>

          {results.map((r) => (
            <UrlCard
              key={r.site}
              result={r}
              validating={validatingSet.has(r.site)}
            />
          ))}
        </div>
      )}

      {/* Session history */}
      {history.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Session History</span>
          </div>
          <div className="space-y-4">
            {history.map((entry, i) => (
              <div key={i} className="py-3 border-b border-zinc-800 last:border-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-300 font-medium">
                    {entry.params.brand} {entry.params.model}
                    {entry.params.trim ? ` · ${entry.params.trim}` : ''}
                  </span>
                  <span className="text-zinc-700 text-xs">
                    {entry.results.map((r) => SITE_OPTIONS.find((s) => s.value === r.site)?.flag).join(' ')}
                  </span>
                  <span className="text-zinc-600 text-xs ml-auto">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                {entry.results.map((r) => {
                  const site = SITE_OPTIONS.find((s) => s.value === r.site);
                  return (
                    <div key={r.site} className="flex items-center gap-2 pl-1">
                      <span className="text-xs text-zinc-500 w-28 shrink-0">
                        {site?.flag} {site?.label}
                      </span>
                      <code className="text-xs text-zinc-600 font-mono truncate flex-1">{r.url}</code>
                      {r.validationStatus !== 'not_checked' && (
                        <StatusBadge status={r.validationStatus} />
                      )}
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => navigator.clipboard.writeText(r.correctedUrl ?? r.url)}
                          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                          title={r.correctedUrl ? 'Copy corrected URL' : 'Copy URL'}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => window.open(r.correctedUrl ?? r.url, '_blank', 'noopener,noreferrer')}
                          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                          title="Open"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Correction records summary */}
                {entry.corrections.filter((c) => c.correctedUrl).length > 0 && (
                  <div className="pl-1 pt-1 space-y-1">
                    {entry.corrections
                      .filter((c) => c.correctedUrl)
                      .map((c, j) => (
                        <p key={j} className="text-xs text-blue-400/70 italic">
                          {SITE_OPTIONS.find((s) => s.value === c.site)?.label}: {c.correctionReason}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Learn from CSV ─────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setCsvOpen((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-green-600/10 rounded-lg border border-green-600/20">
              <BookOpen className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-zinc-100">Learn from CSV</p>
              <p className="text-xs text-zinc-500">
                Analyze existing search URLs to extract param mappings and train ADA's memory
              </p>
            </div>
          </div>
          {csvOpen ? (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          )}
        </button>

        {csvOpen && (
          <div className="px-6 pb-6 space-y-5 border-t border-zinc-800">
            <div className="pt-5 space-y-3">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  Upload CSV
                </p>
                <p className="text-xs text-zinc-500 mb-3">
                  Expects columns: brand, model, site/source_marketplace, country/source_country,
                  source_search_url/url. Separators , or ; supported. Quoted fields and commas in URLs OK.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setCsvBatchResult(null);
                    setCsvSaveResult(null);
                    setGptResults({});
                    setCsvAnalyzing(true);
                    try {
                      const text = await file.text();
                      const rawRows = parseCSV(text);
                      const normalized = rawRows
                        .map(normalizeCsvRow)
                        .filter((r): r is NonNullable<typeof r> => r !== null);
                      const batchResult = analyzeCsvBatch(normalized);
                      setCsvBatchResult(batchResult);
                    } finally {
                      setCsvAnalyzing(false);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={csvAnalyzing}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {csvAnalyzing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {csvAnalyzing ? 'Analyzing...' : 'Choose CSV file & Analyze'}
                </button>
              </div>

              {csvBatchResult && (
                <div className="space-y-4">
                  <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap gap-6 text-sm">
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider">Analyzed</span>
                        <p className="text-zinc-100 font-semibold mt-0.5">{csvBatchResult.analyzed.length}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider">Mappings detected</span>
                        <p className="text-green-400 font-semibold mt-0.5">{csvBatchResult.mappingsDetected}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider">Warnings</span>
                        <p className={`font-semibold mt-0.5 ${csvBatchResult.warningCount > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>
                          {csvBatchResult.warningCount}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider">Avg confidence</span>
                        <p className={`font-semibold mt-0.5 ${csvBatchResult.confidenceAvg >= 0.7 ? 'text-green-400' : csvBatchResult.confidenceAvg >= 0.4 ? 'text-amber-400' : 'text-red-400'}`}>
                          {Math.round(csvBatchResult.confidenceAvg * 100)}%
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${csvBatchResult.confidenceAvg >= 0.7 ? 'bg-green-500' : csvBatchResult.confidenceAvg >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.round(csvBatchResult.confidenceAvg * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        if (!csvBatchResult) return;
                        setCsvSaving(true);
                        try {
                          const res = await saveMappingsBatch(csvBatchResult.analyzed);
                          setCsvSaveResult(res);
                        } finally {
                          setCsvSaving(false);
                        }
                      }}
                      disabled={csvSaving}
                      className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {csvSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {csvSaving ? 'Saving...' : 'Save to memory'}
                    </button>
                    {csvSaveResult && (
                      <p className="text-xs text-zinc-400">
                        <span className="text-green-400 font-semibold">{csvSaveResult.saved} saved</span>
                        {csvSaveResult.skipped > 0 && (
                          <> · <span className="text-zinc-500">{csvSaveResult.skipped} skipped (equal/lower confidence)</span></>
                        )}
                        {csvSaveResult.errors > 0 && (
                          <> · <span className="text-red-400">{csvSaveResult.errors} errors</span></>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      URL Analysis ({csvBatchResult.analyzed.length} rows)
                    </p>
                    {csvBatchResult.analyzed.map((analysis: CsvAnalysisResult, idx: number) => (
                      <CsvAnalysisRow
                        key={idx}
                        idx={idx}
                        analysis={analysis}
                        gptResult={gptResults[idx]}
                        gptLoading={gptLoadingIdx === idx}
                        onAskGpt={async () => {
                          setGptLoadingIdx(idx);
                          try {
                            const result = await analyzeUrlWithGPT(analysis.sourceUrl, {
                              brand: analysis.brand,
                              model: analysis.model,
                              fuel: analysis.fuel || undefined,
                              trim: analysis.trim || undefined,
                              site: analysis.site,
                            });
                            if (result) {
                              setGptResults((prev) => ({ ...prev, [idx]: result }));
                            } else {
                              setGptResults((prev) => ({ ...prev, [idx]: { status: 'not_available' } }));
                            }
                          } finally {
                            setGptLoadingIdx(null);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CSV Analysis Row ─────────────────────────────────────────────────────────

function CsvAnalysisRow({
  analysis,
  gptResult,
  gptLoading,
  onAskGpt,
}: {
  idx: number;
  analysis: CsvAnalysisResult;
  gptResult?: { explanation?: string; confidence?: number; status: string };
  gptLoading: boolean;
  onAskGpt: () => void;
}) {
  const [open, setOpen] = useState(false);
  const confidenceColor =
    analysis.confidence >= 0.7
      ? 'text-green-400 bg-green-900/30 border-green-700/40'
      : analysis.confidence >= 0.4
      ? 'text-amber-400 bg-amber-900/30 border-amber-700/40'
      : 'text-red-400 bg-red-900/30 border-red-700/40';

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        )}
        <span className="text-xs text-zinc-300 flex-1 min-w-0">
          <span className="font-medium">{analysis.brand} {analysis.model}</span>
          {analysis.trim && <span className="text-zinc-500 ml-1">· {analysis.trim}</span>}
          <span className="text-zinc-600 ml-2 font-mono text-[10px]">{analysis.site}</span>
        </span>
        <span className={`text-xs font-semibold border px-2 py-0.5 rounded-full shrink-0 ${confidenceColor}`}>
          {Math.round(analysis.confidence * 100)}%
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/50">
          <div className="pt-3">
            <p className="text-xs text-zinc-500 mb-1">Source URL</p>
            <code className="block text-xs text-blue-300 break-all font-mono leading-relaxed">
              {analysis.sourceUrl}
            </code>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {Object.keys(analysis.detectedParams.queryParams).length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Query params</p>
                <div className="space-y-0.5">
                  {Object.entries(analysis.detectedParams.queryParams).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1 text-xs font-mono">
                      <span className={analysis.inferredMapping.paramToField[k] ? 'text-green-400' : 'text-zinc-500'}>
                        {k}
                      </span>
                      <span className="text-zinc-700">=</span>
                      <span className="text-zinc-400 truncate max-w-[8rem]">{v.slice(0, 30)}</span>
                      {analysis.inferredMapping.paramToField[k] && (
                        <span className="text-green-600 text-[10px]">
                          ({analysis.inferredMapping.paramToField[k]})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(analysis.detectedParams.hashParams).length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Hash params</p>
                <div className="space-y-0.5">
                  {Object.entries(analysis.detectedParams.hashParams).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1 text-xs font-mono">
                      <span className={analysis.inferredMapping.paramToField[k] ? 'text-green-400' : 'text-zinc-500'}>
                        {k}
                      </span>
                      <span className="text-zinc-700">:</span>
                      <span className="text-zinc-400 truncate max-w-[8rem]">{v.slice(0, 30)}</span>
                      {analysis.inferredMapping.paramToField[k] && (
                        <span className="text-green-600 text-[10px]">
                          ({analysis.inferredMapping.paramToField[k]})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Inferred mapping summary */}
          {(analysis.inferredMapping.brandParam || analysis.inferredMapping.modelParam) && (
            <div className="bg-green-950/20 border border-green-800/30 rounded p-2 space-y-0.5">
              <p className="text-xs text-green-500 font-medium mb-1">Inferred mapping</p>
              {[
                ['brand', analysis.inferredMapping.brandParam],
                ['model', analysis.inferredMapping.modelParam],
                ['yearFrom', analysis.inferredMapping.yearFromParam],
                ['yearTo', analysis.inferredMapping.yearToParam],
                ['mileage', analysis.inferredMapping.mileageParam],
                ['fuel', analysis.inferredMapping.fuelParam],
                ['trim', analysis.inferredMapping.trimParam],
                ['sort', analysis.inferredMapping.sortParam],
              ]
                .filter(([, v]) => v)
                .map(([field, param]) => (
                  <div key={field} className="text-xs font-mono text-green-400/70">
                    {field} → {param}
                  </div>
                ))}
            </div>
          )}

          {analysis.warnings.length > 0 && (
            <div className="space-y-0.5">
              {analysis.warnings.slice(0, 5).map((w, i) => (
                <p key={i} className="text-xs text-amber-500 font-mono">{w}</p>
              ))}
              {analysis.warnings.length > 5 && (
                <p className="text-xs text-zinc-600">+{analysis.warnings.length - 5} more warnings</p>
              )}
            </div>
          )}

          {analysis.confidence < 0.6 && (
            <div className="pt-1">
              {!gptResult ? (
                <button
                  onClick={onAskGpt}
                  disabled={gptLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-200 transition-colors disabled:opacity-50"
                >
                  {gptLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  {gptLoading ? 'Asking GPT...' : 'Ask GPT (low confidence)'}
                </button>
              ) : gptResult.status === 'not_available' ? (
                <p className="text-xs text-zinc-600 italic">
                  GPT not configured server-side (OPENAI_API_KEY missing)
                </p>
              ) : gptResult.status === 'ok' ? (
                <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">GPT suggestion</span>
                    {gptResult.confidence !== undefined && (
                      <span className="text-xs text-zinc-500 ml-auto">
                        confidence: {Math.round(gptResult.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {gptResult.explanation && (
                    <p className="text-xs text-zinc-400 italic">{gptResult.explanation}</p>
                  )}
                  <p className="text-xs text-amber-700">
                    GPT proposes — Scout must verify before this mapping becomes active.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
