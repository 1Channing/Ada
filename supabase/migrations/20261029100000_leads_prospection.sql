-- ═══════════════════════════════════════════════════════════════════════════
-- LEADS DES COMPTES DE PROSPECTION (29/10/2026) — demande Channing : « deux
-- agences signées ; dans le Workflow des comptes de prospection, un onglet
-- Leads à côté de Négociations ; le manager a en plus les Études
-- quotidiennes ; ce que ses études trouvent tombe dans les Leads de tous ses
-- commerciaux ; dès qu'un commercial prend un lead en négociation, il
-- disparaît pour tout le monde — pas de doublon, le tri est fait ».
--
-- 1. daily_searches.shared_leads : l'étude PARTAGE ses trouvailles avec
--    l'organisation de son auteur (cochée par le manager). Sans ce drapeau,
--    rien ne change : une étude reste personnelle.
-- 2. daily_search_hits.taken_by / taken_at : qui a pris le lead, quand.
-- 3. Lecture : tout membre de l'organisation voit les études partagées de
--    son organisation et leurs annonces. Écriture : il peut PRENDRE un lead
--    (statut inbox → saved, à son nom) — rien d'autre ; la policy
--    « _own » de l'auteur reste intacte.
-- 4. Onglet « wf:leads » : ajouté aux organisations « prospection seule »
--    (default_tabs) et aux comptes de ces organisations qui ont déjà
--    Négociations ; leurs managers reçoivent en plus « wf:etudes ».
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.daily_searches add column if not exists shared_leads boolean not null default false;
alter table public.daily_search_hits add column if not exists taken_by uuid references auth.users(id) on delete set null;
alter table public.daily_search_hits add column if not exists taken_at timestamptz;
create index if not exists idx_daily_searches_shared on public.daily_searches (shared_leads) where shared_leads;

-- Une étude partagée de MON organisation (auteur dans la même organisation que moi).
create or replace function public.ada_shared_search_visible(p_search uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.daily_searches s
    where s.id = p_search and s.shared_leads
      and public.organisation_of(s.user_id) = public.my_organisation()
  );
$$;
revoke all on function public.ada_shared_search_visible(uuid) from public, anon;
grant execute on function public.ada_shared_search_visible(uuid) to authenticated;

drop policy if exists "daily_searches_org_shared_select" on public.daily_searches;
create policy "daily_searches_org_shared_select" on public.daily_searches
  for select to authenticated
  using (shared_leads and public.organisation_of(user_id) = public.my_organisation());

drop policy if exists "daily_search_hits_org_shared_select" on public.daily_search_hits;
create policy "daily_search_hits_org_shared_select" on public.daily_search_hits
  for select to authenticated
  using (public.ada_shared_search_visible(search_id));

-- Prendre un lead : seulement une annonce encore « inbox », et seulement vers « saved » à mon nom.
drop policy if exists "daily_search_hits_org_shared_take" on public.daily_search_hits;
create policy "daily_search_hits_org_shared_take" on public.daily_search_hits
  for update to authenticated
  using (status = 'inbox' and public.ada_shared_search_visible(search_id))
  with check (status = 'saved' and taken_by = auth.uid() and public.ada_shared_search_visible(search_id));

-- Onglet Leads pour la prospection.
update public.organisations
   set default_tabs = array_append(default_tabs, 'wf:leads')
 where default_tabs is not null
   and 'wf:negociations' = any(default_tabs)
   and not ('wf:leads' = any(default_tabs))
   and default_tabs <@ array['wf:negociations', 'wf:archives', 'wf:leads'];

update public.profiles p
   set allowed_tabs = array_append(p.allowed_tabs, 'wf:leads')
  from public.organisations o
 where o.name = coalesce(nullif(p.organisation, ''), 'MC Export')
   and o.default_tabs is not null and 'wf:leads' = any(o.default_tabs)
   and p.allowed_tabs is not null
   and 'wf:negociations' = any(p.allowed_tabs)
   and not ('wf:leads' = any(p.allowed_tabs));

update public.profiles p
   set allowed_tabs = array_append(p.allowed_tabs, 'wf:etudes')
  from public.organisations o
 where o.name = coalesce(nullif(p.organisation, ''), 'MC Export')
   and o.default_tabs is not null and 'wf:leads' = any(o.default_tabs)
   and p.is_manager
   and p.allowed_tabs is not null
   and not ('wf:etudes' = any(p.allowed_tabs));

select (
  exists (select 1 from information_schema.columns where table_name = 'daily_searches' and column_name = 'shared_leads')
  and exists (select 1 from information_schema.columns where table_name = 'daily_search_hits' and column_name = 'taken_by')
  and exists (select 1 from pg_policies where tablename = 'daily_search_hits' and policyname = 'daily_search_hits_org_shared_take')
) as tout_est_bon;
