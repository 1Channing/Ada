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

## -1-LIVRÉ v1 (07/09). CARTE EUROPE DU RÉSEAU — onglet « Carte »

Décisions Channing 07/09 : contacts importés du fichier « McExport Tab
MARKET NL » (11 groupes NL avec stock par marque + 7 prospects NL/DK/FR +
convoyeur), placement par dictionnaire de villes embarqué + clic sur la
carte, fond STYLISÉ sans rues (SVG maison, projection conique de Lambert,
géométrie world-atlas 50 m allégée à 247 Ko chargée à la demande), édition
sur droit explicite « carte:edition » (Équipe ; la politique RLS lit le
même droit). Migration 20260907180000 (tables network_contacts /
network_contact_models + graine). Pan/zoom souris-molette-tactile,
regroupement des épingles selon le zoom, filtres pays/rôle/relation,
recherche marque-modèle sur clés canoniques du MI, temps réel.
PHASE 2 (à décider) : croisement automatique opportunités ↔ contacts
(« à qui vendre / où acheter » dès qu'une annonce sort) ; import CSV.

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
- **La Centrale lente en MI** (constat Channing 05/09 soir, Elroq : MP et
  Bilbasen en 15 s, La Centrale 3 min après 3 × Zyte 520 à ~60 s chacun ;
  sur 24 h le brut passe Datadome ~1 fois sur 2) : COURSE DE PROFILS —
  brut et navigateur lancés ensemble au premier essai, la première page
  exploitable gagne, l'autre est annulée (adaptateur hedgeFirstAttempt,
  pages suivantes comprises). Coût : une requête de plus par page, sur ce
  seul site. Attendu : 20-30 s au lieu de 1 à 4 min.
Vague du 07/09 (vérification Channing « 3 modèles seulement ») — volume
NORMAL (3, 4, 11, 8 nouveautés sur les quatre dernières vagues, critères
étroits), mais trois défauts trouvés et corrigés :
- **La Centrale « RAV 4 » ≠ RAV4** : 115 annonces jetées par le filtre de
  modèle structuré (clé à jetons triés « 4rav »). Forme compacte ajoutée.
- **iX3 sur La Centrale** : pas de modèle iX3 chez le site → page marque,
  iX1/iX2 servies ; l'étude les écartait mais le snapshot MI les prenait
  (69 observations « IX3 »). Le worker vérifie désormais le modèle structuré
  avant d'écrire, et la contradiction de titre reconnaît les frères à
  chiffres (iX1 ≠ iX3, i20 ≠ i30, Q3 ≠ Q5).
- **AutoScout24 rechargeable** : mot-clé lié à la langue (FR : famille 57,
  PHEV 8, plug-in 0 ; NL : plug-in 9, PHEV 0) → plus de mot-clé ; famille
  hybride scrapée, l'étude ne garde que les annonces qui PROUVENT la
  recharge dans leur texte (refineFuelToken), uniquement sur les sites
  dont l'URL ne distingue pas HYBRIDE de PLUG_IN_HYBRID (mesuré sur l'URL).
- À VÉRIFIER avec Channing : deux études « HYUNDAI TUCSON » et une « YARIS
  CROSS GR » à 0 sur les six sites, sans médiane — critères à relire (les
  « Liens » de la carte).
- **ALERTES DE CAPACITÉ** (règle Channing 07/09 : « pose des alertes visibles
  si ce genre de limites sont atteintes ») : mécanisme, pas cas par cas.
  Table capacity_alerts (migration 20260907100000) + RPC capacity_hit ;
  helper `capped(rows, limite, clé, message)` côté front (services/capacity)
  et worker (dashboards) ; bandeau ROUGE sur toutes les pages tant que non
  acquittée (« Traité », admin ; se rouvre seule si le plafond est de
  nouveau touché) ; reprise dans « Ce matin ». Plafonds instrumentés :
  Résultats 40 000 annonces, Télémétrie 60 000 événements, badge 2 000
  segments, finitions 4 000/2 000, re-scan 5 000 exclusions, Campagne
  10 000/1 000 mappings, Truth Center 300 dossiers, études (worker) 4 000
  observations / 10 000 annonces mémoire / 5 000 négos, digest 3 000 logs.
  RÈGLE : toute nouvelle `.limit(N)` significative passe par `capped`.
  PREMIÈRE ALERTE (07/09 13:55, campagne.marques : 3 238 mappings validés,
  1 000 lus) → lecteur paginé partagé `readAllPages` (src/lib) appliqué aux
  trois lectures de la mémoire (puces marques, lacunes résolues, planificateur
  de campagne) ; plafond garde-fou 100 000. RÈGLE affinée : une lecture qui
  sert à DÉRIVER (distinct, index, clés) se pagine jusqu'au bout, le plafond
  n'est qu'un garde-fou ; `.limit(N)` reste légitime pour « les N derniers ».
  ACQUITTEMENT QUI TIENT (07/09, « j'ai toujours l'alerte ») : un onglet
  encore sur l'ancien build retouchait la clé au rechargement et rouvrait
  l'alerte. Migration 20260907140000 : `capacity_hit` reçoit le build
  (front : __BUILD_TIME__ vite ; worker : démarrage du processus) ; « Traité »
  couvre tout code construit avant lui, seule une touche d'un build
  POSTÉRIEUR rouvre. Le bouton est optimiste et l'écriture vérifiée (motif
  affiché si la base refuse).
- **LOGS 24 h relus le 07/09 après-midi** (1 581 lignes, 121 erreurs) :
  AbortError × 110 = course de profils La Centrale AVANT le filtre poussé
  le matin (à re-vérifier demain : doit être 0) ; PayloadTooLarge 08:05 =
  avant express 10 Mo ; Zyte 520 × 9 à 05 h (rappel samedi) ; RECON AS24 FR
  × 171 lignes en 3 min à 08:14 (rafale unique, lancement re-scan).
  Corrigé : MERCEDES « GLE-CLASS » vs « GLE » structuré (mots de famille
  class/classe/klasse/clase neutres dans structuredModelMatches — 13 à 55
  annonces jetées par site, aucun snapshot GLA/GLE/GLS/SL) ; TAXONOMY
  « 357 apprises » à chaque scrape = lecture du dictionnaire plafonnée à
  1 000 (readAllPages) ; MOBILEDE_OBS flight (209/j) hors base.
  RAV4 2023 FR→NL à 2 949 € : critères année/carburant bien posés (LBC
  regdate, LC yearMin) ; cause = Marktplaats, année et km dans le fragment
  « # » jamais lu par le serveur (0bis) → RAV4 de 2001 dans la médiane.
  Corrigé : post-filtres DURS année et kilométrage dans les études (comme
  la boîte ; valeur absente = conservée). Reste à élucider : le lien AS24 FR
  affiché par « Liens » sans fregfrom ni fuel (registre testé sain sur cette
  URL ; aucun dossier url_incomplete côté worker) — re-vérifier après
  rechargement, sinon lire la ligne mémoire AS24 FR TOYOTA RAV4.
- **AUTOSCOUT24 : REDIRECTION QUI PERD LES FILTRES** (analyse vague 09/09,
  « pas tant de résultats ») : le slug `/rav-4` (table de l'adaptateur)
  renvoie en 308 vers `/rav4` en JETANT fregfrom/fregto/fuel (.fr, .nl, .de,
  preuve curl) → page toutes années, 110 annonces au lieu de 15, les 3-5
  pages les moins chères = RAV4 de 2000 ; le post-filtre année (07/09)
  écartait ensuite 370 (FR) + 590 (NL) annonces par vague. Corrigé : slug
  `rav4` ; CLASSE : le scraper compare l'URL finale de Zyte à l'URL demandée,
  et si le chemin change en perdant des paramètres, REJOUE sur le chemin
  final avec la requête d'origine + dossier « url_redirigee » (Truth Center).
  Mercedes `c-class` → 308 `classe-c` sur .fr (localisé, déjà géré).
- **OFFRES FOURNISSEUR — V0 LIVRÉE (14/09 soir, GO Channing « lance le code
  seulement si tu es confiant que c'est LA solution »)**. Onglet « Offres »
  (/offres) sur AUTORISATION EXPLICITE (clé `offres`, OPT_IN, page Équipe).
  Import de n'importe quel Excel fournisseur (parseSupplierFile.ts,
  déterministe et visible) : tableau plat OU blocs par marque avec en-tête
  répétée et variable, colonnes reconnues par synonymes FR/EN/DE et
  corrigeables à l'écran, ligne libre « MODELE » décomposée (puissance,
  boîte, énergie) et modèle rapproché du référentiel ADA, énergies
  canonisées, TVA récupérable / import / dommages lus, colonnes inconnues
  gardées en extras. Éprouvé sur les deux fichiers réels du 14/09 (27 et 52
  véhicules, 0 avertissement). Règle de prix (HT fournisseur + marge, TTC
  → HT si TVA récupérable), sélection, prix modifiables, pays à relever,
  export Excel (deux feuilles, comme le livrable validé) et PDF paysage à
  la charte (logo-mark, encre/océan, liens rapports) — générés depuis les
  données, jamais rédigés. Table supplier_offers (document d'équipe, SQL
  20260914230000). Enregistrement automatique (1,2 s), liste à gauche /
  offre à droite, en-têtes reconnus par contenu (3e fichier FCM, 240 véh.).
  **ÉTAGE « OÙ VENDRE » LIVRÉ (14/09 nuit, demande Channing « lancer des
  scrapings ciblés, vérifier les recherches, confronter les pays aux
  besoins »)** : `lib/offers/marketCheck.ts` — véhicules retenus regroupés
  en LOTS (marque, modèle, année, énergie, boîte ; km maxi = max × 1,1),
  une URL par site des pays cochés générée par le MÊME générateur que les
  études (mémoire + taxonomie), VISIBLE et cliquable avant tout relevé
  (« Voir les recherches »), relevé lot par lot dans la file du worker
  (edge ingest-url, criteria → snapshot MI au passage), stats sur les
  annonces reconnues du modèle (même identité que le snapshot serveur ;
  page MARQUE → le titre doit nommer le modèle, total du site ignoré),
  médiane TTC → HT avec la TVA du pays face à notre HT moyen du lot :
  bon ≥ 15 %, juste 5–15 %, trop cher en dessous. Danemark : taxe
  d'immatriculation comprise, dit à l'écran (⚠), jamais caché. Résultat
  enregistré dans l'offre (colonne `market`, SQL 20260915000000 — fail-open
  sans elle). Preuves 14/09 : lots/identité/verdict/URLs FR-NL-DK en script
  Node. **RETOUR TERRAIN 17/09 : 4 ventes grâce à l'outil.** Première
  limite (Channing) : « ASTRA L » cherché tel quel → page introuvable, lot
  faussé. Trois corrections livrées le 17/09 : (1) modèles connus = référentiel
  des études + TAXONOMIE moissonnée (AS24/mobile.de/Marktplaats,
  `lib/offers/knownModels.ts`, 92 marques) — le référentiel seul ignorait
  Astra (aucune étude) ; marqueur de GÉNÉRATION retiré (Astra L, Corsa F,
  Golf VIII, Clio V) sauf préfixes de gamme (Classe A, Model 3, Série 1,
  DS 7, ID 3) et modèles connus tels quels (Grandland X, C4 X) ; (2) CRITÈRES
  DE RECHERCHE RÉGLABLES PAR LOT (marque, modèle avec liste, années de/à,
  km maxi, énergie, boîte — colonne `lot_criteria`) : un réglage efface le
  relevé du lot et régénère les URLs, l'offre exportée ne change pas ;
  (3) la GRILLE du fichier est conservée dans l'offre (`source_grid`) : la
  correspondance des colonnes reste modifiable après réouverture (elle
  était figée : « rien ne se passe »), sélection et prix saisis gardés.
  SQL 20260917100000. RESTE : suivi envoyée/vendue → prix réel contre
  médiane prédite ; seuil de marge réglable par pays ; relevé profondeur
  réduite (aujourd'hui même profondeur que le MI, ≈ 1–3 min par site).
  Jeux d'essai : les trois fichiers du 14/09.
- **ÉTUDES QUOTIDIENNES — ACTIVATION VISIBLE (18/09, demande Channing :
  « garder les études en mémoire sans tout scraper tout le temps, limiter le
  coût Zyte »)**. La pause existait (colonne `active`, respectée par la vague
  du worker et par `truth_active_studies()` — étalon compris) mais vivait
  dans le menu ⋮ de chaque carte : invisible. Livré : bascule Active / En
  pause sur chaque carte, bascule de GROUPE marque·modèle dans l'en-tête de
  l'accordéon (tout en pause ↔ tout actif, un seul update), compteur global
  « n actives pour le prochain passage · m en pause » avec « Tout mettre en
  pause » / « Tout réactiver » (`setDailySearchesActive(ids, active)`).
  Une étude en pause garde résultats, annonces et historique ; « Lancer
  maintenant » marche toujours (forçage hors drapeau). Pas de SQL.
- **VENTES SOUS RÉFÉRENCE — ANTI-DOUBLON NÉGO ↔ TABLEUR (18/09, demande
  Channing : « plein de doublons qui polluent »)**. Cause : « Ajouter aux
  ventes » créait un dossier SANS référence ; la synchro du tableur (clé =
  REF) ne pouvait pas le reconnaître et recréait la même vente. Livré :
  (1) fenêtre « Référence de la vente » au passage en vente (REF du tableau,
  lettres + chiffres, obligatoire) ; (2) `pushNegotiationToSale(n, ref)` :
  si la REF existe déjà (tableur ou collègue) la négociation est RATTACHÉE
  au dossier existant et le complète (prix d'achat, notes) — jamais un
  deuxième dossier ; (3) worker/salesSheetSync : une REF connue n'est plus
  ignorée mais COMPLÉTÉE sans écrasement (champs vides seulement, bloc
  « [Tableur] » ajouté une fois, dossier « achat » → « vente » dès qu'un
  prix de vente arrive, clôture quand paiement + livré). Pas de SQL.
  RESTE : nettoyage des doublons DÉJÀ créés (dossiers sans REF issus des
  négociations à côté de leur jumeau tableur) — à la main dans Ventes, ou
  outil « fusionner » si Channing le demande ; index unique sur la REF une
  fois le stock assaini.
- **MODÈLES DU FORMULAIRE D'ÉTUDE = RÉFÉRENTIEL ∪ SITES (21/09, constat
  Achille : « Aygo X dans le MI, pas dans le Workflow »)**. Le formulaire ne
  proposait que le référentiel Teoalida, qui range l'Aygo X sous « Aygo 3e
  génération » ; les sites (AutoScout `aygo-x`, Marktplaats, Leboncoin) et
  le MI le connaissent comme modèle à part. Le menu Modèle ajoute désormais
  un groupe « Vus sur les sites (hors référentiel) » tiré de la taxonomie
  moissonnée (`loadLearnedModelsByBrand`, 111 modèles Toyota), facettes
  « autres » écartées, libellés de marque du référentiel intacts (ŠKODA).
  Le pipeline n'utilise pas les fenêtres du référentiel : une étude AYGO X
  passe comme une étude MI (snapshots des 6 sites prouvés le 21/09).
- **LEBONCOIN SANS MODÈLE (21/09, journal : `u_car_model=SKODA_` → total 0)**.
  Une recherche « toute la marque » envoyait un paramètre modèle vide et
  Leboncoin ne rendait rien. Sans modèle, le paramètre est retiré (preuve
  script : `u_car_brand=SKODA&regdate=…`). L'accent de « ŠKODA » n'a jamais
  gêné : chaque adaptateur retire les diacritiques (Enyaq 2025 FR→DK ce
  matin : LBC 11 · La Centrale 7 · AS24 2 · Bilbasen 76).
- **RENOMMER UNE CATÉGORIE D'ÉTUDES (21/09, groupe « SKODA » chez
  Achille)**. La catégorie de l'accordéon = marque + modèle des études ; un
  groupe nommé par la marque seule = étude créée sans modèle. Crayon dans
  l'en-tête du groupe → fenêtre marque (référentiel) + modèle (référentiel
  ∪ sites), appliquée à toutes les études du groupe
  (`renameDailySearches`) ; la recherche du lendemain suit.
- **RÈGLE « URL REDIRIGÉE » CORRIGÉE POUR AUTOSCOUT (21/09, GO Channing
  « prends la règle pour les RAV4 »)**. AutoScout24 réécrit désormais ses
  filtres dans le chemin (`kw_`, `re_AAAA`, `ft_`, `tr_`). Preuve en direct :
  `/re_2023` = 71 annonces = `fregfrom=2023&fregto=2023` (71) alors que
  `fregfrom=2023` seul = 168 → la facette est « année exacte », rien n'est
  perdu. worker/scraper `lostQueryParams` reconnaît ces segments (plus de
  rejeu inutile, plus de dossier) ; truthDiagnose R-REDIR clôt les dossiers
  dont les paramètres « perdus » sont dans le chemin, et ceux dont la
  redirection n'est plus observée depuis 3 j (rav-4 → rav4 corrigé le
  14/09). Effet attendu : scores « à surveiller » du RAV4 remontent après le
  prochain diagnostic (≤ 20 h). Reste : le dossier « profondeur en
  variation » Marktplaats RAV4 (historique 432 pollué par l'ancienne URL
  large) se résorbera avec l'historique.
- **BLOCKET : PUISSANCE, LÉGENDE, LEASING (21/09, URLs-preuves Channing
  Cupra Born ≥ 200 ch : `engine_effect_from=200`, `engine_effect_to=300`)**.
  L'URL savait déjà poser la puissance (registre grammaire + voie native,
  prouvé sur les deux voies) mais `supportsParam` disait non et surtout le
  LECTEUR ne lisait jamais la puissance (0 %) → la confirmation jetait le
  critère et l'URL n'était pas mémorisée. Page réelle analysée (34 cartes) :
  (1) puissance lue dans la description JSON-LD (« 59 kWh 204 hk »), 72 % ;
  (2) légende relue jeton par jeton — neuve sans « mil » (« 2026 ∙ El ∙
  Automatisk ») et électrique avec autonomie à la place de la boîte
  (« 2025 ∙ 4 588 mil ∙ El ∙ 425 km räckvidd ») rendaient tout vide, ou la
  légende de la carte SUIVANTE (id passé en `search-ad-<id>`) — c'était le
  dossier « complétude en chute 74→20 % » : année 69→100 %, énergie
  69→100 %, boîte 100 % (électrique = automatique, fait physique) ;
  (3) LEASING : 10 cartes « kr/månad » + 5 leasing sans libellé (4 198 kr)
  en tête du tri prix croissant entraient dans la médiane MI —
  `price_type` per-month / unknown (< 15 000 kr), et le snapshot MI applique
  désormais le PREMIER FILTRE des études (≤ 2 000 €, mensualité, accidenté),
  même règle sur tous les sites. Médiane Born 2025 : 359 900 kr au lieu de
  3 280. `engine_effect_to` (puissance maxi) : registre à faire avec la
  taxonomie km mini / puissance max / places (backlog).
- **PASTILLE « NOUVEAUTÉS OPEN SPACE » PARTOUT (21/09, demande Channing)**.
  Le badge existait sur le bouton Open space mais ne vivait que sur l'onglet
  Négociations : invisible ailleurs. Store module `hooks/useOpenSpaceUnseen`
  (compteur = annonces poussées ou notes écrites par les AUTRES depuis ma
  dernière visite ; rafraîchi toutes les 60 s, au retour sur l'onglet du
  navigateur et à chaque navigation interne ; remis à zéro à l'ouverture de
  l'Open space) lu par trois endroits : entrée Workflow du bandeau (PC et
  mobile), onglet Négociations, bouton Open space. Pas de SQL.
- **BYD INVISIBLE (21/09, constat Channing « ajouté du BYD dans l'atelier,
  pas dans le MI ni le workflow »)**. Deux classes. (1) MI : l'ingestion
  Leboncoin Dolphin Surf a lu 16 annonces, modèle confirmé 16/16, mais la
  MARQUE rejetée « 0/16 annonces = byd » → aucun relevé. Preuve par un
  scrape de diagnostic : Leboncoin range BYD sous « Autres » dans l'attribut
  générique `brand` des annonces, alors que `u_car_brand` dit BYD ; le
  lecteur lisait `brand` en premier. Désormais u_car_brand d'abord, un
  libellé « Autres » cède la place au code puis à la clé suivante
  (parsers/leboncoin `brandFromAttributes`). (2) Workflow : Teoalida ne
  liste PAS BYD (aucune ligne) → marque impossible à choisir. Le menu Marque
  ajoute « Vues sur les sites (hors référentiel) » ; la taxonomie lue
  s'étend à Leboncoin (u_car_brand / u_car_model « BYD_Dolphin Surf ») et
  garde les marques sans modèle appris (BYD sur AutoScout) : 321 marques,
  BYD = Atto 2, Dolphin Surf, Seal, Seal 6. Preuves Node. À surveiller :
  d'autres marques récentes que Leboncoin range sous « Autres » (MG, Leapmotor,
  Xpeng…) suivent la même règle.
- **MUSTANG MACH-E : 7 ANNONCES ADA vs 11 HUMAIN, PROFONDEUR 6 (21/09,
  constat Channing)**. Journal d'ingestion : l'URL d'ADA était identique à
  l'URL humaine et lisait bien 11 annonces, mais le MODÈLE était rejeté
  « 9/11 titres contiennent MUSTANG MACH-E (82 % < 90 %) » — deux vendeurs
  écrivent « FORD MACH E… » / « Ford mach e electric… » sans « Mustang ».
  Relevé non enregistré → le MI ne voyait Leboncoin qu'à travers le scan
  marque+modèle sans critères (1 annonce sur les 100 lues passait le filtre)
  → 3 + 3 + 1 = 7 annonces, profondeur 3 + 3 = 6. Classe corrigée : (1) le
  lecteur Leboncoin lit le MODÈLE STRUCTURÉ de l'annonce (u_car_model, comme
  la marque) ; (2) la confirmation du modèle juge sur le structuré quand les
  annonces le portent (≥ 3), le titre ne sert que sans structure — preuve
  sur les 11 titres réels : texte 9/11 rejeté, structuré 11/11 confirmé ;
  (3) profondeur MI = par site, max(total conforme, annonces lues) — un total
  ne peut pas être inférieur à ce qu'on a lu ; site sans scan conforme mais
  avec annonces lues compté par ses annonces. Pas de SQL.
  **Portée (question Channing « pour tous les sites ? »)** : la règle de
  confirmation est commune ; elle s'applique dès que le lecteur du site
  pose le modèle structuré sur l'annonce. Après le 21/09 : Leboncoin
  (u_car_model), AutoScout ×6 (vehicle.model, ajouté), mobile.de et
  Bilbasen (lecteur Next-data générique, `model` ajouté), Marktplaats
  (attribut model LRP), Blocket, Gaspedaal, La Centrale, Subito, Jofogas
  (déjà). Reste au titre : Skelbiu (aucun champ structuré par carte).
- **COCHES.NET (ES) — RECONNAISSANCE 21/09 (URLs Channing : sans filtre,
  Toyota RAV4 `MakeIds[0]=46&ModelIds[0]=131&fi=Price&or=1`)**. Tout est
  dans `window.__INITIAL_PROPS__` (JSON, ~1 Mo) : `initialResults.items`
  30 annonces/page, `totalResults` (273 642 au total, 1 204 RAV4),
  `totalPages`, pagination `pg=N`. Par annonce : prix, km, année, carburant
  (id + libellé), marque/modèle STRUCTURÉS avec ids, hp (43 %), bodyTypeId
  (43 %), isProfessional + `seller` (nom, note), `photos[]` (URLs pleine
  taille) + `imgUrl`, `publicationDate` et `creationDate`, `priceDrop`
  {originalPrice, percentage, daysSinceUpdate}, offerType (Ocasión / Nuevo /
  Km0 / Demostración), province/région, téléphone, includesTaxes/taxTypeId
  (IVA/IGIC), hasWarranty, isCertified. PAS de boîte ni de finition par
  annonce (titre = marque + modèle + version quand le vendeur la donne).
  TAXONOMIE COMPLÈTE en une page : `listFiltersOptions.vehicles` = 165
  marques × modèles avec ids. GRAMMAIRE D'URL prouvée par le code du site
  (table FILTER_NAMES du bundle) puis en direct : `MinYear`/`MaxYear`,
  `MinKms`/`MaxKms`, `PowerHpFrom`/`PowerHpTo`, `MinPrice`/`MaxPrice`,
  `Fueltype2List=N` (scalaire ; 1 Diésel, 2 Gasolina, 3 Eléctrico,
  4 Híbrido, 5 Híbrido enchufable, 6 GLP, 7 GNC ; multi-valeur : ni virgule
  ni répétition), `st` (1 pro, 2 particulier), `TransmissionTypeId`
  (1 = automatique — 114 RAV4 ≥ 2023 tous eCVT ; 2 = manuelle), `OfferType`
  (0 Ocasión, 1 Nuevo, 2 Km0), `hasPriceDrop=true`, `KeyWords=` (texte),
  `ArrBodyType`, `arrProvince`, tri `fi=Price|SortDate|Kilometers|Year` +
  `or=1|-1`. ZYTE : mode navigateur avec `geolocation: 'ES'` OBLIGATOIRE
  (1,4 Mo lus) ; mode brut (`httpResponseBody`) → 520 systématique ; accès
  direct depuis le conteneur : ouvert. Prochaine étape : adaptateur v1
  (lecteur __INITIAL_PROPS__, grammaire, taxonomie moissonnée, pro/privé,
  baisses de prix, dates) — pays ES, 3e site après AutoScout ES.
- **COCHES.NET — ADAPTATEUR V1 LIVRÉ (21/09 soir, GO Channing + 8 URLs
  humaines : boîte `TransmissionTypeId=1`, carrosseries `ArrBodyType=1..8`
  sur Mercedes Clase C)**. `marketplaces/coches.ts` (clé COCHES, ES, 17e
  site) : lecteur JSON __INITIAL_PROPS__ (30 annonces/page — année, km,
  carburant, marque/modèle structurés, hp 43 %, carrosserie 43 %, pro/
  particulier 100 %, date de mise en ligne 100 %, baisse de prix et nombre de
  photos dans la description), catalogue COMPLET moissonné à chaque scrape
  (cn:make 165 marques, cn:model:<makeId> 1 687 modèles, cn:fuel, cn:body)
  et injecté dans l'adaptateur (ids marque/modèle, BYD Dolphin Surf posé
  après une seule page), grammaire entière (registre + détecteurs +
  matrice du gate), prefill/segments d'ingestion, marché vide prouvé
  (totalResults 0), total pour le worker (`"totalPages":N,"totalResults":N`),
  profil Zyte navigateur ES. Famille Mercedes : « CLASSE C » ADA ↔ « Clase C »
  site ↔ « C-Class » ramenés à la lettre. Libellés boîte non lus dans le
  bundle (traductions chargées à part) : 1 = automatique prouvé par le
  compte (RAV4 ≥ 2023 tous eCVT, 3 028/4 122 Clase C). Non porté par le
  modèle d'annonce ADA : photos (URLs disponibles) et prix d'origine avant
  baisse (disponible) — champs à ajouter à ScrapedListing si on veut les
  exploiter. Preuves Node sur la page réelle + gate + build worker. Pas de
  SQL. Effet : les études FR→ES / ES→x et le MI Espagne scrutent AutoScout
  ES + Coches.net dès le prochain passage.
- **PREMIER TEST CHANNING SUR COCHES.NET (21/09 soir, Mach-E électrique
  2023 ≥ 320 ch) — deux classes corrigées**. (1) L'onglet MI générait une
  URL SANS marque ni modèle alors que l'Atelier pré-remplissait Ford /
  Mach-E depuis la même URL : le dictionnaire des sites était chargé « une
  fois par session » d'onglet, donc figé dans une copie antérieure à
  l'apprentissage de Coches.net. Désormais : rechargé au-delà de 10 min, et
  rechargé puis regénéré UNE fois quand une URL sort « sans id / code / slug
  / libellé appris » avec un dictionnaire de plus d'une minute
  (`ensureLearnedTaxonomy(maxAge)`, `learnedTaxonomyAgeMs`, generator).
  (2) Le relevé MI (URL correcte, 6 annonces) jetait le modèle « 5/6 = 83 %
  < 90 % » : le site lui-même écrit « Mustang MachE » sur une annonce et
  « Mustang Mach-E » sur les cinq autres, même modelId 1326. Deux remèdes :
  le lecteur Coches.net pose le libellé du CATALOGUE par id (l'id fait foi,
  plus l'orthographe de l'annonce) ; et sur tout champ STRUCTURÉ, un seul
  écart sur ≥ 4 annonces est toléré (la barre des 90 % reprend d'elle-même à
  10). Preuves sur la page réelle : 6/6 confirmés ; 1 écart/6 confirmé,
  2 écarts/6 rejeté.
- **TERRITOIRES HORS TVA UE EXCLUS (21/09, décision Channing « on enlève
  dès maintenant tout ce qui vient des Canaries »)**. Champ
  `fiscalTerritory` sur l'annonce, posé par le parseur quand le site donne
  la localisation, et règle commune `fiscalTerritoryOf(pays, code postal)`
  (ES 35/38 Canaries IGIC, 51/52 Ceuta / Melilla IPSI ; FR 97x/98x DOM-COM ;
  DE Heligoland, Büsingen ; IT Livigno, Campione). Exclusion partout où un
  prix compte : `shouldFilterListing` (études, leads, snapshot MI worker),
  `isRetailPrice` (snapshot front), `listingIsLot` (« Où vendre »). Sites
  câblés : coches.net (`taxTypeId` 2 = IGIC fait foi, province en repli),
  AutoScout tous pays (`location.zip` + `countryCode`), Leboncoin
  (`location.zipcode`, fail-open si absent). Preuves : coches RAV4 page
  test 7/30 Canarias (18/60 sur les deux pages sauvées), AutoScout ES
  38626 Arona sur la page la moins chère — tous marqués et écartés par le
  parseur réel ; FR 35000 (Rennes) n'est pas confondu avec ES 35000.
  worker_logs trace « n/N annonce(s) écartée(s) — hors territoire TVA UE ».
  Reste : les observations déjà en base d'aujourd'hui (Mach-E ES, RAV4 ES
  via coches) gardent leurs Canariens jusqu'au prochain passage ; aucun
  autre site du réseau ne donne la localisation dans ce que nous lisons
  (Marktplaats, mobile.de, Bilbasen, Blocket, Subito… : pas de territoire
  hors TVA notable de toute façon).
- **OPPORTUNITÉS À CONTRÔLER : FILTRES ET TRI (21/09, demande Channing)**.
  Le panneau (Accueil + MI) se filtre par pays source, pays cible, marque,
  modèle et carburant, et se trie (priorité écart × volume, écart, marque /
  modèle, pays source, pays cible). Les menus ne proposent que les valeurs
  présentes dans la liste chargée (et se restreignent au reste de la
  sélection : le modèle suit la marque) ; compteur « n / N » dès qu'un
  filtre est actif, « Afficher plus » et l'état vide portent sur la liste
  filtrée, bouton « Effacer ». Purement local : rien ne change au calcul
  serveur ni aux acquittements.
- **MOKKA ÉLECTRIQUE 2026 : ES « rien trouvé », NL « pas mis à jour »
  (21/09, test Channing)**. (1) ES : l'URL coches.net générée par ADA
  (MakeIds 32 / ModelIds 1036 / 2026 / Fueltype2List 3) rend bien les 3
  annonces vues par Channing (vérifié en direct) ; le job coches a été TUÉ
  par le redémarrage du worker à 18 h 38 (déploiement lancé sur « worker
  silencieux » : les jobs d'ingestion ne laissaient aucune trace dans
  worker_logs avant leur premier warn), et le MI traitait le 404 du job
  perdu comme un scrape terminé, sans un mot. Corrigé : warn « job
  démarré » à chaque ingestion (battement de cœur, le script de push
  attend 240 s de silence), et le MI dit « scrape interrompu par un
  redémarrage du worker — relance ». (2) NL : AutoScout NL, Marktplaats et
  Gaspedaal ont rendu 0 aux deux passages (AutoScout NL vérifié en direct :
  0 Mokka électrique 2026, 0 en 2025-2026) ; un scan à 0 n'écrivait aucun
  snapshot et le tableau montrait les 21 annonces du 24/08 sans date.
  Corrigé : vide PROUVÉ par le site (total 0 lu, ou marqueur de vide) →
  snapshot profondeur 0 daté du jour ; le tableau de comparaison affiche
  « relevé le jj/mm » sous chaque étude et « 0 annonce au dernier relevé »
  quand tous les sites relevés depuis 14 j ont rendu 0. Gaspedaal (total
  illisible) n'écrit rien : vide non prouvé.
- **JUMEAU ÉLECTRIQUE D'UN MODÈLE (21/09, constat Channing : Mokka
  électrique NL « 0 » alors que Gaspedaal montre 46 « Mokka-e »)**. Les
  sites rangent la version électrique sous un modèle À PART : AutoScout
  (Mokka-E 75751 ≠ Mokka 20148, NL : 0 + 35), Marktplaats (mokka-e 443363),
  mobile.de (Mokka-e 49 ≠ Mokka 37 — et les vendeurs se répartissent : 27 +
  24 = 51), coches.net (Mokka-e 1333), Gaspedaal (mokka-e), Bilbasen,
  Blocket. Règle commune (business-logic) : `electricSiblingLabels` (graphies
  du jumeau cherchées dans le DICTIONNAIRE de chaque site, jamais devinées),
  `modelFamilyKey` (marqueurs électriques neutres : Mokka-e ≡ Mokka, e-208 ≡
  208, 500e ≡ 500, Kona Electric ≡ Kona ; Mach-E ≠ Mustang, EV6 ≠ EV9,
  Classe E ≠ Classe C), `wantsElectricSibling` (électrique ou sans
  carburant). URLs d'UNION prouvées site par site : AutoScout `/lst?mmvmk0
  &mmvmd0&mmvmk1&mmvmd1` (35), coches `MakeIds[1]/ModelIds[1]` index-alignés
  (3 ; les formes « 1036,1333 » ou ModelIds[1] seul FONT TOMBER le filtre :
  20 Opel), Marktplaats `/f/mokka+mokka-e+elektrisch/` (20), mobile.de
  `ms=…;37&ms=…;49` (51). Sites à un seul modèle par URL (Gaspedaal,
  Bilbasen, Blocket) : sur une étude ÉLECTRIQUE, le jumeau appris prend le
  chemin (Gaspedaal prouvé 0 → 46 ; Bilbasen/Blocket non prouvés en
  volume, slugs/codes du site eux-mêmes). Le générateur préfère la voie
  native à une URL apprise quand elle pose le jumeau. Confirmation : la clé
  de famille juge le modèle structuré (« Mokka-e » confirme MOKKA) dans
  l'ingestion, le snapshot MI et les scores des adaptateurs. Reste :
  Leboncoin / La Centrale / Subito / Jófogás / Skelbiu n'ont pas de jumeau
  dans leur dictionnaire (électrique sous le modèle de base).
- **PREUVE DE MARCHÉ « MODÈLE × CARBURANT » (21/09, décision Channing :
  campagne électrique FR/DK qui étudiait BMW 2-Series Gran Coupé, Gran
  Tourer, SL en électrique)**. Le référentiel constructeur ne connaît pas
  les carburants ; deux sites exposent, pour un carburant et une marque, la
  liste des modèles AVEC leur volume : coches.net (agrégations `makeId` puis
  `model` — 64 marques, 218 modèles, 4 456 annonces électriques 2023+ ES ;
  Opel : Corsa-e 25, Mokka-e 23, Frontera Electric 29…) et Marktplaats (API
  LRP, facette `model` avec histogramCount par marque — 61 marques, 218
  modèles, 11 835 annonces NL). Bilbasen (13 415 électriques DK) et
  Leboncoin n'exposent pas de facette lisible dans ce qu'on lit : à
  sonder autrement. AutoScout : catalogue non filtré, pas de compte.
  Livré : table `vehicle_fuel_evidence` (migration 20260921200000,
  additive, upsert par site × carburant × marque × id modèle du site,
  jamais de suppression), moissonneur worker `fuelEvidence.ts` (première
  moisson dès que la table existe, rafraîchissement mensuel, déclenchement
  manuel `mode: fuel_evidence_harvest` via l'edge), lecture front
  `marketFuelEvidence.ts` (verdict prouvé / absent / improbable / inconnu,
  clé marque × famille de modèle : Mokka-e ≡ Mokka), planificateur de
  campagne : au ciblage carburant forcé, un modèle absent du carburant sur
  ≥ 2 sites où la marque est couverte n'est plus planifié (tracé
  `[CAMPAIGN_PLAN]`), un modèle prouvé passe devant le verdict EEA, un seul
  site → dépriorisé. Seuil « validé » : ≥ 3 annonces sur un site ou présence
  sur deux sites. Première moisson faite depuis le bac à sable le 21/09 :
  302 familles, 258 validées, 128 vues sur les deux sites — en base dès que
  la migration est collée (le worker moissonne seul dans les 30 min).
- **OÙ VENDRE : FINITION ET PUISSANCE MINI PAR LOT (22/09, demande
  Channing : EV6 GT AWD 325 ch)**. Deux critères de plus dans l'éditeur du
  lot : finition (« GT ») et puissance minimale en ch, pré-remplie depuis
  le fichier (la plus faible du lot, arrondie aux 5 ch). Posés dans l'URL
  par le registre de grammaire quand le site sait (kwd=/trefw=/free=,
  powerfrom=/vmin=/hpfrom=/PowerHpFrom…), et TOUJOURS vérifiés sur les
  annonces lues : chaque mot de la finition dans le titre ou la version
  (« GT » écarte les GT-Line), puissance connue sous le seuil écartée,
  puissance inconnue conservée (fail-open, l'URL a déjà filtré quand le
  site le permet). Libellé du lot : « KIA EV6 · GT · 2024 · ELECTRIQUE ·
  ≥ 325 ch · ≤ 50 000 km ». Stocké dans lot_criteria comme les autres
  réglages (colonne existante, aucun SQL). Même jour, constat Channing :
  Suède « méd. 579 900 € · +1144 % sous le marché » — les prix Blocket
  (SEK) et Jófogás (HUF) entraient sans conversion dans le relevé des lots
  (Bilbasen arrive déjà en euros). Corrigé : conversion en euros avec la
  table de change du MI avant médiane et seuil des 1 000 €. Puis décision
  Channing (« on veut des données brutes ») : plus AUCUN calcul de taxe
  dans le verdict — ni TVA retirée, ni estimation de taxe d'immatriculation
  danoise. Le verdict compare notre HT au prix affiché médian, en euros,
  tel quel ; la note Danemark reste informative (affiché taxe comprise).
- **OFFRES : MOTORISATION SUR LA LISTE RÉÉDITÉE (22/09, constat Channing sur
  « OPEL AUTRES OFFRE MC EXPORT 22_09 »)**. Le fichier fournisseur porte
  une colonne Engine (« 1.2 Turbo. 96 kW (130 PS). S/S »), ADA la lisait
  bien (champ engine, puissance 130 ch dérivée) mais le PDF n'imprimait que
  « Opel ASTRA L · Break · Grey » et l'Excel la reléguait en feuille 2.
  Corrigé : colonne « Motorisation » (Engine tel quel, sinon la ligne
  version d'origine, jamais rédigée) et « Énergie » dans le PDF, en feuille
  1 de l'Excel et dans le tableau à l'écran.
- **EXPORTS OFFRES : COLONNES SELON LES DONNÉES, TEXTE ENTIER, SORENTO
  (22/09, deux retours Channing)**. (1) PDF Opel : « 1.2 MHEV 100 kW (136 »
  coupé, « Hybride r », en-têtes « C O » et « Dommages () », tirets vides —
  la police Helvetica de jsPDF n'a ni €, ni ₂, ni le tiret cadratin, et
  chaque cellule tenait sur une ligne. Corrigé : libellés ASCII (CO2, EUR),
  vide = « - », cellules véhicule / motorisation / énergie sur deux lignes,
  hauteur de ligne et pagination calculées. (2) Sorento Flexivan : « 1st
  Reg. » non reconnu comme date de première immatriculation (règle
  ajoutée : « 1st reg », « reg »), marque devenue « SORENTO » faute de
  colonne marque (la marque est désormais celle du modèle connu d'une seule
  marque : KIA), « SORENTO F/L » → SORENTO (suffixe F/L, FL, FACELIFT, MYxx
  retiré). (3) Décision : PDF et Excel n'impriment plus les colonnes vides
  pour tous les véhicules (puissance, boîte, CO₂, dommages, rapport… selon
  le fichier) ; véhicule et prix toujours. Suite (22/09, « il manque
  toujours la première mise en circulation ») : l'offre Sorento avait été
  importée AVANT la règle « 1st Reg. » et sa correspondance des colonnes,
  enregistrée avec l'offre, gardait « ignoré » — la relecture la respectait
  à la lettre. Classe corrigée : un « ignoré » hérité d'une lecture
  automatique cède la place à la règle du jour quand elle reconnaît la
  colonne et qu'aucune autre ne porte le champ (un choix explicite vers un
  autre champ reste respecté) ; le panneau affiche le champ réellement lu ;
  bouton « Relire le fichier avec les règles du jour » (sélection et prix
  MC Export conservés). Vérifié : Sorento 20/20 dates, marque KIA, même
  avec l'ancienne correspondance figée.
- **SENTINELLE DES PARSEURS ET DES RELEVÉS (22/09, idée Channing « droid
  factory » — retenue sous forme de RÈGLES, pas d'un agent qui juge)**. Le
  besoin : un site change sa page et le parseur rend 0 ou du faux sans
  bruit ; une donnée absurde entre dans une médiane (Suède en couronnes,
  Canaries) ; une régression introduite dans un parseur n'est vue qu'en
  production. Trois étages déterministes, à faire dans cet ordre :
  (1) TESTS SUR PAGES GELÉES AU GATE — pages réelles déjà sauvegardées
  (coches, AutoScout, Leboncoin, Bilbasen…) + `truth_golden` ; chaque
  parseur rejoué à chaque push avec résultat attendu (nombre d'annonces,
  prix, année, modèle structuré, devise). Zéro Zyte, attrape les
  régressions avant déploiement. (2) PLAUSIBILITÉ DE CHAQUE RELEVÉ à
  l'écriture — médiane qui bouge de plus de 40 % d'un passage à l'autre,
  prix hors fourchette du segment, années hors fenêtre du référentiel, deux
  sites du même pays qui divergent de moitié : rien n'est bloqué, le relevé
  est marqué et un dossier Truth Center s'ouvre avec la preuve. (3) CANARIS
  VIVANTS quotidiens — une URL de référence par site, ordre de grandeur
  connu (RAV4 ES, Mokka NL…) ; invariants : ≥ N annonces, champs présents
  ≥ 90 %, devise cohérente, total lisible, modèle structuré posé ; 17
  appels Zyte par jour ; en échec, dossier « site cassé » et études du site
  en « douteux » jusqu'à réparation. Le modèle de langage n'intervient
  qu'en bout de chaîne pour le résumé du matin (crédits Anthropic à
  recharger). Ordre proposé : étage 1, puis 2 (touche l'argent), puis 3.
- **TÉLÉMÉTRIE : TEMPS PAR JOUR AU CLIC SUR UNE SEMAINE (23/09, demande
  Channing)**. En-têtes de semaine et cases du tableau cliquables : un
  second tableau s'ouvre dessous, un jour par colonne (lun. → dim., dates),
  temps et nombre de sessions par personne, total de la semaine. Même
  découpage en sessions (événements espacés de moins de 15 min), chaque
  session comptée au jour de son début, heure locale. Jours à venir grisés.
- **NÉGOCIATIONS : PHOTOS PLUS NETTES (23/09, demande Channing « un peu
  flou », PDF de 24 photos = 2,4 Mo)**. Diagnostic sur les photos stockées :
  le PDF embarque les octets tels quels (pdf-lib, une page = l'image), la
  perte est à la SOURCE — beaucoup de dossiers en 613 × 460 ou 575 × 383,
  50 à 65 Ko par photo. Sondes par site (23/09) : Marktplaats — l'extracteur
  ne connaissait que l'ancien hôte eBay et retombait sur la couverture
  (og:image) ; l'hôte actuel images.marktplaats.com sert l'ORIGINAL 1 918 ×
  1 439 (766 Ko) avec la règle `$_#` (%23), $_57 idem, $_86 = 1 024 px →
  corrigé. Blocket — 7 classes (default = 575 × 383 … 1600w = 1 280 × 853)
  → classe 1600w. Plafond du ré-encodage client (ajouts manuels, webp) relevé
  de 1 600 à 2 400 px. Leboncoin (sonde 23/09 sur une annonce réelle) :
  `rule=ad-image` = 613 × 460 (54 Ko), `rule=ad-large` = 1 067 × 800 (139 Ko),
  ad-original / sans règle = 404 / 400 → ad-large demandée, ad-image en
  repli côté worker. La Centrale : URLs SIGNÉES, la plus grande servie est
  déjà src1_5x = 1 096 × 829 (webp) — changer size= casse la signature (403),
  rien à gagner. AutoScout déjà à 1 440 × 1 080. Restent à sonder : Bilbasen
  (`?class=S960X960` → S1200 ? recon bloquée « not a robot » sans profil),
  Subito (page robot sans galerie), Gaspedaal. Le poids du PDF suivra la
  source : 24 photos Marktplaats à l'original ≈ 18 Mo, Leboncoin ≈ 3,3 Mo.
- **OFFRES : « INVALID DATE » SUR LES PREMIÈRES IMMATRICULATIONS (25/09,
  fichier Opel Astra / Grandland)**. Le fichier mêle 23 vraies dates Excel
  et 24 cellules TEXTE au format américain « 6/16/2025 » ; le parseur lisait
  jour/mois à l'européenne → « 2025-16-06 » → « Invalid Date » à l'écran et
  dans le PDF. Corrigé : ordre jour/mois décidé sur tout le fichier (une
  cellule tranche seule quand une part dépasse 12, les ambiguës suivent
  l'ordre du fichier, Europe par défaut), mois/jour hors bornes → vide ; les
  afficheurs (écran, PDF, Excel) rendent « — » au lieu d'« Invalid Date ».
  Vérifié : 42/42 dates sur le fichier du 25/09.
- **NÉGOCIATIONS : NOM LIBRE DU PDF PHOTOS (26/09, demande Channing)**. Champ
  « Nom du PDF » dans la modale photos, valeur de départ = titre de la
  ligne, sans jamais la renommer. Enregistré dans `negotiations.pdf_title`
  (migration 20260926100000, additive) ; tant que le SQL n'est pas collé, ou
  pour la négociation d'un collègue (Open space), le nom reste sur le
  navigateur (repli local, dit à l'écran). Le PDF photos n'a pas de texte :
  le nom est celui du fichier téléchargé.
- **CONTACTS : PRO / PARTICULIER, DOUBLONS, DOCUMENTS DES PROS (26/09, trois
  demandes Channing)**. (1) DOUBLONS — cause prouvée : `persistContactSlot`
  recréait une fiche à chaque génération de document quand la sélection du
  contact s'était perdue (brouillon d'une autre machine) et que le
  particulier n'avait pas de SIREN ; 13 groupes, 30 fiches en trop le
  26/09 (Roudier ×6 le 18/09, Laurent-Lemetais ×6, Vernaelde ×5). Filet
  ajouté : même nom (mots triés) + même code postal = même fiche, la plus
  ancienne, mise à jour ; même garde sur « Ajouter un contact ». Bouton
  « Fusionner les doublons » : garde la plus ancienne, rattache les 6
  colonnes contact des dossiers (vendeur, vendeur 2, acheteur, acheteur 2,
  fournisseur, client), supprime les autres, rend le compte ; MC Export
  jamais fusionné. (2) PRO / PARTICULIER — `contacts.category` (migration
  20260926120000), déduite tant qu'elle n'est pas posée (société ou SIREN
  → pro) ; deux onglets avec compteurs, choix explicite dans le formulaire ;
  sans la colonne, on écrit sans elle. (3) DOCUMENTS DES PROS — table
  `contact_documents` + fichiers dans admin-documents/contacts/{id}/ : dépôt
  (PDF, JPG, PNG), ouverture, suppression depuis la fiche ; dans un dossier,
  section « Pièces de {pro} » à côté des documents (certificat de cession,
  DA…) avec chaque pièce ouvrable et « Imprimer toutes les pièces » = un
  seul PDF assemblé (pdf-lib : PDF recopiés page à page, images une page
  chacune), affiché dans l'aperçu. SQL à coller : migration 20260926120000.
  Suite (26/09, après test Channing sur SaleCar Nokia Oy) : « Renommer »
  sur chaque pièce — libellé édité en place (Entrée enregistre, Échap
  annule), seul `contact_documents.label` change, le fichier et son chemin
  restent ; le nouveau nom est repris aussitôt dans « Pièces de {pro} ».
- **STOCK DES CONCESSIONS DE LA CARTE — ÉTAPE 1 : ADAPTATEUR + FENÊTRE (30/09,
  demande Channing : « un bouton quand un site vitrine peut être scrappé, la
  liste de leurs voitures et ce qui manque depuis le dernier relevé —
  vélocité et force de proposition »)**. Trois fournisseurs de sites de
  concession reconnus SUR PREUVE, sans navigateur ni Zyte (`worker/
  dealerStock.ts`) : dvnl (Auto Smeeing : JSON embarqué, 896/896, plaque,
  VIN, km, année, énergie, boîte, date de mise en ligne), datamotive
  (Century, Next.js : JSON-LD ItemList, 1 155/1 161, ni km ni année en
  liste), autodata (Krimpenerwaard : POST + cookie + jeton CSRF, 362/362).
  Tables `network_stock_vehicles` (first_seen / last_seen / gone_at /
  price_prev, unique contact × id) et `network_stock_runs` (bilan) —
  migration 20260930120000. Mode `dealer_stock` de l'edge ingest-url.
  Carte : bouton « Stock relevé » sur un contact avec vitrine → fenêtre
  (en stock / nouveaux / disparus / prix changés, filtre, « Relever
  maintenant », vélocité = médiane des jours en stock des disparus). Suites
  décidées : (2) relevé automatique quotidien des contacts suivis ;
  (3) « tu peux proposer ici » — croiser offres / négociations / MI avec
  les stocks relevés (même modèle + x prix) ; (4) fiche détaillée
  datamotive pour km / année ; (5) outil MCP. Site inconnu → message clair,
  à reconnaître avant d'ajouter.
- **STOCK DES CONCESSIONS — ÉTAPE 5 : OUTIL MCP `dealer_stock` (30/09, demande
  Channing : « ajouter à GPT l'accès au stock des vitrines pour comparer
  avec ce qu'on a dans le MI »)**. Serveur MCP 0.4.0, 13 outils. Sans
  contact : vue d'ensemble des vitrines relevées (dernier relevé, total,
  arrivées, départs) ou, avec marque / modèle, qui a ce modèle en stock et à
  quel prix médian. Avec un contact : ses relevés, sa liste (en stock /
  arrivés depuis N jours / partis / prix changés), la vélocité, et un
  RÉSUMÉ PAR MODÈLE (nombre, prix min / médian / max, km médian, années) que
  GPT compare au MI avec `market_prices(brand, model, country)`. Classe
  corrigée au passage : le fournisseur autodata ne séparait pas le modèle
  du titre (résumé groupé par marque seule) → `splitTitle` dans le worker
  (marques à deux mots, « Model 3 », « G-Klasse », « Range Rover », « 3
  Serie ») ; les lignes déjà en base sont complétées au prochain relevé et,
  d'ici là, l'outil déduit le modèle du titre. Vérifié en local sur le code
  du serveur avec le compte de test : 13 outils, Krimpenerwaard 362 en
  stock, « qui a une Yaris » → 2 à 13 445 € médian, top modèles 3008 ×14,
  Golf ×11. Après déploiement : supprimer puis recréer l'app ADA dans
  ChatGPT / Claude.ai (liste d'outils en cache côté client).
- **STOCK DES CONCESSIONS : BYMYCAR LU (JSON-LD IMBRIQUÉ) + GARDE-FOU
  RÉPARÉ (02/10, constat Channing : « pour la vitrine bymycar il trouve
  rien »)**. Preuve : bymycar.fr/voiture-occasion porte un JSON-LD
  CollectionPage → mainEntity → ItemList de Car (le lecteur n'acceptait
  qu'un ItemList en tête de bloc → 0 item) ; numberOfItems = 24 = taille
  de page, le vrai total est dans la page (« 6489 véhicules correspondent
  à votre recherche »), 271 pages de 24 (?page=N ; limit / perPage /
  itemsPerPage / nb / size ignorés, sondés). Km, carburant, prix,
  disponibilité dans le JSON-LD ; année dans l'URL (-occasion-2023-),
  modelDate « 1970 » = bouche-trou ignoré ; nom « Q3 Sportback … - 1970 »
  nettoyé et préfixé de la marque. Deuxième classe : le garde-fou « relevé
  vide » ne tirait pas (total inconnu replié sur 0 = « le site annonce 0 »)
  → champ `declared` (total annoncé par le site, null = inconnu) sur tous
  les fournisseurs, seul declared === 0 vaut stock vide. Plafond de pages
  calculé depuis le total (≤ 400) au lieu de 150. Troisième classe : une
  page en échec arrêtait la lecture SANS LE DIRE (Century lu à 986 / 1 189
  en test) → relecture une fois après pause, sinon avertissement « relevé
  partiel » ; un 404 après la dernière page est une fin normale. Vérifié en
  local : BYMYCAR 6 489 / 6 489 en 271 pages (12 min 48, prix 6 489, km
  6 476, année 6 489, carburant 6 482) ; Century 1 176 / 1 189 en 101
  pages (1 143 au relevé du 01/10).
- **CONTACTS EN DOUBLON : CAUSE, MENU DÉDOUBLONNÉ, FUSION SQL (02/10, constat
  Channing : « pourquoi j'ai autant de doublons dans les contacts ? »)**.
  Mesure en base : 65 contacts, 11 groupes au contenu strictement identique
  (type, noms, téléphone, e-mail, SIREN, adresse, CP, ville), 28 lignes de
  trop (LE PAGE / METAIS ×6, ROUDIER ×6, VERNAELDE ×5, PILON ×4, RAMON ×4,
  EHRET ×3, MAINGRET ×3, DANEAU, MILLOT / RATHQUEBER, ESSALHI, GHEZALI ×2),
  chaque groupe créé dans la même minute, toutes avant le 26/09. Classe : la
  sauvegarde du dossier insérait un nouveau contact à chaque passage ;
  corrigée le 26/09 (sameContactIdentity → mise à jour, jamais d'insertion),
  aucun doublon depuis. Livré : (1) les menus déroulants des parties du
  dossier ne montrent qu'UNE entrée par identité (le plus ancien, ou celui
  déjà choisi), triée par nom ; (2) SQL 20261002140000_contacts_dedupe :
  survivant = plus ancien, dossiers (6 colonnes de transactions_admin) et
  pièces (contact_documents) repointés AVANT suppression, groupes au contenu
  différent laissés tels quels, contrôle final en booléen. Simulé sur
  l'export réel : 28 supprimées, 37 restantes. Vérification après collage :
  aucun dossier ne pointe vers une ligne absente.
- **STOCK DES CONCESSIONS : SITE DERRIÈRE CLOUDFLARE → ZYTE (02/10, constat
  Channing sur Vallei Auto Groep : « page du stock : HTTP 403 »)**. Preuve :
  en-tête cf-mitigated: challenge et page « Just a moment… » quels que
  soient les en-têtes envoyés. Repli dans getText : sur 403/503 de défi, la
  page est demandée à Zyte (débloqueur brut, puis navigateur), chaque appel
  compté et dit dans le bilan du relevé (« n page(s) lue(s) via Zyte —
  relevé payant ») ; arrêt immédiat si Zyte répond 401/402/403 (compte).
  Si Zyte ne rend pas la page non plus : cas « dealer_site_blocked » dans la
  boîte (actor dev). Non testable ici (pas de clé Zyte en local) : à
  vérifier par un « Premier relevé » de Vallei après déploiement.
- **BOÎTE À APPRENDRE : PON CENTER ET MENGELERS RECONNUS (02/10, « nouvelles
  vitrines à corriger dans la boîte »)**. Deux familles de plus, sur preuve :
  (7) « dmapi » — Pon Center : data-vehicle-overview porte dmUpdateUrl
  (api.datamotive.nl/…/vehicle-list/3188) et dmFilterSetId ; GET avec
  filterId, page, pageSize=48 (plafond du service, « Page size mag niet
  groter zijn dan 48 »), sort, et vehicleState[used]=1 quand la page
  demande les occasions (format trouvé par sondes : vehicleState[]=used
  rend 0, vehicleState=used ignore le filtre) ; fiche = /p/<slug> (lu dans
  le chunk VehicleOverview) ; prix = prices.purchase.value. Ni km, ni
  année, ni plaque en liste (même limite que Century). Vérifié : 647 / 647
  occasions (614 neuves exclues), 14 pages en 11 s. (8) « cartelcaw » —
  Mengelers (client Cartel CAW de uname-it) : pages rendues, cartes
  productList__item (titre, version, année · km · énergie · boîte, prix
  « € 25.950,- », lien avec _occasion_ / _demo_ / _nieuw_ et plaque),
  max=96 et pagina=N (trouvé par sondes : page / offset ignorés), total
  dans la page. Vérifié : 685 / 685, 9 pages en 11 s, 22 sur demande ;
  126 sans plaque = les neufs que leur page « occasions » affiche aussi.
  Classe au passage : num() lisait « 25.950,- » comme NaN (le « ,- »
  néerlandais) → prix null partout ; corrigé pour tous les fournisseurs.
  Les deux cas se fermeront seuls au prochain relevé réussi.
- **TÂCHES PAR UTILISATEUR (02/10, demande Channing : « une interface dans
  l'accueil pour chaque utilisateur où je pourrai leur donner des tâches via
  la boîte admin »)**. Table `user_tasks` (assignee, créateur, clé stable,
  titre, note, lien, statut, vue le, faite le ; RLS : chacun voit les
  siennes, l'admin tout ; création et suppression admin ; validation par la
  personne ou l'admin) — migration 20261002120000, qui insère aussi les 6
  lacunes réelles de campagne dans la liste de Channing (quoi fournir +
  lien de la page en échec). Boîte à apprendre : panneau « Confier une
  tâche » (compte, tâche, note, lien) + liste de toutes les tâches par
  compte (à faire / faites, « pas encore vue », supprimer) ; bouton
  « Confier à… » sur chaque cas ouvert, prérempli (ex. client du tableur →
  « à créer dans les contacts »). Accueil : carte « Mes tâches » en tête
  (coche = validée, faites visibles 7 jours barrées, lien « Ouvrir »
  interne ou externe) ; pastille ambre sur « Accueil » dans l'en-tête,
  relue toutes les 60 s, à chaque navigation et au retour sur l'onglet.
  Au passage : tableur, un client d'un seul mot (≥ 5 lettres) porté par UN
  SEUL contact est rattaché (ligne RV464 « LOUWMAN » → LOUWMAN OCCASION
  CENTER B.V). Vérifié : colonnes actor / link bien en base (SQL du 02/10
  collé) ; crédits Anthropic laissés tels quels (décision Channing).
- **BOÎTE À APPRENDRE : PREMIÈRE TOURNÉE DE CORRECTIONS (02/10, demande
  Channing : « que peux-tu régler là ? »)**. Contenu lu en base : 1 vitrine
  inconnue (Louwman), 1 service bloqué (crédits Anthropic), 7 lignes du
  tableur non rapprochées, 0 signalement, 241 lacunes de campagne (10
  dernières campagnes). Réglé par CLASSE : (1) 146 lacunes « 0/35 annonces
  = CLASSE CLA » — la confirmation du modèle structuré exigeait l'égalité
  de famille ; les sites structurent la VERSION (« CLA 200 », « E 220 d »,
  « 745 », « NX 300h », « EQV 300 », « 2 Serie Gran Coupé ») →
  modelPrefixMatches (même clé, ou clé d'étude suivie d'un chiffre, ou
  série à un chiffre) + structuredModelMatches des études, passés en juge
  par annonce à confirmStructuredLabel — 16 vecteurs ; (2) 88 lacunes
  Mercedes « X-CLASS » : même classe ; (3) 3 lacunes TESLA « MODEL » :
  modèle générique, masquées (identité v4) ; (4) lacunes déjà comblées en
  mémoire masquées ; (5) bouton « Re-tester les n lacunes en campagne »
  (plan explicite, celles qui se confirment écrivent la mémoire et
  disparaissent) ; (6) tableur : rapprochement TOLÉRANT des clients
  (formes juridiques retirées, jetons du tableur tous présents dans UN
  SEUL contact) — règle VAN EKRIS MIJDRECHT, BELLON MOTORSPORT, LOUWMAN
  OCCASION CENTER (3 des 7), jamais de devinette à deux candidats ;
  (7) Louwman : 6e fournisseur « cmsms » (CMS Made Simple, module
  Occasions : POST ajaxDoAdvancedSearch, 24 cartes par page, data-* du
  favAuto, texte « 2026 · Electra · 852 km », plafond 250 pages) — vérifié
  en direct : 3 904 / 3 908, 164 pages en 95 s, 99 réservées, 68 attendues,
  0 manquant. Reste à Channing : recharger les crédits Anthropic ;
  créer le contact MUSTIÈRE AUTOMOBILES (3 lignes) et « LOUWMAN » seul (1
  jeton, 2 contacts possibles) ; cliquer « Re-tester » ; relever Louwman
  (ferme son cas seul). Restent côté dev : BLOCKET X3 carburant illisible,
  JOFOGAS année non structurée, 3 slugs AutoScout FR, 2 slugs Bilbasen.
- **BOÎTE À APPRENDRE : TOUT CE QUI ATTEND UNE CORRECTION (02/10, décision
  Channing : « tout ce qui peut nécessiter une action de correction va dans
  la boîte, y compris les signalements »)**. Règle : un cas entre quand ADA
  a buté ET sait dire quoi faire ensuite ; un cas par sujet (kind + key),
  compté ; jamais les erreurs passagères ni les journaux. Deux champs :
  `actor` (equipe | dev) et `link` (où aller) — migration 20261002100000,
  avec droit d'écriture pour les comptes connectés. Module worker
  `learningBox.ts` (recordLearningCase + resolveLearningCase : un cas se
  ferme SEUL quand la réalité l'a réglé). Familles branchées :
  dealer_site_unknown (dev, fermé par un relevé réussi) ; dealer_scan_empty
  (dev, idem) ; service_blocked zyte 401/402/403 (equipe) et
  anthropic_credits veille (equipe) ; site_failing = site ✗ sur ≥ 3 études
  le même matin (dev, fermé un matin sans échec) ; sheet_row_unmatched =
  client du tableur introuvable (equipe, fermé quand rattaché) ;
  mail_failed (equipe) ; offer_file_unparsed depuis la page Offres (dev :
  0 véhicule ou ni marque / modèle / VIN, ou fichier illisible). Lus sans
  être copiés : signalements (ada_feedback, capture visible, Fait écrit
  dans leur table) et lacunes de campagne des 10 dernières campagnes
  (Fait = resolved_at de l'item). Boîte : filtres Équipe / Développement,
  bouton « Ouvrir » vers la page, pastille de l'en-tête toutes sources. MCP
  learning_cases rend actor et link. Au passage : la fenêtre Stock garde
  l'échec du dernier relevé affiché jusqu'à sa fermeture (constat Channing
  sur Louwman : le message disparaissait, effacé par le rechargement).
  Louwman (www.louwman.nl) est dans la boîte, vu 2 fois, sans indice
  technique : à sonder.
- **BOÎTE À APPRENDRE : ACCÈS ADMIN DANS L'EN-TÊTE (01/10, demande Channing :
  « un accès spécial admin parmi ces options »)**. Icône « chapeau de
  diplômé » entre le Truth Center et la télémétrie, admin seul, avec la
  pastille du nombre de cas ouverts (relue toutes les 60 s et à chaque
  navigation) ; page `/apprendre` dédiée (même contenu que l'onglet du
  Centre de vérité, réservée à l'admin). Table absente → pas de pastille.
- **BOÎTE À APPRENDRE + 5e FOURNISSEUR « dvapi » (HEDIN) (01/10, demande
  Channing : « ajoute ce type de vitrine ; et pour toute vitrine inconnue,
  un endroit où tu les enregistres pour les traiter ensemble »)**. Hedin
  Automotive : même famille que Auto Smeeing (items dvnl) mais servie par
  une API JSON `data-update-url="/voorraad-api/vehiclelist/76/vehicles.json"`
  (limit=100&page=N, pages.total, count) ; mapping dvnl factorisé
  (dvItemToVehicle) + statuts verkocht / verwacht / gereserveerd en
  attributs. Vérifié en direct : 4 376 / 4 380, 44 pages en 37 s, 20
  réservées, 11 attendues, 1 sur demande, 0 avertissement (4 doublons de
  numéro Hexon, 70 sans plaque). BOÎTE À APPRENDRE : table `learning_cases`
  (kind + key uniques, seen_count, detail, status open / done / ignored,
  resolution) ; le worker y enregistre une vitrine non reconnue avec l'hôte,
  le titre de la page et les indices techniques repérés (wordpress, nextjs,
  nuxt, drupal, typesense, algolia, hexon, dvnl-media, iframe…), et le
  message du relevé le dit (« vitrine enregistrée dans la boîte à
  apprendre ») ; Centre de vérité → onglet « À apprendre » (compte, liste,
  Fait avec résolution / Ignorer / Rouvrir) ; outil MCP `learning_cases`
  (0.5.0, 14 outils) pour qu'une session Claude prépare les adaptateurs.
  Différent de la boîte noire technique (worker_logs). Vérifié :
  vakgarage.nl → « non reconnu — indices : hexon, dvnl-media, iframe ».
  Garde-fou au passage (constat Van Mossel : reconnu datamotive, 0
  véhicule) : un relevé vide sur un site reconnu n'écrit rien et ne marque
  rien disparu — Van Mossel à revoir (cas pour la boîte). SQL à coller :
  migration 20261001170000.
- **STOCK DES CONCESSIONS : SUIVI EN ARRIÈRE-PLAN + INDICATEUR (01/10, demande
  Channing : « si je vais faire autre chose je ne vois plus la recherche se
  faire ; il faut un indicateur et maintenir le relevé même si on ferme la
  page »)**. Le relevé tournait déjà sur le worker, mais son SUIVI vivait
  dans la fenêtre : fermée, plus rien ne l'observait ni n'affichait le
  résultat. Désormais le suivi vit dans le service (startDealerScan /
  subscribeDealerScans / takeDealerScanOutcome, même mécanique que
  l'extraction de photos des négociations) : fermer la fenêtre ou changer
  de page n'arrête rien ; la carte affiche « relevé en cours… » sur la
  ligne et la fiche du contact, plus une ligne d'ensemble au-dessus de la
  liste ; la fenêtre rouverte retrouve l'état, reçoit le bilan et se
  recharge. Page RECHARGÉE pendant le relevé : la table network_stock_runs
  (status running, lancé il y a < 20 min) est relue toutes les 10 s par la
  carte et 5 s par la fenêtre jusqu'à la fin — le relevé lui-même n'a
  jamais dépendu du navigateur. Message dans la fenêtre : « tu peux fermer
  cette fenêtre ou changer de page ».
- **CARTE : « RELEVÉS » ≠ « DÉCLARÉS » (01/10, constat Channing : « les
  stocks affichés ne correspondent pas aux stocks réels »)**. Classe : la
  liste et la fiche affichaient « n en stock » pour deux choses différentes
  — la MESURE du worker (stock_total mis à jour par un relevé) et la
  DÉCLARATION saisie à la main le 07/09 (Broekhuis 114, Century 26, Emil
  Frey 119…), indiscernables. Désormais la carte lit le dernier relevé
  réussi par contact (network_stock_runs) : « 4 698 relevés le 01/10 » en
  vert avec la date et le fournisseur, sinon « 114 déclarés » en gris avec
  l'explication au survol ; rien sans donnée. Fermer la fenêtre « Stock
  relevé » recharge la carte. Les chiffres déclarés restent modifiables sur
  la fiche ; seul un relevé les remplace à l'affichage.
- **STOCK DES CONCESSIONS : MOUVEMENTS DE PRIX PAR VÉHICULE (01/10 soir,
  demande Channing : « enregistrer pour chaque véhicule les baisses, pour
  voir quand ils vendent s'ils ont dû baisser ou non »)**. Colonnes
  `price_first` (premier prix vu) et `price_history` (chaque prix daté, du
  premier au courant) sur network_stock_vehicles ; le worker ajoute une
  entrée à chaque changement, reconstruit l'historique des lignes d'avant
  depuis price_prev / price, et écrit sans les colonnes tant que le SQL
  n'est pas collé (colonne absente lue dans le message PostgREST, retirée,
  réessai ; avertissement dans le bilan). Fenêtre : sous le prix, le chemin
  « 32 900 → 31 500 → 29 900  −3 000 € (−9,1 %, 2 baisses) » ; onglet
  « Prix bougé depuis l'arrivée » (toute la vie de l'annonce, plus
  seulement le dernier relevé) ; en-tête « n/m disparus avaient baissé
  (baisse médiane x %) ». MCP dealer_stock : priceFirst, priceHistory,
  priceDrops, priceRaises, priceDelta(Pct) par véhicule, goneWithPriceDrops
  par concession. Vérifié : 5 vecteurs (historique, repli price_prev, sans
  mouvement, hausse puis baisse, sans prix). SQL à coller : migration
  20261001150000. Décision Channing : Broekhuis reste sur l'occasion (pas
  de tri du neuf pour l'instant).
- **STOCK DES CONCESSIONS : 4e FOURNISSEUR « listerpage » — BROEKHUIS GROEP
  (01/10, constat Channing : « site vitrine non reconnu »)**. Preuve : la
  page HTML ne contient aucune annonce ; le stock vient d'un POST JSON sur
  l'URL `listerpage.ajax_url` des drupalSettings (corps facets / search /
  geo_search / sort / pager lu dans listerpage.min.js), 72 par page, pager
  {total, pages}. Détection : `"listerpage":{…"ajax_url"…}` dans la page.
  Lecture : facettes imposées par la page (status = Gebruikt + Demo via
  l'alias d'URL → champ de facette), tri repris de l'URL, id = ecommerce.
  item_id, marque / modèle = ecommerce.item_brand / item_variant, prix =
  product.price.price, statut = product.status.label (« Op voorraad »,
  « Verwacht » → attendue, « Verkocht » → vendue), specs → km (format
  kilometerstand), année, boîte, énergie ; pas de plaque ni de VIN en
  liste ; les 2 lignes vides par page (bannières) ignorées. Vérifié en
  direct : 4 698 / 4 698 véhicules, 68 pages en 101 s, 0 avertissement,
  144 attendues, 56 vendues, 0 manquant sur prix / km / année / marque /
  modèle. C'est un GROUPE (toutes les concessions Broekhuis) : le diff
  reste utile, la vélocité par site non.
- **STOCK DES CONCESSIONS : PLUS JAMAIS « 0 € » — STATUT D'ANNONCE (01/10,
  constat Channing sur Auto Smeeing : Audi A1 « Op aanvraag » / « Binnenkort
  verwacht » à 0 € dans le relevé)**. Classe : un prix absent était écrit 0
  et affiché 0 €, et il entrait dans les médianes de l'outil MCP. Désormais,
  sur les TROIS fournisseurs : prix ≤ 0 → null, et une colonne `status`
  dit pourquoi — price_on_request (« op aanvraag »), expected (« binnenkort
  verwacht », schema.org PreOrder), reserved (« gereserveerd », attribut ou
  sticker dvnl), sold (« verkocht », SoldOut) ; null = en vente. dvnl :
  attribut gereserveerd / enrichedValues.reserved / sticker ≠ Beschikbaar ;
  datamotive : offers.availability ; autodata : mots de la carte. Fenêtre :
  pastille « sur demande / attendue / réservée / vendue » à la place du
  prix, compteur « n annonces sans prix affiché » en pied, écart de prix
  jamais calculé contre un 0 ; MCP dealer_stock : price null + status,
  médianes sur prix > 0 seulement. Colonne absente (SQL pas collé) → le
  relevé écrit sans statut et le dit dans les avertissements. Vérifié en
  direct sur Auto Smeeing : 907 véhicules, 0 à zéro, les sans-prix sortent
  en price_on_request. SQL à coller : migration 20261001120000 (ajoute la
  colonne, passe les 0 € déjà relevés à null + sur demande).
- **STOCK DES CONCESSIONS : « null value in column first_seen_at » AU RELEVÉ
  (01/10, constat Channing sur Krimpenerwaard)**. Classe : l'upsert groupé
  posait first_seen_at seulement sur les véhicules nouveaux et price_prev
  seulement sur les prix changés ; PostgREST prend l'UNION des clés du lot,
  une clé absente sur une ligne y vaut null. Les deux relevés du 30/09
  passaient parce que leurs lots étaient homogènes (tout nouveau, puis tout
  connu) ; le premier lot MIXTE (arrivages + stock connu) mettait
  first_seen_at à null sur les connus. Désormais chaque ligne porte les
  mêmes clés : first_seen_at gardée (ou posée), price_prev gardée (ou
  remplacée par le prix d'avant quand il change).
- **IDENTITÉ MODÈLE v4 : UNE LETTRE SEULE N'EST PAS UNE GÉNÉRATION (01/10,
  constat Channing : campagne « Model x » sur 17 sites → 4 pages marque TESLA
  2026 ; MI sans Model X au menu)**. Classe : la clé d'identité retirait tout
  numéral romain final (« Golf IV » → « Golf ») ; « X » = 10 donc « Model X »
  → « Model », dans les TROIS copies de la règle (TS, Python des importeurs,
  SQL ada_model_key). Dégâts prouvés : référentiel Tesla importé sous
  « Model » ; mapping Marktplaats TESLA « MODEL » né d'une recherche texte
  libre « tesla model », validé « humain » 2× avec 2 relevés MI qui mélangent
  toutes les Tesla ; planificateur : le filtre « Model x » ne trouvait que ce
  combo, écarté par la preuve de marché → 0 étude précise, 4 pages marque
  (part découverte, dernière année seule) ; « Aygo X » (386 relevés, modèle
  distinct depuis 2022) fondu dans « Aygo ». Correctifs, dans l'ordre du
  plan validé : (1) règle : seuls II à IX sont retirés — ROMAN_GENERATION_RE,
  importeurs Python, ada_model_key v4 ; colonnes brand_key / model_key de
  market_listing_observations : générées → ordinaires + trigger (recalcul
  des seules lignes touchées, pas de réécriture de table) ; (2) données :
  référentiel « Model » → « Model X », « Aygo » 2022→ → « Aygo X »,
  motorisations EEA TESLA MODEL → MODELX, fichiers seed patchés ; mapping
  Marktplaats « MODEL » + 2 relevés + observations supprimés ; (3) planifi-
  cateur : un modèle tapé inconnu de la mémoire et du référentiel devient
  une HYPOTHÈSE OPÉRATEUR planifiée telle quelle (site × année × carburant)
  sur les marques cochées — sans marque cochée : tracé, et « no_plan » dit
  pourquoi ; (4) APERÇU avant lancement : « Préparer » calcule le plan côté
  worker sans rien créer (dryRun), affiche « N études : exploration /
  renforcement / pages marque / hypothèse, ~min, appels Zyte », puis
  « Confirmer » lance ; tout changement de réglage invalide l'aperçu ;
  (5) découverte de gamme sur toute la fenêtre d'années ; (6) garde-fou :
  un modèle générique (MODEL, SERIE, CLASSE… ou égal à la marque) n'entre
  plus en mémoire, ni à l'ingestion ni au centre de résolution. Vérifié :
  12 vecteurs de clé, scénario Channing rejoué → 119 études (17 sites × 2020
  à 2026, électrique), 0 étude + raison sans marque. SQL à coller :
  migration 20261001100000 (tant qu'il n'est pas collé, le MI liste Model X
  au menu mais ses observations Leboncoin restent sous l'ancienne clé).
  Vu au passage : « Clio V » et consorts ne sont plus fondus dans « Clio »
  (aucun relevé concerné aujourd'hui).
- **NÉGOCIATIONS : PHOTOS DEPUIS UN PDF (01/10, demande Channing avec un
  dossier d'exemple : Toyota Yaris Cross Trail, 43 pages, une photo
  1066 × 800 par page)**. « Ajouter des photos » accepte maintenant aussi un
  PDF : chaque page est rendue dans le navigateur (pdf.js, build legacy
  avec polyfills — le build moderne exige Safari 17.4+), exportée en JPEG
  (plus grand côté 1 600 px, jamais sous la taille native, fond blanc) et
  envoyée comme une photo ajoutée à la main, dans l'ordre du PDF, enregistrée
  page après page (une coupure ne perd pas ce qui est fait) ; le bouton
  affiche « page 12/43 » puis « envoi 12/43 ». PDF mixte (texte, scans) :
  chaque page devient une photo, à retirer si inutile ; masquage et rognage
  existants pour le bandeau Leboncoin ou le logo vendeur. pdf.js chargé à
  la demande (module séparé de 514 ko, rien tant qu'on n'ajoute pas de
  PDF). Vérifié sur le PDF fourni dans Chromium : 43 pages en 4,4 s,
  1 600 × 1 201 chacune, 11,5 Mo au total, page 1 = la Yaris Cross.
- **OFFRES : EXCEL MIS EN FORME (30/09, constat Channing sur l'offre Allemagne
  pour un client : « les lignes se chevauchent »)**. L'export SheetJS
  communautaire n'écrit aucun style : textes longs (version, rapport) ni à
  la ligne ni bornés, hauteurs par défaut, rien pour distinguer l'en-tête.
  Passage à xlsx-js-style (même API + styles) : titres fusionnés sur la
  largeur, en-tête gras sur fond sombre, retour à la ligne sur véhicule /
  motorisation / version / couleur / rapport avec hauteur de ligne calculée
  (≤ 6 lignes), lignes alternées, bordures fines, prix « 12 600 € » et km
  formatés, prix de vente en gras, rapport DEKRA en lien cliquable, filtre
  automatique sur l'en-tête ; même traitement sur « Caractéristiques ».
  Vérifié à la relecture du fichier produit (fusions, hauteurs, styles,
  liens). Volets figés non supportés par la bibliothèque.
- **OFFRES : « A6 AVANT » SORTAIT EN UTILITAIRE (30/09, constat Channing sur
  le PDF)**. Classe : la carrosserie était déduite par « contient » — « van »
  se trouvait dans « Avant ». Mots entiers seulement ; breaks reconnus par
  leurs noms de marque (Avant, Variant, Touring, Sports Tourer, SW, ST,
  Sportbrake, Shooting Brake, allroad…) ; utilitaires par mots et modèles
  sans équivoque (fourgon, cargo, L1H1, Transit, Trafic, Sprinter,
  Ducato…). Sportback = voiture. Même règle pour le PDF et l'Excel.
- **OFFRES : FICHIER ITALIEN AUDI A6 / Q6 E-TRON (30/09, demande Channing
  « apprends à ADA à traiter cette liste, toutes les data »)**. Avant : 58
  véhicules lus mais VIN perdu (« N° Telaio » ignoré), énergie vide
  (e-tron), marque « A6 » sans référentiel, lieu et conditions ignorés.
  Corrigé (classe) : synonymes italiens dans les règles d'en-tête (telaio,
  targa, immatricolazione, colore, cambio, danni, prezzo, potenza, sede,
  IVA, marca, modello, versione…) ; titre de bloc « MARQUE modèle (n
  units) » lu : marque, indice de modèle (A6 e-tron plutôt que A6 quand le
  référentiel le connaît) et compte d'unités contrôlé contre les lignes
  lues (avertissement si écart) ; e-tron / ID.x / EQx = électrique, « TFSI
  e » = rechargeable ; électrique sans boîte = automatique ; « Pick-up
  location: … » hors tableau → lieu de chaque véhicule ; lignes « Terms &
  Conditions » et puces → notes de l'offre. Régression : les 4 fichiers
  reçus depuis le 22/09 lisent 100 % VIN, dates et prix.
- **TVA RÉCUPÉRABLE = DONNÉE DU DOSSIER (30/09, constat Channing : « je ne
  vois pas les * à côté de mes ventes »)**. L'astérisque ne vivait que dans
  le libellé véhicule du tableur, affiché seulement pour les dossiers sans
  fiche véhicule ; les dossiers de Channing ont tous une fiche, et sa
  feuille du tableur ne porte pas d'astérisque (vérifié en base : TRANSIT
  CUSTOM, IGNIS… sans « * »). Corrigé : colonne `vat_recoverable`
  (migration 20260930100000, reprise des « Véhicule : …* » déjà en notes),
  posée par la synchro à chaque passage (un « * » ajouté après coup est
  pris), case « TVA récupérable » dans la fiche véhicule du dossier, badge
  « TVA* » dans la liste quelle que soit l'origine du nom. Sans le SQL :
  enregistrement sans la colonne, liste sans le badge.
- **MCP : OFFRES, TABLEAU ÉDITÉ, CARTE DU RÉSEAU (29/09, demande Channing)**.
  Trois outils lecture seule ajoutés au connecteur ChatGPT (`ada-mcp`,
  v0.3.0) : `list_offers` (offres fournisseur, règle de prix, comptes),
  `get_offer` (tableau des véhicules avec prix fournisseur HT / TTC, TVA
  récupérable et notre prix HT, relevé « où vendre » par lot et pays),
  `network_contacts` (carte : coordonnées GPS, téléphone, e-mail, relation,
  volumes, fiabilité, modèles travaillés). Le service lit avec la clé
  service : la fermeture des accès anonymes du 27/09 ne le touche pas.
  Redéploiement Railway du service ada-mcp au push (branche de prod).
- **CHANTIER E-MAILS — ÉTAPE 3 : E-MAIL 1 À L'ACHETEUR VIA GMAIL (29/09)**.
  Table `dossier_emails` (migration 20260929100000) = journal + file : le
  front dépose « queued » (destinataire, objet, texte, pièces = dernier
  certificat de cession généré + pièces du dossier cochées, expéditeur =
  compte connecté), le worker (`mailer.ts`, poll 20 s) envoie par l'API
  Gmail AU NOM de l'expéditeur (JWT du compte de service avec `sub`,
  droit gmail.send) et note « sent » (id + thread Gmail) ou « failed » avec
  la raison Google. Bloc « Envoyer les cessions à l'acheteur » côté vente,
  case « à moi-même pour tester », journal sous le bloc. PRÉREQUIS
  CHANNING : Google Admin → Sécurité → Contrôle des API → Délégation au
  niveau du domaine → ajouter le client_id du compte de service (journalisé
  au boot du worker, ligne `[MAIL]`) avec le droit
  https://www.googleapis.com/auth/gmail.send. Sans ça : « failed —
  délégation domaine non accordée ». Étape 2 (signature + tampon) reste à
  faire ; étape 4 (pack prestataire) réutilise le même bloc ; étape 5
  (retours) lira le thread Gmail (gmail_thread_id conservé).
- **MC EXPORT JAMAIS CONTREPARTIE, CO-TITULAIRE PAR CÔTÉ (29/09, dossier
  I776 : « MC-EXPORT / RAMON YOLA » vendeur et MC Export acheteur de MC
  Export)**. Classe : la synchro du tableur passait un dossier achat en
  vente en ne changeant que le type ; l'acheteur restait MC Export (repli
  « acheteur = client » à l'ouverture) et le co-vendeur du particulier
  restait dans seller_contact_id_2. Corrigé aux quatre étages : synchro
  (bascule avec re-placement des parties : fournisseur ← vendeur, vendeur
  ← MC Export, acheteur ← client du tableur, co-vendeur effacé) ;
  ouverture (une fiche MC Export dans un slot externe vaut vide ; côté MC
  toujours MC ; co-titulaire seulement du côté externe) ; enregistrement
  (contrepartie = MC Export → null ; co-titulaire du côté MC → null) ;
  générateur (MC des deux côtés → refus explicite ; co-titulaire du côté MC
  ignoré).
- **CHANTIER E-MAILS — ÉTAPE 1 : DONNÉES PROTÉGÉES, RIEN N'EST PLUS EFFACÉ,
  PIÈCES DU DOSSIER (27/09, priorité Channing)**. Constats : 114 règles
  d'accès ouvertes au rôle anon (clé du navigateur) ; bucket admin-documents
  PUBLIC — la pièce d'identité du gérant de SaleCar se téléchargeait sans
  clé (HTTP 200, 2,2 Mo) ; purge à 30 jours de l'historique des documents.
  Livré : migration 20260927100000 (anon/public → authenticated à condition
  égale, RLS partout, bucket privé, table dossier_documents) ; URL signées
  1 h partout (`storageAccess.ts` : documents des pros, pièces, photos de
  négociations, vignettes Ventes, PDF photos, éditeurs masque/rognage —
  URL publiques en base = identifiants) ; fonction de purge supprimée ;
  section « Pièces du dossier » (types carte grise / cession achat / DA /
  cession revente / Kbis / récépissé DA / accusé DC, dépôt multiple, packs
  « prestataire » et « retours » avec les manques) ; champ e-mail sur les
  contacts. Flux acté avec les envois réels GF-922-WT : cessions à
  l'acheteur → retour signé → signature + tampon MC Export via ADA →
  pack prestataire (CG, cession achat, DA, cession revente, Kbis) → DA et
  DC renvoyées. Suite : (2) signature + tampon sur PDF ; (3) e-mail 1 via
  Gmail API (Google Workspace, compte de service existant + délégation à
  activer par Channing), journal + état du dossier ; (4) e-mail 2 pack
  prestataire ; (5) rattachement automatique des réponses par threadId.
  Résiduel à vérifier après collage : fonctions security definer
  appelables par anon (admin_*, open_space_set_photos… — toutes contrôlent
  auth.uid()).
- **FICHE OOSTENDORP RÉÉCRITE EN VAN EKRIS (26/09, constat Channing : « plus
  aucun dossier Oostendorp, trop de van Ekris »)**. Preuve : la fiche
  a5711c59, créée le 23/07 à la seconde du dossier YC507 (vente Oostendorp
  d'après le tableur), s'appelle aujourd'hui « Automobielbedrijf van Ekris
  Mijdrecht B.V » ; 41 dossiers pointent sur elle, 30 portent en notes
  « Client : AUTOGROEP OOSTENDORP », un seul (C070, Corolla du 16/09) est
  une vraie vente van Ekris ; la synchro tableur retrouvait encore une fiche
  « AUTOGROEP OOSTENDORP » le 18/09 08:40. Pas une suppression (FK ON DELETE
  SET NULL : les dossiers auraient perdu leur acheteur). CLASSE : le
  brouillon re-sélectionne la fiche du dossier précédent (correctif Louwman
  du 31/08) ; l'opérateur saisit un autre client par-dessus ; le save
  mettait à jour la fiche sélectionnée avec le nouveau nom. Corrigé :
  `sameContactIdentity` — une fiche sélectionnée n'est réécrite que si le
  formulaire porte encore son nom (adresse/SIREN libres) ; nom différent →
  bandeau ambre « elle ne sera pas modifiée », puis filet SIREN / nom + CP
  ou création. Réparation des données : migration 20260926150000 (recrée
  Oostendorp, adresse à ressaisir ; rattache les 40 dossiers, C070 reste
  van Ekris).
- **LIEU DE SIGNATURE DES CESSIONS ≠ LIEU D'ENLÈVEMENT (26/09, demande
  Channing : « le pickup location devient le lieu dans Delivery, ça a faussé
  plusieurs cessions »)**. Preuve en base : `pickup_location` porte côté
  vente « TE RÉCUPÈRE À LA GARE DE VANNES », « GARE DE BIARRITZ », « VD2L »,
  « MEAILLES »… — consignes d'enlèvement saisies côté achat, imprimées comme
  « Fait à » du certificat après bascule achat → vente (un seul champ pour
  les deux usages depuis le 21/07). Corrigé : colonne `signature_location`
  (migration 20260926160000), section unique « Date et lieu de la cession »
  (date, heure, lieu « Fait à », par défaut « Les Ponts-de-Cé ») qui seule
  nourrit certificat de cession et déclaration d'achat ; Pickup ne nourrit
  plus que la fiche d'enlèvement ; « Lieu de la vente » retiré de Delivery.
  Dossiers antérieurs : colonne vide → le siège (le lieu d'enlèvement n'est
  jamais repris). Sans le SQL : enregistrement sans la colonne + avertissement.
- **VENTES PAR COMMERCIAL (26/09, demande Channing)** : au-dessus de la
  liste, pastilles « Tous · n / Antoine · n / Channing · n / Achille · n »
  (« ANTOINE » et « Antoine » = même personne) + tri Date / Commercial /
  Client / Prix ; tableaux, historique mensuel et indicateurs suivent la
  vue ; choix mémorisé sur le navigateur.
  Suite : colonnes « Achat » et « Vente » à la place du prix unique (un
  dossier ancien range son prix unique du côté de son sens) ; véhicule du
  tableur en repli (italique) quand le dossier n'a pas encore de fiche
  véhicule.
- **MARGE HT (26/09, question Channing « les frais ne sont pas pris en
  charge ou marge TTC ? »)**. Vérifié sur 68 dossiers du tableur : la
  « commission HT » vaut (vente − achat) / 1,2 − frais HT, pour les
  véhicules en TVA sur la marge comme pour ceux à TVA récupérable (« * »
  en fin de nom : la fiscalité change, pas l'arithmétique quand les deux
  prix sont TTC à 20 %) — 54 exacts, 13 au centime près (frais arrondis),
  1 écart réel (YC784 : prix d'achat ADA 22 700 ≠ tableur). ADA calculait
  vente − achat − frais (marge TTC, frais HT). Corrigé : tuiles « Marge HT »
  = commission HT du tableur quand elle existe, sinon la même formule ;
  info-bulle « * = TVA récupérable » sur le véhicule.
- **PREMIER ÉTALON HUMAIN (14/09 soir, 23/28 lignes remplies par Channing)
  — 16 lignes exactes, 3 vrais écarts, 1 saisie erronée, 1 faux accord** :
  (1) MARKTPLAATS Ignis ADA 8 910 vs humain 9, RAV4 PHEV 1 352 vs 6 :
  l'API interne LRP ignore `l2CategoryId` (singulier) — marque ET attributs
  non appliqués, toute la catégorie autos (265 318) ; seule la requête
  texte filtrait, donc les études à mot-clé passaient et celles sans
  (Ignis, RAV4) recevaient toutes les voitures NL dans leur médiane cible
  (Ignis : 3 501 €). Prouvé et corrigé : `l2CategoryIds` (pluriel) → Ignis
  9 = 9, RAV4 6 = 6 avec les paramètres exacts d'ADA. (2) Le parseur LRP ne
  lisait ni l'année (clé constructionYear, pas year) ni le modèle : post-
  filtres année et modèle structuré fail-open sur Marktplaats → désormais
  année, km, modèle, carburant, boîte, carrosserie lus dans attributes[].
  (3) LA CENTRALE Elroq 0 = 0 : faux accord, l'humain avait recopié l'URL
  d'ADA, brand « ŠKODA » avec Š inconnu du site → diacritiques retirés.
  (4) YARIS CROSS COLLECTION / AutoScout NL : URL du RAV4 collée par erreur
  avec 0 — à ressaisir. Sportage MP 14 vs 13 : un boost, acceptable.
  Les URLs humaines AutoScout (grammaire chemin /kw_…/re_…/ft_…) donnent
  les mêmes comptes que la grammaire requête d'ADA (6=6, 4=4, 16=16, 1=1).
- **FIABILISER AVANT DE DÉVELOPPER AUTOUR (décision Channing 14/09, en
  réponse à « la fiabilité est-elle vraiment bonne ? » : mécanique fiable,
  vérité des résultats non mesurée — six défauts en sept jours, tous trouvés
  par un humain). Trois briques LIVRÉES le 14/09 :
  (1) QUATRE COMPTEURS À ZÉRO OBLIGATOIRE dans le digest du matin
  (payload.fiabilite + résumé) : sites en ✗, études « médiane inconnue »,
  dossiers url_incomplete vus le jour, URLs Marktplaats en forme morte.
  Tuiles vert/rouge en tête du Truth Center + courbe 14 jours. Le 14/09 ils
  valaient 0 / 4 / 4 / 10 ; attendus 0 / ≤4 / 0 / 0 dès la vague du 15.
  (2) CONTRÔLE DE PARAMÉTRAGE À LA SAISIE (studyChecks.ts, form Workflow) :
  bloque années/écart inversés et puissance ≥ 600 ch ; demande confirmation
  pour puissance ≥ 300 ch, finition de ≥ 3 mots ou avec cylindrée, et
  carburant hybride sur un modèle PROUVÉ classé essence par un site
  (MILD_HYBRID_AS_PETROL : Suzuki Ignis / AutoScout FR). Sans preuve, pas
  de règle. À faire : puissance maxi RÉELLE par modèle depuis les
  observations MI (la requête dépasse le timeout, index à poser).
  (3) ÉTALON HUMAIN HEBDOMADAIRE (onglet Truth Center « Étalon humain »,
  table truth_benchmarks, SQL 20260914200000) : 5 études tirées au sort par
  semaine ISO (tirage déterministe, modèles distincts, mêmes pour toute
  l'équipe), une ligne par site et par côté avec le compte ADA du dernier
  relevé (market_snapshots segment study:<id>) ; l'humain saisit son compte,
  son URL, une remarque. Rappel = min(ADA, humain) / humain ; « ADA >
  humain » compté à part (mapping trop large). Historique par semaine et par
  site. Channing fait les 5 recherches chaque semaine.
  truth_active_studies() rend désormais l'id (dossier ↔ étude exacte).
  Ajouts du soir (retour Channing) : TOUS les critères de chaque étude tirée
  affichés en puces (via truth_active_studies) ; RESCRAPE AUTOMATIQUE des 5
  études au tirage et sur bouton (RPC truth_benchmark_force_run, SQL
  20260914210000 : drapeau « Lancer maintenant » posable par tout compte,
  seulement sur une étude de l'étalon en cours), guet des relevés frais
  toutes les 15 s pendant 8 min, comptes ADA mis à jour au fil de l'eau,
  fraîcheur du relevé affichée sur chaque ligne (« il y a 12 min »).
  BOUCLE DE CORRECTION (question « comment la correction se fait-elle ? »)
  : chaque ligne enregistrée avec un écart (ADA < 90 % de l'humain, ou ADA
  > humain) ouvre d'elle-même un dossier « etalon_ecart » dans Doutes
  remarqués (RPC truth_benchmark_report, SQL 20260914220000) avec les deux
  comptes et les deux URLs ; le moteur (R-ÉTALON, truthDiagnose) compare les
  URLs — paramètre/hash/segment présent chez l'humain et absent chez ADA =
  cause candidate, URLs équivalentes = vendu entre-temps ou pagination,
  sans URL humaine = « preuve incomplète » ; l'écart résorbé referme le
  dossier. L'étalon est lisible en anon (rituel de relecture). Le rescrape
  ne dit une étude « revenue » que quand TOUS ses sites ont un relevé frais.
- **MCP V2 — EN ATTENTE (décision Channing 14/09 : « on se le garde au
  chaud, il nous faut d'abord s'assurer des résultats »)**. Quand le GO
  viendra, dans cet ordre : (1) `run_study` = relance d'une étude EXISTANTE
  par le drapeau force_requested_at (même mécanisme que « Lancer
  maintenant ») avec garde-fous : pas si dernière vague < 3 min, pas pendant
  la vague du matin, N relances/heure max, trace « via connecteur » dans
  worker_logs ; (2) `trace_listing` (URL → études qui l'ont vue / écartée,
  RPC trace_listing_url existante, lecture seule) ; (3) PAS de création
  d'étude à la voix sans confirmation explicite avec relecture des critères
  (Tucson 325 ch, finition cible à trois mots) ; (4) pas de scrape à la
  demande avant un compteur de quota Zyte lisible. Un seul jeton = pas
  d'identité par personne : OAuth avant toute écriture multi-comptes.
- **MARKTPLAATS : DÉGRAISSAGE DES URLS APPRISES (constat Channing 14/09,
  Truth Center)** : (a) le dossier « profondeur » du segment
  study:57301a51 (« YARIS CROSS COLLECTION », finition cible « 1.5 Hybrid
  Executive ») affichait les critères de « Yaris Cross Trail 2022 » —
  studyForDossier choisissait par marque/modèle ; désormais par l'id du
  segment. (b) L'URL apprise portait la facette modèle (13882) mais PAS le
  carburant (13838) que la native sait poser → « carburant non exprimé ».
  CLASSE : sur Marktplaats la native gagne dès qu'elle exprime strictement
  plus de facettes serveur que l'URL apprise (`mpFacetIds`), en plus de la
  forme morte « #q: ». (c) Suzuki Ignis ×4 et Lexus NX ×6 servis en forme
  morte « #q:suzuki+ignis » (page toutes-autos, hash jamais envoyé) faute
  de slug marque : 21 marques ajoutées à BRAND_MAP, chacune PROUVÉE en direct
  le 14/09 (/l/auto-s/<slug>/ = page marque filtrée avec facettes). Native
  Ignis désormais /l/auto-s/suzuki/q/ignis/f/hybride-elektrisch-benzine/
  13838/ (63 résultats en direct). Note : mpNormalize écrit « 1.5 » en
  « 15 » — prouvé équivalent sur le site (83 = 83), laissé tel quel.
- **CONNECTEUR MCP LECTURE SEULE (PR #1 de Channing, réécrite 14/09)** :
  la V1 faite avec ChatGPT lisait studies_v2 / study_runs (dernière ligne
  17/07) → réponses vocales fausses. Recâblée dans `ada-mcp/` sur la
  branche déployée : 9 outils sur daily_searches (+ bilan de vague depuis
  worker_logs), daily_search_hits (à traiter, leads N jours = même compte
  que la carte Équipe), negotiations + dossiers, market_snapshots,
  truth_dossiers, profiles. Transport/auth de la PR gardés (jeton dédié
  fail-closed, hôtes autorisés, service-role serveur). Fail-open sur les
  colonnes dont le SQL n'est pas collé. Testé en local (clé anon : 401 sans
  jeton, initialize, tools/list, market_prices, truth_status, ada_health).
  À FAIRE PAR CHANNING : service Railway root /ada-mcp sur la branche
  déployée ; vérifier que ChatGPT accepte un Bearer statique (sinon OAuth) ;
  fermer/recibler la PR #1 (base main = 452 commits de retard).
- **RELECTURE DES VAGUES 13-14/09 (demande Channing 14/09)** : 69/69 études
  passées les deux matins, aucun site « ✗ », seconde chance jamais
  déclenchée, Zyte 520 = 14 puis 20 (tous absorbés), AbortError 0.
  (1) /rav-4 → /rav4 persistait (2×/vague) malgré la graine du 12/09 : la
  voie MÉMOIRE réutilise l'URL humaine apprise avec son chemin d'avant le
  308. Classe : `canonicalizeAutoscoutModelPath` (graines humaines
  seulement) appliqué aux URLs apprises AS24 dans generator.ts.
  (2) AutoScout FR à 0 sur 22 études : PREUVE curl — AS24 FR classe la
  Suzuki Ignis 1.2 Dualjet Hybrid en « Essence »/« Autres », jamais
  « Hybride » : fuel=2 → 0, sans fuel → 3. Les études Ignis (×6) en
  « hybride » ne verront jamais AS24 FR ; décision Channing (carburant
  « toutes » ou essence pour les micro-hybrides). Même famille probable :
  Tucson / Sportage / RAV4 hybrides simples selon le site.
  (3) Études qui ne montrent RIEN faute de médiane cible : YARIS CROSS
  COLLECTION (trim_target « 1.5 Hybrid Executive » écarte 100 % des NL),
  TOYOTA YARIS CROSS (« PREMIÈRE »), YARIS CROSS TRAIL (« 1.5 Hybrid
  Adventure »), LEXUS NX EXECUTIVE (5 prix cibles < MEDIAN_SAMPLE 6 et
  aucune observation MI) ; HYUNDAI TUCSON ×2 : puissance mini 325 ch (erreur
  de saisie, aucun Tucson). Le bilan disait « fail-open : tout est
  montré » alors que rien ne l'est → texte corrigé.
  (4) Marktplaats « no listings via looksLikeListing » 19×/2 j sans
  incidence sur les comptes (pages sans total déclaré) — bruit à dépiler.
- **LEADS ÉQUIPE : DATE RÉELLE DE LA BAISSE** (constat Channing 12/09 : « je
  n'avais pas 19 leads à traiter ce matin »). Le compteur datait une baisse
  par last_seen_at, que le worker retouche à CHAQUE vague où l'annonce est
  revue : une baisse vieille de huit jours, déjà traitée, ressortait comme
  lead « du jour » tant que l'annonce restait en ligne (16 des 19). CLASSE :
  la date d'un événement ne doit jamais être un champ qui bouge. Colonne
  `dropped_at` posée par le worker quand la baisse fait rentrer l'annonce
  dans la boîte (fail-open sans la colonne), RPC et front datent par
  coalesce(dropped_at, first_seen_at). Un lead compte UNE fois, à la date du
  dernier événement qui l'a mis dans la boîte. Anciennes baisses : datées de
  leur première vue (transitoire). SQL : 20260912100000_leads_date_de_baisse.sql.
- **DOSSIERS DE NÉGOCIATION** (demande Channing 10/09 : « classer mes
  négociations en cours par dossiers que je nommerai selon mes besoins »).
  Table `negotiation_folders` (personnelle, RLS own, nom libre, ordre) +
  colonne `negotiations.folder_id` (on delete set null : supprimer un
  dossier ne supprime jamais une négociation, elle redevient « sans
  dossier »). Onglet Négociations : bouton « Nouveau dossier », sections
  repliables par dossier puis « Sans dossier » (état replié = localStorage),
  menu ⋯ du dossier (renommer / supprimer avec confirmation), menu ⋯ de la
  ligne → « Ranger dans un dossier » (liste, coche, « Nouveau dossier… »
  qui crée ET range). Sans dossier créé, la liste reste telle quelle.
  Fail-open : SQL non collé → pas de dossier, message explicite à la
  première écriture. SQL : 20260910140000_negociations_dossiers.sql.
- **ÉCHEC ≠ VIDE + SECONDE CHANCE** (constat Channing 10/09 : Yaris Cross
  Collection 24 900 € LBC absente de l'étude d'Antoine). Vague de 05 h :
  381 « Zyte 520 », 59 études sur 67 avec au moins un site à zéro (LBC et
  Gaspedaal surtout) — un site en échec était compté « 0 » comme un marché
  vide, sans trace ni relance. Corrigé : (1) attentes longues sur 520/429/503
  (8/20/40/60 s, un essai de plus) ; (2) ZYTE_MAX_PARALLEL 6 → 4 ;
  (3) un site en échec est marqué « ✗ » au bilan, sans snapshot ; (4) les
  études touchées repassent UNE fois en série 3 min après la vague, et le
  bilan de seconde chance est loggé. Rappel du samedi 12/09 : relire les 520
  après ces trois changements avant de toucher DAILY_CONCURRENCY.
  RE-CONTRÔLE 12/09 (rappel tenu) : Zyte 520 par vague 386 (10/09) → 24
  (11/09) → 18 (12/09), TOUS absorbés par les nouvelles attentes (aucun
  « EN ÉCHEC », aucune seconde chance déclenchée, 69/69 études passées les
  deux matins, 171 puis 175 nouvelles annonces contre 80 le 10/09) ;
  AbortError 0 depuis le 08/09. VERDICT : on ne touche ni DAILY_CONCURRENCY
  ni les heures. Trace résiduelle : /rav-4 → /rav4 encore 2×/vague (slug
  APPRIS de la taxonomie « RAV 4 » qui reprenait le dessus faute de graine
  humaine) — graine explicite rav4 → rav4 posée.
- **BADGE « À SURVEILLER » SUR TOUTES LES COROLLA (question Channing 09/09)** :
  5 dossiers « profondeur en variation » (LC, LBC, MP, Gaspedaal, AS24 NL)
  nés de la mise à jour MI du 07/09 (Corolla GR Sport 2024 break : 10-12
  annonces) comparée à l'ingestion nue du modèle (100-329) dans le même
  segment ('' ) ; chaque dossier ouvert = -15 au badge. CLASSE : une mise à
  jour MI à critères porte désormais sa clé de segment `mi:<critères>`
  (writeMarketSnapshot.segmentKey, worker/index criteriaSegmentKey) ; les
  dossiers nés du mélange avant le 09/09 sont refermés par le diagnostic
  (R2bis). Le badge remonte à la vague suivante.
- **CAS DORÉS ET DÉCISIONS DE GRAMMAIRE** (constat Channing 08/09 : six
  « Hybride rechargeable » AutoScout en échec) : un cas « auto » figé un jour
  devient un fossile quand le registre change PAR DÉCISION. Liste
  `RETIRED_GOLDEN` dans worker/truthLoop : site × libellé × raison → le cas
  est retiré à la vague suivante, son dossier golden_fail refermé avec la
  raison, et le premier passage ne le re-fige jamais. Les cas figés par un
  humain (Bibliothèque) ne sont jamais retirés automatiquement. RÈGLE : toute
  décision qui retire une capacité d'URL à un site s'inscrit dans cette liste.
- **DROITS PAR ONGLET DU WORKFLOW** (demande 07/09) : cinq droits
  `wf:etudes/resultats/archives/negociations/ventes` ; les clés historiques
  `workflow`/`ventes` sont comprises (normalizeTabs) et converties au premier
  clic dans Équipe ; le Workflow s'ouvre dès qu'un onglet est permis.
- **FINITION = POST-FILTRE DUR** (constat Channing 07/09, Corolla « GR
  Sport » : Touring Sports Design/Collection servies comme GR Sport). Cause
  de classe : les mots-clés de site (AS24 kwd, Gaspedaal trefw, LBC text)
  cherchent chaque mot séparément, et l'ancien `matchesTrim` testait chaque
  jeton en SOUS-CHAÎNE (« gr » dans « grijs », « sport » dans « Sports »).
  Nouveau `trimMatchesText` (business-logic) : suite contiguë de mots
  entiers, éclatée/tiret/collée, variantes connues (GR ⇒ Gazoo Racing).
  Appliqué aux études quotidiennes (dailySearches, toutes finitions) et au
  MI (filterListingsByStudy). Une annonce qui n'écrit pas la finition dans
  titre/description/version est ÉCARTÉE et comptée dans les logs.
- **GASPEDAAL : fiche unitaire** (constat 07/09, « Ouvrir » renvoyait la page
  de recherche #oc<id>). L'URL, la version (`uitvoering`) et la puissance
  (`vermogenKw`) viennent du flux Next de la page (detailsById) ; le lien
  est le `klikUrl` du portail « dealer » (redirection vers la fiche chez le
  vendeur, preuve tesselaarbv.nl). Effet une fois : les annonces Gaspedaal
  déjà connues changent d'URL → comptées « nouvelles » à la prochaine vague.
  À VÉRIFIER (Channing) : les autres sites dont « Ouvrir » n'ouvrirait pas
  l'annonce à l'unité.
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
