/*
  # Drop legacy linkgen tables

  Removes the four linkgen tables created in previous migrations.
  These tables are replaced by the new local-code Link Generator module.

  Dropped tables (in dependency order):
  - linkgen_mapping_candidates
  - linkgen_mapping_samples
  - linkgen_mapping_runs
  - linkgen_url_samples

  No data loss risk: these tables were never populated in production.
  Historical migrations remain intact for audit purposes.
*/

DROP TABLE IF EXISTS linkgen_mapping_candidates;
DROP TABLE IF EXISTS linkgen_mapping_samples;
DROP TABLE IF EXISTS linkgen_mapping_runs;
DROP TABLE IF EXISTS linkgen_url_samples;
