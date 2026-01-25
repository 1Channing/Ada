# UI Popup Timing Fix - "Run completed!" appearing 5 minutes late

## Root Cause

**Race condition in Realtime subscription setup**

The remote study runner (`src/services/remoteStudyRunner.ts`) subscribes to database changes AFTER triggering the worker execution. If the worker completes quickly (10-20 seconds), it writes results to the database BEFORE the frontend's Realtime subscription becomes active. The frontend then never receives the INSERT event and waits until the 5-minute timeout expires.

**Timeline of the bug:**
1. Frontend triggers Edge Function (immediate)
2. Worker starts processing (takes ~10-20s per study)
3. Frontend subscribes to Realtime (takes a few seconds to become active)
4. Worker completes and inserts result to DB (before subscription is active)
5. Realtime subscription misses the event
6. Frontend waits 5 minutes until timeout
7. Popup finally shows after timeout

## Solution

**Added polling fallback with 2-second intervals**

Instead of relying solely on Realtime (which has race conditions), the frontend now:
1. Polls the database every 2 seconds to check for results
2. Continues listening to Realtime as a fast path
3. Whichever detects completion first triggers the popup

This ensures completion is detected within 2-4 seconds instead of 5 minutes.

## Files Changed

### 1. `src/services/remoteStudyRunner.ts`

**Added constants:**
```typescript
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds as fallback
const POLL_MAX_ATTEMPTS = 150; // 150 attempts × 2s = 5 minutes max
```

**Added polling function:**
- Checks `study_run_results` table every 2 seconds
- Returns result immediately when found
- Logs whether completion was detected via polling or Realtime
- Stops after 5 minutes (same as before)

**Added timing logs:**
- Logs when waiting starts
- Logs elapsed time when result is detected
- Shows whether detection was via polling or Realtime

### 2. `src/pages/StudiesV2RunSearches.tsx`

**Added debug logs:**
- `[BATCH_RUN] 🚀 Run started at...` - When run begins
- `[BATCH_RUN] ⏱️ Run completed after Xs` - When all studies finish
- `[BATCH_RUN] ✅ Database updated after Xs` - After status update
- `[BATCH_RUN] 🔔 Showing COMPLETED popup after Xs total` - When popup appears

These logs track the complete flow to confirm the fix works.

## Expected Behavior After Fix

**Before:**
- Run finishes in database → 5 minutes pass → Popup shows

**After:**
- Run finishes in database → 2-4 seconds pass → Popup shows

The polling catches completion quickly, showing the popup within seconds instead of minutes.

## Debug Console Output

You'll now see logs like:
```
[BATCH_RUN] 🚀 Run started at 2024-01-25T...
[REMOTE_RUNNER] 🚀 Starting: waiting for results...
[REMOTE_RUNNER] ✅ Result detected via polling after 12.3s
[BATCH_RUN] ⏱️ Run completed after 125.4s
[BATCH_RUN] ✅ Database updated after 0.2s
[BATCH_RUN] 🔔 Showing COMPLETED popup after 125.6s total
```

This confirms:
1. When the run started
2. How long each study took (detected via polling)
3. When all studies finished
4. When the popup appeared

## No Business Logic Changes

- Scraping logic: **unchanged**
- Filtering logic: **unchanged**
- Median calculation: **unchanged**
- Database schema: **unchanged**
- Worker behavior: **unchanged**

Only UI timing detection improved via polling fallback.
