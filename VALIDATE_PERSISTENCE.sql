-- ═══════════════════════════════════════════════════════════════════════════
-- VALIDATE DATA PERSISTENCE - SQL QUERIES FOR TESTING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run these queries in Supabase SQL Editor to verify Worker persistence
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 1: Find Latest Study Run
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  id AS run_id,
  status,
  executed_at,
  total_studies,
  null_count,
  opportunities_count,
  price_diff_threshold_eur
FROM study_runs
WHERE status IN ('running', 'completed')
ORDER BY executed_at DESC
LIMIT 5;

-- Copy the run_id from the latest row and use it in queries below
-- Replace '<run_id>' with actual UUID

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 2: Check study_run_results for Latest Run
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  r.id AS result_id,
  r.study_id,
  r.status,
  r.target_market_price,
  r.best_source_price,
  r.price_difference,
  r.target_stats,
  r.created_at
FROM study_run_results r
WHERE r.run_id = '<run_id>'  -- ← Replace with actual run_id
ORDER BY r.price_difference DESC NULLS LAST;

-- ✅ Expected: 1 or more rows
-- ✅ status should be 'OPPORTUNITIES' or 'NULL'
-- ✅ price_difference should have a value for OPPORTUNITIES

-- ❌ If EMPTY: Worker insert failed! Check Railway logs for [DATABASE_ERROR]

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 3: Check study_source_listings for Opportunities
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  l.id AS listing_id,
  l.listing_url,
  l.title,
  l.price,
  l.mileage,
  l.year,
  l.trim,
  r.study_id,
  r.status
FROM study_source_listings l
JOIN study_run_results r ON l.run_result_id = r.id
WHERE r.run_id = '<run_id>'  -- ← Replace with actual run_id
  AND r.status = 'OPPORTUNITIES'
ORDER BY l.price ASC;

-- ✅ Expected: 5-35 rows (the interesting listings)
-- ✅ Each row should have listing_url, price, title
-- ❌ If EMPTY but result exists: Listings insert failed

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 4: Verify Data Parity
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  sr.id AS run_id,
  sr.opportunities_count AS run_opportunities_count,
  COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'OPPORTUNITIES') AS actual_opportunities_count,
  COUNT(DISTINCT r.id) AS total_results,
  COUNT(DISTINCT l.id) AS total_listings
FROM study_runs sr
LEFT JOIN study_run_results r ON r.run_id = sr.id
LEFT JOIN study_source_listings l ON l.run_result_id = r.id
WHERE sr.id = '<run_id>'  -- ← Replace with actual run_id
GROUP BY sr.id, sr.opportunities_count;

-- ✅ Expected:
--    run_opportunities_count = actual_opportunities_count
--    total_results >= 1
--    total_listings >= 0 (>0 if opportunities exist)

-- ❌ Mismatch = "Phantom Data" bug still exists

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 5: Check Realtime Publication
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('study_run_results', 'study_runs', 'scheduled_study_runs')
ORDER BY tablename;

-- ✅ Expected: 3 rows
--    - scheduled_study_runs
--    - study_run_results
--    - study_runs

-- ❌ If missing: Realtime won't broadcast changes to UI

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 6: Find Most Recent Opportunities with Details
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  r.id AS result_id,
  r.study_id,
  s.brand,
  s.model,
  s.year,
  s.country_source,
  s.country_target,
  r.target_market_price,
  r.best_source_price,
  r.price_difference,
  (r.target_stats->>'count')::int AS target_count,
  (r.target_stats->>'median_price')::numeric AS target_median,
  COUNT(l.id) AS listing_count,
  r.created_at
FROM study_run_results r
JOIN studies_v2 s ON r.study_id = s.id
LEFT JOIN study_source_listings l ON l.run_result_id = r.id
WHERE r.status = 'OPPORTUNITIES'
GROUP BY r.id, s.brand, s.model, s.year, s.country_source, s.country_target
ORDER BY r.created_at DESC
LIMIT 10;

-- ✅ Expected: Recent opportunities with listing counts
-- ✅ listing_count should match number of interesting listings
-- ✅ target_stats should have median_price, count, etc.

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 7: Validate Target Stats Structure
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  r.id AS result_id,
  r.study_id,
  r.status,
  jsonb_object_keys(r.target_stats) AS stat_keys
FROM study_run_results r
WHERE r.run_id = '<run_id>'  -- ← Replace with actual run_id
  AND r.target_stats IS NOT NULL;

-- ✅ Expected keys:
--    - count
--    - median_price
--    - average_price
--    - min_price
--    - max_price
--    - percentile_25
--    - percentile_75

-- ❌ If missing keys: UI won't display stats correctly

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 8: Check for Orphaned Records
-- ═══════════════════════════════════════════════════════════════════════════

-- Orphaned results (no matching study_runs row)
SELECT
  r.id,
  r.run_id,
  r.study_id,
  r.status
FROM study_run_results r
LEFT JOIN study_runs sr ON r.run_id = sr.id
WHERE sr.id IS NULL
LIMIT 10;

-- ✅ Expected: 0 rows (no orphans)
-- ❌ If rows exist: FK violation or cascade delete not working

-- Orphaned listings (no matching study_run_results row)
SELECT
  l.id,
  l.run_result_id,
  l.listing_url
FROM study_source_listings l
LEFT JOIN study_run_results r ON l.run_result_id = r.id
WHERE r.id IS NULL
LIMIT 10;

-- ✅ Expected: 0 rows (no orphans)
-- ❌ If rows exist: FK violation or cascade delete not working

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 9: Performance Check - Recent Activity
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  DATE(sr.executed_at) AS date,
  COUNT(DISTINCT sr.id) AS total_runs,
  SUM(sr.total_studies) AS total_studies,
  SUM(sr.opportunities_count) AS total_opportunities,
  COUNT(DISTINCT r.id) AS actual_results_count,
  COUNT(DISTINCT l.id) AS total_listings
FROM study_runs sr
LEFT JOIN study_run_results r ON r.run_id = sr.id
LEFT JOIN study_source_listings l ON l.run_result_id = r.id
WHERE sr.executed_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(sr.executed_at)
ORDER BY date DESC;

-- ✅ Shows data persistence trends over last 7 days
-- ✅ actual_results_count should equal total_studies (if all persisted)
-- ❌ Gaps indicate persistence failures

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 10: Validate Run Completion
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  sr.id AS run_id,
  sr.status,
  sr.total_studies AS expected_results,
  COUNT(r.id) AS actual_results,
  CASE
    WHEN sr.total_studies = COUNT(r.id) THEN '✅ Complete'
    WHEN COUNT(r.id) = 0 THEN '❌ NO RESULTS (Phantom Data!)'
    ELSE '⚠️ Partial Results'
  END AS status_check
FROM study_runs sr
LEFT JOIN study_run_results r ON r.run_id = sr.id
WHERE sr.executed_at >= CURRENT_DATE - INTERVAL '1 day'
  AND sr.status = 'completed'
GROUP BY sr.id, sr.total_studies
ORDER BY sr.executed_at DESC;

-- ✅ Expected: All rows show "✅ Complete"
-- ❌ "NO RESULTS" = Phantom Data bug (Worker logs success but DB has nothing)
-- ⚠️ "Partial Results" = Some inserts failed

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF VALIDATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════
