/*
  # Data quality columns + monthly re-scan opt-outs

  Additive only.

  1. market_listing_observations gains the attributes the parsers already see
     but never stored — gearbox, doors, seats, color, seller type — plus
     price_type: Bilbasen serves "WithoutTax"/engros prices (a CLA at 2 375 kr
     in production logs) that silently poisoned medians. Non-retail rows are
     now excluded from stats at write time; price_type documents what was kept.

  2. market_rescan_optouts — markets the operator declared "pas intéressé" in
     the notification center: those segments never show up in the monthly
     re-scan reminders again. Shared by the whole team (not per-browser).
*/

ALTER TABLE market_listing_observations
  ADD COLUMN IF NOT EXISTS gearbox text,
  ADD COLUMN IF NOT EXISTS doors integer,
  ADD COLUMN IF NOT EXISTS seats integer,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS seller_type text,
  ADD COLUMN IF NOT EXISTS price_type text;

CREATE TABLE IF NOT EXISTS market_rescan_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site text NOT NULL,
  country text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  fuel text NOT NULL DEFAULT '',
  trim text NOT NULL DEFAULT '',
  opted_out_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rescan_optouts_segment
  ON market_rescan_optouts (site, brand, model, fuel, trim);

ALTER TABLE market_rescan_optouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_rescan_optouts" ON market_rescan_optouts FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_rescan_optouts" ON market_rescan_optouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_rescan_optouts" ON market_rescan_optouts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_rescan_optouts" ON market_rescan_optouts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "anon_delete_rescan_optouts" ON market_rescan_optouts FOR DELETE TO anon USING (true);
CREATE POLICY "auth_delete_rescan_optouts" ON market_rescan_optouts FOR DELETE TO authenticated USING (true);
