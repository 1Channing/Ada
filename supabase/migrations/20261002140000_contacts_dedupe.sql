/*
  # Fusion des contacts en doublon (02/10, constat Channing : ROUDIER LIONEL ×6,
  LE PAGE ×6, VERNAELDE ×5, PILON ×4, RAMON ×4…)

  Cause (mesurée) : 28 lignes de trop sur 65 contacts, toutes créées AVANT le
  26/09, chaque groupe dans la même minute et au contenu identique → la
  sauvegarde du dossier insérait un contact à chaque passage. Corrigé dans ADA
  le 26/09 (même identité → mise à jour, jamais d'insertion) ; aucun doublon
  créé depuis. Ce SQL nettoie l'historique.

  Règle : un groupe = même type, même nom (majuscules, espaces retirés aux
  bords), même téléphone, e-mail, SIREN, adresse, code postal, ville. Le
  survivant est le plus ancien. Les dossiers (transactions_admin, 6 colonnes)
  et les pièces (contact_documents) sont repointés vers lui AVANT la
  suppression. Un groupe dont le contenu diffère n'est PAS fusionné.

  Additif, idempotent : relancé sans doublon, il ne fait rien.
*/

drop table if exists contact_merge;
create temp table contact_merge as
with norm as (
  select id, created_at,
    upper(coalesce(type, '')) as t,
    upper(trim(coalesce(company_name, ''))) as cn,
    upper(trim(coalesce(first_name, ''))) as fn,
    upper(trim(coalesce(last_name, ''))) as ln,
    upper(trim(coalesce(phone, ''))) as ph,
    upper(trim(coalesce(email, ''))) as em,
    upper(trim(coalesce(siren, ''))) as si,
    upper(trim(coalesce(address_line1, ''))) as a1,
    upper(trim(coalesce(postal_code, ''))) as pc,
    upper(trim(coalesce(city, ''))) as ci
  from contacts
),
ranked as (
  select id,
    first_value(id) over (partition by t, cn, fn, ln, ph, em, si, a1, pc, ci order by created_at, id) as survivor_id
  from norm
  where cn <> '' or fn <> '' or ln <> ''
)
select id as dup_id, survivor_id from ranked where id <> survivor_id;

update transactions_admin x set seller_contact_id = m.survivor_id from contact_merge m where x.seller_contact_id = m.dup_id;
update transactions_admin x set seller_contact_id_2 = m.survivor_id from contact_merge m where x.seller_contact_id_2 = m.dup_id;
update transactions_admin x set buyer_contact_id = m.survivor_id from contact_merge m where x.buyer_contact_id = m.dup_id;
update transactions_admin x set buyer_contact_id_2 = m.survivor_id from contact_merge m where x.buyer_contact_id_2 = m.dup_id;
update transactions_admin x set supplier_contact_id = m.survivor_id from contact_merge m where x.supplier_contact_id = m.dup_id;
update transactions_admin x set client_contact_id = m.survivor_id from contact_merge m where x.client_contact_id = m.dup_id;
update contact_documents d set contact_id = m.survivor_id from contact_merge m where d.contact_id = m.dup_id;

delete from contacts c using contact_merge m where c.id = m.dup_id;
drop table if exists contact_merge;

-- Contrôle : plus aucun dossier ni pièce ne pointe vers une ligne supprimée,
-- et il ne reste aucun groupe identique.
select
  not exists (
    select 1 from transactions_admin x
    where (x.seller_contact_id is not null and not exists (select 1 from contacts c where c.id = x.seller_contact_id))
       or (x.buyer_contact_id is not null and not exists (select 1 from contacts c where c.id = x.buyer_contact_id))
       or (x.supplier_contact_id is not null and not exists (select 1 from contacts c where c.id = x.supplier_contact_id))
       or (x.client_contact_id is not null and not exists (select 1 from contacts c where c.id = x.client_contact_id))
  )
  and not exists (
    select 1 from contacts
    group by upper(coalesce(type, '')), upper(trim(coalesce(company_name, ''))), upper(trim(coalesce(first_name, ''))), upper(trim(coalesce(last_name, ''))),
             upper(trim(coalesce(phone, ''))), upper(trim(coalesce(email, ''))), upper(trim(coalesce(siren, ''))), upper(trim(coalesce(address_line1, ''))),
             upper(trim(coalesce(postal_code, ''))), upper(trim(coalesce(city, '')))
    having count(*) > 1
  ) as tout_est_bon;
