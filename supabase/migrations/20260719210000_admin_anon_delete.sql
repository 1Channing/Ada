/*
  # Allow anon delete on Administrative module

  Additive only. The 2026-03-14 migration deliberately restricted DELETE to
  the `authenticated` role "for safety", but the app talks to Supabase with
  the anon key (same as every other operation on these tables) and never
  authenticates a user. As a result, deleting a deal (or a contact) silently
  affected 0 rows under RLS instead of erroring — the UI action looked like
  a no-op.

  This grants the anon role DELETE on the same four Administrative tables
  that already grant it SELECT/INSERT/UPDATE, so the delete actions in the
  admin UI (deals list, contacts settings) actually take effect.
*/

CREATE POLICY "Anon users can delete transactions"
  ON transactions_admin FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Anon users can delete vehicles"
  ON vehicles_admin FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Anon users can delete contacts"
  ON contacts FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Anon users can delete documents"
  ON documents_admin_history FOR DELETE
  TO anon
  USING (true);
