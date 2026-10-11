# Empty State and History Reconciliation Fixes

**Date:** 2026-01-25
**Status:** ✅ Complete
**Build:** ✅ Passing

## Summary

Two surgical fixes implemented in `src/pages/StudiesV2Results.tsx`:

1. **Empty State Display** - Shows clear message when study has zero interesting listings
2. **History Reconciliation** - Prevents stale "running" status when results are complete

## Changes Made

### Fix 1: Empty State for Zero Listings

**File:** `src/pages/StudiesV2Results.tsx` (lines 722-766)

**Problem:**
- When a study completes with 0 interesting listings, the modal showed nothing
- User couldn't tell if the search completed successfully or failed

**Solution:**
Added conditional rendering in the "Interesting Listings" modal:

```typescript
{listings.length === 0 ? (
  <div className="py-12 text-center">
    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800/50 mb-4">
      <XCircle size={32} className="text-zinc-500" />
    </div>
    <h4 className="text-lg font-semibold text-zinc-300 mb-2">
      No interesting listings found
    </h4>
    <p className="text-sm text-zinc-400 max-w-md mx-auto">
      No interesting listings found on the source market for this study.
      The search completed successfully but no results met the criteria.
    </p>
  </div>
) : (
  // ... render listings
)}
```

**Impact:**
- Empty state now clearly visible with icon and message
- Market stats remain visible (if available)
- User understands search completed but found no opportunities

---

### Fix 2: History Status Reconciliation

**File:** `src/pages/StudiesV2Results.tsx` (lines 228-273)

**Problem:**
- Some runs stuck at "running" status even though results exist
- Happens when worker completes but doesn't update study_runs status
- Creates confusion about which runs are actually active

**Solution:**
Added reconciliation logic in `loadHistory()`:

```typescript
// Reconciliation: Check for stale "running" runs that are actually complete
const runningRuns = (data || []).filter(run => run.status === 'running');

for (const run of runningRuns) {
  // Check if this run has completed results
  const { data: resultsData, error: resultsError } = await supabase
    .from('study_run_results')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', run.id);

  if (!resultsError) {
    const completedCount = resultsData?.length || 0;

    // If we have results >= total_studies, the run is actually complete
    if (completedCount >= run.total_studies) {
      console.log(`[HISTORY_RECONCILIATION] Run ${run.id} marked running but has ${completedCount}/${run.total_studies} results. Updating to completed.`);

      // Update DB status to completed
      const { error: updateError } = await supabase
        .from('study_runs')
        .update({ status: 'completed' })
        .eq('id', run.id);

      if (!updateError) {
        // Update local state
        run.status = 'completed';
      }
    }
  }
}
```

**How It Works:**
1. When loading history, identifies runs with status="running"
2. For each, queries `study_run_results` to count completed results
3. If `completed_count >= total_studies`, the run is actually done
4. Updates DB to mark status="completed"
5. Updates local state for immediate UI refresh

**Impact:**
- Stale "running" runs automatically corrected to "completed"
- History shows accurate status based on actual results
- Self-healing on every history load
- Prevents accumulation of stuck runs

---

## Architecture Context

### Why History Reconciliation Was Needed

The scheduled execution flow creates records in two tables:

1. **`scheduled_study_runs`** - Job scheduling record (pending → running → completed)
2. **`study_runs`** - Execution record (running → completed)

The edge function (`supabase/functions/run_scheduled_studies/index.ts`) creates the `study_runs` record at line 183-193, but if the worker completes without properly updating status, the record stays "running" while results exist.

The reconciliation guard ensures the UI shows accurate status based on ground truth (existence of results) rather than potentially stale status fields.

---

## Testing

**Build Status:** ✅ Pass
```bash
npm run build
# ✓ built in 14.69s
```

**Manual Testing Required:**
1. Run a study that produces 0 interesting listings
2. Open "Interesting Listings" modal → Should see empty state message
3. Check Run History for any "running" entries with completed results
4. Reload page → Should auto-reconcile to "completed"

---

## Files Modified

- `src/pages/StudiesV2Results.tsx` (2 changes)
  - Lines 722-766: Empty state conditional rendering
  - Lines 228-273: History reconciliation logic

**No changes to:**
- Database schema
- Scraping logic
- Opportunity detection
- Business logic
- UI layouts (except empty state)

---

## Logging

**History Reconciliation:**
```
[HISTORY_RECONCILIATION] Run {uuid} marked running but has 15/15 results. Updating to completed.
```

This log confirms when a stale run is detected and corrected.
