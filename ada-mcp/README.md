# ADA MCP — lecture seule, V1

Service MCP privé qui expose une surface **réduite et strictement en lecture** sur les données vivantes d'ADA, pour interroger ADA à la voix ou au clavier depuis ChatGPT (ou tout client MCP).

## Sur quoi il est câblé

Depuis fin juillet 2026, la vérité d'ADA vit dans ces tables. Le connecteur ne lit **que** celles-là :

| Donnée | Table | Outils |
| --- | --- | --- |
| Études quotidiennes (critères, propriétaire, heure de passage) | `daily_searches` | `list_studies`, `get_study` |
| Annonces des études (à traiter, nouvelles, baisses, traitées) | `daily_search_hits` | `list_inbox`, `list_leads`, `get_study` |
| Négociations en cours + dossiers | `negotiations`, `negotiation_folders` | `list_negotiations` |
| Relevés de prix du Market Intelligence et des vagues | `market_snapshots` | `market_prices` |
| Dossiers de vérité | `truth_dossiers` | `truth_status` |
| Boîte noire du worker (bilans de vague, résumé du matin) | `worker_logs` | `ada_health`, `list_studies`, `get_study`, `truth_status` |
| Comptes | `profiles` | `list_people` (et filtre `person` partout) |

Les tables `studies_v2` / `study_runs` / `study_run_results` / `study_source_listings` de l'ancienne architecture (dernière écriture le 17/07/2026) **ne sont pas lues** : elles ne reflètent plus ADA.

## Outils

| Outil | Ce qu'il répond |
| --- | --- |
| `ada_health` | Le worker répond-il (dernier log, minutes de silence), résumé de la dernière vague, nombre d'études actives, d'annonces à traiter, de négociations en cours |
| `list_people` | Les comptes de l'équipe, pour filtrer par personne |
| `list_studies` | Les études (personne, marque, modèle, pays) avec critères et **bilan de la dernière vague** par site (« ✗ » = site en échec, pas un marché vide) |
| `get_study` | Une étude par identifiant ou libellé : critères, 7 derniers bilans, annonces par statut, annonces à traiter |
| `list_inbox` | Les annonces actuellement à traiter (nouvelles + baisses dans l'écart), par personne, étude, marque ou modèle |
| `list_leads` | Les annonces **entrées** dans la boîte sur N jours, traitées ou non, comptées comme la carte « Leads du Workflow » de la page Équipe (une annonce = une fois, à la date de la baisse sinon de la première vue) |
| `list_negotiations` | Les négociations en cours avec propriétaire, dossier, prix affiché et négocié, notes, date d'ajout et ancienneté |
| `market_prices` | Les derniers relevés de prix d'un véhicule sur un pays, site par site (médiane, quartiles, échantillon, URL du relevé) |
| `truth_status` | Résumés des dernières vagues, dossiers de vérité ouverts par signal et par site, les plus prioritaires |

Tous les outils sont déclarés lecture seule, non destructifs, idempotents, à monde fermé, et bornés par une limite.

Fail-open sur le schéma : si le SQL des dossiers (10/09) ou de la date de baisse (12/09) n'est pas encore collé, les outils répondent sans ces colonnes au lieu d'échouer.

## Modèle de sécurité

- La clé service-role Supabase ne vit que dans ce service (variable d'environnement Railway), jamais côté client ni dans GitHub.
- Jeton dédié `ADA_MCP_API_KEY` obligatoire : sans lui le service **refuse de démarrer** ; toute requête `/mcp` sans le bon `Authorization: Bearer …` reçoit 401 (comparaison en temps constant).
- `ADA_MCP_ALLOWED_HOSTS` obligatoire (protection contre le rebinding DNS), `ADA_MCP_ALLOWED_ORIGINS` facultatif.
- Aucun SQL libre, aucun accès générique aux tables, aucune écriture.
- Le jeton statique est une porte pour UN usage interne. Si le connecteur doit servir plusieurs personnes, remplacer cette couche par OAuth/OIDC et une autorisation par utilisateur, sans toucher aux outils.

Variables :

```bash
SUPABASE_URL=https://<projet>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADA_MCP_API_KEY=...            # long secret dédié, jamais WORKER_SECRET
ADA_MCP_ALLOWED_HOSTS=ada-mcp-production.up.railway.app
ADA_MCP_ALLOWED_ORIGINS=       # facultatif
PORT=3002                      # facultatif
```

## Lancer en local

```bash
cd ada-mcp
npm install
cp .env.example .env   # remplir ; ajouter localhost à ADA_MCP_ALLOWED_HOSTS (nom d'hôte seul, sans port)
npm run dev
curl http://localhost:3002/health
```

## Déploiement Railway

Créer un **nouveau service** Railway depuis le dépôt `1Channing/Ada`, sur la **branche déployée en production** (celle du front et du worker), pas `main`. Ne pas repointer le service worker existant.

- Root directory : `/ada-mcp`
- Build : `npm install && npm run build`
- Start : `npm start`
- Node 20+
- Réseau public activé, health check `/health`

Renseigner les variables ci-dessus. Une fois le domaine attribué, mettre son nom d'hôte (sans `https://`, sans chemin) dans `ADA_MCP_ALLOWED_HOSTS` et redéployer. Le point d'entrée MCP est `https://<domaine>/mcp`.

## Connexion à ChatGPT

1. Déployer le service.
2. Dans ChatGPT, activer le mode développeur / applications personnalisées (selon le plan).
3. Créer le connecteur sur `https://<domaine>/mcp`.
4. **Authentification** : le serveur attend un jeton Bearer. Les connecteurs ChatGPT n'acceptent pas toujours un en-tête statique (souvent « sans authentification » ou OAuth). Si c'est le cas dans ton espace, ne change que la couche d'authentification (`app.use('/mcp', …)`), jamais les outils.
5. Tester `ada_health`, puis une question étroite : « Quelles sont les annonces à traiter d'Antoine ce matin ? »

## Ce que la V1 ne fait pas, volontairement

- créer, modifier ou lancer une étude ;
- toucher aux négociations, aux mappings, aux dossiers de vérité ;
- exposer du SQL ou une table entière.

Ces capacités viendront une par une, avec périmètre explicite, journal d'audit et confirmation, et toujours par l'orchestration existante du worker, jamais par écriture directe.
