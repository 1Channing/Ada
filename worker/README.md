# MC Export Worker Service

Node.js worker service for executing scheduled study runs with real Zyte scraping.

## Architecture

This worker runs in a **Node.js environment** (not Deno/Edge Functions) to ensure proper Zyte API compatibility.

**Flow:**
1. Supabase Edge Function (`run_scheduled_studies`) fetches due jobs
2. Edge Function creates `study_runs` records and calls this worker
3. Worker executes real Zyte scraping for each study
4. Worker persists results to `study_run_results` table
5. Worker updates `study_runs` counters and status

## Requirements

- Node.js 18+
- npm or yarn
- Environment variables (see `.env.example`)

## Setup

1. **Install dependencies:**
   ```bash
   cd worker
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Required environment variables:**
   - `PORT` - Port to run the worker (default: 3001)
   - `WORKER_SECRET` - Secure random secret for authentication
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Service role key (not anon key)
   - `ZYTE_API_KEY` - Your Zyte API key

## Running Locally

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**Verify it's running:**
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "mc-export-worker",
  "timestamp": "2024-12-14T...",
  "env": {
    "hasWorkerSecret": true,
    "hasSupabaseUrl": true,
    "hasSupabaseKey": true,
    "hasZyteKey": true
  }
}
```

## Deployment Options

### Option 1: Railway

1. Create account at [railway.app](https://railway.app)
2. Create new project from GitHub repo
3. Set root directory to `/worker`
4. Add environment variables in Railway dashboard
5. Deploy

Railway will auto-detect Node.js and run `npm start`.

### Option 2: Render

1. Create account at [render.com](https://render.com)
2. Create new Web Service
3. Connect GitHub repo
4. Set:
   - Root Directory: `worker`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add environment variables
6. Deploy

### Option 3: Fly.io

1. Install Fly CLI
2. From `/worker` directory:
   ```bash
   fly launch
   fly secrets set WORKER_SECRET=xxx SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx ZYTE_API_KEY=xxx
   fly deploy
   ```

### Option 4: Docker (Any Platform)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t mc-export-worker .
docker run -p 3001:3001 --env-file .env mc-export-worker
```

### Option 5: VPS (DigitalOcean, Linode, etc.)

1. SSH into server
2. Install Node.js 18+
3. Clone repo and navigate to `/worker`
4. Install dependencies: `npm install`
5. Create `.env` file with production values
6. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start index.js --name mc-export-worker
   pm2 save
   pm2 startup
   ```

## Configuration in Supabase

After deploying the worker, you need to configure the Edge Function to call it:

1. Get your worker URL (e.g., `https://your-app.railway.app`)
2. Add these secrets to your Supabase project:
   ```bash
   WORKER_URL=https://your-app.railway.app
   WORKER_SECRET=same-secret-as-worker-env
   ```

3. The Edge Function will automatically call the worker at the configured URL.

## API Endpoints

### POST /execute-studies

Execute studies for a scheduled run.

**Headers:**
- `Authorization: Bearer <WORKER_SECRET>`
- `Content-Type: application/json`

**Body:**
```json
{
  "runId": "uuid-of-study-runs-record",
  "studyIds": ["MS_TOYOTA_YARIS_2023_FR_NL", "..."],
  "threshold": 3000,
  "scrapeMode": "fast"
}
```

**Response:**
```json
{
  "success": true,
  "runId": "uuid",
  "processed": 5,
  "results": {
    "opportunities": 2,
    "null": 3,
    "blocked": 0
  },
  "timestamp": "2024-12-14T..."
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "mc-export-worker",
  "timestamp": "2024-12-14T...",
  "env": {
    "hasWorkerSecret": true,
    "hasSupabaseUrl": true,
    "hasSupabaseKey": true,
    "hasZyteKey": true
  }
}
```

## Monitoring

- Check logs for `[WORKER]` prefixed messages
- Monitor `/health` endpoint for uptime
- Watch Supabase `study_runs` table for failed runs
- Set up alerts for HTTP 500 responses

## Troubleshooting

**Worker not receiving requests:**
- Verify `WORKER_URL` is set correctly in Supabase
- Check firewall/security group allows inbound traffic on PORT
- Verify WORKER_SECRET matches between Edge Function and Worker

**Scraping fails:**
- Verify ZYTE_API_KEY is valid and has credits
- Check Zyte dashboard for API usage/errors
- Review worker logs for detailed error messages

**Database errors:**
- Verify SUPABASE_SERVICE_ROLE_KEY is correct (not anon key)
- Check RLS policies allow service role access
- Verify study IDs exist in studies_v2 table

## Security Notes

- **NEVER** commit `.env` file to git
- Use secure random strings for `WORKER_SECRET` (min 32 chars)
- Restrict worker endpoint to Supabase IP range if possible
- Use HTTPS in production (automatically handled by Railway/Render/Fly)
- Rotate secrets periodically
