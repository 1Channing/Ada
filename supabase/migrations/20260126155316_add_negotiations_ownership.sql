/*
  # Add Negotiations Ownership and Deduplication

  1. Changes
    - Add `internal_ref` column to study_source_listings for deduplication
      - Deterministic key based on marketplace + listing ID (or URL hash)
      - Ensures same real-world listing is never negotiated twice

    - Add `assigned_to` column to study_source_listings for ownership tracking
      - Tracks which team member (Channing or Antoine) owns each negotiation
      - Constrained to valid values only

  2. Indexes
    - Unique index on internal_ref to enforce deduplication at DB level
    - Index on assigned_to for efficient filtering by owner

  3. Security
    - Both columns are nullable (non-breaking change)
    - Check constraint ensures assigned_to is only valid values
    - Conditional indexes (WHERE NOT NULL) for efficiency
*/

-- Add internal_ref column for deduplication
ALTER TABLE study_source_listings
  ADD COLUMN IF NOT EXISTS internal_ref text;

-- Add assigned_to column for ownership tracking
ALTER TABLE study_source_listings
  ADD COLUMN IF NOT EXISTS assigned_to text
    CHECK (assigned_to IN ('channing', 'antoine'));

-- Unique index to prevent duplicate listings
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_source_listings_internal_ref
  ON study_source_listings(internal_ref)
  WHERE internal_ref IS NOT NULL;

-- Index for filtering by assignee
CREATE INDEX IF NOT EXISTS idx_study_source_listings_assigned_to
  ON study_source_listings(assigned_to)
  WHERE assigned_to IS NOT NULL;
