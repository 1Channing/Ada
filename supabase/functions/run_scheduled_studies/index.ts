import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

interface ScheduledStudyPayload {
  studyIds: string[];
  threshold: number;
  type: 'instant';
  scrapeMode?: 'fast' | 'full';
}

const WORKER_URL = (Deno.env.get('WORKER_URL') || '').replace(/\/+$/, '');
const WORKER_SECRET = Deno.env.get('WORKER_SECRET') || '';

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log('[EDGE_FUNCTION] ===== Scheduled Study Runner Started =====');
  console.log('[EDGE_FUNCTION] Request method:', req.method);
  console.log('[EDGE_FUNCTION] Timestamp:', new Date().toISOString());

  try {
    const cronSecret = req.headers.get('X-Cron-Secret') ||
                      req.headers.get('Authorization')?.replace('Bearer ', '') ||
                      new URL(req.url).searchParams.get('secret');
    const expectedSecret = Deno.env.get('SCHEDULER_CRON_SECRET');

    console.log('[EDGE_FUNCTION] Auth check:', {
      hasSecret: !!cronSecret,
      hasExpectedSecret: !!expectedSecret,
      secretMatch: cronSecret === expectedSecret
    });

    if (!expectedSecret) {
      console.warn('[EDGE_FUNCTION] ⚠️ SCHEDULER_CRON_SECRET not configured - running without auth');
    } else if (cronSecret !== expectedSecret) {
      console.error('[EDGE_FUNCTION] ❌ Unauthorized: Invalid or missing SCHEDULER_CRON_SECRET');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or missing SCHEDULER_CRON_SECRET' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[EDGE_FUNCTION] ✅ Authentication passed');

    if (!WORKER_URL) {
      console.error('[EDGE_FUNCTION] ❌ Missing WORKER_URL environment variable');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing WORKER_URL configuration. Please deploy the Node.js worker and set WORKER_URL.',
          timestamp: new Date().toISOString()
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!WORKER_SECRET) {
      console.warn('[EDGE_FUNCTION] ⚠️ WORKER_SECRET not configured - worker calls will be unauthenticated');
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[EDGE_FUNCTION] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing Supabase configuration',
          timestamp: new Date().toISOString()
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[EDGE_FUNCTION] ✅ Supabase client created successfully');

    const now = new Date();
    const nowISO = now.toISOString();
    console.log('[EDGE_FUNCTION] Current UTC time:', nowISO);
    console.log('[EDGE_FUNCTION] Querying for pending jobs with scheduled_at <= current time...');

    const { data: jobs, error: jobsError } = await supabase
      .from('scheduled_study_runs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', nowISO)
      .order('scheduled_at', { ascending: true })
      .limit(5);

    if (jobsError) {
      console.error('[EDGE_FUNCTION] ❌ Error fetching jobs:', jobsError);
      throw jobsError;
    }

    console.log(`[EDGE_FUNCTION] Query result: ${jobs?.length || 0} jobs found`);

    if (!jobs || jobs.length === 0) {
      console.log('[EDGE_FUNCTION] ✅ No due jobs at this time');
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          completed: 0,
          failed: 0,
          message: 'No due jobs found',
          timestamp: nowISO
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[EDGE_FUNCTION] 📋 Processing ${jobs.length} due jobs:`);
    jobs.forEach((job, idx) => {
      console.log(`  ${idx + 1}. Job ${job.id} - scheduled for ${job.scheduled_at}`);
    });

    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
      const jobStartTime = Date.now();
      console.log(`[EDGE_FUNCTION] ⚙️ Processing job ${job.id}...`);
      console.log(`[EDGE_FUNCTION]   Scheduled at: ${job.scheduled_at}`);
      console.log(`[EDGE_FUNCTION]   Payload:`, JSON.stringify(job.payload));

      const { error: updateError } = await supabase
        .from('scheduled_study_runs')
        .update({
          status: 'running',
          last_run_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'pending');

      if (updateError) {
        console.error(`[EDGE_FUNCTION] ❌ Failed to lock job ${job.id}:`, updateError);
        failed++;
        continue;
      }

      console.log(`[EDGE_FUNCTION] ✅ Job ${job.id} locked and marked as running`);

      try {
        const payload = job.payload as ScheduledStudyPayload;
        const scrapeMode = payload.scrapeMode || 'fast';

        console.log(`[EDGE_FUNCTION] ===== Job ${job.id} Payload Extracted =====`);
        console.log(`[EDGE_FUNCTION] Raw payload:`, JSON.stringify(payload));
        console.log(`[EDGE_FUNCTION] Study IDs count: ${payload.studyIds?.length || 0}`);
        console.log(`[EDGE_FUNCTION] First 3 study IDs:`, payload.studyIds?.slice(0, 3));
        console.log(`[EDGE_FUNCTION] Threshold: ${payload.threshold}`);
        console.log(`[EDGE_FUNCTION] Scrape mode: ${scrapeMode.toUpperCase()}`);

        if (!payload.studyIds || payload.studyIds.length === 0) {
          const errorMsg = 'No study IDs found in scheduled job payload';
          console.error(`[EDGE_FUNCTION] ❌ ${errorMsg}`);

          await supabase
            .from('scheduled_study_runs')
            .update({
              status: 'failed',
              last_error: errorMsg,
            })
            .eq('id', job.id);

          throw new Error(errorMsg);
        }

        console.log(`[EDGE_FUNCTION] ✅ Validated ${payload.studyIds.length} study IDs`);

        const { data: runData, error: runError } = await supabase
          .from('study_runs')
          .insert([{
            run_type: 'scheduled',
            status: 'running',
            total_studies: payload.studyIds.length,
            executed_at: new Date().toISOString(),
            price_diff_threshold_eur: payload.threshold,
          }])
          .select()
          .single();

        if (runError) {
          console.error(`[EDGE_FUNCTION] ❌ Error creating study_runs record:`, runError);
          throw runError;
        }

        const runId = runData.id;
        console.log(`[EDGE_FUNCTION] ✅ Created study_runs record with ID: ${runId}`);

        await supabase
          .from('scheduled_study_runs')
          .update({
            run_id: runId,
          })
          .eq('id', job.id);

        const workerUrl = `${WORKER_URL}/execute-studies`;
        const workerPayload = {
          runId,
          studyIds: payload.studyIds,
          threshold: payload.threshold,
          scrapeMode,
          scheduledJobId: job.id,
        };

        console.log(`[EDGE_FUNCTION] ===== Delegating to Worker =====`);
        console.log(`[EDGE_FUNCTION] Worker URL: ${workerUrl}`);
        console.log(`[EDGE_FUNCTION] Worker payload:`, JSON.stringify(workerPayload));
        console.log(`[EDGE_FUNCTION] Has WORKER_SECRET: ${!!WORKER_SECRET}`);

        const workerResponse = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WORKER_SECRET}`,
          },
          body: JSON.stringify(workerPayload),
        });

        if (!workerResponse.ok) {
          const errorText = await workerResponse.text();
          const errorMsg = `Worker HTTP ${workerResponse.status}: ${errorText.slice(0, 500)}`;
          console.error(`[EDGE_FUNCTION] ❌ Worker returned error: ${errorMsg}`);

          await supabase
            .from('study_runs')
            .update({
              status: 'error',
              error_message: errorMsg,
            })
            .eq('id', runId);

          throw new Error(errorMsg);
        }

        const workerResult = await workerResponse.json();
        console.log(`[EDGE_FUNCTION] ===== Worker Response =====`);
        console.log(`[EDGE_FUNCTION] Worker result:`, JSON.stringify(workerResult));
        console.log(`[EDGE_FUNCTION] Processed: ${workerResult.processed}, Opportunities: ${workerResult.results?.opportunities || 0}`);

        const executionDuration = Date.now() - jobStartTime;
        await supabase
          .from('scheduled_study_runs')
          .update({
            status: 'completed',
            execution_duration_ms: executionDuration,
          })
          .eq('id', job.id);

        completed++;
        console.log(`[EDGE_FUNCTION] ✅ Job ${job.id} completed via worker in ${executionDuration}ms`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[EDGE_FUNCTION] ===== Job ${job.id} Failed =====`);
        console.error(`[EDGE_FUNCTION] Error:`, errorMessage);
        console.error(`[EDGE_FUNCTION] Payload was:`, JSON.stringify(job.payload));

        await supabase
          .from('scheduled_study_runs')
          .update({
            status: 'failed',
            last_error: errorMessage.slice(0, 1000),
          })
          .eq('id', job.id);

        const payload = job.payload as ScheduledStudyPayload;
        if (payload.studyIds && payload.studyIds.length > 0) {
          console.log(`[EDGE_FUNCTION] Attempting to mark study_runs as failed...`);
          try {
            const { data: runRecords } = await supabase
              .from('study_runs')
              .select('id')
              .eq('run_type', 'scheduled')
              .eq('status', 'running')
              .order('executed_at', { ascending: false })
              .limit(1);

            if (runRecords && runRecords.length > 0) {
              await supabase
                .from('study_runs')
                .update({
                  status: 'error',
                  error_message: errorMessage.slice(0, 1000),
                })
                .eq('id', runRecords[0].id);
            }
          } catch (updateError) {
            console.error(`[EDGE_FUNCTION] Failed to update study_runs:`, updateError);
          }
        }

        failed++;
      }
    }

    console.log(`[EDGE_FUNCTION] ===== Scheduled Study Runner Finished =====`);
    console.log(`[EDGE_FUNCTION] Summary: Processed ${jobs.length}, Completed ${completed}, Failed ${failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: jobs.length,
        completed,
        failed,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[EDGE_FUNCTION] ❌ Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
