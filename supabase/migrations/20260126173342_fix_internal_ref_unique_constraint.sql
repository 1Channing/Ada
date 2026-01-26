/*
  # Fix internal_ref Unique Constraint for Upsert Support

  1. Problem
    - Existing partial unique index (WHERE internal_ref IS NOT NULL) cannot be used with ON CONFLICT
    - Worker fails with "no unique or exclusion constraint matching the ON CONFLICT specification"
    - Listings fail to persist, UI shows 0 listings

  2. Solution
    - Drop partial unique index
    - Create non-partial unique index on internal_ref
    - PostgreSQL unique indexes allow multiple NULLs by default
    - Enables ON CONFLICT (internal_ref) to work correctly

  3. Impact
    - No data changes
    - Worker upserts will succeed
    - Duplicate listings prevented via internal_ref deduplication
    - assigned_to values preserved across reruns
*/

-- Drop the partial unique index
DROP INDEX IF EXISTS idx_study_source_listings_internal_ref;

-- Create non-partial unique index to support ON CONFLICT
CREATE UNIQUE INDEX idx_study_source_listings_internal_ref
  ON study_source_listings(internal_ref);
