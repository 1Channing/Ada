# Worker Robustness & Database Schema Fix - Complete Implementation

## Overview

Fixed three critical issues:
1. **Database schema compatibility** - Verified schema, no missing column references
2. **Marktplaats scraping robustness** - Added retry logic with stronger Zyte profiles
3. **Worker stability** - Added proper endpoints and logging for Railway deployment

---

## Part 1: Database Schema Verification

### Actual Schema Confirmed

**studies_v2 table columns:**
- id, brand, model, year, max_mileage
- country_target, market_target_url
- country_source, market_source_url
- trim_text, trim_text_target, trim_text_source
- created_at, updated_at

**study_run_results columns:**
- id, run_id, study_id, status
- target_market_price, best_source_price, price_difference
- target_stats, target_error_reason, created_at

**study_run_logs columns:**
- id, study_run_id, created_at, status, last_stage, error_message, logs_json

**scheduled_study_runs columns:**
- id, created_at, scheduled_at, status, payload, last_run_at, last_error, run_id, study_id

### Schema Compliance

✅ **No missing column references** - Worker queries only use columns that exist
✅ **market_studies table** - Separate legacy table with source_marketplace/target_marketplace
✅ **studies_v2 table** - Uses country_source/country_target (correct)
✅ **Worker uses studies_v2** - All queries reference correct schema

---

## Part 2: Marktplaats Scraping Robustness

### Retry Logic Implementation

**File: `/worker/scraper.js`**

#### New Features

**1. Retry Strategy**
```javascript
const MAX_RETRIES = 2;  // Up to 3 total attempts
const RETRY_DELAYS = [1000, 3000];  // Exponential backoff: 1s, 3s
```

**2. Progressive Zyte Request Profiles**

```javascript
// Profile 1 (default):
{ url, browserHtml: true }

// Profile 2 (Marktplaats only):
{
  url,
  browserHtml: true,
  geolocation: 'NL',
  javascript: true
}

// Profile 3 (Marktplaats only):
{
  url,
  browserHtml: true,
  geolocation: 'NL',
  javascript: true,
  actions: [{
    action: 'waitForTimeout',
    timeout: 2000
  }]
}
```

**3. Enhanced Blocked Detection**

- Primary: Keyword matching (captcha, recaptcha, cloudflare, etc.)
- Secondary: Zero listings + suspicious patterns + small HTML
- Returns: `{isBlocked, matchedKeyword, reason}`

**4. Retry Conditions (Marktplaats only)**

Retries triggered when:
- Blocked content detected
- Zero listings extracted
- Zyte website-ban error
- No HTML returned

**5. Enhanced Diagnostics**

```javascript
{
  marketplace: 'marktplaats',
  htmlLength: 125340,
  htmlSnippet: '<!DOCTYPE html>...',  // First 800 chars
  hasNextData: true,
  detectedBlocked: false,
  matchedKeyword: null,
  blockReason: null,
  retryCount: 0
}
```

### Scraping Flow

```
Attempt 1 (Profile 1):
  ↓
Blocked or Zero Listings?
  ↓ Yes (Marktplaats)
Wait 1000ms
  ↓
Attempt 2 (Profile 2):
  ↓
Still Blocked or Zero?
  ↓ Yes (Marktplaats)
Wait 3000ms
  ↓
Attempt 3 (Profile 3):
  ↓
Success or Final Failure
```

### Database Logging

**study_run_logs entry on TARGET_BLOCKED:**
```javascript
{
  study_run_id: "run_abc123",
  status: "TARGET_BLOCKED",
  last_stage: "target_search",
  error_message: "MARKTPLAATS_BLOCKED",
  logs_json: {
    studyId: "MS_TOYOTA_AYGO_X_2025_FR_NL",
    stage: "target_search",
    blocked: true,
    blockReason: "MARKTPLAATS_BLOCKED: captcha",
    zyteStatusCode: 200,
    retryCount: 2,
    diagnostics: {
      marketplace: "marktplaats",
      htmlLength: 45230,
      htmlSnippet: "<!DOCTYPE html>...",
      hasNextData: false,
      detectedBlocked: true,
      matchedKeyword: "captcha",
      blockReason: "keyword_match",
      retryCount: 2
    }
  }
}
```

### Worker Log Patterns

**Success after retry:**
```
[WORKER] Scraping https://www.marktplaats.nl/... in FAST mode
[WORKER] Fetching https://www.marktplaats.nl/... (profile level 1)
[WORKER] 🚫 Blocked content detected (captcha), retrying...
[WORKER] 🔄 Retry 1/2 after 1000ms with profile level 2...
[WORKER] Fetching https://www.marktplaats.nl/... (profile level 2)
[WORKER] __NEXT_DATA__ found, attempting to parse 15 items
[WORKER] Successfully parsed 15 listings from __NEXT_DATA__
[WORKER] ✅ Extracted 15 listings from https://www.marktplaats.nl/... (after 1 retry)
```

**Final blocked:**
```
[WORKER] Scraping https://www.marktplaats.nl/... in FAST mode
[WORKER] Fetching https://www.marktplaats.nl/... (profile level 1)
[WORKER] 🚫 Blocked content detected (blocked), retrying...
[WORKER] 🔄 Retry 1/2 after 1000ms with profile level 2...
[WORKER] Fetching https://www.marktplaats.nl/... (profile level 2)
[WORKER] 🚫 Blocked content detected (blocked), retrying...
[WORKER] 🔄 Retry 2/2 after 3000ms with profile level 3...
[WORKER] Fetching https://www.marktplaats.nl/... (profile level 3)
[WORKER] 🚫 Blocked after all retries: blocked
[WORKER] 🚫 Target market blocked: MARKTPLAATS_BLOCKED: blocked
```

---

## Part 3: Worker Stability (Railway)

### File: `/worker/index.js`

**Changes Made:**

**1. Added Root Endpoint**
```javascript
app.get('/', (req, res) => {
  res.send('ok');
});
```

**2. Enhanced Startup Logging**
```javascript
console.log(`[WORKER] Node version: ${process.version}`);
console.log(`[WORKER] PORT: ${PORT}`);
console.log(`[WORKER] Listening on 0.0.0.0:${PORT}`);
```

**3. Endpoint Summary**
```
GET /           → Simple "ok" text response
GET /health     → JSON health check (no DB dependency)
POST /execute-studies → Execute studies with auth
```

**4. Startup Log Output**
```
[WORKER] ===== MC Export Worker Service Started =====
[WORKER] Node version: v20.10.0
[WORKER] PORT: 3001
[WORKER] Listening on 0.0.0.0:3001
[WORKER] Environment check: {
  hasWorkerSecret: true,
  hasSupabaseUrl: true,
  hasSupabaseKey: true,
  hasZyteKey: true
}
[WORKER] Health endpoint: GET /
[WORKER] Health endpoint: GET /health
[WORKER] Execute endpoint: POST /execute-studies
[WORKER] Ready to process scheduled study runs
```

---

## Files Modified

### Worker Files
1. **`/worker/index.js`**
   - Added GET / endpoint
   - Enhanced startup logging with Node version and PORT
   - Confirmed single app.listen() call on 0.0.0.0

2. **`/worker/scraper.js`** (746 lines)
   - Added `sleep()` function for retry delays
   - Added `getZyteRequestProfile()` - Progressive profiles
   - Enhanced `detectBlockedContent()` - Stricter detection
   - Updated `extractDiagnostics()` - 800 char snippet, retryCount
   - Updated `fetchHtmlWithScraper()` - Profile support, statusCode
   - **Completely rewrote `scrapeSearch()`** - Retry logic, backoff
   - Updated `executeStudy()` - Enhanced diagnostics logging with zyteStatusCode and retryCount

### No Frontend Changes
- All changes in `/worker` directory only
- No Ada/React code modifications
- Database schema already correct

---

## Validation Queries

### 1. Latest Scheduled Run Status

```sql
SELECT
  ssr.id,
  ssr.created_at,
  ssr.scheduled_at,
  ssr.status,
  ssr.last_run_at,
  ssr.last_error,
  sr.id as run_id,
  sr.status as run_status,
  sr.total_studies,
  sr.null_count,
  sr.opportunities_count
FROM scheduled_study_runs ssr
LEFT JOIN study_runs sr ON sr.id = ssr.run_id
ORDER BY ssr.created_at DESC
LIMIT 10;
```

### 2. Latest Results with Numeric Values

```sql
SELECT
  srr.id,
  srr.study_id,
  s.brand,
  s.model,
  s.year,
  s.country_target,
  s.country_source,
  srr.status,
  srr.target_market_price,
  srr.best_source_price,
  srr.price_difference,
  srr.target_error_reason,
  srr.created_at
FROM study_run_results srr
JOIN studies_v2 s ON s.id = srr.study_id
WHERE srr.created_at > now() - interval '24 hours'
ORDER BY srr.created_at DESC
LIMIT 20;
```

### 3. Blocked Diagnostics from Logs

```sql
SELECT
  srl.id,
  srl.study_run_id,
  srl.status,
  srl.last_stage,
  srl.error_message,
  srl.logs_json->>'retryCount' as retry_count,
  srl.logs_json->>'zyteStatusCode' as zyte_status,
  srl.logs_json->'diagnostics'->>'marketplace' as marketplace,
  srl.logs_json->'diagnostics'->>'matchedKeyword' as keyword,
  srl.logs_json->'diagnostics'->>'htmlLength' as html_length,
  srl.logs_json->'diagnostics'->>'hasNextData' as has_next_data,
  srl.created_at
FROM study_run_logs srl
WHERE srl.status IN ('TARGET_BLOCKED', 'SOURCE_BLOCKED', 'NO_TARGET_LISTINGS')
  AND srl.created_at > now() - interval '24 hours'
ORDER BY srl.created_at DESC
LIMIT 20;
```

### 4. HTML Snippets for Debugging

```sql
SELECT
  srl.id,
  srl.study_run_id,
  srl.status,
  srl.error_message,
  srl.logs_json->'diagnostics'->>'htmlSnippet' as html_snippet,
  srl.created_at
FROM study_run_logs srl
WHERE srl.logs_json->'diagnostics'->>'htmlSnippet' IS NOT NULL
  AND srl.created_at > now() - interval '24 hours'
ORDER BY srl.created_at DESC
LIMIT 5;
```

### 5. Retry Success Rate

```sql
SELECT
  srl.logs_json->>'retryCount' as retry_count,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE srl.status = 'TARGET_BLOCKED') as blocked,
  COUNT(*) FILTER (WHERE srl.status NOT IN ('TARGET_BLOCKED', 'SOURCE_BLOCKED')) as eventually_succeeded
FROM study_run_logs srl
WHERE srl.logs_json->'diagnostics'->>'marketplace' = 'marktplaats'
  AND srl.created_at > now() - interval '7 days'
GROUP BY srl.logs_json->>'retryCount'
ORDER BY retry_count;
```

### 6. Marktplaats Studies Performance

```sql
SELECT
  s.brand,
  s.model,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE srr.status = 'OPPORTUNITIES') as opportunities,
  COUNT(*) FILTER (WHERE srr.status = 'TARGET_BLOCKED') as blocked,
  COUNT(*) FILTER (WHERE srr.status = 'NULL') as null_results,
  AVG(srr.target_market_price) FILTER (WHERE srr.target_market_price IS NOT NULL) as avg_target_price,
  AVG(srr.best_source_price) FILTER (WHERE srr.best_source_price IS NOT NULL) as avg_source_price
FROM study_run_results srr
JOIN studies_v2 s ON s.id = srr.study_id
WHERE s.country_target = 'NL'  -- Marktplaats is in Netherlands
  AND srr.created_at > now() - interval '7 days'
GROUP BY s.brand, s.model
ORDER BY total_runs DESC;
```

---

## Testing Procedure

### 1. Create Test Scheduled Run

```sql
-- Find a Marktplaats study
SELECT id, brand, model, year, country_target
FROM studies_v2
WHERE country_target = 'NL'
LIMIT 1;

-- Schedule test run
INSERT INTO scheduled_study_runs (scheduled_at, status, payload)
VALUES (
  now() + interval '2 minutes',
  'pending',
  jsonb_build_object(
    'type', 'instant',
    'studyIds', jsonb_build_array('<STUDY_ID_FROM_ABOVE>'),
    'threshold', 5000,
    'scrapeMode', 'fast'
  )
)
RETURNING id, scheduled_at;
```

### 2. Monitor Worker Logs

Watch for:
- Profile level progression (1 → 2 → 3)
- Retry attempts with delays
- Blocked detection messages
- Success or final blocked status

### 3. Check Results

```sql
-- Check result
SELECT
  study_id,
  status,
  target_market_price,
  best_source_price,
  price_difference,
  target_error_reason
FROM study_run_results
WHERE run_id = (
  SELECT run_id FROM scheduled_study_runs WHERE id = '<JOB_ID>'
);

-- Check diagnostics
SELECT
  status,
  last_stage,
  error_message,
  logs_json
FROM study_run_logs
WHERE study_run_id = (
  SELECT run_id FROM scheduled_study_runs WHERE id = '<JOB_ID>'
)
ORDER BY created_at DESC;
```

---

## Expected Outcomes

### Success Scenarios

**1. First attempt succeeds:**
```
- Numeric target_market_price in study_run_results
- Numeric best_source_price
- status = 'OPPORTUNITIES' or 'NULL' with prices
- No entries in study_run_logs (success path)
```

**2. Retry succeeds:**
```
- Numeric values in study_run_results
- Worker log shows retry attempt
- status = 'OPPORTUNITIES' or 'NULL' with prices
```

### Blocked Scenarios

**3. Blocked after all retries:**
```
- status = 'TARGET_BLOCKED' in study_run_results
- Entry in study_run_logs with:
  - status: 'TARGET_BLOCKED'
  - last_stage: 'target_search'
  - error_message: 'MARKTPLAATS_BLOCKED'
  - logs_json contains full diagnostics + retryCount + zyteStatusCode
- target_error_reason shows specific block reason
```

**4. Zero listings after retries:**
```
- status = 'NULL' in study_run_results
- Entry in study_run_logs with:
  - status: 'NO_TARGET_LISTINGS'
  - diagnostics show htmlLength, hasNextData, etc.
  - retryCount = 2
```

---

## Key Improvements Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Retry logic** | None | Up to 2 retries with backoff |
| **Zyte profiles** | Single static | 3 progressive profiles |
| **Blocked detection** | Keywords only | Keywords + patterns + context |
| **Diagnostics** | Basic | Full: snippet, retryCount, statusCode |
| **Status accuracy** | NULL for everything | TARGET_BLOCKED vs NULL |
| **Logging** | Minimal | Comprehensive with all context |
| **Worker stability** | Basic | Enhanced with / endpoint and logs |

---

## Regression Prevention

✅ **No schema changes** - All queries use existing columns
✅ **No frontend changes** - Worker-only modifications
✅ **Backward compatible** - Leboncoin/Bilbasen unchanged
✅ **FAST/FULL preserved** - Mode behavior unchanged
✅ **Auth unchanged** - WORKER_SECRET still required
✅ **Port binding correct** - 0.0.0.0:PORT with single listen()

---

## Build Verification

```bash
npm run build
# ✓ built in 14.32s
# No errors
```

All changes committed and ready for deployment.
