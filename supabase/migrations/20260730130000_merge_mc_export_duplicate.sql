-- ════════════════════════════════════════════════════════════════════════════
-- FUSION DU DOUBLON MC-EXPORT  (à appliquer à la main dans Supabase)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONSTAT (30/07/2026) : deux fiches portent le SIREN 93033811600013, avec la
-- même raison sociale, la même adresse et le même SIREN. Elles ne diffèrent que
-- par :
--   • fiche A  297e9055-f0ef-4915-ae79-bb5400c85c4f  (15/03) type='seller'
--       → référencée 9× : seller_contact_id ×7, buyer_contact_id ×2
--   • fiche B  62a4fae1-e232-4120-a0e2-3dc7fc2e29c2  (08/04) type='buyer'
--       → référencée 9× : supplier_contact_id ×7, client_contact_id ×2
--       → porte birth_date '1999-01-01' (valeur BIDON : une société n'a pas de
--         date de naissance) et une ville avec une espace parasite.
--
-- Les deux sont donc utilisées SIMULTANÉMENT dans les mêmes dossiers, sur des
-- emplacements complémentaires : A dans le couple vendeur/acheteur du sens
-- courant, B dans le couple fournisseur/client persistant. Aucune n'est
-- orpheline — d'où le repointage AVANT suppression.
--
-- FICHE CONSERVÉE : A. Elle est plus propre (pas de date bidon, ville sans
-- espace parasite) et c'est celle que le code élit désormais (la plus ancienne,
-- tri explicite ajouté dans Administrative.tsx — sans quoi `limit(1)` renvoyait
-- l'une OU l'autre selon le plan d'exécution).
--
-- SANS EFFET SUR LES DOCUMENTS : les deux fiches portent une identité
-- identique (raison sociale, adresse, SIREN), donc tout dossier repointé décrit
-- exactement la même société.
--
-- Transaction unique : en cas de souci, rien n'est appliqué.

begin;

-- 1) Repointer les références de B vers A.
update transactions_admin set supplier_contact_id = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where supplier_contact_id = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';
update transactions_admin set client_contact_id   = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where client_contact_id   = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';
-- Emplacements où B n'apparaît pas aujourd'hui, traités par sécurité :
update transactions_admin set seller_contact_id   = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where seller_contact_id   = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';
update transactions_admin set seller_contact_id_2 = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where seller_contact_id_2 = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';
update transactions_admin set buyer_contact_id    = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where buyer_contact_id    = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';
update transactions_admin set buyer_contact_id_2  = '297e9055-f0ef-4915-ae79-bb5400c85c4f'
  where buyer_contact_id_2  = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';

-- 2) Assainir la fiche conservée : 'company' dit ce qu'elle est (ni vendeur ni
--    acheteur — MC Export est les deux selon le sens), et la ville est nettoyée.
update contacts
   set type = 'company',
       city = trim(city),
       birth_date = null           -- une société n'a pas de date de naissance
 where id = '297e9055-f0ef-4915-ae79-bb5400c85c4f';

-- 3) VÉRIFICATION AVANT SUPPRESSION — doit renvoyer 0.
--    Si ce n'est pas 0, une colonne de référence a été oubliée : faire
--    `rollback;` et me le signaler plutôt que de forcer.
do $$
declare restants int;
begin
  select count(*) into restants from transactions_admin
   where '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2' in (
     coalesce(seller_contact_id::text, ''), coalesce(seller_contact_id_2::text, ''),
     coalesce(buyer_contact_id::text, ''),  coalesce(buyer_contact_id_2::text, ''),
     coalesce(supplier_contact_id::text, ''), coalesce(client_contact_id::text, ''),
     coalesce(pickup_contact::text, '')
   );
  if restants > 0 then
    raise exception 'Fusion interrompue : % dossier(s) référencent encore la fiche B', restants;
  end if;
end $$;

-- 4) Supprimer le doublon.
delete from contacts where id = '62a4fae1-e232-4120-a0e2-3dc7fc2e29c2';

commit;

-- ── Contrôle après application (doit renvoyer UNE seule ligne) ───────────────
-- select id, type, company_name, city, birth_date, siren
--   from contacts where siren = '93033811600013';
