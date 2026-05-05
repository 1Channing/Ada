/*
  # Add Scout validation columns to linkgen_mapping_memory

  ## Changes
  - Add `validated_url` (text): the best URL confirmed by Scout after real listing check
  - Add `scout_score` (numeric): the score (0-100) obtained at last Scout validation
  - Add `tested_hypotheses` (jsonb): array of correction hypotheses tested during Scout check, each with url/reason/score/status

  ## Notes
  - All new columns are nullable with safe defaults
  - Existing rows are unaffected
  - validated_url is separate from source_url (source_url = CSV input, validated_url = Scout-confirmed)
  - scout_score uses 0-100 scale (new system); confidence remains 0-1 (old CSV scale)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'linkgen_mapping_memory' AND column_name = 'validated_url'
  ) THEN
    ALTER TABLE linkgen_mapping_memory ADD COLUMN validated_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'linkgen_mapping_memory' AND column_name = 'scout_score'
  ) THEN
    ALTER TABLE linkgen_mapping_memory ADD COLUMN scout_score numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'linkgen_mapping_memory' AND column_name = 'tested_hypotheses'
  ) THEN
    ALTER TABLE linkgen_mapping_memory ADD COLUMN tested_hypotheses jsonb;
  END IF;
END $$;
