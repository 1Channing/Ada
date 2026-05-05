import { useState } from 'react';
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
} from 'lucide-react';
import { generateSearchUrls } from '../lib/linkgen/generator';
import { validateAllUrls } from '../lib/linkgen/validator';
import type {
  LinkGenParams,
  LinkGenUrlResult,
  SiteKey,
  LinkGenCorrectionRecord,
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

  const [results, setResults] = useState<LinkGenUrlResult[]>([]);
  const [validating, setValidating] = useState(false);
  const [validatingSet, setValidatingSet] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);

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

  const handleGenerate = () => {
    if (selectedSites.length === 0) return;
    const params = buildParams();
    const generated = generateSearchUrls(params);
    setResults(generated);
    setHistory((prev) => [
      { results: generated, params, timestamp: new Date(), corrections: [] },
      ...prev.slice(0, 4),
    ]);
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

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!isFormValid}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isFormValid
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
        >
          <Zap className="w-4 h-4" />
          Generate URLs{selectedSites.length > 1 ? ` (${selectedSites.length} markets)` : ''}
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
    </div>
  );
}
