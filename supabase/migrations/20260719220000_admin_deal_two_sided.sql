/*
  # Two-sided deal: supplier + client on one dossier

  Additive only. A deal is one car with two external counterparties that stay
  put when the operator flips between the achat side and the vente side:
    - supplier_contact_id : the party MC Export BUYS from (fournisseur)
    - client_contact_id   : the party MC Export SELLS to (client)

  transaction_type stays the "active side" (purchase/sale); seller_contact_id /
  buyer_contact_id keep reflecting the active side so document generation is
  unchanged. These two columns let one dossier serve both directions instead of
  creating two transactions for the same car.
*/

ALTER TABLE transactions_admin
  ADD COLUMN IF NOT EXISTS supplier_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
