# Unified Study Execution Pipeline

**Version:** 1.0.0
**Date:** 2026-01-07
**Status:** ✅ Implemented

## Overview

The unified pipeline ensures that **INSTANT** (user-triggered) and **SCHEDULED** (background) study runs produce **identical results** for the same study. This eliminates the divergence that was causing inconsistent medians, opportunity detection, and pricing.

## Problem Solved

### Before: Divergent Pipelines

**INSTANT (Browser)**
- Used `src/lib/scraperClient.ts` for scraping
- Used `src/lib/study-engine.ts` for business logic
- Advanced JSON parsing, pagination, retry strategies
- Comprehensive anti-contamination checks

**SCHEDULED (Worker/Edge)**
- Used `worker/scraper.js` or `supabase/functions/_shared/studyExecutor.ts`
- Had **synchronized copies** of business logic (lines 592-845 in worker)
- Simplified scraping without advanced features
- **Result:** Different listing pools → Different medians → Divergence

### After: Unified Pipeline

**BOTH Environments**
- Use `src/lib/study-core/` for ALL business logic
- Same filtering rules (price floor, leasing, damage, brand/model)
- Same median calculation (top 6 cheapest, average of middle two)
- Same opportunity detection (threshold comparison)
- **Result:** Identical business logic → Consistent results

## Architecture

```
src/lib/study-core/
├── types.ts              # Shared type definitions
├── business-logic.ts     # ALL business rules (SINGLE SOURCE OF TRUTH)
├── scraping.ts           # Scraping interfaces and helpers
└── index.ts              # High-level API with feature flags

Delegates to study-core:
├── src/lib/study-engine.ts       ✅ Re-exports from study-core
├── src/lib/scraperClient.ts      ✅ Imports from study-engine
├── worker/scraper.js             ⚠️  Synchronized copy (Node.js compat)
└── supabase/functions/_shared/   ❌ Deprecated (will be removed)
```

## Business Logic (Unified)

**src/lib/study-core/business-logic.ts** contains:

1. **Currency Conversion**
   - `toEur(price, currency)` - Converts DKK/EUR to EUR

2. **Filtering**
   - `shouldFilterListing(listing)` - First-pass filter (price floor ≤2000€, leasing, damage)
   - `filterListingsByStudy(listings, study)` - Study-specific filter (brand/model/year/mileage)
   - `matchesBrandModel(title, brand, model)` - Token-based matching

3. **Statistics**
   - `computeTargetMarketStats(listings)` - Median from top 6 cheapest
   - Median calculation: Average of two middle values for even counts

4. **Opportunity Detection**
   - `detectOpportunity(targetListings, sourceListings, threshold)` - Finds arbitrage opportunities
   - Returns up to 5 interesting listings below (target_median - threshold)

5. **Complete Execution**
   - `executeStudyAnalysis(targetListings, sourceListings, study, threshold)` - Orchestrates full flow

## Feature Flags

Control rollout via environment variables:

```bash
# Enable unified pipeline (default: false for safety)
VITE_USE_SHARED_CORE=false
USE_SHARED_CORE=false

# Enable parity validation logging
VITE_ENABLE_PARITY_VALIDATION=true
ENABLE_PARITY_VALIDATION=true

# Enable debug logging
VITE_ENABLE_DEBUG_LOGGING=false
ENABLE_DEBUG_LOGGING=false
```

### Rollout Strategy

1. **Phase 1:** Deploy with `USE_SHARED_CORE=false` (legacy mode)
2. **Phase 2:** Enable for 10% of runs, monitor parity
3. **Phase 3:** Increase to 50%, then 100%
4. **Phase 4:** Remove legacy code after 30 days

## Parity Testing

### Run Tests

```bash
npm run test:parity
```

### What is Tested

- ✅ Currency conversion (EUR, DKK)
- ✅ Brand/model matching (token-based)
- ✅ Listing filtering (leasing, damage, price floor)
- ✅ Market statistics (top 6, median calculation)
- ✅ Opportunity detection (threshold comparison)
- ✅ Deterministic results (same input → same output)

### Expected Output

```
═══════════════════════════════════════════════════
PARITY TESTS - BUSINESS LOGIC
═══════════════════════════════════════════════════

✅ Currency conversion - EUR to EUR
✅ Currency conversion - DKK to EUR
✅ Brand/model matching - Valid match
✅ Brand/model matching - Missing brand
✅ Brand/model matching - Missing model token
✅ Filtering - Leasing should be filtered
✅ Filtering - Damaged should be filtered
✅ Filtering - Low price should be filtered
✅ Filtering - Valid listing should not be filtered
✅ Study filtering - Should filter correctly
✅ Market stats - Top 6 cheapest only
✅ Market stats - Median calculation (even count)
✅ Opportunity detection - Should detect opportunity
✅ Opportunity detection - Interesting listings count
✅ Full study analysis - Deterministic results
✅ Parity check - Identical results

═══════════════════════════════════════════════════
✅ ALL PARITY TESTS PASSED
═══════════════════════════════════════════════════
```

## Migration Status

### ✅ Completed

- **study-engine.ts** - Now re-exports from study-core
- **scraperClient.ts** - Imports from study-engine (delegates to study-core)
- **worker/scraper.js** - Header added, synchronized copy documented
- **studyExecutor.ts** - Deprecated with clear warnings
- **Parity tests** - Created with comprehensive coverage
- **Feature flags** - Added to .env.example

### ⚠️ In Progress

- **worker/scraper.js** - Still has synchronized copy (for Node.js compatibility)
- **Future:** Convert to TypeScript and import directly from study-core

### ❌ Deprecated

- **supabase/functions/_shared/studyExecutor.ts** - Will be removed 2026-02-01

## Usage Examples

### For INSTANT Studies (Browser)

```typescript
import { executeStudyAnalysis } from './lib/study-engine';
import { SCRAPER_SEARCH } from './lib/scraperClient';

// Scrape markets (browser-specific)
const targetResult = await SCRAPER_SEARCH(targetUrl, 'full');
const sourceResult = await SCRAPER_SEARCH(sourceUrl, 'full');

// Execute study (unified logic)
const result = executeStudyAnalysis(
  targetResult.listings,
  sourceResult.listings,
  study,
  threshold
);

console.log('Status:', result.status);
console.log('Target median:', result.targetMedianPrice);
console.log('Best source:', result.bestSourcePrice);
console.log('Difference:', result.priceDifference);
```

### For SCHEDULED Studies (Worker)

```javascript
// worker/scraper.js
import { scrapeSearch, executeStudy } from './scraper.js';

// Scrape markets (Node.js-specific)
const targetResult = await scrapeSearch(targetUrl, 'fast');
const sourceResult = await scrapeSearch(sourceUrl, 'fast');

// Execute study (uses synchronized copy of study-core logic)
const result = await executeStudy({
  study,
  runId,
  threshold,
  scrapeMode: 'fast',
  supabase,
  scheduledJobId
});

console.log('Status:', result.status);
// Note: worker handles persistence automatically
```

## Validation in Production

### Monitor Parity

```sql
-- Compare instant vs scheduled medians (last 24 hours)
SELECT
  s.id,
  s.brand,
  s.model,
  instant.median as instant_median,
  scheduled.median as scheduled_median,
  ABS(instant.median - scheduled.median) as diff,
  CASE
    WHEN ABS(instant.median - scheduled.median) <= 2 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status
FROM studies_v2 s
CROSS JOIN LATERAL (
  SELECT target_market_price as median
  FROM study_run_results
  WHERE study_id = s.id
    AND created_at > NOW() - INTERVAL '24 hours'
    AND status != 'TARGET_BLOCKED'
  ORDER BY created_at DESC
  LIMIT 1
) instant
CROSS JOIN LATERAL (
  SELECT target_market_price as median
  FROM study_run_results srr
  JOIN study_runs sr ON srr.run_id = sr.id
  WHERE srr.study_id = s.id
    AND sr.mode = 'scheduled'
    AND srr.created_at > NOW() - INTERVAL '24 hours'
    AND srr.status != 'TARGET_BLOCKED'
  ORDER BY srr.created_at DESC
  LIMIT 1
) scheduled
WHERE ABS(instant.median - scheduled.median) > 2
ORDER BY diff DESC;
```

Expected: **0 rows** (all studies within 2€ tolerance)

## Troubleshooting

### Divergence Detected

If parity tests fail or monitoring shows divergence:

1. **Check feature flags**: Ensure `USE_SHARED_CORE` is consistent
2. **Verify synchronization**: worker/scraper.js business logic must match study-core
3. **Review logs**: Look for "[PARITY]" tagged messages
4. **Run parity tests**: `npm run test:parity`
5. **Rollback**: Set `USE_SHARED_CORE=false` to revert to legacy

### Build Errors

If TypeScript compilation fails:

```bash
npm run typecheck
```

Common issues:
- Missing type exports in study-core/types.ts
- Circular dependencies (study-engine ↔ study-core)
- Import path issues (use relative paths)

## Key Files

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/study-core/business-logic.ts` | Single source of truth for business logic | ✅ Active |
| `src/lib/study-core/types.ts` | Shared type definitions | ✅ Active |
| `src/lib/study-core/scraping.ts` | Scraping interfaces and helpers | ✅ Active |
| `src/lib/study-core/index.ts` | High-level API and feature flags | ✅ Active |
| `src/lib/study-engine.ts` | Compatibility layer (re-exports) | ✅ Active |
| `src/lib/scraperClient.ts` | Browser scraping (delegates to study-core) | ✅ Active |
| `worker/scraper.js` | Worker scraping (synchronized copy) | ⚠️  Active (to be migrated) |
| `supabase/functions/_shared/studyExecutor.ts` | Edge function | ❌ Deprecated |
| `test/parity/business-logic-parity.test.ts` | Parity tests | ✅ Active |

## Next Steps

1. **Monitor parity** in production (run SQL query above daily)
2. **Enable feature flag** gradually (10% → 50% → 100%)
3. **Convert worker to TypeScript** (eliminate synchronized copy)
4. **Remove studyExecutor.ts** after 30-day deprecation period
5. **Add integration tests** for full instant vs scheduled parity

## Support

For questions or issues:
- Check deprecation warnings in console logs
- Review parity test output
- Examine `[PARITY]` tagged log messages
- Verify feature flags in .env

---

**CRITICAL:** The business logic in `src/lib/study-core/business-logic.ts` is the SINGLE SOURCE OF TRUTH. Do NOT modify duplicated copies. Update study-core and let the synchronized copies follow.
