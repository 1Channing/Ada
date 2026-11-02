-- ═══════════════════════════════════════════════════════════════════════════
-- PUISSANCE DU STOCK RELEVÉ (02/11/2026) — demande Channing : « regarde si
-- sur les vitrines nous avons les puissances, et fais les liens entre
-- puissances équivalentes ». Colonne power_ch (chevaux) sur
-- network_stock_vehicles : remplie par le worker quand le site la donne
-- (Kamux kW, Autodata PS/kW, dvnl) ou qu'elle se lit dans le titre
-- (« 145 AT8 », « 132kW », « 150 pk »). Le comparateur de la carte s'en sert
-- quand elle est connue des deux côtés. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.network_stock_vehicles add column if not exists power_ch integer;

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'network_stock_vehicles' and column_name = 'power_ch'
) as tout_est_bon;
