/*
  # Deals workflow: status, notes, commercial

  Additive only. Turns the admin module into a deals list: each transaction is
  a deal that stays 'en_cours' until closed ('cloturee'), carries free notes
  and the salesperson (commercial) who registered it.
*/

ALTER TABLE transactions_admin
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'en_cours',
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS commercial text;

CREATE INDEX IF NOT EXISTS idx_transactions_admin_status
  ON transactions_admin (status, created_at DESC);
