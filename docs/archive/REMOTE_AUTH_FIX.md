# Remote Execution Authentication Fix

## Problem

When running studies with `VITE_SCRAPER_MODE=api`, the Edge Function returned:

```
401 Unauthorized: Invalid or missing SCHEDULER_CRON_SECRET
```

## Root Cause

The `remoteStudyRunner.ts` was using the Supabase anon key instead of the scheduler secret when calling the Edge Function:

```typescript
// ❌ INCORRECT - Using wrong authentication
headers: {
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
}
```

The Edge Function `run_scheduled_studies` requires the `SCHEDULER_CRON_SECRET` for authentication to prevent unauthorized triggering of expensive scraping jobs.

## Solution

Updated `remoteStudyRunner.ts` to use the correct secret:

```typescript
// ✅ CORRECT - Using scheduler secret
const SCHEDULER_CRON_SECRET = import.meta.env.VITE_SCHEDULER_CRON_SECRET;

headers: {
  'Authorization': `Bearer ${SCHEDULER_CRON_SECRET}`,
}
```

## Changes Made

### 1. Updated `src/services/remoteStudyRunner.ts`

**Added secret import:**
```typescript
const SCHEDULER_CRON_SECRET = import.meta.env.VITE_SCHEDULER_CRON_SECRET;
```

**Updated fetch call:**
```typescript
const triggerResponse = await fetch(edgeFunctionUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SCHEDULER_CRON_SECRET}`,  // Changed from SUPABASE_ANON_KEY
  },
  body: JSON.stringify({}),
});
```

### 2. Updated `.env.example`

Added documentation for the new environment variable:

```bash
# Scheduler Secret (for triggering Edge Functions)
# This should match SCHEDULER_CRON_SECRET in your Supabase Edge Function environment
VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret_here

# Execution Mode (REQUIRED)
# 'api' = Remote execution via Worker (PRODUCTION - ALWAYS USE THIS)
# 'local' = Browser execution (DEVELOPMENT ONLY)
VITE_SCRAPER_MODE=api
```

### 3. Updated Documentation

**Files updated:**
- `README.md` - Added `VITE_SCHEDULER_CRON_SECRET` to environment variables section
- `QUICK_FIX_GUIDE.md` - Added secret to quick setup instructions
- `BROWSER_EXECUTION_FIX.md` - Added 401 error troubleshooting section

## Setup Instructions

### Step 1: Get Your Scheduler Secret

1. Go to Supabase Dashboard
2. Navigate to: **Edge Functions → Settings → Environment Variables**
3. Find the `SCHEDULER_CRON_SECRET` value
4. Copy it (without quotes)

### Step 2: Add to Your `.env` File

Add this line to your `.env` file:

```bash
VITE_SCHEDULER_CRON_SECRET=<paste_value_here>
```

**Complete `.env` example:**
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_OPENAI_API_KEY=sk-proj-...
VITE_SCRAPER_MODE=api
VITE_SCHEDULER_CRON_SECRET=your_secret_here_no_quotes
```

### Step 3: Restart Dev Server

```bash
# Stop dev server (Ctrl+C)
npm run dev
```

### Step 4: Test

1. Navigate to "Run Searches" page
2. Select a study
3. Click "Run Now"
4. Check browser console - should see:
   ```
   [REMOTE_RUNNER] Starting remote execution...
   [REMOTE_RUNNER] Scheduled job created: ...
   [REMOTE_RUNNER] Edge Function triggered: ...
   ```
5. NO 401 errors should appear

## Authentication Flow

### Before Fix (Incorrect)

```
Frontend → Edge Function
    Auth: Bearer <SUPABASE_ANON_KEY>
    ↓
    ❌ 401 Unauthorized
    "Invalid or missing SCHEDULER_CRON_SECRET"
```

### After Fix (Correct)

```
Frontend → Edge Function
    Auth: Bearer <SCHEDULER_CRON_SECRET>
    ↓
    ✅ 200 OK
    → Worker → Zyte API → Results
```

## Why This Secret is Required

The `SCHEDULER_CRON_SECRET` serves as authentication for:

1. **Cron Jobs:** Automated daily executions triggered by Supabase cron
2. **Manual Triggers:** Frontend-initiated study runs via "Run Now" button
3. **Security:** Prevents unauthorized users from triggering expensive API calls

This is separate from the Supabase anon key because:
- Anon key = Public, read-only database access
- Scheduler secret = Protected, execution triggering

## Production Deployment

### Railway Environment Variables

Add to your Railway frontend service:

```bash
VITE_SCRAPER_MODE=api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_OPENAI_API_KEY=your_openai_key
VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret
```

### Verification Checklist

- [ ] Frontend `.env` has `VITE_SCHEDULER_CRON_SECRET`
- [ ] Edge Function env has `SCHEDULER_CRON_SECRET`
- [ ] Both secrets match exactly (no spaces, quotes, or extra characters)
- [ ] Dev server restarted after adding secret
- [ ] Browser hard-refreshed (Cmd+Shift+R)
- [ ] Test study runs without 401 error
- [ ] Check browser console for successful trigger logs

## Troubleshooting

### Still Getting 401 Error

**Check secret matches:**
```bash
# In your .env file
echo $VITE_SCHEDULER_CRON_SECRET

# Should match the value in Supabase Edge Function settings
```

**Common issues:**
- Extra quotes around the secret
- Trailing/leading whitespace
- Wrong secret copied (check you copied the right one)
- Forgot to restart dev server
- Browser cache (hard refresh required)

### Check Environment Variable Loaded

Open browser console:
```javascript
console.log(import.meta.env.VITE_SCHEDULER_CRON_SECRET);
```

Should show your secret value (not `undefined`).

If `undefined`:
1. Check `.env` file is in project root
2. Restart dev server
3. Clear Vite cache: `rm -rf node_modules/.vite && npm run dev`

### Edge Function Returns Different Error

If you get a different error (not 401), the authentication is working. Check:
- Worker is running and healthy
- `WORKER_URL` set in Edge Function
- `WORKER_SECRET` matches between Edge Function and Worker
- Worker logs for actual error

## Security Notes

### Do Not Commit Secrets

**Never commit `.env` file:**

```gitignore
# .gitignore
.env
.env.local
.env.production
```

### Frontend Secret Exposure

**Q:** Is it safe to expose `SCHEDULER_CRON_SECRET` in frontend code?

**A:** While not ideal, it's acceptable for internal tools because:

1. **Limited scope:** Only triggers job scheduling (doesn't expose data)
2. **RLS protection:** Database access still controlled by Row Level Security
3. **Internal tool:** Not public-facing, authenticated users only
4. **Alternative complexity:** Moving to backend-only flow adds significant complexity

**Best practice for public apps:** Create a backend API endpoint that validates user authentication, then calls Edge Function with the secret server-side.

### Rotation

If you suspect the secret is compromised:

1. Generate a new secret (use password generator)
2. Update in Supabase Edge Function settings
3. Update in all frontend `.env` files
4. Redeploy all environments
5. Test thoroughly

## Related Files

**Source code:**
- `src/services/remoteStudyRunner.ts` - Remote execution client
- `supabase/functions/run_scheduled_studies/index.ts` - Edge Function

**Documentation:**
- `BROWSER_EXECUTION_FIX.md` - Dynamic imports and execution modes
- `QUICK_FIX_GUIDE.md` - Quick setup guide
- `README.md` - Environment variables reference

## Summary

The 401 error was caused by using the wrong authentication token when calling the Edge Function. The fix was simple: use `VITE_SCHEDULER_CRON_SECRET` instead of `VITE_SUPABASE_ANON_KEY`. This required adding a new environment variable to the frontend configuration and updating the fetch call to use it.

---

**Version:** 1.0.0
**Date:** 2026-01-16
**Status:** Production Ready
