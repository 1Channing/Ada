/*
  # Create Sales Table

  ## Overview
  Tracks vehicles that have been marked as sold. This is V1 scope capturing only essential
  transaction data: buy price, sale price, and who sold it.

  ## New Tables

  ### `sales`
  Stores sold vehicles with basic transaction data:
  - `id` (uuid, primary key) - Unique sale identifier
  - `listing_id` (uuid, foreign key) - References study_source_listings(id)
  - `sold_by` (text) - Team member who closed the sale (channing or antoine)
  - `sold_at` (timestamptz) - When the vehicle was marked as sold
  - `buy_price` (numeric) - Purchase price in euros
  - `sale_price` (numeric) - Selling price in euros
  - `created_at` (timestamptz) - When this record was created

  ## Constraints
  - Unique constraint on `listing_id` prevents double-selling the same vehicle
  - Foreign key uses RESTRICT to prevent accidental deletion of sold listings

  ## Security
  - RLS enabled
  - Full read/write access for authenticated users (internal tool)

  ## Notes
  - V1 scope: only basic pricing data
  - Future iterations will add: fees, reference numbers, advanced margin calculations
  - Margin calculation (sale - buy) is done in the UI layer
*/

-- Create sales table
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES study_source_listings(id) ON DELETE RESTRICT,
  sold_by text NOT NULL CHECK (sold_by IN ('channing', 'antoine')),
  sold_at timestamptz NOT NULL DEFAULT now(),
  buy_price numeric NOT NULL,
  sale_price numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Prevent double-selling
  CONSTRAINT unique_listing_sale UNIQUE (listing_id)
);

-- Enable RLS
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Allow all operations for authenticated users"
  ON sales
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create index for chronological queries
CREATE INDEX IF NOT EXISTS idx_sales_sold_at
  ON sales(sold_at DESC);