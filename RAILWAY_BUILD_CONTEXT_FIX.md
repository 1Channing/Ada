# Railway Build Context Fix

**Status:** ✅ FIXED
**Date:** 2026-01-11
**Critical:** Production blocking issue

## Problem: Railway Build Failure

Railway deployment was failing with:
```
[ERROR] Could not resolve "../src/lib/study-core/index"
scraper.ts:27
```

### Root Cause

**Railway's default behavior** when deploying from a subdirectory:
- Sets `worker/` as the root directory in the build container
- This means the parent directory structure (`../src/`) doesn't exist
- Any imports like `../src/lib/study-core/index` fail at build time

**Why local builds worked:**
- Local: Build runs from repo root → `cd worker && npm run build`
- Railway (before fix): Build runs FROM worker/ as root → `npm run build`

**Verification:**
```bash
# Simulate Railway's build context (FAILS)
$ mkdir /tmp/test && cp -r worker /tmp/test/
$ cd /tmp/test/worker && npm install && npm run build
✘ [ERROR] Could not resolve "../src/lib/study-core/index"

# Simulate correct build context (WORKS)
$ cd /repo/root && cd worker && npm run build
✓ dist/index.js  42.3kb
```

## Solution: Force Build from Repository Root

Created `railway.toml` configuration file to explicitly set the build context:

### Configuration File: `railway.toml`

```toml
[build]
builder = "nixpacks"
buildCommand = "cd worker && npm ci && npm run build"

[deploy]
startCommand = "cd worker && npm start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
```

### Why This Works

1. **Repository Root as Build Context:**
   - Railway now builds from the repository root (not `worker/`)
   - The directory structure includes both `worker/` AND `src/`

2. **Build Command Execution:**
   ```bash
   cd worker && npm ci && npm run build
   ```
   - Changes to `worker/` directory
   - Installs dependencies with `npm ci` (faster, deterministic)
   - Runs esbuild from `worker/` context
   - esbuild resolves `../src/lib/study-core/index` relative to `worker/scraper.ts`
   - Path resolves to: `src/lib/study-core/index.ts` ✓

3. **Start Command Execution:**
   ```bash
   cd worker && npm start
   ```
   - Changes to `worker/` directory
   - Runs `node dist/index.js` (pre-bundled, all deps included)

### File Structure Context

```
/repo/root/                    ← Railway builds from here
├── railway.toml               ← Configuration file
├── src/
│   └── lib/
│       └── study-core/        ← Shared source code
│           ├── index.ts
│           ├── parsers/
│           └── business-logic.ts
└── worker/                    ← Commands execute FROM here
    ├── package.json
    ├── index.ts               (imports from ./scraper)
    ├── scraper.ts             (imports from ../src/lib/study-core)
    └── dist/
        └── index.js           ← Bundled output (includes study-core)
```

## Verification Steps

### 1. Build from Repo Root (Simulating Railway)
```bash
$ cd /repo/root
$ cd worker && npm ci && npm run build

✓ dist/index.js  42.3kb
⚡ Done in 45ms
```

### 2. Verify Bundle Contains Shared Code
```bash
$ grep "coreParseSearchPage\|filterListingsByStudy" worker/dist/index.js
filterListingsByStudy      ✓
computeTargetMarketStats   ✓
coreParseSearchPage        ✓
```

### 3. Verify Start Command
```bash
$ cd worker && npm start

[WORKER] ===== MC Export Worker Service Started =====
[WORKER] Listening on 0.0.0.0:3001
✓ Worker starts successfully
```

## Railway Deployment Configuration

**In Railway Dashboard:**

1. **Service Settings:**
   - Root Directory: `/` (repo root) or leave empty
   - The `railway.toml` file handles the rest automatically

2. **Environment Variables:**
   - `WORKER_SECRET` - Authentication secret
   - `SUPABASE_URL` - Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
   - `ZYTE_API_KEY` - Zyte API key for scraping

3. **Build/Deploy:**
   - Railway automatically detects `railway.toml`
   - Uses custom build/start commands from config
   - No manual command overrides needed

## Key Benefits

✅ **Single Source of Truth:** No code duplication - worker imports directly from `src/lib/study-core/`
✅ **Zero Drift:** Shared parsing logic maintained in one location
✅ **Clean Bundling:** esbuild bundles everything into single 42KB file
✅ **Production Ready:** Restart policy handles failures automatically

## Alternative Approaches Considered (and Rejected)

### ❌ Option B: Copy study-core into worker/
**Why rejected:**
- Creates code duplication
- Introduces drift between frontend and worker
- Violates DRY principle
- Maintenance nightmare

### ❌ Option C: Symlinks
**Why rejected:**
- Railway build environments don't support symlinks
- Git doesn't handle symlinks well across platforms
- Fragile and error-prone

### ❌ Option D: Keep worker/ as root, copy files during build
**Why rejected:**
- Adds complexity to build process
- Temporary copy step prone to cache issues
- Still creates duplication (even if ephemeral)

## Troubleshooting

### If Railway Build Still Fails

1. **Verify railway.toml is committed:**
   ```bash
   $ git ls-files railway.toml
   railway.toml   ← Should be present
   ```

2. **Check Railway service settings:**
   - Root Directory should be `/` or empty
   - Do NOT set custom build/start commands in UI (use railway.toml)

3. **Check build logs for context:**
   ```
   Build context: /repo/root  ✓ (correct)
   Build context: /worker     ✗ (wrong - check config)
   ```

4. **Manual Railway CLI deployment:**
   ```bash
   $ railway up
   ```

## Related Documentation

- `WORKER_PRODUCTION_FIX.md` - Initial TypeScript build configuration
- `UNIFIED_PIPELINE_GUIDE.md` - Shared parsing architecture
- `worker/README.md` - Worker service documentation
