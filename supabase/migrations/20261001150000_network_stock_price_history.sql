/*
  # Stock des concessions : mouvements de prix par véhicule (01/10 soir,
  demande Channing : « enregistrer pour chaque véhicule les baisses, pour
  voir quand ils vendent s'ils ont dû baisser ou non »)

  price_first   = premier prix vu par ADA
  price_history = chaque prix daté, du premier au courant :
                  [{"at": "...", "price": 31500}, {"at": "...", "price": 29900}]
  Le worker ajoute une entrée à chaque changement ; la fenêtre et l'outil
  MCP en tirent les baisses (nombre, total, %) et, à la disparition, le
  bilan « vendue après n baisses ».

  Additif, idempotent. Reconstruit l'historique des lignes déjà relevées
  depuis price_prev / price (sans date exacte du changement : première vue).
*/

alter table network_stock_vehicles add column if not exists price_first numeric;
alter table network_stock_vehicles add column if not exists price_history jsonb;

update network_stock_vehicles
   set price_first = coalesce(price_first, case when price_prev > 0 then price_prev else price end),
       price_history = coalesce(price_history,
         (case when price_prev > 0 then jsonb_build_array(jsonb_build_object('at', first_seen_at, 'price', price_prev)) else '[]'::jsonb end)
         || (case when price > 0 then jsonb_build_array(jsonb_build_object('at', first_seen_at, 'price', price)) else '[]'::jsonb end))
 where price_history is null;

select 'ok' as tout_est_bon;
