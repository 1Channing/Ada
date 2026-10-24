/*
  # Demandes du site mc-export.com (23/10, Channing : « on choisit A… B2B
  #   uniquement… objectif volume » ; formulaire qui qualifie l'accueil et
  #   pages de rachat aux particuliers en six langues)

  Le site écrit dans ADA avec la clé anonyme, par une seule porte :
  site_submit_lead(jsonb), fonction « security definer » qui valide la
  demande et la range dans site_leads. La clé anonyme ne lit toujours
  aucune table ; seule l'équipe MC Export lit et traite les demandes. Le
  worker envoie l'alerte (e-mail + rappel) des demandes que le site n'a pas
  déjà signalées lui-même (notified_at). Additif, idempotent.
*/

-- 1. Les demandes -------------------------------------------------------------------
create table if not exists public.site_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- acheteur / vendeur : professionnels (accueil) ; particulier : pages de rachat ; autre : demande pro diverse.
  kind text not null check (kind in ('acheteur', 'vendeur', 'particulier', 'autre')),
  lang text not null default 'fr' check (lang in ('fr', 'en', 'da', 'nl', 'de', 'it', 'es')),
  page text,
  name text,
  email text,
  phone text,
  company text,
  country text,
  message text,
  -- Champs propres au profil : volume, délai, type de vendeur, marque, modèle, année, km, situation…
  details jsonb not null default '{}'::jsonb,
  -- Provenance : gclid, utm_*, referrer (mesure Google Ads).
  source jsonb not null default '{}'::jsonb,
  status text not null default 'nouvelle' check (status in ('nouvelle', 'traitee', 'ecartee')),
  notified_at timestamptz,
  notes text
);
create index if not exists site_leads_created_idx on public.site_leads (created_at desc);
create index if not exists site_leads_to_notify_idx on public.site_leads (created_at) where notified_at is null;

alter table public.site_leads enable row level security;
revoke all on public.site_leads from anon;
grant select, update on public.site_leads to authenticated;
drop policy if exists site_leads_team_read on public.site_leads;
create policy site_leads_team_read on public.site_leads for select to authenticated
  using ((select public.ada_is_mc_export()));
drop policy if exists site_leads_team_update on public.site_leads;
create policy site_leads_team_update on public.site_leads for update to authenticated
  using ((select public.ada_is_mc_export())) with check ((select public.ada_is_mc_export()));

-- 2. La porte du site ----------------------------------------------------------------
create or replace function public.site_submit_lead(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := lower(coalesce(p->>'kind', ''));
  v_lang text := lower(coalesce(p->>'lang', 'fr'));
  v_email text := lower(nullif(btrim(p->>'email'), ''));
  v_phone text := nullif(btrim(p->>'phone'), '');
  v_id uuid;
begin
  if jsonb_typeof(p) is distinct from 'object' or length(p::text) > 20000 then
    raise exception 'demande invalide';
  end if;
  if v_kind not in ('acheteur', 'vendeur', 'particulier', 'autre') then
    raise exception 'profil invalide';
  end if;
  if v_lang not in ('fr', 'en', 'da', 'nl', 'de', 'it', 'es') then v_lang := 'fr'; end if;
  if v_email is null and v_phone is null then
    raise exception 'e-mail ou téléphone requis';
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'e-mail invalide';
  end if;
  -- Garde-fou contre les envois en rafale : 5 demandes par adresse et par jour.
  if v_email is not null and (
    select count(*) from public.site_leads where email = v_email and created_at > now() - interval '1 day'
  ) >= 5 then
    raise exception 'trop de demandes';
  end if;

  insert into public.site_leads (kind, lang, page, name, email, phone, company, country, message, details, source, notified_at)
  values (
    v_kind, v_lang,
    left(nullif(btrim(p->>'page'), ''), 300),
    left(nullif(btrim(p->>'name'), ''), 200),
    v_email,
    left(v_phone, 60),
    left(nullif(btrim(p->>'company'), ''), 200),
    left(nullif(btrim(p->>'country'), ''), 100),
    left(nullif(btrim(p->>'message'), ''), 4000),
    case when jsonb_typeof(p->'details') = 'object' then p->'details' else '{}'::jsonb end,
    case when jsonb_typeof(p->'source') = 'object' then p->'source' else '{}'::jsonb end,
    -- Le site a déjà envoyé l'alerte lui-même : le worker ne la renvoie pas.
    case when p->>'notified' = 'true' then now() end
  )
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.site_submit_lead(jsonb) from public;
grant execute on function public.site_submit_lead(jsonb) to anon, authenticated;

-- 3. Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'site_leads')
   and has_function_privilege('anon', 'public.site_submit_lead(jsonb)', 'execute')
   and not has_table_privilege('anon', 'public.site_leads', 'select')
   and not has_table_privilege('anon', 'public.site_leads', 'insert')
   and exists (select 1 from pg_policies where tablename = 'site_leads' and policyname = 'site_leads_team_read') as tout_est_bon;
