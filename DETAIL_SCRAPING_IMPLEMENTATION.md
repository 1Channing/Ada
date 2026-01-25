# Second-Pass Detail Scraping Implementation

## Summary

Implemented detail page scraping for scheduled runs to enrich negotiation cards with:
- Premium options (non-standard features only)
- Maintenance notes (entretien) with seller text
- Defects/condition notes
- Car images

## Changes Made

### 1. Created Detail Page Parser Module
**File:** `src/lib/study-core/detailParsers.ts`

Pure parser functions that extract enriched data from marketplace detail pages:

```typescript
export interface DetailPageData {
  options: string[];              // Premium options (filtered)
  entretien: string;              // Maintenance notes with dates
  defects_summary: string;        // Defect notes from description
  maintenance_summary: string;    // Summary flag
  car_image_urls: string[];       // Gallery images (max 8)
}

// Main function
export function parseDetailPage(html: string, listingUrl: string): DetailPageData
```

**Premium Options Detected:**
- Toit panoramique
- Audio premium (JBL/Harman/Bose/B&O/Burmester)
- Hayon électrique
- Phares LED/Matrix/Laser
- Affichage tête haute (HUD)
- Caméra 360°
- Aide au stationnement
- Régulateur adaptatif (ACC)
- Détection angle mort
- Sièges chauffants/ventilés
- Sièges à mémoire
- Attelage
- Suspension adaptative

**Maintenance Keywords:**
- Révision/entretien/service (with dates)
- Carnet d'entretien/historique
- Distribution/courroie changée
- Pneus neufs
- Contrôle technique OK

**Defect Keywords:**
- Rayures/scratches
- Chocs/impacts
- Usure/worn
- Rouille/rust
- Problèmes/faults
- Accidents

### 2. Updated Worker Scraper
**File:** `worker/scraper.ts`

Added detail scraping function:
```typescript
async function scrapeDetailPage(listingUrl: string): Promise<DetailPageData | null>
```

Updated listing persistence (lines 454-498):
```typescript
// Second-pass: scrape detail pages for enriched data (max 5 for FAST mode)
for (const listing of opportunityResult.interestingListings) {
  let detailData: DetailPageData | null = null;

  if (scrapeMode === 'fast') {
    detailData = await scrapeDetailPage(listing.listing_url);
  }

  listingsToInsert.push({
    // ... existing fields
    defects_summary: detailData?.defects_summary || null,
    maintenance_summary: detailData?.maintenance_summary || null,
    entretien: detailData?.entretien || '',
    options: detailData?.options || [],
    car_image_urls: detailData?.car_image_urls || [],
  });
}
```

**Logging:**
```
[DETAIL_SCRAPE] Fetching listing detail <url>
[DETAIL_SCRAPE] Extracted options=[...], maintenance=yes, defects=no, images=5
```

### 3. UI Display
**File:** `src/pages/StudiesV2Negotiations.tsx`

Already displays enriched fields (lines 250-271):
- **Defects section** (if present)
- **Entretien section** (maintenance notes with dates)
- **Options section** (premium features list)

Display format:
```
┌─────────────────────────────────────────────────┐
│ BMW 320d • 2019 • FR → NL                       │
│                                                  │
│ Source: 18,500€ | Target: 24,000€ | +5,500€    │
│ 2019 • 125,000 km                               │
│─────────────────────────────────────────────────│
│ DEFECTS          | ENTRETIEN        | OPTIONS   │
│ Rayures carross. | Révision 2024    | Toit pan. │
│                  | Courroie changée | Audio JBL │
│                  |                  | Caméra 360│
└─────────────────────────────────────────────────┘
```

## Database Schema

**Existing columns in `study_source_listings`:**
- `entretien` (text) - Added in migration 20251207191540
- `options` (jsonb) - Added in migration 20251207191540
- `car_image_urls` (jsonb) - Added in migration 20251208080732
- `defects_summary` (text) - Original schema
- `maintenance_summary` (text) - Original schema

**No schema changes needed!**

## Execution Flow

### Scheduled Runs (Worker)

```
1. Scrape search pages → Get listings
2. Apply filters & compute median
3. Identify interesting listings (top 5 below threshold)
4. ✨ NEW: For each interesting listing:
   a. Fetch detail page HTML (Zyte)
   b. Parse premium options
   c. Extract maintenance notes
   d. Extract defect notes
   e. Extract car images
5. Insert to study_source_listings with enriched data
```

### Instant Runs (Browser)

Already implemented detail scraping via `SCRAPER_DETAIL()` function.
This implementation brings scheduled runs to parity.

## Performance

**Fast Mode (default):**
- Max 5 interesting listings per study
- One Zyte API call per listing
- Sequential fetching (one by one)
- ~2-3 seconds per detail page
- Total: ~10-15 seconds for 5 listings

**Impact:**
- Study execution time increases by ~10-15s when opportunities found
- No impact when no opportunities detected (NULL results)
- Zyte API cost: 1 credit per detail page

## Testing

### Verify Detail Scraping Works

```sql
-- Check if listings have enriched data
SELECT
  listing_url,
  options,
  entretien,
  defects_summary,
  array_length(car_image_urls::json::text[]::text[], 1) as image_count
FROM study_source_listings
WHERE created_at > NOW() - INTERVAL '1 hour'
AND run_result_id IN (
  SELECT id FROM study_run_results
  WHERE created_at > NOW() - INTERVAL '1 hour'
  AND status = 'OPPORTUNITIES'
);
```

### Expected Results

For each listing:
- `options`: Array of 2-5 premium features (or empty)
- `entretien`: 1-3 sentences with maintenance info (or empty)
- `defects_summary`: 1-3 sentences with defects (or empty)
- `car_image_urls`: Array of 3-8 image URLs

### UI Verification

1. Navigate to **Negotiations** tab
2. Listings should show:
   - **Options row** (if premium features detected)
   - **Entretien row** (if maintenance mentioned)
   - **Defects row** (if defects mentioned)

## Rollback

If issues occur, disable detail scraping:

```typescript
// worker/scraper.ts, line 465
if (scrapeMode === 'fast') {
  // detailData = await scrapeDetailPage(listing.listing_url);
  detailData = null; // ← Disable detail scraping
}
```

Study execution will continue normally, just without enriched fields.

## Build Status

✅ Frontend: `npm run build` passes
✅ Worker: `npm run build:worker` passes
✅ TypeScript: No errors

## Files Modified

1. `src/lib/study-core/detailParsers.ts` (NEW)
2. `worker/scraper.ts` (UPDATED)

## Files Unchanged

- Database migrations (schema already has columns)
- UI components (already displays fields)
- Business logic (median/filtering unchanged)
- Instant runs (already have detail scraping)

---

**Status:** Complete ✅
**Next Deploy:** Ready for production
