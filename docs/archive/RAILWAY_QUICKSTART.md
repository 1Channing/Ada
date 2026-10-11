# Railway Configuration - Quick Start

**Copy these exact values into Railway Dashboard**

---

## Service Settings

Navigate to: Railway Dashboard → Your Project → Worker Service → Settings

### Root Directory
```
/
```
**IMPORTANT:** Use `/` (root) OR leave completely blank. Do NOT use `worker/`

### Build Command
```bash
cd worker && npm ci && npm run build
```

### Start Command
```bash
cd worker && npm start
```

### Watch Paths (Optional)
```
worker/**
src/lib/study-core/**
railway.toml
```

---

## Environment Variables

Navigate to: Railway Dashboard → Your Project → Worker Service → Variables

Add these variables with your actual values:

```bash
WORKER_SECRET=your_worker_secret_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
ZYTE_API_KEY=your_zyte_api_key_here
```

**DO NOT SET:**
- `PORT` - Railway sets this automatically
- `NODE_ENV` - Railway sets this automatically

---

## Verification

After deploying, check build logs for:

### Build Phase - Should See:
```
✓ Build context validated: ../src/lib/study-core/ found
  dist/index.js  42.3kb
⚡ Done in 40ms
```

### Deploy Phase - Should See:
```
[WORKER] ===== MC Export Worker Service Started =====
[WORKER] Node version: v22.x.x
[WORKER] Listening on 0.0.0.0:8080
[WORKER] Environment check: {
  hasWorkerSecret: true,
  hasSupabaseUrl: true,
  hasSupabaseKey: true,
  hasZyteKey: true
}
```

### Health Check:
```bash
curl https://your-worker-url.railway.app/
# Should return: "MC Export Worker - Health OK"
```

---

## If Build Still Fails

### Check Root Directory
- Must be `/` or blank
- NOT `worker/`
- NOT `./worker`

### Check Build Command
- Exact: `cd worker && npm ci && npm run build`
- NOT: `npm ci && npm run build`
- NOT: `cd worker; npm ci; npm run build`

### Check Builder
- Preferred: **Nixpacks**
- Also works: **Railpack** (with manual commands above)

### Build Logs Should NOT Show:
```
❌ Could not resolve "../src/lib/study-core/index"
❌ BUILD CONTEXT ERROR
```

If you see these errors, Root Directory is wrong.

---

## Complete Guide

For detailed troubleshooting, validation steps, and architecture:

📖 **See: [RAILWAY_MONOREPO_CONFIG.md](./RAILWAY_MONOREPO_CONFIG.md)**
