/*
  # Create Negotiation Notes Table

  ## Overview
  Adds a shared call notebook for negotiations. Notes are visible to everyone (Channing & Antoine),
  timestamped, and tied to specific vehicle listings.

  ## New Tables

  ### `negotiation_notes`
  Stores dated notes on vehicles in negotiations:
  - `id` (uuid, primary key) - Unique note identifier
  - `listing_id` (uuid, foreign key) - References study_source_listings(id)
  - `author` (text) - Who wrote the note (channing or antoine)
  - `note` (text) - The note content
  - `created_at` (timestamptz) - When the note was created

  ## Indexes
  - Composite index on (listing_id, created_at DESC) for fast chronological retrieval

  ## Security
  - RLS enabled
  - Full read/write access for authenticated users (internal tool)

  ## Notes
  - Notes cascade delete when the associated listing is deleted
  - Author is constrained to valid team members only
*/

-- Create negotiation_notes table
CREATE TABLE IF NOT EXISTS negotiation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES study_source_listings(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('channing', 'antoine')),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE negotiation_notes ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Allow all operations for authenticated users"
  ON negotiation_notes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create index for fast retrieval by listing
CREATE INDEX IF NOT EXISTS idx_negotiation_notes_listing_created
  ON negotiation_notes(listing_id, created_at DESC);