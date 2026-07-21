# BACKLOG — chantiers différés, à ne pas oublier

Décisions actées en discussion d'architecture (juillet 2026). Chaque entrée
note pourquoi elle a été différée et ce qui la débloquera.

## PRINCIPE DIRECTEUR — travail CHIRURGICAL sur les données de mapping

Acté par Channing (19/07/2026) : la qualité des données qui entrent en
mapping/market data est **notre valeur ajoutée** — chaque correction se fait
au scalpel, jamais à la hache. Concrètement :
- Ne jamais jeter ni écraser une donnée captée : on la stocke fidèlement et
  on corrige la LECTURE (canonicalisation, filtres) plutôt que de filtrer à
  l'écriture.
- Une donnée douteuse est étiquetée douteuse (confirmation champ-par-champ),
  pas supprimée ; une réparation rétroactive est scopée par un motif précis
  et réversible.
- Chaque canonicaliseur (carburant, boîte, couleur…) couvre les langues des
  sites qu'on scrape — un libellé non reconnu doit remonter en lacune,
  jamais retomber silencieusement dans une mauvaise catégorie (cf. bug
  « Electro/Gasolina » → électrique du 19/07).
- Les mappings ne s'écrivent en mémoire que confirmés par échantillon ou par
  un humain ; l'auto-correction propose, la donnée dispose.

## 0. REFONTE COMPLÈTE DE L'INTERFACE ADA (acté 19/07/2026, à garder en tête)

Demande de Channing : revoir l'interface complète d'ADA — enchaînement propre
des pages, UI à jour et cohérente, navigation fluide entre Studies / Admin /
Link Generator / Ingestion / Historique / Market Intelligence. À traiter comme
un chantier dédié (design system, routing propre au lieu du
`window.location.reload()`, hiérarchie visuelle, densité des panneaux).
**À garder en tête pendant tout développement d'ici là** : chaque nouvel écran
doit rester simple à re-brancher dans la future structure (composants
autonomes, pas de dépendance au layout actuel). Les signalements déposés via
le bouton « Signaler » (table `ada_feedback`) nourrissent ce chantier —
les dépiler en priorité à chaque session de dev.

## 0bis. Marktplaats : le hash (#q:…|constructionYear…) n'atteint JAMAIS le serveur

Découverte majeure (logs campagne 19/07/2026) : une recherche RAV4 2024 a
renvoyé des Aygo 2017 — le fragment `#q:…|constructionYearFrom:…` est
client-side only. Le HTML servi (et son `__NEXT_DATA__`, même en mode browser
Zyte : le script SSR n'est pas réécrit par l'hydratation) contient la page
marque NON filtrée. Toutes les données Marktplaats de campagne étaient donc
non filtrées — heureusement bloquées par la confirmation (`snapshot skipped`).
Plan proposé (à valider) : passer par l'API JSON interne `lrp/api/search`
avec de VRAIS paramètres serveur (query, attributeRanges constructionYear,
l1/l2CategoryId lus du `__NEXT_DATA__` de la page marque), et apprendre les
IDs dans le dictionnaire enum. Voir discussion « plan auto-correction ».

## 1. Vocabulaire de détection carburant (prioritaire dès les premières ingestions)

La confirmation carburant de la page Ingestion échouera souvent au début :
les vendeurs écrivent la motorisation ("2.0 TDI", "1.5 TSI") sans le mot
"diesel"/"essence". Enrichir les détecteurs `inferFuel` par site :

- TDI, HDi, BlueHDi, dCi, CDI, CRDi, d4d/D-4D → diesel
- TSI, TFSI, VTi, PureTech, TCe, GDI, vvt-i → essence
- e-Power, e:HEV, HSD → hybride ; kWh, autonomie/range/rækkevidde → électrique
- Attention aux langues : liste par site (FR Leboncoin, NL Marktplaats, DA Bilbasen).
- Lacune déjà constatée en smoke test : le détecteur Marktplaats cherche
  `electr` et rate le néerlandais `elektrisch` (k) — une annonce électrique
  NL sort en "indétecté".

Fichiers : `src/lib/study-core/marketplaces/{leboncoin,marktplaats,bilbasen}.ts`
(méthode `inferFuel`) + `fallbackInferFuel` dans `src/lib/study-core/ingestion.ts`.
Les événements `linkgen_ingestion_events.discarded` (raison mentionnant le
carburant) diront quels tokens manquent en priorité.

## 2. Extraction structurée des champs secondaires — Marktplaats & Bilbasen

FAIT pour Leboncoin (juillet 2026) : `ScrapedListing` porte désormais
`gearbox`, `powerDin`, `doors`, `seats`, `color`, `vehicleType` (optionnels),
extraits des attributs `__NEXT_DATA__` par le parser Leboncoin (lecteur
robuste tolérant forme tableau `[{key,value,value_label}]` ET forme objet).
La page Ingestion les confirme en méthode "structured".

FAIT AUSSI (juillet 2026) : marque + carburant confirmés en STRUCTURÉ sur
Leboncoin (attributs `brand`/`fuel` de `__NEXT_DATA__`), avec repli texte. Ça
règle les cas fréquents où le titre omet la marque ("Megane E-Tech" sans
"Renault") ou l'énergie. `canonicalizeFuel` gère FR/NL/DA + badges moteur
(TDI/TSI…) et sépare hybride vs hybride rechargeable (PHEV strict).

RESTE À FAIRE : les parsers **Marktplaats et Bilbasen** ne peuplent pas encore
les champs structurés (marque/carburant/boîte/puissance…) — extraction par
regex de cards, pas de JSON structuré fiable. Donc sur ces deux sites, marque
et carburant retombent sur le TEXTE du titre (moins fiable) et les champs
secondaires ressortent "jeté — données structurées insuffisantes". Il faudra
ajouter leur extraction structurée pour parité avec Leboncoin.

## 2bis. Génération d'URL depuis les mappings secondaires appris

L'ingestion apprend et mémorise `gearbox=2 → Automatique`, `horse_power_din`,
etc. (dans `inferred_mapping.fieldToParam`), mais `generateSearchUrlsWithMemory`
ne sait pas encore réinjecter ces filtres secondaires dans une URL générée
(les templates ne portent que brand/model/year/mileage/fuel/trim). Câbler la
reconstruction pour exploiter les codes opaques appris (boîte, puissance,
couleur, type) quand on génère une recherche.

## 2ter. Scraping détail par annonce + amélioration de la lecture (différé, acté)

Décision (juillet 2026) : on NE scrape PAS la page détail de chaque annonce à
l'ingestion (30× appels Zyte, trop coûteux/lent pour 5 contributeurs). La
finition par annonce est extraite du STRUCTURÉ de la page de résultats
(`version`/`finition` dans `__NEXT_DATA__` Leboncoin). À faire plus tard, en
mode "approfondi" EXPLICITE (pas par défaut), et seulement quand une info
manque vraiment du structuré : réutiliser `parseDetailPage`/`scrapeDetailPage`
du worker (déjà fait pour les études).

À AMÉLIORER (demandé) : la lecture/robustesse du scraping. Pistes sans accès
aux logs prod : ajouter dans le parser un log des clés d'attributs
TROUVÉES vs ATTENDUES par annonce (pour repérer un renommage de clé Leboncoin),
exposer un échantillon d'attributs bruts dans la réponse `/ingest-url` en mode
debug, et calibrer les clés (`version`, `vehicle_color`, etc.) sur un vrai
sample. Quand Channing colle un échantillon ou un log worker, on ajuste.

## 2quater. AutoScout24 — calibration parser + trim, puis mobile.de

FAIT (juillet 2026) : adaptateur **AutoScout24** (classe « lisible », patron
Leboncoin) enregistré en **6 instances pays** (FR/DE/NL/IT/ES/BE) via factory,
chacune avec son `countryCode` → alimente la comparaison multi-pays. Taxonomie
publique câblée : path `/lst/{marque}/{modèle}`, `cy`, `fregfrom/to`, `kmto`,
`fuel` (B/D/E/2/3/L/C), `gear` (A/M/S), `powerfrom`. Parser `__NEXT_DATA__`
tolérant + parser routé par hostname `autoscout24.*`. Smoke test 24/24.

RÉSOLU (juillet 2026) : « Error Pages » sur autoscout24.**be** uniquement — pas
un anti-bot (les autres pays passent). Cause : la Belgique est bilingue et exige
un **préfixe de langue** dans le path (`/fr/lst/…` ou `/nl/lst/…`) ; le bare
`/lst/…` renvoie une page d'erreur. Corrigé via `CountryCfg.pathPrefix` (BE →
`/fr`). Les domaines monolingues (.fr/.de/.nl/.it/.es) n'en ont pas besoin.
NB : le diagnostic `[AUTOSCOUT_RUNTIME]` et la détection de blocage scindée
(forts vs faibles <50 KB) restent utiles et sont conservés.

RESTE À FAIRE (quand la récolte passera) :
- **Calibrer le parser sur un vrai échantillon** : les clés `__NEXT_DATA__`
  (`props.pageProps.listings`, `vehicle.modelVersionInput`, `tracking.*`,
  `vehicleDetails[].iconName`) sont des hypothèses — AS24 est derrière
  Cloudflare, non atteignable au design. Le parser logge `first listing keys`
  et `parser_failed_on_html` : au 1er scrape Railway, lire ces logs et ajuster
  les chemins si besoin. Channing colle un lien AS24 filtré → on cale.
- **Trim non injecté dans l'URL** : AS24 n'a pas de filtre texte-libre fiable ;
  la finition est confirmée sur le texte des annonces (warning émis), pas dans
  l'URL générée. Explorer `body`/équipements si besoin plus tard.
- **PHEV vs hybride** : `fuel=2` couvre l'hybride essence ; le plug-in strict
  a un flag séparé chez AS24 (non câblé) — PHEV retombe sur `2` pour l'instant.
- **mobile.de (2.a, à suivre)** : classe ID opaque (`makeId`/`modelId`
  numériques), patron Marktplaats — marque/modèle appris à l'ingestion, pas de
  seed. Carburant (`fuels` PETROL/DIESEL/…), boîte (`transmission`), année
  (`minFirstRegistrationDate` YYYY-MM-DD), km (`maxMileage`) mappables direct.
  Option seed via harvest-worker (Zyte atteint mobile.de) si on veut amorcer.

## 2quinquies. Canonicalisation multilingue des champs enum secondaires

FAIT (juillet 2026) : `canonicalizeGearbox` (automatic/manual/semi) gère
Automatik(DE)/Automatique(FR)/Automaat(NL)/Automatic(EN) + codes (A/M/S) +
boîtes (DSG/CVT/DCT…). La confirmation boîte matche désormais en token canonique
(fini le « 0/58 jeté » sur AutoScout DE).

RESTE : **couleur** et **type de véhicule** subissent le même écart de langue
sur les sites étrangers (Schwarz≠Noir, Limousine≠Berline). Ajouter des
canonicaliseurs équivalents (tables couleur FR/DE/NL/IT/ES, carrosserie) et les
passer à `confirmStructuredLabel` comme pour la boîte. Non bloquant (ces champs
sont optionnels), mais à faire pour la parité multilingue complète.

## 3. Reconstruction d'URL path-based depuis la mémoire (Marktplaats)

L'ingestion mémorise les IDs de taxonomie Marktplaats
(`_path:model_id` → `1232`), mais `generateSearchUrlsWithMemory` ne sait
reconstruire que des URLs à templates query/hash. Écrire le reconstructeur
path-based (`/{brandSlug}/f/{...}/{ids}/`) pour exploiter ces mappings —
c'est le débouché naturel des ingestions Marktplaats.

## 4. Découpage des clusters de facettes Marktplaats

Un segment d'IDs (`1232+13838`) combine plusieurs facettes. Aujourd'hui, si le
scraping ne confirme pas TOUTES les facettes d'un cluster, on jette les IDs de
facette ambigus (jamais d'attribution partielle non justifiable). Plusieurs
ingestions du même modèle avec des filtres différents permettraient d'isoler
chaque ID par différence d'ensembles — à concevoir quand il y aura du volume.

## RITUEL RÉCURRENT — dépiler les logs techniques (`worker_logs`)

Acté par Channing (21/07/2026) : en plus de la revue quotidienne de la boîte
noire (`linkgen_error_dossiers`), **vérifier de temps en temps les logs
techniques du worker** (`worker_logs` : warn/error console, rétention 14 j).
Réflexe à avoir à chaque session de dev — et systématiquement quand un
comportement étrange est signalé (campagne qui coince, blocages Cloudflare
en série, worker qui redémarre). Accès direct via `ADA_SUPABASE_URL` +
`ADA_SUPABASE_ANON_KEY` (variables de l'environnement Claude Code) ; au
21/07, l'accès réseau de l'environnement restait à ouvrir vers
`*.supabase.co` — à re-vérifier à la prochaine session ("vérifie l'accès
aux logs").

## 4bis. API de correction assistée par LLM (validée sur le principe, 21/07)

Brancher l'API Anthropic dans la boucle d'auto-correction, en respectant le
principe directeur (le LLM PROPOSE, le scrape DÉCIDE — jamais d'écriture
directe de mapping par le modèle) :

- **Étage 1 — hypothèses "H3"** : face à un dossier d'échec en campagne, un
  modèle rapide et peu coûteux (Haiku) propose slug/paramètre/graphie ; la
  proposition entre dans la même file de vérification que H1/H2 (1 scrape max,
  écriture en mémoire uniquement si le scrape confirme).
- **Étage 2 — analyse du digest quotidien** : un modèle plus capable analyse
  la boîte noire et produit une liste d'actions proposées (dont brouillons de
  correctifs de code — revue et déploiement restent humains).
- Prérequis : clé API Anthropic + budget dans les variables Railway ;
  s'appuie sur `worker_logs` + `linkgen_error_dossiers` comme matière.

## 5. Rappels de chantiers déjà actés ailleurs

- `parseDetailPage` à intégrer au contrat SiteAdapter (différé lors du
  refactor registre).
- Étape 2 du plan initial : découplage linkgen/supabase.ts par injection,
  puis branchement de linkgen dans le worker (mémoire d'abord, fallback URL
  figée, logging de la voie empruntée).
- TTL / revalidation automatique des mappings `valid` (rejoint le futur
  `market_scan_runs`).
- Taux DKK→EUR : RÉSOLU (juillet 2026). Le parser actif Bilbasen
  (`parsers/bilbasen.ts` + `shared.ts`) renvoyait un prix DÉJÀ en EUR mais
  étiqueté `currency:'DKK'` → chaque `toEur()` en aval re-convertissait (prix
  danois ÷ ~7,5). Corrigé : le prix est stocké en EUR (`currency:'EUR'`),
  conversion unique à l'extraction, taux unifié à 0.134 (shared.ts,
  business-logic.ts, marketData.ts). Les TROIS copies du parser Bilbasen ont
  été corrigées à l'identique (currency 'EUR' + taux 0.134) : `parsers/bilbasen.ts`
  (active), `scrapingImpl.ts` et `scraperClient.ts` (legacy). Reste la dette des
  copies dupliquées elles-mêmes (à unifier/supprimer lors du nettoyage, hors
  périmètre DKK).
- `generated_urls` (2b) : à spécifier soigneusement avec Channing avant
  implémentation — pièce centrale, ne pas bâcler.
