/*
  # TVA récupérable par dossier (30/09, constat Channing : « je ne vois pas
  # les petites * à côté de mon nom qui confirment la TVA »)

  L'astérisque n'existait que dans le libellé véhicule du tableur, affiché
  seulement quand le dossier n'avait pas de fiche véhicule. Désormais c'est
  une donnée du dossier : `vat_recoverable`, posée par la synchro du tableur
  (« * » en fin de véhicule) et modifiable dans le dossier ; la liste des
  ventes l'affiche en badge quel que soit l'origine du nom du véhicule.

  Additif, idempotent ; reprise des dossiers déjà synchronisés dont la
  ligne « Véhicule : … * » porte l'astérisque.
*/

alter table transactions_admin add column if not exists vat_recoverable boolean;

update transactions_admin
   set vat_recoverable = true
 where vat_recoverable is distinct from true
   and notes ~ 'Véhicule : [^\n]*\*';

select count(*) filter (where vat_recoverable) as dossiers_tva_recuperable from transactions_admin;

select 'ok' as tout_est_bon;
