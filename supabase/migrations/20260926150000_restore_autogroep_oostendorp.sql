/*
  # Réparation : fiche « AUTOGROEP OOSTENDORP » réécrite en « van Ekris » (26/09, constat Channing)

  Preuve (lecture de la base, 26/09 13 h) :
  - la fiche a5711c59 (créée le 23/07 09:32, à la seconde où Antoine a
    enregistré YC507, vente à Oostendorp d'après le tableur) s'appelle
    aujourd'hui « Automobielbedrijf van Ekris Mijdrecht B.V » ;
  - 41 dossiers pointent sur elle ; 30 d'entre eux portent en notes
    « Client : AUTOGROEP OOSTENDORP » (bloc [Tableur]), 10 n'ont pas de
    client dans le tableur, 1 seul (C070, Corolla du 16/09) est une vente à
    van Ekris ;
  - la synchro du tableur trouvait encore une fiche « AUTOGROEP OOSTENDORP »
    le 18/09 08:40 (YC236 « 1 client rattaché ») : la réécriture est
    postérieure. Aucune suppression : la clé étrangère est ON DELETE SET
    NULL, une suppression aurait laissé des dossiers sans acheteur.

  Cause (classe, corrigée dans le front le 26/09) : le brouillon
  re-sélectionnait la fiche du dossier précédent (Oostendorp) ; en saisissant
  la vente van Ekris par-dessus, l'enregistrement mettait à jour LA FICHE
  SÉLECTIONNÉE avec le nouveau nom et la nouvelle adresse.

  Réparation, additive et idempotente :
  1. recrée la fiche « AUTOGROEP OOSTENDORP » (NL, professionnel) si elle
     n'existe plus — l'adresse d'origine est perdue, à ressaisir ;
  2. rattache à cette fiche tous les dossiers qui pointaient sur van Ekris,
     SAUF C070 (la vraie vente van Ekris). La fiche van Ekris garde son nom
     et son adresse actuels (Industrieweg 48, 3641RM Mijdrecht).
*/

do $$
declare
  v_ekris uuid := 'a5711c59-62ef-4100-bafb-f7a245b9852d';
  v_oost  uuid;
  n_buyer int := 0; n_buyer2 int := 0; n_client int := 0;
begin
  select id into v_oost from contacts
   where upper(coalesce(company_name, '')) like '%OOSTENDORP%'
   order by created_at asc limit 1;

  if v_oost is null then
    insert into contacts (type, company_name, country, category)
    values ('buyer', 'AUTOGROEP OOSTENDORP', 'NL', 'pro')
    returning id into v_oost;
    raise notice 'Fiche AUTOGROEP OOSTENDORP recréée : %', v_oost;
  else
    raise notice 'Fiche AUTOGROEP OOSTENDORP déjà présente : %', v_oost;
  end if;

  update transactions_admin set buyer_contact_id = v_oost
   where buyer_contact_id = v_ekris and coalesce(upper(reference), '') <> 'C070';
  get diagnostics n_buyer = row_count;

  update transactions_admin set buyer_contact_id_2 = v_oost
   where buyer_contact_id_2 = v_ekris and coalesce(upper(reference), '') <> 'C070';
  get diagnostics n_buyer2 = row_count;

  update transactions_admin set client_contact_id = v_oost
   where client_contact_id = v_ekris and coalesce(upper(reference), '') <> 'C070';
  get diagnostics n_client = row_count;

  raise notice 'Dossiers rattachés à Oostendorp : acheteur %, co-acheteur %, client %', n_buyer, n_buyer2, n_client;
end $$;

select 'ok' as tout_est_bon;
