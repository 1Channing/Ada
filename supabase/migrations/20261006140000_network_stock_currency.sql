/*
  # Devise du stock vitrine (06/10, Channing : « adapte cette vitrine ainsi
  que le taux de change » — raevhede.dk, prix en couronnes danoises)

  Les prix d'une vitrine sont gardés DANS LA DEVISE DU SITE (price, price_prev,
  price_first, price_history) : un prix qui ne bouge pas ne doit pas devenir
  « prix bougé » parce que le taux de change a varié. La conversion en euros
  se fait à l'affichage, au taux BCE du jour (app_config « fx_rates », tenu à
  jour par le worker).

  Additif, idempotent.
*/

alter table public.network_stock_vehicles add column if not exists currency text not null default 'EUR';

select exists (select 1 from information_schema.columns where table_name = 'network_stock_vehicles' and column_name = 'currency') as tout_est_bon;
