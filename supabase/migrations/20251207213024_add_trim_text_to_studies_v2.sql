/*
  # Add trim/finition text filter to studies

  1. Changes
    - Add `trim_text` column to `studies_v2` table
      - Optional text field for manual trim/finition filtering (e.g., "GR", "Trail", "Executive")
      - No validation beyond basic string handling
      - When empty/null, behavior remains 100% identical to current implementation
  
  2. Notes
    - This field will be injected into marketplace URLs using site-specific patterns
    - Leboncoin: &text=<trim>
    - Marktplaats: #q:<trim>|...
    - Bilbasen: ?free=<trim> or &free=<trim>
*/

-- Add trim_text column to studies_v2
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'studies_v2' AND column_name = 'trim_text'
  ) THEN
    ALTER TABLE studies_v2 ADD COLUMN trim_text text DEFAULT NULL;
  END IF;
END $$;