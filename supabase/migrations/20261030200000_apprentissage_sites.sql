/*
  # Apprentissage des sites (30/10, Channing : « cocher les critères sur les sites directement et ensuite
    d'ingérer les URLs, et pas seulement les marques et modèles, mais également tous les filtres qu'on ne
    connaîtrait pas […] Il est important que nous ne polluons pas nos taxonomies, elles doivent être
    parfaites. Il est également important que ce soit automatisé »).

  1. linkgen_learning_items : la FILE. Une ligne par chose qu'ADA ne sait pas écrire sur un site — un modèle
     (site, marque, modèle) ou un filtre (site, critère, valeur) — notée automatiquement quand une étude, une
     offre ou une recherche du jour la rencontre (linkgen_note_gap). Claude (extension Chrome, sur le Mac de
     Channing) coche la chose sur le site depuis la page de départ (start_url) et propose l'adresse obtenue ;
     le worker la contrôle ; un administrateur valide ou refuse.
  2. linkgen_learned_rules : ce qui est VALIDÉ, et seulement ça. Quarantaine stricte : rien n'entre ici sans
     le clic d'un administrateur (linkgen_learning_decide), jamais deux règles actives pour le même cas,
     jamais après un contrôle en échec. Retirable à tout moment (linkgen_learned_rule_retire).
  3. Droits : la file se lit par les comptes MC Export ; les règles par tous les comptes (elles servent à
     construire les adresses) ; toute écriture passe par les fonctions ci-dessous ou le worker (service-role).

  Additif, idempotent : à coller tel quel dans Supabase (SQL Editor). Dernière ligne : « tout_est_bon ».
*/

-- Kilométrage minimum des études quotidiennes (Channing : « on sait faire kilométrage maximum, mais il faut le
-- kilométrage minimum également ») : critère de recherche + filtre dur sur les annonces, comme mileage_max.
alter table public.daily_searches add column if not exists mileage_min integer;

create table if not exists public.linkgen_learning_items (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind text not null check (kind in ('modele', 'filtre')),
  site text not null,
  brand text not null default '',
  model text not null default '',
  criterion text not null default '',
  value text not null default '',
  hits integer not null default 1,
  sources text[] not null default '{}',
  priority integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  start_url text,
  status text not null default 'a_chercher'
    check (status in ('a_chercher', 'proposee', 'a_valider', 'validee', 'absente', 'suspendue', 'resolue', 'ignoree')),
  proposed_url text,
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz,
  absent_note text,
  learned jsonb,
  check_result jsonb,
  verify_url text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists linkgen_learning_items_queue on public.linkgen_learning_items (status, priority desc, hits desc);

create table if not exists public.linkgen_learned_rules (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  kind text not null check (kind in ('modele', 'filtre')),
  brand_key text not null default '',
  model_key text not null default '',
  brand text not null default '',
  model text not null default '',
  criterion text not null default '',
  value_key text not null default '',
  value text not null default '',
  rule jsonb not null,
  status text not null default 'active' check (status in ('active', 'suspendue', 'retiree')),
  item_id uuid references public.linkgen_learning_items(id) on delete set null,
  proof_url text,
  verify_url text,
  check_result jsonb,
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz not null default now(),
  fail_count integer not null default 0,
  last_check_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  retired_at timestamptz,
  retire_note text
);
create unique index if not exists linkgen_learned_rules_one_active
  on public.linkgen_learned_rules (site, kind, brand_key, model_key, criterion, value_key) where status = 'active';
create index if not exists linkgen_learned_rules_site on public.linkgen_learned_rules (site, status);

alter table public.linkgen_learning_items enable row level security;
alter table public.linkgen_learned_rules enable row level security;
drop policy if exists learning_items_read on public.linkgen_learning_items;
create policy learning_items_read on public.linkgen_learning_items for select to authenticated using (public.ada_is_mc_export());
drop policy if exists learned_rules_read on public.linkgen_learned_rules;
create policy learned_rules_read on public.linkgen_learned_rules for select to authenticated using (true);
revoke all on public.linkgen_learning_items, public.linkgen_learned_rules from anon;
grant select on public.linkgen_learning_items, public.linkgen_learned_rules to authenticated;

-- ─── Noter une lacune (générateur de liens, navigateur ou worker) ──────────────────────────────────
create or replace function public.linkgen_note_gap(
  p_key text, p_kind text, p_site text, p_brand text, p_model text, p_criterion text, p_value text, p_source text, p_start_url text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prio integer := case p_source when 'offre' then 3 when 'etude' then 2 when 'recherche' then 1 else 0 end;
begin
  if not (public.ada_is_mc_export() or coalesce(auth.role(), '') = 'service_role') then return; end if;
  if coalesce(p_kind, '') not in ('modele', 'filtre') or coalesce(p_key, '') = '' or length(p_key) > 300
     or coalesce(p_site, '') = '' or length(coalesce(p_start_url, '')) > 2000 then
    return;
  end if;
  insert into public.linkgen_learning_items as i (key, kind, site, brand, model, criterion, value, sources, priority, start_url)
  values (p_key, p_kind, upper(p_site), left(coalesce(p_brand, ''), 80), left(coalesce(p_model, ''), 120),
          left(coalesce(p_criterion, ''), 40), left(coalesce(p_value, ''), 80),
          case when coalesce(p_source, '') = '' then '{}'::text[] else array[left(p_source, 20)] end, v_prio,
          nullif(p_start_url, ''))
  on conflict (key) do update set
    hits = i.hits + 1,
    last_seen_at = now(),
    sources = case when coalesce(p_source, '') = '' or left(p_source, 20) = any(i.sources) then i.sources else i.sources || left(p_source, 20) end,
    priority = greatest(i.priority, v_prio),
    -- La page de départ suit l'adaptateur tant que la ligne attend Claude.
    start_url = case when i.status = 'a_chercher' and coalesce(p_start_url, '') <> '' then p_start_url else i.start_url end,
    -- Une lacune refermée automatiquement qui revient redevient à chercher ; les autres états ne bougent jamais ici.
    status = case when i.status = 'resolue' then 'a_chercher' else i.status end,
    updated_at = now();
end;
$$;

-- ─── Proposer une adresse (Claude, ou toute personne MC Export) ────────────────────────────────────
create or replace function public.linkgen_learning_propose(p_id uuid, p_url text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.ada_is_mc_export() then raise exception 'Réservé aux comptes MC Export'; end if;
  if coalesce(p_url, '') !~* '^https://[^ ]+$' or length(p_url) > 2000 then
    raise exception 'Adresse invalide : elle doit commencer par https:// (sans espace)';
  end if;
  update public.linkgen_learning_items
     set status = 'proposee', proposed_url = trim(p_url), proposed_by = auth.uid(), proposed_at = now(),
         absent_note = null, learned = null, check_result = null, verify_url = null, updated_at = now()
   where id = p_id and status = 'a_chercher';
  if not found then raise exception 'Ligne introuvable ou déjà proposée'; end if;
end;
$$;

-- ─── « Absent du site » : la chose demandée n'existe pas sur le site — à confirmer par un administrateur ─
create or replace function public.linkgen_learning_absent(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.ada_is_mc_export() then raise exception 'Réservé aux comptes MC Export'; end if;
  update public.linkgen_learning_items
     set status = 'a_valider', absent_note = left(coalesce(nullif(trim(p_note), ''), 'absent du site'), 500),
         proposed_by = auth.uid(), proposed_at = now(), proposed_url = null,
         learned = jsonb_build_object('absent', true), check_result = null, verify_url = null, updated_at = now()
   where id = p_id and status = 'a_chercher';
  if not found then raise exception 'Ligne introuvable ou déjà traitée'; end if;
end;
$$;

-- ─── Valider ou refuser (administrateurs) ───────────────────────────────────────────────────────────
create or replace function public.linkgen_learning_decide(p_id uuid, p_validate boolean, p_note text) returns text
language plpgsql security definer set search_path = public
as $$
declare
  it public.linkgen_learning_items%rowtype;
begin
  if not public.ada_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  select * into it from public.linkgen_learning_items where id = p_id for update;
  if not found or it.status <> 'a_valider' then raise exception 'Cette ligne n''attend pas de validation'; end if;
  if not p_validate then
    update public.linkgen_learning_items
       set status = 'a_chercher', decision_note = left(coalesce(nullif(trim(p_note), ''), 'refusée'), 500),
           decided_by = auth.uid(), decided_at = now(), proposed_url = null, absent_note = null,
           learned = null, check_result = null, verify_url = null, attempts = attempts + 1, updated_at = now()
     where id = p_id;
    return 'refusee';
  end if;
  if coalesce((it.learned ->> 'absent')::boolean, false) then
    update public.linkgen_learning_items
       set status = 'absente', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), updated_at = now()
     where id = p_id;
    return 'absente';
  end if;
  if it.learned is null or it.learned -> 'rule' is null then raise exception 'Aucune règle déduite : rien à valider'; end if;
  if coalesce(it.check_result ->> 'verdict', '') = 'echec' then
    raise exception 'Le contrôle a échoué : cette règle ne peut pas être validée, refusez la ligne';
  end if;
  if exists (
    select 1 from public.linkgen_learned_rules r
     where r.status = 'active' and r.site = it.site and r.kind = it.kind
       and r.brand_key = coalesce(it.learned ->> 'brand_key', '') and r.model_key = coalesce(it.learned ->> 'model_key', '')
       and r.criterion = it.criterion and r.value_key = coalesce(it.learned ->> 'value_key', '')
  ) then
    raise exception 'Une règle active existe déjà pour ce cas : retirez-la d''abord (onglet Appris)';
  end if;
  insert into public.linkgen_learned_rules
    (site, kind, brand_key, model_key, brand, model, criterion, value_key, value, rule, item_id, proof_url, verify_url, check_result, validated_by)
  values
    (it.site, it.kind, coalesce(it.learned ->> 'brand_key', ''), coalesce(it.learned ->> 'model_key', ''), it.brand, it.model,
     it.criterion, coalesce(it.learned ->> 'value_key', ''), it.value, it.learned -> 'rule', it.id, it.proposed_url, it.verify_url,
     it.check_result, auth.uid());
  update public.linkgen_learning_items
     set status = 'validee', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''), updated_at = now()
   where id = p_id;
  return 'validee';
end;
$$;

-- ─── Ignorer une ligne sans intérêt (administrateurs) ───────────────────────────────────────────────
create or replace function public.linkgen_learning_ignore(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.ada_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  update public.linkgen_learning_items
     set status = 'ignoree', decided_by = auth.uid(), decided_at = now(),
         decision_note = left(coalesce(nullif(trim(p_note), ''), 'ignorée'), 500), updated_at = now()
   where id = p_id and status in ('a_chercher', 'a_valider', 'absente', 'suspendue');
  if not found then raise exception 'Ligne introuvable ou déjà close'; end if;
end;
$$;

-- ─── Retirer une règle validée (administrateurs) : la ligne repart à chercher ───────────────────────
create or replace function public.linkgen_learned_rule_retire(p_rule_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item uuid;
begin
  if not public.ada_is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  update public.linkgen_learned_rules
     set status = 'retiree', retired_by = auth.uid(), retired_at = now(), retire_note = left(nullif(trim(p_note), ''), 500)
   where id = p_rule_id and status in ('active', 'suspendue')
  returning item_id into v_item;
  if not found then raise exception 'Règle introuvable ou déjà retirée'; end if;
  update public.linkgen_learning_items
     set status = 'a_chercher', proposed_url = null, learned = null, check_result = null, verify_url = null, absent_note = null,
         decision_note = left('règle retirée' || coalesce(' : ' || nullif(trim(p_note), ''), ''), 500), updated_at = now()
   where id = v_item;
end;
$$;

revoke all on function public.linkgen_note_gap(text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.linkgen_learning_propose(uuid, text) from public, anon;
revoke all on function public.linkgen_learning_absent(uuid, text) from public, anon;
revoke all on function public.linkgen_learning_decide(uuid, boolean, text) from public, anon;
revoke all on function public.linkgen_learning_ignore(uuid, text) from public, anon;
revoke all on function public.linkgen_learned_rule_retire(uuid, text) from public, anon;
grant execute on function public.linkgen_note_gap(text, text, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.linkgen_learning_propose(uuid, text) to authenticated;
grant execute on function public.linkgen_learning_absent(uuid, text) to authenticated;
grant execute on function public.linkgen_learning_decide(uuid, boolean, text) to authenticated;
grant execute on function public.linkgen_learning_ignore(uuid, text) to authenticated;
grant execute on function public.linkgen_learned_rule_retire(uuid, text) to authenticated;

-- Vérification : « tout_est_bon » doit valoir true.
select to_regclass('public.linkgen_learning_items') is not null
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_searches' and column_name = 'mileage_min')
   and to_regclass('public.linkgen_learned_rules') is not null
   and to_regprocedure('public.linkgen_note_gap(text, text, text, text, text, text, text, text, text)') is not null
   and to_regprocedure('public.linkgen_learning_decide(uuid, boolean, text)') is not null
   and to_regprocedure('public.linkgen_learned_rule_retire(uuid, text)') is not null as tout_est_bon;
