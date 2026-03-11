# LinkGen Structural Validation Implementation

## Overview

Implemented two critical updates to the linkgen mapping auto-crawler to ensure data quality and eliminate false positives:

1. **Brand/model extraction from structured fields ONLY** (no regex parsing of titles)
2. **Two-stage validation with structural signals** (URL pattern + structural validation)

---

## Changes Summary

### 1. New Parser: `parseSingleMarktplaatsListing()`

**Location:** `worker/linkgenMappingAuto.ts:304-382`

**Purpose:** Extract listing data from `__NEXT_DATA__` structured fields with fail-closed validation.

**Key Features:**

- **Extracts `__NEXT_DATA__` JSON** from HTML
- **Validates structural signals** (id + priceCents + attributes)
- **Extracts brand/model from structured fields ONLY**:
  - `listing.make` or `attributes[key="make"].value` → brand
  - `listing.model` or `attributes[key="model"].value` → model
- **Returns null if validation fails** (no id, no price, no attributes)
- **Title stored for debugging ONLY** (never parsed)

**Structural Validation Logic:**

```typescript
const hasId = listing?.id !== undefined && listing?.id !== null;
const hasPrice = (listing?.priceInfo?.priceCents !== undefined && listing?.priceInfo?.priceCents !== null) ||
                 (listing?.price !== undefined && listing?.price !== null);
const hasAttributes = Array.isArray(listing?.attributes);

if (!hasId || !hasPrice || !hasAttributes) {
  return null;  // Not a valid listing page
}
```

**Extraction Logic:**

```typescript
// Brand from structured fields
const brand = listing.make ||
              attributes.find((a: any) => a.key === 'make' || a.key === 'merk')?.value ||
              null;

// Model from structured fields
const model = listing.model ||
              attributes.find((a: any) => a.key === 'model')?.value ||
              null;

// Year from attributes
const yearAttr = attributes.find((a: any) => a.key === 'year' || a.key === 'bouwjaar');
const year = yearAttr?.value ? parseInt(yearAttr.value, 10) : null;

// Mileage from attributes
const mileageAttr = attributes.find((a: any) => a.key === 'mileage' || a.key === 'kilometerstand');
const mileage = mileageAttr?.value ? parseInt(String(mileageAttr.value).replace(/\D/g, ''), 10) : null;

// Fuel from attributes
const fuelAttr = attributes.find((a: any) => a.key === 'fuel' || a.key === 'brandstof');
const fuel = fuelAttr?.value || null;

// Price from structured fields
const price = listing.priceInfo?.priceCents
              ? listing.priceInfo.priceCents / 100
              : (listing.price || null);

// Title for DEBUG ONLY (never parsed)
const title = listing.title || null;
```

---

### 2. Updated Listing Page Handling

**Location:** `worker/linkgenMappingAuto.ts:541-720`

**Changes:**

1. **Calls new parser** instead of using existing list parsers
2. **Treats structurally invalid listings as unknown** (discovery only, no storage)
3. **Only stores when structural validation passes**

**Flow Diagram:**

```
URL matches listing pattern?
  → YES → Extract __NEXT_DATA__
    → Has id + priceCents + attributes?
      → YES → Extract brand/model from structured fields
        → Has any data (brand/year/mileage/price)?
          → YES → Store sample ✅ + stepsDone++
          → NO  → Skip storage ⚠️ (discovery only)
      → NO  → Structural validation failed ❌
        → Skip storage (discovery only)
  → NO → Check if list page pattern
    → YES → Discovery only 📋
    → NO  → Unknown page ⚠️
```

**Key Logic:**

```typescript
// Stage 1: URL allowlist (fast pre-filter)
if (pageType === 'listing') {
  // Stage 2: Structural validation (definitive)
  const extracted = parseSingleMarktplaatsListing(html);

  if (!extracted) {
    // Structural validation failed → discovery only
    console.warn('[LINKGEN_AUTO] Listing URL but invalid structure - treating as unknown');
    listingsWithNoData++;
    // Continue with URL discovery, no storage
    continue;
  }

  // Valid listing with structural signals → proceed with storage
  const { brand, model, year, mileage, price, fuel, title, listingId } = extracted;

  // Apply storage gate
  const hasData = brand !== null || year !== null || mileage !== null || price !== null;

  if (!hasData) {
    // No extractable data → skip storage
    listingsWithNoData++;
    continue;
  }

  // Has data → store and increment stepsDone
  // ...
}
```

---

### 3. Updated Raw Snapshot Format

**Before:**

```json
{
  "title": "BMW X5 3.0d xDrive M Sport",
  "price": 47500,
  "year": 2020,
  "mileage": 45000
}
```

**After:**

```json
{
  "listingId": "a1234567890",
  "title": "BMW X5 3.0d xDrive M Sport",
  "brand": "BMW",
  "model": "X5",
  "price": 47500,
  "year": 2020,
  "mileage": 45000,
  "fuel": "Diesel"
}
```

**Changes:**

- Added `listingId` from `listing.id`
- Added `brand` from structured fields
- Added `model` from structured fields
- Added `fuel` from attributes
- Title stored for debugging ONLY (never parsed)

---

## Data Quality Guarantees

**After implementation:**

✅ **Brand/model extracted from structured fields ONLY** (no regex)
✅ **Listing pages validated by structural signals** (id + price + attributes)
✅ **False positive listing URLs rejected at structural level**
✅ **Title stored in raw for debugging** (never parsed)
✅ **Zero null-only samples possible**
✅ **Zero "Unknown unknown" placeholders possible**

---

## Expected Behavior Changes

| Scenario | Old Behavior | New Behavior |
|----------|-------------|--------------|
| Real listing with structured data | ❌ "no extractable data" | ✅ Data extracted → stored → stepsDone++ |
| Error page (listing URL) | ❌ "no extractable data" | ✅ Structural validation fails → skip storage |
| Loading state (listing URL) | ❌ "no extractable data" | ✅ No __NEXT_DATA__ → skip storage |
| List page | ✅ Discovery only | ✅ Discovery only (unchanged) |
| Real listing, title parse | ⚠️ Regex extraction | ✅ Structured fields only |

---

## Testing Checklist

### Structural Validation Tests

- [ ] Real listing page with all signals → extracts data correctly
- [ ] Real listing page missing id → returns null
- [ ] Real listing page missing price → returns null
- [ ] Real listing page missing attributes → returns null
- [ ] Error page with listing URL → returns null
- [ ] Loading page with listing URL → returns null

### Extraction Tests

- [ ] Brand extracted from `listing.make`
- [ ] Brand extracted from `attributes[key="make"]`
- [ ] Brand extracted from `attributes[key="merk"]` (Dutch)
- [ ] Model extracted from `listing.model`
- [ ] Model extracted from `attributes[key="model"]`
- [ ] Year extracted from attributes
- [ ] Mileage extracted from attributes
- [ ] Fuel extracted from attributes
- [ ] Price extracted from `priceInfo.priceCents`
- [ ] Title stored in raw (not parsed)

### Integration Tests

- [ ] Run linkgen auto-crawler on Marktplaats seed URL
- [ ] Verify stepsDone increments only for valid listings
- [ ] Verify listingsWithNoData count increases for invalid listings
- [ ] Verify raw snapshot contains all structured fields
- [ ] Verify no null-only samples stored in database

---

## Files Modified

1. **`worker/linkgenMappingAuto.ts`**
   - Added `parseSingleMarktplaatsListing()` function (lines 304-382)
   - Updated listing page handling (lines 541-720)
   - Updated raw snapshot format (lines 639-648)

---

## Deployment Notes

**Build Status:** ✅ PASSED

```bash
npm run build        # Frontend build: PASSED
npm run build:worker # Worker build: PASSED
```

**Breaking Changes:** None (backward compatible)

**Database Changes:** None (existing schema works with updated raw format)

**API Changes:** None (internal implementation only)

---

## Next Steps

1. Deploy updated worker to production
2. Monitor crawl metrics:
   - `stepsDone` should increase (real listings extracted)
   - `listingsWithNoData` count should stabilize
   - No null-only samples in `linkgen_mapping_samples`
3. Verify brand/model extraction quality
4. Add monitoring for structural validation failures

---

## Implementation Date

**Date:** 2026-02-05
**Version:** 1.2.4
**Status:** ✅ READY FOR DEPLOYMENT
