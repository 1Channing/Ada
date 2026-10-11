# Market Studies Database - MC Export Intelligence

This document describes the market studies configuration layer and its integration with the MC Export Intelligence platform.

## Overview

The **market_studies** table is the **source of truth** for all market monitoring configurations. It defines which car models are tracked across which source and target markets, along with search URLs, pricing strategies, and other parameters.

## Database Schema

### Table: `market_studies`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier following pattern: `MS_{BRAND}_{MODEL}_{YEAR}_{SOURCE_COUNTRY}` |
| `name` | text | Human-readable study name |
| `brand` | text | Car brand (e.g., TOYOTA, KIA, BMW) |
| `model_pattern` | text | Normalized model name for grouping (e.g., RAV4, CEED, X3) |
| `year_min` | int | Minimum model year (nullable) |
| `year_max` | int | Maximum model year (nullable) |
| `source_country` | text | Source marketplace country code (FR, NL, DK, etc.) |
| `source_marketplace` | text | Source marketplace name (leboncoin, marktplaats, etc.) |
| `source_search_url` | text | URL for searching source marketplace |
| `target_country` | text | Export target country code |
| `target_marketplace` | text | Target marketplace name |
| `target_search_url` | text | URL for searching target marketplace (nullable) |
| `pricing_strategy` | text | Pricing calculation method |
| `last_computed_target_export_price_eur` | numeric | Last computed export price (nullable) |
| `last_computed_target_export_price_at` | timestamptz | Timestamp of last price computation (nullable) |
| `notes` | text | Additional comments (nullable) |
| `created_at` | timestamptz | Record creation timestamp |
| `updated_at` | timestamptz | Last update timestamp (auto-updated) |

## ID Pattern Convention

All market study IDs follow a strict pattern:

```
MS_{BRAND}_{MODEL}_{YEAR}_{SOURCE_COUNTRY}
```

**Examples:**
- `MS_TOYOTA_RAV4_2022_FR` - Toyota RAV4 2022 from France
- `MS_KIA_CEED_2021_NL` - Kia Ceed 2021 from Netherlands
- `MS_BMW_X3_2023_FR` - BMW X3 2023 from France
- `MS_LEXUS_UX_XX_FR` - Lexus UX (year unknown) from France

**Rules:**
- Brand: UPPERCASE
- Model: normalized (spaces replaced with underscores, special chars removed)
- Year: 4-digit year or `XX` if unknown
- Source Country: 2-letter ISO code (FR, NL, DK, etc.)

## Marketplaces

### Source Marketplaces
- **leboncoin** (France) - Leading French classifieds site
- **marktplaats** (Netherlands) - Leading Dutch classifieds site
- **lacentrale** (France) - Specialized car marketplace
- **gaspedaal** (Netherlands) - Dutch car marketplace

### Target Marketplaces
- **bilbasen** (Denmark)
- **mobile_de** (Germany/Europe-wide)
- Various other European platforms

## Pricing Strategies

| Strategy | Description |
|----------|-------------|
| `mean_5_lowest` | Average of 5 lowest prices in target market |
| `median_minus_5pct` | Median price minus 5% |
| `mean_all` | Average of all target market prices |
| `median` | Median of all target market prices |

## Current Data Coverage

From the imported CSV (433 studies):

### By Brand (Top 10)
1. **TOYOTA** - 100+ studies (CHR, RAV4, Corolla, Yaris, Prius, etc.)
2. **KIA** - 70+ studies (Ceed, Sportage, Stonic, Picanto, etc.)
3. **LEXUS** - 50+ studies (RX, ES, NX, UX, CT)
4. **SUZUKI** - 30+ studies (Vitara, Swift, Ignis, S-Cross)
5. **BMW** - 20+ studies (X-Series, 3/5 Series)
6. **MERCEDES-BENZ** - 15+ studies (A/C/E/GLA/GLC)
7. **RENAULT** - 12+ studies (Captur, Clio, Austral, Arkana)
8. **HYUNDAI** - 10+ studies (Tucson, Kona)
9. **AUDI** - 8+ studies (A3/A4/A6, Q3/Q5/Q8)
10. **VOLKSWAGEN** - 6+ studies (Golf, Tiguan, Touareg)

### By Source Country
- **FR (France)**: ~230 studies (53%)
- **NL (Netherlands)**: ~180 studies (42%)
- **Unknown/Multiple**: ~23 studies (5%)

### By Year Range
- **2017-2019**: Early hybrid/modern models
- **2020-2021**: Peak monitoring period
- **2022-2024**: Current/recent models

## Integration with Scraping Pipeline

### How It Works

1. **Configuration Layer** (market_studies table)
   - Stores all study definitions
   - Never hardcoded in frontend/backend
   - Single source of truth

2. **Execution Layer** (daily job)
   - Reads active studies from database
   - Uses `source_search_url` to scrape source markets
   - Uses `target_search_url` to scrape target markets
   - Stores results in `listings` table

3. **Results Layer** (listings + aggregations)
   - Individual listings linked to studies via `market_study_id`
   - Computed margins based on `last_computed_target_export_price_eur`
   - MC scores calculated automatically

### Data Flow

```
market_studies (config)
    ↓
daily-job (Edge Function)
    ↓ calls
External Scraper API
    ↓ returns
Raw Listings JSON
    ↓ processes
Margin Calculation + Scoring
    ↓ stores
listings table (results)
```

## Importing Market Studies

### CSV Import (Recommended)

Use the green **FileSpreadsheet** button (bottom-right of the app) to import the CSV file.

**Expected CSV Format:**
```csv
id,brand,model,year,source_country,mileage_min,mileage_max,source_marketplace,target_country,target_marketplace,target_search_url,pricing_strategy,last_computed_target_export_price_eur,last_computed_target_export_price_at,notes,source_search_url
MS_TOYOTA_RAV4_2022_FR,TOYOTA,RAV 4,2022,FR,50000,0,leboncoin,DK,bilbasen,,mean_5_lowest,,,Study for Toyota RAV4,https://...
```

**Import Behavior:**
- Existing studies (by ID) are **updated**
- New studies are **inserted**
- Invalid rows are skipped with error messages
- Duplicate IDs maintain data consistency

### Manual Creation

Through the Market Studies page UI:
1. Navigate to Market Studies
2. Click "New Study"
3. Fill in all required fields
4. System generates ID automatically

## Study Templates

Some entries in the CSV are marked as **templates** (usually for Denmark):
- These have incomplete data
- Meant to be duplicated when creating new DK studies
- Follow the same pattern as FR/NL studies

## Coverage Gap Analysis

To identify missing studies:

```sql
-- Find brands with FR but no NL coverage
SELECT DISTINCT ms_fr.brand
FROM market_studies ms_fr
WHERE ms_fr.source_country = 'FR'
AND NOT EXISTS (
  SELECT 1 FROM market_studies ms_nl
  WHERE ms_nl.brand = ms_fr.brand
  AND ms_nl.model_pattern = ms_fr.model_pattern
  AND ms_nl.year_min = ms_fr.year_min
  AND ms_nl.source_country = 'NL'
);

-- Count studies by brand and country
SELECT brand, source_country, COUNT(*) as study_count
FROM market_studies
GROUP BY brand, source_country
ORDER BY brand, source_country;
```

## Best Practices

### When Adding New Studies

1. **Follow ID Convention**: Always use `MS_{BRAND}_{MODEL}_{YEAR}_{SOURCE_COUNTRY}`
2. **Normalize Brand**: UPPERCASE, no special characters
3. **Normalize Model**: Remove spaces, special chars (RAV4, not RAV 4)
4. **Verify URLs**: Test search URLs work correctly
5. **Set Pricing Strategy**: Choose appropriate strategy for the market
6. **Consider Mileage**: Set `mileage_min` if filtering needed

### When Expanding to New Countries

1. **Review Existing Studies**: Look at FR/NL for same brand/model/year
2. **Adapt Search URLs**: Build equivalent URLs for new marketplace
3. **Maintain Consistency**: Keep same mileage filters when applicable
4. **Document Differences**: Use `notes` field for market-specific info

### Study Maintenance

- **Review Pricing**: Check `last_computed_target_export_price_eur` regularly
- **Update URLs**: Marketplace URL structures may change
- **Archive Old Studies**: Consider removing very old model years
- **Monitor Errors**: Check `job_runs` table for scraping failures

## API Integration

### Scraper API Contract

Studies provide URLs to external scraper API:

**Request:**
```json
POST /scrapeSearch
{
  "search_url": "https://...",
  "site": "leboncoin",
  "country": "FR"
}
```

**Response:**
```json
{
  "listings": [
    {
      "url_annonce": "https://...",
      "price_eur": 25000,
      "brand": "TOYOTA",
      "model": "RAV4",
      "year": 2022,
      "km": 45000
    }
  ]
}
```

## Future Enhancements

1. **Dynamic Study Generation**: AI-powered study suggestions
2. **Automated Gap Detection**: Identify missing coverage
3. **Price Trend Analysis**: Track `last_computed_target_export_price_eur` over time
4. **Multi-Country Targets**: Support multiple target markets per study
5. **Study Performance Metrics**: Track which studies yield best deals

## Support

For questions about market studies configuration:
- Review this documentation
- Check the Market Studies page in the app
- Examine existing studies for patterns
- Consult the main README.md for system architecture

---

**Last Updated**: 2025-11-19
**Data Version**: 433 studies imported
**Status**: Production Ready
