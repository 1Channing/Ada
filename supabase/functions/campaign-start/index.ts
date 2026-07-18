/**
 * Thin proxy: browser → worker /campaign/start.
 *
 * The worker runs the whole campaign loop server-side (browser can close);
 * this function only forwards the campaign config. Same WORKER_URL /
 * WORKER_SECRET secrets as ingest-url. Stopping does NOT go through here —
 * the frontend flips the campaign row to status='stopping' directly.
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
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!WORKER_URL) {
    return new Response(JSON.stringify({ started: false, reason: 'WORKER_URL not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ started: false, reason: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const workerResp = await fetch(`${WORKER_URL}/campaign/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify(body),
    });
    const text = await workerResp.text();
    return new Response(text, {
      status: workerResp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ started: false, reason: `worker_unreachable: ${e instanceof Error ? e.message : String(e)}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
