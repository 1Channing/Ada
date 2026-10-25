/*
  # Modifier une fiche des agentes (25/10, Channing : « Oui prépare le sql »)
  Sur une carte du Workflow (Discussions en cours), l'équipe corrige le nom,
  le téléphone et le site d'une fiche quand l'agente s'est trompée : bouton
  « Modifier la fiche ». Jusqu'ici, seules l'étape et les notes l'étaient.
  Mêmes personnes qu'avant : les comptes qui pilotent les agentes
  (règle agent_prospects_update, ada_can_drive_agents). Le contact de la
  carte réseau suit côté application (droits déjà ouverts sur la carte).
  Additif, idempotent : à coller tel quel dans Supabase (SQL Editor).
*/

grant update (name, phone, website) on public.agent_prospects to authenticated;

-- Vérification : « tout_est_bon » doit valoir true.
select has_column_privilege('authenticated', 'public.agent_prospects', 'name', 'UPDATE')
   and has_column_privilege('authenticated', 'public.agent_prospects', 'phone', 'UPDATE')
   and has_column_privilege('authenticated', 'public.agent_prospects', 'website', 'UPDATE')
   and has_column_privilege('authenticated', 'public.agent_prospects', 'notes', 'UPDATE') as tout_est_bon;
