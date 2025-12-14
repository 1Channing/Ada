# MC Export Intelligence

A production-ready internal tool for a 6M€ car export company. This platform automates the discovery, analysis, and scoring of export opportunities across European markets.

## Features

### Core Functionality
- **Automated Market Scanning**: Daily scraping of source markets (France, Netherlands, etc.) and destination markets (Denmark, Italy, etc.)
- **Intelligent Pricing**: Automatic target export price computation based on configurable strategies
- **Smart Scoring**: MC Export scoring system (1 point ≈ 1000€ margin potential)
- **AI Analysis**: OpenAI GPT-powered second-level analysis for risk assessment
- **Real-time Tracking**: Monitor listings over time with price change detection
- **Status Management**: Track listings from discovery to purchase

### Technical Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Supabase (PostgreSQL) with Row Level Security
- **Automation**: Supabase Edge Functions for scheduled jobs
- **AI Integration**: OpenAI API for intelligent analysis
- **Dark Theme**: Professional trading-tool aesthetic

## Database Schema

### Tables
1. **market_studies** - Model patterns monitored across source/target countries
2. **search_queries** - Ad-hoc and daily searches on source markets
3. **listings** - Individual car listings tracked over time
4. **job_runs** - Cron job execution logs

All tables include comprehensive RLS policies for security.

## Pages

### 1. Dashboard
- Real-time view of top deals sorted by MC score
- Advanced filters: score range, countries, brand, risk level
- Quick actions: mark as seen, contacted, bought, or rejected
- Color-coded score badges and risk indicators

### 2. Market Studies
- Define model patterns to monitor
- Configure source and target markets
- Set pricing strategies (mean 5 lowest, median -5%, etc.)
- View computed target export prices

### 3. Search Queries
- Create ad-hoc searches
- Track search history
- Organize by type (etude, manuel, test, veille)

### 4. Listings History
- Aggregated metrics by brand/model
- Historical price tracking
- Filter by date range and status
- View purchase statistics

### 5. Job Logs
- Monitor scheduled job executions
- View success/error rates
- Manual job triggering
- Detailed execution logs

## Business Logic

### Margin Calculation
```typescript
margin = targetExportPrice - listingPrice - transportCost(500€) - safetyMargin
```

### MC Score
```typescript
score = margin / 1000
// Clamped between 0-15, with optional AI adjustment (±3 points)
```

### Pricing Strategies
- **mean_5_lowest**: Average of 5 lowest destination prices
- **median_minus_5pct**: Median destination price minus 5%
- **mean_all**: Average of all destination prices
- **median**: Median of all destination prices

## Daily Job Workflow

Runs automatically at 08:00 Europe/Paris timezone:

1. **Update Target Prices**
   - Scrape destination markets
   - Apply pricing strategy
   - Optional AI validation
   - Store computed target price

2. **Scrape Source Markets**
   - Fetch listings from source URLs
   - Upsert into database
   - Detect price changes
   - Calculate margins and scores

3. **Detail Analysis** (for high-scoring listings)
   - Fetch full listing details
   - AI risk assessment
   - Extract photos
   - Final score adjustment

## External Integrations

### Scraper API
Configure via environment variables:
- `SCRAPER_API_URL` - Endpoint for scraping service
- `SCRAPER_API_KEY` - Authentication key

Expected API contract:
```typescript
POST /scrapeSearch
{
  search_url: string,
  site: string,
  country: string
}

Response:
{
  listings: Array<{
    url_annonce: string,
    price_eur: number,
    brand: string,
    model: string,
    year?: number,
    km?: number,
    // ... additional fields
  }>
}
```

### OpenAI API
Configure via environment variable:
- `VITE_OPENAI_API_KEY` - OpenAI API key

Used for:
- Target price validation
- Listing risk analysis
- Quality scoring adjustments

## JSON Import (Testing)

Use the floating blue button (bottom-right) to import test data:

```json
[
  {
    "url_annonce": "https://example.com/listing/123",
    "price_eur": 12000,
    "brand": "Toyota",
    "model": "RAV4",
    "year": 2017,
    "km": 85000
  }
]
```

This allows testing the entire pipeline without external scraper integration.

## Environment Variables

Required in `.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_api_key
```

For Edge Functions (auto-configured):
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SCRAPER_API_URL
SCRAPER_API_KEY
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Type check
npm run typecheck

# Lint
npm run lint
```

## Production Deployment

1. Database migrations are already applied via Supabase
2. Edge Function `daily-job` is deployed and ready
3. Configure environment variables
4. Build and deploy frontend
5. Set up cron trigger for `daily-job` at 08:00 Europe/Paris

## Security Notes

- RLS enabled on all tables
- Authenticated users have full access (internal tool)
- Service role key used only in Edge Functions
- No sensitive data exposed to client
- All API calls authenticated with Supabase tokens

## Future Enhancements

- Email notifications for high-score deals
- Mobile app for on-the-go deal review
- Advanced analytics and reporting
- Multi-user role management
- Automated offer generation
- Integration with logistics providers

## Support

For issues or questions, contact the development team.

---

**Version**: 1.0.0
**Status**: Production Ready
**No Mock Data**: All code ready for real data integration
