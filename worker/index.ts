import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { executeStudy } from './scraper';
import { executeMappingCrawl, getMappingStats } from './linkgenMappingAuto';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const WORKER_SECRET = process.env.WORKER_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('ok');
});

function performSelfCheck() {
  const checks = {
    singleListen: true,
    portDefined: !!PORT,
    portValue: PORT,
    nodeVersion: process.version,
  };

  return checks;
}

app.get('/health', (req, res) => {
  const selfCheck = performSelfCheck();

  res.json({
    status: 'ok',
    service: 'mc-export-worker',
    timestamp: new Date().toISOString(),
    env: {
      hasWorkerSecret: !!WORKER_SECRET,
      hasSupabaseUrl: !!SUPABASE_URL,
      hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasZyteKey: !!process.env.ZYTE_API_KEY,
    },
    selfCheck,
  });
});

app.post('/execute-studies', async (req, res) => {
  console.log('[WORKER] ===== Execute Studies Request Received =====');
  console.log('[WORKER] Timestamp:', new Date().toISOString());

  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');

  if (!WORKER_SECRET) {
    console.warn('[WORKER] ⚠️ WORKER_SECRET not configured - running without auth');
  } else if (providedSecret !== WORKER_SECRET) {
    console.error('[WORKER] ❌ Unauthorized: Invalid or missing WORKER_SECRET');
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing WORKER_SECRET',
    });
  }

  console.log('[WORKER] ✅ Authentication passed');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[WORKER] Missing Supabase configuration');
    return res.status(500).json({
      error: 'Missing Supabase configuration',
    });
  }

  const { runId, studyIds, threshold, scrapeMode, scheduledJobId } = req.body;

  if (!runId || !studyIds || !threshold) {
    console.error('[WORKER] Missing required parameters:', { runId, studyIds, threshold });
    return res.status(400).json({
      error: 'Missing required parameters: runId, studyIds, threshold',
    });
  }

  console.log('[WORKER] Request params:', {
    runId,
    studyCount: studyIds.length,
    threshold,
    scrapeMode: scrapeMode || 'fast',
  });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: studies, error: studiesError } = await supabase
      .from('studies_v2')
      .select('*')
      .in('id', studyIds);

    if (studiesError) {
      console.error('[WORKER] Error fetching studies:', studiesError);
      throw studiesError;
    }

    if (!studies || studies.length === 0) {
      console.error('[WORKER] No studies found');
      return res.status(404).json({
        error: 'No studies found for provided IDs',
      });
    }

    console.log(`[WORKER] ✅ Found ${studies.length} studies to process`);

    let totalNullCount = 0;
    let totalOpportunitiesCount = 0;
    let totalBlockedCount = 0;

    for (const study of studies) {
      console.log(`[WORKER] Executing study ${study.id}...`);

      try {
        const result = await executeStudy({
          study,
          runId,
          threshold,
          scrapeMode: scrapeMode || 'fast',
          supabase,
          scheduledJobId,
        });

        totalNullCount += result.nullCount;
        totalOpportunitiesCount += result.opportunitiesCount;
        if (result.status === 'TARGET_BLOCKED') {
          totalBlockedCount++;
        }

        console.log(`[WORKER] ✅ Study ${study.id} completed: ${result.status}`);
      } catch (error) {
        console.error(`[WORKER] ❌ Error executing study ${study.id}:`, error);

        const { error: insertError } = await supabase.from('study_run_results').insert([{
          run_id: runId,
          study_id: study.id,
          status: 'NULL',
          target_market_price: null,
          best_source_price: null,
          price_difference: null,
          target_stats: null,
          target_error_reason: `Execution error: ${error.message}`,
        }]);

        if (insertError) {
          console.error(`[DATABASE_ERROR] Failed to insert error result for ${study.id}:`, insertError);
        }

        totalNullCount++;
      }
    }

    await supabase
      .from('study_runs')
      .update({
        status: 'completed',
        null_count: totalNullCount,
        opportunities_count: totalOpportunitiesCount,
      })
      .eq('id', runId);

    if (scheduledJobId) {
      await supabase
        .from('scheduled_study_runs')
        .update({
          status: 'completed',
          run_id: runId,
        })
        .eq('id', scheduledJobId);
      console.log(`[WORKER] ✅ Updated scheduled_study_runs (${scheduledJobId}) to completed`);
    }

    console.log('[WORKER] ✅ All studies processed successfully');
    console.log(`[WORKER] Results: ${totalOpportunitiesCount} opportunities, ${totalNullCount} null, ${totalBlockedCount} blocked`);

    res.json({
      success: true,
      runId,
      processed: studies.length,
      results: {
        opportunities: totalOpportunitiesCount,
        null: totalNullCount,
        blocked: totalBlockedCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[WORKER] Fatal error:', error);

    try {
      await supabase
        .from('study_runs')
        .update({
          status: 'failed',
          error_message: error.message,
        })
        .eq('id', runId);

      if (scheduledJobId) {
        await supabase
          .from('scheduled_study_runs')
          .update({
            status: 'failed',
            last_error: error.message,
          })
          .eq('id', scheduledJobId);
      }
    } catch (updateError) {
      console.error('[WORKER] Failed to update status:', updateError);
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

app.post('/linkgen/mapping-auto/start', async (req, res) => {
  console.log('[LINKGEN_AUTO] ===== Start Mapping Crawl Request Received =====');
  console.log('[LINKGEN_AUTO] Timestamp:', new Date().toISOString());

  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');

  if (!WORKER_SECRET) {
    console.warn('[LINKGEN_AUTO] ⚠️ WORKER_SECRET not configured - running without auth');
  } else if (providedSecret !== WORKER_SECRET) {
    console.error('[LINKGEN_AUTO] ❌ Unauthorized: Invalid or missing WORKER_SECRET');
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized: Invalid or missing WORKER_SECRET',
    });
  }

  console.log('[LINKGEN_AUTO] ✅ Authentication passed');

  const { marketplace, seed_listing_url, steps } = req.body;

  if (!marketplace || !seed_listing_url) {
    console.error('[LINKGEN_AUTO] Missing required parameters');
    return res.status(400).json({
      ok: false,
      error: 'Missing required parameters: marketplace, seed_listing_url',
    });
  }

  if (marketplace !== 'MARKTPLAATS') {
    console.error('[LINKGEN_AUTO] Unsupported marketplace:', marketplace);
    return res.status(400).json({
      ok: false,
      error: 'Only MARKTPLAATS marketplace is currently supported',
    });
  }

  if (!seed_listing_url.includes('marktplaats.nl')) {
    console.error('[LINKGEN_AUTO] Invalid seed URL for MARKTPLAATS');
    return res.status(400).json({
      ok: false,
      error: 'seed_listing_url must be a valid marktplaats.nl URL',
    });
  }

  const targetSteps = Math.min(steps || 100, 200);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[LINKGEN_AUTO] Missing Supabase configuration');
    return res.status(500).json({
      ok: false,
      error: 'Missing Supabase configuration',
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: run, error: insertError } = await supabase
      .from('linkgen_mapping_runs')
      .insert({
        marketplace,
        seed_listing_url,
        target_steps: targetSteps,
      })
      .select()
      .single();

    if (insertError || !run) {
      console.error('[LINKGEN_AUTO] Failed to create run:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create mapping run',
      });
    }

    console.log(`[LINKGEN_AUTO] ✅ Created run: ${run.id}`);

    setImmediate(() => {
      executeMappingCrawl({
        runId: run.id,
        marketplace,
        seedListingUrl: seed_listing_url,
        steps: targetSteps,
        supabase,
      }).catch((error) => {
        console.error('[LINKGEN_AUTO] Crawl error:', error);
        supabase
          .from('linkgen_mapping_runs')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: error?.message || String(error),
          })
          .eq('id', run.id)
          .then(() => {
            console.log(`[LINKGEN_AUTO] Marked run ${run.id} as failed`);
          });
      });
    });

    return res.json({
      ok: true,
      runId: run.id,
    });
  } catch (error) {
    console.error('[LINKGEN_AUTO] Fatal error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      message: error?.message || String(error),
    });
  }
});

app.get('/linkgen/mapping-auto/stats', async (req, res) => {
  console.log('[LINKGEN_AUTO] ===== Stats Request Received =====');

  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');

  if (!WORKER_SECRET) {
    console.warn('[LINKGEN_AUTO] ⚠️ WORKER_SECRET not configured - running without auth');
  } else if (providedSecret !== WORKER_SECRET) {
    console.error('[LINKGEN_AUTO] ❌ Unauthorized: Invalid or missing WORKER_SECRET');
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized: Invalid or missing WORKER_SECRET',
    });
  }

  const { runId } = req.query;

  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'Missing required parameter: runId',
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[LINKGEN_AUTO] Missing Supabase configuration');
    return res.status(500).json({
      ok: false,
      error: 'Missing Supabase configuration',
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const stats = await getMappingStats(runId, supabase);
    return res.json(stats);
  } catch (error) {
    console.error('[LINKGEN_AUTO] Stats error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch stats',
      message: error?.message || String(error),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WORKER] ===== MC Export Worker Service Started =====`);
  console.log(`[WORKER] Node version: ${process.version}`);
  console.log(`[WORKER] PORT: ${PORT}`);
  console.log(`[WORKER] Listening on 0.0.0.0:${PORT}`);
  console.log('[WORKER] Environment check:', {
    hasWorkerSecret: !!process.env.WORKER_SECRET,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasZyteKey: !!process.env.ZYTE_API_KEY,
  });
  console.log(`[WORKER] Health endpoint: GET /`);
  console.log(`[WORKER] Health endpoint: GET /health`);
  console.log(`[WORKER] Execute endpoint: POST /execute-studies`);
  console.log(`[WORKER] Mapping Auto endpoint: POST /linkgen/mapping-auto/start`);
  console.log(`[WORKER] Mapping Auto endpoint: GET /linkgen/mapping-auto/stats`);
  console.log(`[WORKER] Ready to process scheduled study runs`);
});
