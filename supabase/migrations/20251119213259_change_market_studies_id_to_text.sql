/*
  # Change market_studies ID column from UUID to TEXT

  ## Problem
  Market study IDs follow the pattern MS_{BRAND}_{MODEL}_{YEAR}_{SOURCE_COUNTRY}
  which is not compatible with UUID type.

  ## Solution
  Change the id column from uuid to text to support the custom ID pattern.

  ## Changes
  1. Drop existing foreign key constraints from listings table
  2. Change market_studies.id from uuid to text
  3. Change listings.market_study_id from uuid to text
  4. Recreate foreign key constraint

  ## Notes
  - This preserves all existing data
  - The custom ID pattern is more meaningful than UUIDs for this use case
  - IDs like MS_TOYOTA_RAV4_2022_FR are human-readable and self-documenting
*/

-- Step 1: Drop foreign key constraint from listings
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_market_study_id_fkey;

-- Step 2: Change market_studies.id from uuid to text
-- First, add a new text column
ALTER TABLE market_studies ADD COLUMN IF NOT EXISTS id_new text;

-- Copy existing IDs (if any exist, they'll need manual handling)
UPDATE market_studies SET id_new = id::text WHERE id_new IS NULL;

-- Drop the old id column and rename the new one
ALTER TABLE market_studies DROP COLUMN id CASCADE;
ALTER TABLE market_studies RENAME COLUMN id_new TO id;

-- Set as primary key and not null
ALTER TABLE market_studies ALTER COLUMN id SET NOT NULL;
ALTER TABLE market_studies ADD PRIMARY KEY (id);

-- Step 3: Change listings.market_study_id to text
ALTER TABLE listings ALTER COLUMN market_study_id TYPE text USING market_study_id::text;

-- Step 4: Recreate foreign key constraint
ALTER TABLE listings 
  ADD CONSTRAINT listings_market_study_id_fkey 
  FOREIGN KEY (market_study_id) 
  REFERENCES market_studies(id) 
  ON DELETE SET NULL;

-- Step 5: Update the default value generation
-- Remove uuid generation default (if it exists)
ALTER TABLE market_studies ALTER COLUMN id DROP DEFAULT;