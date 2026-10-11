# Worker Deployment Guide

## Overview

The MC Export scheduled execution system uses a **two-tier architecture**:

1. **Edge Function** (Supabase) - Orchestrates jobs, creates DB records, delegates work
2. **Node.js Worker** (External) - Executes real Zyte scraping in Node.js environment

This architecture is **required** because Zyte API calls fail in Deno/Edge Function runtime.

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        User schedules run                    │
│                   (scheduled_study_runs table)               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            Cron triggers Edge Function                       │
│        (supabase/functions/run_scheduled_studies)            │
│                                                              │
│  - Fetches due jobs                                          │
│  - Creates study_runs record                                 │
│  - Locks scheduled_study_runs row                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ POST /execute-studies
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js Worker Service                          │
│                  (worker/index.js)                           │
│                                                              │
│  - Receives: runId, studyIds, threshold, scrapeMode          │
│  - Executes REAL Zyte scraping (target + source)            │
│  - Computes: median, best price, difference                  │
│  - Persists to: study_run_results                            │
│  - Updates: study_runs counters                              │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP 200 OK
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Edge Function finalizes job                     │
│  - Marks scheduled_study_runs.status = 'completed'           │
│  - Results visible in UI                                     │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start (Railway - Recommended)

Railway provides zero-config deployment with automatic HTTPS and health checks.

### 1. Prepare Worker for Deployment

The worker code is already in `/worker` directory. No changes needed.

### 2. Deploy to Railway

**Option A: GitHub Integration (Recommended)**

1. Push your code to GitHub (including `/worker` directory)
2. Go to [railway.app](https://railway.app) and sign up
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect the Node.js app

**Option B: CLI Deployment**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# From project root
cd worker
railway init
railway up
```

### 3. Configure Environment Variables in Railway

In Railway dashboard, add these variables:

```
PORT=3001
WORKER_SECRET=generate-secure-random-32-char-string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key
ZYTE_API_KEY=your-zyte-api-key
```

**Generate WORKER_SECRET:**
```bash
openssl rand -hex 32
```

### 4. Get Worker URL

After deployment, Railway provides a URL like:
```
https://your-app.up.railway.app
```

### 5. Configure Supabase Edge Function

Add these secrets to your Supabase project:

**Via Supabase Dashboard:**
1. Go to Project Settings → Edge Functions
2. Add secrets:
   - `WORKER_URL` = `https://your-app.up.railway.app`
   - `WORKER_SECRET` = same value as worker's WORKER_SECRET

**Via Supabase CLI:**
```bash
supabase secrets set WORKER_URL=https://your-app.up.railway.app
supabase secrets set WORKER_SECRET=your-32-char-secret
```

### 6. Test the Integration

**Test worker health:**
```bash
curl https://your-app.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "mc-export-worker",
  "env": {
    "hasWorkerSecret": true,
    "hasSupabaseUrl": true,
    "hasSupabaseKey": true,
    "hasZyteKey": true
  }
}
```

**Test scheduled execution:**
1. In MC Export UI, go to Run Searches → Schedule tab
2. Select 1 study, set threshold, choose FAST mode
3. Set scheduled time 2 minutes in future
4. Click "Schedule Run"
5. Wait for scheduled time
6. Go to Results tab → verify numeric target/best/diff values (not N/A)

## Alternative Deployment Options

### Render

1. Go to [render.com](https://render.com)
2. Create New → Web Service
3. Connect GitHub repo
4. Configure:
   - **Root Directory:** `worker`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add environment variables (same as Railway)
6. Deploy
7. Copy service URL (e.g., `https://your-app.onrender.com`)
8. Configure in Supabase as WORKER_URL

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# From /worker directory
cd worker
fly launch

# Set secrets
fly secrets set \
  WORKER_SECRET=your-secret \
  SUPABASE_URL=your-url \
  SUPABASE_SERVICE_ROLE_KEY=your-key \
  ZYTE_API_KEY=your-key

# Deploy
fly deploy

# Get URL
fly info
```

### Docker + Any Platform

```bash
cd worker

# Create Dockerfile
cat > Dockerfile <<'EOF'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
EOF

# Build
docker build -t mc-export-worker .

# Run locally
docker run -p 3001:3001 --env-file .env mc-export-worker

# Push to registry and deploy to any Docker platform
docker tag mc-export-worker your-registry/mc-export-worker
docker push your-registry/mc-export-worker
```

Deploy to:
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances
- DigitalOcean App Platform

### VPS (DigitalOcean, Linode, Hetzner)

```bash
# SSH into server
ssh root@your-server-ip

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Clone repo
git clone https://github.com/your-repo.git
cd your-repo/worker

# Install dependencies
npm install --production

# Create .env file
nano .env
# Paste your environment variables, save

# Install PM2 for process management
npm install -g pm2

# Start worker
pm2 start index.js --name mc-export-worker

# Setup auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs mc-export-worker

# Monitor status
pm2 status
```

**Configure Nginx reverse proxy (optional but recommended):**

```nginx
server {
    listen 80;
    server_name worker.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then setup SSL with Let's Encrypt:
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d worker.yourdomain.com
```

## Monitoring & Maintenance

### Health Checks

Set up automated health checks to monitor worker uptime:

```bash
# Cron job to check health every 5 minutes
*/5 * * * * curl -f https://your-worker-url/health || echo "Worker down!"
```

Or use services like:
- UptimeRobot (free)
- Pingdom
- Datadog
- New Relic

### Logs

**Railway:** Dashboard → Deployments → Logs

**Render:** Dashboard → Logs

**Fly.io:**
```bash
fly logs
```

**PM2 (VPS):**
```bash
pm2 logs mc-export-worker
pm2 logs mc-export-worker --lines 100
```

**Docker:**
```bash
docker logs -f container-name
```

### Scaling

For high-volume scheduled runs:

**Horizontal Scaling:**
- Deploy multiple worker instances
- Use load balancer (Railway/Render handle this automatically)
- Edge function will round-robin between instances

**Vertical Scaling:**
- Increase instance memory/CPU
- Railway: Dashboard → Settings → Resources
- Render: Change instance type
- VPS: Upgrade server

### Updating Worker Code

**Railway/Render (GitHub auto-deploy):**
1. Push changes to GitHub
2. Automatic deployment triggered
3. Zero downtime deployment

**Fly.io:**
```bash
cd worker
fly deploy
```

**Docker:**
```bash
docker build -t mc-export-worker .
docker push your-registry/mc-export-worker
# Restart containers in your platform
```

**VPS:**
```bash
cd worker
git pull
npm install --production
pm2 restart mc-export-worker
```

## Troubleshooting

### Worker not receiving requests

**Check Edge Function logs:**
```bash
supabase functions logs run_scheduled_studies
```

Look for:
- `Missing WORKER_URL` → Set WORKER_URL secret in Supabase
- `Worker failed: 404` → Verify WORKER_URL is correct (no trailing slash)
- `Worker failed: 401` → WORKER_SECRET mismatch

**Check worker logs:**
- Verify worker is running and healthy
- Check for authentication errors
- Verify firewall allows inbound traffic on PORT

### Scraping fails with real data

**Check worker environment:**
```bash
curl https://your-worker-url/health
```

Verify:
- `hasZyteKey: true` → If false, set ZYTE_API_KEY
- `hasSupabaseUrl: true` → If false, set SUPABASE_URL
- `hasSupabaseKey: true` → If false, set SUPABASE_SERVICE_ROLE_KEY

**Check Zyte credits:**
- Login to Zyte dashboard
- Verify API key is valid
- Check remaining credits
- Review API usage logs

**Check worker logs for errors:**
```
[WORKER] Error processing study...
[WORKER] Zyte API error: 401 Unauthorized
```

### Results still show N/A

**Verify worker was called:**
- Check Edge Function logs for "Delegating execution to Node.js worker"
- Check worker logs for "Execute Studies Request Received"

**Check database:**
```sql
-- Verify results were persisted
SELECT * FROM study_run_results
WHERE run_id = 'your-run-id'
ORDER BY created_at DESC;

-- Should have numeric values in:
-- target_market_price, best_source_price, price_difference
```

**Check for errors:**
```sql
SELECT * FROM study_runs WHERE status = 'failed';
SELECT * FROM scheduled_study_runs WHERE status = 'failed';
```

### Performance issues

**Slow scraping:**
- FAST mode scrapes 1 page only → faster
- FULL mode scrapes all pages → slower but more data
- Zyte API has rate limits

**Timeouts:**
- Railway/Render have 30s default timeout
- For FULL mode with many studies, consider:
  - Process in smaller batches
  - Increase instance timeout (if platform allows)
  - Make worker return 202 and process async

**High costs:**
- Each Zyte request costs credits
- Use FAST mode for scheduled runs (default)
- Use FULL mode only when needed
- Monitor Zyte usage in dashboard

## Cost Estimation

### Worker Hosting

**Railway:** $5/month (Hobby plan) - Recommended for most users
**Render:** $7/month (Starter plan)
**Fly.io:** ~$3-5/month (depends on usage)
**VPS:** $5-10/month (DigitalOcean, Linode)

### Zyte API

Depends on scheduled run frequency:
- 1 study × 2 markets × FAST mode = ~2 credits
- 10 studies/day = ~600 credits/month
- 100 studies/day = ~6,000 credits/month

Check Zyte pricing at: https://www.zyte.com/pricing/

## Security Checklist

- [ ] WORKER_SECRET is random 32+ character string
- [ ] WORKER_SECRET matches between worker and Edge Function
- [ ] SUPABASE_SERVICE_ROLE_KEY is kept secure (never commit to git)
- [ ] ZYTE_API_KEY is kept secure
- [ ] Worker uses HTTPS (automatic on Railway/Render/Fly)
- [ ] Environment variables are never logged
- [ ] Secrets are rotated periodically (every 90 days)
- [ ] Worker endpoint is not publicly documented
- [ ] Consider IP allowlisting for worker endpoint

## Support

If you encounter issues:

1. Check worker health endpoint
2. Review Edge Function logs
3. Review worker logs
4. Check database for error messages
5. Verify all environment variables are set correctly
6. Test with a single study in FAST mode first
7. Check Zyte dashboard for API errors

For platform-specific issues:
- Railway: https://railway.app/help
- Render: https://render.com/docs
- Fly.io: https://fly.io/docs
- Supabase: https://supabase.com/docs
