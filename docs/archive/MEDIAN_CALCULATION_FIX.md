# Median Calculation Fix for Scheduled Runs

## Problem

The median calculation in scheduled runs used an incorrect formula that only worked for odd-count arrays.

**Incorrect code** (line 781):
```javascript
median_price: pricesInEur[Math.floor(pricesInEur.length / 2)]
```

This formula:
- ✓ Works for odd count (e.g., 3 values): selects middle value
- ✗ **Fails for even count** (e.g., 6 values): selects wrong value instead of averaging the two middle values

## Example of the Bug

**Input**: Target listings with prices `[38800, 40450, 42950, 43000, 43500, 44000]` EUR

**Incorrect calculation**:
- `Math.floor(6 / 2) = 3`
- `pricesInEur[3] = 43000` ❌

**Correct calculation**:
- Average of `pricesInEur[2]` and `pricesInEur[3]`
- `(42950 + 43000) / 2 = 42975` ✓

## Solution

Fixed the median calculation to use the correct mathematical formula:

**New code** (lines 780-783):
```javascript
const mid = Math.floor(pricesInEur.length / 2);
const median = pricesInEur.length % 2 === 0
  ? (pricesInEur[mid - 1] + pricesInEur[mid]) / 2
  : pricesInEur[mid];
```

### Formula Logic

**Odd count** (e.g., 3 values):
- `mid = Math.floor(3 / 2) = 1`
- `3 % 2 === 0`? No
- Return `pricesInEur[1]` (middle value)

**Even count** (e.g., 6 values):
- `mid = Math.floor(6 / 2) = 3`
- `6 % 2 === 0`? Yes
- Return `(pricesInEur[2] + pricesInEur[3]) / 2` (average of two middle values)

## Validation

### Test Case 1: Odd Count
**Input**: `[38800, 40450, 42950]`
- `mid = 1`
- `3 % 2 === 0`? No
- **Result**: `40450` ✓

### Test Case 2: Even Count
**Input**: `[38800, 40450, 42950, 43000, 43500, 44000]`
- `mid = 3`
- `6 % 2 === 0`? Yes
- **Result**: `(42950 + 43000) / 2 = 42975` ✓

### Test Case 3: User Example
**Input**: `[38800, 40450, 42950]`
- **Result**: `40450` ✓ (matches expected)

## Changes Made

### File: `/worker/scraper.js`

**Function**: `computeTargetMarketStats()` (lines 780-786)

**Diff**:
```diff
  const getPercentile = (arr, p) => {
    const index = Math.ceil((arr.length * p) / 100) - 1;
    return arr[Math.max(0, index)];
  };

+ const mid = Math.floor(pricesInEur.length / 2);
+ const median = pricesInEur.length % 2 === 0
+   ? (pricesInEur[mid - 1] + pricesInEur[mid]) / 2
+   : pricesInEur[mid];
+
  const stats = {
-   median_price: pricesInEur[Math.floor(pricesInEur.length / 2)],
+   median_price: median,
    average_price: sum / pricesInEur.length,
    min_price: pricesInEur[0],
    max_price: pricesInEur[pricesInEur.length - 1],
    count: limitedListings.length,
    percentile_25: getPercentile(pricesInEur, 25),
    percentile_75: getPercentile(pricesInEur, 75),
  };
```

**Lines changed**: +4 new lines, 1 modified line

## Constraints Respected

✅ **Max prices used**: 6 (unchanged, line 765: `const MAX_TARGET_LISTINGS = 6`)

✅ **No artificial prices**: The fix only computes median from existing prices in `pricesInEur` array

✅ **Instant runs untouched**: No changes to `/src/lib/scraperClient.ts`

✅ **No filters added**: Only the median calculation formula was fixed

✅ **No new tables/columns**: Pure calculation fix

✅ **Function signature unchanged**: Input/output remains the same

✅ **Minimal diff**: 5 lines total (4 new, 1 modified)

## Build Status

```bash
npm run build
# ✓ built in 10.22s
```

✅ **Ready for deployment**

## Summary

**What was fixed**: The median calculation formula for even-count arrays

**Where**: `worker/scraper.js`, function `computeTargetMarketStats()`, lines 780-786

**Impact**: Scheduled runs now compute mathematically correct medians for both odd and even listing counts

**Risk**: Minimal (isolated calculation fix, no architectural changes)
