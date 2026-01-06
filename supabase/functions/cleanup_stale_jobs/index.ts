import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cleanup-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log('[CLEANUP] ===== Stale Job Cleanup Started =====');
  console.log('[CLEANUP] Request method:', req.method);
  console.log('[CLEANUP] Timestamp:', new Date().toISOString());

  try {
    const cleanupSecret = req.headers.get('X-Cleanup-Secret') ||
                         req.headers.get('Authorization')?.replace('Bearer ', '') ||
                         new URL(req.url).searchParams.get('secret');
    const expectedSecret = Deno.env.get('CLEANUP_CRON_SECRET') || Deno.env.get('SCHEDULER_CRON_SECRET');

    console.log('[CLEANUP] Auth check:', {
      hasSecret: !!cleanupSecret,
      hasExpectedSecret: !!expectedSecret,
      secretMatch: cleanupSecret === expectedSecret
    });

    if (!expectedSecret) {
      console.warn('[CLEANUP] ⚠️ CLEANUP_CRON_SECRET not configured - running without auth');
    } else if (cleanupSecret !== expectedSecret) {
      console.error('[CLEANUP] ❌ Unauthorized: Invalid or missing CLEANUP_CRON_SECRET');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or missing secret' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[CLEANUP] ✅ Authentication passed');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[CLEANUP] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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

    console.log('[CLEANUP] ✅ Supabase client created successfully');

    const url = new URL(req.url);
    const timeoutSeconds = parseInt(url.searchParams.get('timeout') || '7200');
    const heartbeatTimeoutSeconds = parseInt(url.searchParams.get('heartbeat_timeout') || '600');

    console.log('[CLEANUP] Configuration:');
    console.log(`[CLEANUP]   - Timeout: ${timeoutSeconds}s (${Math.round(timeoutSeconds / 60)} minutes)`);
    console.log(`[CLEANUP]   - Heartbeat timeout: ${heartbeatTimeoutSeconds}s (${Math.round(heartbeatTimeoutSeconds / 60)} minutes)`);

    console.log('[CLEANUP] Calling cleanup_stale_jobs function...');

    const { data: result, error: cleanupError } = await supabase.rpc('cleanup_stale_jobs', {
      timeout_seconds: timeoutSeconds,
      heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
    });

    if (cleanupError) {
      console.error('[CLEANUP] ❌ Error calling cleanup function:', cleanupError);
      throw cleanupError;
    }

    console.log('[CLEANUP] ===== Cleanup Results =====');
    console.log('[CLEANUP] Total cleaned:', result.total_cleaned);
    console.log('[CLEANUP] Scheduled jobs cleaned:', result.scheduled_jobs_cleaned);
    console.log('[CLEANUP] Orphaned runs cleaned:', result.orphaned_runs_cleaned);

    if (result.scheduled_jobs_cleaned > 0) {
      console.log('[CLEANUP] Scheduled job details:', JSON.stringify(result.scheduled_job_details, null, 2));
    }

    if (result.orphaned_runs_cleaned > 0) {
      console.log('[CLEANUP] Orphaned run details:', JSON.stringify(result.orphaned_run_details, null, 2));
    }

    if (result.total_cleaned === 0) {
      console.log('[CLEANUP] ✅ No stale jobs found - system healthy');
    } else {
      console.warn(`[CLEANUP] ⚠️ Cleaned ${result.total_cleaned} stale job(s)`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        message: result.total_cleaned === 0
          ? 'No stale jobs found'
          : `Cleaned ${result.total_cleaned} stale job(s)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CLEANUP] ❌ Fatal error:', error);
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
