/*
  # Lieu de signature des cessions, distinct du lieu d'enlèvement (26/09, demande Channing)

  Constat : `pickup_location` servait à la fois de lieu d'ENLÈVEMENT côté achat
  (« TE RÉCUPÈRE À LA GARE DE VANNES », « GARE DE BIARRITZ », « VD2L »…) et de
  « Fait à » du certificat de cession côté vente. Un dossier basculé achat →
  vente imprimait la consigne d'enlèvement comme lieu de signature — plusieurs
  cessions faussées.

  Désormais :
  - `signature_location` = lieu « Fait à » du certificat de cession et de la
    déclaration d'achat, saisi dans la section « Date et lieu de la cession »
    du dossier, par défaut « Les Ponts-de-Cé » (siège) ;
  - `pickup_location` ne nourrit plus que la fiche d'enlèvement.

  Additif, idempotent. Sans cette colonne, le front enregistre sans elle et
  les documents impriment « Les Ponts-de-Cé ».
*/

alter table transactions_admin add column if not exists signature_location text;

select 'ok' as tout_est_bon;
