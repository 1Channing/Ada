# Quick Fix Guide: fetchHtmlWithZyte Error

## The Problem

Getting this error when running studies?
```
ReferenceError: fetchHtmlWithZyte is not defined
```

## The Solution (30 seconds)

### Step 1: Update Your .env File

Add this line to your `.env` file:

```bash
VITE_SCRAPER_MODE=api
```

Your complete `.env` should look like:
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_OPENAI_API_KEY=your_openai_key_here
VITE_SCRAPER_MODE=api
VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret_here
```

**Note:** The `VITE_SCHEDULER_CRON_SECRET` must match the `SCHEDULER_CRON_SECRET` configured in your Supabase Edge Function environment.

### Step 2: Restart

```bash
# Stop the dev server (Ctrl+C)
# Start it again
npm run dev
```

### Step 3: Verify

1. Open the app in your browser
2. Go to "Run Searches" page
3. Look for a **green badge** at the top that says **"REMOTE (via Worker)"**
4. If you see orange "LOCAL (browser)" instead, the env var didn't load

### Step 4: Hard Refresh

Clear your browser cache:
- Mac: `Cmd + Shift + R`
- Windows/Linux: `Ctrl + Shift + R`

## Done!

The error should be gone. Studies now execute on the backend Worker instead of in your browser.

## Why This Works

**Before:** Frontend tried to run scraping code in browser → `fetchHtmlWithZyte` doesn't exist in browser → ERROR

**After:** Frontend delegates to Worker → Worker runs scraping → Results sent back → No browser errors

## Still Not Working?

### Check 1: Environment Variable Loaded

Open browser console and run:
```javascript
console.log(import.meta.env.VITE_SCRAPER_MODE);
```

Should show: `"api"`

If it shows `undefined` or `"local"`:
- Make sure `.env` file is in project root
- Restart dev server
- Try `rm -rf node_modules/.vite && npm run dev`

### Check 2: Badge Color

On "Run Searches" page:
- ✅ Green "REMOTE (via Worker)" = Correct
- ❌ Orange "LOCAL (browser)" = Wrong mode

### Check 3: Worker Running

Verify your Worker service is deployed and healthy:
```bash
curl https://your-worker.railway.app/health
```

Should return: `{"status": "healthy"}`

## For Production Deployment

Railway environment variables:
```bash
VITE_SCRAPER_MODE=api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_OPENAI_API_KEY=your_key
VITE_SCHEDULER_CRON_SECRET=your_scheduler_secret
```

**Important:** The `VITE_SCHEDULER_CRON_SECRET` value must match the `SCHEDULER_CRON_SECRET` set in your Supabase Edge Function environment variables. This is used to authenticate requests to trigger remote study execution.

Then redeploy.

## More Information

- Technical details: `BROWSER_EXECUTION_FIX.md`
- Remote execution architecture: `REMOTE_EXECUTION_MODE.md`
- Worker setup: `WORKER_DEPLOYMENT_GUIDE.md`
