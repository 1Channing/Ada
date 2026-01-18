/**
 * Remote Study Runner - Realtime Push Architecture
 *
 * Delegates study execution to the Worker via Supabase Edge Functions.
 * Uses Supabase Realtime for instant updates - ZERO POLLING.
 *
 * Flow:
 * Frontend → Edge Function (run_scheduled_studies) → Worker → Zyte API
 * Worker → Database → Realtime → Frontend (instant push)
 */

import { supabase } from '../lib/supabase';
import { useStudyRunsStore, type StudyRunProgressEvent } from '../store/studyRunsStore';
import type { RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SCHEDULER_CRON_SECRET = import.meta.env.VITE_SCHEDULER_CRON_SECRET;

export interface StudyV2 {
  id: string;
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
  country_target: string;
  market_target_url: string;
  country_source: string;
  market_source_url: string;
  trim_text?: string | null;
  trim_text_target?: string | null;
  trim_text_source?: string | null;
}

export interface RemoteStudyParams {
  study: StudyV2;
  runId: string;
  threshold: number;
  scrapeMode?: 'fast' | 'full';
}

type ProgressCallback = (event: StudyRunProgressEvent) => void;

const REALTIME_TIMEOUT_MS = 300000; // 5 minutes max wait
const FALLBACK_FETCH_DELAY_MS = 5000; // 5 seconds after completion before fallback

/**
 * Execute a single study remotely via the Worker.
 *
 * This function:
 * 1. Creates a scheduled job with immediate execution
 * 2. Triggers the run_scheduled_studies Edge Function
 * 3. Subscribes to Realtime updates (NO POLLING)
 * 4. Returns the result immediately when pushed from Worker
 */
export async function runStudyRemotely(
  studyRunId: string,
  params: RemoteStudyParams,
  onProgress?: ProgressCallback,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  const { study, runId, threshold, scrapeMode = 'fast' } = params;
  const studyCode = `${study.brand}_${study.model}_${study.year}_${study.country_source}_${study.country_target}`;

  console.log(`[REMOTE_RUNNER] 🚀 Starting remote execution for study: ${studyCode}`);
  console.log(`[REMOTE_RUNNER] 📡 Using Realtime push architecture (zero polling)`);

  let statusChannel: RealtimeChannel | null = null;
  let resultsChannel: RealtimeChannel | null = null;

  try {
    emitProgress(studyRunId, studyCode, 'queued', 'Queued', 'Scheduling remote execution...', onProgress);

    // Schedule for NOW (not future) so Edge Function picks it up immediately
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 1000); // 1 second in PAST for immediate pickup

    const { data: scheduledJob, error: scheduleError } = await supabase
      .from('scheduled_study_runs')
      .insert([{
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending',
        payload: {
          studyIds: [study.id],
          threshold,
          type: 'instant',
          scrapeMode,
        },
      }])
      .select()
      .single();

    if (scheduleError) {
      console.error('[REMOTE_RUNNER] Failed to schedule job:', scheduleError);
      throw new Error(`Failed to schedule remote execution: ${scheduleError.message}`);
    }

    console.log(`[REMOTE_RUNNER] ✅ Scheduled job created: ${scheduledJob.id}`);
    emitProgress(studyRunId, studyCode, 'scraping_target', 'Triggering', 'Triggering backend execution...', onProgress);

    // Trigger Edge Function
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/run_scheduled_studies`;
    const triggerResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SCHEDULER_CRON_SECRET}`,
      },
      body: JSON.stringify({}),
    });

    if (!triggerResponse.ok) {
      const errorText = await triggerResponse.text();
      console.error('[REMOTE_RUNNER] Failed to trigger Edge Function:', errorText);
      throw new Error(`Failed to trigger backend: ${triggerResponse.status} ${errorText}`);
    }

    const triggerResult = await triggerResponse.json();
    console.log('[REMOTE_RUNNER] ✅ Edge Function triggered:', triggerResult);

    if (triggerResult.success && triggerResult.processed > 0) {
      console.log('[REMOTE_RUNNER] 🎯 Edge Function confirmed job pickup');
    }

    // Now set up Realtime subscriptions and wait for updates
    return await waitForResultsViaRealtime(
      scheduledJob.id,
      study.id,
      studyRunId,
      studyCode,
      onProgress,
    );

  } catch (error) {
    console.error(`[REMOTE_RUNNER] ❌ Error executing remote study ${study.id}:`, error);

    // Clean up any subscriptions
    if (statusChannel) {
      await supabase.removeChannel(statusChannel);
    }
    if (resultsChannel) {
      await supabase.removeChannel(resultsChannel);
    }

    emitProgress(
      studyRunId,
      studyCode,
      'error',
      'Error',
      `Error: ${(error as Error).message}`,
      onProgress,
      'error',
    );

    // Update store on error
    const store = useStudyRunsStore.getState();
    store.updateRun(studyRunId, {
      stage: 'error',
      finishedAt: Date.now(),
      errorMessage: (error as Error).message,
    });

    throw error;
  }
}

/**
 * Wait for results via Supabase Realtime (ZERO POLLING)
 *
 * Subscribes to:
 * 1. scheduled_study_runs - for status changes (pending → running → completed)
 * 2. study_run_results - for actual results (pushed immediately by Worker)
 *
 * Returns immediately when results arrive via push notification.
 */
async function waitForResultsViaRealtime(
  jobId: string,
  studyId: string,
  studyRunId: string,
  studyCode: string,
  onProgress?: ProgressCallback,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  console.log('[REMOTE_RUNNER] 📡 Setting up Realtime subscriptions...');

  return new Promise((resolve, reject) => {
    let statusChannel: RealtimeChannel | null = null;
    let resultsChannel: RealtimeChannel | null = null;
    let timeoutId: NodeJS.Timeout;
    let hasCompleted = false;
    let completionTime: number | null = null;
    let fallbackTimeoutId: NodeJS.Timeout | null = null;
    let runIdFromStatus: string | null = null;

    const cleanup = async () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);

      if (statusChannel) {
        console.log('[REMOTE_RUNNER] 🧹 Cleaning up status channel');
        await supabase.removeChannel(statusChannel);
      }
      if (resultsChannel) {
        console.log('[REMOTE_RUNNER] 🧹 Cleaning up results channel');
        await supabase.removeChannel(resultsChannel);
      }
    };

    // Timeout after 5 minutes
    timeoutId = setTimeout(async () => {
      console.error('[REMOTE_RUNNER] ⏱️ Realtime timeout after 5 minutes');
      await cleanup();
      reject(new Error('Backend execution timed out after 5 minutes'));
    }, REALTIME_TIMEOUT_MS);

    // Subscribe to job status changes
    console.log(`[REMOTE_RUNNER] 📻 Subscribing to job status: ${jobId}`);
    statusChannel = supabase
      .channel(`job_status_${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scheduled_study_runs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const newStatus = payload.new.status;
          console.log(`[REMOTE_RUNNER] 📬 Status update: ${newStatus}`);

          if (newStatus === 'running') {
            console.log('[REMOTE_RUNNER] 🏃 Job is now running on Worker');
            emitProgress(studyRunId, studyCode, 'scraping_target', 'Running', 'Backend processing study...', onProgress);
          }

          if (newStatus === 'completed') {
            console.log('[REMOTE_RUNNER] ✅ Job marked as completed');
            hasCompleted = true;
            completionTime = Date.now();
            runIdFromStatus = payload.new.run_id;

            emitProgress(studyRunId, studyCode, 'saving_results', 'Fetching results', 'Waiting for results...', onProgress);

            // Set up fallback fetch in case Realtime fails to deliver results
            fallbackTimeoutId = setTimeout(async () => {
              console.warn('[REMOTE_RUNNER] ⚠️ No results received via Realtime after 5s, using fallback fetch');

              if (runIdFromStatus) {
                try {
                  const { data: result, error } = await supabase
                    .from('study_run_results')
                    .select('*')
                    .eq('run_id', runIdFromStatus)
                    .eq('study_id', studyId)
                    .maybeSingle();

                  if (error) {
                    console.error('[REMOTE_RUNNER] ❌ Fallback fetch failed:', error);
                    await cleanup();
                    reject(new Error(`Failed to fetch results: ${error.message}`));
                    return;
                  }

                  if (result) {
                    console.log('[REMOTE_RUNNER] ✅ Results fetched via fallback:', {
                      status: result.status,
                      margin: result.price_difference,
                    });

                    const status = result.status === 'OPPORTUNITIES' ? 'OPPORTUNITIES'
                                : result.status === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED'
                                : 'NULL';

                    console.log('[REMOTE_RUNNER] 🎯 Emitting completion event to UI (fallback)...');
                    emitProgress(studyRunId, studyCode, 'done', 'Completed', `Study completed: ${status}`, onProgress, 'info');

                    // Explicitly update global store to ensure widget closes
                    console.log('[REMOTE_RUNNER] 📊 Updating global store to mark study as done (fallback)...');
                    const store = useStudyRunsStore.getState();
                    store.updateRun(studyRunId, {
                      stage: 'done',
                      finishedAt: Date.now(),
                      status: status === 'OPPORTUNITIES' ? 'SUCCESS' as const : 'NO_TARGET_RESULTS' as const,
                    });

                    await cleanup();
                    console.log('[REMOTE_RUNNER] ✅ Remote execution completed successfully (fallback)');
                    resolve({ status });
                  } else {
                    console.warn('[REMOTE_RUNNER] ⚠️ No results found in fallback fetch');
                    emitProgress(studyRunId, studyCode, 'done', 'Completed', 'No results found', onProgress, 'warning');

                    // Update store even when no results found
                    const store = useStudyRunsStore.getState();
                    store.updateRun(studyRunId, {
                      stage: 'done',
                      finishedAt: Date.now(),
                      status: 'NO_TARGET_RESULTS' as const,
                    });

                    await cleanup();
                    resolve({ status: 'NULL' });
                  }
                } catch (err) {
                  console.error('[REMOTE_RUNNER] ❌ Fallback fetch error:', err);
                  await cleanup();
                  reject(err);
                }
              } else {
                console.error('[REMOTE_RUNNER] ❌ No run_id available for fallback fetch');
                await cleanup();
                reject(new Error('No run_id available for results'));
              }
            }, FALLBACK_FETCH_DELAY_MS);
          }

          if (newStatus === 'failed') {
            const errorMsg = payload.new.last_error || 'Unknown error';
            console.error(`[REMOTE_RUNNER] ❌ Job failed: ${errorMsg}`);
            emitProgress(studyRunId, studyCode, 'error', 'Failed', errorMsg, onProgress, 'error');

            // Update store on failure
            const store = useStudyRunsStore.getState();
            store.updateRun(studyRunId, {
              stage: 'error',
              finishedAt: Date.now(),
              errorMessage: errorMsg,
            });

            cleanup().then(() => reject(new Error(`Backend execution failed: ${errorMsg}`)));
          }

          if (newStatus === 'cancelled') {
            console.log('[REMOTE_RUNNER] 🚫 Job was cancelled');
            emitProgress(studyRunId, studyCode, 'cancelled', 'Cancelled', 'Study cancelled', onProgress, 'warning');

            // Update store on cancellation
            const store = useStudyRunsStore.getState();
            store.updateRun(studyRunId, {
              stage: 'cancelled',
              finishedAt: Date.now(),
            });

            cleanup().then(() => resolve({ status: 'NULL' }));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REMOTE_RUNNER] ✅ Status channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[REMOTE_RUNNER] ❌ Status channel error');
        } else if (status === 'TIMED_OUT') {
          console.error('[REMOTE_RUNNER] ⏱️ Status channel timed out');
        }
      });

    // Subscribe to results (filtered by study_id)
    // Note: We'll filter by run_id once we know it, but for now we filter by study_id
    console.log(`[REMOTE_RUNNER] 📻 Subscribing to results for study: ${studyId}`);
    resultsChannel = supabase
      .channel(`study_results_${studyId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'study_run_results',
          filter: `study_id=eq.${studyId}`,
        },
        async (payload) => {
          console.log('[REMOTE_RUNNER] 📬 Results received via Realtime!');

          // Cancel fallback if it's pending
          if (fallbackTimeoutId) {
            clearTimeout(fallbackTimeoutId);
            fallbackTimeoutId = null;
          }

          const result = payload.new;

          // Verify this result matches our run_id (if we have it)
          if (runIdFromStatus && result.run_id !== runIdFromStatus) {
            console.log('[REMOTE_RUNNER] ⚠️ Received result for different run_id, ignoring');
            return;
          }

          console.log('[REMOTE_RUNNER] ✅ Result data:', {
            status: result.status,
            margin: result.price_difference,
            target_count: result.filtered_target_count,
            source_count: result.filtered_source_count,
          });

          const status = result.status === 'OPPORTUNITIES' ? 'OPPORTUNITIES'
                      : result.status === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED'
                      : 'NULL';

          console.log('[REMOTE_RUNNER] 🎯 Emitting completion event to UI...');
          emitProgress(studyRunId, studyCode, 'done', 'Completed', `Study completed: ${status}`, onProgress, 'info');

          // Explicitly update global store to ensure widget closes
          console.log('[REMOTE_RUNNER] 📊 Updating global store to mark study as done...');
          const store = useStudyRunsStore.getState();
          store.updateRun(studyRunId, {
            stage: 'done',
            finishedAt: Date.now(),
            status: status === 'OPPORTUNITIES' ? 'SUCCESS' as const : 'NO_TARGET_RESULTS' as const,
          });

          console.log('[REMOTE_RUNNER] 🧹 Cleaning up channels...');
          await cleanup();

          console.log('[REMOTE_RUNNER] ✅ Remote execution completed successfully');
          resolve({ status });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REMOTE_RUNNER] ✅ Results channel subscribed');
          // Now that both channels are ready, show "Running" state
          emitProgress(studyRunId, studyCode, 'scraping_target', 'Running', 'Backend processing study...', onProgress);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[REMOTE_RUNNER] ❌ Results channel error');
        } else if (status === 'TIMED_OUT') {
          console.error('[REMOTE_RUNNER] ⏱️ Results channel timed out');
        }
      });
  });
}

function emitProgress(
  studyRunId: string,
  studyCode: string,
  stage: string,
  label: string,
  message: string,
  onProgress?: ProgressCallback,
  level?: 'info' | 'warning' | 'error',
) {
  const event: StudyRunProgressEvent = {
    id: studyRunId,
    studyCode,
    label,
    message,
    stage: stage as any,
    timestamp: Date.now(),
    level,
  };

  if (onProgress) {
    onProgress(event);
  }
}
