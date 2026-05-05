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
  BookOpen,
  Upload,
  Save,
  Brain,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { generateSearchUrls, generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { validateWithRetry } from '../lib/linkgen/validator';
import {
  parseCSV,
  normalizeCsvRows,
  analyzeCsvBatch,
  saveMappingsBatch,
} from '../lib/linkgen/csvMappingLearner';
import { analyzeUrlWithGPT } from '../lib/linkgen/analyzeUrlWithGpt';
import { validateLearnedMapping } from '../lib/linkgen/validator';
import { supabase } from '../lib/supabase';
import type {
  LinkGenParams,
  LinkGenUrlResult,
  SiteKey,
  LinkGenCorrectionRecord,
  CsvAnalysisResult,
  CsvBatchResult,
  CsvImportDiagnostics,
  MappingMemoryRecord,
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

// ─── Score chip ───────────────────────────────────────────────────────────────

function ScoreChip({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? 'text-green-400 bg-green-900/20 border-green-700/40' :
    score >= 60 ? 'text-amber-400 bg-amber-900/20 border-amber-700/40' :
    'text-red-400 bg-red-900/20 border-red-700/40';
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
          {/* Score before/after — shown together when correction changed the score */}
          {!validating && scoreImproved && (
            <div className="flex items-center gap-1.5">
              <ScoreChip score={result.validationScore!} label="before" />
              <span className="text-zinc-600 text-xs">→</span>
              <ScoreChip score={result.validationScoreAfter!} label="after" />
            </div>
          )}
          {!validating && !scoreImproved && result.validationScore !== undefined && (
            <ScoreChip score={result.validationScore} label="score" />
          )}
          {validating ? (
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
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
        <div className="flex items-center gap-2.5 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
          <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <p className="text-xs text-zinc-400">
            Not checked yet — click <span className="font-semibold text-zinc-200">Scout Check</span> to verify this URL with real listings
          </p>
        </div>
      )}

      {/* Scout unavailable (Zyte key missing) */}
      {!validating && zyteUnavailable && (
        <div className="flex items-center gap-2.5 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300">
            <span className="font-semibold">Scout unavailable</span> — Zyte API key not configured. Mapping status unchanged.
          </p>
        </div>
      )}

      {/* Scout ran but returned no SCOUT_* logs — indicates validator issue */}
      {scoutRanButNoLogs && !zyteUnavailable && (
        <div className="flex items-center gap-2.5 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2.5">
          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <p className="text-xs text-red-300">
            Scout did not run — no validation logs returned. Check console for errors.
          </p>
        </div>
      )}

      {/* Broader search notice (trim was requested but removed for a better score) */}
      {!validating && result.validationIssues?.some((i) => i.type === 'trim_removed_for_broader_market') && (
        <div className="flex items-center gap-2.5 bg-zinc-800/60 border border-zinc-600 rounded-lg px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <p className="text-xs text-zinc-300">
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
                  ? 'bg-red-900/20 text-red-400 border-red-700/40'
                  : 'bg-zinc-800 text-amber-400 border-zinc-700'
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
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-medium">Best verified URL</span>
            {result.correctionReason && (
              <span className="text-zinc-500 italic">— {result.correctionReason}</span>
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
      {!hasCorrectedUrl && !hasBestUrl && result.correctionReason && (
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

      {/* Mapping source info */}
      {!validating && result.mappingSource && (
        <div className="flex items-center gap-2 text-xs text-zinc-600 font-mono">
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
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {hypOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <RefreshCw className="w-3.5 h-3.5" />
            Hypotheses tested ({result.testedHypotheses!.length})
          </button>
          {hypOpen && (
            <div className="mt-2 space-y-2">
              {result.testedHypotheses!.map((h, i) => (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-zinc-600 font-mono text-[10px]">H{h.rankInBatch}</span>
                    <StatusBadge status={h.status} />
                    <ScoreChip score={h.score} label="score" />
                    <span className="text-xs text-zinc-500 italic">{h.reason}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 font-mono truncate flex-1 min-w-0"
                    >
                      {h.url.slice(0, 90)}{h.url.length > 90 ? '…' : ''}
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(h.url)}
                      className="shrink-0 text-zinc-600 hover:text-zinc-400"
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

              {/* Parser details row */}
              {result.diagnostics.parserDetails && (
                <div className="border-t border-zinc-800 pt-3 space-y-1">
                  <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Parser</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                    {[
                      ['htmlLength', `${Math.round(result.diagnostics.parserDetails.htmlLength / 1024)}KB`],
                      ['parser', result.diagnostics.parserDetails.parserUsed.replace('study-core/parsers/', '')],
                      ['listings parsed', String(result.diagnostics.parserDetails.parsedSampleCount)],
                      ['method', result.diagnostics.parserDetails.extractionMethod],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="text-zinc-500 w-28 shrink-0">{k}</span>
                        <span className={result.diagnostics!.parserDetails!.parsedSampleCount === 0 && k === 'listings parsed' ? 'text-red-400 font-semibold' : 'text-zinc-400'}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parsed sample listings */}
              <div className="border-t border-zinc-800 pt-3 space-y-1.5">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Parsed sample listings</p>
                {result.diagnostics.parsedSampleListings && result.diagnostics.parsedSampleListings.length > 0 ? (
                  result.diagnostics.parsedSampleListings.map((l, i) => (
                    <div key={i} className="bg-zinc-900 rounded px-3 py-2 space-y-0.5">
                      <p className="text-xs text-zinc-200 font-medium truncate">{l.title}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {l.year && <span className="text-[10px] font-mono text-zinc-400">{l.year}</span>}
                        {l.mileage && <span className="text-[10px] font-mono text-zinc-400">{Math.round(l.mileage / 1000)}k km</span>}
                        {l.fuel && <span className="text-[10px] font-mono text-zinc-500">{l.fuel}</span>}
                        {l.price > 0 && <span className="text-[10px] font-mono text-zinc-400">€{l.price.toLocaleString('fr-FR')}</span>}
                      </div>
                    </div>
                  ))
                ) : result.diagnostics.parserDetails ? (
                  <div className="bg-zinc-900 rounded px-3 py-2.5">
                    <p className="text-xs text-red-400 font-mono">
                      {result.diagnostics.parserDetails.htmlLength > 100_000
                        ? `HTML fetched (${Math.round(result.diagnostics.parserDetails.htmlLength / 1024)}KB) but parser extracted 0 listings.`
                        : 'No HTML or very small page — fetch may have failed silently.'}
                    </p>
                  </div>
                ) : null}
              </div>

              {result.diagnostics.sampleTitles.length > 0 && (
                <div className="space-y-1 border-t border-zinc-800 pt-3">
                  <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Sample titles (enriched)</p>
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
                  : log.level === 'SCOUT'
                  ? 'text-violet-400'
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
  const [useMemory, setUseMemory] = useState(draft.useMemory ?? false);
  const [generating, setGenerating] = useState(false);

  const [results, setResults] = useState<LinkGenUrlResult[]>(draft.results ?? []);
  const [validating, setValidating] = useState(false);
  const [validatingSet, setValidatingSet] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>(
    (draft.history ?? []).map((h) => ({ ...h, timestamp: new Date(h.timestamp) }))
  );

  // CSV Learner state
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvBatchResult, setCsvBatchResult] = useState<CsvBatchResult | null>(null);
  const [csvDiagnostics, setCsvDiagnostics] = useState<CsvImportDiagnostics | null>(draft.csvDiagnostics ?? null);
  const [csvAnalyzing, setCsvAnalyzing] = useState(false);
  const [csvSaving, setCsvSaving] = useState(false);
  const [csvSaveResult, setCsvSaveResult] = useState<{ saved: number; skipped: number; errors: number } | null>(null);
  const [gptLoadingIdx, setGptLoadingIdx] = useState<number | null>(null);
  const [gptResults, setGptResults] = useState<Record<number, { explanation?: string; confidence?: number; status: string }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  }, [selectedSites, brand, model, yearFrom, yearTo, mileage, minPower, fuel, trim, useMemory, results, history, csvDiagnostics, csvBatchResult]);

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
    setUseMemory(false);
    setResults([]);
    setHistory([]);
    setCsvBatchResult(null);
    setCsvDiagnostics(null);
    setCsvSaveResult(null);
    setGptResults({});
    clearDraft();
  };

  const isFormValid =
    brand.trim().length > 0 && model.trim().length > 0 && selectedSites.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
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
        <button
          onClick={handleClear}
          title="Clear form, results and local session data (does not delete memory)"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 hover:bg-red-900/10 border border-zinc-800 hover:border-red-900/40 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
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
          {/* Header row */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
                Generated URLs
                <span className="ml-2 text-zinc-500 normal-case font-normal text-xs">
                  {results.length} market{results.length > 1 ? 's' : ''}
                </span>
              </h2>
              {/* Post-validation summary */}
              {!validating && results.some((r) => r.validationStatus !== 'not_checked') && (() => {
                const valid = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'valid').length;
                const partial = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'partial').length;
                const invalid = results.filter((r) => (r.bestVerifiedStatus ?? r.validationStatus) === 'invalid').length;
                return (
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">
                    {valid > 0 && <span className="text-green-400">{valid} valid</span>}
                    {valid > 0 && (partial > 0 || invalid > 0) && <span className="mx-1 text-zinc-600">·</span>}
                    {partial > 0 && <span className="text-amber-400">{partial} partial</span>}
                    {partial > 0 && invalid > 0 && <span className="mx-1 text-zinc-600">·</span>}
                    {invalid > 0 && <span className="text-red-400">{invalid} invalid</span>}
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
                  : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
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
            <div className="flex items-center gap-2.5 bg-amber-900/20 border border-amber-700/40 rounded-lg px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">
                <span className="font-semibold">Scout unavailable</span> — Zyte API key not configured.
                Set <span className="font-mono">VITE_ZYTE_API_KEY</span> in your <span className="font-mono">.env</span> to enable real listing validation.
              </p>
            </div>
          )}

          {/* Global loading banner */}
          {validating && (
            <div className="bg-blue-950/40 border border-blue-700/40 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                <p className="text-xs text-blue-300 font-medium">
                  Scout is running — fetching real listings for each URL (max 3 requests per site)
                </p>
              </div>
              <div className="h-1 bg-blue-900/40 rounded-full overflow-hidden">
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
                    setCsvDiagnostics(null);
                    setCsvSaveResult(null);
                    setGptResults({});
                    setCsvAnalyzing(true);
                    try {
                      const text = await file.text();
                      const parsed = parseCSV(text);
                      const { rows: normalized, rejections, targetUrlCount, sourceUrlCount } =
                        normalizeCsvRows(parsed.rows, parsed.csvMode);
                      const batchResult = analyzeCsvBatch(normalized, {
                        filename: file.name,
                        fileSizeBytes: file.size,
                        detectedSeparator: parsed.separator,
                        detectedHeaders: parsed.headers,
                        rawRowCount: parsed.rawRowCount,
                        rejections,
                        csvMode: parsed.csvMode,
                        targetUrlCount,
                        sourceUrlCount,
                      });
                      setCsvBatchResult(batchResult);
                      setCsvDiagnostics(batchResult.importDiagnostics);
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

              {/* CSV Diagnostics — always shown after upload even if 0 results */}
              {csvDiagnostics && (
                <CsvImportDiagnosticsPanel diagnostics={csvDiagnostics} zeroResults={!csvBatchResult || csvBatchResult.analyzed.length === 0} />
              )}

              {csvBatchResult && csvBatchResult.analyzed.length > 0 && (
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

      {/* ─── Mapping Memory Explorer ─────────────────────────────────────── */}
      <MappingMemoryExplorer />

    </div>
  );
}

// ─── Mapping Memory Explorer ──────────────────────────────────────────────────

type MemoryFilter = { site: string; status: string; brand: string };

function MappingMemoryExplorer() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<MappingMemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<MemoryFilter>({ site: '', status: '', brand: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revalidatingId, setRevalidatingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [revalidateMsg, setRevalidateMsg] = useState<Record<string, string>>({});

  async function loadRecords() {
    setLoading(true);
    try {
      let q = supabase
        .from('linkgen_mapping_memory')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (filter.site) q = q.eq('site', filter.site);
      if (filter.status) q = q.eq('validation_status', filter.status);
      if (filter.brand) q = q.ilike('brand', `%${filter.brand}%`);
      const { data } = await q;
      setRecords((data ?? []) as unknown as MappingMemoryRecord[]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevalidate(record: MappingMemoryRecord) {
    setRevalidatingId(record.id);
    setRevalidateMsg((m) => ({ ...m, [record.id]: '' }));
    try {
      const result = await validateLearnedMapping(record);
      let msg: string;
      if (result.fetchBlocked) {
        msg = 'Scout unavailable — Zyte key missing or fetch failed. Status unchanged.';
      } else {
        msg = `Scout score: ${result.score} → ${result.validationStatus}`;
      }
      setRevalidateMsg((m) => ({ ...m, [record.id]: msg }));
      if (!result.fetchBlocked) {
        await loadRecords(); // refresh the row only if something changed
      }
    } finally {
      setRevalidatingId(null);
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('linkgen_mapping_memory').delete().eq('id', id);
    setConfirmDeleteId(null);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  const statusColor = (s: string) =>
    s === 'valid' ? 'text-green-400 bg-green-900/20 border-green-700/40' :
    s === 'invalid' ? 'text-red-400 bg-red-900/20 border-red-700/40' :
    s === 'partial' ? 'text-amber-400 bg-amber-900/20 border-amber-700/40' :
    'text-zinc-400 bg-zinc-800/60 border-zinc-700'; // pending

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-600/10 rounded-lg border border-blue-600/20">
            <Brain className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-zinc-100">Mapping Memory Explorer</p>
            <p className="text-xs text-zinc-500">Inspect, revalidate, and delete learned URL mappings</p>
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-zinc-800 space-y-4 pt-5">
          {/* Filters + load */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Site</label>
              <select
                value={filter.site}
                onChange={(e) => setFilter((f) => ({ ...f, site: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="">All sites</option>
                <option value="LEBONCOIN">Leboncoin</option>
                <option value="MARKTPLAATS">Marktplaats</option>
                <option value="BILBASEN">Bilbasen</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Status</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="valid">Valid</option>
                <option value="invalid">Invalid</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Brand</label>
              <input
                type="text"
                value={filter.brand}
                onChange={(e) => setFilter((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. BMW"
                className="bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-blue-500 w-32"
              />
            </div>
            <button
              onClick={loadRecords}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-200 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {loading ? 'Loading...' : 'Load mappings'}
            </button>
          </div>

          {/* Table */}
          {records.length === 0 && !loading && (
            <p className="text-xs text-zinc-600 italic">No records loaded. Click "Load mappings" to start.</p>
          )}

          {records.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">{records.length} records</p>
              {records.map((record) => (
                <div key={record.id} className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                  {/* Row summary */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                      <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{record.site}</span>
                      <span className="text-xs text-zinc-200 font-medium">{record.brand} {record.model}</span>
                      {record.fuel && <span className="text-xs text-zinc-500">{record.fuel}</span>}
                      {record.trim && <span className="text-xs text-zinc-600 italic">{record.trim}</span>}
                      <span className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded ${statusColor(record.validation_status)}`}>
                        {record.validation_status}
                      </span>
                      {record.validation_status === 'pending' && (
                        <span className="text-[10px] text-zinc-500 italic">CSV only — not Scout validated yet</span>
                      )}
                      {record.scout_score > 0 && (
                        <span className="text-[10px] font-mono text-zinc-400">score {record.scout_score}</span>
                      )}
                      <span className="text-[10px] text-zinc-600 font-mono">
                        ✓{record.success_count} ✗{record.failure_count}
                      </span>
                      {record.last_checked_at && (
                        <span className="text-[10px] text-zinc-600 font-mono">
                          {new Date(record.last_checked_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                        className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 transition-colors"
                      >
                        {expandedId === record.id ? 'Close' : 'Details'}
                      </button>
                      <button
                        onClick={() => handleRevalidate(record)}
                        disabled={revalidatingId === record.id}
                        className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-blue-900/40 border border-zinc-700 hover:border-blue-700/40 rounded text-zinc-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        {revalidatingId === record.id ? (
                          <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Checking...</span>
                        ) : 'Revalidate'}
                      </button>
                      {confirmDeleteId === record.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(record.id)}
                            className="text-[10px] px-2 py-1 bg-red-900/40 border border-red-700/40 rounded text-red-400 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-500 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(record.id)}
                          className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-red-900/20 border border-zinc-700 hover:border-red-700/40 rounded text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Revalidate result message */}
                  {revalidateMsg[record.id] && (
                    <div className={`px-4 pb-2 text-[10px] font-mono ${
                      revalidateMsg[record.id].includes('unavailable') || revalidateMsg[record.id].includes('failed')
                        ? 'text-amber-400'
                        : revalidateMsg[record.id].includes('valid')
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}>{revalidateMsg[record.id]}</div>
                  )}
                  {/* Expanded details */}
                  {expandedId === record.id && (
                    <div className="px-4 pb-4 border-t border-zinc-800/60 pt-3 space-y-3">
                      {[
                        ['source_url', record.source_url],
                        ['validated_url', record.validated_url],
                        ['confidence', String(record.confidence)],
                        ['scout_score', String(record.scout_score)],
                        ['created_at', record.created_at],
                        ['updated_at', record.updated_at],
                      ].map(([k, v]) => v ? (
                        <div key={k} className="flex items-start gap-3 text-xs font-mono">
                          <span className="text-zinc-500 w-28 shrink-0">{k}</span>
                          <span className="text-zinc-300 break-all">{v}</span>
                        </div>
                      ) : null)}
                      {[
                        ['detected_params', record.detected_params],
                        ['inferred_mapping', record.inferred_mapping],
                        ['validated_mapping', record.validated_mapping],
                        ['issues', record.issues],
                        ['tested_hypotheses', record.tested_hypotheses],
                      ].map(([k, v]) => v ? (
                        <div key={String(k)}>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{String(k)}</p>
                          <pre className="text-[10px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

// ─── CSV Import Diagnostics Panel ─────────────────────────────────────────────

const REJECTION_LABELS: Record<string, string> = {
  missing_url: 'Missing URL',
  missing_brand_and_model: 'Missing brand and model',
  empty_row: 'Empty row',
  parse_error: 'Parse error',
  unknown_headers: 'Unknown headers',
};

function CsvImportDiagnosticsPanel({
  diagnostics,
  zeroResults,
}: {
  diagnostics: CsvImportDiagnostics;
  zeroResults: boolean;
}) {
  const [rejectionsOpen, setRejectionsOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const isAda = diagnostics.csvMode === 'headerless_ada';

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${zeroResults ? 'bg-red-950/10 border-red-800/30' : 'bg-zinc-800/30 border-zinc-700/40'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">CSV Import Diagnostics</span>
        </div>
        {diagnostics.csvMode && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${
            isAda
              ? 'bg-blue-950/30 border-blue-800/40 text-blue-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400'
          }`}>
            {isAda ? 'headerless_ada' : 'headered'}
          </span>
        )}
      </div>

      {/* File info */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">{diagnostics.filename}</span>
        <span className="text-zinc-600">·</span>
        <span>{formatBytes(diagnostics.fileSizeBytes)}</span>
        <span className="text-zinc-600">·</span>
        <span>separator: <code className="text-blue-300">{diagnostics.detectedSeparator}</code></span>
      </div>

      {/* ADA positional mapping */}
      {isAda && diagnostics.adaPositionalMapping && (
        <div className="bg-blue-950/10 border border-blue-900/30 rounded p-3 space-y-2">
          <button
            onClick={() => setMappingOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors w-full"
          >
            {mappingOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="font-medium">ADA positional mapping applied</span>
          </button>
          {mappingOpen && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
              {Object.entries(diagnostics.adaPositionalMapping).map(([idx, field]) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-zinc-600 w-4 text-right">{idx}</span>
                  <span className="text-zinc-500">→</span>
                  <span className={field.includes('url') ? 'text-blue-300' : field === 'study_id' ? 'text-zinc-500' : 'text-zinc-300'}>
                    {field}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Headers (headered mode) */}
      {!isAda && (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Detected headers ({diagnostics.detectedHeaders.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {diagnostics.detectedHeaders.map((h) => (
              <span key={h} className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 px-2 py-0.5 rounded font-mono">
                {h}
              </span>
            ))}
            {diagnostics.detectedHeaders.length === 0 && (
              <span className="text-xs text-red-400">No headers detected — is the file valid CSV?</span>
            )}
          </div>
        </div>
      )}

      {/* Row counts */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div>
          <span className="text-zinc-500">Raw rows</span>
          <span className="ml-1.5 font-semibold text-zinc-200">{diagnostics.rawRowCount}</span>
        </div>
        {isAda ? (
          <>
            <div>
              <span className="text-zinc-500">Generated rows</span>
              <span className="ml-1.5 font-semibold text-green-400">{diagnostics.generatedRowCount ?? diagnostics.validRowCount}</span>
            </div>
            {diagnostics.targetUrlCount !== undefined && (
              <div>
                <span className="text-zinc-500">Target URLs</span>
                <span className="ml-1.5 font-semibold text-blue-400">{diagnostics.targetUrlCount}</span>
              </div>
            )}
            {diagnostics.sourceUrlCount !== undefined && (
              <div>
                <span className="text-zinc-500">Source URLs</span>
                <span className="ml-1.5 font-semibold text-blue-400">{diagnostics.sourceUrlCount}</span>
              </div>
            )}
          </>
        ) : (
          <div>
            <span className="text-zinc-500">Valid</span>
            <span className="ml-1.5 font-semibold text-green-400">{diagnostics.validRowCount}</span>
          </div>
        )}
        {diagnostics.rejectedRowCount > 0 && (
          <div>
            <span className="text-zinc-500">Rejected</span>
            <span className="ml-1.5 font-semibold text-red-400">{diagnostics.rejectedRowCount}</span>
          </div>
        )}
      </div>

      {/* Zero results alert */}
      {zeroResults && (
        <div className="bg-red-950/20 border border-red-800/30 rounded p-3 space-y-1.5">
          <p className="text-xs font-semibold text-red-400">0 rows could be analyzed</p>
          {isAda ? (
            <p className="text-xs text-zinc-400">
              ADA positional mode active but all rows were rejected. Check that columns 6 and 8 contain valid URLs and columns 1–2 contain brand/model.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-400">Make sure your CSV contains a URL column:</p>
              <div className="flex flex-wrap gap-1">
                {['url', 'source_search_url', 'source_url', 'target_url', 'link'].map((n) => (
                  <code key={n} className="text-xs bg-zinc-800 text-blue-300 px-1.5 py-0.5 rounded">{n}</code>
                ))}
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                And at least one of:{' '}
                {['brand', 'marque', 'model', 'modele'].map((n) => (
                  <code key={n} className="text-blue-300 mr-1">{n}</code>
                ))}
              </p>
            </>
          )}
        </div>
      )}

      {/* Rejected rows */}
      {diagnostics.rejections.length > 0 && (
        <div>
          <button
            onClick={() => setRejectionsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {rejectionsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Rejected rows ({diagnostics.rejections.length}{diagnostics.rejectedRowCount > 10 ? `, showing first 10 of ${diagnostics.rejectedRowCount}` : ''})
          </button>
          {rejectionsOpen && (
            <div className="mt-2 space-y-1">
              {diagnostics.rejections.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-zinc-600 font-mono shrink-0">row {r.rowIndex}</span>
                  <span className={`shrink-0 px-1.5 py-0 rounded text-[10px] font-medium ${
                    r.reason === 'missing_url' ? 'bg-red-900/40 text-red-400' :
                    r.reason === 'empty_row' ? 'bg-zinc-800 text-zinc-500' :
                    'bg-amber-900/30 text-amber-400'
                  }`}>
                    {REJECTION_LABELS[r.reason] ?? r.reason}
                  </span>
                  {r.preview && (
                    <span className="text-zinc-600 font-mono truncate">{r.preview}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
