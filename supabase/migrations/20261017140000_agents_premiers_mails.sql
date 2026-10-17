/*
  # Ada, phase 2.3 — les premiers mails (17/10)

  - agent_threads.prospect_id : la conversation d'un garage qualifié (son
    étape avance seule : contacté à l'envoi, a répondu, perdu sur un « stop »).
  - agent_messages.ai_notes : pour un brouillon d'Ada, le modèle, le coût, la
    langue, les faits cités et les points à vérifier avant validation.
  - agent_settings.instructions : les consignes de Channing que l'IA suit
    (conditions, ton, ce qu'il ne faut jamais promettre) ;
    agent_settings.auto_draft_per_day : premiers mails rédigés d'office par
    jour (5 pour Ada au départ), toujours à valider.
  - agent_tasks : nouvelle sorte « premier_mail ».
  Rien n'est envoyé sans le clic d'un administrateur (règle de la phase 1,
  inchangée). Additif, idempotent. À coller après agents_qualification.
*/

alter table public.agent_threads add column if not exists prospect_id uuid references public.agent_prospects(id) on delete set null;
create index if not exists idx_agent_threads_prospect on public.agent_threads (prospect_id);

alter table public.agent_messages add column if not exists ai_notes jsonb;

alter table public.agent_settings add column if not exists instructions text not null default '';
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'agent_settings' and column_name = 'auto_draft_per_day') then
    alter table public.agent_settings add column auto_draft_per_day integer not null default 0;
    -- Une seule fois : Ada rédige 5 premiers mails par jour, à valider.
    update public.agent_settings set auto_draft_per_day = 5 where agent = 'ada';
  end if;
end $$;
alter table public.agent_settings drop constraint if exists agent_settings_draft_limit;
alter table public.agent_settings add constraint agent_settings_draft_limit check (auto_draft_per_day between 0 and 200);
grant update (instructions, auto_draft_per_day) on public.agent_settings to authenticated;

alter table public.agent_tasks drop constraint if exists agent_tasks_kind_check;
alter table public.agent_tasks add constraint agent_tasks_kind_check
  check (kind in ('decouverte_concessions', 'qualification', 'premier_mail'));

-- Vérification ------------------------------------------------------------------
select exists (select 1 from information_schema.columns where table_name = 'agent_threads' and column_name = 'prospect_id')
   and exists (select 1 from information_schema.columns where table_name = 'agent_messages' and column_name = 'ai_notes')
   and exists (select 1 from information_schema.columns where table_name = 'agent_settings' and column_name = 'auto_draft_per_day')
   and exists (select 1 from information_schema.columns where table_name = 'agent_settings' and column_name = 'instructions') as tout_est_bon;
