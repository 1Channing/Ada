/*
  # Opportunity alert acknowledgements

  Additive only. The Market Intelligence "Opportunités à contrôler" card mines
  observations for cross-country price gaps; acknowledging one ("contrôlée")
  hides it while the gap stays within ±1000€ of the acknowledged delta —
  it resurfaces automatically if the market moves.
*/

CREATE TABLE IF NOT EXISTS market_opportunity_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  fuel text NOT NULL DEFAULT '',
  low_country text NOT NULL,
  high_country text NOT NULL,
  delta_eur numeric NOT NULL,
  acked_by text NOT NULL DEFAULT '',
  acked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_acks_key
  ON market_opportunity_acks (brand, model, fuel, low_country, high_country);

ALTER TABLE market_opportunity_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_opportunity_acks"  ON market_opportunity_acks FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_opportunity_acks"  ON market_opportunity_acks FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_opportunity_acks"  ON market_opportunity_acks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_opportunity_acks"  ON market_opportunity_acks FOR INSERT TO authenticated WITH CHECK (true);
