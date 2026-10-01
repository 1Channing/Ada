/*
  # Stock des concessions : statut d'annonce, jamais « 0 € » (01/10)

  Constat Channing sur Auto Smeeing : des voitures « Op aanvraag » (prix sur
  demande) / « Binnenkort verwacht » (bientôt disponible) sortaient à 0 € dans
  le relevé. Un prix absent n'est pas un prix : price devient null et une
  colonne `status` dit pourquoi, sur tous les fournisseurs :
    price_on_request · expected · reserved · sold (null = en vente).

  Additif, idempotent. Les 0 € déjà relevés passent à null + sur demande.
*/

alter table network_stock_vehicles add column if not exists status text;

update network_stock_vehicles
   set price = null, status = coalesce(status, 'price_on_request')
 where price is not null and price <= 0;

update network_stock_vehicles
   set price_prev = null
 where price_prev is not null and price_prev <= 0;

select 'ok' as tout_est_bon;
