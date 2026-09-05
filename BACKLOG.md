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
Sondes du 28/08 sur les 10 moteurs actuels (probe-dates 1/2/3, lecture
seule — pages de liste ET de détail) :
- EN LISTE : Subito `datePublished` ISO seconde ; Gaspedaal
  `data-published-date` ISO minute (attribut de chaque carte) ;
  Marktplaats `date` au jour (+ Vandaag/Gisteren, facette offeredSince) ;
  Jófogás `date` au jour ; Skelbiu relatif « prieš X val./d. » ; LBC
  relatif affiché « Publié il y a X » (exact attendu côté détail).
- AU DÉTAIL SEULEMENT : AS24 `createdTimestampWithOffset` ISO ms ;
  Bilbasen `publicationDate` ISO (+ lastUpdateDate).
- AUCUN MARQUEUR (liste ni détail) : mobile.de, Blocket → naissance =
  notre première observation (first_seen).

## -1. CARTE EUROPE DU RÉSEAU + OUTIL D'INTÉGRATION DE SITES (proposé 18/08 — carte RÉSERVÉE par Channing 03/09 pour une session dédiée de 2 h)

**Exigence actée 03/09 pour la carte : UI magnifique et fluide, carte
interactive (pan/zoom, épingles, panneaux dépliants, filtres en direct) —
fond cartographique vectoriel (MapLibre/OSM) ou SVG maison selon la
fluidité mesurée ; rien de « tableau déguisé ».**

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

**CORPUS D'URLS-PREUVES COMPLET fourni par Channing le 29/08** (posées à
la main dans l'interface du site — la grammaire ci-dessous est PROUVÉE,
provenance : cette liste) :
- Base : `/listing` (nu). Modèle : `makesModelsCommercialNames=
  TOYOTA%3A%3ARAV%204` — séparateur DOUBLE deux-points `::`, modèle en
  libellé avec espace (« RAV 4 »).
- Année : `yearMin=2010` / `yearMax=2020` (deux paramètres séparés).
- Km : `mileageMin=10000` / `mileageMax=100000`.
- Puissance : `powerDINMin=200` / `powerDINMax=200` (ch DIN, min et max
  séparés — pas de piège N-max).
- Carburant `energies=` : dies, ess, elec, hyb, **plug_hyb**,
  **not_plug_hyb**, gpl, eth — le site distingue NATIVEMENT rechargeable /
  non-rechargeable : page au sous-type VRAI (à ajouter à SUBTYPE_TRUE_URL
  pour la promotion famille→phev).
- Boîte : `gearbox=AUTO` / `gearbox=MANUAL`.
- Tri : `sortBy=priceAsc` ; `sortBy=firstOnlineDateAsc` (libellé site
  « plus récents » — VÉRIFIER le sens asc/desc à la contre-épreuve). Le
  nom du champ révèle le marqueur vélocité attendu : `firstOnlineDate`
  par annonce.
- Pagination : `page=2` (`freetext_conversationid=&options=` vides =
  bruit d'UI, à ignorer).
- Détail : `/auto-occasion-annonce-{id}.html` (exemples pro 69119344883,
  particulier 66104179750).
- Finitions : `versions=gr%20sport` — PROUVÉ par test Channing 29/08
  (URL modifiée à la main, fonctionne) : valeur en MINUSCULES, espace
  encodé %20, combinable au modèle. L'UI n'offre qu'une facette à
  tokens comptés (2.5, Hybride, Dynamic, Collection…) mais le paramètre
  accepte la forme composée « gr sport » ; vocabulaire du site à
  moissonner quand même (les tokens sont la vérité des libellés).
- URL COMBO COMPLÈTE prouvée (29/08) : `/listing?energies=plug_hyb&
  gearbox=AUTO&makesModelsCommercialNames=TOYOTA%3A%3ARAV%204&
  mileageMax=150000&mileageMin=10000&powerDINMax=150&powerDINMin=150&
  versions=gr%20sport&yearMax=2023&yearMin=2020` — tous les critères
  coexistent en query plate, ordre alphabétique des paramètres posé par
  le site. Le corpus grammatical est COMPLET ; il ne reste que les
  contre-épreuves vivantes (recon durci d'abord).
**INTÉGRÉ le 29/08 (adaptateur LACENTRALE v1, commits 77882fd→302c779)** —
contre-épreuves vivantes : page RAV 4 = 23 annonces parsées en mode
unblocker brut FR (le moins cher), tri prix exact, 23/23 datées
firstOnlineDate (vélocité native au jour), structuré complet ; URL combo
de la preuve = 0 annonce CONFIRMÉ par le marqueur du site (detectEmptyState).
Savoir durci à l'autopsie : références multi-lettres (E/B/W vus) ; id du
lien détail = préfixe 2 chiffres PAR LETTRE + chiffres de la référence
(E→69, B→66, W→87 — 22 paires vérifiées), table apprise des paires de
chaque page, jamais codée en dur ; script du state ENVELOPPÉ dans un bloc
{ … } → extraction à accolades équilibrées. Dictionnaire lc:model:* appris
par moisson (lc:model:toyota « RAV 4 » déjà en base) ; lc:body moissonné
(critère carrosserie pré-câblé). Sens de sortBy CONTRE-ÉPROUVÉ par scrape (30/08 soir) :
firstOnlineDateAsc = ordre CROISSANT, les plus VIEILLES d'abord (23/23
datées, 2023-09 → 2026-02) — « Asc » est littéral, le tri fraîcheur
serait firstOnlineDateDesc (forme symétrique, non encore posée : on trie
priceAsc). powerDIN par annonce absent du hit principal (lu tolérant,
similarHits le portent) — la puissance reste un filtre d'URL.

## AUDIT 05/09 (tour complet, logs 48 h / dossiers / campagnes / snapshots) — CORRIGÉ

Trouvé et corrigé le jour même (preuves vives à chaque fois) :
- **Blocket** : complétude année/km tombée de 80 % à 37 % — la légende de
  carte suit un carrousel de 4 000 à 11 300 caractères, la fenêtre de
  lecture faisait 6 000. Fenêtre = jusqu'à la carte suivante. 18/19 lus.
- **AutoScout24 hybride rechargeable** : le constructeur natif posait
  kwd=PHEV → 0 annonce (Sportage NL 2024 GT line : PHEV 0, plug-in 9,
  famille hybride seule 25). Mot-clé « plug-in » sur les deux voies
  (natif + mémoire), relecture kwd→finition nettoyée.
- **Truth Center « médiane aberrante »** : 21 dossiers à 80/100 nés d'une
  comparaison toutes années confondues (Golf 2024 vs 1.9 TDI 1999). Signal
  recalculé à année égale (migration 20260905160000), dossiers refermés.
- **Totaux AutoScout24/LBC** : 9 relevés sur 10 sans total (profondeur MI
  et Truth Center à l'aveugle) — lecture structurée numberOfResults /
  searchData.total avant les motifs texte.
- **Veille légale** : 16 échecs/jour « credit balance too low » → pause 24 h
  automatique, un seul message. À recharger côté Anthropic.
- **Bruit de logs** : 23 faux conflits taxonomie (accents), conflits d'enum
  répétés à chaque vague → une fois par clé.
Décisions Channing 05/09 (après-midi) :
- **Zyte 520** → DAILY_CONCURRENCY par défaut 2 (vérifier qu'aucune variable
  Railway ne force 3). **RE-CONTRÔLE samedi 12/09 au matin** (rappel programmé
  08 h 40 Paris) : compter les 520 par heure/site sur 7 j, vérifier N/N
  études passées, verdict garder 2 / revenir à 3 / étaler les heures.
- **97 mappings « pending » (import CSV de mai)** : à supprimer — ils ne
  servent qu'au Scout comme hypothèses à tester (memoryHypotheses), jamais
  au registre ni à la génération. SQL donné à Channing (delete … where
  validation_status = 'pending' and source = 'csv_import').
- **Contact assisté** LIVRÉ : menu ⋯ d'une annonce (Résultats) et d'une
  négociation → message dans la langue du pays copié + annonce ouverte ;
  trace « Contacté le … » dans les notes de la négo. Texte validé Channing,
  10 langues (services/contactSeller). Jamais d'envoi automatique.
- **Filtres à ajouter aux études** (demande 05/09) : kilométrage MINI,
  puissance MAX, nombre de portes — grammaire par site à prouver (URLs
  humaines), post-filtre dur comme boîte/carrosserie/puissance.
- **mobile.de filtre pays** : PROUVÉ et LIVRÉ — cn=DE (Toyota 2024 tri
  prix : sans cn 22 DE + 1 FR + 1 IT, avec cn=DE 25 DE, 0 étranger). Posé par
  la politique de site du registre (grammar MOBILE_DE, à chaque passage).
- **La Centrale versions=** : PROUVÉ et LIVRÉ — Sportage 2024 : « gt line »
  2, « gt-line » 71, sans filtre 186, « gt » seul 2 ; pas de multi-valeur
  (virgule/underscore → 0, paramètre répété → ignoré). L'orthographe dépend
  de la finition (« gr sport » Toyota AVEC espace). Étude : si la forme
  demandée rend < 5, essai de l'autre (espace ↔ tiret), on garde celle qui
  répond (log [DAILY] « réécrite à la manière du site »). Le total du site
  est lu dans l'état de recherche ("total":N,"nextTotal", à 46 % de la page).
- **LBC u_car_model à virgules = total 0** (constat Channing 05/09, MI FR
  Corolla Cross à 0) : sans code appris, l'adaptateur envoyait SIX devinettes
  à virgules ; LBC rend 0 dès qu'un membre est invalide (toutes les lignes
  « No ads array (total=0) » du journal). Découverte = UN candidat
  « MARQUE_Forme du site » (Titre pour les mots, MAJUSCULES pour sigles et
  codes chiffrés, i minuscule BMW, « Classe X » Mercedes — lu sur 292 codes
  appris) ; politique de site du registre : une liste héritée (152 URLs
  mémoire validées) est réduite à son meilleur membre, en place.
- **Lenteur LBC dans les mises à jour MI** : les sites d'une mise à jour
  tournent déjà en parallèle (un job par site) ; ce qui dure, c'est LBC en
  mode navigateur (5 pages séquentielles × 15-40 s) et les retries sur
  Zyte 520 (8/16/24 s) — et La Centrale/Datadome, qui était le site
  manquant du « 2/3 ». LIVRÉ : pages 2..N par paires en parallèle
  (recollées dans l'ordre, bornées par le total du site) — LBC 5 pages
  passe d'environ 5×T à 3×T. Mode brut SONDÉ 05/09 (3 pages) : quand il
  répond entier c'est 3× plus vite (X3 : 5 s vs 15 s, 35 annonces des deux
  côtés) mais 2 fois sur 3 il rend une page tronquée (476-605 Ko sans le
  tableau d'annonces) → pas de bascule ; à re-sonder sur 10 pages un jour
  calme avant toute décision (une page tronquée en pagination = profondeur
  perdue en silence).
- **Sites en parallèle** (question Channing 05/09 « un site puis l'autre ? ») :
  une étude quotidienne scrape désormais TOUS ses sites en même temps, et
  ses deux pays ensemble (source + cible) ; les mises à jour MI l'étaient
  déjà (un job par site). Régulation à la source : plafond global de
  requêtes Zyte en vol (ZYTE_MAX_PARALLEL, défaut 6, env Railway) — au-delà,
  les requêtes attendent leur tour. Vague : 2 études × 6 sites × pages par
  paires → jamais plus de 6 rendus Zyte à la fois. Re-contrôle 520 le 12/09.
Constaté, laissé tel quel (sain ou à décider) :
- Zyte 520 en rafale à 05 h (81 le 05/09, AS_NL + LBC) : les retries
  absorbent (50/50 études passées) mais ça coûte des requêtes. Si ça
  persiste : DAILY_CONCURRENCY=2 (env Railway), ou étaler les heures.
- LBC « page servie sans annonces » (total > 0) : soft-block, le retry
  récupère (Yaris Cross : 53 annonces au bilan). Rien à faire.
- mobile.de sert des annonces IT/NL/BE/LU/DK écartées (≤ 50/48 h) : voir si
  l'URL accepte un filtre pays (sonde à faire).
- 97 mappings « pending » d'un import CSV de mai (LBC/MP/Bilbasen) : morts,
  à purger ou à valider par les cas dorés (décision Channing).
- La Centrale « versions=gt line » rend 0 là où LBC en voit 6-12 : sonde
  impossible aujourd'hui (Zyte 520 sur lacentrale) — à refaire.

## -1quater-PROPOSÉ (03/09, en attente GO). TRAJECTOIRE DE PRIX × VÉLOCITÉ

Question Channing 03/09 (déclenchée par « 309 baisses » du digest) : « si le
véhicule sort à son premier prix affiché, ce n'est pas la même chose
qu'après neuf baisses » — les sites enregistrent-ils les baisses, et peut-on
en faire un indicateur par modèle ? Sondes vives du jour (16 sites, pages
liste ET détail, annonces dont ADA avait lui-même observé une baisse) :
- **Historique COMPLET natif** : La Centrale (page détail uniquement —
  `priceVariation.prices` : initial, current, percentage, history[],
  isDropping + `displayedAge` en jours). Absent de la liste.
- **Ancien prix dans la LISTE déjà scrapée** (coût zéro) : Leboncoin
  (attribut `old_price` par annonce, 9 sur 45 Yaris Cross ; badge « Baisse de
  prix » sur la carte), AutoScout24 tous pays (`superDeal.isEligible` +
  `oldSuperDealPrice` « € 17 990,- », badge « Prix réduit »).
- **Drapeau sans montant** : mobile.de (filtre `ao=PRICE_REDUCED`
  « Reduzierter Preis » ; la carte n'affiche pas l'ancien prix).
- **Rien d'affiché** (ADA a pourtant vu la baisse) : Bilbasen, Subito,
  Skelbiu (seulement une alerte « suivre la baisse »), Marktplaats, Blocket,
  Gaspedaal, Jófogás.
- **Date de mise en ligne** (déjà captée `published_at` : LBC, La Centrale,
  Subito, Gaspedaal, Marktplaats, Jófogás, Skelbiu) — à AJOUTER : Bilbasen
  (`publicationDate` + `lastUpdateDate`), AutoScout24
  (`createdTimestampWithOffset`, détail), mobile.de (filtre `doc` « online
  seit », pas de date par carte).
- **Ce qu'ADA sait déjà seul** : une observation par annonce et par
  passage → toute baisse vue pendant la fenêtre d'observation est déjà
  calculable (c'est ainsi que les 309 sont comptées), et la disparition
  date la sortie. Ce qui manque : les baisses ANTÉRIEURES à la première vue
  (l'ancien prix des sites comble ce trou sur LBC / AS24 / La Centrale).
Proposition (pas de code avant GO) : (1) capter `previous_price` en liste
sur LBC + AS24 (+ `published_at` Bilbasen/AS24) ; (2) table
`listing_price_paths` (une ligne par annonce : prix initial, prix courant,
nb de baisses, % cumulé, jours en ligne, sortie datée) alimentée par le
worker depuis les observations + l'ancien prix des sites ; (3) indicateur
MI par segment : « % des sorties après ≥1 baisse », « remise médiane avant
sortie », « jours médians avant 1re baisse », en croisant avec la vélocité
existante (velocityFromObservations). Aucun scrape supplémentaire, aucun
LLM. La Centrale (détail) réservée à la fiche négociations, pas au flux.

## -1ter-LIVRÉ (03/09, à éprouver). TRUTH CENTER briques 3b / 4 / 5

GO Channing 03/09 (« game changer, aucune pollution possible ? » — 3b et 5
sont en lecture seule ; 4 écrit mais verrouillé par la preuve). Migration
20260904100000 (truth_confidence, truth_digests, truth_golden). Le worker
enchaîne en fin de vague : badge → cas dorés → digest (worker/truthLoop).
- **5. Badge de confiance** par (site, pays, marque, modèle) : fraîcheur
  du dernier snapshot, profondeur honnête, URL complète (critères de
  l'étude exprimés), dossiers ouverts, cohérence inter-sites des médianes
  → score 0..100, fiable / à surveiller / douteux. Affiché sur les cartes
  d'étude (pire label + détail par site au survol).
- **4. Cas dorés** : premier passage = l'état PROUVÉ du registre figé
  (chaque valeur native, marque seule) ; rejoués à chaque vague ; un échec
  ouvre un dossier signal golden_fail ET bloque les auto-validations de
  mappings du site (validator ↔ goldenGate). Figeables depuis la
  Bibliothèque (★ sur une puce native, admin), listés dans l'onglet
  « Cas dorés ».
- **3b. Routine du matin** : un digest par jour (études passées, annonces
  nouvelles/baisses, dossiers, segments douteux, cas dorés en échec,
  erreurs Zyte/blocages, taxonomie apprise, veille légale) — panneau
  « Ce matin » du Truth Center + carte Accueil.
À ÉPROUVER sur les premières vagues avant d'ouvrir l'étage LLM (décision
Channing 03/09 : LLM après les trois briques).

## -1bis-FAIT (03/09). BIBLIOTHÈQUE par site (Truth Center, ex-« Lacunes »)

GO Channing 03/09. Le savoir d'un site à plat : registre des critères
évalué EN DIRECT **par valeur** (l'URL change quand la valeur est posée,
support = marque seule ; sous-types prouvés contre l'URL de la famille),
marques/modèles vs référentiel constructeur (filtre « Recherche
active »), santé (dictionnaire, mémoire, moisson), geste « Apprendre »
(URL humaine → critères relus par l'adaptateur → ingestion ; grammaire
PROPOSÉE tant qu'un scrape chiffré ne confirme pas).
**Lacunes trouvées par l'outil le 03/09 (à combler par URL humaine ou
grammaire) :** Gaspedaal ESSENCE (aucun segment /benzine posé) ; Leboncoin
GPL (aucun code fuel posé) ; Marktplaats MANUELLE = post-filtre (pas de
facette) ; Marktplaats hybride + MODÈLE : la reconstruction path-based ne
combine pas modèle et carburant famille (marque seule OK) — rejoint §3.
Reste : vélocité native par site (preuve par données), persistance du
statut « proposée » (aujourd'hui message seulement).

## -2. CRITÈRE CARROSSERIE (demandé Channing 27/08 — Corolla GR Sport NL)

Une étude « Corolla GR sport hybride 2022 » rend hatchback ET Touring
Sports — les deux cochent tous les critères actuels.
**LANCÉ le 30/08** : canon ADA acté par Channing = nomenclature LBC 8
types (URLs-preuves du jour : vehicle_type=4x4 + liste complète à
virgules littérales). Livré : bodyTypes.ts (canon + canonicalizeBody
multilingue), grammaire LBC au registre + détecteur + gate, migration
daily_searches.vehicle_type + observations.vehicle_type (+archive+vue),
critère au Workflow (formulaire/carte/signature doublons), post-filtre
dur worker en jeton canonique, capture dans toutes les observations.
**BOUCLÉ À LA SOURCE le 30/08 soir — 11/11 sites** (corpus complet
Channing, 5 formes de grammaire : virgules LBC, underscores La Centrale
[berline=41_42], répétition mobile.de c=/Bilbasen cartype=/Blocket
body_type= [citadine = 2 codes]/Skelbiu body[] [break=3 corrigé par le
dict sk:body], facettes hash Marktplaats f:481-488 [pose intra-liste],
segments de chemin Gaspedaal/Subito/Jófogás [multi + dans un segment]).
ORDRES DE SEGMENTS PROUVÉS PAR SCRAPE : Subito = carrosserie AVANT
carburant (/suv-fuoristrada/ibrida, l'inverse = 0) ; Gaspedaal =
carburant AVANT carrosserie (/hybride/suv, l'inverse = 0) ; Jófogás =
carburant puis carrosserie OK. Constat Jófogás : parc minuscule
(Ferrari) = segment élargi/ignoré par le site, vrai parc = filtre net.
« Société » posable sur LBC (voituresociete), La Centrale (80),
Gaspedaal (bedrijfswagen) seulement — ailleurs post-filtre (l'Utilitaire
AS24/Blocket n'en est PAS un). FILTRE MI en lecture LIVRÉ le 30/08
(Select Carrosserie strict + héritage d'URL : une observation sans type
déclaré hérite du type de la page filtrée dont elle vient — fix du
« 0 annonces NL » ; les liens de vérification du MI portent le critère).

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

## 1-FAIT (constaté 30/08). Vocabulaire de détection carburant

Relu le 30/08 : tout ce que ce paragraphe demandait existe —
canonicalizeFuel couvre TDI/HDi/BlueHDi/dCi/CDI/CRDi/D-4D → diesel,
TSI/TFSI/VTi/PureTech/TCe/GDI/vvt-i/EcoBoost/MPI → essence,
e-Power/e:HEV/HSD → hybride, multilingue FR/NL/DA/DE/IT/ES/SV/LT/HU ;
la lacune « elektrisch » du inferFuel Marktplaats est corrigée (elektr
couvert, hybride testé avant électrique). Paragraphe d'origine :

## 1-ORIGINE. Vocabulaire de détection carburant (prioritaire dès les premières ingestions)

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

## 2bis-FAIT (par le registre unique, constaté 30/08). Génération d'URL depuis les mappings secondaires

Rendu obsolète par le REGISTRE UNIQUE des grammaires (26-30/08) :
applyVariableCriteria pose-ou-retire année, km, puissance, boîte,
carburant, finition ET carrosserie sur toute URL générée ou apprise,
sur les 11 sites, avec le gate de matrice en garde-fou. Seule la COULEUR
n'est posée nulle part (aucune URL-preuve par site — post-filtre
structuré en lecture, canonicalizeColor multilingue).

## 2ter-bis-FAIT (30/08 soir). Fiche annonce NÉGOCIATIONS : 11 sites lisibles

Constat Channing : ajout mobile.de « ne fonctionne pas du tout » (titre =
« Zugriff verweigert / Access denied »). Trois classes corrigées :
1. **Anti-bot servi en 200 pris pour l'annonce** → `isBlockedDetailPage`
   (motifs multilingues sur title+entame) + poursuite de l'escalade de
   profils au lieu d'un faux succès.
2. **Galeries** : extracteurs dédiés sondés sur pages réelles —
   mobile.de (diapos `data-testid="image-N"` → classistatic mo-1600),
   Bilbasen (`media.images`, l'ancien motif `.jpg` tronquait les
   `.jpeg?class=`), Blocket (`item/{id}/{uuid}` borné par l'id d'URL,
   le JSON-LD n'en liste que 3), Skelbiu (variante ann_3 du zoom, page
   détail SANS similaires serveur), Jófogás (620x620aspect filtré par le
   slug d'URL). La Centrale (pictures src1_5x) et LBC/AS24/Marktplaats
   déjà faits.
3. **Prix multi-devises** : les prix Bilbasen/Blocket/Jófogás étaient lus
   puis rejetés par le plafond « euro » (429 800 DKK…) → bornes de
   vraisemblance PAR DEVISE puis conversion, prix stocké EN EUR (doctrine
   études) ; Skelbiu = bloc `announcement-price` (l'ancien prix barré et
   le HT export écartés) ; mobile.de = € du titre (seul prix serveur).
   Titres : préfixes/queues éditoriaux rabotés (Subito og:title seul,
   alt de galerie mobile.de, queue | A{code} Skelbiu).
`parseListingDetailCard` = fonction PURE (bancs hors-ligne sur HTML
sondés : 6/6 titres nus, prix exacts, photos 18/11/20/20/10/15).

**RESTE À CONFIRMER — mobile.de en VIF (30/08 soir).** L'extracteur est
prouvé hors-ligne sur la vraie page (18 photos, titre complet de l'alt
galerie, 57 900 € du <title>), mais la confirmation en production n'a
pas pu aboutir : incident Zyte (erreurs 520 en rafale dès ~16:50 UTC,
visibles worker_logs) sur le profil de rendu servant mobile.de — les 6
autres sites passaient avec leurs profils. Les échecs rendent l'erreur
PROPRE (« Page d'annonce illisible », garde `isBlockedDetailPage`) au
lieu de l'ancien faux titre « Zugriff verweigert ». Éléments établis :
la garde ne fait AUCUN faux positif sur les 7 vraies pages ; une des
tentatives (17:24) a reçu une vraie page de blocage mobile.de en
tentative 3 — l'URL 460265703 avait été sur-sollicitée (~6 passages du
jour), une URL fraîche (458668438) n'a vu que des 520. À la reprise :
relancer `bench-mobile-fresh.sh` (scratchpad) sur une annonce fraîche ;
si blocage HORS incident Zyte → envisager l'escalade du profil détail
mobile.de (browser + attente, comme La Centrale).

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

## 4-ABSORBÉ (03/09). Découpage des clusters de facettes Marktplaats — les facettes sont désormais moissonnées UNE PAR UNE avec leur libellé (mp:facet:fuel, body, transmission… 782 entrées), l'isolement par différence d'ensembles n'a plus d'objet

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

## 4sexies. Accidentées — exclusion À LA SOURCE dans les URLs (différé, acté 01/08 — RECONFIRMÉ 03/09 : « pas d'erreurs avec des accidentées pour le moment », on garde)

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

## 4ter-ÉCARTÉ (03/09). MI différés — carte de couverture et sparklines : « j'y vois moins d'intérêt maintenant » (Channing). Conservé pour mémoire.

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

Chantier finitions inter-pays : l'ACHAT de la base « European Car
Database » Teoalida est ÉCARTÉ (décision Channing 30/08). Si le besoin de
traduction des finitions revient, la voie sera nos propres observations
par pays (linkgen_enum_mappings, lc:trim…) + clustering LLM (lot 4bis) —
sans base externe.

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
