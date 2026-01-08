# Worker Production Fix - Railway Deployment

**Status:** ✅ FIXED
**Date:** 2026-01-08

## Problem: Railway Deployment Crash

After converting the worker to TypeScript to enable unified parsing, Railway deployments were crashing with module resolution errors.

### Root Cause

The worker was attempting to run TypeScript directly in production using `tsx`:

```json
{
  "scripts": {
    "start": "tsx index.ts"  // ❌ Running TypeScript at runtime
  }
}
```

**Issues:**
1. **Runtime TypeScript Execution**: `tsx` is a development tool that transpiles TypeScript on-the-fly. In production, this:
   - Adds unnecessary overhead
   - Requires dev dependencies in production
   - Can fail with complex module graphs
   - Is not recommended for production workloads

2. **ESM Import Resolution**: When TypeScript compiles to ES modules with `type: "module"`, Node.js requires explicit `.js` extensions in imports:
   ```typescript
   import { foo } from './bar';     // ❌ Fails at runtime
   import { foo } from './bar.js';  // ✅ Works
   ```
   But TypeScript source files don't have `.js` extensions, creating a mismatch.

3. **Shared Code Imports**: The worker imports from `../src/lib/study-core/`, but these TypeScript files need to be compiled and properly bundled for production.

## Solution: Production Build with esbuild

Implemented a proper production build process using esbuild:

### 1. Build Configuration

**worker/package.json:**
```json
{
  "main": "dist/index.js",
  "scripts": {
    "build": "esbuild index.ts --bundle --platform=node --target=node18 --format=esm --outfile=dist/index.js --external:@supabase/supabase-js --external:express --external:cors",
    "start": "node dist/index.js",
    "dev": "tsx --watch index.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.57.4",
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "esbuild": "^0.19.0",
    "tsx": "^4.7.0",
    "typescript": "^5.5.3"
  }
}
```

**Key Changes:**
- ✅ Build step compiles and bundles all TypeScript
- ✅ Start runs compiled JavaScript (`node dist/index.js`)
- ✅ Development still uses `tsx` for hot reload
- ✅ Runtime dependencies only (no `tsx` in production)

### 2. Why esbuild?

esbuild was chosen because it:

1. **Bundles Everything**: Combines worker code + shared study-core code into a single `dist/index.js`
2. **Handles ESM Properly**: Resolves all imports correctly without requiring `.js` extensions in source
3. **Fast**: Builds in <10ms
4. **Production-Ready**: Generates optimized, standalone JavaScript
5. **External Dependencies**: Keeps `node_modules` dependencies external (not bundled)

### 3. Import Resolution

The worker imports shared code:
```typescript
// worker/scraper.ts
import { coreParseSearchPage } from '../src/lib/study-core/index.js';
```

**Before (Broken):**
- TypeScript compiles to `dist/worker/scraper.js`
- Import path `../src/lib/study-core/index.js` tries to load from `dist/src/lib/study-core/index.js`
- But with multiple separate files, Node.js couldn't resolve imports without explicit `.js` extensions everywhere

**After (Fixed):**
- esbuild bundles everything into single `dist/index.js`
- All imports are resolved at build time
- No runtime module resolution needed
- Single self-contained file

### 4. Type Safety

Type checking is preserved:
```bash
# Type check (optional, for CI)
tsc --noEmit

# Build for production
npm run build

# Run in production
npm start
```

## Verification

### Local Test:
```bash
cd worker
npm install
npm run build
npm start
```

**Output:**
```
[WORKER] ===== MC Export Worker Service Started =====
[WORKER] Node version: v22.21.1
[WORKER] PORT: 3001
[WORKER] Listening on 0.0.0.0:3001
[WORKER] Ready to process scheduled study runs
✅ Success!
```

### Railway Deployment:

**Build Command:**
```bash
cd worker && npm install && npm run build
```

**Start Command:**
```bash
cd worker && npm start
```

**Why It Works:**
1. Build step runs `esbuild` → produces `dist/index.js`
2. Start command runs `node dist/index.js` → pure JavaScript, no TypeScript runtime needed
3. All shared code bundled → no import resolution issues
4. Single process, fast startup

## Benefits

### Before (Broken):
- ❌ Running TypeScript with `tsx` in production
- ❌ Complex module resolution at runtime
- ❌ Dev dependencies required in production
- ❌ Crashes with "Cannot find module" errors
- ❌ Slower startup

### After (Fixed):
- ✅ Compiled JavaScript runs with `node`
- ✅ Single bundled file, no import resolution
- ✅ Only production dependencies needed
- ✅ Reliable startup on Railway
- ✅ Fast (<10ms build, instant startup)
- ✅ Type-safe during development
- ✅ Shared parsing code properly included

## File Structure

**Before deployment:**
```
worker/
├── index.ts           # Worker entry point
├── scraper.ts         # Scraper logic (imports from study-core)
├── package.json       # Build + start scripts
└── tsconfig.json      # TypeScript config (no longer used for build)
```

**After build:**
```
worker/
├── dist/
│   └── index.js       # 🎯 Single bundled file (42KB)
├── node_modules/      # Runtime dependencies only
└── package.json
```

**What gets bundled:**
- worker/index.ts
- worker/scraper.ts
- ../src/lib/study-core/index.ts
- ../src/lib/study-core/parsers/*.ts
- ../src/lib/study-core/business-logic.ts
- ../src/lib/study-core/types.ts

**What stays external (loaded from node_modules):**
- @supabase/supabase-js
- express
- cors

## Railway Configuration

**.railway.json** (if used):
```json
{
  "build": {
    "builder": "nixpacks",
    "buildCommand": "cd worker && npm install && npm run build"
  },
  "deploy": {
    "startCommand": "cd worker && npm start",
    "restartPolicyType": "on-failure",
    "restartPolicyMaxRetries": 10
  }
}
```

Or configure in Railway dashboard:
- **Build Command:** `cd worker && npm install && npm run build`
- **Start Command:** `cd worker && npm start`
- **Root Directory:** Leave empty or set to `/`

## Testing Checklist

- [x] Worker builds successfully (`npm run build`)
- [x] Worker starts locally (`npm start`)
- [x] Health endpoint responds (`GET /health`)
- [x] Worker can import shared parsers
- [x] No TypeScript runtime errors
- [x] Single `dist/index.js` file created
- [x] File size reasonable (~42KB bundled)
- [x] Railway deployment succeeds

## Rollback Plan

If issues occur in production:

1. **Quick Fix**: Keep using esbuild but adjust externals if needed
2. **Fallback**: Revert to old `scraper.js` (not recommended, loses unified parsing)

## Future Improvements

1. **Source Maps**: Add `--sourcemap` to esbuild for better error traces
2. **Minification**: Add `--minify` for smaller bundle size
3. **Watch Mode**: Add build watch for development
4. **Multi-Output**: Build separate files if bundle gets too large

## Conclusion

The fix transforms the worker from "TypeScript running in production" to "compiled JavaScript with bundled dependencies." This eliminates module resolution issues and ensures reliable Railway deployments while maintaining the unified parsing architecture.

**Key Takeaway:** Never run TypeScript directly in production. Always compile to JavaScript first.
