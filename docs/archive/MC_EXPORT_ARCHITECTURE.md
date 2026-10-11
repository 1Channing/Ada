# MC Export Architecture - Data Model & Workflow

## Overview

This document describes the complete architecture for the MC (Multi-Country) Export tool, which helps identify profitable cross-border vehicle arbitrage opportunities by comparing French listings against destination market prices.

## Architecture Philosophy

The system separates **configuration** from **results**:

- **Configuration Layer**: Market Studies define WHAT to monitor (brand, model, year, mileage range, source/target countries)
- **Results Layer**: Separate tables store computed statistics and individual listing scores
- **Scoring Layer**: French listings are scored against destination market statistics

---

## Data Model

### 1. Market Studies (Configuration Only)

**Table**: `market_studies`

**Purpose**: Define which vehicle patterns to monitor across markets. This is pure configuration with NO pricing data displayed in the UI.

**Key Columns**:
- `id` (TEXT): Unique identifier (e.g., `MS_AUDI_A3_2022_FR`)
- `brand`: Vehicle brand (e.g., "Audi")
- `model_pattern`: Model to match (e.g., "A3")
- `year_min`, `year_max`: Year range filter
- `mileage_min`, `mileage_max`: Mileage range in kilometers
- `source_country`: Where to find source listings (e.g., "FR")
- `source_marketplace`: Source platform (e.g., "leboncoin")
- `source_search_url`: URL to scrape source listings
- `target_country`: Destination market (e.g., "DK", "NL")
- `target_marketplace`: Destination platform (e.g., "bilbasen", "autoscout24.nl")
- `target_search_url`: URL to scrape destination market
- `pricing_strategy`: How to compute target price (e.g., "mean_5_lowest", "median_minus_5pct")
- `notes`: Internal notes

**Hidden Fields** (exist in DB but NOT shown in UI):
- `last_computed_target_export_price_eur`: Last computed average price
- `last_computed_target_export_price_at`: When it was computed

**UI Display**:
- Shows: Brand, Model, Year Range, Source Country, Target Country, Mileage Range, Marketplace
- Filtering: By source country (ALL / FR / NL / DK)
- Sorting: brand → model → year → source_country

---

### 2. Market Study Results (Destination Market Statistics)

**Table**: `market_study_results`

**Purpose**: Store aggregated statistics about the TARGET/DESTINATION market for each study.

**Key Columns**:
- `market_study_id`: References `market_studies.id`
- `computed_at`: When these stats were calculated
- `target_listing_count`: Number of listings found in destination market
- `target_price_min_eur`: Minimum price in destination
- `target_price_max_eur`: Maximum price in destination
- `target_price_mean_eur`: Average price in destination
- `target_price_median_eur`: Median price in destination
- `target_price_p25_eur`: 25th percentile
- `target_price_p75_eur`: 75th percentile
- `computed_target_export_price_eur`: Based on pricing strategy
- `data_quality_score`: Confidence level
- `notes`: Analysis notes

**Use Case**:
When scraping destination markets (NL, DK), store aggregated price statistics here. This becomes the benchmark for scoring French listings.

**Example**:
```
market_study_id: MS_AUDI_A3_2022_FR
target_listing_count: 45
target_price_median_eur: 18500
computed_target_export_price_eur: 17800 (median - 5%)
```

---

### 3. Source Listings (French Vehicles with MC Scores)

**Table**: `source_listings_fr`

**Purpose**: Store individual French vehicle listings and their MC (Multi-Country) scores/margins.

**Key Columns**:

**Identification**:
- `url_annonce`: Unique listing URL
- `market_study_id`: Which study matched this listing
- `brand`, `model`, `year`, `km`: Vehicle details
- `source_marketplace`: Usually "leboncoin"

**Pricing**:
- `price_eur`: Current asking price in France
- `price_original`: Original asking price
- `price_variation_eur`: Price change over time

**MC Scoring** (Multi-Country Analysis):
- `mc_score`: Overall attractiveness score (0-100)
- `mc_target_country`: Which destination market (DK/NL)
- `mc_target_market_mean_eur`: Destination market average
- `mc_target_market_median_eur`: Destination market median
- `mc_estimated_margin_eur`: Potential profit (target_price - source_price - costs)
- `mc_margin_pct`: Margin as percentage
- `mc_computed_at`: When MC score was calculated

**Status Tracking**:
- `status`: new, seen, disappeared, contacted, bought, rejected
- `first_seen_at`, `last_seen_at`: Tracking
- `days_online`: How long listed

**Risk Assessment**:
- `is_running`: Is engine functional?
- `is_accident_suspected`: Accident history flags
- `risk_level`: low, medium, high
- `risk_flags`: Specific concerns

**AI Analysis**:
- `ai_comment`: Quick AI assessment
- `ai_detail_comment`: Detailed analysis
- `photos_urls`: Images (JSONB array)
- `raw_data`: Full scraped data (JSONB)

---

## Workflow

### Phase 1: Configuration (Current State)

1. **Import Market Studies CSV** → `market_studies` table
2. **View Market Studies UI**:
   - Shows configuration only (no prices)
   - Filter by source country
   - Sort by brand → model → year → country

### Phase 2: Destination Market Scraping (Future)

1. **Daily Job**: For each `market_study`:
   - Scrape `target_search_url` (NL or DK marketplace)
   - Extract all matching listings in destination market
   - Compute aggregated statistics (min, max, mean, median, percentiles)
   - Apply `pricing_strategy` to compute `computed_target_export_price_eur`
   - Store results in `market_study_results`

**Example Logic**:
```javascript
// Scrape DK market for Audi A3 2022
const dkListings = await scrapeMarket(study.target_search_url);

const stats = {
  target_listing_count: dkListings.length,
  target_price_median_eur: median(dkListings.map(l => l.price)),
  target_price_mean_eur: mean(dkListings.map(l => l.price)),
  // ... other stats
};

// Apply strategy
if (study.pricing_strategy === 'median_minus_5pct') {
  stats.computed_target_export_price_eur = stats.target_price_median_eur * 0.95;
}

// Store in market_study_results
await insertMarketStudyResult(study.id, stats);
```

### Phase 3: French Listing Scraping & Scoring (Future)

1. **Daily Job**: For each `market_study` with `source_country = 'FR'`:
   - Scrape `source_search_url` (leboncoin)
   - Extract all French listings matching criteria
   - For each French listing:
     - Match to appropriate `market_study` (brand, model, year, mileage)
     - Lookup latest `market_study_results` for destination market
     - **Compute MC Score**:
       ```
       mc_target_market_median_eur = results.target_price_median_eur
       mc_estimated_margin_eur = mc_target_market_median_eur - listing.price_eur - transport_costs - fees
       mc_margin_pct = (mc_estimated_margin_eur / listing.price_eur) * 100
       mc_score = f(margin_pct, data_quality, risk_level, days_online)
       ```
     - Store in `source_listings_fr` with MC scoring fields populated

**Example**:
```
French Listing:
- Audi A3 2022, 45000 km
- price_eur: 15500 EUR

Matched Market Study:
- MS_AUDI_A3_2022_FR → DK

Market Study Results (latest):
- target_price_median_eur: 18500 EUR
- computed_target_export_price_eur: 17800 EUR

MC Score Calculation:
- mc_target_market_median_eur: 18500
- mc_estimated_margin_eur: 17800 - 15500 - 1000 (transport) - 500 (fees) = 800 EUR
- mc_margin_pct: (800 / 15500) * 100 = 5.16%
- mc_score: 72 (based on margin, quality, risk)
```

### Phase 4: Analysis & Action (Future UI)

1. **French Listings Dashboard**:
   - Show all `source_listings_fr` sorted by `mc_score` DESC
   - Display: brand, model, year, km, price_eur, mc_estimated_margin_eur, mc_margin_pct, mc_score
   - Filter by target_country, min margin, status
   - Click listing → detailed view with photos, AI analysis, risk flags

2. **Market Study Performance**:
   - For each study, show latest destination market stats
   - Display: study name, target market median, listing count, last updated
   - Link to historical trend charts

---

## Key Benefits of This Architecture

1. **Separation of Concerns**: Configuration ≠ Results ≠ Scoring
2. **Scalability**: Can track 433+ market studies across multiple countries
3. **Historical Tracking**: `market_study_results` stores time-series data
4. **Flexible Scoring**: MC score algorithm can evolve without changing data model
5. **Clear Workflow**: Config → Scrape Destination → Scrape Source → Score → Analyze

---

## Database Schema Support for MC Scoring

### Current Schema: READY ✓

**market_studies**:
- ✓ Configuration fields (brand, model, year, mileage, countries)
- ✓ Stores pricing_strategy
- ✓ Has mileage_min, mileage_max for filtering

**market_study_results**:
- ✓ Stores destination market aggregated stats
- ✓ Links to market_study via foreign key
- ✓ Tracks computed_at for time-series
- ✓ Stores computed_target_export_price_eur

**source_listings_fr**:
- ✓ Stores individual French listings
- ✓ Links to market_study via foreign key
- ✓ Has full MC scoring fields (mc_score, mc_estimated_margin_eur, mc_margin_pct, etc.)
- ✓ Tracks status, risk, AI analysis
- ✓ Indexed for performance (mc_score, brand/model, status, first_seen)

**listings** (existing):
- This table can be repurposed or left for backward compatibility
- New workflows should use `source_listings_fr` for clarity

---

## Suggested Data Flow Implementation

### Step 1: Scrape Destination Markets (Edge Function: `scrape-destination-markets`)

```typescript
// Runs daily at 2 AM
for each market_study where target_country IN ['NL', 'DK']:
  const listings = await scrapeDestinationMarket(study.target_search_url);
  const stats = computeAggregateStats(listings, study.pricing_strategy);

  await supabase.from('market_study_results').insert({
    market_study_id: study.id,
    computed_at: new Date(),
    target_listing_count: stats.count,
    target_price_median_eur: stats.median,
    computed_target_export_price_eur: stats.targetPrice,
    // ... other stats
  });
```

### Step 2: Scrape French Source Listings (Edge Function: `scrape-french-listings`)

```typescript
// Runs daily at 4 AM (after destination scrape)
for each market_study where source_country === 'FR':
  const listings = await scrapeFrenchMarket(study.source_search_url);

  // Get latest destination market stats
  const { data: results } = await supabase
    .from('market_study_results')
    .select('*')
    .eq('market_study_id', study.id)
    .order('computed_at', { ascending: false })
    .limit(1)
    .single();

  for each listing in listings:
    const mcScore = computeMCScore(listing, results, study);

    await supabase.from('source_listings_fr').upsert({
      url_annonce: listing.url,
      market_study_id: study.id,
      brand: listing.brand,
      model: listing.model,
      price_eur: listing.price,
      mc_score: mcScore.score,
      mc_estimated_margin_eur: mcScore.margin,
      mc_margin_pct: mcScore.marginPct,
      mc_target_market_median_eur: results.target_price_median_eur,
      // ... other fields
    }, { onConflict: 'url_annonce' });
```

### Step 3: MC Score Algorithm

```typescript
function computeMCScore(frListing, destMarketStats, study) {
  const transportCost = 1000; // EUR
  const fees = 500; // EUR
  const targetPrice = destMarketStats.computed_target_export_price_eur;

  const estimatedMargin = targetPrice - frListing.price_eur - transportCost - fees;
  const marginPct = (estimatedMargin / frListing.price_eur) * 100;

  // Base score on margin percentage
  let score = Math.min(100, Math.max(0, marginPct * 10)); // 10% margin = 100 score

  // Adjust for data quality
  if (destMarketStats.target_listing_count < 5) {
    score *= 0.7; // Low confidence
  }

  // Adjust for listing age
  if (frListing.days_online > 30) {
    score *= 1.2; // Longer listings might be more negotiable
  }

  // Adjust for risk
  if (frListing.risk_level === 'high') {
    score *= 0.5;
  }

  return {
    score: Math.round(score),
    margin: estimatedMargin,
    marginPct: marginPct.toFixed(2),
    targetPrice,
  };
}
```

---

## Next Steps

1. ✓ Market Studies UI now shows configuration only
2. ✓ Country filter and proper sorting implemented
3. ✓ Database schema complete for MC scoring workflow
4. **TODO**: Implement destination market scraping edge function
5. **TODO**: Implement French listing scraping edge function
6. **TODO**: Build French Listings Dashboard with MC scores
7. **TODO**: Add historical trend charts for market studies
8. **TODO**: Implement AI-powered risk assessment

---

## Summary

The architecture is now ready to support the complete MC Export workflow:

- **market_studies**: Pure configuration (no prices in UI)
- **market_study_results**: Destination market aggregated statistics
- **source_listings_fr**: French listings with MC scores and margin calculations
- **Clear separation**: Config → Results → Scoring → Analysis
- **Scalable**: Supports 433+ studies across multiple countries
- **Flexible**: MC scoring algorithm can evolve independently

The data model fully supports your vision of:
1. Scraping destination markets to get benchmark prices
2. Scraping French listings
3. Computing MC scores by comparing French prices to destination benchmarks
4. Presenting opportunities ranked by margin potential
