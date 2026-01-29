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
  created_at: string;
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
    market_target_url: string;
    market_source_url: string;
    trim_text?: string | null;
    trim_text_target?: string | null;
    trim_text_source?: string | null;
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
  internal_ref?: string;
  assigned_to?: string | null;
}

interface TodayRun {
  run: StudyRun;
  results: StudyRunResult[];
  isFreshRunning: boolean;
}

export function StudiesV2Results() {
  const [todayRuns, setTodayRuns] = useState<TodayRun[]>([]);
  const [history, setHistory] = useState<StudyRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedResult, setSelectedResult] = useState<StudyRunResult | null>(null);
  const [listings, setListings] = useState<SourceListing[]>([]);
  const [showListingsModal, setShowListingsModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportingListingId, setExportingListingId] = useState<string | null>(null);
  const [verifyMarketsResult, setVerifyMarketsResult] = useState<StudyRunResult | null>(null);

  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);

  function getTodayStart(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  function hasZeroListings(result: StudyRunResult): boolean {
    if (!result.target_stats || result.target_stats.count === 0) return true;
    if (result.target_error_reason?.includes('No valid source listings found')) return true;
    if (result.target_error_reason?.includes('No valid target listings found')) return true;
    return false;
  }

  useEffect(() => {
    loadTodayRuns();
    loadHistory();

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const runningRun = todayRuns.find(tr => tr.isFreshRunning);
    const incompleteRun = todayRuns.find(tr =>
      tr.run.status === 'completed' && tr.results.length < tr.run.total_studies
    );
    const activeRun = runningRun || incompleteRun;

    if (activeRun) {
      console.log('[RESULTS] Setting up Realtime for run:', activeRun.run.id);

      const channel = supabase
        .channel(`study-runs-${activeRun.run.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'study_runs',
            filter: `id=eq.${activeRun.run.id}`,
          },
          () => {
            console.log('[RESULTS] Study run updated');
            handleRealtimeUpdate(activeRun.run.id);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'study_run_results',
            filter: `run_id=eq.${activeRun.run.id}`,
          },
          (payload) => {
            console.log('[RESULTS] New result:', payload.new.status);
            handleRealtimeUpdate(activeRun.run.id);
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[RESULTS] Realtime subscribed');
          }
        });

      realtimeChannelRef.current = channel;
    }

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, [todayRuns]);

  async function handleRealtimeUpdate(_runId: string) {
    console.log('[RESULTS] Realtime update received, refreshing...');
    await loadTodayRuns();

    // Update selectedResult if modal is open to ensure it shows the latest data
    if (selectedResult && showListingsModal) {
      // Find the newest result for the same study across all runs
      const allResults = todayRuns.flatMap(tr => tr.results);
      const sameStudyResults = allResults.filter(r => r.study_id === selectedResult.study_id);

      if (sameStudyResults.length > 0) {
        // Sort by created_at descending and pick the newest
        const newestResult = sameStudyResults.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];

        console.log('[RESULTS] Updating selectedResult from', selectedResult.id, 'to', newestResult.id);
        setSelectedResult(newestResult);

        // Reload listings for the new result
        await loadListings(newestResult.id);
      }
    }
  }

  async function loadTodayRuns() {
    try {
      setLoading(true);
      const { data: allRuns, error: runError } = await supabase
        .from('study_runs')
        .select('*')
        .in('status', ['completed', 'running'])
        .order('executed_at', { ascending: false });

      if (runError) throw runError;

      const todayStart = getTodayStart();
      const runsToday = (allRuns || []).filter(run =>
        run.executed_at && new Date(run.executed_at) >= todayStart
      );

      console.log('[RESULTS] Found', runsToday.length, 'runs today');

      const todayRunsWithResults: TodayRun[] = [];

      for (const run of runsToday) {
        const results = await loadRunResults(run.id);
        const now = Date.now();
        const startedAt = run.executed_at ? new Date(run.executed_at).getTime() : 0;

        const freshRunning =
          run.status === 'running' &&
          startedAt > 0 &&
          now - startedAt < MAX_RUNNING_AGE_MS;

        todayRunsWithResults.push({
          run,
          results,
          isFreshRunning: freshRunning,
        });
      }

      setTodayRuns(todayRunsWithResults);
    } catch (error) {
      console.error('Error loading today runs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadRunResults(runId: string): Promise<StudyRunResult[]> {
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
            country_source,
            market_target_url,
            market_source_url,
            trim_text,
            trim_text_target,
            trim_text_source
          )
        `)
        .eq('run_id', cleanRunId)
        .order('price_difference', { ascending: false, nullsFirst: false });

      if (error) throw error;

      console.log('[RESULTS] Loaded', data?.length || 0, 'results for run', runId);
      return data || [];
    } catch (error) {
      console.error('Error loading run results:', error);
      return [];
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

      // Filter out today's runs
      const todayStart = getTodayStart();
      const historyRuns = (data || []).filter(run =>
        !run.executed_at || new Date(run.executed_at) < todayStart
      );

      // Reconciliation: Check for stale "running" runs that are actually complete
      const runningRuns = historyRuns.filter(run => run.status === 'running');

      for (const run of runningRuns) {
        // Check if this run has completed results
        const { data: resultsData, error: resultsError } = await supabase
          .from('study_run_results')
          .select('id', { count: 'exact', head: true })
          .eq('run_id', run.id);

        if (!resultsError) {
          const completedCount = resultsData?.length || 0;

          // If we have results >= total_studies, the run is actually complete
          if (completedCount >= run.total_studies) {
            console.log(`[HISTORY_RECONCILIATION] Run ${run.id} marked running but has ${completedCount}/${run.total_studies} results. Updating to completed.`);

            // Update DB status to completed
            const { error: updateError } = await supabase
              .from('study_runs')
              .update({ status: 'completed' })
              .eq('id', run.id);

            if (!updateError) {
              // Update local state
              run.status = 'completed';
            }
          }
        }
      }

      setHistory(historyRuns);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  async function loadListings(resultId: string) {
    try {
      const cleanResultId = sanitizeUUID(resultId);

      // Query through join table to get listings for this run
      const { data: mappings, error: mappingsError } = await supabase
        .from('study_run_result_listings')
        .select('listing_id')
        .eq('run_result_id', cleanResultId);

      if (mappingsError) throw mappingsError;

      if (!mappings || mappings.length === 0) {
        // Fallback for old runs (pre-join-table data)
        const { data, error } = await supabase
          .from('study_source_listings')
          .select('*')
          .eq('run_result_id', cleanResultId)
          .order('price', { ascending: true });

        if (error) throw error;
        setListings(data || []);
        return;
      }

      const listingIds = mappings.map(m => m.listing_id);

      const { data, error } = await supabase
        .from('study_source_listings')
        .select('*')
        .in('id', listingIds)
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
    const results = await loadRunResults(run.id);
    setTodayRuns([{
      run,
      results,
      isFreshRunning: false,
    }]);
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
    }
  }

  async function approveForNegotiation(listing: SourceListing, assignee: 'channing' | 'antoine') {
    try {
      const { error } = await supabase
        .from('study_source_listings')
        .update({
          status: 'APPROVED',
          assigned_to: assignee,
        })
        .eq('id', listing.id);

      if (error) {
        console.error('Error approving for negotiation:', error);
        return;
      }

      setListings(prevListings =>
        prevListings.map(l =>
          l.id === listing.id
            ? { ...l, status: 'APPROVED', assigned_to: assignee }
            : l
        )
      );
    } catch (error) {
      console.error('Error approving listing:', error);
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
      const sourceTrim = selectedResult?.studies_v2.trim_text_source;

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

      {todayRuns.some(tr => tr.isFreshRunning) && (
        <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
            <div>
              <p className="text-blue-100 font-medium">Batch is currently running</p>
              <p className="text-blue-200 text-sm">
                Realtime updates are shown below
              </p>
            </div>
          </div>
          <button
            onClick={loadTodayRuns}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
          >
            Refresh Now
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center text-zinc-400">
          Loading results...
        </div>
      ) : todayRuns.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center text-zinc-400">
          No runs today. Run a search to see results here.
        </div>
      ) : (
        <div className="space-y-6">
          {todayRuns.map((todayRun) => (
            <div key={todayRun.run.id} className="bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="p-4 border-b border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-zinc-100">
                      Run from {new Date(todayRun.run.executed_at!).toLocaleString()}
                    </h3>
                    {todayRun.isFreshRunning && (
                      <p className="text-xs text-blue-400 mt-1">In progress - results shown below are incrementally persisted</p>
                    )}
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-zinc-400">
                      Total: <span className="text-zinc-100 font-medium">{todayRun.run.total_studies}</span>
                    </span>
                    <span className="text-zinc-400">
                      Completed: <span className="text-zinc-100 font-medium">{todayRun.results.length}</span>
                    </span>
                    <span className="text-zinc-400">
                      NULL: <span className="text-zinc-100 font-medium">{todayRun.run.null_count}</span>
                    </span>
                    <span className="text-zinc-400">
                      Opportunities: <span className="text-emerald-400 font-medium">{todayRun.run.opportunities_count}</span>
                    </span>
                    <span className="px-2 py-1 bg-blue-900/30 border border-blue-700/50 rounded text-blue-300 text-xs font-medium">
                      Threshold: ≥ {todayRun.run.price_diff_threshold_eur.toLocaleString()} EUR
                    </span>
                  </div>
                </div>
              </div>

              {todayRun.results.length === 0 ? (
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
                      {todayRun.results.map((result) => (
                        <tr key={result.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-zinc-100">{result.studies_v2.brand}</div>
                            <div className="text-sm text-zinc-400">
                              {result.studies_v2.model}
                              {(result.studies_v2.trim_text_target || result.studies_v2.trim_text) &&
                                <span> — {result.studies_v2.trim_text_target || result.studies_v2.trim_text}</span>
                              }
                            </div>
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
                            {result.status === 'NULL' && result.target_error_reason && (
                              <div className="space-y-1">
                                <div className="text-xs text-zinc-500 max-w-xs truncate" title={result.target_error_reason}>
                                  {result.target_error_reason}
                                </div>
                                <button
                                  onClick={() => setVerifyMarketsResult(result)}
                                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                                >
                                  Verify markets
                                </button>
                              </div>
                            )}
                            {result.status === 'NULL' && !result.target_error_reason && result.price_difference !== null && result.price_difference < todayRun.run.price_diff_threshold_eur && (
                              <div className="space-y-1">
                                <div className="text-xs text-zinc-500">
                                  Below threshold ({todayRun.run.price_diff_threshold_eur}€)
                                </div>
                                <button
                                  onClick={() => setVerifyMarketsResult(result)}
                                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                                >
                                  Verify markets
                                </button>
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
          ))}
        </div>
      )}

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
                <p className="text-xs text-zinc-500 mt-1">
                  Result ID: {selectedResult.id.substring(0, 8)}... • Created: {new Date(selectedResult.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setShowListingsModal(false)}
                className="p-2 hover:bg-zinc-800 rounded transition-colors"
              >
                <X size={20} className="text-zinc-400" />
              </button>
            </div>

            {todayRuns.some(tr => tr.isFreshRunning) && (
              <div className="mx-4 mt-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg flex items-center gap-3">
                <div className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"></div>
                <div>
                  <p className="text-amber-100 text-sm font-medium">Enrichment in progress…</p>
                  <p className="text-amber-200 text-xs">
                    Fetching mileage, options, defects, and maintenance details. Please wait 10–30s.
                  </p>
                </div>
              </div>
            )}

            {selectedResult.target_stats && (
              <div className="px-4 pt-4 pb-2 bg-zinc-800/30 border-b border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-400 uppercase">
                    Target Market ({selectedResult.studies_v2.country_target})
                  </h4>
                  <div className="flex items-center gap-2">
                    <a
                      href={selectedResult.target_stats.targetMarketUrl || selectedResult.studies_v2.market_target_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center gap-1.5 transition-colors"
                    >
                      View {selectedResult.studies_v2.country_target} market
                      <ExternalLink size={12} />
                    </a>
                    <a
                      href={selectedResult.target_stats.sourceMarketUrl || selectedResult.studies_v2.market_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs flex items-center gap-1.5 transition-colors"
                    >
                      View {selectedResult.studies_v2.country_source} market
                      <ExternalLink size={12} />
                    </a>
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
              {listings.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800/50 mb-4">
                    <XCircle size={32} className="text-zinc-500" />
                  </div>
                  <h4 className="text-lg font-semibold text-zinc-300 mb-2">
                    No interesting listings found
                  </h4>
                  <p className="text-sm text-zinc-400 max-w-md mx-auto">
                    No interesting listings found on the source market for this study.
                    The search completed successfully but no results met the criteria.
                  </p>
                </div>
              ) : (
                listings.map((listing) => (
                  <div key={listing.id} className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-zinc-100">{listing.title}</h4>
                        {getStatusBadge(listing.status)}
                        {listing.assigned_to && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-400">
                            {listing.assigned_to === 'channing' ? 'Channing' : 'Antoine'}
                          </span>
                        )}
                      </div>
                      {(listing.year || listing.mileage) && (
                        <div className="text-sm text-zinc-400 mb-2">
                          {listing.year && <span>{listing.year}</span>}
                          {listing.year && listing.mileage && <span className="mx-1.5">•</span>}
                          {listing.mileage && <span>{listing.mileage.toLocaleString()} km</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-sm text-zinc-400">
                        <span className="font-bold text-lg text-emerald-400">{listing.price.toLocaleString()}€</span>
                        {selectedResult.target_stats && (
                          <span className="font-semibold text-emerald-300">
                            +{(selectedResult.target_stats.median_price - listing.price).toLocaleString()}€ opportunity
                          </span>
                        )}
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
                        {listing.assigned_to ? (
                          <div className="flex-1 px-3 py-2 bg-amber-900/30 text-amber-400 rounded text-xs text-center">
                            Already assigned to {listing.assigned_to === 'channing' ? 'Channing' : 'Antoine'}
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => approveForNegotiation(listing, 'channing')}
                              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                              <CheckCircle size={16} />
                              Approve for Channing
                            </button>
                            <button
                              onClick={() => approveForNegotiation(listing, 'antoine')}
                              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                              <CheckCircle size={16} />
                              Approve for Antoine
                            </button>
                          </>
                        )}
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
              ))
              )}
            </div>
          </div>
        </div>
      )}

      {verifyMarketsResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-100">Verify Markets</h3>
              <button
                onClick={() => setVerifyMarketsResult(null)}
                className="text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-zinc-400 mb-4">
                No listings found for this study. Verify the markets manually:
              </p>
              <div className="space-y-2">
                <a
                  href={verifyMarketsResult.target_stats?.targetMarketUrl || verifyMarketsResult.studies_v2.market_target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded-lg transition-colors group"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Target Market</div>
                    <div className="text-xs text-blue-400">{verifyMarketsResult.studies_v2.country_target}</div>
                  </div>
                  <ExternalLink size={16} className="text-zinc-500 group-hover:text-zinc-300" />
                </a>
                <a
                  href={verifyMarketsResult.target_stats?.sourceMarketUrl || verifyMarketsResult.studies_v2.market_source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded-lg transition-colors group"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Source Market</div>
                    <div className="text-xs text-emerald-400">{verifyMarketsResult.studies_v2.country_source}</div>
                  </div>
                  <ExternalLink size={16} className="text-zinc-500 group-hover:text-zinc-300" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
