# Scheduled Runs Architecture & Testing Guide

This document describes the reliable, idempotent architecture for overnight scheduled market studies with comprehensive monitoring and automatic recovery.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Execution Flow](#execution-flow)
4. [Robustness Features](#robustness-features)
5. [Monitoring & Validation](#monitoring--validation)
6. [Testing Guide](#testing-guide)
7. [Troubleshooting](#troubleshooting)
8. [Cron Configuration](#cron-configuration)

---

## Architecture Overview

The scheduled runs system consists of four main components:

```
┌─────────────────┐
│  Cron Service   │ (cron-job.org or GitHub Actions)
│  (External)     │
└────────┬────────┘
         │ Every 5-15 minutes
         │ POST with SCHEDULER_CRON_SECRET
         ▼
┌─────────────────────────────────┐
│  Edge Function                  │
│  run_scheduled_studies          │
│  - Polls pending jobs           │
│  - Atomic job locking           │
│  - Tracks execution duration    │
│  - Sends heartbeats             │
└────────┬────────────────────────┘
         │ HTTP POST to worker
         │ Payload: runId, studyIds[], threshold
         ▼
┌─────────────────────────────────┐
│  Node.js Worker Service         │
│  - Executes studies             │
│  - Sends heartbeats every 30s   │
│  - Handles retries              │
│  - Persists results             │
└────────┬────────────────────────┘
         │ Writes to database
         ▼
┌─────────────────────────────────┐
│  PostgreSQL Database            │
│  - scheduled_study_runs         │
│  - study_runs                   │
│  - study_run_results            │
│  - study_source_listings        │
└─────────────────────────────────┘
         ▲
         │ Automated cleanup
         │
┌─────────────────────────────────┐
│  Edge Function (Cleanup)        │
│  cleanup_stale_jobs             │
│  - Marks stale jobs as failed   │
│  - Runs every 10-30 minutes     │
└─────────────────────────────────┘
```

---

## Database Schema

### Core Tables

#### `scheduled_study_runs` (Job Queue)
Stores scheduled job definitions and execution state.

```sql
CREATE TABLE scheduled_study_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  scheduled_at timestamptz NOT NULL,     -- When to run
  status text NOT NULL,                  -- pending|running|completed|failed|cancelled
  payload jsonb NOT NULL,                -- {studyIds: [], threshold: 5000, type: 'instant'}
  last_run_at timestamptz,               -- When execution started
  last_heartbeat_at timestamptz,         -- Last liveness signal
  last_updated_at timestamptz DEFAULT now(), -- Last status change
  last_error text,                       -- Error message if failed
  run_id uuid REFERENCES study_runs(id), -- Link to execution
  execution_duration_ms integer,         -- Total runtime in milliseconds
  idempotency_key text                   -- Prevents duplicate processing
);
```

**Status Flow:**
- `pending` → Job waiting to be picked up
- `running` → Worker is executing (sends heartbeats)
- `completed` → Successfully finished
- `failed` → Error occurred or marked stale
- `cancelled` → User cancelled before execution

**Key Indexes:**
- `idx_scheduled_study_runs_due` on `(status, scheduled_at)` - efficient job polling
- `idx_scheduled_study_runs_running` on `(status, last_updated_at)` - monitoring
- `idx_scheduled_study_runs_heartbeat` on `(status, last_heartbeat_at)` - stale detection

#### `study_runs` (Execution Tracking)
Tracks execution of study batches.

```sql
CREATE TABLE study_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,                -- instant|scheduled
  executed_at timestamptz DEFAULT now(),
  status text NOT NULL,                  -- pending|running|completed|error
  total_studies integer,
  null_count integer,                    -- Studies with no opportunities
  opportunities_count integer,           -- Studies with opportunities
  error_message text,
  last_heartbeat_at timestamptz,
  last_updated_at timestamptz DEFAULT now(),
  price_diff_threshold_eur integer
);
```

#### `study_run_results` (Per-Study Outcomes)
One row per study per run.

```sql
CREATE TABLE study_run_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES study_runs(id) ON DELETE CASCADE,
  study_id text REFERENCES studies_v2(id) ON DELETE CASCADE,
  status text NOT NULL,                  -- NULL|OPPORTUNITIES|TARGET_BLOCKED
  target_market_price numeric,
  best_source_price numeric,
  price_difference numeric,
  target_stats jsonb,
  target_error_reason text,
  created_at timestamptz DEFAULT now(),

  -- DUPLICATE PREVENTION
  CONSTRAINT unique_run_study UNIQUE(run_id, study_id)
);
```

#### `study_source_listings` (Opportunity Details)
Stores interesting listings for opportunities.

```sql
CREATE TABLE study_source_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_result_id uuid REFERENCES study_run_results(id) ON DELETE CASCADE,
  listing_url text NOT NULL,
  title text,
  price numeric,
  mileage integer,
  year integer,
  status text NOT NULL,                  -- NEW|APPROVED|REJECTED|COMPLETED
  -- ... other fields

  -- DUPLICATE PREVENTION (partial index)
  CREATE UNIQUE INDEX unique_listing_per_result
  ON study_source_listings(listing_url, run_result_id)
  WHERE listing_url IS NOT NULL AND listing_url != ''
);
```

---

## Execution Flow

### 1. Job Scheduling

**Creating a Scheduled Job:**
```typescript
const { data, error } = await supabase
  .from('scheduled_study_runs')
  .insert({
    scheduled_at: '2024-12-20 02:00:00+00',
    status: 'pending',
    payload: {
      studyIds: ['study1', 'study2', 'study3'],
      threshold: 5000,
      type: 'instant',
      scrapeMode: 'fast'
    }
  });
```

### 2. Job Pickup (Edge Function)

**Polling Query:**
```sql
SELECT * FROM scheduled_study_runs
WHERE status = 'pending'
AND scheduled_at <= NOW()
ORDER BY scheduled_at ASC
LIMIT 5;
```

**Atomic Lock:**
```sql
UPDATE scheduled_study_runs
SET status = 'running',
    last_run_at = NOW(),
    last_heartbeat_at = NOW()
WHERE id = $1
AND status = 'pending';  -- Only lock if still pending
```

### 3. Worker Execution

**Heartbeat Updates:**
Every 30 seconds during execution:
```javascript
await supabase
  .from('scheduled_study_runs')
  .update({ last_heartbeat_at: new Date().toISOString() })
  .eq('id', scheduledJobId);

await supabase
  .from('study_runs')
  .update({ last_heartbeat_at: new Date().toISOString() })
  .eq('id', runId);
```

**Completion:**
```sql
UPDATE scheduled_study_runs
SET status = 'completed',
    execution_duration_ms = $duration
WHERE id = $1;
```

### 4. Stale Job Cleanup

**Automated Cleanup (runs every 10-30 minutes):**
```sql
SELECT * FROM cleanup_stale_jobs(
  timeout_seconds := 7200,        -- 2 hours total timeout
  heartbeat_timeout_seconds := 600 -- 10 minutes heartbeat timeout
);
```

**Cleanup Logic:**
- Jobs in `running` status for > 2 hours with no heartbeat → marked `failed`
- Jobs with heartbeat but no update in > 10 minutes → marked `failed`
- Corresponding `study_runs` also marked as `error`

---

## Robustness Features

### 1. Duplicate Prevention

**Unique Constraints:**
```sql
-- Prevents same study being stored twice in same run
ALTER TABLE study_run_results
ADD CONSTRAINT unique_run_study UNIQUE(run_id, study_id);

-- Prevents same listing URL being stored twice per result
CREATE UNIQUE INDEX unique_listing_per_result
ON study_source_listings(listing_url, run_result_id)
WHERE listing_url IS NOT NULL AND listing_url != '';
```

**Effect:** If code attempts duplicate insert, database rejects with constraint violation.

### 2. Atomic Job Locking

**Optimistic Concurrency Control:**
```sql
UPDATE scheduled_study_runs
SET status = 'running', last_run_at = NOW()
WHERE id = $1 AND status = 'pending'
RETURNING id;
```

**Effect:** Only one worker can successfully lock a pending job. Others get 0 rows updated.

### 3. Heartbeat Liveness Detection

**Worker sends heartbeat every 30 seconds:**
- Target scrape start
- Target scrape complete
- Source scrape start
- Source scrape complete

**Cleanup detects stale jobs:**
- No heartbeat for 10 minutes → mark failed
- Running for 2 hours with no heartbeat → mark failed

### 4. Automatic Status Tracking

**Trigger auto-updates `last_updated_at`:**
```sql
CREATE TRIGGER trigger_scheduled_study_runs_updated
  BEFORE UPDATE ON scheduled_study_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_last_updated_at();
```

**Effect:** Every status change automatically timestamped for monitoring.

### 5. Execution Duration Tracking

Records milliseconds from job start to completion:
- Monitor performance trends
- Identify slow studies
- Detect timeouts

### 6. Comprehensive Logging

**study_run_logs table:**
- Every significant event logged
- Structured JSON diagnostics
- Retained for debugging

---

## Monitoring & Validation

### Quick Health Check

```sql
-- Run this query for instant system status
SELECT * FROM v_scheduled_job_stats
WHERE schedule_date > CURRENT_DATE - 7;
```

### Validation Scripts

Run `VALIDATE_SCHEDULED_ROBUSTNESS.sql` regularly:

```bash
# Execute validation script
psql -f VALIDATE_SCHEDULED_ROBUSTNESS.sql
```

**Key Checks:**
1. ✅ No duplicate study results
2. ✅ No duplicate listings
3. ✅ No stale running jobs
4. ✅ Heartbeat tracking active
5. ✅ Success rate > 80%

### Monitoring Views

**v_running_scheduled_jobs:**
```sql
SELECT * FROM v_running_scheduled_jobs;
-- Shows currently executing jobs with heartbeat status
```

**v_stale_scheduled_jobs:**
```sql
SELECT * FROM v_stale_scheduled_jobs;
-- Identifies jobs that need cleanup
```

**v_scheduled_job_stats:**
```sql
SELECT * FROM v_scheduled_job_stats;
-- Execution statistics (last 30 days)
```

### Alerting Criteria

Set up alerts for:
- ❗ Stale jobs detected (> 10 minutes no heartbeat)
- ❗ High failure rate (> 20% failed last 24h)
- ⚠️  Many running jobs (> 5 concurrent)
- ⚠️  Slow execution (> 30 minutes for 10 studies)

---

## Testing Guide

### Local Testing

#### 1. Test Database Constraints

```sql
-- Test duplicate prevention
BEGIN;

-- Create test run
INSERT INTO study_runs (id, run_type, status, total_studies)
VALUES ('test-run-id', 'instant', 'completed', 2);

-- Insert first result (should succeed)
INSERT INTO study_run_results (run_id, study_id, status)
VALUES ('test-run-id', 'TEST_STUDY_1', 'NULL');

-- Try duplicate (should fail with unique constraint violation)
INSERT INTO study_run_results (run_id, study_id, status)
VALUES ('test-run-id', 'TEST_STUDY_1', 'NULL');

ROLLBACK;
```

**Expected:** Second insert fails with:
```
ERROR: duplicate key value violates unique constraint "unique_run_study"
```

#### 2. Test Atomic Job Locking

```sql
BEGIN;

-- Create test job
INSERT INTO scheduled_study_runs (id, scheduled_at, status, payload)
VALUES ('test-job-id', now(), 'pending', '{"studyIds": ["test"]}');

-- First worker locks (should succeed)
UPDATE scheduled_study_runs
SET status = 'running'
WHERE id = 'test-job-id' AND status = 'pending';

-- Second worker tries to lock (should fail - 0 rows updated)
UPDATE scheduled_study_runs
SET status = 'running'
WHERE id = 'test-job-id' AND status = 'pending';

ROLLBACK;
```

**Expected:** First UPDATE returns 1 row, second returns 0 rows.

#### 3. Test Stale Job Cleanup

```sql
-- Create stale test job
INSERT INTO scheduled_study_runs (scheduled_at, status, payload, last_updated_at)
VALUES (now() - interval '1 day', 'running', '{"studyIds": ["test"]}', now() - interval '3 hours');

-- Run cleanup
SELECT * FROM cleanup_stale_jobs(7200, 600);

-- Verify job marked as failed
SELECT status, last_error FROM scheduled_study_runs
WHERE payload->>'studyIds' = '["test"]';
```

**Expected:** Job status changed to `failed` with error message about stale timeout.

#### 4. Test Heartbeat Tracking

```javascript
// In worker execution
console.log('Testing heartbeat...');

// Start execution
await supabase
  .from('scheduled_study_runs')
  .update({ status: 'running', last_heartbeat_at: new Date().toISOString() })
  .eq('id', jobId);

// Simulate work
await new Promise(resolve => setTimeout(resolve, 5000));

// Send heartbeat
await supabase
  .from('scheduled_study_runs')
  .update({ last_heartbeat_at: new Date().toISOString() })
  .eq('id', jobId);

// Verify heartbeat recorded
const { data } = await supabase
  .from('scheduled_study_runs')
  .select('last_heartbeat_at')
  .eq('id', jobId)
  .single();

console.log('Heartbeat time:', data.last_heartbeat_at);
```

### End-to-End Testing

#### 1. Schedule Test Job

```typescript
// Create job for immediate execution
const { data: job } = await supabase
  .from('scheduled_study_runs')
  .insert({
    scheduled_at: new Date().toISOString(),
    status: 'pending',
    payload: {
      studyIds: ['TOYOTA_YARIS CROSS_2025_FR_NL'],
      threshold: 5000,
      type: 'instant',
      scrapeMode: 'fast'
    }
  })
  .select()
  .single();

console.log('Created job:', job.id);
```

#### 2. Trigger Edge Function

```bash
# Manually trigger the scheduler
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/run_scheduled_studies" \
  -H "Authorization: Bearer YOUR_SCHEDULER_CRON_SECRET" \
  -H "Content-Type: application/json"
```

#### 3. Monitor Execution

```sql
-- Watch job progress
SELECT
  id,
  status,
  last_heartbeat_at,
  EXTRACT(EPOCH FROM (now() - last_heartbeat_at))::integer as seconds_since_heartbeat
FROM scheduled_study_runs
WHERE id = 'your-job-id';

-- Refresh every 5 seconds
\watch 5
```

#### 4. Verify Results

```sql
-- Check completion
SELECT
  s.status,
  s.execution_duration_ms / 1000 as duration_seconds,
  r.total_studies,
  r.null_count,
  r.opportunities_count
FROM scheduled_study_runs s
JOIN study_runs r ON s.run_id = r.id
WHERE s.id = 'your-job-id';

-- Check study results
SELECT
  study_id,
  status,
  target_market_price,
  best_source_price,
  price_difference
FROM study_run_results
WHERE run_id = (
  SELECT run_id FROM scheduled_study_runs WHERE id = 'your-job-id'
);
```

### Performance Testing

#### Test High Load

```typescript
// Schedule 50 jobs for same time
const jobs = [];
for (let i = 0; i < 50; i++) {
  jobs.push({
    scheduled_at: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
    status: 'pending',
    payload: {
      studyIds: [`TEST_STUDY_${i}`],
      threshold: 5000,
      type: 'instant',
      scrapeMode: 'fast'
    }
  });
}

const { data } = await supabase
  .from('scheduled_study_runs')
  .insert(jobs)
  .select();

console.log('Created 50 jobs');

// Monitor execution rate
// Should process 5 per scheduler invocation
// With 5-minute cron, should complete in ~50 minutes
```

---

## Troubleshooting

### Issue: Jobs Stuck in Running

**Symptoms:**
```sql
SELECT * FROM v_stale_scheduled_jobs;
-- Returns rows
```

**Solution:**
```sql
-- Manual cleanup
SELECT * FROM cleanup_stale_jobs();
```

**Prevention:**
- Ensure cleanup edge function is called by cron
- Check worker service is running
- Verify heartbeat updates are working

### Issue: Duplicate Results

**Symptoms:**
```sql
SELECT run_id, study_id, COUNT(*)
FROM study_run_results
GROUP BY run_id, study_id
HAVING COUNT(*) > 1;
-- Returns rows
```

**Root Cause:** Code calling insert multiple times or constraint not applied.

**Solution:**
```sql
-- Verify constraint exists
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'study_run_results'
AND constraint_type = 'UNIQUE';

-- If missing, apply migration again
-- Then delete duplicates manually
```

### Issue: High Failure Rate

**Symptoms:**
```sql
SELECT * FROM v_scheduled_job_stats
WHERE schedule_date > CURRENT_DATE - 1;
-- Shows > 20% failed
```

**Investigation Steps:**
1. Check recent errors:
```sql
SELECT last_error, COUNT(*)
FROM scheduled_study_runs
WHERE status = 'failed'
AND scheduled_at > now() - interval '24 hours'
GROUP BY last_error
ORDER BY COUNT(*) DESC;
```

2. Check worker logs
3. Verify worker service is running
4. Check Zyte API quota/limits

### Issue: No Heartbeats Recorded

**Symptoms:**
```sql
SELECT * FROM scheduled_study_runs
WHERE status = 'completed'
AND scheduled_at > now() - interval '24 hours'
AND last_heartbeat_at IS NULL;
-- Returns many rows
```

**Root Cause:** Worker not calling heartbeat function.

**Solution:**
- Verify worker code includes `updateHeartbeat()` calls
- Check worker has database permissions
- Restart worker service

---

## Cron Configuration

### Option 1: cron-job.org (Recommended)

1. Sign up at https://cron-job.org
2. Create new job:
   - **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/run_scheduled_studies`
   - **Schedule:** Every 5-15 minutes (*/5 or */15)
   - **HTTP Method:** POST
   - **Headers:**
     ```
     Authorization: Bearer YOUR_SCHEDULER_CRON_SECRET
     Content-Type: application/json
     ```
   - **Timeout:** 60 seconds

3. Create cleanup job:
   - **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/cleanup_stale_jobs`
   - **Schedule:** Every 10-30 minutes
   - **HTTP Method:** POST
   - **Headers:** Same as above

### Option 2: GitHub Actions

Create `.github/workflows/scheduled-runs.yml`:

```yaml
name: Scheduled Study Runs

on:
  schedule:
    # Every 5 minutes
    - cron: '*/5 * * * *'
  workflow_dispatch:  # Allow manual trigger

jobs:
  trigger-scheduled-runs:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Scheduler
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/run_scheduled_studies" \
            -H "Authorization: Bearer ${{ secrets.SCHEDULER_CRON_SECRET }}" \
            -H "Content-Type: application/json"

  cleanup-stale-jobs:
    runs-on: ubuntu-latest
    if: github.event.schedule == '*/10 * * * *'  # Every 10 minutes
    steps:
      - name: Cleanup Stale Jobs
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/cleanup_stale_jobs" \
            -H "Authorization: Bearer ${{ secrets.SCHEDULER_CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

### Option 3: Supabase pg_cron (Future)

Once available, use pg_cron extension:

```sql
-- Schedule runs every 5 minutes
SELECT cron.schedule(
  'run-scheduled-studies',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/run_scheduled_studies',
    headers := '{"Authorization": "Bearer SECRET"}'::jsonb
  )
  $$
);

-- Cleanup every 10 minutes
SELECT cron.schedule(
  'cleanup-stale-jobs',
  '*/10 * * * *',
  $$ SELECT * FROM cleanup_stale_jobs() $$
);
```

---

## Summary

**Key Improvements Delivered:**

1. ✅ **Duplicate Prevention** - Unique constraints prevent data corruption
2. ✅ **Atomic Locking** - Only one worker can execute each job
3. ✅ **Heartbeat Monitoring** - Detect and recover from crashed jobs
4. ✅ **Automatic Cleanup** - Stale jobs marked failed within 10 minutes
5. ✅ **Execution Tracking** - Duration and performance metrics
6. ✅ **Comprehensive Monitoring** - Views and validation scripts
7. ✅ **Zero Regression** - All existing features preserved

**Testing Checklist:**

- [ ] Run `VALIDATE_SCHEDULED_ROBUSTNESS.sql` and verify no issues
- [ ] Test duplicate prevention with manual insert attempts
- [ ] Test atomic locking with concurrent UPDATE attempts
- [ ] Create test job and verify heartbeats are recorded
- [ ] Trigger cleanup and verify stale jobs are marked failed
- [ ] Schedule real job and monitor end-to-end execution
- [ ] Verify results are correct and no duplicates
- [ ] Configure cron jobs for production use

**Production Deployment:**

1. Apply database migration (already done)
2. Deploy updated worker service
3. Deploy edge functions (scheduler + cleanup)
4. Configure cron jobs (5-minute scheduler, 10-minute cleanup)
5. Run validation scripts daily
6. Monitor views regularly
7. Set up alerts for stale jobs and high failure rates

For questions or issues, refer to the validation scripts and monitoring views included in this repository.
