# Railway Monorepo Configuration Guide

**Status:** 🔧 REQUIRES MANUAL RAILWAY DASHBOARD CONFIGURATION
**Date:** 2026-01-11
**Critical:** Production deployment blocked until Railway service settings are updated

---

## Problem: Build Context Misconfiguration

### Symptoms

Railway build fails with:
```
[ERROR] Could not resolve "../src/lib/study-core/index"
scraper.ts:27
```

Build logs show:
- Runs `npm ci` then `npm run build` directly (no `cd worker`)
- Package name: `mc-export-worker@1.0.0` (worker package)
- Uses **Railpack** builder (auto-generated plan)
- `railway.toml` is ignored

### Root Cause Analysis

**Railway service "Root Directory" is set to `worker/`**

This causes:
1. **Build context = `worker/` only**
   - Railway container sees `worker/` as the root `/`
   - Parent directory (`../`) does not contain `src/`
   - Import path `../src/lib/study-core/index` fails

2. **`railway.toml` is ignored**
   - Config file is at repo root: `/railway.toml`
   - From Railway's perspective: `../railway.toml` (outside container)
   - Railway cannot read files outside build context

3. **Railpack auto-generation**
   - Railway finds `package.json` in root (actually `worker/package.json`)
   - Auto-generates `railpack-plan.json`
   - Ignores custom build commands

### Verification: Why `railway.toml` Was Ignored

```
Repository Structure:
/repo/root/
├── railway.toml          ← Config file location
├── src/lib/study-core/   ← Shared code
└── worker/               ← Railway "Root Directory" setting
    ├── package.json
    ├── index.ts
    └── scraper.ts

Railway Build Context (with Root Directory = worker/):
/                         ← Build container root
├── package.json          (actually worker/package.json)
├── index.ts
└── scraper.ts
    └── imports "../src/lib/study-core/index"  ✗ FAILS

Where is railway.toml? ../railway.toml (outside container, inaccessible)
Where is src/? ../src/ (outside container, inaccessible)
```

---

## Solution: Configure Railway Service Settings

### Step 1: Update Railway Service Settings

**CRITICAL: You MUST manually update these in the Railway Dashboard**

1. **Navigate to Railway Dashboard:**
   - Go to https://railway.app
   - Select your project
   - Select the worker service

2. **Update Service Settings:**

   **Root Directory:**
   ```
   /
   ```
   (Or leave **completely blank** - do NOT use `worker/`)

   **Build Command:**
   ```bash
   cd worker && npm ci && npm run build
   ```

   **Start Command:**
   ```bash
   cd worker && npm start
   ```

3. **Builder Configuration:**
   - Preferred: **Nixpacks** (respects `railway.toml`)
   - If using **Railpack**: Manual commands (above) override auto-generated plan

4. **Save and Redeploy**

### Step 2: Verify Configuration

After updating, Railway should:

✅ Build from repository root (not `worker/`)
✅ Detect and use `railway.toml` (if Nixpacks)
✅ Execute: `cd worker && npm ci && npm run build`
✅ Start with: `cd worker && npm start`

Check build logs for:
```
✓ Build context validated: ../src/lib/study-core/ found
  dist/index.js  42.3kb
⚡ Done in 40ms
```

---

## Safeguards Implemented

### 1. Build Context Validation

**File: `worker/check-build-context.js`**

Runs automatically before every build via `prebuild` script.

**What it does:**
- Checks for existence of `../src/lib/study-core/index.ts`
- If missing, fails build with clear error message
- Provides Railway configuration instructions

**Test locally:**
```bash
# From repo root (SHOULD PASS)
npm run build:worker

# From worker/ only (SHOULD FAIL)
cd /tmp/test && cp -r worker . && cd worker && npm install && npm run build
```

### 2. Standardized Build Scripts

**File: `package.json` (repository root)**

Added scripts for consistency:
```json
{
  "scripts": {
    "build:worker": "cd worker && npm ci && npm run build",
    "start:worker": "cd worker && npm start"
  }
}
```

**Usage:**
```bash
# Build worker (mimics Railway)
npm run build:worker

# Start worker (mimics Railway)
npm run start:worker
```

These scripts:
- Document the correct build process
- Provide local testing that mirrors Railway
- Can be used in CI/CD pipelines

---

## Railway Configuration Files

### `railway.toml` (Repository Root)

```toml
[build]
builder = "nixpacks"
buildCommand = "cd worker && npm ci && npm run build"

[deploy]
startCommand = "cd worker && npm start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
```

**Requirements:**
- File must be at repository root
- Railway "Root Directory" must be `/` or blank
- Builder should be Nixpacks (Railpack may ignore this file)

**When it's used:**
- Automatically detected by Nixpacks builder
- Overrides default detection behavior
- Provides restart policy configuration

### Alternative: Manual Commands (Works with Railpack)

If Railway continues using Railpack, the manual Build/Start commands in the dashboard settings will override the auto-generated plan.

---

## Local Testing: Simulate Railway

### Test 1: Build from Repo Root (Correct)

```bash
cd /path/to/repo
npm run build:worker
```

**Expected output:**
```
✓ Build context validated: ../src/lib/study-core/ found
  dist/index.js  42.3kb
⚡ Done in 40ms
```

### Test 2: Build from worker/ Only (Incorrect)

```bash
# Simulate Railway's wrong configuration
mkdir /tmp/railway-test
cp -r worker /tmp/railway-test/
cd /tmp/railway-test/worker
npm install
npm run build
```

**Expected output:**
```
❌ BUILD CONTEXT ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cannot find: ../src/lib/study-core/index.ts

🔧 RAILWAY CONFIGURATION REQUIRED:
[... configuration instructions ...]
```

This safeguard ensures Railway will show a clear error if misconfigured.

---

## Other Potential Railway Issues

After fixing the build context, check for these issues:

### Issue 1: Node Version Mismatch

**Symptom:** Runtime errors, ESM import failures

**Check:**
```bash
# In Railway logs
[WORKER] Node version: v22.x.x

# In worker/package.json
"build": "... --target=node18 ..."
```

**Solution:**
Update esbuild target to match Railway's Node version:
```json
{
  "scripts": {
    "build": "esbuild index.ts --bundle --platform=node --target=node22 --format=esm ..."
  }
}
```

Or set Railway Node version:
```toml
# railway.toml
[build]
nixpacksVersion = "1.xx.x"
nixpkgs = "node_22"
```

### Issue 2: Missing Environment Variables

**Required Environment Variables:**
- `WORKER_SECRET` - Authentication token for API endpoints
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (not anon key)
- `ZYTE_API_KEY` - Zyte scraping service key
- `PORT` - Auto-set by Railway (do not override)

**Validation:**

Add health check logging:
```javascript
console.log('[WORKER] Environment check:', {
  hasWorkerSecret: !!process.env.WORKER_SECRET,
  hasSupabaseUrl: !!process.env.SUPABASE_URL,
  hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  hasZyteKey: !!process.env.ZYTE_API_KEY,
  port: process.env.PORT
});
```

**Set in Railway Dashboard:**
- Navigate to service → Variables
- Add each variable with correct values
- Redeploy after adding variables

### Issue 3: ESM/CommonJS External Dependencies

**Symptom:**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module not supported
```

**Current externals:**
```
--external:@supabase/supabase-js
--external:express
--external:cors
```

**Validation:**

Check that externals are actually installed:
```bash
# In Railway build logs
npm ci
+ @supabase/supabase-js@2.57.4
+ express@4.18.2
+ cors@2.8.5
```

**Solution if issues:**
- Remove problematic package from `--external` list
- Bundle it instead (increases bundle size but ensures compatibility)

### Issue 4: Port Binding

**Railway provides `PORT` environment variable**

Ensure worker binds to Railway's port:
```javascript
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WORKER] Listening on 0.0.0.0:${PORT}`);
});
```

**Check logs:**
```
[WORKER] Listening on 0.0.0.0:3001     ← Local
[WORKER] Listening on 0.0.0.0:8080     ← Railway (varies)
```

### Issue 5: Memory Limits

**Worker performs scraping and parsing:**
- HTML parsing
- Data processing
- Multiple concurrent requests

**Check Railway plan limits:**
- Hobby: 512 MB RAM
- Pro: 8 GB RAM

**Monitor in logs:**
```
[WORKER] Processing study_id: abc123
[WORKER] Scraped 25 listings, parsed 25, filtered to 18
```

If OOM errors occur, upgrade Railway plan or optimize:
- Process smaller batches
- Add pagination limits
- Implement memory profiling

---

## Validation Checklist

After Railway configuration update:

### Build Phase
- [ ] Build logs show: `✓ Build context validated`
- [ ] Build succeeds: `dist/index.js 42.3kb`
- [ ] No import resolution errors
- [ ] Build time < 2 minutes

### Deploy Phase
- [ ] Start command executes: `cd worker && npm start`
- [ ] Worker starts: `[WORKER] ===== MC Export Worker Service Started =====`
- [ ] Port binding: `Listening on 0.0.0.0:[PORT]`
- [ ] Environment variables logged (without exposing secrets)

### Runtime Phase
- [ ] Health check responds: `GET / → 200 OK`
- [ ] Scraping endpoint works: `POST /scrape-search-page`
- [ ] Supabase connection succeeds
- [ ] Zyte API calls succeed
- [ ] No import/module errors in logs

### Functional Testing
- [ ] Create scheduled study run in frontend
- [ ] Worker receives job from `run_scheduled_studies` edge function
- [ ] Worker scrapes listings
- [ ] Worker saves results to database
- [ ] Frontend shows updated results

---

## Architecture: Build Context Flow

### Before (Broken)

```
Railway Build Context:
/                              ← worker/ is treated as root
├── package.json
├── index.ts
├── scraper.ts                 (imports "../src/...")
└── dist/

Accessible: Only worker/ contents
Missing: ../src/, ../railway.toml
Result: Build fails ✗
```

### After (Fixed)

```
Railway Build Context:
/                              ← Repository root
├── railway.toml               ✓ Detected
├── src/lib/study-core/        ✓ Accessible
└── worker/
    ├── package.json
    ├── index.ts
    ├── scraper.ts             (imports "../src/...")
    └── dist/

Command: cd worker && npm ci && npm run build
Result: Build succeeds ✓
```

---

## Summary

### What Changed

| File | Change | Purpose |
|------|--------|---------|
| `railway.toml` | Created | Define build/start commands |
| `package.json` (root) | Added `build:worker`, `start:worker` | Standardize scripts |
| `worker/package.json` | Added `prebuild` script | Validate build context |
| `worker/check-build-context.js` | Created | Fail fast if misconfigured |

### What YOU Must Do

**IN RAILWAY DASHBOARD:**

1. **Set Root Directory to `/` (or blank)**
2. **Set Build Command: `cd worker && npm ci && npm run build`**
3. **Set Start Command: `cd worker && npm start`**
4. **Ensure environment variables are set**
5. **Redeploy**

### Why This Works

- Railway builds from repo root → `src/` is accessible
- Build command navigates to `worker/` → npm install works
- esbuild resolves `../src/lib/study-core/` → path is valid
- Bundle includes all shared code → 42KB self-contained file
- Start command runs bundled worker → zero external dependencies

### Zero Code Duplication

- **Single source:** `src/lib/study-core/` (canonical)
- **Frontend imports:** `import { ... } from '@/lib/study-core'`
- **Worker imports:** `import { ... } from '../src/lib/study-core'`
- **Bundle output:** All code included in `dist/index.js`
- **No drift:** Changes automatically propagate to both frontend and worker

---

## Support

If Railway deployment still fails after following this guide:

1. **Check build logs** for the exact error
2. **Verify Root Directory** is set to `/` or blank
3. **Confirm commands** match exactly (including `cd worker &&`)
4. **Check environment variables** are set in Railway dashboard
5. **Run local test:** `npm run build:worker` (must succeed from repo root)

The build context validation will catch configuration issues early and provide clear error messages.
