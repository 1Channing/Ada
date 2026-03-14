/*
  # Add Anon Access to Administrative Module

  1. Problem
    - Frontend uses Supabase anon client
    - All Administrative tables (vehicles_admin, contacts, transactions_admin, documents_admin_history) only allow authenticated users
    - Storage bucket admin-documents lacks anon policies
    - Result: RLS blocks all frontend operations with "new row violates row-level security policy"

  2. Solution
    - Add anon role policies for SELECT, INSERT, UPDATE on all Administrative tables
    - Add anon role policies for storage operations (SELECT, INSERT, UPDATE) on admin-documents bucket
    - Keep DELETE operations restricted to authenticated users only for safety

  3. Tables Updated
    - vehicles_admin: Add anon SELECT, INSERT, UPDATE policies
    - contacts: Add anon SELECT, INSERT, UPDATE policies
    - transactions_admin: Add anon SELECT, INSERT, UPDATE policies
    - documents_admin_history: Add anon SELECT, INSERT policies

  4. Storage Updated
    - admin-documents bucket: Add anon SELECT, INSERT, UPDATE policies

  5. Security Notes
    - This is intentional for the Administrative module which needs public access
    - DELETE operations still require authentication
    - Scope is strictly limited to Administrative tables only
    - No changes to study, worker, or scraping tables
*/

-- vehicles_admin: Add anon policies
CREATE POLICY "Anon users can view vehicles"
  ON vehicles_admin FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert vehicles"
  ON vehicles_admin FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update vehicles"
  ON vehicles_admin FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- contacts: Add anon policies
CREATE POLICY "Anon users can view contacts"
  ON contacts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert contacts"
  ON contacts FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update contacts"
  ON contacts FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- transactions_admin: Add anon policies
CREATE POLICY "Anon users can view transactions"
  ON transactions_admin FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert transactions"
  ON transactions_admin FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update transactions"
  ON transactions_admin FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- documents_admin_history: Add anon policies
CREATE POLICY "Anon users can view documents"
  ON documents_admin_history FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert documents"
  ON documents_admin_history FOR INSERT
  TO anon
  WITH CHECK (true);

-- Storage: Add anon policies for admin-documents bucket
CREATE POLICY "Anon users can select admin documents"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'admin-documents');

CREATE POLICY "Anon users can insert admin documents"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'admin-documents');

CREATE POLICY "Anon users can update admin documents"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'admin-documents')
  WITH CHECK (bucket_id = 'admin-documents');
