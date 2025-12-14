import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { executeStudy } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

const WORKER_SECRET = process.env.WORKER_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
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
  });
});

app.post('/execute-studies', async (req, res) => {
  console.log('[WORKER] ===== Execute Studies Request Received =====');
  console.log('[WORKER] Timestamp:', new Date().toISOString());

  const authHeader = req.headers.authorization || req.headers['x-worker-secret'] || '';
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

  const { runId, studyIds, threshold, scrapeMode } = req.body;

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
        });

        totalNullCount += result.nullCount;
        totalOpportunitiesCount += result.opportunitiesCount;
        if (result.status === 'TARGET_BLOCKED') {
          totalBlockedCount++;
        }

        console.log(`[WORKER] ✅ Study ${study.id} completed: ${result.status}`);
      } catch (error) {
        console.error(`[WORKER] ❌ Error executing study ${study.id}:`, error);

        await supabase.from('study_run_results').insert([{
          run_id: runId,
          study_id: study.id,
          status: 'NULL',
          target_market_price: null,
          best_source_price: null,
          price_difference: null,
          target_stats: null,
          target_error_reason: `Execution error: ${error.message}`,
        }]);

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
    } catch (updateError) {
      console.error('[WORKER] Failed to update study_runs status:', updateError);
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[WORKER] ===== MC Export Worker Service Started =====`);
  console.log(`[WORKER] Port: ${PORT}`);
  console.log(`[WORKER] Environment check:`, {
    hasWorkerSecret: !!WORKER_SECRET,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
    hasZyteKey: !!process.env.ZYTE_API_KEY,
  });
  console.log(`[WORKER] Health endpoint: http://localhost:${PORT}/health`);
  console.log(`[WORKER] Execute endpoint: http://localhost:${PORT}/execute-studies`);
  console.log(`[WORKER] Ready to process scheduled study runs`);
});
