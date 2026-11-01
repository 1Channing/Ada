-- ═══════════════════════════════════════════════════════════════════════════
-- MAILS DE BIENVENUE VISIBLES DANS LA MESSAGERIE D'ADA (01/11, Channing :
-- « dans la boîte d'envoi d'Ada je ne vois pas les mails envoyés »). Le mail
-- part avec l'en-tête interne (la synchro Gmail ne le reprend pas) : le
-- worker crée donc lui-même le fil et le message « envoyé » dans
-- agent_threads / agent_messages, et garde le lien ici (thread_id). Les
-- mails déjà partis avant ce correctif sont rattrapés au démarrage du
-- worker (fil créé, sans identifiant Gmail). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.welcome_mails add column if not exists thread_id uuid references public.agent_threads(id) on delete set null;

select exists (select 1 from information_schema.columns where table_name = 'welcome_mails' and column_name = 'thread_id') as tout_est_bon;
