/**
 * Remote Study Runner
 *
 * Delegates study execution to the Worker via Supabase Edge Functions.
 * This ensures all scraping happens server-side, never in the browser.
 *
 * Flow:
 * Frontend → Edge Function (run_scheduled_studies) → Worker → Zyte API
 */

import { supabase } from '../lib/supabase';
import type { StudyRunProgressEvent } from '../store/studyRunsStore';

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

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 300000;

/**
 * Execute a single study remotely via the Worker.
 *
 * This function:
 * 1. Creates a scheduled job with immediate execution
 * 2. Triggers the run_scheduled_studies Edge Function
 * 3. Polls for completion
 * 4. Returns the result
 */
export async function runStudyRemotely(
  studyRunId: string,
  params: RemoteStudyParams,
  onProgress?: ProgressCallback,
): Promise<{ status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED' }> {
  const { study, runId, threshold, scrapeMode = 'fast' } = params;
  const studyCode = `${study.brand}_${study.model}_${study.year}_${study.country_source}_${study.country_target}`;

  console.log(`[REMOTE_RUNNER] Starting remote execution for study: ${studyCode}`);

  try {
    emitProgress(studyRunId, studyCode, 'queued', 'Queued', 'Scheduling remote execution...', onProgress);

    // Schedule for NOW (not future) so Edge Function picks it up immediately
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 1000); // 1 second in PAST for immediate pickup

    const { data: scheduledJob, error: scheduleError } = await supabase
      .from('scheduled_study_runs')
      .insert([{
        scheduled_at: scheduledAt.toISOString(),
        status: 'pending', // Explicitly set to pending
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

    console.log(`[REMOTE_RUNNER] Scheduled job created: ${scheduledJob.id}`);
    emitProgress(studyRunId, studyCode, 'scraping_target', 'Triggering', 'Triggering backend execution...', onProgress);

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
    console.log('[REMOTE_RUNNER] Edge Function triggered:', triggerResult);

    // Keep "Triggering" state until job actually starts
    const startTime = Date.now();
    let lastStatus = 'pending';
    let jobStarted = false;

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      // Poll more frequently at start (500ms), then back off to 2s
      const elapsed = Date.now() - startTime;
      const pollInterval = elapsed < 10000 ? 500 : POLL_INTERVAL_MS;
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const { data: jobStatus, error: statusError } = await supabase
        .from('scheduled_study_runs')
        .select('status, last_error, run_id')
        .eq('id', scheduledJob.id)
        .single();

      if (statusError) {
        console.error('[REMOTE_RUNNER] Failed to check job status:', statusError);
        continue;
      }

      if (jobStatus.status !== lastStatus) {
        console.log(`[REMOTE_RUNNER] Job status changed: ${lastStatus} → ${jobStatus.status}`);
        lastStatus = jobStatus.status;

        if (jobStatus.status === 'running') {
          jobStarted = true;
          emitProgress(studyRunId, studyCode, 'scraping_target', 'Running', 'Backend processing study...', onProgress);
        }
      } else if (!jobStarted && jobStatus.status === 'pending') {
        // Keep showing "Triggering" while waiting for pickup
        emitProgress(studyRunId, studyCode, 'scraping_target', 'Triggering', 'Waiting for backend pickup...', onProgress);
      }

      if (jobStatus.status === 'completed') {
        console.log(`[REMOTE_RUNNER] Job completed successfully`);

        if (jobStatus.run_id) {
          emitProgress(studyRunId, studyCode, 'saving_results', 'Fetching results', 'Loading results...', onProgress);

          // Poll for results with retry logic (results might take a moment to appear)
          let result = null;
          let retries = 0;
          const maxRetries = 5;

          while (!result && retries < maxRetries) {
            if (retries > 0) {
              console.log(`[REMOTE_RUNNER] Retry ${retries}/${maxRetries} - waiting for results...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const { data: fetchedResult, error: resultError } = await supabase
              .from('study_run_results')
              .select('*')
              .eq('run_id', jobStatus.run_id)
              .eq('study_id', study.id)
              .maybeSingle();

            if (resultError) {
              console.error('[REMOTE_RUNNER] Failed to fetch result:', resultError);
              retries++;
              continue;
            }

            result = fetchedResult;
            retries++;
          }

          if (!result) {
            console.warn('[REMOTE_RUNNER] No result found after retries');
            emitProgress(studyRunId, studyCode, 'done', 'Completed', 'No results found', onProgress, 'warning');
            return { status: 'NULL' };
          }

          const status = result.status === 'OPPORTUNITIES' ? 'OPPORTUNITIES'
                      : result.status === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED'
                      : 'NULL';

          console.log(`[REMOTE_RUNNER] Result fetched: ${status}, margin: ${result.price_difference || 0}€`);
          emitProgress(studyRunId, studyCode, 'done', 'Completed', `Study completed: ${status}`, onProgress);
          return { status };
        }

        emitProgress(studyRunId, studyCode, 'done', 'Completed', 'Study completed (no run_id)', onProgress);
        return { status: 'NULL' };
      }

      if (jobStatus.status === 'failed') {
        const errorMsg = jobStatus.last_error || 'Unknown error';
        console.error(`[REMOTE_RUNNER] Job failed: ${errorMsg}`);
        emitProgress(studyRunId, studyCode, 'error', 'Failed', errorMsg, onProgress, 'error');
        throw new Error(`Backend execution failed: ${errorMsg}`);
      }

      if (jobStatus.status === 'cancelled') {
        console.log('[REMOTE_RUNNER] Job was cancelled');
        emitProgress(studyRunId, studyCode, 'done', 'Cancelled', 'Study cancelled', onProgress, 'warning');
        return { status: 'NULL' };
      }
    }

    throw new Error('Backend execution timed out after 5 minutes');

  } catch (error) {
    console.error(`[REMOTE_RUNNER] Error executing remote study ${study.id}:`, error);
    emitProgress(
      studyRunId,
      studyCode,
      'error',
      'Error',
      `Error: ${(error as Error).message}`,
      onProgress,
      'error',
    );
    throw error;
  }
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
