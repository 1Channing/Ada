/*
  # Create Administrative Module

  This migration creates a new administrative data layer for managing contacts,
  vehicles, transactions, and document history. This module is completely isolated
  from the market analysis and scraping systems.

  ## 1. New Tables

  ### `contacts`
  Stores contact information for buyers and sellers involved in transactions.
  - `id` (uuid, primary key) - Unique identifier
  - `created_at` (timestamptz) - Record creation timestamp
  - `type` (text) - Contact type: buyer, seller, or both
  - `company_name` (text) - Company name if applicable
  - `first_name` (text) - First name
  - `last_name` (text) - Last name
  - `birth_date` (date) - Date of birth
  - `birth_place` (text) - Place of birth
  - `siren` (text) - French business registration number
  - `address_line1` (text) - Primary address line
  - `address_line2` (text) - Secondary address line
  - `postal_code` (text) - Postal code
  - `city` (text) - City
  - `country` (text) - Country code (defaults to 'FR')
  - `phone` (text) - Phone number
  - `email` (text) - Email address
  - `notes` (text) - Additional notes

  ### `vehicles_admin`
  Stores vehicle information for administrative purposes.
  - `id` (uuid, primary key) - Unique identifier
  - `created_at` (timestamptz) - Record creation timestamp
  - `plate_number` (text) - Vehicle license plate number
  - `vin` (text) - Vehicle identification number
  - `brand` (text) - Vehicle manufacturer brand
  - `model` (text) - Vehicle model
  - `commercial_name` (text) - Commercial name/trim
  - `type_variant_version` (text) - Type, variant, and version details
  - `national_type` (text) - National type classification
  - `first_registration_date` (date) - Date of first registration
  - `mileage` (integer) - Current mileage
  - `registration_certificate_present` (boolean) - Whether certificate is available
  - `registration_certificate_number` (text) - Certificate number
  - `known_defects` (text) - Known defects or issues

  ### `transactions_admin`
  Stores transaction records linking vehicles, contacts, and transaction details.
  - `id` (uuid, primary key) - Unique identifier
  - `created_at` (timestamptz) - Record creation timestamp
  - `transaction_type` (text) - Type: purchase or sale
  - `vehicle_id` (uuid) - Reference to vehicle
  - `seller_contact_id` (uuid) - Primary seller contact
  - `seller_contact_id_2` (uuid, nullable) - Secondary seller contact
  - `buyer_contact_id` (uuid) - Primary buyer contact
  - `buyer_contact_id_2` (uuid, nullable) - Secondary buyer contact
  - `transaction_price` (numeric) - Transaction amount
  - `transaction_date` (date) - Date of transaction
  - `transaction_time` (time) - Time of transaction
  - `pickup_location` (text) - Where vehicle will be picked up
  - `pickup_contact` (text) - Contact person for pickup
  - `pickup_datetime` (timestamptz) - Pickup date and time
  - `destination` (text) - Destination location
  - `transporter` (text) - Transporter company/person

  ### `documents_admin_history`
  Stores document history with automatic 30-day retention policy.
  - `id` (uuid, primary key) - Unique identifier
  - `created_at` (timestamptz) - Record creation timestamp
  - `transaction_id` (uuid) - Reference to transaction
  - `document_type` (text) - Type of document
  - `pdf_url` (text) - URL to PDF document

  ## 2. Security

  All tables have Row Level Security (RLS) enabled with policies for authenticated users:
  - `contacts`: Full CRUD access for authenticated users
  - `vehicles_admin`: Full CRUD access for authenticated users
  - `transactions_admin`: Full CRUD access for authenticated users
  - `documents_admin_history`: Full CRUD access for authenticated users

  ## 3. Important Notes

  - This module is completely isolated from the market analysis and scraping systems
  - Foreign key constraints ensure referential integrity
  - Documents are automatically cleaned up after 30 days (handled by separate edge function)
  - All timestamps use timestamptz for proper timezone handling
  - Default values are provided where appropriate for data integrity
*/

-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  type text,
  company_name text,
  first_name text,
  last_name text,
  birth_date date,
  birth_place text,
  siren text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text DEFAULT 'FR',
  phone text,
  email text,
  notes text
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete contacts"
  ON contacts FOR DELETE
  TO authenticated
  USING (true);

-- Create vehicles_admin table
CREATE TABLE IF NOT EXISTS vehicles_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  plate_number text,
  vin text,
  brand text,
  model text,
  commercial_name text,
  type_variant_version text,
  national_type text,
  first_registration_date date,
  mileage integer,
  registration_certificate_present boolean DEFAULT false,
  registration_certificate_number text,
  known_defects text
);

ALTER TABLE vehicles_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vehicles"
  ON vehicles_admin FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert vehicles"
  ON vehicles_admin FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update vehicles"
  ON vehicles_admin FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete vehicles"
  ON vehicles_admin FOR DELETE
  TO authenticated
  USING (true);

-- Create transactions_admin table
CREATE TABLE IF NOT EXISTS transactions_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  transaction_type text,
  vehicle_id uuid REFERENCES vehicles_admin(id) ON DELETE CASCADE,
  seller_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  seller_contact_id_2 uuid REFERENCES contacts(id) ON DELETE SET NULL,
  buyer_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  buyer_contact_id_2 uuid REFERENCES contacts(id) ON DELETE SET NULL,
  transaction_price numeric,
  transaction_date date,
  transaction_time time,
  pickup_location text,
  pickup_contact text,
  pickup_datetime timestamptz,
  destination text,
  transporter text
);

ALTER TABLE transactions_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view transactions"
  ON transactions_admin FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert transactions"
  ON transactions_admin FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update transactions"
  ON transactions_admin FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete transactions"
  ON transactions_admin FOR DELETE
  TO authenticated
  USING (true);

-- Create documents_admin_history table
CREATE TABLE IF NOT EXISTS documents_admin_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  transaction_id uuid REFERENCES transactions_admin(id) ON DELETE CASCADE,
  document_type text,
  pdf_url text
);

ALTER TABLE documents_admin_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view documents"
  ON documents_admin_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert documents"
  ON documents_admin_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update documents"
  ON documents_admin_history FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete documents"
  ON documents_admin_history FOR DELETE
  TO authenticated
  USING (true);

-- Create index for efficient document cleanup queries
CREATE INDEX IF NOT EXISTS idx_documents_admin_history_created_at 
  ON documents_admin_history(created_at);

-- Create index for transaction lookups
CREATE INDEX IF NOT EXISTS idx_transactions_admin_vehicle_id 
  ON transactions_admin(vehicle_id);

-- Create indexes for contact references in transactions
CREATE INDEX IF NOT EXISTS idx_transactions_admin_seller_contact_id 
  ON transactions_admin(seller_contact_id);

CREATE INDEX IF NOT EXISTS idx_transactions_admin_buyer_contact_id 
  ON transactions_admin(buyer_contact_id);