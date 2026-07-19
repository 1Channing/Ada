/*
  # Year on opportunity acks

  Additive only. Opportunities are now computed at the brand|model|fuel|YEAR
  grain (both sides compare the same vintage), so a "Contrôlée" ack must carry
  the year too — a control on the 2022s must never hide an alert on the 2019s.
  Old year-less acks simply stop matching (their alerts reappear once, get
  re-controlled with the year attached).
*/

ALTER TABLE market_opportunity_acks
  ADD COLUMN IF NOT EXISTS year integer;
