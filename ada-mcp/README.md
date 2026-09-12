# ADA MCP — Read-only V1

Private MCP service that exposes a small, controlled read-only surface over ADA's source-of-truth data.

## Why a separate service

This service is intentionally isolated from `worker/`:

- no change to the production scraping/scheduling worker;
- no direct database credentials are exposed to ChatGPT;
- the MCP surface can evolve independently;
- V1 contains no write/mutate tools;
- missing secrets fail at boot instead of silently disabling authentication.

## Exposed tools

| Tool | Purpose |
| --- | --- |
| `ada_health` | Verify database connectivity and return study/run counts |
| `list_studies` | Search `studies_v2` by brand/model/source/target country |
| `get_study` | Read one study, including its source/target URLs |
| `list_recent_runs` | Read recent run status and opportunity/null counts |
| `get_run_details` | Read a run, its per-study results, and optionally stored source listings |
| `list_opportunities` | Read stored opportunities, with vehicle/country/min-difference filters |

Every tool is declared read-only, non-destructive, idempotent, and closed-world.

## Security model

The service uses the Supabase service-role key only server-side.

Required environment variables:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ADA_MCP_API_KEY=...
ADA_MCP_ALLOWED_HOSTS=ada-mcp-production.up.railway.app
```

Optional:

```bash
ADA_MCP_ALLOWED_ORIGINS=
PORT=3002
```

Important:

- Use a dedicated `ADA_MCP_API_KEY`; do not reuse `WORKER_SECRET`.
- `ADA_MCP_ALLOWED_HOSTS` is mandatory. The service refuses to boot without it.
- Never put the service-role key or MCP token in GitHub.
- V1 uses a static bearer token as the transport gate. If/when the connector is distributed to multiple users, replace this isolated auth layer with OAuth/OIDC and per-user authorization.

## Local run

```bash
cd ada-mcp
npm install
cp .env.example .env
# Edit .env; for local use include localhost in ADA_MCP_ALLOWED_HOSTS
npm run dev
```

Health check:

```bash
curl http://localhost:3002/health
```

MCP requests require:

```http
Authorization: Bearer <ADA_MCP_API_KEY>
```

## Railway deployment

Create a **new Railway service** from the existing `1Channing/Ada` repository. Do not repoint the existing worker service.

Recommended settings:

- Root directory: `/ada-mcp`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Node: 20+
- Public networking: enabled for the MCP endpoint
- Health endpoint: `/health`

Set all variables from `.env.example`. Once Railway assigns the domain, set `ADA_MCP_ALLOWED_HOSTS` to that hostname (without `https://` and without a path), then redeploy.

The MCP endpoint is:

```text
https://<your-domain>/mcp
```

## ChatGPT connection

V1 is designed for a custom MCP app with read/retrieval permissions.

1. Deploy the remote MCP service.
2. In ChatGPT web, enable Developer Mode for custom apps/MCP if your plan/workspace supports it.
3. Create a custom app using the remote `/mcp` endpoint.
4. Configure the supported authentication mechanism for the workspace. The server currently expects a bearer token; if the ChatGPT connection configuration requires OAuth for your workspace, keep the tools/database code unchanged and replace only the auth adapter.
5. Scan the tools and test `ada_health` first.
6. Then test a narrow query such as: `Liste les études ADA sur Tesla vers le Danemark.`

## Current scope

V1 deliberately does **not**:

- create or edit studies;
- launch scraping jobs;
- mutate mappings;
- publish articles;
- expose arbitrary SQL;
- expose generic table access.

Those capabilities should be added one-by-one later, with explicit scopes, audit logs, confirmations, and idempotency keys where relevant.

## Suggested V2

After V1 is stable:

1. `run_study` / `run_studies` through ADA's existing orchestration layer — never direct DB writes from the MCP tool.
2. job status polling/readback;
3. article research package generation from verified ADA results;
4. explicit publish workflow to the MC Export content repository;
5. per-user OAuth/OIDC and audit trail.
