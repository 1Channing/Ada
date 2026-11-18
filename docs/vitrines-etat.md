# État des vitrines du réseau — 18/11/2026 (soir)

Mission de Channing (13/11) : « 100 % des vitrines partenaires lues, et lues en entier » — pour chaque voiture : prix, km, année, énergie, boîte ; ce qui ne peut pas être lu est listé, avec la raison.

Code déployé sur TEST le 18/11 au soir, avant le relevé de nuit. Les chiffres « après » sont des relevés **en direct avec le code du dépôt** (sans écriture en base) ; le relevé de nuit du 19/11 (1 h Paris) les confirme en production — section 7.

## 1. En bref

| | 13/11 (avant) | 18/11 matin | 18/11 soir (code déployé) |
|---|---:|---:|---:|
| Fiches de la Carte | 93 | 95 | 95 |
| Lues en entier (≥ 95 % sur les 5 champs) | 31 | 34 | **64** |
| Lues en partie | 26 | 25 | **14**, chacune avec sa raison |
| Jamais lues | 36 | 36 | **0** sans raison |
| Non lisibles, la raison écrite | — | — | **17** (8 sites + 9 contacts qui ne sont pas des vitrines) |

Sur les 64 : 34 l'étaient déjà, 30 le sont devenues (15 complétées, 15 jamais lues jusqu'ici). Sur les 14 lues en partie, 4 n'avaient jamais été lues. Plusieurs attendent une action dans la Carte (adresse, fréquence) : section 5.

## 2. Lues en entier

**Déjà complètes avant la mission (34)** : Autobedrijf Wijnne, Autopolis Ford Hyundai, AUTOSTYLE / COBREDIA, Bochane Groep, Broekhuis Groep, BYMYCAR (2 fiches), C.A.R, Dewaal autogroep, Flexicar, FLEXICAR ASTURIAS., FLEXICAR GRUPO BARCELONA., FLEXICAR MADRID GRUPO, FLEXICAR MURCIA., FLEXICAR MÁLAGA., GRUPO FLEXICAR SEVILLA., GRUPO FLEXICAR VALENCIA., Hedin Automotive, Interstrip Auto GmbH, Kamux, Koojman Tiel, Mengelers Groep, MUSTIÈTE AUTOMOBILES, Oostendorp Autogroep, Regge autogroep, Rævhede Auto, Van der Wal Vans, Van Dijk Automotive, Van Mossel, vpn angers, VPN auto pro, Wassink Autogroep, Wensink Automotive, Zeeuw & Zeeuw.

**Devenues complètes (30)** — avant = audit du 13/11 (stock · prix / km / année / énergie / boîte, en %, en gras sous 95 %) :

| Pays | Vitrine | Lecteur | Avant (13/11) | Après (en direct, 18/11) | Note / à faire |
|---|---|---|---|---|---|
| NL | Louwman Dealer Group | `cmsms` | 3873 · 100 / 100 / 100 / 100 / **0** | 3 852 / 3 868, 5 champs 100 % | boîte par les filtres « Transmissie » du site |
| NL | Century Autogroep | `datamotive` | 1111 · 99 / **0** / **0** / **0** / **0** | 1 164 / 1 164, 5 champs 100 % | API publique Datamotive |
| NL | Emil Frey Nederland | `datamotive` | 153 · 100 / **0** / **0** / **0** / **0** | 4 490 / 4 490, 5 champs 100 % | API publique Datamotive ; finis les relevés coupés |
| NL | Pon Automotive | `dmapi` | 655 · 100 / **0** / **0** / **0** / **0** | 664 / 664, 5 champs 100 % | API publique Datamotive |
| IT | Jazzoni Appia - Gruppo IVA SpA | `datamotive` | 42 · 100 / 100 / **0** / 100 / 100 | année 42 / 42 | année du JSON-LD |
| IT | Romana Auto - Gruppo IVA Spa | `datamotive` | 11 · 100 / 100 / **0** / 100 / 100 | année 11 / 11 | année du JSON-LD |
| NL | DUTCH Vans | `dutchvans` | 355 · 100 / 100 / 100 / **0** / 100 | énergie 24 / 24 (page du 18/11) | énergie du JSON-LD |
| IT | Gruppo Ghedini Automobili | `rswusato` | 222 · 100 / **62** / 100 / 100 / 97 | 230 / 230 | « Km Zero » = 0 ; 4 voitures absentes des pages lues par l'API WordPress |
| FR | Eden auto Anglet | `webspark` | 47 · 100 / 100 / 100 / 100 / **0** | 49 / 49, 5 champs 100 % | boîte du JSON-LD, la version prime |
| FR | Škoda Nantes – Seat Skoda Orvault (VGRF Grand Ouest, raison sociale Auto Garage de l'Ouest SAS) | `vgrf` | 120 · 100 / 100 / 100 / 100 / **32** | 120 / 120, 5 champs 100 % | « Rob double embray » = automatique |
| FR | Groupe Hecquet | `yooflex` | 109 · 100 / 100 / 100 / 100 / **92** | 286 / 286, 5 champs 100 % | lecture par tranches de prix / km (ordre aléatoire du site) |
| FR | SIPA AUTOMOBILES | `webspark` | 1640 · 100 / 100 / 100 / 100 / **0** | page 1 : boîte 13 / 13 ; 1 650 annoncées | à confirmer au relevé de nuit (≈ 127 pages) |
| FR | SOFIBRIE/ECO DES NATIONS | `webspark` | 286 · 100 / 100 / 100 / 100 / **0** | page 1 : boîte 13 / 13 ; 1 316 annoncées | à confirmer au relevé de nuit (≈ 102 pages) |
| FR | BONY AUTOMOBILES/COBA | `webspark` | 1950 · 100 / **67** / 100 / 100 / **0** | page 1 : boîte 15 / 15 ; 3 385 annoncées | à confirmer au relevé de nuit (≈ 226 pages) ; neuves : km 0 |
| DE | MFH Mehrmarken-Fahrzeughandel / Osna-Autos | `autrado` | 15000 · **0** / **0** / **0** / **0** / **0** | 17 726 / 17 726 (enquête) ; échantillon Toyota 228 / 228, 5 champs 100 % | hebdomadaire : prochain relevé ≥ 23/11, sauf « Relever maintenant » (≈ 40 min) |
| DE | J.W. Handelsgesellschaft mbH | `audaris` | jamais lue | 765 / 765, 5 champs 100 % | — |
| DE | Autohaus Keller GmbH & Co. KG | `carlution` | jamais lue | 347 / 347, 5 champs 100 % | 89 neuves datées par l'année de construction publiée |
| ES | OCASIONPLUS LA MAQUINISTA II | `ocasionplus` | jamais lue | 205 / 205, 5 champs 100 % | — |
| ES | OCASIONPLUS LAS ROZAS II | `ocasionplus` | jamais lue | 216 / 216, 5 champs 100 % | ADRESSE à changer |
| ES | OCASIONPLUS SEVILLA CENTRO II | `ocasionplus` | jamais lue | 140 / 140, 5 champs 100 % | ADRESSE à changer (centre à confirmer) |
| BE | Van Mossel Volkswagen Skoda Dendermonde | `autralis` | jamais lue | 391 / 391, 5 champs 100 % | ADRESSE à changer |
| NL | Bestelbus.nl | `kleynvans` | jamais lue | 625 / 625 ; km 99 %, énergie 99 %, boîte 98 % | ADRESSE à changer ; prix hors TVA |
| NL | Kleyn Vans B.V. \| bestelbus.nl | `kleynvans` | jamais lue | même stock que Bestelbus.nl | ADRESSE à changer (kleynvans.nl en erreur 522) |
| FR | Groupe Sellens (filiale en France métropolitaine du groupe Aubéry : JPV, Riviera Car Center, Station 7) | `stocklisting` | jamais lue | 1 590 / 1 590, 5 champs 100 % | périmètre à choisir : 1 218 voitures et utilitaires seuls |
| FR | SCALA | `sfxlisting` | jamais lue | 1 107 / 1 107 ; année 95 % | — |
| FR | Le Bon Plan Auto (société du Groupe Maurin) | `infinit` | jamais lue | 515 / 515, 5 champs 100 % | — |
| FR | Emil frey / Autosphère Mercedes | `autosphere` | jamais lue | 912 / 912 (concessions Mercedes), 5 champs 100 % | PÉRIMÈTRE à choisir : l'adresse actuelle lit tout le réseau (16 758) |
| FR | Ayvens France | `carmarketb2c` | jamais lue | 402 / 402, 5 champs 100 % | ADRESSE à changer, RÉACTIVER |
| FR | Volkswagen Group Retail France (VGRF) | `vgrf` | jamais lue | 5 759 / 5 760 (Sonauto), 5 champs 100 % | ADRESSE à changer, RÉACTIVER (hebdomadaire conseillé) |
| NL | Bennie Wilmink Autobedrijven | `dtcvm` | jamais lue | 241 occasions (377 fiches du plan de site), 5 champs 100 % | RÉACTIVER (hebdomadaire conseillé) |

## 3. Lues en partie — ce qui manque et pourquoi

| Pays | Vitrine | Lecteur | Avant (13/11) | Ce qui manque | Pourquoi | Fait / à faire |
|---|---|---|---|---|---|---|
| DE | Autexx | `autrado` | 714 · **0** / **78** / **0** / 100 / 100 | prix 0 % | le site réserve le prix aux comptes connectés (« Nach Login ») ; il est pourtant dans le code de la fiche | km, année, énergie, boîte 100 % (714 / 714) ; DÉCISION : lire ou non le prix caché |
| DE | Voets Gruppe (Voets Automobilholding / Voets Autozentrum GmbH) | `wpcarsync` | 20 · 100 / 100 / 100 / **5** / 100 | année 79 %, boîte 99 % | neuves non immatriculées (pas d'Erstzulassung, fiche comprise) ; hybrides rechargeables sans boîte publiée | 2 261 / 2 261 (20 avant) ; prix, km, énergie 100 % |
| DE | Autohaus Bleker GmbH | `shopware` | 2991 · 100 / 100 / **87** / 100 / 100 | année 88 % | Lagerwagen neuves : « Erstzulassung - » sur la carte et la fiche | 3 438 / 3 438 (305 avant) ; prix, km, énergie, boîte 100 % |
| DE | Bierschneider | `cfdnext` | 6220 · 100 / 100 / **86** / 100 / 100 | km et année 84 % | neuves : ni km ni immatriculation sur la liste (km par la fiche, 200 par nuit ; l'année n'existe pas) | site refait : ADRESSE à changer ; 6 416 / 6 416 ; 5 631 voitures retrouvées sous leur nouveau numéro |
| IT | Gruppo Bossoni | `vehiclelistapi` | 4144 · 100 / **48** / **55** / 100 / 100 | km 49 %, année 55 % | 45 % du stock est neuf (« nuovo » : le site masque km et année) ; des « km 0 » sans km publié | voitures « in arrivo » en attendue ; le bilan du relevé le dit |
| SK | bavaria bratislava | `autopalace` | absente de la Carte le 13/11 | prix 86 %, année 54 % | 26 « prix sur demande » (nouveau X5) ; 78 neuves non immatriculées et 5 démonstrations sans date | rien à lire de plus |
| SK | Auto palace bratislava | `autopalace` | absente de la Carte le 13/11 | année 91 % | neuves « nové vozidlo », non immatriculées | rien à lire de plus |
| NL | Auto Smeeing | `dvnl` | 1077 · **66** / 100 / 100 / 100 / 100 | prix 65 % | « Op aanvraag » : prix sur demande sur le site | dit dans le bilan du relevé |
| NL | Auto Centrum Krimpenerwaard | `autodata` | 329 · 100 / 100 / 100 / **0** / **0** | énergie et boîte (0 % sur la liste) | la liste ne les donne pas, la fiche oui | fiches détail, 200 par nuit : complet en 2 nuits |
| FR | Vikings occasion | `openflex` | 1793 · 100 / 100 / 99 / **62** / **75** | boîte 76 % sur la liste | la ligne de la carte ne la donne pas toujours | fiches détail, 200 par nuit : ≈ 3 nuits |
| FR | DE WILLERMIN | `stocklisting` | jamais lue | boîte 0 %, année 78 % sur la liste | la carte ne les donne pas | fiches détail, 200 par nuit : ≈ 5 nuits |
| FR | Auto Brass | `carsearchwp` | jamais lue | année 92 % | neuves non immatriculées (« - » sur le site) | 1 724 / 1 724 ; prix, km, énergie, boîte 100 % |
| ES | DOMINGO ALONSO OCASIÓN TENERIFE | `acaicms` | jamais lue | boîte 92 %, km 98 % | « Sin definir » sur la carte et la fiche ; motos et neuves sans km | même stock que la fiche Domingo Alonso ; ADRESSE à changer, RÉACTIVER |
| ES | DOMINGO ALONSO OCASIÓN | `acaicms` | jamais lue | boîte 92 %, km 98 % | « Sin definir » sur la carte et la fiche ; motos et neuves sans km | 1 872 / 1 872 ; ADRESSE à changer, RÉACTIVER |

## 4. Non lisibles — la raison

| Pays | Fiche | Raison | Décision possible |
|---|---|---|---|
| DE | DB Autohaus Maintal | le stock vient d'un moteur Elastic Cloud que la page interroge avec une clé « ApiKey » écrite dans la page ; sans clé : HTTP 401. | DÉCISION : autoriser cette clé publique (la règle l'interdit) |
| DE | DOSCH AUTOMOBILE GMBH | pas de site propre (dosch-automobile.de renvoie vers mobile.de) et mobile.de répond 403 (anti-robot). | DÉCISION : sa page AutoScout24 (163 voitures) se lit sans clé — c'est une plateforme |
| DE | Gw-Deutschland.de | portail réservé aux revendeurs : « Zugriff verweigert », connexion obligatoire. | — |
| ES | AUTO1.com España (AUTO1 Group) | plateforme de gros réservée aux professionnels inscrits (renvoi vers la connexion). | — |
| FR | HESS AUTOMOBILES | stock servi par Algolia avec une clé de recherche écrite dans la page. | DÉCISION : autoriser les clés de recherche publiques |
| FR | Groupe Chopard | stock servi par Algolia avec une clé de recherche écrite dans la page. | DÉCISION : idem |
| FR | CARIZY | stock servi par Algolia (clé dans la page) ou par une API GraphQL à jeton signé. | DÉCISION : idem |
| GE | MEKRE LLC official importer of Citroen and Opel | aucune adresse de site dans la fiche, aucun site de stock trouvé. | adresse à fournir |
| FR | AUTOLITY | pas une vitrine : place de marché entre professionnels, stock visible après inscription. | — |
| SE | Internal cars | pas une vitrine : éditeur de logiciel ; sa place de marché Handlarbudet exige un compte de négociant. | — |
| LT | Fleetcom | pas une vitrine : société de services (gestion de flotte, remarketing), aucune annonce. | — |
| ES | Ribes | pas une vitrine : exportateur « exclusivamente al sector profesional », espace sous identifiants. | — |
| FR | Agilauto | pas une vitrine de vente : location LLD / LOA seulement, en loyers mensuels. | — |
| FR | Rent A Car France | pas une vitrine : loueur courte durée, aucune vente. | — |
| FR | First Location Auto | pas une vitrine : loueur courte et longue durée, aucune vente en ligne. | — |
| FR | FlexiFleet | pas une vitrine : location de véhicules VTC à la semaine, vente « sur simple demande ». | — |
| FR | Avis France | pas une vitrine : ses occasions sont vendues aux seuls professionnels, par soumission (Arval Remarketing). | — |

## 5. À faire dans la Carte

**Adresses à changer** (sans cela la fiche reste non lue ou mal lue) :

| Fiche | Adresse actuelle | Nouvelle adresse | Pourquoi |
|---|---|---|---|
| Bierschneider | …/fahrzeugsuche/trefferliste/?of=SalePrice | https://www.bierschneider.de/fahrzeuge/ | site refait le 18/11 : l'ancienne adresse renvoie vers une page 404 (le relevé échoue sans rien marquer). Au premier relevé, 5 631 des 6 318 voitures connues sont retrouvées sous leur nouveau numéro (≈ 690 sorties au lieu de 6 318). |
| Van Mossel Volkswagen Skoda Dendermonde | http://www.garage-mertens.be | https://stock.vanmossel-mertens.be/nl/aanbod-wagens/ | le site Drupal n'a qu'une sélection ; le stock (3 agences) est sur ce site de stock |
| Bestelbus.nl | https://www.bestelbus.nl | https://www.bestelbus.nl/nl/voorraad | l'accueil n'est pas la page de stock |
| Kleyn Vans B.V. \| bestelbus.nl | http://www.kleynvans.nl | https://www.bestelbus.nl/nl/voorraad | kleynvans.nl en erreur 522 depuis le 13/11 ; même entreprise, même stock (une seule lecture pour les deux fiches) |
| OCASIONPLUS LAS ROZAS II | https://www.ocasionplus.com | https://www.ocasionplus.com/concesionarios/las-rozas-madrid | l'accueil = tout le réseau (14 000 voitures) : le lecteur le refuse |
| OCASIONPLUS SEVILLA CENTRO II | https://www.ocasionplus.com/ | https://www.ocasionplus.com/concesionarios/sevilla | idem ; seul centre dans la ville (les 4 autres : Camas, Dos Hermanas, Alcalá, Utrera) — **à confirmer** |
| DOMINGO ALONSO OCASIÓN | http://www.domingoalonsogroup.com | https://domingoalonsoocasion.com/coches/ | le site du groupe n'a pas de stock |
| DOMINGO ALONSO OCASIÓN TENERIFE | https://www.domingoalonsogroup.com/es/ | https://domingoalonsoocasion.com/coches/ | même stock (les pages d'île ne filtrent rien) |
| Volkswagen Group Retail France (VGRF) | https://volkswagen-group-retail.fr/ | https://www.sonauto.fr/voitures-occasions?limit=96 | le stock VGRF est sur Sonauto (93 concessions) |
| Ayvens France | https://www.ayvens.com/fr-fr/ | https://used-cars.ayvens.com/fr-fr/catalog?financetype=cash | catalogue grand public (le site pro exige un compte) |

**Fréquences à réactiver** (fiches à « arrêté ») : Domingo Alonso ×2, VGRF, Ayvens, Bennie Wilmink. Hebdomadaire conseillé pour VGRF (≈ 10 min par relevé), Domingo Alonso (≈ 11 min) et Bennie Wilmink (≈ 6 min).

**Décisions** :
- **Autexx** : le prix est « Nach Login » à l'écran mais présent dans le code de la fiche. Le lire ? (code écrit, non branché).
- **Autosphère** : périmètre de la fiche « Emil frey / Autosphère Mercedes ». L'adresse actuelle `/recherche` lit tout le réseau (16 758 voitures), ce qui correspond au « stock 16 000 » de la fiche ; `?dealer_brand=Mercedes` = les concessions Mercedes (912) ; `?dealer_id=MER022` = une seule. **À choisir avant de réduire** : passer du réseau entier à Mercedes après un relevé sortirait ≈ 15 800 voitures comme « disparues ».
- **Groupe Sellens** : tout le stock (1 590) ou voitures et utilitaires seuls (1 218, `https://www.sellens.fr/stock-sellens/vehicules-occasions?segments=1&segments=2`).
- **Clés de recherche écrites dans les pages** (HESS, Groupe Chopard, CARIZY : Algolia ; DB Autohaus Maintal : Elastic) : la règle de la mission interdit toute clé ou tout jeton extrait d'un site. Les lire demande une exception.
- **DOSCH** : lire sa page AutoScout24 (163 voitures, sans clé) ? C'est une plateforme, pas son site.
- **Année des neuves non immatriculées** : vide partout (le site ne la publie pas), sauf MFH, dont le moteur de recherche range ses 8 397 neuves dans l'année en cours — elles prennent cette année. À valider.
- **MEKRE LLC** : adresse à fournir.

**Relever maintenant** (facultatif, sinon le relevé de nuit suivant le fait) : chaque fiche dont l'adresse ou la fréquence change ; MFH, hebdomadaire, pour voir tout son stock avant le 23/11 (≈ 40 min).

## 6. Règles communes à tous les lecteurs (en production depuis ce soir)

- **Relevé partiel** : moins de 95 % du total annoncé par le site → aucune voiture marquée disparue, le bilan le dit.
- **Prix mal lu** : un ancien prix inférieur à 35 % du nouveau (remise, mensualité lue comme prix) sort de l'historique et ne compte pas comme une hausse.
- **Numéros tous changés** (refonte, changement de plateforme) : les voitures connues sont retrouvées sous leur nouveau numéro (VIN, marque + km + année, titre + prix, sans ambiguïté), avec leur historique ; seules les autres sortent.
- **Fiches détail** : ce que la liste ne donne pas est lu sur la fiche, 200 par relevé, 350 ms entre deux, nouvelles voitures d'abord ; une valeur connue n'est jamais effacée par une liste qui ne la donne pas.
- **Politesse** : une requête à la fois par site, jamais deux départs vers un même site à moins de 350 ms (plancher commun dans la lecture des pages, fiches détail comprises), agent Mozilla/5.0, aucune clé ni aucun jeton extrait d'un site.

## 7. Relevé de nuit du 19/11 (production)

À compléter après le relevé de 1 h (Paris) : audit après, fiche par fiche.
