import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { History, X, ExternalLink, CheckCircle, XCircle, FileText, ScrollText } from 'lucide-react';
import { exportListingToPdf } from '../lib/pdfExporter';
import { sanitizeUUID } from '../lib/uuid-utils';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { StudyRunLogsModal } from '../components/StudyRunLogsModal';

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
  const [logsModal, setLogsModal] = useState<{ runId: string; studyId?: string; label: string } | null>(null);

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
        return <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-50 text-emerald-600">Approved</span>;
      case 'REJECTED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-600">Rejected</span>;
      case 'COMPLETED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-600">Completed</span>;
      default:
        return <span className="px-2 py-1 rounded text-xs font-medium bg-slate-300 text-slate-700">New</span>;
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
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600 flex items-center gap-1">
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
          <h2 className="text-2xl font-bold text-slate-900">Results</h2>
          <p className="text-sm text-slate-600 mt-1">
            View results from completed searches
          </p>
        </div>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg flex items-center gap-2 transition-colors"
        >
          <History size={18} />
          {showHistory ? 'Hide History' : 'Show History'}
        </button>
      </div>

      {showHistory && (
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Run History ({history.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Studies</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">NULL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Opportunities</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Actions</th>
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
                    <tr key={run.id} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-slate-700">
                            {run.executed_at ? new Date(run.executed_at).toLocaleString() : 'N/A'}
                          </div>
                          {getRunStatusPill(run)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          run.run_type === 'instant' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {run.run_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-700">{run.total_studies}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-600">{run.null_count}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-emerald-600 font-medium">{run.opportunities_count}</div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => selectHistoricalRun(run)}
                          className="text-sm text-blue-600 hover:text-blue-700"
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
        <div className="p-4 bg-blue-50 border border-blue-300 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
            <div>
              <p className="text-blue-100 font-medium">Batch is currently running</p>
              <p className="text-blue-800 text-sm">
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
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-600">
          Loading results...
        </div>
      ) : todayRuns.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-600">
          No runs today. Run a search to see results here.
        </div>
      ) : (
        <div className="space-y-6">
          {todayRuns.map((todayRun) => (
            <div key={todayRun.run.id} className="bg-white rounded-lg border border-slate-200">
              <div className="p-4 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Run from {new Date(todayRun.run.executed_at!).toLocaleString()}
                    </h3>
                    {todayRun.isFreshRunning && (
                      <p className="text-xs text-blue-600 mt-1">In progress - results shown below are incrementally persisted</p>
                    )}
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="text-slate-600">
                      Total: <span className="text-slate-900 font-medium">{todayRun.run.total_studies}</span>
                    </span>
                    <span className="text-slate-600">
                      Completed: <span className="text-slate-900 font-medium">{todayRun.results.length}</span>
                    </span>
                    <span className="text-slate-600">
                      NULL: <span className="text-slate-900 font-medium">{todayRun.run.null_count}</span>
                    </span>
                    <span className="text-slate-600">
                      Opportunities: <span className="text-emerald-600 font-medium">{todayRun.run.opportunities_count}</span>
                    </span>
                    <span className="px-2 py-1 bg-blue-50 border border-blue-300 rounded text-blue-700 text-xs font-medium">
                      Threshold: ≥ {todayRun.run.price_diff_threshold_eur.toLocaleString()} EUR
                    </span>
                  </div>
                </div>
              </div>

              {todayRun.results.length === 0 ? (
                <div className="p-8 text-center text-slate-600">
                  <p>No results found for this run.</p>
                  <button
                    onClick={() => setLogsModal({ runId: todayRun.run.id, label: `Run du ${new Date(todayRun.run.executed_at!).toLocaleString()}` })}
                    className="inline-flex items-center gap-1.5 mt-3 text-xs text-slate-500 hover:text-slate-700 transition-colors border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded"
                  >
                    <ScrollText size={12} />
                    Voir les logs
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Brand/Model</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Year</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Markets</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Target Price</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Best Source</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Difference</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayRun.results.map((result) => (
                        <tr key={result.id} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{result.studies_v2.brand}</div>
                            <div className="text-sm text-slate-600">
                              {result.studies_v2.model}
                              {(result.studies_v2.trim_text_target || result.studies_v2.trim_text) &&
                                <span> — {result.studies_v2.trim_text_target || result.studies_v2.trim_text}</span>
                              }
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-slate-700">{result.studies_v2.year}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-xs">
                              <span className="text-blue-600">{result.studies_v2.country_target}</span>
                              <span className="text-slate-500"> ← </span>
                              <span className="text-emerald-600">{result.studies_v2.country_source}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-slate-700">
                              {result.target_market_price ? `${result.target_market_price.toLocaleString()}€` : 'N/A'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-slate-700">
                              {result.best_source_price ? `${result.best_source_price.toLocaleString()}€` : 'N/A'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className={`text-sm font-medium ${
                              result.price_difference && result.price_difference >= 5000
                                ? 'text-emerald-600'
                                : 'text-slate-600'
                            }`}>
                              {result.price_difference ? `${result.price_difference.toLocaleString()}€` : 'N/A'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                result.status === 'OPPORTUNITIES'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : result.status === 'TARGET_BLOCKED'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-slate-300 text-slate-600'
                              }`}
                              title={result.status === 'TARGET_BLOCKED' && result.target_error_reason ? result.target_error_reason : undefined}
                            >
                              {result.status === 'TARGET_BLOCKED' ? 'TARGET BLOCKED' : result.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {result.status === 'OPPORTUNITIES' && (
                                <button
                                  onClick={() => viewListings(result)}
                                  className="text-sm text-blue-600 hover:text-blue-700"
                                >
                                  View Listings
                                </button>
                              )}
                              {result.status === 'TARGET_BLOCKED' && result.target_error_reason && (
                                <div className="text-xs text-red-600/80 max-w-xs truncate" title={result.target_error_reason}>
                                  {result.studies_v2.country_target}: Provider blocked
                                </div>
                              )}
                              {result.status === 'NULL' && result.target_error_reason && (
                                <div className="space-y-1">
                                  <div className="text-xs text-slate-500 max-w-xs truncate" title={result.target_error_reason}>
                                    {result.target_error_reason}
                                  </div>
                                  <button
                                    onClick={() => setVerifyMarketsResult(result)}
                                    className="text-xs text-blue-600 hover:text-blue-700 underline"
                                  >
                                    Verify markets
                                  </button>
                                </div>
                              )}
                              {result.status === 'NULL' && !result.target_error_reason && result.price_difference !== null && result.price_difference < todayRun.run.price_diff_threshold_eur && (
                                <div className="space-y-1">
                                  <div className="text-xs text-slate-500">
                                    Below threshold ({todayRun.run.price_diff_threshold_eur}€)
                                  </div>
                                  <button
                                    onClick={() => setVerifyMarketsResult(result)}
                                    className="text-xs text-blue-600 hover:text-blue-700 underline"
                                  >
                                    Verify markets
                                  </button>
                                </div>
                              )}
                              <button
                                onClick={() => {
                                  console.log('[LOG_BUTTON]', { runId: todayRun.run.id, studyId: result.study_id });
                                  setLogsModal({
                                    runId: todayRun.run.id,
                                    studyId: result.study_id,
                                    label: `${result.studies_v2.brand} ${result.studies_v2.model} ${result.studies_v2.year}`,
                                  });
                                }}
                                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors mt-0.5"
                                title="Voir les logs de cette recherche"
                              >
                                <ScrollText size={11} />
                                Logs
                              </button>
                            </div>
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
          <div className="bg-white rounded-lg border border-slate-200 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Interesting Listings - {selectedResult.studies_v2.brand} {selectedResult.studies_v2.model}
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  {listings.length} listings found in {selectedResult.studies_v2.country_source}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Result ID: {selectedResult.id.substring(0, 8)}... • Created: {new Date(selectedResult.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setShowListingsModal(false)}
                className="p-2 hover:bg-slate-200 rounded transition-colors"
              >
                <X size={20} className="text-slate-600" />
              </button>
            </div>

            {todayRuns.some(tr => tr.isFreshRunning) && (
              <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center gap-3">
                <div className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent"></div>
                <div>
                  <p className="text-amber-100 text-sm font-medium">Enrichment in progress…</p>
                  <p className="text-amber-800 text-xs">
                    Fetching mileage, options, defects, and maintenance details. Please wait 10–30s.
                  </p>
                </div>
              </div>
            )}

            {selectedResult.target_stats && (
              <div className="px-4 pt-4 pb-2 bg-slate-100 border-b border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-slate-600 uppercase">
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
                    <div className="text-xs text-slate-500">Median</div>
                    <div className="font-semibold text-blue-600">{selectedResult.target_stats.median_price.toLocaleString()}€</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Average</div>
                    <div className="font-medium text-slate-700">{selectedResult.target_stats.average_price.toLocaleString()}€</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Range</div>
                    <div className="font-medium text-slate-700">
                      {selectedResult.target_stats.min_price.toLocaleString()}–{selectedResult.target_stats.max_price.toLocaleString()}€
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Count</div>
                    <div className="font-medium text-slate-700">{selectedResult.target_stats.count} listings</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">P25–P75</div>
                    <div className="font-medium text-slate-700">
                      {selectedResult.target_stats.percentile_25.toLocaleString()}–{selectedResult.target_stats.percentile_75.toLocaleString()}€
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-y-auto p-4 space-y-4">
              {listings.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                    <XCircle size={32} className="text-slate-500" />
                  </div>
                  <h4 className="text-lg font-semibold text-slate-700 mb-2">
                    No interesting listings found
                  </h4>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    No interesting listings found on the source market for this study.
                    The search completed successfully but no results met the criteria.
                  </p>
                </div>
              ) : (
                listings.map((listing) => (
                  <div key={listing.id} className="bg-slate-100 rounded-lg p-4 border border-slate-300">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-slate-900">{listing.title}</h4>
                        {getStatusBadge(listing.status)}
                        {listing.assigned_to && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-600">
                            {listing.assigned_to === 'channing' ? 'Channing' : 'Antoine'}
                          </span>
                        )}
                      </div>
                      {(listing.year || listing.mileage) && (
                        <div className="text-sm text-slate-600 mb-2">
                          {listing.year && <span>{listing.year}</span>}
                          {listing.year && listing.mileage && <span className="mx-1.5">•</span>}
                          {listing.mileage && <span>{listing.mileage.toLocaleString()} km</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-sm text-slate-600">
                        <span className="font-bold text-lg text-emerald-600">{listing.price.toLocaleString()}€</span>
                        {selectedResult.target_stats && (
                          <span className="font-semibold text-emerald-700">
                            +{(selectedResult.target_stats.median_price - listing.price).toLocaleString()}€ opportunity
                          </span>
                        )}
                        {listing.trim && <span className="text-slate-500">{listing.trim}</span>}
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
                    <div className="mb-3 px-3 py-2 bg-red-50 border border-red-300 rounded">
                      <p className="text-sm text-red-700 font-medium">⚠️ Potentially damaged vehicle</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-3">
                    <div>
                      <h5 className="text-xs font-semibold text-slate-600 uppercase mb-1">Defects</h5>
                      <p className="text-slate-700">{listing.defects_summary || 'None mentioned'}</p>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-slate-600 uppercase mb-1">Entretien</h5>
                      <p className="text-slate-700">
                        {listing.entretien && listing.entretien.trim()
                          ? listing.entretien
                          : 'Aucune information d\'entretien mentionnée'}
                      </p>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-slate-600 uppercase mb-1">Options</h5>
                      <p className="text-slate-700">
                        {listing.options && Array.isArray(listing.options) && listing.options.length > 0
                          ? listing.options.join(', ')
                          : 'None mentioned'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-slate-300">
                    {listing.status === 'NEW' && (
                      <>
                        {listing.assigned_to ? (
                          <div className="flex-1 px-3 py-2 bg-amber-50 text-amber-600 rounded text-xs text-center">
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
                        className="px-3 py-2 bg-slate-400 hover:bg-slate-300 text-white rounded text-sm transition-colors"
                      >
                        Reset to New
                      </button>
                    )}
                    {listing.status === 'REJECTED' && (
                      <button
                        onClick={() => updateListingStatus(listing.id, 'NEW')}
                        className="px-3 py-2 bg-slate-400 hover:bg-slate-300 text-white rounded text-sm transition-colors"
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
          <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Verify Markets</h3>
              <button
                onClick={() => setVerifyMarketsResult(null)}
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-slate-600 mb-4">
                No listings found for this study. Verify the markets manually:
              </p>
              <div className="space-y-2">
                <a
                  href={verifyMarketsResult.target_stats?.targetMarketUrl || verifyMarketsResult.studies_v2.market_target_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 bg-slate-200 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors group"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">Target Market</div>
                    <div className="text-xs text-blue-600">{verifyMarketsResult.studies_v2.country_target}</div>
                  </div>
                  <ExternalLink size={16} className="text-slate-500 group-hover:text-slate-700" />
                </a>
                <a
                  href={verifyMarketsResult.target_stats?.sourceMarketUrl || verifyMarketsResult.studies_v2.market_source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 bg-slate-200 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors group"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">Source Market</div>
                    <div className="text-xs text-emerald-600">{verifyMarketsResult.studies_v2.country_source}</div>
                  </div>
                  <ExternalLink size={16} className="text-slate-500 group-hover:text-slate-700" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {logsModal && (
        <StudyRunLogsModal
          runId={logsModal.runId}
          studyId={logsModal.studyId}
          studyLabel={logsModal.label}
          onClose={() => setLogsModal(null)}
        />
      )}
    </div>
  );
}
