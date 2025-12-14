/*
  # Add Entretien and Options Fields

  ## Overview
  This migration adds new fields to support improved maintenance and options display:
  - `entretien`: French text summary of maintenance history
  - `options`: JSONB array of high-value equipment options

  ## Changes

  ### Column Additions
  1. `study_source_listings.entretien` (text, nullable)
     - French summary of maintenance information
     - Default: empty string

  2. `study_source_listings.options` (jsonb, nullable)
     - Array of high-value options in French
     - Default: empty JSON array []

  ## Notes
  - These fields complement the existing maintenance_summary and options_summary
  - The AI will now return structured data in these new fields
  - UI will prioritize entretien over maintenance_summary for display
*/

-- Add entretien column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_source_listings' AND column_name = 'entretien'
  ) THEN
    ALTER TABLE study_source_listings ADD COLUMN entretien text DEFAULT '';
  END IF;
END $$;

-- Add options column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_source_listings' AND column_name = 'options'
  ) THEN
    ALTER TABLE study_source_listings ADD COLUMN options jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
