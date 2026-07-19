/*
  # Resolution type on campaign gap items

  Additive only. The resolution center lets the operator close a recorded gap
  in more ways than "corrigé" — notably "marché vide, URL valide" (the mapping
  is right, the market just has no cars for that year) and "ignoré". The
  column records WHICH way, so nothing is ever lost or ambiguous:

    corrected     → fixed via re-ingestion or manual mapping work
    empty_market  → URL/mapping validated by hand, market genuinely empty
    ignored       → not relevant, dismissed knowingly

  resolved_at (already present) keeps carrying WHEN.
*/

ALTER TABLE linkgen_campaign_items
  ADD COLUMN IF NOT EXISTS resolution text;
