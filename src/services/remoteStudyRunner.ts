/**
 * Remote Study Runner - Clean Realtime-Only Architecture
 *
 * Delegates study execution to the Worker via Supabase Edge Functions.
 * Uses ONLY Supabase Realtime for updates - NO POLLING.
 *
 * Flow:
 * Frontend → Edge Function → Worker → Database → Realtime → Frontend
 */

import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
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

type ProgressCallback = (event: { stage: string; message: string }) => void;

const REALTIME_TIMEOUT_MS = 300000; // 5 minutes max per study
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds as fallback
const POLL_MAX_ATTEMPTS = 150; // 150 attempts × 2s = 5 minutes max

/**
 * Execute a single study remotely via the Worker.
 *
 * Process:
 * 1. Create a scheduled job with immediate execution
 * 2. Trigger the Edge Function
 * 3. Subscribe to Realtime updates
 * 4. Return result when received via Realtime
 */
export async function runStudyRemotely(
  studyRunId: string,
  params: RemoteStudyParams,
  onProgress?: ProgressCallback,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  const { study, runId, threshold, scrapeMode = 'fast' } = params;
  const studyCode = `${study.brand}_${study.model}_${study.year}`;

  console.log(`[REMOTE_RUNNER] Starting remote execution: ${studyCode}`);

  let statusChannel: RealtimeChannel | null = null;
  let resultsChannel: RealtimeChannel | null = null;

  try {
    emitProgress('queued', 'Scheduling remote execution...', onProgress);

    // Schedule job for immediate execution
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 1000); // 1 second in past

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
      throw new Error(`Failed to schedule: ${scheduleError.message}`);
    }

    console.log(`[REMOTE_RUNNER] Job scheduled: ${scheduledJob.id}`);
    emitProgress('running', 'Triggering backend execution...', onProgress);

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
      throw new Error(`Failed to trigger backend: ${triggerResponse.status} ${errorText}`);
    }

    const triggerResult = await triggerResponse.json();
    console.log('[REMOTE_RUNNER] Edge Function triggered:', triggerResult);

    // Wait for results via Realtime ONLY
    return await waitForResultsViaRealtime(
      scheduledJob.id,
      study.id,
      studyRunId,
      studyCode,
      onProgress,
    );

  } catch (error) {
    console.error(`[REMOTE_RUNNER] Error:`, error);

    // Clean up channels
    if (statusChannel) await supabase.removeChannel(statusChannel);
    if (resultsChannel) await supabase.removeChannel(resultsChannel);

    emitProgress('error', `Error: ${(error as Error).message}`, onProgress);
    throw error;
  }
}

/**
 * Wait for results via Realtime + polling fallback for fast completion detection
 */
async function waitForResultsViaRealtime(
  jobId: string,
  studyId: string,
  studyRunId: string,
  studyCode: string,
  onProgress?: ProgressCallback,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  console.log('[REMOTE_RUNNER] 🚀 Starting: waiting for results...');
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let statusChannel: RealtimeChannel | null = null;
    let resultsChannel: RealtimeChannel | null = null;
    let timeoutId: NodeJS.Timeout;
    let pollIntervalId: NodeJS.Timeout;
    let runIdFromStatus: string | null = null;
    let pollAttempts = 0;

    const cleanup = async () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (pollIntervalId) clearInterval(pollIntervalId);
      if (statusChannel) {
        console.log('[REMOTE_RUNNER] Cleaning up status channel');
        await supabase.removeChannel(statusChannel);
      }
      if (resultsChannel) {
        console.log('[REMOTE_RUNNER] Cleaning up results channel');
        await supabase.removeChannel(resultsChannel);
      }
    };

    // Polling fallback: Check database every 2 seconds for results
    const pollForResults = async () => {
      pollAttempts++;

      if (pollAttempts > POLL_MAX_ATTEMPTS) {
        console.error('[REMOTE_RUNNER] ⏱️ Poll timeout after 5 minutes');
        await cleanup();
        reject(new Error('Backend execution timed out after 5 minutes'));
        return;
      }

      try {
        // Check if result exists
        const { data, error } = await supabase
          .from('study_run_results')
          .select('*')
          .eq('study_id', studyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('[REMOTE_RUNNER] Polling error:', error);
          return;
        }

        if (data) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[REMOTE_RUNNER] ✅ Result detected via polling after ${elapsed}s (Realtime may have missed it)`);

          const status = data.status === 'OPPORTUNITIES' ? 'OPPORTUNITIES'
                      : data.status === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED'
                      : 'NULL';

          emitProgress('done', `Study completed: ${status}`, onProgress);

          await cleanup();
          resolve({ status });
        }
      } catch (err) {
        console.error('[REMOTE_RUNNER] Polling exception:', err);
      }
    };

    // Start polling immediately, then every 2 seconds
    pollForResults();
    pollIntervalId = setInterval(pollForResults, POLL_INTERVAL_MS);

    // Timeout after 5 minutes (backup for polling)
    timeoutId = setTimeout(async () => {
      console.error('[REMOTE_RUNNER] ⏱️ Global timeout after 5 minutes');
      await cleanup();
      reject(new Error('Backend execution timed out after 5 minutes'));
    }, REALTIME_TIMEOUT_MS);

    // Subscribe to job status changes
    console.log(`[REMOTE_RUNNER] Subscribing to job status: ${jobId}`);
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
          console.log(`[REMOTE_RUNNER] Status update: ${newStatus}`);

          if (newStatus === 'running') {
            emitProgress('running', 'Backend processing study...', onProgress);
          }

          if (newStatus === 'completed') {
            console.log('[REMOTE_RUNNER] Job completed');
            runIdFromStatus = payload.new.run_id;
            emitProgress('saving_results', 'Waiting for results...', onProgress);
          }

          if (newStatus === 'failed') {
            const errorMsg = payload.new.last_error || 'Unknown error';
            console.error(`[REMOTE_RUNNER] Job failed: ${errorMsg}`);
            emitProgress('error', errorMsg, onProgress);
            cleanup().then(() => reject(new Error(`Backend execution failed: ${errorMsg}`)));
          }

          if (newStatus === 'cancelled') {
            console.log('[REMOTE_RUNNER] Job cancelled');
            emitProgress('cancelled', 'Study cancelled', onProgress);
            cleanup().then(() => resolve({ status: 'NULL' }));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REMOTE_RUNNER] Status channel subscribed');
        }
      });

    // Subscribe to results
    console.log(`[REMOTE_RUNNER] Subscribing to results: ${studyId}`);
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
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[REMOTE_RUNNER] ⚡ Results received via Realtime after ${elapsed}s`);

          const result = payload.new;

          // Verify this is our result
          if (runIdFromStatus && result.run_id !== runIdFromStatus) {
            console.log('[REMOTE_RUNNER] Result for different run_id, ignoring');
            return;
          }

          console.log('[REMOTE_RUNNER] Result:', {
            status: result.status,
            margin: result.price_difference,
          });

          const status = result.status === 'OPPORTUNITIES' ? 'OPPORTUNITIES'
                      : result.status === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED'
                      : 'NULL';

          emitProgress('done', `Study completed: ${status}`, onProgress);

          await cleanup();
          console.log(`[REMOTE_RUNNER] ✅ Execution completed successfully (${elapsed}s total)`);
          resolve({ status });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REMOTE_RUNNER] Results channel subscribed');
          emitProgress('running', 'Backend processing study...', onProgress);
        }
      });
  });
}

function emitProgress(
  stage: string,
  message: string,
  onProgress?: ProgressCallback,
) {
  if (onProgress) {
    onProgress({ stage, message });
  }
}
