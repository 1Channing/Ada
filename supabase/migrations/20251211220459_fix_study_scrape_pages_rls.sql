/*
  # Fix Study Scrape Pages RLS Policies

  1. Changes
    - Drop permissive INSERT policy (was causing 401 errors)
    - Keep SELECT policy for authenticated users
    - All writes now go through Edge Function with service role (bypasses RLS)

  2. Purpose
    - Persistence is server-side only (via persist_scrape_page Edge Function)
    - Client-side has read-only access for analytics
    - No more 401/42501 errors during pagination

  3. Security
    - RLS remains enabled
    - SELECT allowed for authenticated users
    - INSERT/UPDATE/DELETE handled server-side with proper validation
*/

-- Drop the permissive insert policy
drop policy if exists "Users can insert own scrape pages" on study_scrape_pages;

-- Ensure the select policy exists (it should already be there)
drop policy if exists "Users can read own scrape pages" on study_scrape_pages;

create policy "Users can read scrape pages"
  on study_scrape_pages for select
  to authenticated
  using (true);
