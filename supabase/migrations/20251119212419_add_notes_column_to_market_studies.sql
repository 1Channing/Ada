/*
  # Add notes column to market_studies table

  ## Changes
  - Add `notes` column to `market_studies` table to store additional comments and information
  - This aligns with the CSV import structure from the market intelligence data

  ## Notes
  - Column is nullable to allow studies without notes
  - Existing studies will have NULL notes by default
*/

-- Add notes column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_studies' AND column_name = 'notes'
  ) THEN
    ALTER TABLE market_studies ADD COLUMN notes text;
  END IF;
END $$;