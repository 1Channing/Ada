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

const WORKER_URL = Deno.env.get('WORKER_URL') || '';
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
      console.log(`[EDGE_FUNCTION] ⚙️ Processing job ${job.id}...`);
      console.log(`[EDGE_FUNCTION]   Scheduled at: ${job.scheduled_at}`);
      console.log(`[EDGE_FUNCTION]   Payload:`, JSON.stringify(job.payload));

      const { error: updateError } = await supabase
        .from('scheduled_study_runs')
        .update({
          status: 'running',
          last_run_at: new Date().toISOString(),
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

        console.log(`[EDGE_FUNCTION] Processing job ${job.id} with ${scrapeMode.toUpperCase()} mode`);

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

        console.log(`[EDGE_FUNCTION] 🚀 Delegating execution to Node.js worker at ${WORKER_URL}`);

        const workerResponse = await fetch(`${WORKER_URL}/execute-studies`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WORKER_SECRET}`,
          },
          body: JSON.stringify({
            runId,
            studyIds: payload.studyIds,
            threshold: payload.threshold,
            scrapeMode,
          }),
        });

        if (!workerResponse.ok) {
          const errorText = await workerResponse.text();
          console.error(`[EDGE_FUNCTION] ❌ Worker returned error: ${workerResponse.status} - ${errorText}`);
          throw new Error(`Worker failed: ${workerResponse.status} - ${errorText}`);
        }

        const workerResult = await workerResponse.json();
        console.log(`[EDGE_FUNCTION] ✅ Worker completed successfully:`, workerResult);

        await supabase
          .from('scheduled_study_runs')
          .update({
            status: 'completed',
          })
          .eq('id', job.id);

        completed++;
        console.log(`[EDGE_FUNCTION] ✅ Job ${job.id} completed via worker`);
      } catch (error) {
        console.error(`[EDGE_FUNCTION] ❌ Job ${job.id} failed:`, error);

        await supabase
          .from('scheduled_study_runs')
          .update({
            status: 'failed',
            last_error: (error as Error).message,
          })
          .eq('id', job.id);

        try {
          await supabase
            .from('study_runs')
            .update({
              status: 'failed',
              error_message: (error as Error).message,
            })
            .eq('id', job.id);
        } catch (updateError) {
          console.error(`[EDGE_FUNCTION] Failed to update study_runs:`, updateError);
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
