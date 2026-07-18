/*
  # Mass-ingestion campaigns (mapping exploration at scale)

  Additive only. A campaign is a batch of auto-generated ingestion studies:
  criteria drawn from what ADA already knows (brands/models/fuels/trims per
  brand+model), projected onto sites where those mappings are NOT yet
  validated. Each item runs the exact same ingest→confirm→granular-retention
  pipeline as a manual ingestion — campaigns only automate the trigger.

  linkgen_campaigns       one row per launched campaign (config + live counters)
  linkgen_campaign_items  one row per study, written as the campaign progresses;
                          `outcome` classifies what we learned:
                            confirmed      → memory enriched/reinforced
                            taxonomy_gap   → brand/model rejected: site names differ (manual to-do)
                            enum_gap       → brand/model OK but fuel/gearbox/… rejected (site code unknown)
                            no_url         → generator could not build a URL for this site
                            insufficient   → sample < threshold, inconclusive
                            technical      → scrape blocked/empty — retry later, NOT a knowledge gap
*/

CREATE TABLE IF NOT EXISTS linkgen_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'running',       -- running | stopped | done
  total integer NOT NULL DEFAULT 0,
  done_count integer NOT NULL DEFAULT 0,
  confirmed_count integer NOT NULL DEFAULT 0,
  gap_count integer NOT NULL DEFAULT 0,          -- taxonomy_gap + enum_gap
  technical_count integer NOT NULL DEFAULT 0,
  config jsonb,                                  -- sites, reinforceShare, variantShare, plan (resume)
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_heartbeat timestamptz                     -- refreshed each item; stale = resumable
);

CREATE TABLE IF NOT EXISTS linkgen_campaign_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES linkgen_campaigns(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  site text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  criteria jsonb,                                -- full SearchCriteria attempted
  url text,                                      -- generated URL actually scraped
  kind text NOT NULL DEFAULT 'exploration',      -- exploration | reinforcement
  outcome text,                                  -- confirmed | taxonomy_gap | enum_gap | no_url | insufficient | technical
  confirmed_fields text[] DEFAULT '{}',
  rejected jsonb,                                -- [{field, declared, reason}]
  detail text,                                   -- human-readable verdict (e.g. '41× electric vs déclaré HYBRIDE')
  sample_size integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_campaign_items_campaign
  ON linkgen_campaign_items (campaign_id, seq);
CREATE INDEX IF NOT EXISTS idx_campaign_items_gaps
  ON linkgen_campaign_items (outcome, site);

ALTER TABLE linkgen_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkgen_campaign_items ENABLE ROW LEVEL SECURITY;

-- Same anon+authenticated pattern as the other linkgen tables.
CREATE POLICY "anon_select_campaigns"  ON linkgen_campaigns FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_campaigns"  ON linkgen_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_campaigns"  ON linkgen_campaigns FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_campaigns"  ON linkgen_campaigns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "anon_update_campaigns"  ON linkgen_campaigns FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_update_campaigns"  ON linkgen_campaigns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_campaign_items"  ON linkgen_campaign_items FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_campaign_items"  ON linkgen_campaign_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_insert_campaign_items"  ON linkgen_campaign_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_insert_campaign_items"  ON linkgen_campaign_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "anon_update_campaign_items"  ON linkgen_campaign_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_update_campaign_items"  ON linkgen_campaign_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Live progress on the campaigns tab.
ALTER PUBLICATION supabase_realtime ADD TABLE linkgen_campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE linkgen_campaign_items;
