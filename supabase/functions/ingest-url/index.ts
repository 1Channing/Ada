/**
 * Thin proxy: browser → worker /ingest-url.
 *
 * The worker holds the Zyte key and WORKER_SECRET; neither is ever exposed
 * to the browser. This function only forwards the pasted URL and relays the
 * worker's listing sample back. Uses the same WORKER_URL / WORKER_SECRET
 * environment secrets as run_scheduled_studies.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const WORKER_URL = (Deno.env.get('WORKER_URL') || '').replace(/\/+$/, '');
const WORKER_SECRET = Deno.env.get('WORKER_SECRET') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!WORKER_URL) {
    return new Response(JSON.stringify({ error: 'WORKER_URL not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing required parameter: url' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const workerResp = await fetch(`${WORKER_URL}/ingest-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({ url }),
    });

    const body = await workerResp.text();
    return new Response(body, {
      status: workerResp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: 'worker_unreachable', message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
