/*
  # Deal pricing: purchase / sale / fees

  Additive only. Each deal tracks the buy price, the sell price and the fees,
  so the dashboard can show chiffre d'affaires (sum of sale prices) and margin
  (sale − purchase − fees), in progress and historically.
*/

ALTER TABLE transactions_admin
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS sale_price numeric,
  ADD COLUMN IF NOT EXISTS fees numeric;
