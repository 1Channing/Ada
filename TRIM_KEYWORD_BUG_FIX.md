# Trim Keyword Bug Fix

## Bug Summary
**Symptom:** Marktplaats returns "✅ Parsed X listings" but study result shows "Best source: 0€"
**Example:** Yaris Cross 2022 FR→NL with keywords "trail" (Leboncoin) / "adventure" (Marktplaats)

## Root Cause
**File:** `worker/scraper.ts` lines 377-386
**Issue:** Worker used `trimTarget` for filtering BOTH target AND source listings

```typescript
// WRONG (before fix):
const studyCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimTarget || null, // ❌ Used for both markets!
};

const filteredTarget = filterListingsByStudy(targetResult.listings, studyCriteria);
const filteredSource = filterListingsByStudy(sourceResult.listings, studyCriteria);
```

**What happened:**
1. Marktplaats scraped with URL `#q:adventure` → 35 listings with "adventure" in titles
2. Worker filtered source listings looking for "trail" keyword → 0 matches
3. `detectOpportunity()` received empty source array → returned `bestSourcePrice: 0`

## The Fix
**File:** `worker/scraper.ts` lines 377-395
**Change:** Create separate criteria objects for target and source markets

```typescript
// CORRECT (after fix):
const targetCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimTarget || null, // ✅ Use trimTarget for target
};

const sourceCriteria: StudyCriteria = {
  brand: study.brand,
  model: study.model,
  year: study.year,
  max_mileage: study.max_mileage || 0,
  trim_text: trimSource || null, // ✅ Use trimSource for source
};

const filteredTarget = filterListingsByStudy(targetResult.listings, targetCriteria);
const filteredSource = filterListingsByStudy(sourceResult.listings, sourceCriteria);
```

## Impact
- **Scheduled runs (worker):** ✅ FIXED
- **Scheduled runs (edge function):** ✅ Already correct (no change needed)
- **Instant runs (studyRunner):** ✅ Already correct (no change needed)

## Verification
```bash
cd /tmp/cc-agent/60416899/project/worker && npm run build  # ✅ Pass
cd /tmp/cc-agent/60416899/project && npm run build         # ✅ Pass
```

## Expected Behavior After Fix
For study "Yaris Cross 2022 FR→NL trail/adventure":
1. Leboncoin scrapes with "trail" → filters with "trail" ✅
2. Marktplaats scrapes with "adventure" → filters with "adventure" ✅
3. Both markets return valid listings
4. Best source price reflects actual cheapest Marktplaats listing (not 0€)

## Date
2026-01-27
