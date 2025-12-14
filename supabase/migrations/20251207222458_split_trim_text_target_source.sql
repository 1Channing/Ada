/*
  # Split trim text into target and source fields

  1. Changes
    - Add `trim_text_target` column to `studies_v2` table
      - Optional text field for target market trim/finition filtering (e.g., "GR Sport")
    - Add `trim_text_source` column to `studies_v2` table
      - Optional text field for source market trim/finition filtering (e.g., "GR", "Trail")
    - Keep existing `trim_text` column for backward compatibility (legacy, read-only)
    - Migrate existing data: copy `trim_text` to both new fields if populated
  
  2. Notes
    - No equivalence/mapping logic between trims
    - Each market can have its own trim filter independent of the other
    - Trims are free text, exactly as if typed into the search bar of each site
    - If both new fields are null, falls back to legacy `trim_text` field
*/

-- Add new columns for target and source trim text
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'studies_v2' AND column_name = 'trim_text_target'
  ) THEN
    ALTER TABLE studies_v2 ADD COLUMN trim_text_target text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'studies_v2' AND column_name = 'trim_text_source'
  ) THEN
    ALTER TABLE studies_v2 ADD COLUMN trim_text_source text DEFAULT NULL;
  END IF;
END $$;

-- Migrate existing trim_text values to new fields for backward compatibility
UPDATE studies_v2
SET
  trim_text_target = COALESCE(trim_text_target, trim_text),
  trim_text_source = COALESCE(trim_text_source, trim_text)
WHERE trim_text IS NOT NULL
  AND (trim_text_target IS NULL OR trim_text_source IS NULL);