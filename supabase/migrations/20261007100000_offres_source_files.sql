/*
  # Offres : les fichiers fournisseur déposés sont GARDÉS (07/10, Channing :
  « quand on clique sur le nom d'un PDF, pouvoir afficher le PDF »)

  source_files = [{ name, path, size }] : chaque PDF (ou tableur) déposé est
  copié dans le bucket admin-documents (offres/…) et rouvert par URL signée.
  Additif, idempotent.
*/
alter table public.supplier_offers
  add column if not exists source_files jsonb not null default '[]'::jsonb;

select exists (select 1 from information_schema.columns where table_name = 'supplier_offers' and column_name = 'source_files') as tout_est_bon;
