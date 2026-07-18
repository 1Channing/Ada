/*
  # Scrape diagnostics on ingestion events (observability)

  Additive only. Stores the worker's per-scrape health report (mode used:
  raw/browser, retry count, HTML length, per-field extraction coverage,
  totalCount, block reason, cache hit) so we can watch harvest health and spot
  a parser key-rename WITHOUT digging through Railway logs.

  Nullable JSONB — existing rows and non-instrumented writes stay valid.
*/

ALTER TABLE linkgen_ingestion_events
  ADD COLUMN IF NOT EXISTS scrape_diagnostics jsonb;
