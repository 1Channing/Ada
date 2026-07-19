/*
  # Transaction reference (internal deal code)

  Additive only. Each sale carries a short human reference (e.g. "I63",
  "TGE789") the team uses to find a deal at a glance. Stored on the
  transaction row so documents and history can surface it.
*/

ALTER TABLE transactions_admin
  ADD COLUMN IF NOT EXISTS reference text;
