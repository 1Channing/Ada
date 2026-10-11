/*
  # Offres fournisseur : colonnes de l'offre exportée (11/10, demande Channing :
  #   « pouvoir ajouter, modifier ou supprimer des colonnes présentes sur l'offre »)

  Une offre garde sa liste de colonnes (ordre, libellés, colonnes libres) pour
  l'Excel et le PDF. NULL = colonnes par défaut. Les valeurs des colonnes
  libres vivent dans chaque véhicule (vehicles[].custom), rien d'autre à créer.
  Sans ce SQL, l'écran prévient que le réglage des colonnes n'est pas gardé.
  À coller dans Supabase → SQL Editor. Idempotent.
*/
alter table public.supplier_offers add column if not exists export_columns jsonb;
select 'ok' as colonnes_export;
