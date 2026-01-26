/*
  # Fix Negotiation Notes RLS Policies

  1. Security Changes
    - Enable RLS on negotiation_notes table
    - Remove any existing ambiguous policies
    - Add explicit SELECT policy for authenticated users
    - **Add explicit INSERT policy with WITH CHECK** (critical fix for 42501 error)
    - Add explicit UPDATE policy for authenticated users
    - Add explicit DELETE policy for authenticated users

  2. Important Notes
    - This fixes the 401/42501 error when adding notes
    - All policies allow authenticated users full access
    - INSERT policy includes WITH CHECK clause to allow row creation
*/

-- Ensure RLS is enabled
alter table public.negotiation_notes enable row level security;

-- Clean up any existing policies to avoid conflicts
drop policy if exists "Allow all operations for authenticated users" on public.negotiation_notes;
drop policy if exists "negotiation_notes_select" on public.negotiation_notes;
drop policy if exists "negotiation_notes_insert" on public.negotiation_notes;
drop policy if exists "negotiation_notes_update" on public.negotiation_notes;
drop policy if exists "negotiation_notes_delete" on public.negotiation_notes;

-- SELECT: Allow authenticated users to view all notes
create policy "negotiation_notes_select"
on public.negotiation_notes
for select
to authenticated
using (true);

-- INSERT: Allow authenticated users to create notes (CRITICAL FIX)
create policy "negotiation_notes_insert"
on public.negotiation_notes
for insert
to authenticated
with check (true);

-- UPDATE: Allow authenticated users to update notes
create policy "negotiation_notes_update"
on public.negotiation_notes
for update
to authenticated
using (true)
with check (true);

-- DELETE: Allow authenticated users to delete notes
create policy "negotiation_notes_delete"
on public.negotiation_notes
for delete
to authenticated
using (true);