# Complete Railway Deployment Guide

## Summary of All Fixes

This deployment includes **three critical fixes**:

### 1. Marketplace Links - FIXED ✅
**Problem:** "View NL market" and "View FR market" buttons didn't work
**Solution:** Added missing `market_target_url` and `market_source_url` fields to database query
**Files Changed:** `src/pages/StudiesV2Results.tsx` (lines 310-311, 47-48)

### 2. Batch Orchestration - FIXED ✅
**Problem:** Studies took 5 minutes each due to timeout, no realtime updates
**Solution:**
- Enabled Realtime for `scheduled_study_runs` table (database migration)
- Reduced timeout from 5 minutes to 90 seconds
- Added batch progress counter "(2 of 6)" format
**Files Changed:**
- Database migration applied
- `src/services/remoteStudyRunner.ts` (lines 44-45)
- `src/components/StudyRunsPanel.tsx` (line 78)

### 3. Cancel Button Persistence - FIXED ✅
**Problem:** Cancel button disappeared when navigating between pages
**Solution:**
- Added `cancel_requested` column to `study_runs` table
- Persist cancel state to database
- Restore cancel button state on page load
**Files Changed:**
- Database migration applied
- `src/pages/StudiesV2RunSearches.tsx` (added checkForActiveRuns, updated handleCancelRun)

---

## Pre-Deployment Checklist

Before deploying to Railway, verify:

- [x] Frontend build successful: `npm run build` ✅
- [x] Worker build successful: `cd worker && npm run build` ✅
- [x] Database migrations applied ✅
  - `enable_realtime_scheduled_runs`
  - `add_cancel_requested_to_study_runs`
- [x] No TypeScript errors
- [x] All changes committed to Git

---

## Railway Deployment Options

You have **two options** for deploying to Railway:

### Option A: Git-Based Deployment (Recommended)

Railway automatically deploys when you push to your main branch.

**Steps:**

1. **Commit all changes:**
```bash
git add .
git commit -m "Fix marketplace links, batch orchestration, and cancel persistence"
```

2. **Push to main branch:**
```bash
git push origin main
```

3. **Monitor deployment:**
- Go to your Railway dashboard
- Watch the deployment logs
- Wait for build to complete (~2-3 minutes)

4. **Verify deployment:**
- Check Railway logs show "Worker started on port 3001"
- Test frontend URL loads correctly

---

### Option B: Railway CLI Deployment

If you need manual control or have a different Git workflow.

**Prerequisites:**
```bash
# Install Railway CLI if not already installed
npm install -g @railway/cli

# Login to Railway
railway login
```

**Deploy Worker:**
```bash
cd worker
railway link  # Link to your Railway project
railway up    # Deploy
```

**Deploy Frontend:**
```bash
cd ..  # Return to project root
railway link  # Link to your Railway project
railway up    # Deploy
```

---

## Post-Deployment Verification

### Test 1: Marketplace Links ✅

1. Go to **Results** page
2. Click "View Listings" on any OPPORTUNITIES result
3. Modal opens showing listings
4. Look at top-right buttons - you should see:
   - 🔵 "View NL market" (blue button) - or DK, IT, etc.
   - 🟢 "View FR market" (green button) - or other source country
5. **Click "View NL market"**
   - ✅ Marktplaats opens in new tab with correct search
6. **Click "View FR market"**
   - ✅ Leboncoin opens in new tab with correct search

**Expected Result:**
- Both buttons visible and clickable
- Correct URLs open (not undefined/blank)
- New tabs open (don't navigate away from Ada)

**If it fails:**
- Clear browser cache (Ctrl+Shift+Delete)
- Hard refresh (Ctrl+Shift+R)
- Check browser console for errors

---

### Test 2: Batch Execution Speed ✅

1. Go to **Run Searches** page
2. Select 3 studies (start small for testing)
3. Click **"Run Now (3 selected)"**
4. Observe widget in bottom-right corner:
   - Should show "1 running (1 of 3)"
   - Then "1 running (2 of 3)"
   - Then "1 running (3 of 3)"
   - Finally "All completed"
5. **Verify timing:**
   - Each study completes in 30-90 seconds (not 5 minutes!)
   - Total time: ~3-5 minutes for 3 studies

**Expected Railway Worker Logs:**
```
[WORKER] Processing study TOYOTA_YARIS_2024_FR_NL in FAST mode
[WORKER] ✅ Result persisted to study_run_results
[WORKER] ✅ Updated scheduled_study_runs to completed
```

**Key Indicator:**
Look for "Updated scheduled_study_runs to completed" in logs - this triggers Realtime!

**If studies still timeout at 5 minutes:**
1. Check Railway Worker logs for errors
2. Verify database migration applied:
   ```sql
   SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
   AND tablename = 'scheduled_study_runs';
   ```
   Should return: `scheduled_study_runs`
3. Restart Worker service on Railway

---

### Test 3: Cancel Button Persistence ✅

1. Go to **Run Searches** page
2. Select 6 studies
3. Click **"Run Now (6 selected)"**
4. Verify **"Cancel Run"** button appears (red button)
5. **Navigate to "Results" page**
6. **Navigate back to "Run Searches" page**
7. ✅ **"Cancel Run" button should still be visible**
8. Click **"Cancel Run"**
9. ✅ Batch stops after current study completes
10. Check Results page - should show 1-3 completed studies (not all 6)

**Expected Database State:**
```sql
SELECT id, status, cancel_requested, total_studies
FROM study_runs
WHERE status = 'cancelled'
ORDER BY executed_at DESC
LIMIT 1;

-- Should show cancel_requested = TRUE
```

**If cancel button disappears:**
1. Check browser console for "[RUN_SEARCHES] Found active run from previous session"
2. Verify database column exists:
   ```sql
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'study_runs'
   AND column_name = 'cancel_requested';
   ```
3. Clear browser cache and try again

---

## Railway Configuration

### Environment Variables

Both **Frontend** and **Worker** need these environment variables in Railway:

**Frontend Service:**
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SCRAPER_MODE=api
VITE_SCHEDULER_CRON_SECRET=your-cron-secret
```

**Worker Service:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ZYTE_API_KEY=your-zyte-api-key
PORT=3001
```

**Verify these are set:**
1. Go to Railway dashboard
2. Click on each service
3. Go to "Variables" tab
4. Confirm all variables present

---

## Troubleshooting Common Issues

### Issue 1: "Marketplace buttons still don't work"

**Symptoms:**
- Buttons are visible but clicking does nothing
- Browser console shows "undefined"

**Solution:**
```bash
# 1. Verify frontend was redeployed
railway logs --service=frontend

# 2. Clear browser cache completely
# Chrome: Ctrl+Shift+Delete → Select "All time" → Clear

# 3. Hard refresh page
# Ctrl+Shift+R (or Cmd+Shift+R on Mac)

# 4. Check database has URLs
SELECT market_target_url, market_source_url
FROM studies_v2
WHERE id = 'your-study-id';
```

---

### Issue 2: "Studies still timeout at 5 minutes"

**Symptoms:**
- Widget shows "1 running" for 5 minutes per study
- No progress to next study

**Solution:**

**Step 1: Verify Realtime migration applied**
```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';

-- Should include: study_runs, study_run_results, scheduled_study_runs
```

**Step 2: Check Worker logs**
```bash
railway logs --service=worker

# Look for:
# ✅ "Updated scheduled_study_runs to completed"
# ❌ Any database errors
```

**Step 3: Verify Worker updated**
```bash
# Check Worker build includes latest code
railway logs --service=worker | grep "Worker started"

# Should show recent timestamp
```

**Step 4: Restart Worker**
```bash
# In Railway dashboard:
# Worker Service → Settings → Restart
```

---

### Issue 3: "Cancel button doesn't persist"

**Symptoms:**
- Cancel button visible during run
- Disappears when navigating to another page
- Doesn't reappear when returning to "Run Searches"

**Solution:**

**Step 1: Verify database column exists**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'study_runs'
AND column_name = 'cancel_requested';

-- Should return: cancel_requested
```

**Step 2: Check browser console**
```
# Should see on page load:
[RUN_SEARCHES] Found active run from previous session: <uuid>
[RUN_SEARCHES] Restored state: 2/6, cancel_requested=true
```

**Step 3: Verify frontend deployed**
```bash
railway logs --service=frontend

# Look for successful build including StudiesV2RunSearches.tsx changes
```

**Step 4: Test database write**
```sql
-- When you click "Cancel Run", check database updates:
SELECT id, status, cancel_requested
FROM study_runs
WHERE status = 'running'
ORDER BY executed_at DESC
LIMIT 1;

-- cancel_requested should change from FALSE to TRUE
```

---

### Issue 4: "Railway build fails"

**Symptoms:**
- Railway logs show build errors
- Deployment stuck or fails

**Common Causes & Solutions:**

**Cause 1: Missing dependencies**
```bash
# In Railway dashboard, check build logs for:
# "Cannot find module '@supabase/supabase-js'"

# Solution: Verify package.json includes all dependencies
npm install
git add package-lock.json
git commit -m "Update dependencies"
git push
```

**Cause 2: TypeScript errors**
```bash
# Run locally to see errors:
npm run build

# Fix any TypeScript errors, then:
git add .
git commit -m "Fix TypeScript errors"
git push
```

**Cause 3: Build context issue (Worker)**
```bash
# Worker needs access to ../src/lib/study-core/

# Check Railway settings:
# Worker Service → Settings → Root Directory: "worker"
# Worker Service → Settings → Build Command: "npm run build"
# Worker Service → Settings → Start Command: "npm start"
```

---

## Rollback Plan (If Something Goes Wrong)

### Rollback Code Changes

```bash
# If deployment breaks production:

# Option 1: Revert last commit
git revert HEAD
git push origin main

# Option 2: Rollback to specific commit
git log  # Find last working commit hash
git revert <commit-hash>
git push origin main

# Railway auto-deploys reverted code
```

### Rollback Database Migrations

```sql
-- If cancel_requested column causes issues:
ALTER TABLE study_runs DROP COLUMN IF EXISTS cancel_requested;
DROP INDEX IF EXISTS idx_study_runs_cancel_requested;

-- If Realtime causes issues:
ALTER PUBLICATION supabase_realtime DROP TABLE scheduled_study_runs;
```

### Railway Service Rollback

```bash
# In Railway dashboard:
# 1. Go to Deployments tab
# 2. Find last working deployment
# 3. Click "Redeploy"
```

---

## Performance Expectations After Deployment

### Before Fixes:

| Metric | Value |
|--------|-------|
| Per study execution | 5-6 minutes (timeout) |
| Batch of 6 studies | 30-36 minutes |
| Marketplace links | ❌ Broken |
| Cancel button | ❌ Lost on navigation |
| User experience | 😞 Frustrating |

### After Fixes:

| Metric | Value |
|--------|-------|
| Per study execution | 30-90 seconds |
| Batch of 6 studies | 3-9 minutes |
| Marketplace links | ✅ Working |
| Cancel button | ✅ Persists |
| User experience | 😊 Professional |

**Improvement:** **6-10x faster batch execution** + complete UX fixes

---

## Database Migrations Applied

### Migration 1: `enable_realtime_scheduled_runs`

**Purpose:** Enables Realtime push notifications for `scheduled_study_runs` table

**SQL:**
```sql
ALTER TABLE scheduled_study_runs REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS scheduled_study_runs;
```

**Verification:**
```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'scheduled_study_runs';
```

---

### Migration 2: `add_cancel_requested_to_study_runs`

**Purpose:** Persist cancel state across page navigation

**SQL:**
```sql
ALTER TABLE study_runs ADD COLUMN cancel_requested BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_study_runs_cancel_requested
ON study_runs(status, cancel_requested)
WHERE status = 'running';
```

**Verification:**
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'study_runs'
AND column_name = 'cancel_requested';

-- Should show: cancel_requested | boolean | false
```

---

## Console Logs to Expect

### Successful Batch Run (3 Studies)

**Frontend Console:**
```
[BATCH_RUN] ▶️ Starting study 1/3: TOYOTA_YARIS_2024_FR_NL
[REMOTE_RUNNER] 📡 Setting up Realtime subscriptions...
[REMOTE_RUNNER] ✅ Status channel subscribed
[REMOTE_RUNNER] 🏃 Job is now running on Worker

[REMOTE_RUNNER] 📬 Status update: completed ← Realtime fires!
[REMOTE_RUNNER] ✅ Results received via Realtime!
[BATCH_RUN] 💰 Study TOYOTA_YARIS_2024_FR_NL found opportunities
[BATCH_RUN] ✅ Study 1/3 completed

[BATCH_RUN] ▶️ Starting study 2/3: BMW_X5_2021_FR_NL ← Immediate!
...
[BATCH_RUN] 🏁 Batch completed. Final counts: opportunities=2, null=1
```

**Railway Worker Logs:**
```
[WORKER] 📥 Received request for study TOYOTA_YARIS_2024_FR_NL
[WORKER] Processing in FAST mode (page 1 only)
[WORKER] ✅ Result persisted to study_run_results
[WORKER] ✅ Updated scheduled_study_runs to completed ← CRITICAL!

[WORKER] 📥 Received request for study BMW_X5_2021_FR_NL
...
```

**Key Indicators of Success:**
- ✅ "Updated scheduled_study_runs to completed" in Worker logs
- ✅ "Status update: completed" in Frontend console (Realtime working!)
- ✅ Next study starts within 3-5 seconds (not 5 minutes)

---

### Successful Cancel Operation

**Frontend Console:**
```
[BATCH_RUN] ▶️ Starting study 2/6: AUDI_A4_2020_FR_NL
[RUN_SEARCHES] ✅ Persisted cancel_requested to database ← User clicked Cancel
[RUN] Cancellation requested by user, stopping after current study
[BATCH_RUN] ✅ Study 2/6 completed
[BATCH_RUN] 🏁 Batch cancelled. Updating run record...
```

**Database State:**
```sql
SELECT status, cancel_requested, total_studies, opportunities_count
FROM study_runs
WHERE id = '<run-id>';

-- Result:
-- status: 'cancelled'
-- cancel_requested: TRUE
-- total_studies: 6
-- opportunities_count: 1  (only completed studies counted)
```

---

### Cancel Button Restored on Page Load

**Frontend Console:**
```
[RUN_SEARCHES] Found active run from previous session: <uuid>
[RUN_SEARCHES] Restored state: 2/6, cancel_requested=true

-- UI shows:
-- "Cancel Run" button visible (red)
-- Progress: "Cancelling after current study..."
```

---

## Railway Service Health Checks

### Check Worker Status

```bash
railway logs --service=worker --tail

# Should see:
# ✅ "Worker started on port 3001"
# ✅ "Database connection successful"
# ❌ No "ECONNREFUSED" errors
# ❌ No "Zyte API error" (if Zyte is configured)
```

### Check Frontend Status

```bash
railway logs --service=frontend --tail

# Should see:
# ✅ Build completed successfully
# ✅ "Listening on port 3000" (or your configured port)
# ❌ No 404 errors
# ❌ No module not found errors
```

---

## Final Deployment Checklist

Before declaring deployment successful:

- [ ] Frontend deployed successfully on Railway
- [ ] Worker deployed successfully on Railway
- [ ] Database migrations verified applied
- [ ] Marketplace links test PASSED
- [ ] Batch execution speed test PASSED (30-90s per study)
- [ ] Cancel button persistence test PASSED
- [ ] Railway logs show no errors
- [ ] Environment variables verified
- [ ] Tested with 1 study (smoke test)
- [ ] Tested with 3 studies (full test)
- [ ] User notified deployment is complete

---

## Support Commands

### Quick Railway Commands

```bash
# View recent logs
railway logs --service=worker --tail
railway logs --service=frontend --tail

# Restart a service
railway restart --service=worker

# Check service status
railway status

# Link to project (if not linked)
railway link

# Deploy manually
railway up
```

### Quick Database Queries

```sql
-- Check Realtime tables
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';

-- Check active runs
SELECT id, status, cancel_requested, executed_at
FROM study_runs
WHERE status = 'running';

-- Check recent results
SELECT sr.brand, sr.model, srr.status, srr.price_difference
FROM study_run_results srr
JOIN studies_v2 sr ON sr.id = srr.study_id
ORDER BY srr.created_at DESC
LIMIT 10;

-- Check if cancel_requested works
SELECT id, cancel_requested
FROM study_runs
WHERE cancel_requested = TRUE;
```

---

## Success Criteria

Deployment is **successful** when:

1. ✅ **Marketplace Links Work**
   - Both "View NL market" and "View FR market" buttons clickable
   - Correct marketplaces open in new tabs
   - No "undefined" in URLs

2. ✅ **Batch Execution is Fast**
   - Studies complete in 30-90 seconds each
   - Widget shows progress counter "(2 of 6)"
   - No 5-minute timeouts
   - Batch of 6 studies: 3-9 minutes total

3. ✅ **Cancel Button Persists**
   - Visible during batch execution
   - Still visible after navigating away and back
   - Clicking stops batch cleanly
   - Database shows `cancel_requested = TRUE`

4. ✅ **No Errors in Logs**
   - Railway Worker logs clean
   - Railway Frontend logs clean
   - Browser console clean
   - No database errors

5. ✅ **Database Healthy**
   - Both migrations applied successfully
   - Realtime working for all 3 tables
   - `cancel_requested` column exists

---

## Next Steps After Deployment

1. **Monitor first few runs** in production
   - Watch Railway logs for any unexpected errors
   - Check Supabase dashboard for database load
   - Monitor Zyte API usage

2. **Gather user feedback**
   - Are marketplace links working as expected?
   - Is batch execution speed acceptable?
   - Does cancel button behavior make sense?

3. **Consider enhancements** (future work)
   - Add "Pause/Resume" functionality
   - Email notifications when batch completes
   - Batch scheduling with recurring runs
   - Export results to CSV/Excel

---

## Contact for Issues

If you encounter any issues during deployment:

1. **Check this guide first** - Most issues are covered in Troubleshooting
2. **Check Railway logs** - Often reveals the root cause
3. **Check browser console** - Frontend errors visible here
4. **Check database** - Verify migrations applied
5. **Rollback if critical** - Use Rollback Plan above

---

**Deployment Version:** 3.0.0 - Complete Fix
**Date:** 2026-01-21
**Includes:** Marketplace links + Batch orchestration + Cancel persistence
**Status:** Ready for Railway deployment
