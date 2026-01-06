# Study Execution Engine Architecture

## Problem Statement

Previously, the MC Export application had **TWO SEPARATE IMPLEMENTATIONS** of market study execution logic:

1. **Instant Searches** (Frontend) - `src/lib/scraperClient.ts`
2. **Scheduled Searches** (Backend) - `supabase/functions/_shared/studyExecutor.ts` + `worker/scraper.js`

These implementations were **drifting apart**, causing **inconsistent results** for the same studies:
- Different filtering rules
- Different median calculations
- Different opportunity detection
- **CRITICAL BUG**: Scheduled searches were NOT filtering by brand/model (fixed in this refactor)

This is **NOT ACCEPTABLE** for a business intelligence system that relies on deterministic, reproducible results.

---

## Solution: Unified Study Execution Engine

We created a **single source of truth** for all business logic:

```
src/lib/study-engine.ts
```

This module is the **AUTHORITATIVE IMPLEMENTATION** of:
- Currency conversion (EUR/DKK)
- Price floor filtering (>2000€)
- Leasing detection
- Damaged vehicle detection
- Brand/model matching
- Year and mileage filtering
- Median price calculation (using 6 cheapest listings)
- Opportunity detection

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│         src/lib/study-engine.ts                              │
│         (SINGLE SOURCE OF TRUTH)                             │
│                                                               │
│  - toEur()                                                   │
│  - shouldFilterListing()                                     │
│  - filterListingsByStudy()                                   │
│  - computeTargetMarketStats()                                │
│  - matchesBrandModel()                                       │
│  - detectOpportunity()                                       │
│  - executeStudyAnalysis()                                    │
│                                                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Delegates to
                       │
         ┌─────────────┴──────────────┬─────────────────────┐
         │                            │                     │
         ▼                            ▼                     ▼
┌────────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│                    │    │                  │    │                   │
│  scraperClient.ts  │    │ worker/scraper.js│    │  studyExecutor.ts │
│  (Frontend)        │    │ (Node.js Worker) │    │  (Deno Edge Fn)   │
│                    │    │                  │    │                   │
│  ✅ Direct import   │    │ ⚠️  Synced copy   │    │ ⚠️  Synced copy    │
│                    │    │                  │    │                   │
└────────────────────┘    └──────────────────┘    └───────────────────┘
         │                            │                     │
         │                            │                     │
         └────────────────────────────┴─────────────────────┘
                                │
                                │ Produces
                                │
                                ▼
                    ┌───────────────────────┐
                    │                       │
                    │   IDENTICAL RESULTS   │
                    │   for same study      │
                    │                       │
                    └───────────────────────┘
```

---

## Implementation Details

### Frontend (src/lib/scraperClient.ts)

**Status:** ✅ Direct delegation

The frontend code imports functions from `study-engine.ts` and delegates to them:

```typescript
import {
  toEur as toEurEngine,
  shouldFilterListing as shouldFilterListingEngine,
  filterListingsByStudy as filterListingsByStudyEngine,
  computeTargetMarketStats as computeTargetMarketStatsEngine,
  matchesBrandModel as matchesBrandModelEngine,
} from './study-engine';

export function toEur(price: number, currency: Currency): number {
  return toEurEngine(price, currency);
}

export function filterListingsByStudy(...) {
  return filterListingsByStudyEngine(...);
}
```

All business logic is delegated. The wrapper functions only add logging for debugging.

### Worker (worker/scraper.js)

**Status:** ⚠️ Synchronized copy

The Node.js worker runs plain JavaScript and cannot import TypeScript directly.

**Solution:** Synchronized copy with **EXPLICIT WARNINGS**:

```javascript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  SYNCHRONIZED COPY FROM STUDY ENGINE - MUST STAY IN SYNC ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SOURCE OF TRUTH: src/lib/study-engine.ts
 * LAST SYNCED: 2024-12-20
 */
```

**CRITICAL:** Any changes to `study-engine.ts` MUST be replicated to `worker/scraper.js`.

### Edge Functions (supabase/functions/_shared/studyExecutor.ts)

**Status:** ⚠️ Synchronized copy

Deno edge functions run in an isolated environment and cannot import from `src/`.

**Solution:** Synchronized copy with **EXPLICIT WARNINGS**:

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  SYNCHRONIZED COPY FROM STUDY ENGINE - MUST STAY IN SYNC ⚠️
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SOURCE OF TRUTH: src/lib/study-engine.ts
 * LAST SYNCED: 2024-12-20
 */
```

**CRITICAL:** Any changes to `study-engine.ts` MUST be replicated to `studyExecutor.ts`.

---

## Critical Bug Fixed

### Before This Refactor

**Scheduled searches** (`studyExecutor.ts`) were **NOT** filtering by brand/model:

```typescript
// OLD CODE (BUGGY):
function filterListingsByStudy(listings, study) {
  return listings.filter(listing => {
    if (listing.price <= 0) return false;
    if (listing.year && Math.abs(listing.year - study.year) > 1) return false;
    if (listing.mileage && listing.mileage > study.max_mileage) return false;
    // ⚠️  MISSING: Brand/model matching!
    return true;
  });
}
```

This meant **scheduled searches included incorrect listings**:
- Toyota Yaris listings in Yaris Cross studies
- BMW 3 Series in BMW X3 studies
- Incorrect median prices
- False opportunities

**Instant searches** (`scraperClient.ts`) correctly filtered by brand/model.

### After This Refactor

**Both pipelines** now use the **SAME filtering logic**:

```typescript
function filterListingsByStudy(listings, study) {
  return listings.filter(listing => {
    if (shouldFilterListing(listing)) return false;  // Price, leasing, damage
    if (listing.year && listing.year < study.year) return false;
    if (listing.mileage && listing.mileage > study.max_mileage) return false;

    // ✅ ADDED: Brand/model matching
    const matchResult = matchesBrandModel(listing.title, study.brand, study.model);
    if (!matchResult.matches) return false;

    return true;
  });
}
```

**Result:** Scheduled and instant searches now produce **IDENTICAL** filtered listings.

---

## Business Rules (Enforced Consistently)

### 1. Currency Conversion

```typescript
const FX_RATES = {
  EUR: 1,
  DKK: 0.13,
  UNKNOWN: 1,
};
```

**Rule:** All prices converted to EUR before comparison.

### 2. Price Floor Filter

```typescript
if (priceEur <= 2000) {
  return true;  // Filter out
}
```

**Rule:** Listings ≤ 2000€ are filtered out (likely leasing or scam).

### 3. Leasing Detection

```typescript
const monthlyKeywords = [
  '/mois', 'per month', 'lease', 'loa', 'lld', ...
];
```

**Rule:** Listings with monthly pricing keywords are filtered out.

### 4. Damaged Vehicle Detection

```typescript
const damageKeywords = [
  'accidenté', 'damaged', 'salvage', 'cat c', 'cat d', ...
];
```

**Rule:** Listings with damage keywords are filtered out.

### 5. Brand/Model Matching

```typescript
const modelTokens = model.toLowerCase().split(/\s+/);
const missingTokens = modelTokens.filter(token => !title.includes(token));
return missingTokens.length === 0;
```

**Rule:** All model tokens must appear in title.

### 6. Year Filter

```typescript
if (listing.year && listing.year < study.year) {
  return false;
}
```

**Rule:** Listing year must be ≥ study year (no older vehicles).

### 7. Mileage Filter

```typescript
if (study.max_mileage > 0 && listing.mileage > study.max_mileage) {
  return false;
}
```

**Rule:** Listing mileage must be ≤ study max mileage (if specified).

### 8. Median Calculation

```typescript
const MAX_TARGET_LISTINGS = 6;
const limitedPrices = sortedPrices.slice(0, 6);

const median = prices.length % 2 === 0
  ? (prices[n/2 - 1] + prices[n/2]) / 2  // Average of middle two
  : prices[Math.floor(n/2)];              // Middle value
```

**Rules:**
- Use **6 cheapest listings** only
- Median = average of two middle values (for even counts)
- Median = middle value (for odd counts)

### 9. Opportunity Detection

```typescript
const priceDifference = targetMedian - bestSourcePrice;
const hasOpportunity = priceDifference >= threshold;
```

**Rule:** Opportunity exists if price difference ≥ threshold (typically 5000€).

---

## Validation

### Manual Validation

To verify that both pipelines produce identical results:

1. **Run an instant search** for a specific study
2. **Schedule the same study** to run immediately
3. **Compare results:**
   - Filtered listing count should be identical
   - Median price should be identical
   - Opportunity status should be identical
   - Best source price should be identical

### Automated Validation (Future)

Create a test that:
1. Generates mock listings
2. Runs both instant and scheduled execution
3. Asserts identical results

Example test structure:

```typescript
// Test data
const mockTargetListings = [...];
const mockSourceListings = [...];
const study = { brand: 'TOYOTA', model: 'YARIS CROSS', year: 2025, max_mileage: 50000 };

// Execute via instant pipeline
const instantResult = executeStudyAnalysis(mockTargetListings, mockSourceListings, study, 5000);

// Execute via scheduled pipeline (mock)
const scheduledResult = executeStudy({ study, runId, threshold: 5000, supabase });

// Assert parity
assert.equal(instantResult.filteredTargetCount, scheduledResult.filteredTargetCount);
assert.equal(instantResult.targetMedianPrice, scheduledResult.targetMedianPrice);
assert.equal(instantResult.status, scheduledResult.status);
```

### SQL Validation Query

Compare results from instant vs scheduled runs:

```sql
-- Find studies executed both ways
WITH instant_results AS (
  SELECT
    study_id,
    target_market_price,
    best_source_price,
    price_difference,
    status
  FROM study_run_results
  WHERE run_id IN (SELECT id FROM study_runs WHERE run_type = 'instant')
),
scheduled_results AS (
  SELECT
    study_id,
    target_market_price,
    best_source_price,
    price_difference,
    status
  FROM study_run_results
  WHERE run_id IN (SELECT id FROM study_runs WHERE run_type = 'scheduled')
)
SELECT
  i.study_id,
  i.target_market_price AS instant_median,
  s.target_market_price AS scheduled_median,
  i.status AS instant_status,
  s.status AS scheduled_status,
  CASE
    WHEN ABS(i.target_market_price - s.target_market_price) < 10 THEN '✅ MATCH'
    ELSE '❌ DRIFT'
  END AS median_parity
FROM instant_results i
JOIN scheduled_results s ON i.study_id = s.study_id
WHERE ABS(i.target_market_price - s.target_market_price) >= 10  -- Allow 10€ tolerance
ORDER BY ABS(i.target_market_price - s.target_market_price) DESC;
```

**Expected Result:** 0 rows (no drift detected).

---

## Maintenance Guidelines

### ✅ DO:

1. **Make ALL business logic changes in `src/lib/study-engine.ts`**
2. **Immediately sync changes to:**
   - `worker/scraper.js` (Node.js worker)
   - `supabase/functions/_shared/studyExecutor.ts` (Deno edge function)
3. **Update LAST_SYNCED date** in sync comments
4. **Run validation tests** after any change
5. **Document new business rules** in this file

### ❌ DO NOT:

1. **Modify business logic directly in worker or edge function**
2. **Add new filters/rules without updating study-engine.ts first**
3. **Allow implementations to drift**
4. **Skip validation after changes**
5. **Assume "close enough" is acceptable**

---

## Synchronization Checklist

When modifying business logic:

- [ ] Update `src/lib/study-engine.ts` (source of truth)
- [ ] Sync changes to `worker/scraper.js`
- [ ] Sync changes to `supabase/functions/_shared/studyExecutor.ts`
- [ ] Update LAST_SYNCED dates in all three files
- [ ] Build project (`npm run build`)
- [ ] Restart worker service
- [ ] Run validation tests
- [ ] Update this documentation if new rules added

---

## Future Improvements

### Option 1: Shared JavaScript Bundle

Compile `study-engine.ts` to JavaScript and include it in:
- Worker deployment
- Edge function deployment

**Pros:** True single source of truth
**Cons:** Build complexity, deployment coordination

### Option 2: Separate Package

Extract `study-engine` into an npm package:
- `@mc-export/study-engine`

**Pros:** Version control, testing in isolation
**Cons:** Overhead, slower iteration

### Option 3: Runtime Import

Use dynamic imports or Deno's npm: specifier:
```typescript
import { toEur } from 'npm:@mc-export/study-engine';
```

**Pros:** No code duplication
**Cons:** Requires package publishing, latency

**Current Decision:** Manual synchronization with explicit warnings is the simplest solution for now. Automated validation tests will catch drift.

---

## Summary

✅ **Unified business logic** - Single source of truth in `study-engine.ts`
✅ **Synchronized copies** - Explicit warnings prevent drift
✅ **Critical bug fixed** - Scheduled searches now filter by brand/model
✅ **Deterministic results** - Same study = same output (instant vs scheduled)
✅ **Clear documentation** - Architecture and rules documented
✅ **Validation ready** - SQL queries and test structure provided

**Result:** MC Export now has a **reliable, deterministic, maintainable** study execution system with **zero tolerance for drift** between instant and scheduled searches.
