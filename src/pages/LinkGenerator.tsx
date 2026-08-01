import { useState, useRef, useEffect, useCallback } from 'react';
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
  Brain,
  Trash2,
} from 'lucide-react';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { generateSearchUrls, generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { validateWithRetry } from '../lib/linkgen/validator';
import { CampaignPanel } from '../components/CampaignPanel';
import type {
  LinkGenParams,
  LinkGenUrlResult,
  SiteKey,
  LinkGenCorrectionRecord,
  CsvBatchResult,
  CsvImportDiagnostics,
} from '../lib/linkgen/types';

// ─── localStorage persistence ─────────────────────────────────────────────────

const DRAFT_KEY = 'link_generator_draft';

interface DraftState {
  selectedSites: SiteKey[];
  brand: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  mileage: string;
  minPower: string;
  fuel: string;
  trim: string;
  gearbox: string;
  doors: string;
  seats: string;
  color: string;
  vehicleType: string;
  useMemory: boolean;
  results: LinkGenUrlResult[];
  history: Array<{ results: LinkGenUrlResult[]; params: LinkGenParams; timestamp: string; corrections: LinkGenCorrectionRecord[] }>;
  csvDiagnostics: CsvImportDiagnostics | null;
  // Lightweight CSV summary — no full analysis payloads (no debugLogs, no full detectedParams)
  csvSummary: { analyzed: number; mappingsDetected: number; confidenceAvg: number; warningCount: number } | null;
}

function saveDraft(state: DraftState) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadDraft(): Partial<DraftState> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<DraftState>;
  } catch {
    return {};
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

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

const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪',
};

// Driven from the site-adapter registry so every registered marketplace
// (incl. AutoScout24's per-country instances, and any future site) is
// selectable here without editing this list — "adding a site = config".
const SITE_OPTIONS: SiteOption[] = allSiteAdapters().map((a) => ({
  label: a.displayName,
  value: a.key,
  flag: COUNTRY_FLAG[a.countryCode] ?? '🏳️',
  country: a.country,
}));

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
      <span className="inline-flex items-center gap-1 text-xs bg-slate-200 text-slate-600 border border-slate-300 px-2 py-0.5 rounded-full">
        Generated
      </span>
    );
  }
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-600 border border-green-300 px-2 py-0.5 rounded-full">
        <Check className="w-3 h-3" />
        Valid
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 border border-amber-300 px-2 py-0.5 rounded-full">
        <AlertTriangle className="w-3 h-3" />
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 border border-red-300 px-2 py-0.5 rounded-full">
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
          ? 'border-blue-300 bg-blue-50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-xs font-medium ${
            isCorrection ? 'text-blue-600' : 'text-slate-500'
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
                  ? 'text-green-600'
                  : score >= 40
                  ? 'text-amber-600'
                  : 'text-red-600'
              }`}
            >
              {score}/100
            </span>
          )}
          {listingCount !== undefined && (
            <span className="text-xs text-slate-500">
              {listingCount} listings
              {listingCountMethod && (
                <span className="text-slate-300"> ({listingCountMethod})</span>
              )}
            </span>
          )}
        </div>
      </div>

      <code className="block text-xs text-blue-700 break-all leading-relaxed font-mono">
        {url}
      </code>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-200 hover:bg-slate-300 border border-slate-300 rounded text-xs text-slate-700 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
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

// ─── Score chip ───────────────────────────────────────────────────────────────

function ScoreChip({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? 'text-green-600 bg-green-50 border-green-300' :
    score >= 60 ? 'text-amber-600 bg-amber-50 border-amber-300' :
    'text-red-600 bg-red-50 border-red-300';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-mono ${color}`}>
      {label} {score}
    </span>
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
  // Open diagnostics by default once the Scout has run
  const [diagOpen, setDiagOpen] = useState(result.validationStatus !== 'not_checked');
  const [hypOpen, setHypOpen] = useState(false);

  const site = SITE_OPTIONS.find((s) => s.value === result.site);
  const hasValidation = result.validationStatus !== 'not_checked';
  const hasCorrectedUrl = !!result.correctedUrl;
  const hasBestUrl = result.bestVerifiedUrl && result.bestVerifiedUrl !== result.url;
  const hasHypotheses = (result.testedHypotheses?.length ?? 0) > 0;
  const scoreImproved =
    hasCorrectedUrl &&
    result.validationScore !== undefined &&
    result.validationScoreAfter !== undefined &&
    result.validationScoreAfter !== result.validationScore;

  // Check if Scout logs are present after validation ran
  const hasScoutLogs = result.debugLogs.some((l) => l.message.startsWith('[SCOUT_'));
  const scoutRanButNoLogs = hasValidation && !validating && !hasScoutLogs;

  // Detect Zyte unavailability
  const zyteUnavailable = result.validationIssues?.some((i) => i.type === 'no_zyte_key');

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      {/* Site header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{site?.flag}</span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{site?.label}</p>
            <p className="text-xs text-slate-500">{result.country}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {result.mappingSource === 'learned' && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-600 border border-green-300 px-2 py-0.5 rounded-full">
              <Brain className="w-3 h-3" />
              Learned
            </span>
          )}
          {result.mappingSource === 'default_template' && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-200 text-slate-500 border border-slate-300 px-2 py-0.5 rounded-full">
              Template
            </span>
          )}
          {/* Score before/after — shown together when correction changed the score */}
          {!validating && scoreImproved && (
            <div className="flex items-center gap-1.5">
              <ScoreChip score={result.validationScore!} label="before" />
              <span className="text-slate-400 text-xs">→</span>
              <ScoreChip score={result.validationScoreAfter!} label="after" />
            </div>
          )}
          {!validating && !scoreImproved && result.validationScore !== undefined && (
            <ScoreChip score={result.validationScore} label="score" />
          )}
          {validating ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking...
            </span>
          ) : hasValidation ? (
            <StatusBadge status={result.bestVerifiedStatus ?? result.validationStatus} />
          ) : null}
        </div>
      </div>

      {/* Not checked yet banner */}
      {!validating && !hasValidation && (
        <div className="flex items-center gap-2.5 bg-slate-100 border border-slate-300 rounded-lg px-3 py-2.5">
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <p className="text-xs text-slate-600">
            Not checked yet — click <span className="font-semibold text-slate-800">Scout Check</span> to verify this URL with real listings
          </p>
        </div>
      )}

      {/* Scout unavailable (Zyte key missing) */}
      {!validating && zyteUnavailable && (
        <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Scout unavailable</span> — Zyte API key not configured. Mapping status unchanged.
          </p>
        </div>
      )}

      {/* Scout ran but returned no SCOUT_* logs — indicates validator issue */}
      {scoutRanButNoLogs && !zyteUnavailable && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-300 rounded-lg px-3 py-2.5">
          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <p className="text-xs text-red-700">
            Scout did not run — no validation logs returned. Check console for errors.
          </p>
        </div>
      )}

      {/* Broader search notice (trim was requested but removed for a better score) */}
      {!validating && result.validationIssues?.some((i) => i.type === 'trim_removed_for_broader_market') && (
        <div className="flex items-center gap-2.5 bg-slate-100 border border-slate-300 rounded-lg px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <p className="text-xs text-slate-700">
            <span className="font-semibold">Broader search</span> — the trim filter was not matched in listings. This URL covers the model market, not the exact trim version.
          </p>
        </div>
      )}

      {/* Issues summary (exclude display-only issues that have their own banner) */}
      {!validating && result.validationIssues && result.validationIssues.filter(
        (i) => i.type !== 'no_zyte_key' && i.type !== 'trim_removed_for_broader_market'
      ).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.validationIssues.filter(
            (i) => i.type !== 'no_zyte_key' && i.type !== 'trim_removed_for_broader_market'
          ).map((issue, i) => (
            <span
              key={i}
              className={`text-xs border px-2 py-0.5 rounded font-mono ${
                issue.type === 'parser_failed_on_html'
                  ? 'bg-red-50 text-red-600 border-red-300'
                  : 'bg-slate-200 text-amber-600 border-slate-300'
              }`}
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

      {/* Best verified URL (when different from original and better than correctedUrl display) */}
      {!validating && hasBestUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-medium">Best verified URL</span>
            {result.correctionReason && (
              <span className="text-slate-500 italic">— {result.correctionReason}</span>
            )}
          </div>
          <UrlRow
            url={result.bestVerifiedUrl!}
            label="Best verified"
            status={result.bestVerifiedStatus}
            score={result.bestVerifiedScore}
            isCorrection
          />
        </div>
      )}

      {/* Corrected URL (if best is same as corrected, show correction label) */}
      {!hasBestUrl && hasCorrectedUrl && result.correctedUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-medium">Correction applied</span>
            {result.correctionReason && (
              <span className="text-slate-500 italic">— {result.correctionReason}</span>
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
      {!hasCorrectedUrl && !hasBestUrl && result.correctionReason && (
        <p className="text-xs text-slate-500 italic">
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

      {/* Mapping source info */}
      {!validating && result.mappingSource && (
        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
          {result.mappingSource === 'learned' ? (
            <>
              <Brain className="w-3 h-3 text-green-600" />
              <span className="text-green-700">
                source: learned mapping
                {result.debugLogs.find((l) => l.data?.confidence) && (
                  <> · confidence {Math.round(Number(result.debugLogs.find((l) => l.data?.confidence)?.data?.confidence ?? 0) * 100)}%</>
                )}
              </span>
            </>
          ) : (
            <>
              <Info className="w-3 h-3" />
              <span>source: default template · no validated mapping found</span>
            </>
          )}
        </div>
      )}

      {/* Tested hypotheses */}
      {!validating && hasHypotheses && (
        <div>
          <button
            onClick={() => setHypOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            {hypOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <RefreshCw className="w-3.5 h-3.5" />
            Hypotheses tested ({result.testedHypotheses!.length})
          </button>
          {hypOpen && (
            <div className="mt-2 space-y-2">
              {result.testedHypotheses!.map((h, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400 font-mono text-[10px]">H{h.rankInBatch}</span>
                    <StatusBadge status={h.status} />
                    <ScoreChip score={h.score} label="score" />
                    <span className="text-xs text-slate-500 italic">{h.reason}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-700 font-mono truncate flex-1 min-w-0"
                    >
                      {h.url.slice(0, 90)}{h.url.length > 90 ? '…' : ''}
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(h.url)}
                      className="shrink-0 text-slate-400 hover:text-slate-600"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Diagnostics panel */}
      {!validating && result.diagnostics && (
        <div>
          <button
            onClick={() => setDiagOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            {diagOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Info className="w-3.5 h-3.5" />
            Diagnostics
          </button>

          {diagOpen && (
            <div className="mt-3 bg-white border border-slate-200 rounded-lg p-3 space-y-3">
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
                    <span className="text-slate-500 w-28 shrink-0">{k}</span>
                    <span
                      className={
                        v === 'NO'
                          ? 'text-red-600 font-semibold'
                          : v === 'yes'
                          ? 'text-green-600'
                          : 'text-slate-600'
                      }
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              {/* Parser details row */}
              {result.diagnostics.parserDetails && (
                <div className="border-t border-slate-200 pt-3 space-y-1">
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Parser</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                    {[
                      ['htmlLength', `${Math.round(result.diagnostics.parserDetails.htmlLength / 1024)}KB`],
                      ['parser', result.diagnostics.parserDetails.parserUsed.replace('study-core/parsers/', '')],
                      ['listings parsed', String(result.diagnostics.parserDetails.parsedSampleCount)],
                      ['method', result.diagnostics.parserDetails.extractionMethod],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="text-slate-500 w-28 shrink-0">{k}</span>
                        <span className={result.diagnostics!.parserDetails!.parsedSampleCount === 0 && k === 'listings parsed' ? 'text-red-600 font-semibold' : 'text-slate-600'}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parsed sample listings */}
              <div className="border-t border-slate-200 pt-3 space-y-1.5">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Parsed sample listings</p>
                {result.diagnostics.parsedSampleListings && result.diagnostics.parsedSampleListings.length > 0 ? (
                  result.diagnostics.parsedSampleListings.map((l, i) => (
                    <div key={i} className="bg-white rounded px-3 py-2 space-y-0.5">
                      <p className="text-xs text-slate-800 font-medium truncate">{l.title}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {l.year && <span className="text-[10px] font-mono text-slate-600">{l.year}</span>}
                        {l.mileage && <span className="text-[10px] font-mono text-slate-600">{Math.round(l.mileage / 1000)}k km</span>}
                        {l.fuel && <span className="text-[10px] font-mono text-slate-500">{l.fuel}</span>}
                        {l.price > 0 && <span className="text-[10px] font-mono text-slate-600">€{l.price.toLocaleString('fr-FR')}</span>}
                      </div>
                    </div>
                  ))
                ) : result.diagnostics.parserDetails ? (
                  <div className="bg-white rounded px-3 py-2.5">
                    <p className="text-xs text-red-600 font-mono">
                      {result.diagnostics.parserDetails.htmlLength > 100_000
                        ? `HTML fetched (${Math.round(result.diagnostics.parserDetails.htmlLength / 1024)}KB) but parser extracted 0 listings.`
                        : 'No HTML or very small page — fetch may have failed silently.'}
                    </p>
                  </div>
                ) : null}
              </div>

              {result.diagnostics.sampleTitles.length > 0 && (
                <div className="space-y-1 border-t border-slate-200 pt-3">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Sample titles (enriched)</p>
                  {result.diagnostics.sampleTitles.map((t, i) => (
                    <p key={i} className="text-xs text-slate-600 font-mono truncate">
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
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          {debugOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Debug logs ({result.debugLogs.length})
        </button>

        {debugOpen && (
          <div className="mt-3 space-y-2">
            {result.debugLogs.map((log, i) => {
              const color =
                log.level === 'INPUT'
                  ? 'text-amber-600'
                  : log.level === 'MAPPING'
                  ? 'text-cyan-600'
                  : log.level === 'WARNING'
                  ? 'text-orange-600'
                  : log.level === 'VALIDATION'
                  ? 'text-sky-600'
                  : log.level === 'SCOUT'
                  ? 'text-violet-600'
                  : 'text-green-600';
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                  <p className={`text-xs font-mono font-semibold ${color}`}>{log.message}</p>
                  {log.data && (
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {Object.entries(log.data).map(([k, v]) => (
                          <tr key={k}>
                            <td className="text-slate-500 pr-4 py-0.5 align-top whitespace-nowrap">{k}</td>
                            <td className="text-slate-700 py-0.5 break-all">{String(v)}</td>
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

export function LinkGenerator({ embedded = false }: { embedded?: boolean } = {}) {
  // Load draft on first render
  const draft = loadDraft();

  const [selectedSites, setSelectedSites] = useState<SiteKey[]>(draft.selectedSites ?? ['MARKTPLAATS']);
  const [brand, setBrand] = useState(draft.brand ?? '');
  const [model, setModel] = useState(draft.model ?? '');
  const [yearFrom, setYearFrom] = useState(draft.yearFrom ?? '');
  const [yearTo, setYearTo] = useState(draft.yearTo ?? '');
  const [mileage, setMileage] = useState(draft.mileage ?? '');
  const [fuel, setFuel] = useState(draft.fuel ?? '');
  const [trim, setTrim] = useState(draft.trim ?? '');
  const [minPower, setMinPower] = useState(draft.minPower ?? '');
  const [gearbox, setGearbox] = useState(draft.gearbox ?? '');
  const [doors, setDoors] = useState(draft.doors ?? '');
  const [seats, setSeats] = useState(draft.seats ?? '');
  const [color, setColor] = useState(draft.color ?? '');
  const [vehicleType, setVehicleType] = useState(draft.vehicleType ?? '');
  const [useMemory, setUseMemory] = useState(draft.useMemory ?? false);
  const [generating, setGenerating] = useState(false);

  const [results, setResults] = useState<LinkGenUrlResult[]>(draft.results ?? []);
  const [validating, setValidating] = useState(false);
  const [validatingSet, setValidatingSet] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>(
    (draft.history ?? []).map((h) => ({ ...h, timestamp: new Date(h.timestamp) }))
  );

  // CSV Learner state
  const [csvBatchResult, setCsvBatchResult] = useState<CsvBatchResult | null>(null);
  const [csvDiagnostics, setCsvDiagnostics] = useState<CsvImportDiagnostics | null>(draft.csvDiagnostics ?? null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasZyteKey = !!(
    (import.meta.env.VITE_ZYTE_API_KEY as string | undefined) ||
    (import.meta.env.ZYTE_API_KEY as string | undefined)
  );

  // Auto-save draft with 500ms debounce (excludes transient states like validating/analyzing)
  const persistDraft = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveDraft({
        selectedSites,
        brand,
        model,
        yearFrom,
        yearTo,
        mileage,
        minPower,
        fuel,
        trim,
        gearbox,
        doors,
        seats,
        color,
        vehicleType,
        useMemory,
        results,
        history: history.map((h) => ({ ...h, timestamp: h.timestamp.toISOString() })),
        csvDiagnostics,
        csvSummary: csvBatchResult
          ? {
              analyzed: csvBatchResult.analyzed.length,
              mappingsDetected: csvBatchResult.mappingsDetected,
              confidenceAvg: csvBatchResult.confidenceAvg,
              warningCount: csvBatchResult.warningCount,
            }
          : null,
      });
    }, 500);
  }, [selectedSites, brand, model, yearFrom, yearTo, mileage, minPower, fuel, trim, gearbox, doors, seats, color, vehicleType, useMemory, results, history, csvDiagnostics, csvBatchResult]);

  useEffect(() => {
    persistDraft();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [persistDraft]);

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
    gearbox: gearbox || undefined,
    doors: doors.trim() || undefined,
    seats: seats.trim() || undefined,
    color: color.trim() || undefined,
    vehicleType: vehicleType.trim() || undefined,
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

    // Validate each URL individually so per-site loading state is accurate
    const validated: LinkGenUrlResult[] = [...results];

    try {
      await Promise.all(
        results.map(async (r, idx) => {
          const { updatedResult } = await validateWithRetry(r, params);
          validated[idx] = updatedResult;
          // Remove this site from the validating set as it completes
          setValidatingSet((prev) => {
            const next = new Set(prev);
            next.delete(r.site);
            return next;
          });
          // Incrementally update results so each card refreshes as its Scout run finishes
          setResults((prev) => {
            const copy = [...prev];
            copy[idx] = updatedResult;
            return copy;
          });
        })
      );

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

  const handleClear = () => {
    setSelectedSites(['MARKTPLAATS']);
    setBrand('');
    setModel('');
    setYearFrom('');
    setYearTo('');
    setMileage('');
    setFuel('');
    setTrim('');
    setMinPower('');
    setGearbox('');
    setDoors('');
    setSeats('');
    setColor('');
    setVehicleType('');
    setUseMemory(false);
    setResults([]);
    setHistory([]);
    setCsvBatchResult(null);
    setCsvDiagnostics(null);
    clearDraft();
  };

  const isFormValid =
    brand.trim().length > 0 && model.trim().length > 0 && selectedSites.length > 0;

  return (
    <div className={embedded ? 'w-full space-y-8' : 'max-w-3xl mx-auto space-y-8'}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        {!embedded && <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg border border-blue-600/20">
            <Link2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Link Generator</h1>
            <p className="text-sm text-slate-500">
              Generate and validate multi-market search URLs for ADA studies
            </p>
          </div>
        </div>}
        <button
          onClick={handleClear}
          title="Clear form, results and local session data (does not delete memory)"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-300 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">

        {/* Site selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Markets</label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-700 transition-colors">
                Select all
              </button>
              <span className="text-slate-300">·</span>
              <button onClick={clearAll} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
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
                      : 'bg-slate-200 border-slate-300 text-slate-700 hover:border-slate-300 hover:text-slate-900'
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
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">
              Brand <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="ex: TOYOTA"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">
              Model <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="ex: RAV4"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Year range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Year From</label>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => handleYearFromChange(e.target.value)}
              placeholder="ex: 2020"
              min="1990"
              max="2030"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Year To</label>
            <input
              type="number"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              placeholder="ex: 2023"
              min="1990"
              max="2030"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Mileage & Min Power */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Max Mileage (km)</label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="ex: 100000"
              min="0"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Min Power (CV)</label>
            <input
              type="number"
              value={minPower}
              onChange={(e) => setMinPower(e.target.value)}
              placeholder="ex: 150"
              min="0"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {minPower && (
              <p className="mt-1 text-xs text-slate-500">Appliqué sur les sites qui le supportent (AutoScout) ; ignoré ailleurs.</p>
            )}
          </div>
        </div>

        {/* Fuel & Trim */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Fuel</label>
            <select
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
            >
              <option value="">— Optional —</option>
              {FUEL_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Trim / Version</label>
            <input
              type="text"
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              placeholder="ex: GR SPORT"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Secondary criteria — parity with the Ingestion form. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Boîte</label>
            <select
              value={gearbox}
              onChange={(e) => setGearbox(e.target.value)}
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
            >
              <option value="">— Optional —</option>
              <option value="Manuelle">Manuelle</option>
              <option value="Automatique">Automatique</option>
              <option value="Semi-automatique">Semi-automatique</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Portes</label>
            <input type="number" value={doors} onChange={(e) => setDoors(e.target.value)} placeholder="ex: 5" min="0"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Places</label>
            <input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="ex: 5" min="0"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Couleur</label>
            <input type="text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="ex: Gris"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2 uppercase tracking-wider">Type</label>
            <input type="text" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="ex: Berline"
              className="w-full bg-slate-200 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
        </div>

        {/* Sort is always price-ascending on every generated URL. */}
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <span className="text-emerald-600">↑</span>
          Tri : <span className="text-slate-700">prix croissant</span> — appliqué automatiquement à toutes les URLs générées.
        </p>

        {/* Memory toggle */}
        <div className="flex items-center justify-between py-2 px-3 bg-slate-100 rounded-lg border border-slate-300">
          <div className="flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs text-slate-700">Use learned mappings (memory-first)</span>
          </div>
          <button
            onClick={() => setUseMemory((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              useMemory ? 'bg-green-600' : 'bg-slate-400'
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
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
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
          {/* Header row */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                Generated URLs
                <span className="ml-2 text-slate-500 normal-case font-normal text-xs">
                  {results.length} market{results.length > 1 ? 's' : ''}
                </span>
              </h2>
              {/* Post-validation summary */}
              {!validating && results.some((r) => r.validationStatus !== 'not_checked') && (() => {
                const valid = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'valid').length;
                const partial = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'partial').length;
                const invalid = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'invalid').length;
                return (
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    {valid > 0 && <span className="text-green-600">{valid} valid</span>}
                    {valid > 0 && (partial > 0 || invalid > 0) && <span className="mx-1 text-slate-400">·</span>}
                    {partial > 0 && <span className="text-amber-600">{partial} partial</span>}
                    {partial > 0 && invalid > 0 && <span className="mx-1 text-slate-400">·</span>}
                    {invalid > 0 && <span className="text-red-600">{invalid} invalid</span>}
                  </p>
                );
              })()}
            </div>

            <button
              onClick={handleScoutCheck}
              disabled={validating}
              title={
                !hasZyteKey
                  ? 'Zyte API key not configured — Scout will run but may not fetch'
                  : 'Validate URLs by fetching real listings (max 3 requests per site)'
              }
              className={`shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold transition-all shadow-sm ${
                !validating
                  ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500 hover:border-blue-400'
                  : 'bg-white border-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {validating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {validating ? 'Scout running...' : 'Scout Check'}
            </button>
          </div>

          {/* No Zyte key warning */}
          {!hasZyteKey && (
            <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700">
                <span className="font-semibold">Scout unavailable</span> — Zyte API key not configured.
                Set <span className="font-mono">VITE_ZYTE_API_KEY</span> in your <span className="font-mono">.env</span> to enable real listing validation.
              </p>
            </div>
          )}

          {/* Global loading banner */}
          {validating && (
            <div className="bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                <p className="text-xs text-blue-700 font-medium">
                  Scout is running — fetching real listings for each URL (max 3 requests per site)
                </p>
              </div>
              <div className="h-1 bg-blue-50 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
              </div>
            </div>
          )}

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
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wider">Session History</span>
          </div>
          <div className="space-y-4">
            {history.map((entry, i) => (
              <div key={i} className="py-3 border-b border-slate-200 last:border-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-700 font-medium">
                    {entry.params.brand} {entry.params.model}
                    {entry.params.trim ? ` · ${entry.params.trim}` : ''}
                  </span>
                  <span className="text-slate-300 text-xs">
                    {entry.results.map((r) => SITE_OPTIONS.find((s) => s.value === r.site)?.flag).join(' ')}
                  </span>
                  <span className="text-slate-400 text-xs ml-auto">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                {entry.results.map((r) => {
                  const site = SITE_OPTIONS.find((s) => s.value === r.site);
                  return (
                    <div key={r.site} className="flex items-center gap-2 pl-1">
                      <span className="text-xs text-slate-500 w-28 shrink-0">
                        {site?.flag} {site?.label}
                      </span>
                      <code className="text-xs text-slate-400 font-mono truncate flex-1">{r.url}</code>
                      {r.validationStatus !== 'not_checked' && (
                        <StatusBadge status={r.validationStatus} />
                      )}
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => navigator.clipboard.writeText(r.correctedUrl ?? r.url)}
                          className="p-1.5 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 transition-colors"
                          title={r.correctedUrl ? 'Copy corrected URL' : 'Copy URL'}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => window.open(r.correctedUrl ?? r.url, '_blank', 'noopener,noreferrer')}
                          className="p-1.5 bg-slate-200 hover:bg-slate-300 rounded text-slate-600 transition-colors"
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
                        <p key={j} className="text-xs text-blue-600/70 italic">
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

      {/* ─── Campagnes de mapping (exploration de masse) ─────────────────── */}
      {!embedded && <CampaignPanel />}

    </div>
  );
}


// ─── CSV Analysis Row ─────────────────────────────────────────────────────────


// ─── CSV Import Diagnostics Panel ─────────────────────────────────────────────


