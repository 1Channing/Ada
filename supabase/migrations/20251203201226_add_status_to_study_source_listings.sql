/*
  # Add Status Column to Study Source Listings

  ## Overview
  This migration adds a `status` column to the `study_source_listings` table to support
  the negotiation workflow.

  ## Changes

  ### Column Addition
  - Adds `status` text column to `study_source_listings`
  - Default value: 'NEW'
  - Allowed values: 'NEW', 'APPROVED', 'REJECTED', 'COMPLETED'
  - Existing records will automatically be set to 'NEW'

  ### Index
  - Adds index on `status` column for fast filtering in the Negotiations tab

  ## Status Values

  - `NEW`: Freshly stored interesting listing (default)
  - `APPROVED`: User wants to negotiate this car
  - `REJECTED`: User does not want to use this car
  - `COMPLETED`: Negotiation done / deal closed or abandoned

  ## Security
  - No changes to RLS policies (uses existing policies on study_source_listings)
*/

-- Add status column with default value 'NEW'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_source_listings' AND column_name = 'status'
  ) THEN
    ALTER TABLE study_source_listings ADD COLUMN status text NOT NULL DEFAULT 'NEW';
  END IF;
END $$;

-- Create index on status for fast filtering
CREATE INDEX IF NOT EXISTS idx_study_source_listings_status
  ON study_source_listings(status);

-- Add comment to document allowed values
COMMENT ON COLUMN study_source_listings.status IS 'Negotiation status: NEW, APPROVED, REJECTED, or COMPLETED';