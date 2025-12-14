import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { History, X, ExternalLink, CheckCircle, XCircle, FileText } from 'lucide-react';
import { exportListingToPdf } from '../lib/pdfExporter';
import { sanitizeUUID } from '../lib/uuid-utils';
import type { RealtimeChannel } from '@supabase/supabase-js';

const MAX_RUNNING_AGE_MS = 60 * 60 * 1000; // 1 hour

interface StudyRun {
  id: string;
  run_type: string;
  executed_at: string | null;
  status: string;
  total_studies: number;
  null_count: number;
  opportunities_count: number;
  price_diff_threshold_eur: number;
}

interface StudyRunResult {
  id: string;
  study_id: string;
  status: string;
  target_market_price: number | null;
  best_source_price: number | null;
  price_difference: number | null;
  target_error_reason: string | null;
  target_stats: {
    median_price: number;
    average_price: number;
    min_price: number;
    max_price: number;
    count: number;
    percentile_25: number;
    percentile_75: number;
    targetMarketUrl?: string;
    sourceMarketUrl?: string;
    targetMarketMedianEur?: number;
  } | null;
  studies_v2: {
    brand: string;
    model: string;
    year: number;
    country_target: string;
    country_source: string;
    source_trim_text?: string | null;
    target_trim_text?: string | null;
  };
}

interface SourceListing {
  id: string;
  listing_url: string;
  title: string;
  price: number;
  mileage: number | null;
  year: number | null;
  trim: string | null;
  is_damaged: boolean;
  defects_summary: string | null;
  maintenance_summary: string | null;
  options_summary: string | null;
  entretien: string | null;
  options: string[] | null;
  status: string;
  car_image_urls: string[] | null;
}

export function StudiesV2Results() {
  const [latestRun, setLatestRun] = useState<StudyRun | null>(null);
  const [isFreshRunning, setIsFreshRunning] = useState(false);
  const [results, setResults] = useState<StudyRunResult[]>([]);
  const [history, setHistory] = useState<StudyRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedResult, setSelectedResult] = useState<StudyRunResult | null>(null);
  const [listings, setListings] = useState<SourceListing[]>([]);
  const [showListingsModal, setShowListingsModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportingListingId, setExportingListingId] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<number>(5000);
  const lastCompletedCountRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(Date.now());
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadLatestRun();
    loadHistory();

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    if (isFreshRunning) {
      console.log('[RESULTS] Fresh batch is running, setting up realtime subscription and fallback polling');

      currentRunIdRef.current = latestRun!.id;
      lastActivityRef.current = Date.now();
      pollingIntervalRef.current = 5000;
      lastCompletedCountRef.current = results.length;

      const channel = supabase
        .channel('study-runs-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'study_runs',
            filter: `id=eq.${latestRun!.id}`,
          },
          (payload) => {
            console.log('[RESULTS] Realtime event on study_runs:', payload.eventType);
            handleRealtimeUpdate();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'study_run_results',
            filter: `run_id=eq.${latestRun!.id}`,
          },
          (payload) => {
            console.log('[RESULTS] Realtime event on study_run_results:', payload.eventType);
            handleRealtimeUpdate();
          }
        )
        .subscribe((status) => {
          console.log('[RESULTS] Realtime subscription status:', status);
        });

      realtimeChannelRef.current = channel;

      scheduleNextPoll();
    } else {
      console.log('[RESULTS] Batch completed or not running, stopping updates');
      currentRunIdRef.current = null;
      pollingIntervalRef.current = 5000;
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, [isFreshRunning, latestRun?.id]);

  async function handleRealtimeUpdate() {
    if (!currentRunIdRef.current) return;

    console.log('[RESULTS] Handling realtime update, refreshing data...');
    await loadRunResults(currentRunIdRef.current, true);
    await loadLatestRun();
  }

  function scheduleNextPoll() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    const inactivityMs = Date.now() - lastActivityRef.current;
    const maxInactivityMs = 10 * 60 * 1000;

    if (inactivityMs > maxInactivityMs) {
      console.log('[RESULTS] Inactivity timeout reached (10 min), stopping polling');
      return;
    }

    if (!isFreshRunning) {
      console.log('[RESULTS] No fresh running batch, stopping polling');
      return;
    }

    console.log(`[RESULTS] Scheduling next poll in ${pollingIntervalRef.current}ms`);

    pollTimerRef.current = setTimeout(async () => {
      await handlePollingRefresh();
      scheduleNextPoll();
    }, pollingIntervalRef.current);
  }

  async function handlePollingRefresh() {
    if (!currentRunIdRef.current) return;

    console.log('[RESULTS] Polling refresh triggered');

    const oldCompletedCount = lastCompletedCountRef.current;

    await loadRunResults(currentRunIdRef.current, true);
    await loadLatestRun();

    const newCompletedCount = lastCompletedCountRef.current;

    if (newCompletedCount > oldCompletedCount) {
      console.log(`[RESULTS] Progress detected: ${oldCompletedCount} -> ${newCompletedCount} completed studies`);
      lastActivityRef.current = Date.now();
      pollingIntervalRef.current = 5000;
    } else {
      const oldInterval = pollingIntervalRef.current;
      pollingIntervalRef.current = Math.min(oldInterval * 2, 60000);
      console.log(`[RESULTS] No progress, backing off: ${oldInterval}ms -> ${pollingIntervalRef.current}ms`);
    }
  }

  async function loadLatestRun() {
    try {
      setLoading(true);
      const { data: runData, error: runError } = await supabase
        .from('study_runs')
        .select('*')
        .in('status', ['completed', 'running'])
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runError) throw runError;

      if (runData) {
        const now = Date.now();
        const startedAt = runData.executed_at ? new Date(runData.executed_at).getTime() : 0;

        const freshRunning =
          runData.status === 'running' &&
          startedAt > 0 &&
          now - startedAt < MAX_RUNNING_AGE_MS;

        console.log('[RESULTS] Loaded run:', runData.id, 'status:', runData.status, 'isFreshRunning:', freshRunning);

        setLatestRun(runData);
        setIsFreshRunning(freshRunning);
        await loadRunResults(runData.id, false);
      }
    } catch (error) {
      console.error('Error loading latest run:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadRunResults(runId: string, checkForChanges = false) {
    try {
      const cleanRunId = sanitizeUUID(runId);
      const { data, error } = await supabase
        .from('study_run_results')
        .select(`
          *,
          studies_v2 (
            brand,
            model,
            year,
            country_target,
            country_source
          )
        `)
        .eq('run_id', cleanRunId)
        .order('price_difference', { ascending: false, nullsFirst: false });

      if (error) throw error;

      const newCount = data?.length || 0;

      if (checkForChanges && newCount === lastCompletedCountRef.current && newCount > 0) {
        console.log('[RESULTS] Same result count, skipping state update to avoid re-render');
        return;
      }

      console.log('[RESULTS] Loaded', newCount, 'results for run', runId);
      setResults(data || []);
      lastCompletedCountRef.current = newCount;
    } catch (error) {
      console.error('Error loading run results:', error);
    }
  }

  async function loadHistory() {
    try {
      const { data, error } = await supabase
        .from('study_runs')
        .select('*')
        .in('status', ['completed', 'running', 'cancelled'])
        .order('executed_at', { ascending: false });

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  async function loadListings(resultId: string) {
    try {
      const cleanResultId = sanitizeUUID(resultId);
      const { data, error } = await supabase
        .from('study_source_listings')
        .select('*')
        .eq('run_result_id', cleanResultId)
        .order('price', { ascending: true });

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Error loading listings:', error);
    }
  }

  async function viewListings(result: StudyRunResult) {
    setSelectedResult(result);
    await loadListings(result.id);
    setShowListingsModal(true);
  }

  async function selectHistoricalRun(run: StudyRun) {
    setLatestRun(run);
    setIsFreshRunning(false);
    await loadRunResults(run.id, false);
    setShowHistory(false);
  }

  async function updateListingStatus(listingId: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from('study_source_listings')
        .update({ status: newStatus })
        .eq('id', listingId);

      if (error) throw error;

      setListings(prevListings =>
        prevListings.map(listing =>
          listing.id === listingId ? { ...listing, status: newStatus } : listing
        )
      );
    } catch (error) {
      console.error('Error updating listing status:', error);
      alert(`Error updating status: ${(error as Error).message}`);
    }
  }

  async function handleExportPdf(listing: SourceListing) {
    try {
      setExportingListingId(listing.id);

      const imageCount = (listing.car_image_urls || []).length;
      console.log(`[PDF_EXPORT_DEBUG] Exporting PDF for listing: ${listing.listing_url}`);
      console.log(`[PDF_EXPORT_DEBUG] listing.car_image_urls length: ${imageCount}`);
      if (imageCount > 0) {
        console.log(`[PDF_EXPORT_DEBUG] First image URL: ${listing.car_image_urls![0].slice(0, 100)}...`);
      }

      const brand = selectedResult?.studies_v2.brand;
      const model = selectedResult?.studies_v2.model;
      const sourceTrim = selectedResult?.studies_v2.source_trim_text;

      await exportListingToPdf(null, {
        brand,
        model,
        year: listing.year || undefined,
        trim: listing.trim,
        imageUrls: listing.car_image_urls || [],
        sourceTrim: sourceTrim || undefined,
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error generating PDF. Please try again.');
    } finally {
      setExportingListingId(null);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'APPROVED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400">Approved</span>;
      case 'REJECTED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-red-900/30 text-red-400">Rejected</span>;
      case 'COMPLETED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-400">Completed</span>;
      default:
        return <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 text-zinc-300">New</span>;
    }
  }

  function getRunStatusPill(run: StudyRun) {
    const executedAtMs = run.executed_at ? new Date(run.executed_at).getTime() : 0;
    const isStaleRunning =
      run.status === 'running' &&
      executedAtMs > 0 &&
      Date.now() - executedAtMs > MAX_RUNNING_AGE_MS;

    const effectiveStatus: 'running' | 'stale' | 'completed' | 'cancelled' | string =
      isStaleRunning ? 'stale' : run.status;

    if (effectiveStatus === 'running') {
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/30 text-blue-400 flex items-center gap-1">
          <div className="inline-block h-2 w-2 animate-spin rounded-full border border-blue-400 border-t-transparent"></div>
          Running
        </span>
      );
    }

    if (effectiveStatus === 'stale') {
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
          Stale
        </span>
      );
    }

    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">Results</h2>
          <p className="text-sm text-zinc-400 mt-1">
            View results from completed searches
          </p>
        </div>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg flex items-center gap-2 transition-colors"
        >
          <History size={18} />
          {showHistory ? 'Hide History' : 'Show History'}
        </button>
      </div>

      {showHistory && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="font-semibold text-zinc-100">Run History ({history.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Studies</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">NULL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Opportunities</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => {
                  const executedAtMs = run.executed_at ? new Date(run.executed_at).getTime() : 0;
                  const isStaleRunning =
                    run.status === 'running' &&
                    executedAtMs > 0 &&
                    Date.now() - executedAtMs > MAX_RUNNING_AGE_MS;

                  const effectiveStatus: 'running' | 'stale' | 'completed' | 'cancelled' | string =
                    isStaleRunning ? 'stale' : run.status;

                  return (
                    <tr key={run.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-zinc-300">
                            {run.executed_at ? new Date(run.executed_at).toLocaleString() : 'N/A'}
                          </div>
                          {getRunStatusPill(run)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          run.run_type === 'instant' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-900/30 text-blue-400'
                        }`}>
                          {run.run_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-zinc-300">{run.total_studies}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-zinc-400">{run.null_count}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-emerald-400 font-medium">{run.opportunities_count}</div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => selectHistoricalRun(run)}
                          className="text-sm text-blue-400 hover:text-blue-300"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isFreshRunning && (
        <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
            <div>
              <p className="text-blue-100 font-medium">Batch is currently running</p>
              <p className="text-blue-200 text-sm">
                Showing {results.length} completed studies so far (realtime updates + smart polling)
              </p>
            </div>
          </div>
          <button
            onClick={loadLatestRun}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
          >
            Refresh Now
          </button>
        </div>
      )}

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-zinc-100">
                {latestRun ? `Run from ${new Date(latestRun.executed_at!).toLocaleString()}` : 'Latest Run'}
              </h3>
              {isFreshRunning && (
                <p className="text-xs text-blue-400 mt-1">In progress - results shown below are incrementally persisted</p>
              )}
            </div>
            {latestRun && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-400">
                  Total: <span className="text-zinc-100 font-medium">{latestRun.total_studies}</span>
                </span>
                <span className="text-zinc-400">
                  Completed: <span className="text-zinc-100 font-medium">{results.length}</span>
                </span>
                <span className="text-zinc-400">
                  NULL: <span className="text-zinc-100 font-medium">{latestRun.null_count}</span>
                </span>
                <span className="text-zinc-400">
                  Opportunities: <span className="text-emerald-400 font-medium">{latestRun.opportunities_count}</span>
                </span>
                <span className="px-2 py-1 bg-blue-900/30 border border-blue-700/50 rounded text-blue-300 text-xs font-medium">
                  Threshold: ≥ {latestRun.price_diff_threshold_eur.toLocaleString()} EUR
                </span>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading results...</div>
        ) : !latestRun ? (
          <div className="p-8 text-center text-zinc-400">
            No completed runs yet. Run a search to see results here.
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            No results found for this run.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Brand/Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Year</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Markets</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Target Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Best Source</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Difference</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{result.studies_v2.brand}</div>
                      <div className="text-sm text-zinc-400">{result.studies_v2.model}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-300">{result.studies_v2.year}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <span className="text-blue-400">{result.studies_v2.country_target}</span>
                        <span className="text-zinc-500"> ← </span>
                        <span className="text-emerald-400">{result.studies_v2.country_source}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-300">
                        {result.target_market_price ? `${result.target_market_price.toLocaleString()}€` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-300">
                        {result.best_source_price ? `${result.best_source_price.toLocaleString()}€` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-sm font-medium ${
                        result.price_difference && result.price_difference >= 5000
                          ? 'text-emerald-400'
                          : 'text-zinc-400'
                      }`}>
                        {result.price_difference ? `${result.price_difference.toLocaleString()}€` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          result.status === 'OPPORTUNITIES'
                            ? 'bg-emerald-900/30 text-emerald-400'
                            : result.status === 'TARGET_BLOCKED'
                            ? 'bg-red-900/30 text-red-400'
                            : 'bg-zinc-700 text-zinc-400'
                        }`}
                        title={result.status === 'TARGET_BLOCKED' && result.target_error_reason ? result.target_error_reason : undefined}
                      >
                        {result.status === 'TARGET_BLOCKED' ? 'TARGET BLOCKED' : result.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {result.status === 'OPPORTUNITIES' && (
                        <button
                          onClick={() => viewListings(result)}
                          className="text-sm text-blue-400 hover:text-blue-300"
                        >
                          View Listings
                        </button>
                      )}
                      {result.status === 'TARGET_BLOCKED' && result.target_error_reason && (
                        <div className="text-xs text-red-400/80 max-w-xs truncate" title={result.target_error_reason}>
                          {result.studies_v2.country_target}: Provider blocked
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showListingsModal && selectedResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">
                  Interesting Listings - {selectedResult.studies_v2.brand} {selectedResult.studies_v2.model}
                </h3>
                <p className="text-sm text-zinc-400 mt-1">
                  {listings.length} listings found in {selectedResult.studies_v2.country_source}
                </p>
              </div>
              <button
                onClick={() => setShowListingsModal(false)}
                className="p-2 hover:bg-zinc-800 rounded transition-colors"
              >
                <X size={20} className="text-zinc-400" />
              </button>
            </div>

            {selectedResult.target_stats && (
              <div className="px-4 pt-4 pb-2 bg-zinc-800/30 border-b border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase">
                    Target Market ({selectedResult.studies_v2.country_target})
                  </h4>
                  <div className="flex items-center gap-2">
                    {selectedResult.target_stats.targetMarketUrl && (
                      <a
                        href={selectedResult.target_stats.targetMarketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center gap-1.5 transition-colors"
                      >
                        View NL market
                        <ExternalLink size={12} />
                      </a>
                    )}
                    {selectedResult.target_stats.sourceMarketUrl && (
                      <a
                        href={selectedResult.target_stats.sourceMarketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center gap-1.5 transition-colors"
                      >
                        View FR market
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-zinc-500">Median</div>
                    <div className="font-semibold text-blue-400">{selectedResult.target_stats.median_price.toLocaleString()}€</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Average</div>
                    <div className="font-medium text-zinc-300">{selectedResult.target_stats.average_price.toLocaleString()}€</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Range</div>
                    <div className="font-medium text-zinc-300">
                      {selectedResult.target_stats.min_price.toLocaleString()}–{selectedResult.target_stats.max_price.toLocaleString()}€
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Count</div>
                    <div className="font-medium text-zinc-300">{selectedResult.target_stats.count} listings</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">P25–P75</div>
                    <div className="font-medium text-zinc-300">
                      {selectedResult.target_stats.percentile_25.toLocaleString()}–{selectedResult.target_stats.percentile_75.toLocaleString()}€
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-y-auto p-4 space-y-4">
              {listings.map((listing) => (
                <div key={listing.id} className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-zinc-100">{listing.title}</h4>
                        {getStatusBadge(listing.status)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-zinc-400">
                        <span className="font-bold text-lg text-emerald-400">{listing.price.toLocaleString()}€</span>
                        {selectedResult.target_stats && (
                          <span className="font-semibold text-emerald-300">
                            +{(selectedResult.target_stats.median_price - listing.price).toLocaleString()}€ opportunity
                          </span>
                        )}
                        {listing.year && <span>{listing.year}</span>}
                        {listing.mileage && <span>{listing.mileage.toLocaleString()} km</span>}
                        {listing.trim && <span className="text-zinc-500">{listing.trim}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleExportPdf(listing)}
                        disabled={exportingListingId === listing.id}
                        className={`px-3 py-2 text-white rounded text-sm flex items-center gap-2 transition-colors ${
                          exportingListingId === listing.id
                            ? 'bg-emerald-500 cursor-wait'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        {exportingListingId === listing.id ? (
                          <>
                            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            Generating PDF...
                          </>
                        ) : (
                          <>
                            <FileText size={14} />
                            Export PDF
                          </>
                        )}
                      </button>
                      <a
                        href={listing.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center gap-2 transition-colors"
                      >
                        View
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>

                  {listing.is_damaged && (
                    <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded">
                      <p className="text-sm text-red-300 font-medium">⚠️ Potentially damaged vehicle</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-400 uppercase mb-1">Defects</h5>
                      <p className="text-zinc-300">{listing.defects_summary || 'None mentioned'}</p>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-400 uppercase mb-1">Entretien</h5>
                      <p className="text-zinc-300">
                        {listing.entretien && listing.entretien.trim()
                          ? listing.entretien
                          : 'Aucune information d\'entretien mentionnée'}
                      </p>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-400 uppercase mb-1">Options</h5>
                      <p className="text-zinc-300">
                        {listing.options && Array.isArray(listing.options) && listing.options.length > 0
                          ? listing.options.join(', ')
                          : 'None mentioned'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-zinc-700">
                    {listing.status === 'NEW' && (
                      <>
                        <button
                          onClick={() => updateListingStatus(listing.id, 'APPROVED')}
                          className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                          <CheckCircle size={16} />
                          Approve for negotiation
                        </button>
                        <button
                          onClick={() => updateListingStatus(listing.id, 'REJECTED')}
                          className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                          <XCircle size={16} />
                          Reject
                        </button>
                      </>
                    )}
                    {listing.status === 'APPROVED' && (
                      <button
                        onClick={() => updateListingStatus(listing.id, 'NEW')}
                        className="px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded text-sm transition-colors"
                      >
                        Reset to New
                      </button>
                    )}
                    {listing.status === 'REJECTED' && (
                      <button
                        onClick={() => updateListingStatus(listing.id, 'NEW')}
                        className="px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded text-sm transition-colors"
                      >
                        Reset to New
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
