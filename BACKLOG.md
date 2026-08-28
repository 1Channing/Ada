# BACKLOG — chantiers différés, à ne pas oublier

Décisions actées en discussion d'architecture (juillet 2026). Chaque entrée
note pourquoi elle a été différée et ce qui la débloquera.

## CRITÈRE PERMANENT — grille d'évaluation des NOUVEAUX SITES (acté 28/08)

Décision Channing 28/08 (chantier vélocité) : avant d'intégrer un site,
vérifier et consigner deux capacités — elles conditionnent la vraie
vélocité (âge du stock) au lieu du proxy par disparition :
1. **Date de mise en ligne par annonce** : exposée où (liste / détail),
   sous quelle forme (ISO exact, jour, relatif « il y a X ») ;
2. **Tri « plus récentes d'abord »** : paramètre d'URL prouvé par URL
   humaine.
Sondes du 28/08 sur les 10 moteurs actuels (probe-dates2, lecture seule) :
Subito datePublished ISO exact en liste ; Marktplaats date au jour en
liste + facette offeredSince ; Jófogás date au jour ; Skelbiu relatif
(« prieš X ») ; LBC affiche « Publié il y a X » (donnée exacte côté
détail) ; AS24 facette onlineSince (pas de date par annonce en liste) ;
Bilbasen/mobile.de/Gaspedaal/Blocket : rien de probant en liste.

## -1. CARTE EUROPE DU RÉSEAU + OUTIL D'INTÉGRATION DE SITES (proposé 18/08, en attente de validation Channing)

Deux chantiers liés, proposition détaillée envoyée le 18/08 (voir la
discussion de session) :

**A. Carte Europe interactive du réseau** — page carte (SVG maison,
pan/zoom fluide) avec les contacts Acheteur/Vendeur épinglés, leurs
marques/modèles suivis (clés canoniques partagées avec le MI et le
référentiel), lien vitrine, panneau dépliant par contact pour ne pas
surcharger. Filtre par modèle → « qui achète / qui vend ce modèle » en un
regard ; realtime Supabase. Phase ultérieure : croisement automatique
opportunités ↔ contacts (à qui vendre / où acheter dès qu'une annonce
sort). Tables additives : network_contacts + network_contact_models.
Beaucoup de vitrines vivent sur des marketplaces déjà adaptées (page
marchand mobile.de / AS24 / boutique LBC…) : leur scraping réutilise les
adaptateurs existants tel quel.

**B. Outil d'intégration assistée de nouveaux sites** (« recon
industrialisée ») — pipeline en 4 étages : photographie (reconScrape,
EXISTE) → analyse déterministe des blobs embarqués (scoring annonce-like,
inférence des chemins de champs, pagination, devise — listingScore existe
déjà) → étage LLM API Anthropic pour trancher les cas ambigus (le LLM
PROPOSE, le scrape DÉCIDE — principe 4bis inchangé ; prérequis : crédits
API Railway) → recette rejouée sur page de contrôle puis écriture d'une
CONFIG d'adaptateur générique en base (un seul code, N sites). Les
marketplaces majeures gardent leurs adaptateurs taillés main ; l'outil
vise les vitrines propres des contacts et les sites secondaires.

**Cas de test acté (Channing 18/08) : La Centrale (lacentrale.fr)** —
2ᵉ source France utile en soi ET banc d'essai de l'outil. NB : grande
marketplace derrière protection anti-bot sérieuse (famille Datadome comme
LBC) — passer par le mode navigateur Zyte dès la recon.

## -2. CRITÈRE CARROSSERIE (demandé Channing 27/08 — Corolla GR Sport NL)

Une étude « Corolla GR sport hybride 2022 » rend hatchback ET Touring
Sports — les deux cochent tous les critères actuels. Pour cibler une
silhouette, il faut un critère CARROSSERIE de bout en bout :
daily_searches + MI (filtre) + SearchCriteria + grammaires par site
(Gaspedaal « Carrosserie=Hatchback » vu en screenshot 27/08 ; les autres
sites à PROUVER par URLs humaines, comme d'habitude — rien sans preuve),
post-filtre lecture (champ structuré carrosserie déjà présent sur
plusieurs sites), détecteur famille + matrice au gate. Différé : demande
la collecte d'URLs-preuves par site avant tout code.

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

## 0-FAIT (confirmé Channing 18/08). REFONTE DE L'INTERFACE ADA

Clos par Channing (18/08/2026) : « la refonte a déjà été faite depuis,
l'interface est bien pour le moment ». Les principes restent (composants
autonomes, signalements `ada_feedback` dépilés à chaque session).

Titre d'origine : REFONTE COMPLÈTE DE L'INTERFACE ADA (acté 19/07/2026)

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

## 0ter-FAIT (01/08). Marktplaats : hybride rechargeable filtré ET confirmable — LIVRÉ

Les trois trous sont bouchés et la RECETTE LIVE est passée : l'URL humaine
Sportage rejouée via le worker rend 7 annonces (= le site), plus 19.
Diagnostic d'origine conservé ci-dessous pour référence.

Suite directe du 0bis. L'API LRP a bien réglé le fond, mais trois trous
subsistent sur le carburant. Diagnostic complet ci-dessous — tout est prouvé,
il n'y a rien à re-chercher.

**Le cas d'essai** (URL humaine de Channing, Kia Sportage GT Line 2023) :
`/l/auto-s/kia/q/gt+line/f/sportage+hybride-elektrisch-benzine/892+13838/#f:13956|constructionYearFrom:2023|constructionYearTo:2023|mileageTo:90001`
Le site affiche **7** annonces (toutes rechargeables) ; ADA en a scrapé **19**
(hybrides complets + rechargeables). L'écart EST le bug.

**Trou 1 — la facette du hash est ignorée.** `marktplaatsFacetIds()`
(worker/scraper.ts) ne lit que le CHEMIN :
`url.match(/\/f\/[^/#?]+\/([0-9+]+)/)`. Or l'interface range le sous-type
hybride dans le HASH (`#f:13956`), pas dans le chemin. La facette est donc
perdue avant l'appel API. À corriger : lire aussi `#f:<id>` (et `|f:<id>`).
`buildLrpUrl` accepte déjà une liste libre (`attributesById[]`) — rien d'autre
à changer côté transport. **C'est le correctif à plus fort rendement : à lui
seul il ramène l'URL ci-dessus de 19 à 7.**

**Trou 2 — le générateur ne connaît pas le rechargeable.** `FUEL_FACET`
(marketplaces/marktplaats.ts) ne contient que `ELECTRIQUE → elektrisch/11756`
et `HYBRIDE → hybride-elektrisch-benzine/13838`. Rien pour `PLUG_IN_HYBRID` →
aucune facette carburant émise (URL générée nue : `f/sportage/892/`).
À faire : `PLUG_IN_HYBRID` = famille `13838` dans le CHEMIN + sous-type
`13956` dans le HASH — c'est exactement la disposition de l'URL humaine, donc
aucune invention. Idem `MILD_HYBRID → 13954`. `HYBRIDE` garde `13838` seul
(chez ADA c'est la famille, c'est déjà juste). Lire les ids depuis le
dictionnaire APPRIS en priorité, graines prouvées en repli.

**Trou 3 — le rechargeable n'est PAS confirmable au niveau annonce.** Le site
étiquette chaque annonce avec la FAMILLE (« Hybride Elektrisch/Benzine »),
jamais « plug-in » — vérifié sur des annonces dont le titre dit pourtant
« Plug-in Hybrid GT-Line ». La confirmation champ-par-champ compare donc
`PLUG_IN_HYBRID` déclaré à « Hybride Elektrisch/Benzine » observé → 0 %,
verdict « jeté », et l'URL n'est jamais mémorisée comme réutilisable. Ce sera
vrai ÉTERNELLEMENT, même une fois les trous 1 et 2 bouchés. À faire : rendre
la comparaison hiérarchique (la famille observée CONFIRME le sous-type
déclaré, elle ne le contredit pas) — le principe existe déjà dans
`fuelFilterMatches` (marketData.ts : HYBRIDE englobe phev et mild), le
réutiliser plutôt que d'en écrire un second. Corroboration possible par le
titre. Verdict cible : « retenu (famille) », pas « jeté ».

**Codes déjà appris** (moisson LRP du 30/07, et confirmés par l'URL humaine) :
```
mp:facet:fuel        Hybride Elektrisch/Benzine → 13838   (chemin)
mp:facet:hybridType  Plug-in hybride            → 13956   (hash)
                     Volledig hybride           → 13955
                     Half hybride               → 13954
```

**Critère de recette** : rejouer l'URL du cas d'essai via le worker doit
renvoyer **7** annonces, pas 19. Tant que ce n'est pas le cas, c'est raté.

**Piste pour généraliser** (pas nécessaire ici) : la sonde `[MP_LRP_TAXO]` a
montré que chaque valeur de facette porte un drapeau `isValuableForSeo` —
c'est lui qui décide chemin vs hash. Le moissonner permettrait de placer
n'importe quelle facette au bon endroit automatiquement, au lieu de le savoir
au cas par cas.

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

FAIT AUSSI (constaté 18/08) : **Marktplaats et Bilbasen** parsent désormais le
`__NEXT_DATA__` structuré en stratégie 0 (regex cards en repli). Mesuré sur
les observations du 15-18/08 : Marktplaats 1 000 obs → marque 100 %, carburant
99 %, boîte 99 % (puissance 23 % — souvent absente des annonces NL) ;
Bilbasen 760 obs → 100 % sur les quatre champs. Parité Leboncoin atteinte.

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

## 4sexies. Accidentées — exclusion À LA SOURCE dans les URLs (différé, acté 01/08)

Le nettoyage à la LECTURE est livré (01/08) : détecteur négation-d'abord
`isDamagedVehicleText` (business-logic) branché sur le MI, les études
quotidiennes et le radar SQL — mesuré sur 187 k obs : 129 vraies accidentées
en titre, 1 422 « NON accidenté » + 88 « Unfallfrei » = saines à ne jamais
jeter. Décision Channing : « pour le moment les gens trieront d'eux-mêmes,
on améliorera plus tard ».

Reste, quand on s'y remet : exclure côté URL sur les sites qui ont un filtre
natif « sans véhicules endommagés » (AutoScout, Mobile.de au moins). Règle
d'empirisme : AUCUN paramètre écrit sans preuve — demander à Channing une URL
humaine avec le filtre coché par site, ou la valider par scrape comparatif
(même recherche avec/sans le paramètre, compter). Gain : les accidentées ne
consommeront plus de place dans les 3 pages scrapées (elles trustent le bas
du tri prix croissant).

## 4ter. MI différés (validés sur le principe 21/07, « pas d'urgence »)

- **Carte de couverture** : onglet MI, grille modèle × pays colorée par
  fraîcheur du dernier snapshot, bouton « campagne sur les trous » qui
  pré-remplit le formulaire existant. Zéro nouvelle table.
- **Tendances** : sparkline médiane 8 semaines dans les cartes modèle du MI
  (flèche + % variation), courbe complète dans le panneau détail.

## 4quater-FAIT (22/07). Référentiel fenêtres de commercialisation — LIVRÉ

Base Teoalida « Cars sold in Europe » achetée et importée (3 939 générations,
211 marques, + verrous manuels Yaris Cross/Ignis/TGE). **Source of truth
~98 %** (acté Channing) → contrat FAIL-OPEN partout : un modèle absent du
référentiel n'est jamais filtré. Planificateur : années hors fenêtre
écartées + EXPANSION automatique (modèles jamais étudiés, part plafonnée à
30 % de l'exploration — la mémoire reste prioritaire). Marchés vides hors
fenêtre auto-expliqués. MI : fenêtre affichée sous les filtres.
Réimport annuel : scripts/teoalida/import_teoalida.py (mises à jour
gratuites 1 an — signaler à Teoalida les manques observés, journal des
« hors référentiel » à surveiller en revue quotidienne).

RESTE (chantier finitions) : traduction des finitions entre pays — exige la
base « European Car Database » Teoalida (niveau versions, colonnes Engine
version/subversion, source ADAC, finitions réelles M Sportpaket/Executive…)
NON achetée à ce stade. Une fois achetée : dictionnaire pivot (ADAC) ×
graphies observées par pays × clustering LLM (lot 4bis), et dans le MI
l'équivalent français affiché discrètement à côté de la finition étrangère
sélectionnée.

## 4quater. Référentiel constructeur (intervalles / motorisations / finitions)

Décision Channing (21/07) : s'appuyer sur une BASE EXTERNE FIABLE (pas
d'inférence depuis nos observations — l'indisponibilité pluriannuelle d'un
modèle existant rendrait l'absence d'annonces trompeuse). Usage : le
planificateur saute les années hors commercialisation (ex. VW Tayron avant
2024) ; les motorisations/finitions servent de dictionnaire pivot pour
croiser les noms de finitions entre pays. Candidats identifiés (bases
téléchargeables à importer en tables de référence Supabase, plutôt qu'une
API payée à l'appel) : car2db.com, teoalida.com (base Europe), auto-data.net
(API générations+années), databases.one. AVANT achat : obtenir un
échantillon et le valider sur nos cas réels (Tayron 2024+, Yaris Cross
2021+, ë-C4). Finitions PAR PAYS = niveau JATO/Autovista (enterprise, cher) —
le croisement pays se fera plutôt : référentiel EU générique + nos
observations par pays.

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

## 6-FAIT (01/08). Typecheck front assaini — LIVRÉ

Zéro erreur ; `npm run gate` (tsc --noEmit puis vite build) est le gate front
officiel, à lancer avant tout push. Inventaire d'origine ci-dessous.

**Pourquoi c'est au backlog** : `npm run build` (vite/esbuild) ne vérifie PAS
les identifiants — un nom non importé compile sans broncher et explose au
rendu. C'est ce qui a mis la page Résultats du Workflow en écran blanc le
30/07 (`inboxToProcess` appelé sans être importé). `npm run typecheck`
(`tsc --noEmit -p tsconfig.app.json`) le signalait à la ligne exacte, mais il
rend 94 erreurs préexistantes : inexploitable comme gate, donc jamais lancé.
Objectif du chantier : **zéro erreur**, puis typecheck obligatoire avant tout
push touchant le front.

Inventaire au 30/07 (94 erreurs), par ordre de rentabilité :

1. **≈80 erreurs vivent dans du code MORT** — aucun de ces fichiers n'est
   référencé par quoi que ce soit (vérifié) : `pages/StudiesV2Negotiations`,
   `pages/StudiesV2Sales`, `pages/StudiesV2MakesStudies`,
   `pages/ListingsHistory`, `pages/Dashboard`, `services/studyRunLogs`,
   `services/remoteStudyRunner`, `components/StudyRunsPanel`. Vestiges de
   l'ancien moteur d'études, remplacés par le Workflow. Les supprimer vide
   l'essentiel du bruit d'un coup. À vérifier avant : le worker garde un
   endpoint `/execute-studies` qui lit `studies_v2` et que plus rien n'appelle
   côté front — le retirer ou le documenter comme mort.
2. **8 tables réelles absentes de `database.types.ts`** (existence confirmée en
   base, HTTP 200 sur chacune) : `study_source_listings`, `study_run_logs`,
   `sales`, `scheduled_study_runs`, `negotiation_notes`,
   `vehicle_ref_motorisations`, `vehicle_ref_generations`,
   `study_run_results`. Mécanique : `from('x')` inconnue → `SelectQueryError` →
   chaque colonne lue produit sa propre erreur (5-6 par table). Aucun effet à
   l'exécution (le client interroge la vraie base), mais TypeScript ne vérifie
   plus rien dans ces fichiers. Après le point 1, seules
   `vehicle_ref_generations` et `vehicle_ref_motorisations` restent utilisées
   (référentiel + planificateur de campagnes) : ce sont les deux à typer.
3. **43 erreurs de ménage pur** (TS6133/6192/6196 — variables et imports
   jamais lus), dont 18 dans `pages/LinkGenerator.tsx`. Sans effet, mais
   c'est 46 % du bruit.
4. **Une seule erreur dans du code vivant et critique** :
   `lib/linkgen/taxonomy.ts:52` — l'`upsert` de la moisson passe un
   `Record<string, unknown>[]` là où le type attend
   `{site, field, code, label}[]`. Fonctionne, mais la forme de ce qu'on écrit
   au dictionnaire de taxonomie (13 470 entrées) n'est plus garantie. À typer
   proprement, c'est le chemin le plus chaud du système.

En attendant ce chantier, garde-fou minimal avant push front :
`npm run typecheck 2>&1 | grep -E "TS2304|TS2305|TS2552|TS2724"` — les classes
d'erreur qui produisent une page blanche. Doit rester vide.

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
