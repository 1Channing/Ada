/*
  # Agents Ada et Dana — le socle (16/10, Channing : « deux agents qui
  #   travaillent en continu, l'un en prospection sourcing, l'autre en
  #   prospection de vente… des adresses mails dédiées… je veux tout leur
  #   travail dans un onglet dédié sur ADA, afin que je puisse driver »)

  Ada (ada@mc-export.com) trouve des ACHETEURS, Dana (dana@mc-export.com)
  des VENDEURS. Phase 1 = zéro IA : les deux boîtes branchées sur ADA.
  - Lecture des mails par un accès Google propre à chaque boîte (OAuth,
    jeton chiffré, lisible par le worker seul) — jamais par la délégation
    domaine, qui ouvrirait toutes les boîtes de mc-export.com.
  - Fils et messages, pièces jointes (bucket privé agent-mail).
  - ENVOI APRÈS VALIDATION (copilote) : un message validé ne change plus de
    contenu (règle de la base) et le worker vérifie son empreinte avant
    d'envoyer.
  - Liste « ne plus contacter » commune aux deux agentes, journal en ajout
    seul, alertes dans la cloche (user_tasks).
  - Carte du réseau : colonne source (manuel / ada / dana) pour le badge
    « ajouté par IA ».
  Droit `agents` sur autorisation explicite (comme offres) : la liste
  ci-dessous suit OPT_IN_TABS de src/lib/appTabs.ts.

  À coller dans Supabase → SQL Editor. Additif, idempotent : peut être recollé.
*/

-- 0. Droit « agents » sur autorisation explicite ------------------------------
create or replace function public.ada_user_can_see_tab(p_user uuid, p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when coalesce((to_jsonb(p) ->> 'blocked')::boolean, false) then false
      when coalesce(p.is_admin, false) then true
      when p.allowed_tabs is null then p_key <> all (array['opportunites', 'carte:edition', 'offres', 'agents'])
      else p_key = any (p.allowed_tabs)
        or (p_key = any (array['wf:etudes', 'wf:resultats', 'wf:archives']) and 'workflow' = any (p.allowed_tabs))
        or (p_key = any (array['wf:negociations', 'wf:ventes']) and 'ventes' = any (p.allowed_tabs))
    end
    from public.profiles p
    where p.id = p_user
  ), false);
$$;
revoke all on function public.ada_user_can_see_tab(uuid, text) from public, anon, authenticated;

/** Piloter Ada et Dana : compte MC Export avec le droit `agents`. */
create or replace function public.ada_can_drive_agents()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.ada_is_mc_export() and public.ada_can_see_any(array['agents']);
$$;
revoke all on function public.ada_can_drive_agents() from public, anon;
grant execute on function public.ada_can_drive_agents() to authenticated;

-- 1. Réglages des deux agentes --------------------------------------------------
create table if not exists public.agent_settings (
  agent text primary key check (agent in ('ada', 'dana')),
  display_name text not null,
  role text not null check (role in ('acheteurs', 'vendeurs')),
  mailbox text not null unique,
  sender_name text not null,
  status text not null default 'pause' check (status in ('pause', 'active')),
  signature text not null default '',
  -- Premiers contacts et relances par jour (les réponses ne sont pas plafonnées) :
  -- 10 la première semaine, puis 20, puis 30 à 40 au maximum (anti-spam).
  daily_first_contact_cap integer not null default 10 check (daily_first_contact_cap between 0 and 200),
  send_days integer[] not null default '{1,2,3,4,5}',
  send_from time not null default '08:30',
  send_to time not null default '18:00',
  min_gap_seconds integer not null default 150 check (min_gap_seconds >= 0),
  max_gap_seconds integer not null default 420 check (max_gap_seconds >= 0),
  owner_id uuid references public.profiles(id) on delete set null,
  gmail_connected_email text,
  gmail_connected_at timestamptz,
  gmail_history_id text,
  last_sync_at timestamptz,
  last_sync_error text,
  -- Étalement : pas de premier contact avant cet instant (écart aléatoire, posé par le worker).
  next_send_after timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.agent_settings add column if not exists next_send_after timestamptz;

insert into public.agent_settings (agent, display_name, role, mailbox, sender_name, signature, owner_id)
values
  ('ada', 'Ada', 'acheteurs', 'ada@mc-export.com', 'Ada — MC Export', E'Ada\nMC Export',
   (select id from public.profiles where id = '4537e9c9-fb62-424d-8a5c-228e9dbfbf58')),
  ('dana', 'Dana', 'vendeurs', 'dana@mc-export.com', 'Dana — MC Export', E'Dana\nMC Export',
   (select id from public.profiles where id = '4537e9c9-fb62-424d-8a5c-228e9dbfbf58'))
on conflict (agent) do nothing;

alter table public.agent_settings enable row level security;
drop policy if exists "agent_settings_select" on public.agent_settings;
create policy "agent_settings_select" on public.agent_settings
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_settings_update" on public.agent_settings;
create policy "agent_settings_update" on public.agent_settings
  for update to authenticated
  using ((select public.ada_is_mc_export()) and (select public.ada_is_admin()))
  with check ((select public.ada_is_mc_export()) and (select public.ada_is_admin()));
revoke all on public.agent_settings from anon, authenticated;
grant select on public.agent_settings to authenticated;
-- Les champs Gmail (connexion, curseur de synchro) restent au worker.
grant update (status, sender_name, signature, daily_first_contact_cap, send_days, send_from, send_to,
              min_gap_seconds, max_gap_seconds, owner_id, updated_at, updated_by)
  on public.agent_settings to authenticated;

-- 2. Connexion Google des boîtes (worker seul) --------------------------------
-- Jeton OAuth CHIFFRÉ par le worker. Aucune règle : seule la clé service lit.
create table if not exists public.agent_mail_credentials (
  mailbox text primary key,
  refresh_token_enc text not null,
  scope text not null default '',
  google_email text not null,
  connected_by uuid,
  connected_at timestamptz not null default now()
);
alter table public.agent_mail_credentials enable row level security;
revoke all on public.agent_mail_credentials from anon, authenticated;

-- Clés publiques de l'écran de consentement Google, posées par le worker au
-- démarrage (une ligne par worker : TEST et production peuvent coexister).
create table if not exists public.agent_oauth_config (
  redirect_uri text primary key,
  client_id text not null,
  updated_at timestamptz not null default now()
);
alter table public.agent_oauth_config enable row level security;
revoke all on public.agent_oauth_config from anon, authenticated;

-- Un « state » à usage unique par tentative de connexion (anti-détournement).
create table if not exists public.agent_oauth_states (
  state text primary key,
  agent text not null references public.agent_settings(agent) on delete cascade,
  mailbox text not null,
  created_by uuid not null,
  -- Retour dans ADA après Google (l'adresse de l'onglet qui a lancé la connexion).
  return_to text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.agent_oauth_states add column if not exists return_to text;
alter table public.agent_oauth_states enable row level security;
revoke all on public.agent_oauth_states from anon, authenticated;

/** Début de connexion d'une boîte : admin MC Export seulement. Rend ce qu'il
 *  faut pour l'écran Google ; le worker termine (/agents/oauth/callback). */
drop function if exists public.agents_oauth_begin(text);
create or replace function public.agents_oauth_begin(p_agent text, p_return_to text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_mailbox text;
  v_client text;
  v_redirect text;
  v_state text;
begin
  if not (public.ada_is_mc_export() and public.ada_is_admin()) then
    raise exception 'Réservé aux administrateurs MC Export';
  end if;
  select mailbox into v_mailbox from public.agent_settings where agent = p_agent;
  if v_mailbox is null then
    raise exception 'Agente inconnue : %', p_agent;
  end if;
  select client_id, redirect_uri into v_client, v_redirect
    from public.agent_oauth_config order by updated_at desc limit 1;
  if v_client is null then
    raise exception 'Connexion Google pas encore configurée : variables AGENT_GOOGLE_CLIENT_ID et AGENT_GOOGLE_CLIENT_SECRET à poser sur le worker';
  end if;
  delete from public.agent_oauth_states where created_at < now() - interval '1 day';
  v_state := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- Retour seulement vers ADA (pas de redirection ouverte vers un autre site).
  if p_return_to is not null and p_return_to !~ '^https://([a-z0-9-]+\.)*(mc-export\.com|up\.railway\.app)(/|$)'
     and p_return_to !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$)' then
    p_return_to := null;
  end if;
  insert into public.agent_oauth_states (state, agent, mailbox, created_by, return_to)
  values (v_state, p_agent, v_mailbox, auth.uid(), p_return_to);
  return jsonb_build_object('state', v_state, 'client_id', v_client, 'redirect_uri', v_redirect, 'login_hint', v_mailbox);
end;
$$;
revoke all on function public.agents_oauth_begin(text, text) from public, anon;
grant execute on function public.agents_oauth_begin(text, text) to authenticated;

/** Débrancher une boîte : le jeton est effacé, le curseur repart de zéro. */
create or replace function public.agents_mail_disconnect(p_agent text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_mailbox text;
begin
  if not (public.ada_is_mc_export() and public.ada_is_admin()) then
    raise exception 'Réservé aux administrateurs MC Export';
  end if;
  select mailbox into v_mailbox from public.agent_settings where agent = p_agent;
  if v_mailbox is null then
    raise exception 'Agente inconnue : %', p_agent;
  end if;
  delete from public.agent_mail_credentials where mailbox = v_mailbox;
  update public.agent_settings
     set gmail_connected_email = null, gmail_connected_at = null, gmail_history_id = null,
         last_sync_error = null, updated_at = now(), updated_by = auth.uid()
   where agent = p_agent;
end;
$$;
revoke all on function public.agents_mail_disconnect(text) from public, anon;
grant execute on function public.agents_mail_disconnect(text) to authenticated;

-- 3. Fils et messages ----------------------------------------------------------
create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agent_settings(agent),
  mailbox text not null,
  gmail_thread_id text,
  subject text not null default '',
  counterpart_email text,
  counterpart_name text,
  network_contact_id uuid references public.network_contacts(id) on delete set null,
  last_message_at timestamptz,
  last_direction text,
  last_classification text,
  unread boolean not null default false,
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mailbox, gmail_thread_id)
);
create index if not exists idx_agent_threads_list on public.agent_threads (agent, archived, last_message_at desc nulls first);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  agent text not null references public.agent_settings(agent),
  mailbox text not null,
  channel text not null default 'mail' check (channel in ('mail', 'linkedin')),
  direction text not null check (direction in ('in', 'out')),
  -- Sortant : brouillon → a_valider → valide → envoi → envoye | echec ;
  -- a_valider/valide → refuse. Entrant : recu.
  status text not null check (status in ('brouillon', 'a_valider', 'valide', 'envoi', 'envoye', 'echec', 'refuse', 'recu')),
  -- premier_contact et relance comptent dans le plafond du jour, pas reponse.
  kind text not null default 'reponse' check (kind in ('premier_contact', 'relance', 'reponse', 'recu')),
  gmail_message_id text,
  rfc_message_id text,
  in_reply_to text,
  references_header text,
  from_email text,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null default '',
  body_text text not null default '',
  -- Mail reçu : la partie nouvelle, sans l'historique cité.
  body_new text,
  translation_fr text,
  -- [{path, name, mime, size}] dans le bucket agent-mail.
  attachments jsonb not null default '[]'::jsonb,
  -- positif | negatif | question | absence | rebond | stop | autre
  classification text,
  auto_reply boolean not null default false,
  author text not null default 'humain' check (author in ('humain', 'ada', 'dana', 'systeme')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  content_hash text,
  refused_reason text,
  error text,
  -- Pas d'envoi avant (étalement aléatoire entre deux envois).
  scheduled_after timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox, gmail_message_id)
);
create index if not exists idx_agent_messages_thread on public.agent_messages (thread_id, created_at);
create index if not exists idx_agent_messages_status on public.agent_messages (status, direction, agent);

/** Empreinte du contenu validé : destinataires, objet, texte, pièces jointes. */
create or replace function public.agent_message_hash(p_to text[], p_cc text[], p_subject text, p_body text, p_attachments jsonb)
returns text
language sql immutable
as $$
  select md5(array_to_string(coalesce(p_to, '{}'), ',') || E'\n' || array_to_string(coalesce(p_cc, '{}'), ',')
    || E'\n' || coalesce(p_subject, '') || E'\n' || coalesce(p_body, '') || E'\n' || coalesce(p_attachments::text, '[]'));
$$;

/** Le worker vérifie, juste avant d'envoyer, que le texte est celui validé. */
create or replace function public.agent_message_unchanged(p_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select m.content_hash is not null
       and m.content_hash = public.agent_message_hash(m.to_emails, m.cc_emails, m.subject, m.body_text, m.attachments)
    from public.agent_messages m where m.id = p_id
  ), false);
$$;
revoke all on function public.agent_message_unchanged(uuid) from public, anon, authenticated;
grant execute on function public.agent_message_unchanged(uuid) to service_role;

/** Fils : l'agente, la boîte et l'identifiant Gmail ne changent pas (sauf worker). */
create or replace function public.agent_threads_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.mailbox is distinct from (select s.mailbox from public.agent_settings s where s.agent = new.agent) then
      raise exception 'Boîte sans rapport avec l''agente %', new.agent;
    end if;
    new.created_by := auth.uid();
  elsif new.agent is distinct from old.agent or new.mailbox is distinct from old.mailbox
        or new.gmail_thread_id is distinct from old.gmail_thread_id then
    raise exception 'L''agente, la boîte et le fil Gmail d''une conversation ne changent pas';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_agent_threads_guard on public.agent_threads;
create trigger trg_agent_threads_guard before insert or update on public.agent_threads
  for each row execute function public.agent_threads_guard();

-- 4. Journal (ajout seul) ------------------------------------------------------
create table if not exists public.agent_journal (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  agent text,
  actor text not null,
  actor_id uuid,
  kind text not null,
  summary text not null,
  thread_id uuid references public.agent_threads(id) on delete set null,
  message_id uuid references public.agent_messages(id) on delete set null,
  details jsonb not null default '{}'::jsonb
);
create index if not exists idx_agent_journal_at on public.agent_journal (at desc);
create index if not exists idx_agent_journal_agent on public.agent_journal (agent, at desc);

-- 5. Règle des messages : passages de statut, contenu figé après validation ----
create or replace function public.agent_messages_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    -- Un message part TOUJOURS de la boîte de son agente, dans un fil de cette boîte :
    -- personne n'écrit au nom d'une autre adresse de mc-export.com.
    if new.mailbox is distinct from (select s.mailbox from public.agent_settings s where s.agent = new.agent)
       or not exists (select 1 from public.agent_threads t where t.id = new.thread_id and t.agent = new.agent and t.mailbox = new.mailbox) then
      raise exception 'Boîte ou fil sans rapport avec l''agente %', new.agent;
    end if;
    if new.direction = 'in' and not v_service then
      raise exception 'Seul le worker enregistre les mails reçus';
    end if;
    if new.direction = 'out' and new.status not in ('brouillon', 'a_valider', 'valide') and not v_service then
      raise exception 'Un nouveau message part en brouillon, à valider ou validé';
    end if;
    if new.direction = 'out' and new.status = 'valide' and not v_service and not public.ada_is_admin() then
      raise exception 'Seul un administrateur valide un envoi';
    end if;
  else
    if new.thread_id is distinct from old.thread_id or new.direction is distinct from old.direction
       or new.agent is distinct from old.agent or new.mailbox is distinct from old.mailbox then
      raise exception 'Fil, sens et boîte d''un message ne changent pas';
    end if;
    if new.direction = 'in' and not v_service
       and (new.body_text is distinct from old.body_text or new.subject is distinct from old.subject
            or new.from_email is distinct from old.from_email or new.status is distinct from old.status) then
      raise exception 'Un mail reçu ne se modifie pas (seul son classement change)';
    end if;
    if new.direction = 'out' and new.status is distinct from old.status then
      if not (
        (old.status = 'brouillon' and new.status in ('a_valider', 'valide'))
        or (old.status = 'a_valider' and new.status in ('brouillon', 'valide', 'refuse'))
        or (old.status = 'valide' and new.status in ('brouillon', 'refuse', 'envoi', 'echec'))
        or (old.status = 'envoi' and new.status in ('envoye', 'echec'))
        or (old.status in ('echec', 'refuse') and new.status = 'brouillon')
      ) then
        raise exception 'Passage refusé : % → %', old.status, new.status;
      end if;
      if new.status in ('envoi', 'envoye') and not v_service then
        raise exception 'Seul le worker envoie';
      end if;
      -- Copilote : c'est un administrateur MC Export qui valide ce qui part.
      if new.status = 'valide' and not v_service and not public.ada_is_admin() then
        raise exception 'Seul un administrateur valide un envoi';
      end if;
    end if;
    -- Validé, en cours d'envoi ou envoyé : le contenu ne bouge plus.
    if old.direction = 'out' and old.status in ('valide', 'envoi', 'envoye') and new.status not in ('brouillon', 'refuse')
       and (new.to_emails is distinct from old.to_emails or new.cc_emails is distinct from old.cc_emails
            or new.subject is distinct from old.subject or new.body_text is distinct from old.body_text
            or new.attachments is distinct from old.attachments) then
      raise exception 'Message déjà validé : le repasser en brouillon pour le modifier';
    end if;
  end if;
  if new.direction = 'out' then
    if new.status = 'valide' and (tg_op = 'INSERT' or old.status is distinct from 'valide') then
      new.approved_at := now();
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.content_hash := public.agent_message_hash(new.to_emails, new.cc_emails, new.subject, new.body_text, new.attachments);
    elsif new.status in ('brouillon', 'a_valider', 'refuse') then
      new.approved_at := null;
      new.approved_by := null;
      new.content_hash := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_agent_messages_guard on public.agent_messages;
create trigger trg_agent_messages_guard before insert or update on public.agent_messages
  for each row execute function public.agent_messages_guard();

/** Journal des gestes sur les messages (humains comme worker). */
create or replace function public.agent_messages_journal()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_who text := case when auth.uid() is not null then 'humain'
                     when new.status in ('envoye', 'echec', 'recu') then 'systeme'
                     else new.author end;
  v_to text := coalesce(array_to_string(new.to_emails, ', '), '');
  v_kind text;
  v_summary text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_kind := case new.status
    when 'recu' then 'mail_recu'
    when 'brouillon' then 'mail_brouillon'
    when 'a_valider' then 'mail_a_valider'
    when 'valide' then 'mail_valide'
    when 'refuse' then 'mail_refuse'
    when 'envoye' then 'mail_envoye'
    when 'echec' then 'mail_echec'
    else null end;
  if v_kind is null then
    return new;
  end if;
  v_summary := case new.status
    when 'recu' then 'Mail reçu de ' || coalesce(nullif(new.from_name, ''), new.from_email, '?') || ' : « ' || new.subject || ' »'
    when 'brouillon' then 'Brouillon : « ' || new.subject || ' » → ' || v_to
    when 'a_valider' then 'À valider : « ' || new.subject || ' » → ' || v_to
    when 'valide' then 'Validé : « ' || new.subject || ' » → ' || v_to
    when 'refuse' then 'Refusé : « ' || new.subject || ' »' || coalesce(' — ' || nullif(new.refused_reason, ''), '')
    when 'envoye' then 'Envoyé : « ' || new.subject || ' » → ' || v_to
    when 'echec' then 'Échec d''envoi : « ' || new.subject || ' » — ' || coalesce(new.error, '?')
  end;
  insert into public.agent_journal (agent, actor, actor_id, kind, summary, thread_id, message_id)
  values (new.agent, v_who, auth.uid(), v_kind, left(v_summary, 500), new.thread_id, new.id);
  return new;
end;
$$;
drop trigger if exists trg_agent_messages_journal on public.agent_messages;
create trigger trg_agent_messages_journal after insert or update on public.agent_messages
  for each row execute function public.agent_messages_journal();

-- 6. Liste « ne plus contacter » (une adresse, ou « @domaine.fr » pour tout un domaine)
create table if not exists public.email_suppressions (
  email text primary key check (email = lower(email) and position('@' in email) > 0),
  reason text not null check (reason in ('stop', 'refus', 'rebond', 'plainte', 'manuel')),
  agent text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 7. Accès (RLS) : comptes MC Export avec le droit `agents` -------------------
alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_journal enable row level security;
alter table public.email_suppressions enable row level security;

drop policy if exists "agent_threads_rw" on public.agent_threads;
drop policy if exists "agent_threads_select" on public.agent_threads;
create policy "agent_threads_select" on public.agent_threads
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_threads_insert" on public.agent_threads;
create policy "agent_threads_insert" on public.agent_threads
  for insert to authenticated
  with check ((select public.ada_can_drive_agents()) and gmail_thread_id is null);
drop policy if exists "agent_threads_update" on public.agent_threads;
create policy "agent_threads_update" on public.agent_threads
  for update to authenticated
  using ((select public.ada_can_drive_agents()))
  with check ((select public.ada_can_drive_agents()));
-- Supprimer un fil = seulement s'il ne contient que des brouillons (l'historique reste).
drop policy if exists "agent_threads_delete" on public.agent_threads;
create policy "agent_threads_delete" on public.agent_threads
  for delete to authenticated
  using ((select public.ada_can_drive_agents())
         and not exists (select 1 from public.agent_messages m
                         where m.thread_id = agent_threads.id and m.status not in ('brouillon', 'a_valider', 'refuse')));

drop policy if exists "agent_messages_select" on public.agent_messages;
create policy "agent_messages_select" on public.agent_messages
  for select to authenticated using ((select public.ada_can_drive_agents()));
drop policy if exists "agent_messages_insert" on public.agent_messages;
create policy "agent_messages_insert" on public.agent_messages
  for insert to authenticated
  with check ((select public.ada_can_drive_agents()) and direction = 'out' and author = 'humain');
drop policy if exists "agent_messages_update" on public.agent_messages;
create policy "agent_messages_update" on public.agent_messages
  for update to authenticated
  using ((select public.ada_can_drive_agents()))
  with check ((select public.ada_can_drive_agents()));
drop policy if exists "agent_messages_delete" on public.agent_messages;
create policy "agent_messages_delete" on public.agent_messages
  for delete to authenticated
  using ((select public.ada_can_drive_agents()) and direction = 'out' and status in ('brouillon', 'a_valider', 'refuse'));

drop policy if exists "agent_journal_select" on public.agent_journal;
create policy "agent_journal_select" on public.agent_journal
  for select to authenticated using ((select public.ada_can_drive_agents()));

drop policy if exists "email_suppressions_rw" on public.email_suppressions;
create policy "email_suppressions_rw" on public.email_suppressions
  for all to authenticated
  using ((select public.ada_can_drive_agents()))
  with check ((select public.ada_can_drive_agents()));

revoke all on public.agent_threads, public.agent_messages, public.agent_journal, public.email_suppressions from anon;
grant select, insert, update, delete on public.agent_threads, public.agent_messages, public.email_suppressions to authenticated;
revoke insert, update, delete on public.agent_journal from authenticated;
grant select on public.agent_journal to authenticated;

-- 8. Pièces jointes : bucket privé, lu par les pilotes, écrit par le worker ---
insert into storage.buckets (id, name, public, file_size_limit)
values ('agent-mail', 'agent-mail', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
drop policy if exists agent_mail_read on storage.objects;
create policy agent_mail_read on storage.objects
  for select to authenticated using (bucket_id = 'agent-mail' and (select public.ada_can_drive_agents()));

-- 9. Carte du réseau : d'où vient le contact (badge « IA · Ada / Dana ») -----
alter table public.network_contacts add column if not exists source text not null default 'manuel';
alter table public.network_contacts add column if not exists ai_added_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'network_contacts_source_check') then
    alter table public.network_contacts
      add constraint network_contacts_source_check check (source in ('manuel', 'ada', 'dana'));
  end if;
end $$;

-- 10. Vérification -------------------------------------------------------------
select exists (select 1 from public.agent_settings where agent = 'ada' and mailbox = 'ada@mc-export.com')
   and exists (select 1 from public.agent_settings where agent = 'dana' and mailbox = 'dana@mc-export.com')
   and exists (select 1 from pg_policies where tablename = 'agent_messages' and policyname = 'agent_messages_update')
   and exists (select 1 from pg_trigger where tgname = 'trg_agent_messages_guard')
   and exists (select 1 from storage.buckets where id = 'agent-mail' and not public)
   and exists (select 1 from information_schema.columns where table_name = 'network_contacts' and column_name = 'source')
   and not has_table_privilege('anon', 'public.agent_messages', 'select')
   and not has_table_privilege('authenticated', 'public.agent_mail_credentials', 'select')
   and public.agent_message_hash('{a@b.fr}', '{}', 'x', 'y', '[]') = md5(E'a@b.fr\n\nx\ny\n[]') as tout_est_bon;
