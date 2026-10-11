/*
  # Offres fournisseur : paramètres de l'offre (11/10, constat Channing : « les
  #   prix de l'offre initiale sont en TTC et ADA affiche "notre HT" »)

  Prix du fichier HT / TTC, TVA du fournisseur, affichage de nos prix HT / TTC
  (avec notre TVA), langue de l'export, pied de page. NULL = réglages par défaut.
  Sans ce SQL, l'écran prévient que les paramètres ne sont pas gardés.
  À coller dans Supabase → SQL Editor. Idempotent.
*/
alter table public.supplier_offers add column if not exists settings jsonb;
select 'ok' as parametres_offre;
