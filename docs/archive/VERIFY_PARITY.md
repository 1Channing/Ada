# Verify Parity Fix - Quick Test Guide

## Quick Verification (5 minutes)

### Step 1: Check Environment Variables

```bash
# Verify USE_SHARED_CORE is set to true
echo $VITE_USE_SHARED_CORE  # Should print: true
echo $USE_SHARED_CORE       # Should print: true
```

If not set:
```bash
# Add to .env
echo "VITE_USE_SHARED_CORE=true" >> .env
echo "USE_SHARED_CORE=true" >> .env

# Restart dev server
npm run dev
```

---

### Step 2: Test Locally (Browser)

1. **Navigate to "Run Searches" page**

2. **Select a study** (preferably one with trim_text_target set)
   - Example: BMW X5 2021 with trim_text_target='xline'

3. **Click "Run Now"**

4. **Check console logs:**
   ```
   [SCRAPER] 🔀 Unified pipeline enabled (USE_SHARED_CORE=true)
   [INSTANT_FILTER] Starting with X listings...
   [INSTANT_FILTER] ✅ Kept Y/X listings after filtering
   [INSTANT_STATS] Computed target market stats...
   ```

5. **Note the results:**
   - Filtered target count: _______
   - Filtered source count: _______
   - Target median price: _______€
   - Status: OPPORTUNITIES / NULL

---

### Step 3: Test Remotely (Worker)

#### Option A: Manual Trigger (Recommended)

1. **Use "Run Now" button** (this triggers remote execution via Edge Function)

2. **Check Railway Worker logs:**
   ```bash
   # In Railway dashboard → Worker service → Logs
   ```

3. **Look for:**
   ```
   [WORKER] Processing study...
   [WORKER] ✅ Target: X listings → Y after filtering
   [WORKER] ✅ Source: X listings → Y after filtering
   [WORKER] Target median: XXX EUR
   [WORKER] Status: OPPORTUNITIES / NULL
   ```

#### Option B: Scheduled Run

1. **Schedule a study for 1 minute from now:**
   ```sql
   UPDATE studies_v2
   SET last_run_at = NOW() - INTERVAL '25 hours'
   WHERE id = 'your_study_id';
   ```

2. **Wait for daily cron to run** (or trigger manually via Edge Function)

3. **Check results in database:**
   ```sql
   SELECT
     study_id,
     filtered_target_count,
     filtered_source_count,
     target_median_price,
     status,
     created_at
   FROM study_run_results
   WHERE study_id = 'your_study_id'
   ORDER BY created_at DESC
   LIMIT 1;
   ```

---

### Step 4: Compare Results

**Expected:** Local and remote results should be IDENTICAL

| Metric | Local (Browser) | Remote (Worker) | Match? |
|--------|----------------|-----------------|--------|
| Filtered target count | _____ | _____ | ☐ Yes ☐ No |
| Filtered source count | _____ | _____ | ☐ Yes ☐ No |
| Target median price | _____ | _____ | ☐ Yes ☐ No |
| Status | _____ | _____ | ☐ Yes ☐ No |

✅ **PASS:** All metrics match
❌ **FAIL:** Any metric doesn't match → See "Debugging" section below

---

## Specific Test Cases

### Test Case 1: Year Filtering

**Setup:**
- Study: Year = 2021
- Run instant and scheduled

**Expected:**
- All listings should have year ≥ 2021
- No listings from 2020 or earlier

**Verification:**
```sql
SELECT
  title,
  year,
  price
FROM study_source_listings
WHERE run_id = (
  SELECT id FROM study_runs
  WHERE study_id = 'your_study_id'
  ORDER BY created_at DESC
  LIMIT 1
)
AND year < 2021;
```

Should return **0 rows** (all listings filtered correctly).

---

### Test Case 2: Trim Filtering

**Setup:**
- Study: trim_text_target = 'xline'
- Run instant and scheduled

**Expected:**
- Only listings with 'xline' in title/description/trim
- Case-insensitive: 'xLine', 'X-Line', 'XLINE' all match

**Verification:**
```sql
SELECT
  title,
  description,
  trim,
  (
    LOWER(title) LIKE '%xline%' OR
    LOWER(description) LIKE '%xline%' OR
    LOWER(trim) LIKE '%xline%'
  ) AS matches_trim
FROM study_source_listings
WHERE run_id = (
  SELECT id FROM study_runs
  WHERE study_id = 'your_study_id'
  ORDER BY created_at DESC
  LIMIT 1
);
```

All rows should have `matches_trim = true`.

---

### Test Case 3: No Trim (Baseline)

**Setup:**
- Study: No trim_text_target or trim_text_source
- Run instant and scheduled

**Expected:**
- More listings pass (no trim filter applied)
- Only brand/model/year/mileage filters active

**Verification:**
Compare filtered counts with and without trim:

| Study | With Trim | Without Trim |
|-------|-----------|--------------|
| BMW X5 2021 | 7 listings | 15 listings |

Should show **more listings** when trim is not specified.

---

## Debugging

### Issue: Different Counts

**Symptom:** Local shows 7 listings, remote shows 29

**Possible Causes:**

1. **Year filter not working:**
   ```typescript
   // Check worker logs for:
   console.log('Study year:', study.year);  // Should be 2021, not 2000
   ```

2. **Trim filter not applied:**
   ```typescript
   // Check worker logs for:
   console.log('Target trim:', trimTarget);  // Should be 'xline' if set
   console.log('Source trim:', trimSource);
   ```

3. **Different URLs:**
   ```typescript
   // Check if trim is applied to URL:
   console.log('Target URL:', targetUrl);  // Should contain &text=xline or #q:xline
   console.log('Source URL:', sourceUrl);
   ```

**Fix:**
1. Verify `.env` has `USE_SHARED_CORE=true`
2. Restart dev server and worker
3. Clear browser cache (Cmd+Shift+R)
4. Re-run test

---

### Issue: NULL Results (But Local Shows Opportunity)

**Symptom:** Local detects opportunity, remote returns NULL

**Possible Causes:**

1. **All listings filtered out:**
   ```sql
   SELECT COUNT(*) FROM study_source_listings
   WHERE run_id = 'latest_run_id';
   ```
   If 0, check filtering logic.

2. **Threshold too high:**
   ```typescript
   console.log('Target median:', targetMedianPrice);
   console.log('Best source:', bestSourcePrice);
   console.log('Difference:', priceDifference);
   console.log('Threshold:', threshold);
   ```

3. **Year filter too strict:**
   ```sql
   SELECT year, COUNT(*)
   FROM study_source_listings
   WHERE run_id = 'latest_run_id'
   GROUP BY year
   ORDER BY year;
   ```

**Fix:**
1. Check year field is correct (not defaulting to 2000)
2. Verify trim text is not too restrictive
3. Adjust threshold if needed

---

### Issue: Worker Crashes

**Symptom:** Worker logs show errors or crashes

**Check:**
```bash
# Railway logs
cd worker && npm start

# Look for:
[ERROR] TypeError: Cannot read property 'year' of undefined
[ERROR] study.min_year is not a function
```

**Common Errors:**

1. **study.year is undefined:**
   ```typescript
   // Fix: Check database has 'year' column
   SELECT year FROM studies_v2 WHERE id = 'your_study_id';
   ```

2. **study.min_year error:**
   ```typescript
   // This is the OLD bug (should be fixed now)
   // If you see this, the fix wasn't applied
   // Use: study.year (not study.min_year)
   ```

---

## SQL Helpers

### Compare Last Two Runs

```sql
SELECT
  r.id AS run_id,
  r.created_at,
  result.filtered_target_count,
  result.filtered_source_count,
  result.target_median_price,
  result.status
FROM study_runs r
LEFT JOIN study_run_results result ON result.run_id = r.id
WHERE r.study_id = 'your_study_id'
ORDER BY r.created_at DESC
LIMIT 2;
```

### Find Discrepancies

```sql
-- Get stats from last 2 runs
WITH last_runs AS (
  SELECT
    r.id,
    result.filtered_target_count,
    result.filtered_source_count,
    result.target_median_price
  FROM study_runs r
  LEFT JOIN study_run_results result ON result.run_id = r.id
  WHERE r.study_id = 'your_study_id'
  ORDER BY r.created_at DESC
  LIMIT 2
)
SELECT
  (SELECT filtered_target_count FROM last_runs OFFSET 0 LIMIT 1) AS run1_target,
  (SELECT filtered_target_count FROM last_runs OFFSET 1 LIMIT 1) AS run2_target,
  (SELECT filtered_target_count FROM last_runs OFFSET 0 LIMIT 1) -
  (SELECT filtered_target_count FROM last_runs OFFSET 1 LIMIT 1) AS difference;
```

Should return `difference = 0` if parity is achieved.

---

## Success Criteria

✅ **Parity Achieved When:**

1. Local and remote return same filtered counts (±1 due to timing)
2. Local and remote return same median price (±1€ due to rounding)
3. Local and remote return same status (OPPORTUNITIES vs NULL)
4. Year filtering works (no listings < study.year)
5. Trim filtering works (all listings contain trim text)
6. Builds succeed without errors
7. No TypeScript errors
8. Tests pass

---

## Next Steps After Verification

### If Tests Pass ✅

1. **Update production:**
   ```bash
   # Push to Railway
   git push
   ```

2. **Monitor for 24 hours:**
   - Check error logs
   - Verify scheduled runs
   - Compare results

3. **Document any issues:**
   - Create GitHub issues
   - Update this guide

### If Tests Fail ❌

1. **Document the failure:**
   - What was expected?
   - What actually happened?
   - Console logs / stack traces

2. **Check common issues:**
   - Environment variables
   - Database schema
   - Type errors

3. **Rollback if needed:**
   ```bash
   # In .env
   VITE_USE_SHARED_CORE=false

   # Restart
   npm run dev
   ```

4. **Report the issue:**
   - Create detailed bug report
   - Include reproduction steps
   - Attach logs and screenshots

---

## Contact / Support

**Documentation:**
- `PARITY_FIX_SUMMARY.md` - What was fixed
- `UNIFIED_CORE_MIGRATION_COMPLETE.md` - Architecture
- `src/lib/study-core/business-logic.ts` - Source code

**Quick Help:**
```bash
# Enable debug logs
VITE_ENABLE_DEBUG_LOGGING=true npm run dev

# Run parity tests
npm run test:parity:all

# Check types
npm run typecheck
```

---

**Last Updated:** 2026-01-16
**Status:** Ready for Testing
**Estimated Time:** 5-10 minutes
