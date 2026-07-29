import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { executeStudy, scrapeSearch } from './scraper';
import { findSiteAdapterByDomain, decomposeUrl } from '../src/lib/study-core/marketplaces';
import type { SearchCriteria } from '../src/lib/study-core/marketplaces';
import { analyzeIngestion } from '../src/lib/study-core/ingestion';
import { persistIngestionResult } from '../src/lib/linkgen/ingestion';
import { persistTaxonomyHarvest } from '../src/lib/linkgen/taxonomy';
import { writeMarketSnapshot } from '../src/services/marketData';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { startWorkerCampaign, resumeWorkerCampaigns } from './campaign';
import { initWorkerLogCapture } from './logStore';
import { startDailySearchScheduler } from './dailySearches';
import { startSalesSheetSync } from './salesSheetSync';
import { startLegalWatchCollector } from './legalWatchCollector';

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

/**
 * Discovery scrape for the Ingestion page: fetch + parse ONE human-pasted
 * search URL and return the raw listing sample. No business logic, no DB
 * writes — confirmation and retention happen client-side on pure study-core
 * functions. Reuses scrapeSearch (same Zyte retries/profiles as studies).
 */
// Async ingest jobs: a 'full' scrape (browser mode + pagination) can outlive
// the HTTP proxy timeout (Railway 502 while the scrape kept running and the
// result was thrown away). The scrape now runs detached; the client gets a
// jobId immediately and polls until done. In-memory store, 15-min TTL.
type IngestJob = { status: 'running' | 'done' | 'error'; payload?: unknown; message?: string; at: number };
const INGEST_JOBS = new Map<string, IngestJob>();
function purgeOldIngestJobs() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, j] of INGEST_JOBS) if (j.at < cutoff) INGEST_JOBS.delete(id);
}

app.post('/ingest-url', async (req, res) => {
  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');

  if (!WORKER_SECRET) {
    console.warn('[INGEST] ⚠️ WORKER_SECRET not configured - running without auth');
  } else if (providedSecret !== WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing WORKER_SECRET' });
  }

  const { url, jobId, async: wantAsync, criteria: rawCriteria, submittedBy: rawSubmitter } = req.body ?? {};
  // Server-side pipeline: when the frontend sends the declared criteria, the
  // WORKER runs the whole ingestion (analysis + memory/journal retention +
  // market snapshot) — exactly like a 1-item campaign. The browser can close
  // the moment the job is accepted: nothing is lost.
  const criteria = (rawCriteria && typeof rawCriteria === 'object' ? rawCriteria : null) as SearchCriteria | null;
  const submittedBy = typeof rawSubmitter === 'string' && rawSubmitter.trim() ? rawSubmitter.trim() : undefined;
  const serverPipeline = !!(criteria && String(criteria.brand ?? '').trim() && String(criteria.model ?? '').trim());

  // Poll branch: return the job's current state.
  if (jobId && typeof jobId === 'string') {
    purgeOldIngestJobs();
    const job = INGEST_JOBS.get(jobId);
    if (!job) return res.status(404).json({ error: 'unknown_job', message: 'Job inconnu ou expiré (worker redémarré ?)' });
    if (job.status === 'running') return res.json({ jobStatus: 'running' });
    if (job.status === 'error') return res.json({ jobStatus: 'error', error: 'INGEST_FAILED', message: job.message });
    return res.json({ jobStatus: 'done', ...(job.payload as Record<string, unknown>) });
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing required parameter: url' });
  }

  const adapter = findSiteAdapterByDomain(url);
  if (!adapter) {
    return res.status(400).json({ error: 'unsupported_site', message: `No site adapter for URL domain: ${url.slice(0, 120)}` });
  }

  console.log(`[INGEST] Discovery scrape site=${adapter.key} async=${!!wantAsync} serverPipeline=${serverPipeline} url=${url.slice(0, 150)}`);

  const runScrape = async () => {
    // 'full' mode → up to 3 retries with per-site profile escalation; a
    // sample we memorise as certain deserves the robust path, not 'fast'.
    const result = await scrapeSearch(url, 'full');
    // Référentiel embarqué moissonné (mobile.de : marques {label,id}) —
    // persisté puis retiré des diagnostics (payload/journal légers).
    const taxo = result.diagnostics?.taxonomyHarvest;
    let taxonomyLearned = 0;
    if (taxo?.length) {
      taxonomyLearned = await persistTaxonomyHarvest(adapter.key, taxo)
        .catch((e) => { console.warn(`[TAXONOMY] persistance (ingest) échouée: ${e instanceof Error ? e.message : e}`); return 0; });
      if (adapter.learnEnumValues) {
        const byField = new Map<string, Array<{ code: string; label: string }>>();
        for (const e of taxo) {
          const list = byField.get(e.field) ?? [];
          list.push({ code: e.code, label: e.label });
          byField.set(e.field, list);
        }
        for (const [field, pairs] of byField) adapter.learnEnumValues(field, pairs);
      }
      delete (result.diagnostics as Record<string, unknown>).taxonomyHarvest;
    }
    const payload: Record<string, unknown> = {
      site: adapter.key,
      country: adapter.country,
      // Sample capped at 100 listings (up to ~5 pages in full mode); descriptions
      // trimmed to keep the payload light (enough for text-based confirmation).
      listings: result.listings.slice(0, 100).map((l) => ({
        ...l,
        description: (l.description || '').slice(0, 300),
      })),
      totalCount: result.totalCount ?? null,
      error: result.error ?? null,
      errorReason: result.errorReason ?? null,
      diagnostics: result.diagnostics ?? null,
      // Taxonomie embarquée apprise pendant CE scrape (nouveaux codes) — le
      // front l'affiche, précieux en ingestion « découverte » sans modèle.
      taxonomyLearned,
      taxonomyHarvested: taxo?.length ?? 0,
    };

    // Full pipeline server-side — the retention happens HERE, browser or not.
    // The frontend sees persisted:true and skips its own writes (no doubles).
    if (serverPipeline && criteria) {
      try {
        const detectedParams = decomposeUrl(url);
        const diag = result.diagnostics as unknown as Record<string, unknown> | null;
        if (result.error && result.listings.length === 0) {
          const outcome = await persistIngestionResult({
            url, site: adapter.key, country: adapter.countryCode, criteria,
            analysis: null, sampleSize: 0, scrapeError: result.error,
            detectedParams, submittedBy, scrapeDiagnostics: diag,
          });
          payload.persisted = true;
          payload.persistOutcome = outcome;
        } else {
          const analysis = analyzeIngestion(url, criteria, result.listings, adapter);
          const outcome = await persistIngestionResult({
            url, site: adapter.key, country: adapter.countryCode, criteria,
            analysis, sampleSize: result.listings.length,
            detectedParams, submittedBy, scrapeDiagnostics: diag,
          });
          const confirmed = new Set(analysis.confirmedFields);
          if (confirmed.has('brand') && confirmed.has('model') && result.listings.length > 0) {
            await writeMarketSnapshot({
              segment: {
                site: adapter.key, country: adapter.countryCode,
                brand: String(criteria.brand ?? '').trim().toUpperCase(),
                model: String(criteria.model ?? '').trim().toUpperCase(),
                fuel: confirmed.has('fuel') ? String(criteria.fuel ?? '').toUpperCase() : '',
                trim: confirmed.has('trim') ? String(criteria.trim ?? '').trim() : '',
              },
              listings: result.listings,
              totalCount: result.totalCount ?? null,
              sourceUrl: url,
              submittedBy,
            }).catch((e) => console.warn('[INGEST] snapshot write failed:', e?.message ?? e));
          }
          payload.persisted = true;
          payload.persistOutcome = outcome;
          console.log(`[INGEST] ✅ pipeline serveur: ${analysis.confirmedFields.length} champ(s) confirmé(s), memory=${outcome.memoryAction}`);
        }
      } catch (e) {
        // Retention failed server-side — leave persisted unset so an open
        // frontend can still do it client-side (belt and braces).
        console.warn('[INGEST] pipeline serveur échoué (le front peut persister):', e instanceof Error ? e.message : e);
      }
    }

    return payload;
  };

  if (wantAsync) {
    purgeOldIngestJobs();
    const id = `ing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    INGEST_JOBS.set(id, { status: 'running', at: Date.now() });
    void runScrape().then(
      (payload) => INGEST_JOBS.set(id, { status: 'done', payload, at: Date.now() }),
      (e) => {
        console.error('[INGEST] Discovery scrape failed:', e);
        INGEST_JOBS.set(id, { status: 'error', message: e?.message ?? String(e), at: Date.now() });
      }
    );
    return res.json({ jobId: id, jobStatus: 'running' });
  }

  // Legacy synchronous path (kept for older frontends).
  try {
    res.json(await runScrape());
  } catch (error: any) {
    console.error('[INGEST] Discovery scrape failed:', error);
    res.status(500).json({ error: 'INGEST_FAILED', message: error?.message ?? String(error) });
  }
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

/**
 * Server-side mapping campaign: plans + runs the whole loop in THIS process,
 * so it keeps going with every browser closed. Stop = the frontend flips the
 * campaign row to status='stopping' (read between items).
 */
app.post('/campaign/start', async (req, res) => {
  const authHeaderRaw = req.headers.authorization || req.headers['x-worker-secret'] || '';
  const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
  const providedSecret = authHeader.replace('Bearer ', '');
  if (WORKER_SECRET && providedSecret !== WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing WORKER_SECRET' });
  }

  const { sites, total, reinforceShare, variantShare, label, filters, deepScan, discoveryOnly, plan } = req.body ?? {};
  if (!Array.isArray(sites) || sites.length === 0 || !total) {
    return res.status(400).json({ error: 'Missing required parameters: sites[], total' });
  }

  try {
    const result = await startWorkerCampaign({ sites, total, reinforceShare, variantShare, label, filters, deepScan, discoveryOnly: discoveryOnly === true, plan });
    return res.status(result.started ? 200 : 409).json(result);
  } catch (e: any) {
    console.error('[CAMPAIGN_WORKER] start failed:', e?.message ?? e);
    return res.status(500).json({ started: false, reason: e?.message ?? 'internal error' });
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
  console.log(`[WORKER] Campaign endpoint: POST /campaign/start`);
  console.log(`[WORKER] Ready to process scheduled study runs`);

  // Shared client for the campaign engine (generator/persist/marketData).
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Journal technique : les warn/error partent aussi dans worker_logs.
    initWorkerLogCapture(client);
    setSharedSupabase(client as any);
    // Pick interrupted campaigns back up after a restart/deploy — ET en
    // continu : une campagne lancée PENDANT un redéploiement naît orpheline
    // (créée la seconde même du boot du 28/07 16:41, la reprise-au-boot avait
    // déjà interrogé la base → « running » que personne ne traite, stop qui
    // mouline). Le chien de garde est sans risque : heartbeat frais → passe,
    // une seule reprise par passage, 'stopping' orphelin → finalisé.
    void resumeWorkerCampaigns();
    setInterval(() => void resumeWorkerCampaigns(), 2 * 60 * 1000);
    // Études quotidiennes des comptes + branchements (tableur, veille).
    startDailySearchScheduler();
    startSalesSheetSync();
    startLegalWatchCollector();
  } else {
    console.warn('[CAMPAIGN_WORKER] Supabase env missing — campaigns disabled');
  }
});
