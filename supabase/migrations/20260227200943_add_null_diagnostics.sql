/*
  # Add NULL/N-A Root-Cause Diagnostics

  1. New Columns (additive, nullable, no breaking changes)
    - `null_reason_code` (text, nullable) - Specific reason for NULL status
    - `parsed_target_count` (int, default 0) - Raw listings extracted from target HTML
    - `parsed_source_count` (int, default 0) - Raw listings extracted from source HTML
    - `filtered_target_count` (int, default 0) - Listings passing all filters (target)
    - `filtered_source_count` (int, default 0) - Listings passing all filters (source)
    - `top_reject_reasons` (jsonb, nullable) - Top 3 rejection reasons with counts

  2. Purpose
    - Track root cause of NULL results systematically
    - Distinguish: no data vs. all filtered out vs. insufficient stats
    - Enable data-driven fixes for dominant rejection reasons

  3. Null Reason Codes
    - TARGET_NO_LISTINGS: No listings parsed from target market HTML
    - TARGET_PARSED_BUT_ALL_FILTERED: Parsed listings but all filtered out
    - SOURCE_NO_LISTINGS: No listings parsed from source market HTML
    - SOURCE_PARSED_BUT_ALL_FILTERED: Parsed listings but all filtered out
    - STATS_INSUFFICIENT_DATA: Not enough data for reliable statistics
    - THRESHOLD_NOT_MET: Price difference below threshold (not technically NULL, but tracked)
*/

-- Add diagnostic columns to study_run_results
ALTER TABLE study_run_results
  ADD COLUMN IF NOT EXISTS null_reason_code text,
  ADD COLUMN IF NOT EXISTS parsed_target_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS filtered_target_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parsed_source_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS filtered_source_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_reject_reasons jsonb;

-- Add comment for documentation
COMMENT ON COLUMN study_run_results.null_reason_code IS 'Root cause code when status is NULL: TARGET_NO_LISTINGS, TARGET_PARSED_BUT_ALL_FILTERED, SOURCE_NO_LISTINGS, SOURCE_PARSED_BUT_ALL_FILTERED, STATS_INSUFFICIENT_DATA, THRESHOLD_NOT_MET';
COMMENT ON COLUMN study_run_results.top_reject_reasons IS 'Top 3 rejection reasons with counts, e.g., {"price_floor": 45, "trim": 12, "monthly_price": 8}';
