-- Traitement des annonces du Workflow (demande Channing 28/07) : une annonce
-- « traitée » garde son motif — 'trop_chere' ou 'hors_criteres' — et reste
-- visible dans l'historique des résultats avec son badge. Additif.
alter table public.daily_search_hits
  add column if not exists resolution text;
