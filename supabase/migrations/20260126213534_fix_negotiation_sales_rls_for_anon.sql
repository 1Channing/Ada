/*
  # Fix RLS policies for negotiation_notes and sales tables
  
  ## Problem
  Both tables have RLS enabled but policies only allow `authenticated` role.
  UI fails with 401/42501 when anonymous users try to insert/update.
  No explicit table privileges (GRANTs) exist for either role.
  
  ## Changes
  
  ### negotiation_notes table
  - Drop existing policies (authenticated-only)
  - Create new policies for `anon` role (full access)
  - Create new policies for `authenticated` role (full access)
  - Grant SELECT, INSERT, UPDATE, DELETE to both roles
  
  ### sales table
  - Drop existing policy (authenticated-only)
  - Create new policies for `anon` role (full access)
  - Create new policies for `authenticated` role (full access)
  - Grant SELECT, INSERT, UPDATE, DELETE to both roles
  
  ## Security Note
  This is an internal tool where all users need full access to notes and sales data.
*/

-- =====================================================
-- negotiation_notes table
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "negotiation_notes_select" ON public.negotiation_notes;
DROP POLICY IF EXISTS "negotiation_notes_insert" ON public.negotiation_notes;
DROP POLICY IF EXISTS "negotiation_notes_update" ON public.negotiation_notes;
DROP POLICY IF EXISTS "negotiation_notes_delete" ON public.negotiation_notes;

-- Create policies for anon role
CREATE POLICY "anon_all_negotiation_notes"
ON public.negotiation_notes
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Create policies for authenticated role
CREATE POLICY "auth_all_negotiation_notes"
ON public.negotiation_notes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Grant table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.negotiation_notes TO anon, authenticated;

-- =====================================================
-- sales table
-- =====================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.sales;

-- Create policies for anon role
CREATE POLICY "anon_all_sales"
ON public.sales
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Create policies for authenticated role
CREATE POLICY "auth_all_sales"
ON public.sales
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Grant table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;
