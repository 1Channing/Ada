# Median Price Bug - Debugging Guide

## Problem Statement

**Symptom**: Target market median showing incorrect value
- UI displays: Count=6, Range=52,850-57,900€, **Median=57,175€**, Avg=56,325€
- Expected median: **~54,925€** (based on visible top 6 cheapest listings)
- Logs show: "✅ Parsed 22 listings" from Marktplaats (NL)

**Impact**: The median is computed from the wrong dataset, causing incorrect opportunity detection.

---

## Root Cause Analysis

### Verified: Core Logic is CORRECT ✅

The median calculation in `src/lib/study-core/business-logic.ts:computeTargetMarketStats()` is **mathematically correct**:

```typescript
// For 6 prices: [52850, 52900, 54900, 54950, 54950, 55450]
// Indices:        [0]    [1]    [2]    [3]    [4]    [5]

// Median = average of indices 2 and 3 (3rd and 4th items)
const medianPrice = (pricesInEur[2] + pricesInEur[3]) / 2
// = (54900 + 54950) / 2 = 54925 ✅
```

**Unit tests confirm** this logic works correctly (see `test/median-calculation.test.ts`).

### Hypothesis: Data Pipeline Issue

Since the calculation is correct, the bug must be in **what data is being passed** to `computeTargetMarketStats()`:

1. ❌ Wrong listings passed (not filtered properly)
2. ❌ Prices not parsed correctly (string sort instead of numeric)
3. ❌ Cached/stale data from previous run
4. ❌ Deduplication applied inconsistently
5. ❌ Database retrieval showing old results

---

## Debugging Changes Applied

### 1. Added Comprehensive Debug Logging

**Location**: `src/lib/study-core/business-logic.ts:computeTargetMarketStats()`

**What's logged**:
- ✅ Total listings received (before any processing)
- ✅ All prices BEFORE sorting (first 10)
- ✅ All prices AFTER numeric sort ASC (first 10)
- ✅ Exact top 6 prices used for stats (all 6 with titles)
- ✅ Median computation step-by-step (which indices, which values)
- ✅ Final computed stats (count, range, median, avg, percentiles)

**Example output**:
```
[MEDIAN_DEBUG TARGET] === STAGE 1: INPUT ===
[MEDIAN_DEBUG] Total listings received: 22
[MEDIAN_DEBUG] All prices (unsorted):
  1. 54900 EUR → €54900 - Toyota Yaris Cross 2024
  2. 57900 EUR → €57900 - Toyota Yaris Cross 2024 Hybrid
  ...

[MEDIAN_DEBUG] === STAGE 2: AFTER NUMERIC SORT (ASC) ===
[MEDIAN_DEBUG] First 10 sorted prices (numeric sort):
  1. €52850 (52850 EUR) - Toyota Yaris Cross 2024
  2. €52900 (52900 EUR) - Toyota Yaris Cross 2024
  3. €54900 (54900 EUR) - Toyota Yaris Cross 2024
  4. €54950 (54950 EUR) - Toyota Yaris Cross 2024 Hybrid
  ...

[MEDIAN_DEBUG] === STAGE 3: TOP 6 CHEAPEST (used for stats) ===
[MEDIAN_DEBUG] Exact top6 prices array:
  top6[0] = €52850 - Toyota Yaris Cross 2024
  top6[1] = €52900 - Toyota Yaris Cross 2024
  top6[2] = €54900 - Toyota Yaris Cross 2024
  top6[3] = €54950 - Toyota Yaris Cross 2024 Hybrid
  top6[4] = €54950 - Toyota Yaris Cross 2024 Hybrid
  top6[5] = €55450 - Toyota Yaris Cross 2024

[MEDIAN_DEBUG] === STAGE 4: MEDIAN COMPUTATION ===
[MEDIAN_DEBUG] Array length: 6
[MEDIAN_DEBUG] Is even: true
[MEDIAN_DEBUG] Even count: taking average of middle two
[MEDIAN_DEBUG]   pricesInEur[2] = €54900.00
[MEDIAN_DEBUG]   pricesInEur[3] = €54950.00
[MEDIAN_DEBUG]   median = (54900.00 + 54950.00) / 2 = €54925.00

[MEDIAN_DEBUG] === FINAL STATS ===
[MEDIAN_DEBUG] Count: 6
[MEDIAN_DEBUG] Range: €52850 - €55450
[MEDIAN_DEBUG] Median: €54925
[MEDIAN_DEBUG] Average: €54333
```

### 2. Added Pre-Stats Logging

**Location**: `src/services/studyRunner.ts:376`

**What's logged**:
- Raw target listings scraped count
- After `filterListingsByStudy` count
- First 10 listing prices BEFORE passing to stats computation

**Example output**:
```
[STUDY_RUNNER] Raw target listings scraped: 22
[STUDY_RUNNER] After filterListingsByStudy: 8
[STUDY_RUNNER] Target listings prices (pre-stats):
  1. 52850 EUR - Toyota Yaris Cross 2024
  2. 52900 EUR - Toyota Yaris Cross 2024
  ...
```

### 3. Enabled Debug Flag

**Location**: `src/lib/study-core/business-logic.ts:355`

Changed `DEBUG_TRIM_FILTER = false` to `DEBUG_TRIM_FILTER = true` to enable trim filter diagnostics.

---

## How to Diagnose the Issue

### Step 1: Run a Study and Capture Logs

1. Open browser DevTools (F12) → Console tab
2. Run an instant study for the affected study (e.g., Toyota Yaris Cross 2024 NL)
3. Look for `[MEDIAN_DEBUG TARGET]` logs

### Step 2: Analyze the Debug Output

Compare each stage to find where the data diverges:

#### ✅ STAGE 1: Verify Input Count
```
[MEDIAN_DEBUG] Total listings received: X
```
- **Expected**: Same as "After filterListingsByStudy" count from `[STUDY_RUNNER]`
- **If different**: Listings are being modified between filtering and stats

#### ✅ STAGE 2: Verify Numeric Sort
```
[MEDIAN_DEBUG] First 10 sorted prices (numeric sort):
  1. €52850 (52850 EUR)
  2. €52900 (52900 EUR)
  3. €54900 (54900 EUR)
  ...
```
- **Expected**: Prices in ASCENDING numeric order
- **If wrong**: Check for string sort (e.g., "57000" before "6000")

#### ✅ STAGE 3: Verify Top 6
```
[MEDIAN_DEBUG] Exact top6 prices array:
  top6[0] = €52850
  top6[1] = €52900
  top6[2] = €54900
  top6[3] = €54950
  top6[4] = €54950
  top6[5] = €55450
```
- **Expected**: The 6 cheapest prices from STAGE 2
- **If wrong**: Slice operation failed or wrong sort order

#### ✅ STAGE 4: Verify Median Calculation
```
[MEDIAN_DEBUG]   pricesInEur[2] = €54900.00
[MEDIAN_DEBUG]   pricesInEur[3] = €54950.00
[MEDIAN_DEBUG]   median = (54900.00 + 54950.00) / 2 = €54925.00
```
- **Expected**: Average of 3rd and 4th items (indices 2 and 3)
- **Manual check**: (top6[2] + top6[3]) / 2 = median

### Step 3: Identify the Divergence Point

If the logs show:
- ✅ Input count correct
- ✅ Sort order correct
- ✅ Top 6 correct
- ❌ **But UI still shows wrong median**

Then the issue is **NOT in the computation**, but in:
1. **Database storage** - Check `study_run_results.target_stats` column
2. **UI retrieval** - Check what `selectedResult.target_stats.median_price` contains
3. **Cached data** - UI might be showing old run's results

---

## Potential Root Causes & Solutions

### Scenario A: Wrong Listings Passed to Stats

**Symptom**: `[MEDIAN_DEBUG] Total listings received: 22` (should be ~8 after filtering)

**Root cause**: `filterListingsByStudy()` not applied, or applied to wrong data

**Solution**:
```typescript
// Ensure filtering happens BEFORE stats
const filteredTargetListings = filterListingsByStudy(targetListings, targetCriteria);
const targetStats = computeTargetMarketStats(filteredTargetListings, 'TARGET');
```

### Scenario B: String Sort Instead of Numeric

**Symptom**: STAGE 2 shows prices like: €6000, €57000, €60000 (wrong order)

**Root cause**: Prices stored as strings

**Solution**: Ensure prices are numbers before sorting:
```typescript
const sortedListings = listings
  .map(l => ({ ...l, priceEur: toEur(l.price, l.currency) })) // Convert to number
  .sort((a, b) => a.priceEur - b.priceEur); // Numeric sort
```

### Scenario C: Cached/Stale Data

**Symptom**: Logs show correct median (54925) but UI shows wrong (57175)

**Root cause**: UI displaying cached result from previous run

**Solution**:
1. Check `study_run_results` table for multiple entries
2. Ensure UI fetches latest result: `.order('created_at', { ascending: false }).limit(1)`
3. Add timestamp to debug logs to verify which run is being displayed

### Scenario D: Database Storage Issue

**Symptom**: Logs show correct stats but database has wrong values

**Root cause**: `target_stats` JSON object not serializing correctly

**Solution**: Log the object being stored:
```typescript
console.log('[DB_INSERT] Storing target_stats:', JSON.stringify(targetStats, null, 2));
await supabase.from('study_run_results').insert([{ ..., target_stats: targetStats }]);
```

---

## Minimal Patch Applied

### Files Modified

1. **`src/lib/study-core/business-logic.ts`**
   - Enabled `DEBUG_TRIM_FILTER = true` (line 355)
   - Added comprehensive debug logging in `computeTargetMarketStats()` (lines 388-428)
   - NO LOGIC CHANGES - only logging added

2. **`src/services/studyRunner.ts`**
   - Added pre-stats logging (lines 346-355)
   - Pass `'TARGET'` debug label to `computeTargetMarketStats()` (line 376)

3. **`test/median-calculation.test.ts`** *(new file)*
   - Unit tests verifying median calculation correctness
   - Tests pass ✅

### Code Diff Summary

```diff
# src/lib/study-core/business-logic.ts
-const DEBUG_TRIM_FILTER = false;
+const DEBUG_TRIM_FILTER = true;

+  // CRITICAL DEBUG: Log all prices BEFORE sorting
+  console.log(`\n[MEDIAN_DEBUG ${debugLabel || 'UNKNOWN'}] === STAGE 1: INPUT ===`);
+  // ... (detailed logging added)

+  // CRITICAL DEBUG: Log first 10 sorted prices
+  console.log(`\n[MEDIAN_DEBUG] === STAGE 2: AFTER NUMERIC SORT (ASC) ===`);
+  // ... (detailed logging added)

+  // CRITICAL DEBUG: Show the exact top 6 prices used for stats
+  console.log(`\n[MEDIAN_DEBUG] === STAGE 3: TOP 6 CHEAPEST ===`);
+  // ... (detailed logging added)

+  // CRITICAL DEBUG: Show median computation step-by-step
+  console.log(`\n[MEDIAN_DEBUG] === STAGE 4: MEDIAN COMPUTATION ===`);
+  // ... (detailed logging added)

# src/services/studyRunner.ts
+    console.log(`[STUDY_RUNNER] Raw target listings scraped: ${targetListings.length}`);
+    console.log(`[STUDY_RUNNER] After filterListingsByStudy: ${filteredTargetListings.length}`);
+    // ... (pre-stats logging added)
-    const targetStats = computeTargetMarketStats(filteredTargetListings);
+    const targetStats = computeTargetMarketStats(filteredTargetListings, 'TARGET');
```

---

## Unit Test Verification

**Test File**: `test/median-calculation.test.ts`

**How to run**:
```bash
npx tsx test/median-calculation.test.ts
```

**Test Cases**:
1. ✅ User-provided prices [52850, 52900, 54900, 54950, 54950, 55450] → median = 54925
2. ✅ 10 listings (only top 6 used) → median = 54925
3. ✅ Unsorted input → correctly sorted → median = 54925
4. ✅ Numeric sort verification → correct order → median = 7500

**Result**: ✅ ALL TESTS PASSED

---

## Next Steps

### Immediate Action
1. **Run a study** with debug logging enabled
2. **Capture the console logs** (copy full output)
3. **Analyze each stage** to find where data diverges
4. **Compare with expected values** from visible UI listings

### Once Root Cause Identified

Depending on the scenario found:

**If filtering issue**: Fix `filterListingsByStudy()` call chain
**If sort issue**: Verify price types are numbers
**If cache issue**: Clear cached results or fix retrieval query
**If DB issue**: Fix serialization/deserialization

### After Fix Applied

1. **Disable DEBUG_TRIM_FILTER** (set back to `false`)
2. **Remove verbose console logs** (keep only essential logs)
3. **Add regression test** to ensure fix persists
4. **Document the root cause** in this file

---

## Quick Sanity Check

**Manual calculation for user's data**:

Given top 6 prices: [52850, 52900, 54900, 54950, 54950, 55450]

```
Sorted: [52850, 52900, 54900, 54950, 54950, 55450]
Indices: [  0  ,   1  ,   2  ,   3  ,   4  ,   5  ]

Median (even count) = (arr[2] + arr[3]) / 2
                     = (54900 + 54950) / 2
                     = 109850 / 2
                     = 54925 ✅
```

**If UI shows 57175 instead**:
- That's (54350 + 60000) / 2 OR (57175 + 57175) / 2
- Suggests wrong listings used (not the cheapest 6)

---

## Summary

✅ **Median calculation logic is correct** (verified by unit tests)
❌ **The issue is in the DATA pipeline**, not the calculation
🔍 **Debug logging added** to trace data flow through all stages
📊 **Run a study and analyze logs** to find exact divergence point

**Expected outcome**: Logs will reveal which stage has the wrong data, pointing to the root cause.
