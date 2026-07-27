-- Marge des ventes = COMMISSIONS HT du tableur (demande Channing 27/07).
-- Colonne dédiée, additive — les calculs de marge liront ce champ.
alter table public.transactions_admin
  add column if not exists commission_ht numeric;
