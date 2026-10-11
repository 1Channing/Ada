# Browser Execution Fix - fetchHtmlWithZyte Error

## Problem

**Error:** `ReferenceError: fetchHtmlWithZyte is not defined`

**Root Cause:** The frontend was importing `studyRunner.ts` at the top level, which in turn imported `scraperClient.ts` and its dependencies. This caused all scraping modules (including `study-core/scrapingImpl.ts` which contains `fetchHtmlWithZyte`) to be loaded and evaluated in the browser, even when using remote execution mode.

## The Issue with Static Imports

```typescript
// ❌ PROBLEMATIC CODE (static import at top level)
import { runStudyInBackground } from '../services/studyRunner';

// Even if we conditionally call it:
if (SCRAPER_MODE === 'local') {
  await runStudyInBackground(...);  // Never called in 'api' mode
}

// The problem: studyRunner.ts is ALREADY loaded and evaluated
// This loads scraperClient.ts → study-core → scrapingImpl.ts
// All code runs at module load time, causing the error
```

## Solution: Dynamic Imports

Dynamic imports load modules **on-demand** rather than at startup:

```typescript
// ✅ FIXED CODE (dynamic import when needed)
if (SCRAPER_MODE === 'api') {
  await runStudyRemotely(...);  // Always use remote in API mode
} else {
  // Only load studyRunner when actually needed
  const { runStudyInBackground } = await import('../services/studyRunner');
  await runStudyInBackground(...);
}
```

## Changes Made

### 1. Updated `src/pages/StudiesV2RunSearches.tsx`

**Before:**
```typescript
import { runStudyInBackground, type StudyV2 } from '../services/studyRunner';
// ↑ Static import - loads immediately
```

**After:**
```typescript
import { runStudyRemotely } from '../services/remoteStudyRunner';
// ↑ Only import remote runner statically

export interface StudyV2 { /* ... */ }
// ↑ Define type locally to avoid importing from studyRunner

// Dynamic import when needed:
if (SCRAPER_MODE === 'api') {
  result = await runStudyRemotely(...);
} else {
  const { runStudyInBackground } = await import('../services/studyRunner');
  // ↑ Loads only in local mode
  result = await runStudyInBackground(...);
}
```

### 2. Created `src/services/remoteStudyRunner.ts`

Self-contained remote execution module that:
- Has NO dependencies on `studyRunner.ts` or `scraperClient.ts`
- Only imports from `supabase` and type stores
- Creates scheduled jobs and polls for results
- Never touches browser scraping code

### 3. Added Execution Mode Indicator

UI now shows which mode is active:
- **Green badge:** "REMOTE (via Worker)" - Safe for production
- **Orange badge:** "LOCAL (browser)" - Development only

## How Dynamic Imports Work

### Module Loading

**Static Import (❌):**
```typescript
import { foo } from './module';
// Module loads IMMEDIATELY when parent loads
// All code at top-level runs right away
```

**Dynamic Import (✅):**
```typescript
const { foo } = await import('./module');
// Module loads ONLY when this line executes
// Can be conditional, async, and on-demand
```

### Code Splitting

Vite automatically creates separate chunks for dynamically imported modules:

```bash
dist/assets/studyRunner-BCjGP0iF.js   59.75 kB │ gzip:  18.13 kB
dist/assets/index-BFahuSLc.js        961.04 kB │ gzip: 281.81 kB
```

The `studyRunner` module is now in its own chunk, loaded only when needed.

## Environment Setup

### For Production (Remote Execution)

```bash
# .env
VITE_SCRAPER_MODE=api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret  # Must match Edge Function secret
```

**What happens:**
1. `studyRunner.ts` is NEVER loaded in browser
2. `scraperClient.ts` is NEVER loaded in browser
3. `fetchHtmlWithZyte` is NEVER referenced
4. All scraping happens on Worker

**Result:** ✅ No browser errors, secure execution

### For Development (Local Execution)

```bash
# .env
VITE_SCRAPER_MODE=local
VITE_ZYTE_API_KEY=your_zyte_key
```

**What happens:**
1. User clicks "Run Now"
2. Dynamic import loads `studyRunner.ts`
3. `scraperClient.ts` and dependencies load
4. Scraping executes in browser (for debugging)

**Note:** Requires CORS configuration for Zyte API

## Verification

### Check Build Output

```bash
npm run build
```

Look for separate chunk:
```
dist/assets/studyRunner-[hash].js  # Separate chunk for local execution
```

### Check Browser Console

**In API mode:**
```javascript
console.log(import.meta.env.VITE_SCRAPER_MODE);
// "api"

// studyRunner.ts is NOT loaded
// scraperClient.ts is NOT loaded
// No browser scraping modules present
```

**In Local mode:**
```javascript
console.log(import.meta.env.VITE_SCRAPER_MODE);
// "local"

// studyRunner.ts loads on-demand when study runs
// scraperClient.ts loads as dependency
// Browser scraping modules available
```

## Testing

### Test API Mode (Production)

1. Set `.env`:
   ```bash
   VITE_SCRAPER_MODE=api
   ```

2. Start dev server:
   ```bash
   npm run dev
   ```

3. Navigate to "Run Searches" page

4. Verify green badge shows "REMOTE (via Worker)"

5. Select a study and click "Run Now"

6. Check browser console - should see:
   ```
   [BATCH_RUN] Using scraper mode: api
   [REMOTE_RUNNER] Starting remote execution...
   ```

7. Verify NO errors about `fetchHtmlWithZyte`

### Test Local Mode (Development)

1. Set `.env`:
   ```bash
   VITE_SCRAPER_MODE=local
   VITE_ZYTE_API_KEY=your_key
   ```

2. Restart dev server

3. Navigate to "Run Searches" page

4. Verify orange badge shows "LOCAL (browser)"

5. Select a study and click "Run Now"

6. Check browser console - should see:
   ```
   [BATCH_RUN] Using scraper mode: local
   [SCRAPER] Using Zyte API...
   ```

7. Module loads dynamically only when needed

## Benefits

### 1. Zero Browser Overhead in Production
- API mode: ~60KB less JavaScript to download/parse
- Faster page load, lower memory usage
- No scraping code in browser at all

### 2. Security
- Zyte API key stays server-side
- No scraping logic exposed in browser
- Reduced attack surface

### 3. Proper Separation of Concerns
- Browser code: UI and API calls only
- Worker code: Heavy scraping and processing
- Clear boundaries, easier maintenance

### 4. Better Developer Experience
- Local mode available for debugging
- Dynamic imports prevent accidental browser execution
- Build system enforces separation via chunking

## Migration for Existing Deployments

1. **Update `.env` on Railway:**
   ```bash
   VITE_SCRAPER_MODE=api
   VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret
   ```

2. **Verify Edge Function secret matches:**
   - Go to Supabase Dashboard → Edge Functions → Settings
   - Check that `SCHEDULER_CRON_SECRET` is set
   - Frontend secret must match backend secret exactly

3. **Redeploy frontend:**
   ```bash
   git pull
   npm run build
   # Deploy via Railway
   ```

4. **No backend changes needed** - Worker already supports this

5. **Test end-to-end:**
   - Run instant study
   - Verify Worker logs show execution
   - Confirm results appear in UI

## Troubleshooting

### Still Getting "fetchHtmlWithZyte" Error

**Check:**
1. Environment variable is set: `echo $VITE_SCRAPER_MODE` should show `api`
2. Page was reloaded after changing `.env`
3. Build output shows separate `studyRunner` chunk
4. Browser DevTools → Network tab shows `studyRunner` chunk is NOT loaded

**Fix:**
```bash
# Clear build cache
rm -rf dist/ node_modules/.vite/

# Rebuild
npm run build

# Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
```

### Dynamic Import Fails to Load

**Error:** `Failed to fetch dynamically imported module`

**Cause:** Build/deployment issue

**Fix:**
1. Ensure all assets are deployed
2. Check base path in `vite.config.ts`
3. Verify CDN/hosting serves all chunks

### 401 Authentication Error

**Error:** `Invalid or missing SCHEDULER_CRON_SECRET`

**Cause:** Frontend secret doesn't match backend secret

**Fix:**
1. Check Supabase Edge Function environment variables:
   - Go to Supabase Dashboard → Edge Functions → Settings
   - Find `SCHEDULER_CRON_SECRET` value

2. Update your `.env` file:
   ```bash
   VITE_SCHEDULER_CRON_SECRET=<exact_value_from_edge_function>
   ```

3. Restart dev server:
   ```bash
   npm run dev
   ```

4. Verify console logs don't show 401 errors

**Note:** The secret must match exactly. No extra spaces, quotes, or characters.

### Edge Function Not Triggered

**Symptom:** Job stays in "pending" status

**Check:**
1. Supabase Edge Function deployed
2. `WORKER_URL` set in Edge Function env vars
3. Worker is running and healthy
4. `SCHEDULER_CRON_SECRET` matches between frontend and backend

**Fix:** See `REMOTE_EXECUTION_MODE.md` for full troubleshooting guide

## Related Documentation

- `REMOTE_EXECUTION_MODE.md` - Remote execution architecture
- `WORKER_DEPLOYMENT_GUIDE.md` - Worker setup and configuration
- `.env.example` - Environment variable reference

---

**Version:** 1.0.0
**Date:** 2026-01-16
**Status:** Production Ready
