-- ═══════════════════════════════════════════════════════════════════════════
-- ONGLETS MASQUÉS PAR CHOIX PERSONNEL (23/10/2026) — demande Channing : « me
-- permettre, même en compte administrateur, d'enlever ou d'ajouter des
-- onglets ; j'en ai trop, je veux activer ou désactiver selon mon bon vouloir ».
--
-- profiles.hidden_tabs text[] : les entrées du bandeau que la personne a
-- choisi de ne plus voir (clés = chemins : '/workflow', '/market', …).
-- Préférence PERSONNELLE : rien à voir avec les droits (allowed_tabs, gérés
-- par l'admin dans Équipe) — un onglet masqué reste accessible par son
-- adresse, un onglet interdit reste interdit même s'il n'est pas masqué.
-- Chacun modifie sa propre ligne (policy profiles_update_own existante) ; le
-- trigger de protection des privilèges ne regarde pas cette colonne.
-- Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists hidden_tabs text[];

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'hidden_tabs'
) as tout_est_bon;
