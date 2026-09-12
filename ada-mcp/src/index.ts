import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createClient } from '@supabase/supabase-js';
import * as z from 'zod/v4';

const PORT = Number.parseInt(process.env.PORT || '3002', 10);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[ADA_MCP] Missing required environment variable: ${name}`);
  }
  return value;
}

function csvEnv(name: string, required = false): string[] {
  const raw = process.env[name]?.trim() || '';
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (required && values.length === 0) {
    throw new Error(`[ADA_MCP] Missing required environment variable: ${name}`);
  }

  return values;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ADA_MCP_API_KEY = requireEnv('ADA_MCP_API_KEY');
const ALLOWED_HOSTS = csvEnv('ADA_MCP_ALLOWED_HOSTS', true);
const ALLOWED_ORIGINS = csvEnv('ADA_MCP_ALLOWED_ORIGINS');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function jsonToolResult(value: unknown) {
  const structuredContent =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { data: value };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent,
  };
}

function assertDb(error: { message?: string } | null, context: string): void {
  if (error) {
    throw new Error(`[ADA_MCP] ${context}: ${error.message || 'database error'}`);
  }
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function fetchStudyMap(studyIds: string[]) {
  const uniqueIds = [...new Set(studyIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map<string, Record<string, unknown>>();

  const { data, error } = await supabase
    .from('studies_v2')
    .select('id,brand,model,year,max_mileage,country_source,country_target,market_source_url,market_target_url,updated_at')
    .in('id', uniqueIds);

  assertDb(error, 'Unable to enrich study metadata');

  return new Map((data || []).map((study) => [study.id, study as Record<string, unknown>]));
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'ada-readonly',
    version: '0.1.0',
  });

  server.registerTool(
    'ada_health',
    {
      title: 'ADA health',
      description: 'Check that the ADA read-only connector can reach its source-of-truth database.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const [studiesResponse, runsResponse] = await Promise.all([
        supabase.from('studies_v2').select('*', { count: 'exact', head: true }),
        supabase.from('study_runs').select('*', { count: 'exact', head: true }),
      ]);

      assertDb(studiesResponse.error, 'Unable to count studies');
      assertDb(runsResponse.error, 'Unable to count runs');

      return jsonToolResult({
        status: 'ok',
        mode: 'read-only',
        sourceOfTruth: 'ADA / Supabase',
        studiesCount: studiesResponse.count ?? 0,
        runsCount: runsResponse.count ?? 0,
        checkedAt: new Date().toISOString(),
      });
    },
  );

  server.registerTool(
    'list_studies',
    {
      title: 'List ADA studies',
      description: 'List studies from ADA studies_v2 with optional vehicle and country filters.',
      inputSchema: z.object({
        brand: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        countrySource: z.string().trim().min(2).max(3).optional(),
        countryTarget: z.string().trim().min(2).max(3).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ brand, model, countrySource, countryTarget, limit }) => {
      let query = supabase
        .from('studies_v2')
        .select('id,brand,model,year,max_mileage,country_source,country_target,updated_at')
        .order('brand', { ascending: true })
        .order('model', { ascending: true })
        .limit(limit);

      const normalizedBrand = normalizeText(brand);
      const normalizedModel = normalizeText(model);
      if (normalizedBrand) query = query.ilike('brand', `%${normalizedBrand}%`);
      if (normalizedModel) query = query.ilike('model', `%${normalizedModel}%`);
      if (countrySource) query = query.eq('country_source', countrySource.toUpperCase());
      if (countryTarget) query = query.eq('country_target', countryTarget.toUpperCase());

      const { data, error } = await query;
      assertDb(error, 'Unable to list studies');

      return jsonToolResult({
        count: data?.length ?? 0,
        studies: data || [],
      });
    },
  );

  server.registerTool(
    'get_study',
    {
      title: 'Get ADA study',
      description: 'Get one ADA study by its exact study ID, including its source and target search URLs.',
      inputSchema: z.object({
        studyId: z.string().trim().min(1),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ studyId }) => {
      const { data, error } = await supabase
        .from('studies_v2')
        .select('id,brand,model,year,max_mileage,country_source,country_target,market_source_url,market_target_url,created_at,updated_at')
        .eq('id', studyId)
        .maybeSingle();

      assertDb(error, 'Unable to get study');

      return jsonToolResult({
        found: Boolean(data),
        study: data || null,
      });
    },
  );

  server.registerTool(
    'list_recent_runs',
    {
      title: 'List recent ADA runs',
      description: 'List recent ADA study runs and their high-level result counts.',
      inputSchema: z.object({
        status: z.string().trim().min(1).optional(),
        runType: z.enum(['instant', 'scheduled']).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ status, runType, limit }) => {
      let query = supabase
        .from('study_runs')
        .select('id,run_type,status,total_studies,null_count,opportunities_count,scheduled_for,executed_at,error_message,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);
      if (runType) query = query.eq('run_type', runType);

      const { data, error } = await query;
      assertDb(error, 'Unable to list recent runs');

      return jsonToolResult({
        count: data?.length ?? 0,
        runs: data || [],
      });
    },
  );

  server.registerTool(
    'get_run_details',
    {
      title: 'Get ADA run details',
      description: 'Get a run, its per-study results, enriched vehicle metadata, and optionally the stored source listings.',
      inputSchema: z.object({
        runId: z.string().uuid(),
        includeListings: z.boolean().default(false),
        listingsLimit: z.number().int().min(1).max(200).default(100),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ runId, includeListings, listingsLimit }) => {
      const { data: run, error: runError } = await supabase
        .from('study_runs')
        .select('id,run_type,status,total_studies,null_count,opportunities_count,scheduled_for,executed_at,error_message,created_at')
        .eq('id', runId)
        .maybeSingle();

      assertDb(runError, 'Unable to get run');
      if (!run) {
        return jsonToolResult({ found: false, run: null, results: [], listings: [] });
      }

      const { data: results, error: resultsError } = await supabase
        .from('study_run_results')
        .select('id,run_id,study_id,status,target_market_price,best_source_price,price_difference,target_stats,created_at')
        .eq('run_id', runId)
        .order('price_difference', { ascending: false, nullsFirst: false });

      assertDb(resultsError, 'Unable to get run results');

      const resultRows = results || [];
      const studyMap = await fetchStudyMap(resultRows.map((row) => row.study_id));
      const enrichedResults = resultRows.map((row) => ({
        ...row,
        study: studyMap.get(row.study_id) || null,
      }));

      let listings: unknown[] = [];
      if (includeListings && resultRows.length > 0) {
        const resultIds = resultRows.map((row) => row.id);
        const { data: listingRows, error: listingsError } = await supabase
          .from('study_source_listings')
          .select('id,run_result_id,listing_url,title,price,mileage,year,trim,is_damaged,defects_summary,maintenance_summary,options_summary,created_at')
          .in('run_result_id', resultIds)
          .order('price', { ascending: true })
          .limit(listingsLimit);

        assertDb(listingsError, 'Unable to get source listings');
        listings = listingRows || [];
      }

      return jsonToolResult({
        found: true,
        run,
        results: enrichedResults,
        listings,
      });
    },
  );

  server.registerTool(
    'list_opportunities',
    {
      title: 'List ADA opportunities',
      description: 'List stored ADA opportunity results, optionally filtered by vehicle, source/target country, or minimum price difference.',
      inputSchema: z.object({
        brand: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        countrySource: z.string().trim().min(2).max(3).optional(),
        countryTarget: z.string().trim().min(2).max(3).optional(),
        minPriceDifference: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ brand, model, countrySource, countryTarget, minPriceDifference, limit }) => {
      const hasStudyFilter = Boolean(brand || model || countrySource || countryTarget);
      let filteredStudyIds: string[] | null = null;
      let preloadedStudyMap = new Map<string, Record<string, unknown>>();

      if (hasStudyFilter) {
        let studyQuery = supabase
          .from('studies_v2')
          .select('id,brand,model,year,max_mileage,country_source,country_target,market_source_url,market_target_url,updated_at')
          .limit(1000);

        const normalizedBrand = normalizeText(brand);
        const normalizedModel = normalizeText(model);
        if (normalizedBrand) studyQuery = studyQuery.ilike('brand', `%${normalizedBrand}%`);
        if (normalizedModel) studyQuery = studyQuery.ilike('model', `%${normalizedModel}%`);
        if (countrySource) studyQuery = studyQuery.eq('country_source', countrySource.toUpperCase());
        if (countryTarget) studyQuery = studyQuery.eq('country_target', countryTarget.toUpperCase());

        const { data: matchingStudies, error: studiesError } = await studyQuery;
        assertDb(studiesError, 'Unable to filter studies for opportunities');

        filteredStudyIds = (matchingStudies || []).map((study) => study.id);
        preloadedStudyMap = new Map(
          (matchingStudies || []).map((study) => [study.id, study as Record<string, unknown>]),
        );

        if (filteredStudyIds.length === 0) {
          return jsonToolResult({ count: 0, opportunities: [] });
        }
      }

      let resultQuery = supabase
        .from('study_run_results')
        .select('id,run_id,study_id,status,target_market_price,best_source_price,price_difference,target_stats,created_at')
        .eq('status', 'OPPORTUNITIES')
        .order('price_difference', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (filteredStudyIds) resultQuery = resultQuery.in('study_id', filteredStudyIds);
      if (minPriceDifference !== undefined) {
        resultQuery = resultQuery.gte('price_difference', minPriceDifference);
      }

      const { data: results, error: resultsError } = await resultQuery;
      assertDb(resultsError, 'Unable to list opportunities');

      const resultRows = results || [];
      const missingStudyIds = resultRows
        .map((row) => row.study_id)
        .filter((studyId) => !preloadedStudyMap.has(studyId));
      const fetchedStudyMap = await fetchStudyMap(missingStudyIds);
      const studyMap = new Map([...preloadedStudyMap, ...fetchedStudyMap]);

      const runIds = [...new Set(resultRows.map((row) => row.run_id).filter(Boolean))];
      let runMap = new Map<string, Record<string, unknown>>();
      if (runIds.length > 0) {
        const { data: runs, error: runsError } = await supabase
          .from('study_runs')
          .select('id,run_type,status,executed_at,created_at')
          .in('id', runIds);
        assertDb(runsError, 'Unable to enrich opportunity runs');
        runMap = new Map((runs || []).map((run) => [run.id, run as Record<string, unknown>]));
      }

      const opportunities = resultRows.map((row) => ({
        ...row,
        study: studyMap.get(row.study_id) || null,
        run: runMap.get(row.run_id) || null,
      }));

      return jsonToolResult({
        count: opportunities.length,
        opportunities,
      });
    },
  );

  return server;
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ALLOWED_HOSTS,
  ...(ALLOWED_ORIGINS.length > 0 ? { allowedOrigins: ALLOWED_ORIGINS } : {}),
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ada-mcp-readonly',
    mode: 'read-only',
    timestamp: new Date().toISOString(),
  });
});

app.use('/mcp', (req, res, next) => {
  const authorization = req.header('authorization') || '';
  const prefix = 'Bearer ';
  const token = authorization.startsWith(prefix) ? authorization.slice(prefix.length).trim() : '';

  if (!token || !constantTimeTokenMatch(token, ADA_MCP_API_KEY)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="ada-mcp"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

const handler = createMcpHandler(() => buildServer());
const nodeHandler = toNodeHandler(handler);

app.all('/mcp', (req, res) => {
  void nodeHandler(req, res, req.body);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ADA_MCP] Read-only MCP service listening on 0.0.0.0:${PORT}`);
  console.log(`[ADA_MCP] Allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
  console.log(`[ADA_MCP] Database configured: true`);
  console.log(`[ADA_MCP] Authentication configured: true`);
});
