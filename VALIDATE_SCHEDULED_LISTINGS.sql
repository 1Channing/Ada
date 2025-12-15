-- ========================================
-- SCHEDULED LISTINGS VALIDATION QUERIES
-- ========================================
-- Run these queries to verify scheduled runs persist listings correctly

-- ========================================
-- 1. Check Latest Scheduled Study Run
-- ========================================
-- Expected: Status = 'completed', opportunities_count > 0
SELECT
  id,
  run_type,
  status,
  executed_at,
  total_studies,
  opportunities_count,
  null_count,
  price_diff_threshold_eur
FROM study_runs
WHERE run_type = 'scheduled'
ORDER BY created_at DESC
LIMIT 1;

-- ========================================
-- 2. Check Study Run Results for Latest Scheduled Run
-- ========================================
-- Expected: Shows OPPORTUNITIES results with numeric prices
SELECT
  srr.id as result_id,
  srr.study_id,
  s.brand,
  s.model,
  s.year,
  s.country_target,
  s.country_source,
  srr.status,
  srr.target_market_price,
  srr.best_source_price,
  srr.price_difference,
  srr.target_stats->>'targetMarketUrl' as target_url,
  srr.target_stats->>'sourceMarketUrl' as source_url
FROM study_run_results srr
JOIN studies_v2 s ON s.id = srr.study_id
WHERE srr.run_id = (
  SELECT id FROM study_runs
  WHERE run_type = 'scheduled'
  ORDER BY created_at DESC
  LIMIT 1
)
AND srr.status = 'OPPORTUNITIES'
ORDER BY srr.price_difference DESC;

-- ========================================
-- 3. Check Listings for Most Recent Opportunity Result
-- ========================================
-- Expected: Shows 1-5 listings ordered by price
WITH latest_opportunity AS (
  SELECT srr.id
  FROM study_run_results srr
  WHERE srr.run_id = (
    SELECT id FROM study_runs
    WHERE run_type = 'scheduled'
    ORDER BY created_at DESC
    LIMIT 1
  )
  AND srr.status = 'OPPORTUNITIES'
  LIMIT 1
)
SELECT
  ssl.id,
  ssl.listing_url,
  ssl.title,
  ssl.price as price_eur,
  ssl.mileage,
  ssl.year,
  ssl.trim,
  ssl.is_damaged,
  ssl.status,
  ssl.created_at
FROM study_source_listings ssl
WHERE ssl.run_result_id = (SELECT id FROM latest_opportunity)
ORDER BY ssl.price ASC;

-- ========================================
-- 4. Count Listings Per Scheduled Run (Last 7 Days)
-- ========================================
-- Expected: Each run with opportunities should have listings persisted
SELECT
  sr.id as run_id,
  sr.executed_at,
  sr.opportunities_count,
  COUNT(DISTINCT srr.id) FILTER (WHERE srr.status = 'OPPORTUNITIES') as opportunity_results,
  COUNT(ssl.id) as total_listings_persisted
FROM study_runs sr
LEFT JOIN study_run_results srr ON srr.run_id = sr.id
LEFT JOIN study_source_listings ssl ON ssl.run_result_id = srr.id
WHERE sr.run_type = 'scheduled'
  AND sr.status = 'completed'
  AND sr.executed_at > now() - interval '7 days'
GROUP BY sr.id, sr.executed_at, sr.opportunities_count
ORDER BY sr.executed_at DESC;

-- ========================================
-- 5. Compare Instant vs Scheduled Listing Persistence
-- ========================================
-- Expected: Both should show high listing_persistence_rate
SELECT
  sr.run_type,
  COUNT(DISTINCT srr.id) as opportunity_results,
  COUNT(ssl.id) as total_listings,
  ROUND(
    COUNT(ssl.id)::numeric /
    NULLIF(COUNT(DISTINCT srr.id), 0),
    2
  ) as avg_listings_per_result
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id AND srr.status = 'OPPORTUNITIES'
LEFT JOIN study_source_listings ssl ON ssl.run_result_id = srr.id
WHERE sr.created_at > now() - interval '7 days'
  AND sr.status = 'completed'
GROUP BY sr.run_type;

-- ========================================
-- 6. Detailed View of Latest Scheduled Run
-- ========================================
-- Shows full breakdown with listing details
WITH latest_scheduled_run AS (
  SELECT id FROM study_runs
  WHERE run_type = 'scheduled'
    AND status = 'completed'
  ORDER BY executed_at DESC
  LIMIT 1
)
SELECT
  sr.id as run_id,
  sr.executed_at,
  sr.opportunities_count,
  srr.id as result_id,
  s.brand || ' ' || s.model || ' ' || s.year as study_name,
  s.country_source || ' → ' || s.country_target as market_flow,
  srr.status,
  srr.target_market_price as target_median_eur,
  srr.best_source_price as best_source_eur,
  srr.price_difference as price_diff_eur,
  COUNT(ssl.id) as listing_count,
  ARRAY_AGG(ssl.title ORDER BY ssl.price) FILTER (WHERE ssl.id IS NOT NULL) as listing_titles,
  ARRAY_AGG(ssl.price ORDER BY ssl.price) FILTER (WHERE ssl.id IS NOT NULL) as listing_prices_eur
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
JOIN studies_v2 s ON s.id = srr.study_id
LEFT JOIN study_source_listings ssl ON ssl.run_result_id = srr.id
WHERE sr.id = (SELECT id FROM latest_scheduled_run)
GROUP BY
  sr.id, sr.executed_at, sr.opportunities_count,
  srr.id, s.brand, s.model, s.year, s.country_source, s.country_target,
  srr.status, srr.target_market_price, srr.best_source_price, srr.price_difference
ORDER BY srr.price_difference DESC;

-- ========================================
-- 7. Check for Orphaned Results (No Listings)
-- ========================================
-- Expected: Should be empty (all OPPORTUNITIES should have listings)
SELECT
  sr.id as run_id,
  sr.run_type,
  sr.executed_at,
  srr.id as result_id,
  srr.study_id,
  srr.status,
  srr.price_difference
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
LEFT JOIN study_source_listings ssl ON ssl.run_result_id = srr.id
WHERE sr.run_type = 'scheduled'
  AND srr.status = 'OPPORTUNITIES'
  AND sr.executed_at > now() - interval '7 days'
  AND ssl.id IS NULL
ORDER BY sr.executed_at DESC;

-- ========================================
-- 8. Verify Listing Field Completeness
-- ========================================
-- Check what percentage of fields are populated
SELECT
  'Total Listings' as metric,
  COUNT(*) as count
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With Title',
  COUNT(*) FILTER (WHERE ssl.title IS NOT NULL AND ssl.title != '')
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With Price',
  COUNT(*) FILTER (WHERE ssl.price > 0)
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With URL',
  COUNT(*) FILTER (WHERE ssl.listing_url IS NOT NULL AND ssl.listing_url != '')
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With Mileage',
  COUNT(*) FILTER (WHERE ssl.mileage IS NOT NULL)
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With Year',
  COUNT(*) FILTER (WHERE ssl.year IS NOT NULL)
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'

UNION ALL

SELECT
  'With Car Images',
  COUNT(*) FILTER (WHERE jsonb_array_length(ssl.car_image_urls) > 0)
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days';

-- ========================================
-- 9. Sample Listing Detail
-- ========================================
-- View a single listing to verify all fields
SELECT
  ssl.id,
  ssl.run_result_id,
  ssl.listing_url,
  ssl.title,
  ssl.price as price_eur,
  ssl.mileage,
  ssl.year,
  ssl.trim,
  ssl.is_damaged,
  ssl.defects_summary,
  ssl.maintenance_summary,
  ssl.options_summary,
  ssl.entretien,
  ssl.options,
  ssl.full_description,
  ssl.car_image_urls,
  ssl.status,
  ssl.created_at
FROM study_source_listings ssl
JOIN study_run_results srr ON srr.id = ssl.run_result_id
JOIN study_runs sr ON sr.id = srr.run_id
WHERE sr.run_type = 'scheduled'
  AND sr.executed_at > now() - interval '7 days'
ORDER BY ssl.created_at DESC
LIMIT 1;

-- ========================================
-- 10. Daily Persistence Rate Monitoring
-- ========================================
-- Track listing persistence over time
SELECT
  DATE(sr.executed_at) as run_date,
  sr.run_type,
  COUNT(DISTINCT sr.id) as total_runs,
  COUNT(DISTINCT srr.id) FILTER (WHERE srr.status = 'OPPORTUNITIES') as opportunity_count,
  COUNT(ssl.id) as listings_persisted,
  ROUND(
    COUNT(ssl.id)::numeric /
    NULLIF(COUNT(DISTINCT srr.id) FILTER (WHERE srr.status = 'OPPORTUNITIES'), 0),
    2
  ) as avg_listings_per_opportunity
FROM study_runs sr
LEFT JOIN study_run_results srr ON srr.run_id = sr.id
LEFT JOIN study_source_listings ssl ON ssl.run_result_id = srr.id
WHERE sr.executed_at > now() - interval '30 days'
  AND sr.status = 'completed'
GROUP BY DATE(sr.executed_at), sr.run_type
ORDER BY run_date DESC, sr.run_type;
