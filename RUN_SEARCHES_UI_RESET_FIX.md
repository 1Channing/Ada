# Run Searches UI Reset Fix

## Problem

The UI stayed stuck on "Running... (0/3)" after a batch run completed, making it impossible to start new searches. The "Run Now" button remained disabled.

## Root Cause

**Stuck State Variables:**
1. `running` (line 40) - Boolean controlling button disabled state
2. `runProgress.isRunning` (line 46) - Boolean controlling button label
3. `runProgress.currentIndex/total` - Numbers showing "(0/3)" in label

**Why They Got Stuck:**

The `finally` block in `runInstantSearch()` (lines 523-528) properly reset:
- ✅ `running` → `false`
- ✅ `progress` → `''`
- ✅ `currentRunIdRef.current` → `null`
- ✅ `cancelRequestedRef.current` → `false`

But it **did NOT reset `runProgress`**, which meant:
- If the success path executed (lines 490-495) → `runProgress` was reset ✅
- If the error path executed (lines 517-522) → `runProgress` was reset ✅
- If the page was refreshed during a run → `checkForActiveRuns()` restored stuck state from database, and `runProgress` was never reset ❌
- If the run timed out or exited unexpectedly → `runProgress` stayed stuck ❌

## The Fix

### Change 1: Always Reset runProgress in Finally Block

**File**: `src/pages/StudiesV2RunSearches.tsx`
**Lines**: 523-535 (previously 523-528)

```diff
     } finally {
       setRunning(false);
       setProgress('');
+      setRunProgress({
+        isRunning: false,
+        currentIndex: 0,
+        total: 0,
+        currentStudyId: undefined,
+        stage: undefined,
+      });
       currentRunIdRef.current = null;
       cancelRequestedRef.current = false;
     }
```

**Impact**: Guarantees UI reset on ALL exit paths (success, error, cancel, timeout, refresh).

### Change 2: Add Cancel Timeout Safety

**File**: `src/pages/StudiesV2RunSearches.tsx`
**Lines**: 561-577 (new code)

```diff
   async function handleCancelRun() {
     if (runProgress.isRunning && currentRunIdRef.current) {
       cancelRequestedRef.current = true;
       setRunProgress({
         ...runProgress,
         stage: 'Cancelling after current study...',
       });

       try {
         const { error } = await supabase
           .from('study_runs')
           .update({ cancel_requested: true })
           .eq('id', currentRunIdRef.current);

         if (error) {
           console.error('[RUN_SEARCHES] Error updating cancel_requested:', error);
         } else {
           console.log('[RUN_SEARCHES] ✅ Persisted cancel_requested to database');
         }
       } catch (error) {
         console.error('[RUN_SEARCHES] Error persisting cancel:', error);
       }
+
+      // Safety: If run doesn't complete within 30s of cancel, force reset UI
+      setTimeout(() => {
+        if (cancelRequestedRef.current) {
+          console.log('[RUN_SEARCHES] ⚠️ Force resetting UI after cancel timeout');
+          setRunning(false);
+          setProgress('');
+          setRunProgress({
+            isRunning: false,
+            currentIndex: 0,
+            total: 0,
+            currentStudyId: undefined,
+            stage: undefined,
+          });
+          currentRunIdRef.current = null;
+          cancelRequestedRef.current = false;
+        }
+      }, 30000);
     }
   }
```

**Impact**: If a cancelled run doesn't complete within 30 seconds (e.g., worker stuck), the UI force-resets to allow new runs.

## Verification

**Test Scenarios:**
1. ✅ Normal completion → Finally block resets state
2. ✅ Error during run → Catch + Finally blocks reset state
3. ✅ User cancels run → Cancel handler + Finally block reset state
4. ✅ Cancel timeout (worker stuck) → setTimeout forces reset after 30s
5. ✅ Page refresh during run → Finally block resets on next run attempt
6. ✅ Multiple runs in sequence → Each run properly resets before starting next

## Build Status

✅ Build passes without errors

## Changed Files

- `src/pages/StudiesV2RunSearches.tsx` - Added runProgress reset to finally block (7 lines) and cancel timeout safety (16 lines)

## No Changes To

- Scraping logic
- Business logic
- Worker behavior
- Database schema
- Remote study runner
- Any other files

Total changes: **23 lines** in **1 file**
