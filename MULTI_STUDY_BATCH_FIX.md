# Multi-Study Batch Execution Fix

## Root Cause

**Problem**: When selecting multiple studies (e.g., 2 studies) and clicking "Run Now", the UI created N separate scheduled jobs (one per study), each triggering the worker independently. This resulted in:
- N separate runIds being created
- N separate POST requests to the worker
- Only the latest result being visible in the Results page

**Why this happened**:
1. `StudiesV2RunSearches.tsx` looped through each selected study (lines 312-398)
2. For each study, it called `runStudyRemotely()` which created a NEW scheduled job with `studyIds: [single_study_id]`
3. Each scheduled job had NO runId in the payload, so the worker created its own runId
4. Worker logs showed: `studyCount: 1`, `studyCount: 1` instead of `studyCount: 2`

## Solution

Created a **batch execution path** for API mode that:
1. Creates ONE scheduled job with ALL study IDs and the shared runId
2. Sends ONE request to the worker
3. Worker processes all studies under the same runId
4. UI polls for results and displays all rows

## Files Changed

### 1. `src/services/remoteStudyRunner.ts`

**Added**:
- `RemoteBatchParams` interface (lines 39-44)
- `runStudiesBatchRemotely()` function (lines 332-402)
  - Creates ONE scheduled job with all study IDs
  - Includes the runId in the payload
  - Triggers ONE worker execution
  - No Realtime wait (UI handles polling)

**Modified**:
- Added `runId` to single-study scheduled job payload (line 88)

### 2. `src/pages/StudiesV2RunSearches.tsx`

**Modified**:
- Import statement: added `runStudiesBatchRemotely` (line 4)
- Replaced the study loop (lines 312-484) with:
  - **If API mode**: Batch all studies into ONE worker request
    - Create ONE scheduled job
    - Poll database for results every 3s
    - Update counts and statuses as results arrive
  - **If local mode**: Sequential processing (unchanged behavior)
    - Loop through studies one-by-one
    - Use `runStudyInBackground()` for browser execution

## Expected Behavior After Fix

**Before (broken)**:
```
User selects: Yaris Cross 2023, Yaris Cross 2024
Worker logs:
  - Request A: studyCount=1, runId=abc123
  - Request B: studyCount=1, runId=def456
Results page: Shows only 1 row (latest)
```

**After (fixed)**:
```
User selects: Yaris Cross 2023, Yaris Cross 2024
Console: [BATCH_RUN] API mode: batching 2 studies into ONE request
Worker logs:
  - Request: studyCount=2, runId=abc123, Found 2 studies to process
Results page: Shows 2 rows (both studies with runId=abc123)
```

## Acceptance Criteria Met

✅ Selecting 2 studies triggers ONE POST /execute-studies request
✅ Worker logs show: `studyCount: 2` and `Found 2 studies to process`
✅ Results screen shows both result rows for that run
✅ No behavior change for single-study runs
✅ Build passes

## No Logic Changes

- Scraping logic: **unchanged**
- Business logic: **unchanged**
- Filtering: **unchanged**
- Median calculation: **unchanged**
- Database schema: **unchanged**
- Worker behavior: **unchanged** (just receives batched requests now)

Only the UI orchestration was fixed to batch studies correctly.
