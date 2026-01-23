# Trim Filter Fix - Implementation Complete

**Date:** 2026-01-23
**Issue:** Marktplaats #q: hash parameter is client-side only, causing wrong listings to be used for median calculation

## Root Cause

The median calculation for Toyota Yaris Cross GR showed €27,347 instead of ~€31,500 because:

1. **URL-based trim filtering doesn't work server-side**: Marktplaats `#q:gr` parameter is applied by JavaScript in the browser
2. **Zyte returns unfiltered HTML**: The scraper receives ALL listings regardless of trim
3. **Non-GR listings polluted the median**: Cars like "Sport" and "Dynamic" were included in the 6 cheapest, lowering the median

## Implementation (Scope-Limited Fix)

### ✅ What Was Changed

**1. Added Code-Level Trim Filter (`src/lib/study-core/business-logic.ts`)**

```typescript
// Known trim variant mappings
const TRIM_VARIANT_MAP: Record<string, string[]> = {
  'gr': ['gr', 'gr sport', 'gr-sport', 'gazoo racing', 'gazoo-racing'],
  'rs': ['rs', 'rs line', 'rs-line'],
  // ... other trims
};

function matchesTrim(listing: ScrapedListing, trim: string): boolean {
  if (!trim) return true;

  const trimLower = trim.toLowerCase().trim();
  const text = `${listing.title} ${listing.description}`.toLowerCase();

  // Strategy 1: Check known variants
  const knownVariants = TRIM_VARIANT_MAP[trimLower];
  if (knownVariants) {
    return knownVariants.some(variant => text.includes(variant));
  }

  // Strategy 2: Safe token matching (all tokens must appear)
  // Prevents false matches like "Sport" passing as "GR Sport"
  return trimTokens.every(token => text.includes(token));
}
```

**Applied in `filterListingsByStudy()` before sorting and median calculation**

**2. Updated All Execution Paths**

✅ **Worker Pipeline** (`worker/scraper.ts`):
```typescript
const studyCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimTarget || null, // ✅ NOW INCLUDED
};
```

✅ **Instant Studies** (`src/services/studyRunner.ts`):
```typescript
const targetCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimTarget || null, // ✅ NOW INCLUDED
};
```

✅ **Edge Functions** (`supabase/functions/_shared/studyExecutor.ts`):
```typescript
const targetCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimTarget || null, // ✅ NOW INCLUDED
};
```

**3. Added Debug Logging (Optional)**

```typescript
const DEBUG_TRIM_FILTER = false; // Set to true for diagnostics

// Logs:
// - Number of listings before/after trim filter
// - Rejected count
// - Prices of 6 listings used for median (with titles)
```

### ❌ What Was NOT Changed

✅ **Median calculation formula**: Still uses average of two middle values
✅ **6-listing limit**: Still uses only 6 cheapest listings
✅ **Business logic flow**: No changes to execution order
✅ **Other filtering logic**: Year, mileage, damage detection unchanged

## Validation Checklist

| Requirement | Status |
|------------|--------|
| Median still uses exactly 6 listings | ✅ Confirmed |
| Trim filtering is code-driven, not URL-dependent | ✅ Confirmed |
| No other behavior was modified | ✅ Confirmed |
| Applied to instant studies | ✅ Confirmed |
| Applied to scheduled studies (worker) | ✅ Confirmed |
| Applied to edge functions | ✅ Confirmed |
| Build passes | ✅ Confirmed |

## Test Plan

**Re-run Toyota Yaris Cross Study:**

```
Brand: Toyota
Model: Yaris Cross
Year: 2024
Trim: GR
Target: NL (Marktplaats)
Source: FR (Leboncoin)
```

**Expected Result:**

1. All 6 listings used for median should be GR variants
2. Median should be ~€31,500+ (matching visible market)
3. No "Sport", "Dynamic", or other non-GR trims in the 6 cheapest

**Verification:**

```sql
-- Check latest run result
SELECT
  target_market_price,
  target_stats->>'min_price' as min,
  target_stats->>'max_price' as max,
  target_stats->>'count' as count
FROM study_run_results
WHERE study_id = '<study_id>'
ORDER BY created_at DESC
LIMIT 1;
```

## Architecture Notes

**Trim Filter Execution Order:**

```
1. Scrape listings (unfiltered HTML from Zyte)
2. Parse listings (extract all vehicles)
3. ✅ FIRST PASS FILTERS (price floor, leasing, damage)
4. ✅ SECOND PASS FILTERS (brand/model, year, mileage, TRIM)
5. Sort by price ascending
6. Take 6 cheapest
7. Calculate median
```

**Why This Works:**

- Trim filter is applied in JavaScript (our code) AFTER scraping
- No reliance on marketplace client-side filtering
- Same logic used across all execution environments
- Deterministic results (instant vs scheduled match)

## Impact

✅ **Fixes**: Wrong median prices for trim-specific studies
✅ **Preserves**: All existing behavior and business rules
✅ **Applies**: To all markets (NL, FR, DK)
✅ **Maintains**: 6-listing limit for median calculation

## Files Modified

1. `src/lib/study-core/business-logic.ts` - Added trim filtering logic
2. `worker/scraper.ts` - Pass trim_text to StudyCriteria
3. `src/services/studyRunner.ts` - Build proper StudyCriteria with trim
4. `supabase/functions/_shared/studyExecutor.ts` - Build proper StudyCriteria with trim

## Next Steps

1. Deploy worker to Railway: `cd worker && npm run build`
2. Re-run Toyota Yaris Cross GR study
3. Verify median is now ~€31,500+
4. Check logs to confirm GR listings are being used
5. Enable `DEBUG_TRIM_FILTER = true` if diagnostics needed
