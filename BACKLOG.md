# BACKLOG — chantiers différés, à ne pas oublier

Décisions actées en discussion d'architecture (juillet 2026). Chaque entrée
note pourquoi elle a été différée et ce qui la débloquera.

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

## 5. Rappels de chantiers déjà actés ailleurs

- `parseDetailPage` à intégrer au contrat SiteAdapter (différé lors du
  refactor registre).
- Étape 2 du plan initial : découplage linkgen/supabase.ts par injection,
  puis branchement de linkgen dans le worker (mémoire d'abord, fallback URL
  figée, logging de la voie empruntée).
- TTL / revalidation automatique des mappings `valid` (rejoint le futur
  `market_scan_runs`).
- Taux DKK→EUR incohérent (0.134 worker vs 0.13 study-core) — à unifier
  pendant le nettoyage étape 1.
- `generated_urls` (2b) : à spécifier soigneusement avec Channing avant
  implémentation — pièce centrale, ne pas bâcler.
