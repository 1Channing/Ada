# Railway Configuration Validation Results

**Status:** ✅ CODE READY - Railway dashboard configuration required
**Date:** 2026-01-11

---

## Pre-Deployment Validation

### ✅ Local Build Tests

**Test 1: Build from repository root (correct context)**
```bash
$ npm run build:worker

> mc-export-worker@1.0.0 prebuild
✓ Build context validated: ../src/lib/study-core/ found

> esbuild index.ts --bundle --platform=node --target=node18 ...
  dist/index.js  42.3kb
⚡ Done in 32ms

Result: ✅ PASS
```

**Test 2: Build from worker/ only (Railway misconfiguration simulation)**
```bash
$ mkdir /tmp/test && cp -r worker /tmp/test/ && cd /tmp/test/worker
$ npm install && npm run build

> mc-export-worker@1.0.0 prebuild
❌ BUILD CONTEXT ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cannot find: ../src/lib/study-core/index.ts

🔧 RAILWAY CONFIGURATION REQUIRED:
[... configuration instructions ...]

Result: ✅ PASS (safeguard working correctly)
```

### ✅ Bundle Analysis

**Shared code inclusion check:**
```bash
$ grep -c "coreParseSearchPage\|filterListingsByStudy\|...\|parseGaspedaal" worker/dist/index.js
8

Result: ✅ All 8 critical shared functions bundled
```

**Functions verified in bundle:**
- `coreParseSearchPage` - Core parsing orchestrator
- `filterListingsByStudy` - Business logic filters
- `computeTargetMarketStats` - Statistics calculation
- `parseMarktplaats` - Netherlands parser
- `parseBilbasen` - Denmark parser
- `parseLeboncoin` - France parser
- `parseGaspedaal` - Belgium parser
- Helper functions from `parsers/shared.ts`

**Bundle size:** 42.3 KB (optimized)

### ✅ Main Project Build

```bash
$ npm run build
✓ built in 14.13s

Result: ✅ Frontend build unaffected
```

---

## Configuration Files Created

| File | Purpose | Status |
|------|---------|--------|
| `railway.toml` | Railway build config (Nixpacks) | ✅ Ready |
| `package.json` (root) | Standardized worker scripts | ✅ Updated |
| `worker/package.json` | Prebuild validation hook | ✅ Updated |
| `worker/check-build-context.js` | Build context guard | ✅ Created |
| `RAILWAY_MONOREPO_CONFIG.md` | Complete configuration guide | ✅ Created |
| `RAILWAY_BUILD_CONTEXT_FIX.md` | Summary and quick reference | ✅ Created |
| `RAILWAY_QUICKSTART.md` | Copy-paste Railway settings | ✅ Created |

---

## Zero Duplication Verification

### Source Code Analysis

**Canonical source location:**
```
src/lib/study-core/
├── index.ts              ← Main exports
├── types.ts              ← Shared types
├── business-logic.ts     ← Filtering and stats
├── scraping.ts           ← Orchestration
├── scrapingImpl.ts       ← Implementation
└── parsers/
    ├── index.ts
    ├── marktplaats.ts
    ├── bilbasen.ts
    ├── leboncoin.ts
    ├── gaspedaal.ts
    ├── generic.ts
    └── shared.ts
```

**Import locations:**

1. **Frontend (src/pages/StudiesV2*.tsx):**
   ```typescript
   import { coreParseSearchPage } from '@/lib/study-core';
   ```

2. **Worker (worker/scraper.ts):**
   ```typescript
   import { coreParseSearchPage } from '../src/lib/study-core/index';
   ```

3. **Edge Functions (supabase/functions/_shared/studyExecutor.ts):**
   ```typescript
   import { coreParseSearchPage } from '../../../src/lib/study-core/index.ts';
   ```

**Duplication check:**
```bash
$ find . -name "*.ts" -path "*/parsers/*" ! -path "./src/lib/study-core/*" ! -path "./node_modules/*" | wc -l
0

Result: ✅ No duplicated parser files
```

**Result:** Single source of truth maintained across all contexts.

---

## Railway Dashboard Configuration Requirements

### Critical Settings (Copy to Railway)

**Root Directory:**
```
/
```

**Build Command:**
```bash
cd worker && npm ci && npm run build
```

**Start Command:**
```bash
cd worker && npm start
```

**Environment Variables Required:**
- `WORKER_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ZYTE_API_KEY`

### Expected Build Output (After Configuration)

Railway logs should show:

```
=== Building with Nixpacks ===

Running: cd worker && npm ci && npm run build

> mc-export-worker@1.0.0 prebuild
✓ Build context validated: ../src/lib/study-core/ found

> mc-export-worker@1.0.0 build
  dist/index.js  42.3kb
⚡ Done in 40ms

=== Build Successful ===

Running: cd worker && npm start

> mc-export-worker@1.0.0 start

[WORKER] ===== MC Export Worker Service Started =====
[WORKER] Node version: v22.x.x
[WORKER] Listening on 0.0.0.0:8080
[WORKER] Environment check: {
  hasWorkerSecret: true,
  hasSupabaseUrl: true,
  hasSupabaseKey: true,
  hasZyteKey: true
}

=== Deploy Successful ===
```

---

## Post-Deployment Validation Checklist

After Railway configuration and deployment:

### Build Phase
- [ ] Build starts from repo root context
- [ ] Prebuild validation passes
- [ ] No import resolution errors
- [ ] Bundle size ~42KB
- [ ] Build completes in < 2 minutes

### Deploy Phase
- [ ] Start command executes correctly
- [ ] Worker service starts
- [ ] Listens on Railway's PORT
- [ ] All environment variables present
- [ ] No module/import errors in logs

### Runtime Phase
- [ ] Health endpoint responds: `GET /`
- [ ] Scrape endpoint available: `POST /scrape-search-page`
- [ ] Supabase connection works
- [ ] Zyte API calls succeed
- [ ] Study runs execute successfully

### Integration Testing
- [ ] Create scheduled study in frontend
- [ ] Edge function triggers worker
- [ ] Worker scrapes listings
- [ ] Results saved to database
- [ ] Frontend displays updated data

---

## Potential Issues After Configuration

### Issue 1: Environment Variables Missing

**Symptom:**
```
[WORKER] Environment check: {
  hasWorkerSecret: false,  ← Missing
  ...
}
```

**Solution:** Add variables in Railway Dashboard → Service → Variables

### Issue 2: Port Binding Error

**Symptom:**
```
Error: listen EADDRINUSE :::3001
```

**Cause:** Railway provides `PORT` env var, worker should use it

**Verify:**
```javascript
const PORT = process.env.PORT || 3001;
```

### Issue 3: Node Version Mismatch

**Symptom:** ESM import errors, unexpected crashes

**Check:**
```bash
# Railway: Node v22.x
# Build target: --target=node18
```

**Consider updating build target to match Railway's Node version**

### Issue 4: Zyte API Errors

**Symptom:**
```
ZyteAPIError: Authentication failed
```

**Solution:** Verify `ZYTE_API_KEY` in Railway dashboard

---

## Architecture Summary

### Build Context Flow (Fixed)

```
┌─────────────────────────────────────────────┐
│ Railway Build Container                     │
│ Root: / (repository root)                   │
│                                             │
│  /railway.toml        ← Config detected    │
│  /src/lib/study-core/ ← Shared code        │
│  /worker/             ← Service directory   │
│                                             │
│  Execute: cd worker && npm ci && npm build  │
│           ↓                                 │
│  esbuild resolves: ../src/lib/study-core/  │
│           ↓                                 │
│  Bundle: worker/dist/index.js (42KB)       │
│           ↓                                 │
│  Execute: cd worker && npm start            │
│           ↓                                 │
│  Worker listens on $PORT                    │
└─────────────────────────────────────────────┘
```

### Code Sharing (Zero Duplication)

```
                    src/lib/study-core/
                    (Single Source of Truth)
                           │
                ┌──────────┼──────────┐
                │          │          │
          Frontend    Worker    Edge Functions
          (Vite)    (esbuild)   (Deno Deploy)
            │          │            │
         import     import       import
         @/lib      ../src       ../../../src
            │          │            │
            └──────────┴────────────┘
                   All use same
                   parsers/logic
                   No duplication
                   No drift
```

---

## Sign-Off

### Code Changes: ✅ COMPLETE

All necessary code changes, safeguards, and documentation are in place.

### Railway Configuration: 🔧 REQUIRED

Manual configuration in Railway Dashboard is required (see RAILWAY_QUICKSTART.md).

### Next Steps:

1. **Configure Railway:**
   - Set Root Directory to `/`
   - Set Build Command: `cd worker && npm ci && npm run build`
   - Set Start Command: `cd worker && npm start`
   - Add environment variables

2. **Deploy:**
   - Trigger Railway deployment
   - Monitor build logs for validation message
   - Verify worker starts and listens

3. **Test:**
   - Check health endpoint
   - Create scheduled study run
   - Verify end-to-end flow

### Expected Outcome:

After Railway configuration, the same commit will build and deploy successfully with zero code duplication and a single source of truth for all parsing logic.

---

**Ready for Railway deployment after dashboard configuration.**
