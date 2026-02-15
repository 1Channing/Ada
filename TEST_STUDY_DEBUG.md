# Testing Study Debug Instrumentation

## Quick Test Guide

### Test 1: Verify Environment Flag Detection

```bash
cd worker

# Test 1a: Debug disabled (default)
npm start
# Expected: No [STUDY_DEBUG_*] logs

# Test 1b: Debug enabled
STUDY_DEBUG=true npm start
# Expected: [STUDY_DEBUG_*] logs appear when studies run

# Test 1c: Debug + HTML enabled
STUDY_DEBUG=true STUDY_DEBUG_HTML=true npm start
# Expected: [STUDY_DEBUG_*] logs + [STUDY_DEBUG_HTML] file writes
```

### Test 2: Trigger a Study Run

**Option A: Frontend UI**
1. Open http://localhost:5173
2. Navigate to Studies V2 → Run Searches
3. Select a study
4. Click "Run Now"
5. Check worker terminal for debug logs

**Option B: Scheduled Run**
1. Navigate to Studies V2 → Run Searches
2. Schedule a study run
3. Wait for scheduled execution
4. Check Railway logs or worker terminal

### Test 3: Verify Log Prefixes

```bash
# In worker terminal or Railway logs
grep "STUDY_DEBUG_FETCH" logs
grep "STUDY_DEBUG_PARSED" logs
grep "STUDY_DEBUG_FILTER" logs
grep "STUDY_DEBUG_STATS" logs
```

**Expected output examples:**

```
[STUDY_DEBUG_FETCH] marketplace=MARKTPLAATS url=https://www.marktplaats.nl/... status=200 content_type=application/json html_length=234567 has_next_data=true has_ld_json=false

[STUDY_DEBUG_PARSED] marketplace=MARKTPLAATS parsedCount=45 missing_price=2 missing_year=0 missing_mileage=5 min_price=12500 max_price=45000

[STUDY_DEBUG_FILTER] === FILTER SUMMARY ===
[STUDY_DEBUG_FILTER] Total input (parsedCount): 45
[STUDY_DEBUG_FILTER] After shouldFilter: 38
[STUDY_DEBUG_FILTER] After criteria filters (passedCount): 22

[STUDY_DEBUG_STATS] Using MAX_TARGET_LISTINGS=6 for median calculation
[STUDY_DEBUG_STATS] Actually using top N=6 (filtered count may be less than 6)
[STUDY_DEBUG_STATS] TOP N prices for median: [€12500, €13900, €14500, €15200, €15900, €16500]
```

### Test 4: Verify HTML File Writes

```bash
# Enable HTML writing
STUDY_DEBUG=true STUDY_DEBUG_HTML=true npm start

# Trigger a study run

# Check /tmp for HTML files
ls -lh /tmp/study_*.html

# Expected filename patterns:
# /tmp/study_<runId>_<studyKey>_<marketplace>_<country>.html
# Example: /tmp/study_abc123_MS_VOLKSWAGEN_TIGUAN_2024_FR_NL_MARKTPLAATS_NL.html

# Verify content
head -20 /tmp/study_abc123_MS_VOLKSWAGEN_TIGUAN_2024_FR_NL_MARKTPLAATS_NL.html
```

### Test 5: Verify studyKey Extraction

Create a test with different study ID formats:

1. **MS_ prefix study:**
   - Study ID: `MS_VOLKSWAGEN_TIGUAN_2024_FR_NL`
   - Expected filename: `study_<runId>_MS_VOLKSWAGEN_TIGUAN_2024_FR_NL_<marketplace>_<country>.html`

2. **Non-MS_ study:**
   - Study ID: `abc-123-xyz`
   - Expected: Uses fallback (study.study_key ?? study.key ?? String(study.id))

### Test 6: Compare Parsed vs Filtered Counts

Look for the progression in logs:

```
[STUDY_DEBUG_PARSED] parsedCount=45 ...
[STUDY_DEBUG_FILTER] Total input (parsedCount): 45
[STUDY_DEBUG_FILTER] After shouldFilter: 38
[STUDY_DEBUG_FILTER] After criteria filters (passedCount): 22
```

**Validation:**
- `parsedCount` from PARSED should match `Total input` in FILTER
- `After shouldFilter` should be ≤ `Total input`
- `passedCount` should be ≤ `After shouldFilter`
- `Total rejected` = `Total input` - `passedCount`

### Test 7: Verify Median Parity

Compare debug stats with UI results:

```
[STUDY_DEBUG_STATS] TOP N prices for median: [€12500, €13900, €14500, €15200, €15900, €16500]
```

**In UI:**
1. Find the study run result
2. Check the median price displayed
3. Calculate median manually from logged prices:
   - For 6 prices (even count): average of middle two values
   - Example: (€14500 + €15200) / 2 = €14850

**Expected:** UI median should match calculated median from logged prices.

### Test 8: Verify Filter Rejection Reasons

Look for specific rejection examples:

```
[STUDY_DEBUG_FILTER] === EXAMPLES: price_floor (showing up to 5) ===
[STUDY_DEBUG_FILTER] €1500 | 2018 | 150000km | VW Tiguan defect... | €1500 (1500 EUR)
[STUDY_DEBUG_FILTER] === EXAMPLES: trim (showing up to 5) ===
[STUDY_DEBUG_FILTER] €18900 | 2021 | 45000km | Volkswagen Tiguan Life... | trim mismatch (expected: R-Line)
```

**Validation:**
- Each bucket should show appropriate examples
- Details should match the rejection reason
- Maximum 5 examples per bucket

### Test 9: Verify Error Handling

Inject a failure scenario:

```bash
# Test with invalid ZYTE_API_KEY
STUDY_DEBUG=true ZYTE_API_KEY=invalid npm start
```

**Expected:**
- Debug logs may show errors in try-catch
- Example: `[STUDY_DEBUG_FETCH] Error in debug instrumentation: ...`
- **Critical:** Worker should continue execution (fail-closed)
- Study should still attempt to run and handle the invalid key gracefully

### Test 10: Production Safety Check

```bash
# Verify no debug code runs when flag is disabled
unset STUDY_DEBUG
unset STUDY_DEBUG_HTML
npm start

# Run a study
# Expected: NO [STUDY_DEBUG_*] logs should appear
# Only normal [WORKER_SCRAPER], [MARKTPLAATS_PARSED], etc. logs
```

## Railway Deployment Test

### Deploy with Debug Enabled

1. **Set environment variables in Railway:**
   ```
   STUDY_DEBUG=true
   STUDY_DEBUG_HTML=true
   ```

2. **Deploy and trigger a study run**

3. **View logs:**
   ```bash
   railway logs --tail
   ```

4. **Grep for debug layers:**
   ```bash
   railway logs | grep STUDY_DEBUG_FETCH
   railway logs | grep STUDY_DEBUG_PARSED
   railway logs | grep STUDY_DEBUG_FILTER
   railway logs | grep STUDY_DEBUG_STATS
   ```

5. **Check /tmp files (if Railway allows):**
   ```bash
   railway run ls -lh /tmp/study_*.html
   ```

### Disable Debug in Production

1. **Remove environment variables:**
   ```
   STUDY_DEBUG=false
   STUDY_DEBUG_HTML=false
   ```
   Or delete them entirely.

2. **Redeploy**

3. **Verify no debug logs:**
   ```bash
   railway logs | grep STUDY_DEBUG
   # Expected: No results
   ```

## Success Criteria

✅ **All tests pass when:**
- Debug logs appear ONLY when `STUDY_DEBUG=true`
- All 4 log prefixes are present
- HTML files written ONLY when both flags enabled
- Filenames follow deterministic pattern
- Parsed → filtered counts are consistent
- Median prices match between logs and UI
- Filter rejection reasons are accurate
- Error handling is fail-closed (no crashes)
- No debug logs when flags disabled

## Troubleshooting

### Issue: No debug logs appear

**Check:**
1. `STUDY_DEBUG=true` is set in environment
2. Worker is restarted after setting env var
3. A study is actually running (trigger one manually)
4. Check for typos in env var name

### Issue: HTML files not created

**Check:**
1. Both `STUDY_DEBUG=true` AND `STUDY_DEBUG_HTML=true` are set
2. `/tmp` directory is writable
3. debugContext is being passed (check for `marketplace=unknown` in logs)

### Issue: Counts don't match

**Check:**
1. Look for the full flow: PARSED → FILTER → STATS
2. Verify you're looking at the same market (target vs source)
3. Check if any errors occurred in between

### Issue: studyKey shows wrong value

**Check:**
1. Verify study.id format (does it start with "MS_"?)
2. Check fallback fields: study.study_key, study.key
3. Look for the actual studyKey in logs: `[STUDY_DEBUG_FETCH] marketplace=X ...`

## Log Example (Complete Flow)

```
[WORKER] Processing study MS_VOLKSWAGEN_TIGUAN_2024_FR_NL in FULL mode
[STUDY_DEBUG_FETCH] marketplace=MARKTPLAATS url=https://www.marktplaats.nl/... status=200 content_type=application/json html_length=234567 has_next_data=true has_ld_json=false
[STUDY_DEBUG_HTML] Written to: /tmp/study_abc123_MS_VOLKSWAGEN_TIGUAN_2024_FR_NL_MARKTPLAATS_NL.html (234567 bytes) preview: <!DOCTYPE html>...
[STUDY_DEBUG_PARSED] marketplace=MARKTPLAATS parsedCount=45 missing_price=2 missing_year=0 missing_mileage=5 min_price=12500 max_price=45000
[STUDY_DEBUG_PARSED] === 10 CHEAPEST (by price) ===
[STUDY_DEBUG_PARSED] 1. €12500 | 2021 | 85000km | Volkswagen Tiguan... | https://...
...
[STUDY_DEBUG_FILTER] === FILTER SUMMARY ===
[STUDY_DEBUG_FILTER] Total input (parsedCount): 45
[STUDY_DEBUG_FILTER] After shouldFilter: 38
[STUDY_DEBUG_FILTER] After criteria filters (passedCount): 22
[STUDY_DEBUG_FILTER] Total rejected: 23
[STUDY_DEBUG_FILTER] Rejected by price_floor: 5
...
[STUDY_DEBUG_STATS] Using MAX_TARGET_LISTINGS=6 for median calculation
[STUDY_DEBUG_STATS] Actually using top N=6 (filtered count may be less than 6)
[STUDY_DEBUG_STATS] TOP N prices for median: [€12500, €13900, €14500, €15200, €15900, €16500]
```
