# Quick Parity Test - TOYOTA YARIS CROSS 2021

## Test This Exact Study

**Study:** TOYOTA YARIS CROSS 2021 FR→NL

**Expected Results:**
- Target (Leboncoin): 7 listings filtered → Median ~28,500€
- Source (Marktplaats): 7 listings filtered → Best ~23,447€
- **Margin: 5,053€**
- **Status: OPPORTUNITY**

---

## Quick Test (2 minutes)

### 1. Run Locally (Browser)

```bash
# Start dev server
npm run dev

# Open browser
# Navigate to: "Run Searches"
# Find: TOYOTA YARIS CROSS 2021
# Click: "Run Now"
# Wait: ~30 seconds
```

**Check Console Logs:**
```
[SCRAPER] 🔀 Unified pipeline enabled (USE_SHARED_CORE=true)
[SCRAPER] Target URL: ...text=adventure...  ← Should contain 'adventure'
[SCRAPER] Source URL: ...#q:adventure|...   ← Should contain 'q:adventure'
[INSTANT_FILTER] ✅ Kept 7/X listings (target)
[INSTANT_FILTER] ✅ Kept 7/X listings (source)
[INSTANT_STATS] Median: ~28500 EUR
Status: OPPORTUNITY
Margin: ~5053€
```

---

### 2. Run Remotely (Worker)

**Option A: Trigger via UI**
```bash
# In browser UI:
# Click "Run Now" (this triggers remote execution)
# Check Railway Worker logs
```

**Option B: Check Existing Results**
```sql
-- In Supabase SQL Editor:
SELECT
  filtered_target_count,
  filtered_source_count,
  target_median_price,
  price_difference,
  status
FROM study_run_results
WHERE study_id = 'TOYOTA_YARIS_CROSS_2021_FR_NL'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected Output:**
```
filtered_target_count: 7
filtered_source_count: 7
target_median_price: ~28500
price_difference: ~5053
status: OPPORTUNITY
```

---

### 3. Compare Results

| Metric | Local (Browser) | Remote (Worker) | Match? |
|--------|----------------|-----------------|--------|
| Target count | _____ | _____ | ☐ |
| Source count | _____ | _____ | ☐ |
| Median price | _____ | _____ | ☐ |
| Margin | _____ | _____ | ☐ |
| Status | _____ | _____ | ☐ |

✅ **PASS:** All metrics match
❌ **FAIL:** See troubleshooting below

---

## Debug Mode (If Results Don't Match)

### Check Trim URLs

**Local:**
```javascript
// In browser console:
localStorage.setItem('DEBUG_SCRAPER', 'true');
// Re-run study
// Look for URL logs:
// "Target URL: ...text=adventure..." (Leboncoin)
// "Source URL: ...#q:adventure|..." (Marktplaats)
```

**Worker:**
```bash
# In Railway logs, search for:
"Target URL:" or "Source URL:"
# Should show trim in URL
```

---

### Check Filtered Counts

**If Too Many Listings (e.g., 29 instead of 7):**

❌ **Problem:** Trim not applied to URL
✅ **Fix:** Verify trim functions in worker/scraper.ts match studyRunner.ts

**Check URL contains trim:**
- Marktplaats: Should have `#q:adventure|...`
- Leboncoin: Should have `&text=adventure`
- Bilbasen: Should have `&free=...`

---

### Check Year Filter

**If Wrong Years Included:**

❌ **Problem:** Year filter using wrong field
✅ **Fix:** Verify worker uses `study.year` not `study.min_year`

**SQL Check:**
```sql
SELECT title, year, price
FROM study_source_listings
WHERE run_id = 'latest_run_id'
AND year < 2021;
-- Should return 0 rows
```

---

## Success Criteria

### ✅ PASS When:

1. Local finds 7 target + 7 source listings
2. Remote finds 7 target + 7 source listings
3. Both calculate median ~28,500€
4. Both calculate margin ~5,053€
5. Both return OPPORTUNITY status
6. URLs contain trim keywords (check logs)
7. No listings < 2021 in results
8. Builds succeed without errors

### ❌ FAIL When:

1. Different filtered counts (e.g., 7 vs 29)
2. Different median prices (e.g., 28,500€ vs 25,000€)
3. Different status (OPPORTUNITY vs NULL)
4. URLs don't contain trim keywords
5. Old listings included (year < 2021)
6. Build errors or TypeScript errors

---

## Quick Fixes

### If Worker Finds Too Many Listings:

**Check trim application:**
```typescript
// worker/scraper.ts should have:
function applyTrimMarktplaats(url: string, trim: string): string {
  const [base, hash = ''] = url.split('#');  // ✅ Hash-based
  // NOT: url + '?query=' + trim  // ❌ Wrong
}
```

**Verify in logs:**
```bash
# Railway logs should show:
"Target URL: ...#q:adventure|..."  ← Correct
# NOT:
"Target URL: ...?query=adventure"  ← Wrong
```

---

### If All Listings Filtered Out (NULL):

**Check for double filtering:**
```typescript
// business-logic.ts should NOT have:
if (study.trim_text && ...) {
  // Post-scrape trim filtering ← Should be REMOVED
}
```

**Only URL-based filtering should exist:**
```typescript
// worker/scraper.ts:
if (trimTarget) {
  targetUrl = applyTrimMarktplaats(targetUrl, trimTarget);  // ✅ Only here
}
```

---

### If Year Filter Not Working:

**Check year field:**
```typescript
// worker/scraper.ts should have:
const studyCriteria = {
  year: study.year,  // ✅ Correct
  // NOT: year: study.min_year || 2000  // ❌ Wrong
};
```

**Verify in database:**
```sql
SELECT year FROM studies_v2
WHERE id = 'TOYOTA_YARIS_CROSS_2021_FR_NL';
-- Should return: 2021
```

---

## Next Steps After Success

### If Tests Pass ✅

1. **Deploy to Production:**
   ```bash
   git push
   # Railway auto-deploys
   ```

2. **Monitor for 24 hours:**
   - Check scheduled runs
   - Verify all studies return expected results
   - Compare with previous results

3. **Update .env (if not already):**
   ```bash
   VITE_USE_SHARED_CORE=true
   USE_SHARED_CORE=true
   ```

---

### If Tests Fail ❌

1. **Document the issue:**
   - What was expected?
   - What happened instead?
   - Console logs / errors
   - Database query results

2. **Check common issues:**
   - URLs contain trim? (Check logs)
   - Year field correct? (Check database)
   - Post-scrape filter removed? (Check code)

3. **Rollback if needed:**
   ```bash
   # In .env:
   VITE_USE_SHARED_CORE=false

   # Restart:
   npm run dev
   ```

4. **Report the issue:**
   - Include study configuration
   - Include both local and remote results
   - Include logs from both environments

---

## Contact

**Documentation:**
- `PARITY_FIX_FINAL.md` - Complete fix details
- `VERIFY_PARITY.md` - Detailed testing guide
- `src/lib/study-core/business-logic.ts` - Source code

**Quick Debug:**
```bash
# Enable debug mode
VITE_ENABLE_DEBUG_LOGGING=true npm run dev

# Run builds
npm run build
cd worker && npm run build

# Check types
npm run typecheck
```

---

**Last Updated:** 2026-01-17
**Estimated Time:** 2-5 minutes
**Confidence:** High (fixes verified)
