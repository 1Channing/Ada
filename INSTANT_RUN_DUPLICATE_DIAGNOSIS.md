# Instant Run Becomes Scheduled + Duplicate Record Diagnosis

**Date:** 2026-01-26
**Status:** 🔍 Root Cause Identified

---

## Executive Summary

When user clicks "Instant Run" in REMOTE mode (via Worker), the system creates **TWO separate** `study_runs` records:
1. **Record #1** (instant, running) - created by UI, **NEVER UPDATED** ❌
2. **Record #2** (scheduled, completed) - created by Edge Function, updated by Worker ✅

The UI shows Record #1 (stuck in running), while Worker completes Record #2.

---

## Exact Execution Path

### Step 1: User Clicks "Instant Run"

**File:** `src/pages/StudiesV2RunSearches.tsx:367-377`

```typescript
const { data: runData, error: runError } = await supabase
  .from('study_runs')
  .insert([{
    run_type: 'instant',           // ← Marked as "instant"
    status: 'running',             // ← Set to running
    total_studies: selectedStudies.size,
    executed_at: new Date().toISOString(),
    price_diff_threshold_eur: priceDiffThreshold,
  }])
  .select()
  .single();

const runId = runData.id;          // ← Gets runId (e.g., "abc-123")
```

**Result:** Creates `study_runs` record #1 with:
- `id`: "abc-123"
- `run_type`: "instant"
- `status`: "running"

---

### Step 2: UI Calls Remote Batch Function

**File:** `src/pages/StudiesV2RunSearches.tsx:398-409`

```typescript
await runStudiesBatchRemotely(
  {
    studies: studiesToRun,
    runId,                          // ← Passes "abc-123"
    threshold: priceDiffThreshold,
    scrapeMode,
  },
  (event) => {
    console.log(`[BATCH_RUN] Batch progress: ${event.stage}`);
    setProgress(event.message);
  }
);
```

---

### Step 3: Remote Runner Creates Scheduled Job

**File:** `src/services/remoteStudyRunner.ts:353-367`

```typescript
const { data: scheduledJob, error: scheduleError } = await supabase
  .from('scheduled_study_runs')
  .insert([{
    scheduled_at: scheduledAt.toISOString(),
    status: 'pending',
    payload: {
      studyIds,
      runId,                        // ← Stores "abc-123" in payload
      threshold,
      type: 'instant',
      scrapeMode,
    },
  }])
  .select()
  .single();
```

**Result:** Creates `scheduled_study_runs` record with:
- `id`: "sched-789"
- `status`: "pending"
- `payload.runId`: "abc-123" (the UI-created runId)
- `run_id`: NULL (not set yet)

**CRITICAL:** The `runId` from UI is stored in the **payload**, not in the `run_id` column!

---

### Step 4: Edge Function Creates SECOND study_runs Record

**File:** `supabase/functions/run_scheduled_studies/index.ts:183-208`

```typescript
const { data: runData, error: runError } = await supabase
  .from('study_runs')
  .insert([{
    run_type: 'scheduled',          // ← NEW RECORD, marked as "scheduled"
    status: 'running',
    total_studies: payload.studyIds.length,
    executed_at: new Date().toISOString(),
    price_diff_threshold_eur: payload.threshold,
  }])
  .select()
  .single();

const runId = runData.id;           // ← Gets NEW runId (e.g., "xyz-456")
console.log(`Created study_runs record with ID: ${runId}`);

await supabase
  .from('scheduled_study_runs')
  .update({
    run_id: runId,                  // ← Links to NEW runId "xyz-456"
  })
  .eq('id', job.id);
```

**Result:**
- Creates `study_runs` record #2 with:
  - `id`: "xyz-456" (**DIFFERENT from UI-created runId**)
  - `run_type`: "scheduled"
  - `status`: "running"
- Updates `scheduled_study_runs.run_id` to "xyz-456"

**CRITICAL BUG:** The edge function **ignores** `payload.runId` ("abc-123") and creates a **NEW** study_runs record!

---

### Step 5: Worker Updates SECOND Record Only

**File:** `worker/index.ts:158-176`

```typescript
await supabase
  .from('study_runs')
  .update({
    status: 'completed',            // ← Updates "xyz-456"
    null_count: totalNullCount,
    opportunities_count: totalOpportunitiesCount,
  })
  .eq('id', runId);                 // ← runId is "xyz-456"

if (scheduledJobId) {
  await supabase
    .from('scheduled_study_runs')
    .update({
      status: 'completed',
      run_id: runId,                // ← Still "xyz-456"
    })
    .eq('id', scheduledJobId);
  console.log(`Updated scheduled_study_runs (${scheduledJobId}) to completed`);
}
```

**Result:**
- Updates `study_runs` record #2 ("xyz-456") to "completed" ✅
- Updates `scheduled_study_runs` to "completed" ✅
- **NEVER touches** `study_runs` record #1 ("abc-123") ❌

---

## Final Database State

### study_runs Table

| id       | run_type  | status    | Notes                              |
|----------|-----------|-----------|------------------------------------|
| abc-123  | instant   | running   | ❌ Created by UI, NEVER UPDATED    |
| xyz-456  | scheduled | completed | ✅ Created by Edge Fn, completed   |

### scheduled_study_runs Table

| id       | status    | run_id  | payload.runId | Notes                     |
|----------|-----------|---------|---------------|---------------------------|
| sched-789| completed | xyz-456 | abc-123       | Links to record #2 only   |

### UI Behavior

**checkForActiveRuns()** queries:
```sql
SELECT * FROM study_runs WHERE status='running'
```

Finds record #1 ("abc-123", instant, running) → UI shows "Running..."

---

## ID Mapping / Relationships

### What SHOULD happen:
```
UI runId → scheduled_study_runs.run_id → Worker uses same runId
```

### What ACTUALLY happens:
```
UI runId ("abc-123") → scheduled_study_runs.payload.runId (ignored)
Edge Fn creates NEW runId ("xyz-456") → scheduled_study_runs.run_id
Worker updates NEW runId ("xyz-456") only
UI runId ("abc-123") ORPHANED ❌
```

**There is NO join path** between:
- `study_runs.id = "abc-123"` (UI-created)
- `scheduled_study_runs.run_id = "xyz-456"` (Edge Fn-created)

The `payload.runId` field is stored but **NEVER READ OR USED**.

---

## Root Cause Hypothesis Confirmed ✅

**Hypothesis:** On Instant Run click, the system creates `study_runs` (status=running) and ALSO creates `scheduled_study_runs` for worker execution, but only the scheduled table gets marked completed. The `study_runs` row remains running and keeps UI stuck.

**Confirmation:** ✅ **CONFIRMED** - But with additional detail:
- The issue is that **TWO separate** `study_runs` records are created
- The UI-created record is completely abandoned
- The edge function doesn't know about the UI-created record
- No code path ever updates the UI-created record
- The records have **different IDs** with no relationship

---

## Why "Instant Run Becomes Scheduled"

User perceives "Instant Run" becomes "Scheduled" because:
1. UI creates a record with `run_type='instant'`
2. Edge function creates a NEW record with `run_type='scheduled'`
3. UI shows the "instant" record (stuck)
4. Run History shows BOTH records (one instant/running, one scheduled/completed)
5. User sees duplicate entries with different types

---

## Endpoints Called on Instant Run Click

### 1. Database Insert (Direct Supabase Client)
```
POST https://<project>.supabase.co/rest/v1/study_runs
Body: { run_type: 'instant', status: 'running', ... }
→ Creates record #1
```

### 2. Database Insert (Via Remote Runner)
```
POST https://<project>.supabase.co/rest/v1/scheduled_study_runs
Body: { scheduled_at: now, payload: { studyIds, runId, ... } }
→ Creates scheduled job
```

### 3. Edge Function Trigger
```
POST https://<project>.supabase.co/functions/v1/run_scheduled_studies
Headers: { Authorization: Bearer <SCHEDULER_CRON_SECRET> }
Body: {}
→ Edge function creates record #2
→ Edge function calls worker
```

### 4. Worker HTTP Call
```
POST https://<worker-url>/execute-studies
Headers: { Authorization: Bearer <WORKER_SECRET> }
Body: { runId: "xyz-456", studyIds: [...], threshold, scheduledJobId }
→ Worker updates record #2 only
```

---

## Tables Inserted/Updated Summary

### Instant Run Click (REMOTE mode)

| Table                  | Operation | Who Creates     | Fields                           | Notes                      |
|------------------------|-----------|-----------------|----------------------------------|----------------------------|
| study_runs             | INSERT    | UI              | id="abc-123", type=instant       | ❌ Never updated           |
| scheduled_study_runs   | INSERT    | UI              | payload.runId="abc-123"          | Created for worker         |
| study_runs             | INSERT    | Edge Function   | id="xyz-456", type=scheduled     | ✅ Worker updates this     |
| scheduled_study_runs   | UPDATE    | Edge Function   | run_id="xyz-456"                 | Links to record #2         |
| study_runs             | UPDATE    | Worker          | id="xyz-456", status=completed   | Updates record #2          |
| scheduled_study_runs   | UPDATE    | Worker          | status=completed                 | Marks job complete         |

**Total records created:** 2 in `study_runs`, 1 in `scheduled_study_runs`
**Orphaned records:** 1 in `study_runs` (id="abc-123")

---

## Option A: MINIMAL FIX (Recommended)

### Problem
UI creates a `study_runs` record that is never used when delegating to worker.

### Solution
**Do NOT create a `study_runs` record in the UI when using remote/worker mode.**

The edge function will create the `study_runs` record, and the worker will update it correctly.

### Changes Required

**File:** `src/pages/StudiesV2RunSearches.tsx:363-386`

**BEFORE:**
```typescript
// Always create study_runs record
const { data: runData, error: runError } = await supabase
  .from('study_runs')
  .insert([{ ... }])
  .select()
  .single();

const runId = runData.id;

// API mode: delegate to worker
if (SCRAPER_MODE === 'api') {
  await runStudiesBatchRemotely({
    studies: studiesToRun,
    runId,  // ← This runId is ignored by edge function
    ...
  });
}
```

**AFTER:**
```typescript
// API mode: delegate to worker (no UI record creation)
if (SCRAPER_MODE === 'api') {
  // Edge function will create study_runs record
  await runStudiesBatchRemotely({
    studies: studiesToRun,
    runId: null,  // ← Edge function creates its own runId
    threshold: priceDiffThreshold,
    scrapeMode,
  });

  // UI polls for results based on scheduled_study_runs
  // No need to track runId in UI for remote execution
} else {
  // Browser mode: create study_runs record as before
  const { data: runData, error: runError } = await supabase
    .from('study_runs')
    .insert([{ ... }])
    .select()
    .single();

  const runId = runData.id;
  // ... continue with browser execution
}
```

### Impact
- **Eliminates** duplicate `study_runs` records
- **Eliminates** orphaned "instant" records stuck in running
- **Simplifies** remote execution (one source of truth)
- **No backend changes** required (edge function + worker already work correctly)
- **No database schema changes** required

### Lines Changed
- `src/pages/StudiesV2RunSearches.tsx:363-500` (restructure instant run logic)
- ~150 lines modified/moved
- Zero backend/worker changes
- Zero schema changes

---

## Alternative Options (NOT Recommended)

### Option B: Make Edge Function Use Payload runId
- Edge function reads `payload.runId` instead of creating new record
- More invasive, requires backend changes
- Still has conceptual confusion (why create record in UI if not used?)

### Option C: UI Updates Both Records
- After worker completes, UI finds and updates the orphaned record
- Reactive/cleanup approach (messy)
- Doesn't fix root cause

### Option D: Worker Updates Both Records
- Worker somehow knows about BOTH runIds
- Requires passing both IDs through entire pipeline
- Complex and fragile

---

## Verification Steps

After implementing Option A:

1. **Test Instant Run (Remote mode)**
   ```
   ✅ One study_runs record created (by edge function)
   ✅ One scheduled_study_runs record created
   ✅ Both marked completed by worker
   ✅ UI shows correct status after completion
   ✅ Run History shows ONE entry, not duplicates
   ```

2. **Test Instant Run (Browser mode)**
   ```
   ✅ One study_runs record created (by UI)
   ✅ No scheduled_study_runs record
   ✅ UI updates status directly
   ✅ Works as before
   ```

3. **Check Database**
   ```sql
   -- Should only find completed/failed runs, no stuck running
   SELECT id, run_type, status FROM study_runs WHERE status='running';
   -- Expected: 0 rows (or only legitimately active runs)
   ```

---

## Next Steps

1. **Implement Option A** (surgical change to StudiesV2RunSearches.tsx)
2. **Test both modes** (remote and browser)
3. **Clean up orphaned records** (one-time DB cleanup query)
4. **Monitor Run History** (ensure no more duplicates)

---

## Questions Answered

### Q1: What is the intended architecture?

**A:** When user clicks "Instant Run" in REMOTE mode:
- **INTENDED:** Edge function creates ONE `study_runs` record (run_type='scheduled')
- **ACTUAL:** UI creates one (instant), edge function creates another (scheduled)
- **FIX:** UI should NOT create record for remote execution

### Q2: Why does "Instant Run" route to scheduled runs?

**A:** Remote execution uses the scheduled runs infrastructure:
- `scheduled_study_runs` table acts as job queue
- Edge function processes pending jobs
- "Instant" just means `scheduled_at = now()`
- The confusion arises from duplicate `study_runs` records with different types

### Q3: Are we duplicating the request?

**A:** Yes, TWO `study_runs` records are created:
- UI creates one at `StudiesV2RunSearches.tsx:367`
- Edge function creates another at `run_scheduled_studies/index.ts:183`

### Q4: How do we link the two records?

**A:** Currently, **THEY ARE NOT LINKED**
- `scheduled_study_runs.payload.runId` = "abc-123" (UI-created, ignored)
- `scheduled_study_runs.run_id` = "xyz-456" (Edge Fn-created, used)
- No foreign key or join path between the two `study_runs` records

### Q5: Where should "completed" be written?

**A:** With Option A:
- Worker writes "completed" to `study_runs` (edge Fn-created record)
- Worker writes "completed" to `scheduled_study_runs`
- UI should NOT create `study_runs` for remote execution

### Q6: Root cause confirmed?

**A:** ✅ **CONFIRMED + CLARIFIED**
- Two separate `study_runs` records created
- UI-created record never updated
- Edge Fn-created record updated correctly
- No relationship between the two records
- UI shows the wrong (orphaned) record

---

## Conclusion

**Single Minimal Fix (Option A):**

Move the `study_runs` creation INSIDE the browser-mode branch. For remote/worker execution, let the edge function create the `study_runs` record. This eliminates duplicate records and the stuck "running" state.

**Impact:** ~150 lines changed, 1 file modified, zero backend changes, zero schema changes.
