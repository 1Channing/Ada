# Scheduled Studies Testing Guide

This document provides instructions for testing the new backend scheduling system for studies.

## Overview

The scheduled studies system allows you to schedule study runs that execute automatically via a backend worker, even when the UI is closed. The system consists of:

1. **Database Table**: `scheduled_study_runs` - Queue for scheduled jobs
2. **Frontend UI**: Updated "Schedule Search" card in Run Searches page
3. **Edge Function**: `run_scheduled_studies` - Backend worker that processes due jobs

## Prerequisites

Make sure you have the following environment variables configured:
- `ZYTE_API_KEY` or `VITE_ZYTE_API_KEY` - For web scraping
- `OPENAI_API_KEY` or `VITE_OPENAI_API_KEY` - For AI analysis
- `CRON_SECRET` (optional) - For securing the Edge Function endpoint

## Testing Instructions

### 1. Schedule a Job from the UI

1. Navigate to the "Run Searches" page
2. Select one or more studies from the list
3. Set the price difference threshold (e.g., 5000 EUR)
4. In the "Schedule Search" card:
   - Select a date (e.g., tomorrow's date)
   - Select a time (e.g., 2 minutes from now for testing)
5. Click "Schedule (X selected)"
6. You should see a confirmation alert:
   ```
   Search scheduled for [date/time].

   X studies will run automatically via the backend worker.

   Results will appear in the Results page once completed.
   ```
7. After clicking OK, the "Next scheduled run" section should appear showing your scheduled job

### 2. Verify the Scheduled Job in Database

You can verify the job was created by checking the `scheduled_study_runs` table:

```sql
SELECT * FROM scheduled_study_runs
WHERE status = 'pending'
ORDER BY scheduled_at DESC
LIMIT 5;
```

You should see your job with:
- `status`: 'pending'
- `scheduled_at`: The date/time you selected
- `payload`: JSON containing `studyIds`, `threshold`, and `type`

### 3. Manually Trigger the Edge Function

#### Option A: Using Browser/Fetch (with CRON_SECRET)

If you have a `CRON_SECRET` configured, you can trigger it with:

```javascript
// In browser console or via fetch
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const cronSecret = 'your-cron-secret'; // If configured

const response = await fetch(`${supabaseUrl}/functions/v1/run_scheduled_studies?secret=${cronSecret}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
});

const result = await response.json();
console.log(result);
```

#### Option B: Using curl (without CRON_SECRET)

If `CRON_SECRET` is not configured, you can trigger it directly:

```bash
curl -X POST "https://[your-project-ref].supabase.co/functions/v1/run_scheduled_studies"
```

#### Expected Response

The Edge Function should return:

```json
{
  "processed": 1,
  "completed": 1,
  "failed": 0
}
```

Where:
- `processed`: Number of jobs found and processed
- `completed`: Number of jobs that completed successfully
- `failed`: Number of jobs that failed

### 4. Verify Job Execution

After triggering the Edge Function:

1. **Check the job status**:
   ```sql
   SELECT * FROM scheduled_study_runs
   WHERE id = '[your-job-id]';
   ```
   - `status` should be 'completed' (or 'running' if still in progress)
   - `run_id` should be populated with the created study_run ID
   - `last_run_at` should show when it ran

2. **Check study_runs table**:
   ```sql
   SELECT * FROM study_runs
   WHERE run_type = 'scheduled'
   ORDER BY executed_at DESC
   LIMIT 1;
   ```
   You should see a new run with:
   - `run_type`: 'scheduled'
   - `status`: 'completed'
   - `total_studies`: Number of studies you scheduled
   - `null_count` and `opportunities_count`: Results of the run

3. **Check Results in UI**:
   - Navigate to the "Results" page
   - You should see the new run with all the study results
   - Results should be identical to manually running the same studies

### 5. Test Edge Cases

#### Test 1: No Due Jobs
```bash
# Trigger the worker when no jobs are due
curl -X POST "https://[your-project-ref].supabase.co/functions/v1/run_scheduled_studies"
```

Expected response:
```json
{
  "processed": 0,
  "completed": 0,
  "failed": 0
}
```

#### Test 2: Invalid Date
In the UI, try to schedule a job for a past time. You should see an error:
```
Scheduled time must be in the future
```

#### Test 3: No Studies Selected
Try to click "Schedule" without selecting any studies. You should see:
```
Please select at least one study
```

#### Test 4: Multiple Jobs
Schedule multiple jobs at different times and verify they all appear in the "Next scheduled run" section (only the earliest should show).

## Setting Up Automated Cron Trigger

Once tested, you can set up an external cron service to call the Edge Function every 5-10 minutes:

### Using cron-job.org (Free)

1. Go to https://cron-job.org
2. Create a new cron job
3. Set URL to: `https://[your-project-ref].supabase.co/functions/v1/run_scheduled_studies?secret=[your-cron-secret]`
4. Set schedule: Every 5 minutes
5. Method: POST
6. Save

### Using GitHub Actions

Create `.github/workflows/scheduled-studies.yml`:

```yaml
name: Run Scheduled Studies

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:  # Allow manual trigger

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Edge Function
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/run_scheduled_studies?secret=${{ secrets.CRON_SECRET }}"
```

## Troubleshooting

### Job stays in 'pending' status
- Verify the `scheduled_at` time has passed
- Check Edge Function logs in Supabase dashboard
- Manually trigger the Edge Function to see error messages

### Job fails with 'ZYTE_API_KEY not configured'
- Ensure `ZYTE_API_KEY` is set in Supabase Edge Function secrets
- Edge Function looks for `ZYTE_API_KEY` or `VITE_ZYTE_API_KEY`

### Job completes but no results in UI
- Check `study_runs` table for the run_id
- Check `study_run_results` table for results
- Verify the studies weren't all NULL (no opportunities found)

### Edge Function returns 401 Unauthorized
- Either remove `CRON_SECRET` from environment variables
- Or pass the correct secret via `?secret=` or `X-Cron-Secret` header

## Monitoring

To monitor scheduled jobs:

```sql
-- Check all scheduled jobs
SELECT
  id,
  status,
  scheduled_at,
  last_run_at,
  payload->>'studyIds' as study_ids,
  payload->>'threshold' as threshold,
  last_error
FROM scheduled_study_runs
ORDER BY scheduled_at DESC;

-- Check completed runs
SELECT
  sr.scheduled_at,
  sr.last_run_at,
  sr.status,
  r.total_studies,
  r.null_count,
  r.opportunities_count
FROM scheduled_study_runs sr
LEFT JOIN study_runs r ON r.id = sr.run_id
WHERE sr.status = 'completed'
ORDER BY sr.scheduled_at DESC;
```

## Non-Regression Verification

The existing "Run Now" functionality remains completely unchanged:
- ✅ Manual runs still work exactly as before
- ✅ Progress tracking still works
- ✅ Results appear in the same format
- ✅ All scraping and AI logic is identical
- ✅ No changes to existing database tables (except new `scheduled_study_runs`)

To verify, simply run a manual "Run Now" test and confirm it works identically to before this change.
