-- ========================================
-- MEDIAN PARITY VALIDATION QUERIES
-- ========================================
-- Run these queries to verify instant and scheduled runs produce identical median prices

-- ========================================
-- 1. Compare Latest Instant vs Scheduled Run for Each Study
-- ========================================
-- Expected: difference_eur <= 2 EUR for all rows
WITH instant_runs AS (
  SELECT
    srr.study_id,
    s.brand,
    s.model,
    s.year,
    srr.target_market_price as instant_median,
    srr.created_at,
    ROW_NUMBER() OVER (PARTITION BY srr.study_id ORDER BY srr.created_at DESC) as rn
  FROM study_runs sr
  JOIN study_run_results srr ON srr.run_id = sr.id
  JOIN studies_v2 s ON s.id = srr.study_id
  WHERE sr.run_type = 'instant'
    AND srr.target_market_price IS NOT NULL
    AND srr.created_at > now() - interval '7 days'
),
scheduled_runs AS (
  SELECT
    srr.study_id,
    s.brand,
    s.model,
    s.year,
    srr.target_market_price as scheduled_median,
    srr.created_at,
    ROW_NUMBER() OVER (PARTITION BY srr.study_id ORDER BY srr.created_at DESC) as rn
  FROM study_runs sr
  JOIN study_run_results srr ON srr.run_id = sr.id
  JOIN studies_v2 s ON s.id = srr.study_id
  WHERE sr.run_type = 'scheduled'
    AND srr.target_market_price IS NOT NULL
    AND srr.created_at > now() - interval '7 days'
)
SELECT
  i.study_id,
  i.brand || ' ' || i.model || ' ' || i.year as study_name,
  i.instant_median::integer as instant_median_eur,
  s.scheduled_median::integer as scheduled_median_eur,
  ABS(i.instant_median - s.scheduled_median)::integer as difference_eur,
  ROUND(ABS(i.instant_median - s.scheduled_median) / i.instant_median * 100, 2) as difference_pct,
  CASE
    WHEN ABS(i.instant_median - s.scheduled_median) <= 2 THEN '✅ PASS'
    WHEN ABS(i.instant_median - s.scheduled_median) <= 100 THEN '⚠️ WARN'
    ELSE '❌ FAIL'
  END as parity_status,
  i.created_at as instant_run_at,
  s.created_at as scheduled_run_at
FROM instant_runs i
JOIN scheduled_runs s ON s.study_id = i.study_id AND s.rn = 1
WHERE i.rn = 1
ORDER BY difference_eur DESC;

-- ========================================
-- 2. Compare Same Study Run Multiple Times
-- ========================================
-- Run the same study 3x in instant mode, 3x in scheduled mode
-- Expected: All medians within ±50 EUR (allows for market fluctuations)
SELECT
  srr.study_id,
  s.brand || ' ' || s.model || ' ' || s.year as study_name,
  sr.run_type,
  COUNT(*) as run_count,
  MIN(srr.target_market_price)::integer as min_median_eur,
  MAX(srr.target_market_price)::integer as max_median_eur,
  AVG(srr.target_market_price)::integer as avg_median_eur,
  STDDEV(srr.target_market_price)::integer as stddev_eur,
  CASE
    WHEN MAX(srr.target_market_price) - MIN(srr.target_market_price) <= 50 THEN '✅ STABLE'
    WHEN MAX(srr.target_market_price) - MIN(srr.target_market_price) <= 200 THEN '⚠️ VOLATILE'
    ELSE '❌ UNSTABLE'
  END as stability_status
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
JOIN studies_v2 s ON s.id = srr.study_id
WHERE srr.target_market_price IS NOT NULL
  AND srr.created_at > now() - interval '7 days'
GROUP BY srr.study_id, s.brand, s.model, s.year, sr.run_type
HAVING COUNT(*) >= 2
ORDER BY MAX(srr.target_market_price) - MIN(srr.target_market_price) DESC;

-- ========================================
-- 3. Check for Outlier Medians (Potential Issues)
-- ========================================
-- Expected: No rows (all medians should be within reasonable bounds)
WITH study_median_stats AS (
  SELECT
    srr.study_id,
    s.brand || ' ' || s.model || ' ' || s.year as study_name,
    AVG(srr.target_market_price) as avg_median,
    STDDEV(srr.target_market_price) as stddev_median
  FROM study_run_results srr
  JOIN studies_v2 s ON s.id = srr.study_id
  WHERE srr.target_market_price IS NOT NULL
    AND srr.created_at > now() - interval '30 days'
  GROUP BY srr.study_id, s.brand, s.model, s.year
  HAVING COUNT(*) >= 3
)
SELECT
  srr.id as result_id,
  sr.run_type,
  sms.study_name,
  srr.target_market_price::integer as median_eur,
  sms.avg_median::integer as expected_median_eur,
  ABS(srr.target_market_price - sms.avg_median)::integer as deviation_eur,
  ROUND(ABS(srr.target_market_price - sms.avg_median) / sms.avg_median * 100, 1) as deviation_pct,
  srr.created_at
FROM study_run_results srr
JOIN study_runs sr ON sr.id = srr.run_id
JOIN study_median_stats sms ON sms.study_id = srr.study_id
WHERE ABS(srr.target_market_price - sms.avg_median) > (sms.stddev_median * 3)
  AND srr.created_at > now() - interval '7 days'
ORDER BY ABS(srr.target_market_price - sms.avg_median) DESC;

-- ========================================
-- 4. Compare Target Stats (count field)
-- ========================================
-- Verify both instant and scheduled use the same number of listings
SELECT
  sr.run_type,
  srr.study_id,
  s.brand || ' ' || s.model || ' ' || s.year as study_name,
  (srr.target_stats->>'count')::integer as listings_used_for_median,
  srr.target_market_price::integer as median_eur,
  srr.created_at
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
JOIN studies_v2 s ON s.id = srr.study_id
WHERE srr.target_stats IS NOT NULL
  AND srr.created_at > now() - interval '7 days'
ORDER BY srr.study_id, sr.run_type, srr.created_at DESC;

-- ========================================
-- 5. Verify MAX_TARGET_LISTINGS = 6 Limit Applied
-- ========================================
-- Expected: All rows show count <= 6
SELECT
  sr.run_type,
  COUNT(*) as total_results,
  COUNT(*) FILTER (WHERE (srr.target_stats->>'count')::integer <= 6) as count_within_limit,
  COUNT(*) FILTER (WHERE (srr.target_stats->>'count')::integer > 6) as count_exceeds_limit,
  ROUND(
    COUNT(*) FILTER (WHERE (srr.target_stats->>'count')::integer <= 6)::numeric /
    NULLIF(COUNT(*), 0) * 100,
    1
  ) as compliance_pct
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
WHERE srr.target_stats IS NOT NULL
  AND srr.created_at > now() - interval '7 days'
GROUP BY sr.run_type;

-- ========================================
-- 6. Test Specific Study (Replace study_id)
-- ========================================
-- Use this to test a specific study you just ran
-- Replace 'MS_TOYOTA_YARISCROSS_2024_FR_NL' with your study ID
SELECT
  sr.id as run_id,
  sr.run_type,
  sr.executed_at,
  srr.id as result_id,
  srr.status,
  srr.target_market_price::integer as median_eur,
  (srr.target_stats->>'count')::integer as listings_used,
  (srr.target_stats->>'min_price')::integer as min_price_eur,
  (srr.target_stats->>'max_price')::integer as max_price_eur,
  srr.best_source_price::integer as best_source_eur,
  srr.price_difference::integer as opportunity_eur
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
WHERE srr.study_id = 'MS_TOYOTA_YARISCROSS_2024_FR_NL'
  AND srr.created_at > now() - interval '24 hours'
ORDER BY srr.created_at DESC;

-- ========================================
-- 7. Daily Median Parity Report
-- ========================================
-- Track median parity over time
SELECT
  DATE(srr.created_at) as run_date,
  sr.run_type,
  COUNT(DISTINCT srr.study_id) as unique_studies,
  COUNT(*) as total_runs,
  ROUND(AVG(srr.target_market_price)::numeric, 0) as avg_median_eur,
  ROUND(STDDEV(srr.target_market_price)::numeric, 0) as stddev_median_eur,
  MIN(srr.target_market_price)::integer as min_median_eur,
  MAX(srr.target_market_price)::integer as max_median_eur
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
WHERE srr.target_market_price IS NOT NULL
  AND srr.created_at > now() - interval '30 days'
GROUP BY DATE(srr.created_at), sr.run_type
ORDER BY run_date DESC, sr.run_type;

-- ========================================
-- 8. Find Studies with Large Median Discrepancy (Debugging)
-- ========================================
-- Expected: Empty result (no large discrepancies)
WITH recent_instant AS (
  SELECT DISTINCT ON (srr.study_id)
    srr.study_id,
    srr.target_market_price as instant_median,
    srr.created_at
  FROM study_runs sr
  JOIN study_run_results srr ON srr.run_id = sr.id
  WHERE sr.run_type = 'instant'
    AND srr.target_market_price IS NOT NULL
    AND srr.created_at > now() - interval '7 days'
  ORDER BY srr.study_id, srr.created_at DESC
),
recent_scheduled AS (
  SELECT DISTINCT ON (srr.study_id)
    srr.study_id,
    srr.target_market_price as scheduled_median,
    srr.created_at
  FROM study_runs sr
  JOIN study_run_results srr ON srr.run_id = sr.id
  WHERE sr.run_type = 'scheduled'
    AND srr.target_market_price IS NOT NULL
    AND srr.created_at > now() - interval '7 days'
  ORDER BY srr.study_id, srr.created_at DESC
)
SELECT
  i.study_id,
  s.brand || ' ' || s.model || ' ' || s.year as study_name,
  i.instant_median::integer as instant_eur,
  rs.scheduled_median::integer as scheduled_eur,
  ABS(i.instant_median - rs.scheduled_median)::integer as diff_eur,
  ROUND(ABS(i.instant_median - rs.scheduled_median) / i.instant_median * 100, 1) as diff_pct,
  '❌ INVESTIGATE' as status
FROM recent_instant i
JOIN recent_scheduled rs ON rs.study_id = i.study_id
JOIN studies_v2 s ON s.id = i.study_id
WHERE ABS(i.instant_median - rs.scheduled_median) > 100
ORDER BY ABS(i.instant_median - rs.scheduled_median) DESC;

-- ========================================
-- 9. Verify Filter Effectiveness (Indirect)
-- ========================================
-- Compare results count before/after filtering
-- Expected: Scheduled runs should filter out similar % as instant runs
SELECT
  sr.run_type,
  COUNT(*) as total_results,
  AVG((srr.target_stats->>'count')::integer) as avg_listings_used,
  ROUND(STDDEV((srr.target_stats->>'count')::integer), 1) as stddev_listings_used
FROM study_runs sr
JOIN study_run_results srr ON srr.run_id = sr.id
WHERE srr.target_stats IS NOT NULL
  AND (srr.target_stats->>'count')::integer > 0
  AND srr.created_at > now() - interval '7 days'
GROUP BY sr.run_type;

-- ========================================
-- 10. Summary: Parity Status Dashboard
-- ========================================
-- High-level view of median parity health
WITH parity_checks AS (
  SELECT
    i.study_id,
    ABS(i.target_market_price - s.target_market_price) as diff_eur,
    CASE
      WHEN ABS(i.target_market_price - s.target_market_price) <= 2 THEN 'PASS'
      WHEN ABS(i.target_market_price - s.target_market_price) <= 100 THEN 'WARN'
      ELSE 'FAIL'
    END as status
  FROM (
    SELECT DISTINCT ON (srr.study_id)
      srr.study_id,
      srr.target_market_price
    FROM study_runs sr
    JOIN study_run_results srr ON srr.run_id = sr.id
    WHERE sr.run_type = 'instant'
      AND srr.created_at > now() - interval '7 days'
    ORDER BY srr.study_id, srr.created_at DESC
  ) i
  JOIN (
    SELECT DISTINCT ON (srr.study_id)
      srr.study_id,
      srr.target_market_price
    FROM study_runs sr
    JOIN study_run_results srr ON srr.run_id = sr.id
    WHERE sr.run_type = 'scheduled'
      AND srr.created_at > now() - interval '7 days'
    ORDER BY srr.study_id, srr.created_at DESC
  ) s ON s.study_id = i.study_id
)
SELECT
  COUNT(*) as total_studies_compared,
  COUNT(*) FILTER (WHERE status = 'PASS') as pass_count,
  COUNT(*) FILTER (WHERE status = 'WARN') as warn_count,
  COUNT(*) FILTER (WHERE status = 'FAIL') as fail_count,
  ROUND(COUNT(*) FILTER (WHERE status = 'PASS')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as pass_rate_pct,
  ROUND(AVG(diff_eur), 1) as avg_difference_eur,
  MAX(diff_eur)::integer as max_difference_eur
FROM parity_checks;
