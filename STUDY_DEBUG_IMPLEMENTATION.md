# Study Debug Instrumentation - Implementation Complete

## Overview
Surgical dev-only debug instrumentation for diagnosing study execution issues. Zero production impact, fail-closed design, bounded logging.

## Environment Variables

### `STUDY_DEBUG=true`
Enables all study debug logs with prefixed output:
- `[STUDY_DEBUG_FETCH]` - Zyte fetch results
- `[STUDY_DEBUG_PARSED]` - Parser output
- `[STUDY_DEBUG_FILTER]` - Filter statistics
- `[STUDY_DEBUG_STATS]` - Median calculation

### `STUDY_DEBUG_HTML=true`
Additionally writes received HTML to `/tmp` files (requires `STUDY_DEBUG=true` to be enabled).

## Implementation Details

### Files Modified
1. `worker/scraper.ts` - Added Layers A & B (fetch and parse instrumentation)
2. `src/lib/study-core/business-logic.ts` - Added Layer C (filter tracking) and stats logging

### Layer A: Fetch Instrumentation
**Location:** `worker/scraper.ts` - `fetchHtmlWithZyte()` function (line ~113)

**What it logs:**
```
[STUDY_DEBUG_FETCH] marketplace=MARKTPLAATS url=<full_url> status=200 content_type=application/json html_length=123456 has_next_data=true has_ld_json=false
```

**HTML File Writes (if `STUDY_DEBUG_HTML=true`):**
- **Primary pattern (deterministic):**
  `/tmp/study_<runId>_<studyKey>_<marketplace>_<country>.html`

- **Fallback pattern (if context missing):**
  `/tmp/study_<timestamp>_<marketplace>_<country>.html`

- **studyKey extraction logic:**
  - If `study.id` starts with "MS_", use it
  - Otherwise: `study.study_key ?? study.key ?? String(study.id)`

**Example output:**
```
[STUDY_DEBUG_HTML] Written to: /tmp/study_abc123_MS_VOLKSWAGEN_TIGUAN_2024_FR_NL_MARKTPLAATS_NL.html (234567 bytes) preview: <!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta...
```

### Layer B: Parse Instrumentation
**Location:** `worker/scraper.ts` - `scrapeSearch()` function (line ~239)

**What it logs:**
```
[STUDY_DEBUG_PARSED] marketplace=MARKTPLAATS parsedCount=45 missing_price=2 missing_year=0 missing_mileage=5 min_price=12500 max_price=45000
[STUDY_DEBUG_PARSED] === 10 CHEAPEST (by price) ===
[STUDY_DEBUG_PARSED] 1. €12500 | 2021 | 85000km | Volkswagen Tiguan 2.0 TDI... | https://www.marktplaats.nl/...
...
[STUDY_DEBUG_PARSED] === FIRST 10 RAW (original order) ===
[STUDY_DEBUG_PARSED] 1. €15900 | 2020 | 120000km | VW Tiguan 2.0 TDI... | https://www.marktplaats.nl/...
...
```

**Features:**
- Shows parsed count and data quality metrics
- Displays 10 cheapest listings (sorted by price)
- Displays first 10 listings (original order from HTML)
- Fields: price, year, mileage (80 char title, 120 char URL)

### Layer C: Filter Instrumentation
**Location:** `src/lib/study-core/business-logic.ts` - `filterListingsByStudy()` function (line ~352)

**What it logs:**
```
[STUDY_DEBUG_FILTER] === FILTER SUMMARY ===
[STUDY_DEBUG_FILTER] Total input (parsedCount): 45
[STUDY_DEBUG_FILTER] After shouldFilter: 38
[STUDY_DEBUG_FILTER] After criteria filters (passedCount): 22
[STUDY_DEBUG_FILTER] Total rejected: 23
[STUDY_DEBUG_FILTER] Rejected by price_floor: 5
[STUDY_DEBUG_FILTER] Rejected by monthly_price: 2
[STUDY_DEBUG_FILTER] Rejected by damaged: 0
[STUDY_DEBUG_FILTER] Rejected by year: 8
[STUDY_DEBUG_FILTER] Rejected by mileage: 3
[STUDY_DEBUG_FILTER] Rejected by brand_model: 2
[STUDY_DEBUG_FILTER] Rejected by trim: 3
[STUDY_DEBUG_FILTER] === EXAMPLES: price_floor (showing up to 5) ===
[STUDY_DEBUG_FILTER] €1500 | 2018 | 150000km | VW Tiguan defect... | €1500 (1500 EUR)
...
```

**Features:**
- Inline rejection capture (no two-pass, no logic changes)
- Stage counts: parsedCount → afterShouldFilter → passedCount
- Up to 5 examples per rejection bucket
- Shows which filter rejected the listing and why

**Helper Function:**
- `detectFilterReason()` - Mirrors `shouldFilterListing()` logic to return specific reason
- Used ONLY for debug, does NOT replace production filter

### Stats Logging
**Location:** `src/lib/study-core/business-logic.ts` - `computeTargetMarketStats()` function (line ~554)

**What it logs:**
```
[STUDY_DEBUG_STATS] Using MAX_TARGET_LISTINGS=6 for median calculation
[STUDY_DEBUG_STATS] Actually using top N=6 (filtered count may be less than 6)
[STUDY_DEBUG_STATS] TOP N prices for median: [€12500, €13900, €14500, €15200, €15900, €16500]
```

**Features:**
- Shows exact MAX_TARGET_LISTINGS constant (always 6)
- Shows actual count used (may be less if fewer listings available)
- Shows exact prices array used for median calculation
- Directly comparable with UI results

## Context Passing

**DebugContext Interface:**
```typescript
interface DebugContext {
  runId: string;
  studyId: string;
  studyKey: string;  // MS_... or fallback
  marketplace: string;  // MARKTPLAATS, LEBONCOIN, etc.
  country: string;  // NL, FR, DK, etc.
}
```

**Flow:**
1. `executeStudy()` builds `targetDebugContext` and `sourceDebugContext` (if `STUDY_DEBUG=true`)
2. Passed to `scrapeSearch(url, scrapeMode, debugContext)`
3. Passed to `fetchHtmlWithZyte(url, profileLevel, debugContext)`
4. Used for logging and HTML filename generation

**Minimal blast radius:**
- Only `scraper.ts` signatures changed
- No changes to other files or public APIs
- All parameters are optional (`debugContext?: DebugContext`)

## No Production Impact

### Zero Logic Changes
- `shouldFilterListing()` unchanged
- `filterListingsByStudy()` filter logic unchanged
- `computeTargetMarketStats()` median calculation unchanged
- All debug code is gated by `if (STUDY_DEBUG)` checks

### Fail-Closed Design
- All debug blocks wrapped in `try-catch`
- Errors logged but never throw
- Debug failures never affect production execution

### Bounded Logging
- Parsed dump: 10 cheapest + first 10 raw (max 20 listings)
- Filter examples: 5 per bucket (max 35 total)
- HTML preview: 200 chars
- Title: 60-80 chars
- URL: 120 chars

## Usage

### Local Development
```bash
# Terminal 1: Frontend (auto-started)
npm run dev

# Terminal 2: Worker with debug
cd worker
STUDY_DEBUG=true STUDY_DEBUG_HTML=true npm start
```

### Railway Production
Set environment variables in Railway dashboard:
```
STUDY_DEBUG=true
STUDY_DEBUG_HTML=true  # optional
```

View logs:
```bash
railway logs --tail
```

Grep for specific layers:
```bash
railway logs | grep STUDY_DEBUG_FETCH
railway logs | grep STUDY_DEBUG_PARSED
railway logs | grep STUDY_DEBUG_FILTER
railway logs | grep STUDY_DEBUG_STATS
```

### Disable Debug
```bash
# Remove or set to false
unset STUDY_DEBUG
unset STUDY_DEBUG_HTML
```

## Expected Output Flow

For a typical study run with `STUDY_DEBUG=true`:

1. **Fetch Layer (per market)**
   ```
   [STUDY_DEBUG_FETCH] marketplace=MARKTPLAATS url=... status=200 ...
   [STUDY_DEBUG_HTML] Written to: /tmp/study_... (if enabled)
   ```

2. **Parse Layer (per market)**
   ```
   [STUDY_DEBUG_PARSED] marketplace=MARKTPLAATS parsedCount=45 ...
   [STUDY_DEBUG_PARSED] === 10 CHEAPEST (by price) ===
   [STUDY_DEBUG_PARSED] === FIRST 10 RAW (original order) ===
   ```

3. **Filter Layer (per market)**
   ```
   [STUDY_DEBUG_FILTER] === FILTER SUMMARY ===
   [STUDY_DEBUG_FILTER] Total input (parsedCount): 45
   [STUDY_DEBUG_FILTER] After shouldFilter: 38
   [STUDY_DEBUG_FILTER] After criteria filters (passedCount): 22
   [STUDY_DEBUG_FILTER] === EXAMPLES: <bucket> ===
   ```

4. **Stats Layer (per market)**
   ```
   [STUDY_DEBUG_STATS] Using MAX_TARGET_LISTINGS=6 ...
   [STUDY_DEBUG_STATS] TOP N prices for median: [€X, €X, ...]
   ```

## Validation Checklist

- ✅ Builds pass without errors
- ✅ Logs show `[STUDY_DEBUG_FETCH]` with full details
- ✅ Logs show `[STUDY_DEBUG_PARSED]` with parsedCount and samples
- ✅ Logs show `[STUDY_DEBUG_FILTER]` with stage counts and rejection breakdown
- ✅ Logs show `[STUDY_DEBUG_STATS]` with top N prices for median
- ✅ HTML files written to `/tmp` with deterministic filenames (if `STUDY_DEBUG_HTML=true`)
- ✅ All debug code wrapped in `if (STUDY_DEBUG)` and `try-catch`
- ✅ No production logic modified
- ✅ studyKey extraction follows: `study.id.startsWith("MS_") ? study.id : fallback`

## Risk Assessment

**Zero Risk:**
- No production logic changes
- All debug code gated by env flags
- Fail-closed error handling
- Optional parameters only
- No DB writes or schema changes

**Minimal Risk:**
- Added optional parameters to internal functions
- All changes localized to `worker/scraper.ts` and `business-logic.ts`
- No public API changes

## Files Changed

1. `worker/scraper.ts` - 140 lines added (Layer A, Layer B, context building)
2. `src/lib/study-core/business-logic.ts` - 120 lines added (detectFilterReason, Layer C, stats log)

**Total:** ~260 lines of debug instrumentation code, all gated by env flags.
