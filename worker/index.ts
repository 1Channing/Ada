import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { executeStudy } from './scraper';
import { collectLinkgenSamples } from './linkgenCollector';

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

app.post('/linkgen/collect-samples', async (req, res) => {
  console.log('[LINKGEN] ===== Collect Samples Request Received =====');
  console.log('[LINKGEN] Timestamp:', new Date().toISOString());

  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');

  if (!WORKER_SECRET) {
    console.warn('[LINKGEN] ⚠️ WORKER_SECRET not configured - running without auth');
  } else if (providedSecret !== WORKER_SECRET) {
    console.error('[LINKGEN] ❌ Unauthorized: Invalid or missing WORKER_SECRET');
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing WORKER_SECRET',
    });
  }

  console.log('[LINKGEN] ✅ Authentication passed');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[LINKGEN] Missing Supabase configuration');
    return res.status(500).json({
      error: 'Missing Supabase configuration',
    });
  }

  const { marketplace, target_count = 100, max_pages = 5, seed_url } = req.body;

  if (!marketplace) {
    console.error('[LINKGEN] Missing marketplace parameter');
    return res.status(400).json({
      error: 'Missing required parameter: marketplace',
    });
  }

  if (marketplace !== 'MARKTPLAATS') {
    console.error('[LINKGEN] Unsupported marketplace:', marketplace);
    return res.status(400).json({
      error: 'Only MARKTPLAATS is currently supported',
    });
  }

  console.log('[LINKGEN] Request params:', {
    marketplace,
    target_count,
    max_pages,
    seed_url: seed_url || 'default',
  });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await collectLinkgenSamples({
      marketplace,
      targetCount: target_count,
      maxPages: max_pages,
      seedUrl: seed_url,
      supabase,
    });

    console.log('[LINKGEN] ✅ Collection complete:', {
      collected: result.samplesCollected,
      inserted: result.samplesInserted,
      duplicates: result.duplicatesSkipped,
      diversityLimited: result.diversityLimited,
    });

    res.json({
      success: true,
      marketplace,
      samplesCollected: result.samplesCollected,
      samplesInserted: result.samplesInserted,
      duplicatesSkipped: result.duplicatesSkipped,
      diversityLimited: result.diversityLimited,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[LINKGEN] Fatal error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
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
  console.log(`[WORKER] Ready to process scheduled study runs`);
});
