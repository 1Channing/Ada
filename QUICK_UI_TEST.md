# Quick UI Trigger Test (2 minutes)

## Test Manual Study Execution

### 1. Open Browser Console

```bash
# Start dev server
npm run dev

# Open browser: http://localhost:5173
# Open DevTools: F12 or Cmd+Option+I
# Go to Console tab
```

---

### 2. Trigger Manual Run

**Steps:**
1. Navigate to **"Run Searches"** page
2. Find study: **TOYOTA YARIS CROSS 2021**
3. Click **"Run Now"**
4. Watch console logs

---

### 3. Expected Console Output

```
[REMOTE_RUNNER] Starting remote execution for study: TOYOTA_YARIS_CROSS_2021_FR_NL
[REMOTE_RUNNER] Scheduled job created: abc-123-def-456
[REMOTE_RUNNER] Edge Function triggered: {
  success: true,
  processed: 1,    ← ✅ Should be 1 (not 0!)
  completed: 1,    ← ✅ Should be 1 (not 0!)
  timestamp: "2026-01-17T10:30:30.000Z"
}
[REMOTE_RUNNER] Job status changed: pending → running  ← ✅ Within 1 second
[REMOTE_RUNNER] Job status changed: running → completed
[REMOTE_RUNNER] Result fetched: OPPORTUNITIES, margin: 5053€  ← ✅ Actual result!
```

---

### 4. Expected UI Status Updates

Watch the status badge change:

1. ⚪ **"Queued"** - Scheduling remote execution... (instant)
2. 🟡 **"Triggering"** - Triggering backend execution... (instant)
3. 🟡 **"Triggering"** - Waiting for backend pickup... (0-1 sec)
4. 🔵 **"Running"** - Backend processing study... (1-30 sec)
5. 🟢 **"Fetching results"** - Loading results... (instant)
6. ✅ **"Completed"** - Study completed: OPPORTUNITIES (instant)

**Total Time:** ~26-36 seconds

---

### 5. Check Results Table

After completion, the results table should show:

| Study | Status | Target | Source | Median | Margin | Time |
|-------|--------|--------|--------|--------|--------|------|
| TOYOTA YARIS CROSS 2021 | 🟢 OPPORTUNITY | FR | NL | ~28,500€ | **~5,053€** | ~30s |

---

## ✅ Success Criteria

### PASS If:
- ✅ Edge Function returns `processed: 1, completed: 1`
- ✅ Status changes from "Triggering" → "Running" within 1 second
- ✅ Console shows "Result fetched: OPPORTUNITIES"
- ✅ UI displays margin: ~5,053€
- ✅ Results table shows OPPORTUNITY status
- ✅ Total time: 26-36 seconds

### ❌ FAIL If:
- ❌ Edge Function returns `processed: 0` ("No due jobs found")
- ❌ Status stuck on "Triggering" for >2 seconds
- ❌ Console shows "No result found for study"
- ❌ UI displays NULL or 0€ margin
- ❌ Results table empty or shows NULL

---

## Troubleshooting

### Issue: "No due jobs found"

**Symptom:**
```
[REMOTE_RUNNER] Edge Function triggered: {
  success: true,
  processed: 0,  ← ❌ Bad!
  completed: 0,  ← ❌ Bad!
  message: "No due jobs found"
}
```

**Check:**
```javascript
// In browser console, check if job was created:
const { data } = await supabase
  .from('scheduled_study_runs')
  .select('scheduled_at, status, created_at')
  .order('created_at', { ascending: false })
  .limit(1);

console.log('Latest job:', data);
// scheduled_at should be BEFORE created_at (not after!)
```

**Fix:** Verify remoteStudyRunner.ts line 69 uses `now.getTime() - 1000`

---

### Issue: Stuck on "Triggering"

**Symptom:**
- Status shows "Triggering" for 10+ seconds
- No "Running" status appears

**Check Edge Function logs:**
1. Go to Supabase Dashboard
2. Navigate to: **Edge Functions** → **run_scheduled_studies** → **Logs**
3. Look for recent invocations

**If no logs appear:**
- Edge Function not being called
- Check SCHEDULER_CRON_SECRET in .env

**If logs show error:**
- Worker URL or authentication issue
- Check WORKER_URL and WORKER_SECRET

---

### Issue: UI Shows NULL but Worker Found Results

**Symptom:**
- Console shows `[REMOTE_RUNNER] No result found for study`
- But Railway Worker logs show: "OPPORTUNITIES, margin: 5053€"

**Check:**
```sql
-- In Supabase SQL Editor:
SELECT * FROM study_run_results
WHERE created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;
```

**If results exist:**
- Retry logic not working
- Verify remoteStudyRunner.ts has retry loop (lines 154-180)

---

### Issue: Results Take Forever to Appear

**Symptom:**
- Status changes to "Completed"
- Console shows multiple retry messages
- Takes 5+ seconds to fetch results

**Normal Behavior:**
- Worker writes results as last step
- Small delay (100-500ms) is normal
- Retry logic handles this automatically

**If delays are consistently >2 seconds:**
- Database performance issue
- Check Supabase Dashboard for slow queries

---

## Quick SQL Checks

### 1. Check Latest Job

```sql
SELECT
  id,
  scheduled_at,
  created_at,
  status,
  last_run_at,
  execution_duration_ms,
  payload->>'type' as job_type
FROM scheduled_study_runs
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:**
- `scheduled_at` < `created_at` (1 second earlier)
- `status` = 'completed'
- `execution_duration_ms` = 26000-36000

---

### 2. Check Latest Results

```sql
SELECT
  study_id,
  status,
  filtered_target_count,
  filtered_source_count,
  target_median_price,
  price_difference,
  created_at
FROM study_run_results
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:**
- `status` = 'OPPORTUNITIES'
- `filtered_target_count` = 7
- `filtered_source_count` = 7
- `price_difference` ≈ 5053

---

### 3. Check for Orphaned Jobs

```sql
SELECT
  id,
  scheduled_at,
  status,
  last_error
FROM scheduled_study_runs
WHERE status = 'pending'
AND created_at < NOW() - INTERVAL '5 minutes';
```

**Expected:** 0 rows

**If rows exist:** Jobs are getting stuck in 'pending' state

---

## Environment Variables Checklist

Make sure these are set:

```bash
# Frontend (.env)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_SCHEDULER_CRON_SECRET=your-secret-here

# Supabase Edge Function (Dashboard → Settings → Edge Functions)
WORKER_URL=https://your-worker.railway.app
WORKER_SECRET=your-worker-secret
SCHEDULER_CRON_SECRET=your-secret-here
```

---

## Performance Expectations

| Phase | Expected Duration |
|-------|------------------|
| Job Creation | 100-200ms |
| Edge Function Call | 100-300ms |
| Job Pickup | 200-500ms |
| Worker Execution | 25-35s |
| Result Fetch | 100-500ms |
| **Total** | **26-36s** |

---

## Next Steps After Success

1. ✅ **Test with other studies**
   - Try different make/model combinations
   - Verify all return correct results

2. ✅ **Test error cases**
   - Try a study with invalid URLs
   - Verify error messages display correctly

3. ✅ **Monitor production**
   - Check Railway Worker logs
   - Verify all scheduled runs complete successfully

4. ✅ **Deploy to production**
   ```bash
   git add .
   git commit -m "Fix UI trigger timing and polling"
   git push
   ```

---

**Estimated Time:** 2-5 minutes
**Confidence:** High
**Status:** Ready to test
