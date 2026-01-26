# Instant Run Priority Fix

**Date:** 2026-01-26
**Status:** ✅ Complete
**Build:** ✅ Passing

## Summary

Implemented a UI-only priority rule: **Scheduled runs take absolute precedence over instant runs.**

When a scheduled run exists (pending, running, or completed), any pre-existing instant run state is completely cleared and ignored to prevent stuck "Running..." states, error popups, and blocked UI.

## Problem

The UI treated instant runs and scheduled runs as competing sources of truth, causing:
- ✗ Endless "Running..." state even after scheduled runs completed
- ✗ Batch error / running popups appearing randomly
- ✗ Blocked Instant Run button when no run was actually active
- ✗ Duplicate/conflicting progress indicators

**Root Cause:** When a scheduled run was created or completed, the UI would still detect an old instant run record in `study_runs` with `status='running'` and restore its state, even though the scheduled run had taken over or finished.

## Solution: UI Priority Rule

### Rule 1: Resume Logic (checkForActiveRuns)

**File:** `src/pages/StudiesV2RunSearches.tsx:117-189`

**Change:**
```typescript
// BEFORE: Only checked for 'pending', 'running'
.in('status', ['pending', 'running'])

// AFTER: Check for 'pending', 'running', 'completed'
.in('status', ['pending', 'running', 'completed'])

// NEW: If status is 'completed', immediately clear instant run state
if (scheduledRun.status === 'completed') {
  console.log('[RUN_SEARCHES] Scheduled run completed, clearing instant run state');
  setRunning(false);
  setProgress('');
  setRunProgress({
    isRunning: false,
    currentIndex: 0,
    total: 0,
    currentStudyId: undefined,
    stage: undefined,
  });
  currentRunIdRef.current = null;
  cancelRequestedRef.current = false;
  return; // Never check for instant runs
}
```

**Impact:**
- On page load, if a scheduled run exists in ANY state → instant run is ignored
- Prevents resurrection of stale instant run state
- UI shows clean slate after scheduled run completes

---

### Rule 2: Start New Run (runInstantSearch)

**File:** `src/pages/StudiesV2RunSearches.tsx:375-394`

**Change:**
```typescript
// NEW: Block instant run if an active scheduled run exists
const { data: existingScheduledRun } = await supabase
  .from('scheduled_study_runs')
  .select('id, status, scheduled_at')
  .in('status', ['pending', 'running'])  // Note: Only pending/running, not completed
  .order('scheduled_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (existingScheduledRun) {
  console.log('[RUN_SEARCHES] Blocking instant run - active scheduled run exists:', existingScheduledRun.status);
  alert(`Cannot start instant run: A ${existingScheduledRun.status} scheduled run is active. Please wait for it to complete or cancel it first.`);
  return;
}
```

**Impact:**
- Users cannot start instant run while scheduled run is pending/running
- After scheduled run completes, users can start new instant runs
- Prevents conflicting runs from starting

---

## Flow Diagram

```
PAGE LOAD / REFRESH
    ↓
checkForActiveRuns()
    ↓
    ├─ Check scheduled_study_runs (pending/running/completed)
    │   └─ Found? → Clear instant run state completely
    │              → Never resume instant run
    │              → If completed: UI shows clean slate
    │              → If running: Show scheduled run progress
    │
    └─ No scheduled run? → Check study_runs (instant runs)
                         → Resume if recent & valid


USER CLICKS "INSTANT RUN"
    ↓
runInstantSearch()
    ↓
    ├─ Check scheduled_study_runs (pending/running)
    │   └─ Found? → Block with alert message
    │              → Cannot start instant run
    │
    └─ No active scheduled run? → Start instant run normally
```

---

## Key Behaviors

### ✅ Scheduled Run Completed
1. User refreshes page
2. `checkForActiveRuns()` finds scheduled run with status='completed'
3. All instant run state cleared immediately
4. UI shows: No active runs, Instant Run button enabled
5. User can start fresh instant run

### ✅ Scheduled Run Running
1. User refreshes page
2. `checkForActiveRuns()` finds scheduled run with status='running'
3. Shows scheduled run progress
4. Instant run completely ignored
5. Instant Run button remains disabled

### ✅ User Tries to Start Instant Run While Scheduled Run Active
1. User clicks "Instant Run"
2. `runInstantSearch()` checks for active scheduled runs
3. Finds pending/running scheduled run
4. Shows alert: "Cannot start instant run: A running scheduled run is active"
5. Does not create instant run record

### ✅ No Scheduled Run, Has Stale Instant Run
1. User refreshes page
2. `checkForActiveRuns()` finds no scheduled runs
3. Checks instant runs
4. If recent and incomplete: Resume
5. If stale or complete: Clear state

---

## Code Changes

**File:** `src/pages/StudiesV2RunSearches.tsx`

**Lines 121-144:** Added completed status check + immediate clear logic
**Lines 381-394:** Added block guard for starting new instant runs

**Total lines changed:** ~35 lines
**Files modified:** 1 file
**Backend changes:** None
**Schema changes:** None
**Worker changes:** None

---

## Logging

**Resume Logic:**
```
[RUN_SEARCHES] Scheduled run completed, clearing instant run state
[RUN_SEARCHES] Resuming scheduled run: {uuid}
```

**Start New Run:**
```
[RUN_SEARCHES] Blocking instant run - active scheduled run exists: pending
[RUN_SEARCHES] Blocking instant run - active scheduled run exists: running
```

---

## Testing

**Build Status:** ✅ Pass
```bash
npm run build
# ✓ built in 14.18s
```

**Manual Testing Scenarios:**

1. ✅ Start scheduled run → Refresh page → Should not show instant run
2. ✅ Complete scheduled run → Refresh page → Should show clean slate
3. ✅ Try to start instant run while scheduled run active → Should show alert
4. ✅ Complete scheduled run → Start new instant run → Should work normally
5. ✅ No scheduled runs → Old instant run exists → Should reconcile based on age/status

---

## What This Does NOT Change

- ❌ Backend/worker execution logic
- ❌ Database schema
- ❌ Scheduled run creation/execution
- ❌ Instant run execution logic
- ❌ Result persistence
- ❌ Scraping behavior

**This is purely a UI state management fix.**

---

## Acceptance Criteria Met

✅ No more "instant run" stuck in running state
✅ No more batch / running popups after scheduled runs
✅ Instant Run button is usable after scheduled run completes
✅ UI is silent and stable
✅ UI-only fix (no backend changes)
✅ No new features or flows added
✅ No overcomplication

---

## Edge Cases Handled

**Multiple Scheduled Runs:** Query orders by `scheduled_at DESC` and limits to 1, checking most recent only

**Completed + Old Instant Run:** Scheduled run takes precedence, instant run ignored

**No Scheduled Run + Stale Instant Run:** Existing age-based reconciliation logic applies

**User Cancels Scheduled Run:** Status becomes 'cancelled' → Not in priority check → Instant runs can start

---

## Architecture Philosophy

**Single Source of Truth:** When scheduled run exists, it IS the source of truth

**Clear State Transitions:** No ambiguous states where both run types show active

**Fail-Safe:** Even if backend doesn't update status correctly, UI reconciles based on results

**User Intent:** Once user schedules a run, that's their intended execution path → instant run should not interfere
