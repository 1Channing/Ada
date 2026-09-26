/*
  # Nom du PDF photos d'une négociation (26/09, demande Channing)

  Le PDF photos portait le titre de la ligne. On veut un nom LIBRE pour le
  PDF (« Toyota Corolla GR Sport 2023 ») sans renommer la négociation.
  Additive, idempotente. Sans cette colonne, la modale garde le nom sur le
  navigateur (repli local).
*/
alter table negotiations add column if not exists pdf_title text;
select 'ok' as tout_est_bon;
