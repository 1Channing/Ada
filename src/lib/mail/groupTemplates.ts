/**
 * MODÈLES DE LA RELANCE GROUPÉE (Carte) — partie pure, sans réseau.
 *
 * 07/11 : un modèle par catégorie, FR/EN. 26/11 (Channing : « on voit que le Danemark est cliqué, on doit pouvoir
 * écrire en danois » ; « on doit pouvoir choisir plusieurs thèmes de mails pré-écrits, là on est clairement en
 * recherche de sourcing, alors que pour ces concessions au Danemark c'est l'inverse, on cherche à leur proposer
 * nos véhicules ») : huit langues et trois thèmes.
 *  - Achat : on leur demande leur liste de véhicules à vendre (texte propre à chaque catégorie, l'ancien modèle) ;
 *  - Vente : on leur propose nos véhicules (lien des bonnes affaires, nos énergies, leurs critères) — même fond que
 *    la doctrine de Dana : jamais de véhicule précis, le lien est toujours donné ;
 *  - Relance : un rappel court après un message resté sans réponse.
 * La langue proposée suit le pays du contact ; tout reste modifiable avant l'envoi. {prenom} {societe} {ville}
 * {pays} {signature} sont remplis pour chaque destinataire par la fenêtre.
 */
import type { ContactKind } from '../../services/network';

export type MailLang = 'fr' | 'en' | 'de' | 'nl' | 'da' | 'sv' | 'it' | 'es';
export const MAIL_LANGS: MailLang[] = ['fr', 'en', 'de', 'nl', 'da', 'sv', 'it', 'es'];
export const MAIL_LANG_LABEL: Record<MailLang, string> = {
  fr: 'Français', en: 'Anglais', de: 'Allemand', nl: 'Néerlandais', da: 'Danois', sv: 'Suédois', it: 'Italien', es: 'Espagnol',
};

export type MailTheme = 'achat' | 'vente' | 'relance';
export const MAIL_THEMES: MailTheme[] = ['achat', 'vente', 'relance'];
export const MAIL_THEME_LABEL: Record<MailTheme, string> = {
  achat: 'Achat — demander leur liste',
  vente: 'Vente — proposer nos véhicules',
  relance: 'Relance — rappel sans réponse',
};
export const MAIL_THEME_HINT: Record<MailTheme, string> = {
  achat: 'Nous achetons : on demande la liste des véhicules qu\'ils vendent.',
  vente: 'Nous vendons : lien des bonnes affaires, nos énergies, et on demande leurs critères.',
  relance: 'Un rappel court après un message resté sans réponse.',
};

export const BONNES_AFFAIRES_URL = 'https://mc-export.com/bonnes-affaires';

/** Langue proposée d'après le pays (ISO 2) du contact ; l'anglais partout ailleurs. */
const LANG_OF_COUNTRY: Record<string, MailLang> = {
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', CH: 'fr',
  DE: 'de', AT: 'de', NL: 'nl', DK: 'da', SE: 'sv', IT: 'it', ES: 'es',
};
export const mailLangOfCountry = (iso: string | null | undefined): MailLang => LANG_OF_COUNTRY[(iso ?? '').toUpperCase()] ?? 'en';

type Tpl = { subject: string; body: string };
type Frame = { hello: string; thanks: string; regards: string };
const FRAME: Record<MailLang, Frame> = {
  fr: { hello: 'Bonjour {prenom},', thanks: 'Merci d\'avance,', regards: 'Bien à vous,' },
  en: { hello: 'Hello {prenom},', thanks: 'Thank you in advance,', regards: 'Best regards,' },
  de: { hello: 'Guten Tag {prenom},', thanks: 'Vielen Dank im Voraus,', regards: 'Mit freundlichen Grüßen,' },
  nl: { hello: 'Beste {prenom},', thanks: 'Alvast bedankt,', regards: 'Met vriendelijke groet,' },
  da: { hello: 'Hej {prenom},', thanks: 'På forhånd tak,', regards: 'Med venlig hilsen,' },
  sv: { hello: 'Hej {prenom},', thanks: 'Tack på förhand,', regards: 'Med vänliga hälsningar,' },
  it: { hello: 'Buongiorno {prenom},', thanks: 'Grazie in anticipo,', regards: 'Cordiali saluti,' },
  es: { hello: 'Hola {prenom},', thanks: 'Gracias de antemano,', regards: 'Un cordial saludo,' },
};

const compose = (lang: MailLang, subject: string, paras: string[], ending: 'thanks' | 'regards'): Tpl => ({
  subject,
  body: [FRAME[lang].hello, ...paras, `${FRAME[lang][ending]}\n{signature}`].join('\n\n'),
});

/* ── ACHAT : un texte par catégorie ─────────────────────────────────────────────────────────────────────── */
const ACHAT: Record<ContactKind, Record<MailLang, Tpl>> = {
  loueur: {
    fr: compose('fr', 'MC Export – votre liste de véhicules à jour', ['MC Export rachète des véhicules de flotte pour l\'export, en volume, avec paiement et enlèvement rapides.', 'Pourriez-vous nous envoyer votre liste à jour des véhicules en vente (marque, modèle, année, kilométrage, énergie, prix) ? Un envoi régulier est aussi possible si c\'est plus simple pour vous.'], 'thanks'),
    en: compose('en', 'MC Export – request for your updated de-fleet vehicle list', ['MC Export buys de-fleeted vehicles for export, in volume and with fast payment and collection.', 'Could you please send us your updated list of vehicles currently for sale (make, model, year, mileage, fuel, price)? We can also set up a regular feed if that is easier on your side.'], 'thanks'),
    de: compose('de', 'MC Export – Ihre aktuelle Liste der Defleet-Fahrzeuge', ['MC Export kauft ausgeflottete Fahrzeuge für den Export, in Stückzahlen, mit schneller Zahlung und Abholung.', 'Könnten Sie uns Ihre aktuelle Liste der zum Verkauf stehenden Fahrzeuge senden (Marke, Modell, Baujahr, Kilometerstand, Kraftstoff, Preis)? Ein regelmäßiger Versand ist ebenfalls möglich, wenn das für Sie einfacher ist.'], 'thanks'),
    nl: compose('nl', 'MC Export – uw actuele lijst van defleet-voertuigen', ['MC Export koopt uitgefaseerde verhuurvoertuigen voor export, in volume, met snelle betaling en afhaling.', 'Zou u ons uw actuele lijst van te koop staande voertuigen kunnen sturen (merk, model, bouwjaar, kilometerstand, brandstof, prijs)? Een regelmatige toezending is ook mogelijk als dat voor u eenvoudiger is.'], 'thanks'),
    da: compose('da', 'MC Export – jeres opdaterede liste over udfasede biler', ['MC Export køber udfasede udlejningsbiler til eksport, i volumen, med hurtig betaling og afhentning.', 'Kan I sende os jeres opdaterede liste over biler til salg (mærke, model, årgang, kilometertal, drivmiddel, pris)? En fast løbende liste er også muligt, hvis det er lettere for jer.'], 'thanks'),
    sv: compose('sv', 'MC Export – er uppdaterade lista över avyttrade fordon', ['MC Export köper avyttrade hyrbilar för export, i volym, med snabb betalning och hämtning.', 'Skulle ni kunna skicka er uppdaterade lista över fordon till salu (märke, modell, årsmodell, miltal, drivmedel, pris)? Ett regelbundet utskick fungerar också om det är enklare för er.'], 'thanks'),
    it: compose('it', 'MC Export – la vostra lista aggiornata di veicoli in dismissione', ['MC Export acquista veicoli in dismissione dalle flotte per l\'esportazione, in volume, con pagamento e ritiro rapidi.', 'Potreste inviarci la vostra lista aggiornata dei veicoli in vendita (marca, modello, anno, chilometraggio, alimentazione, prezzo)? Possiamo anche ricevere un invio periodico, se per voi è più semplice.'], 'thanks'),
    es: compose('es', 'MC Export – su lista actualizada de vehículos de desflote', ['MC Export compra vehículos de flota dados de baja para exportación, en volumen, con pago y recogida rápidos.', '¿Podrían enviarnos su lista actualizada de vehículos en venta (marca, modelo, año, kilometraje, combustible, precio)? También podemos recibir un envío periódico si les resulta más sencillo.'], 'thanks'),
  },
  leasing: {
    fr: compose('fr', 'MC Export – reprise de vos véhicules en fin de contrat', ['MC Export rachète pour l\'export les véhicules en fin de contrat de location ou de leasing, en volume, avec paiement et enlèvement rapides.', 'Auriez-vous une liste à jour des véhicules restitués disponibles à la vente (marque, modèle, année, kilométrage, énergie, prix) ? Nous pouvons aussi répondre à des appels d\'offres ou des lots.'], 'thanks'),
    en: compose('en', 'MC Export – purchase of your end-of-lease vehicles', ['MC Export buys end-of-lease and returned vehicles for export, in volume, with fast payment and collection.', 'Do you have an updated list of returned vehicles available for sale (make, model, year, mileage, fuel, price)? We also take part in tenders and batch sales.'], 'thanks'),
    de: compose('de', 'MC Export – Ankauf Ihrer Leasingrückläufer', ['MC Export kauft Leasingrückläufer und zurückgegebene Fahrzeuge für den Export, in Stückzahlen, mit schneller Zahlung und Abholung.', 'Haben Sie eine aktuelle Liste der zum Verkauf stehenden Rückläufer (Marke, Modell, Baujahr, Kilometerstand, Kraftstoff, Preis)? Wir nehmen auch an Ausschreibungen und Paketverkäufen teil.'], 'thanks'),
    nl: compose('nl', 'MC Export – aankoop van uw voertuigen einde leasecontract', ['MC Export koopt voertuigen aan het einde van het leasecontract en ingeleverde voertuigen voor export, in volume, met snelle betaling en afhaling.', 'Heeft u een actuele lijst van ingeleverde voertuigen die te koop staan (merk, model, bouwjaar, kilometerstand, brandstof, prijs)? Wij nemen ook deel aan tenders en partijverkopen.'], 'thanks'),
    da: compose('da', 'MC Export – opkøb af jeres biler ved leasingophør', ['MC Export køber biler ved leasingophør og returnerede biler til eksport, i volumen, med hurtig betaling og afhentning.', 'Har I en opdateret liste over returnerede biler til salg (mærke, model, årgang, kilometertal, drivmiddel, pris)? Vi deltager også i udbud og partisalg.'], 'thanks'),
    sv: compose('sv', 'MC Export – köp av era fordon vid leasingens slut', ['MC Export köper fordon vid leasingens slut och återlämnade fordon för export, i volym, med snabb betalning och hämtning.', 'Har ni en uppdaterad lista över återlämnade fordon till salu (märke, modell, årsmodell, miltal, drivmedel, pris)? Vi deltar även i upphandlingar och partiförsäljningar.'], 'thanks'),
    it: compose('it', 'MC Export – acquisto dei vostri veicoli a fine leasing', ['MC Export acquista per l\'esportazione veicoli a fine noleggio o leasing, in volume, con pagamento e ritiro rapidi.', 'Avete una lista aggiornata dei veicoli restituiti disponibili alla vendita (marca, modello, anno, chilometraggio, alimentazione, prezzo)? Partecipiamo anche a gare e vendite a lotti.'], 'thanks'),
    es: compose('es', 'MC Export – compra de sus vehículos a fin de contrato', ['MC Export compra para exportación vehículos a fin de contrato de alquiler o leasing, en volumen, con pago y recogida rápidos.', '¿Tienen una lista actualizada de vehículos devueltos disponibles para la venta (marca, modelo, año, kilometraje, combustible, precio)? También participamos en licitaciones y ventas por lotes.'], 'thanks'),
  },
  flotte: {
    fr: compose('fr', 'MC Export – reprise des véhicules de votre flotte', ['MC Export rachète pour l\'export les véhicules sortants des flottes d\'entreprise, à l\'unité ou en lot, avec paiement et enlèvement rapides.', 'Auriez-vous une liste des véhicules que vous allez renouveler ou céder (marque, modèle, année, kilométrage, énergie, prix souhaité) ?'], 'thanks'),
    en: compose('en', 'MC Export – purchase of your outgoing fleet vehicles', ['MC Export buys outgoing company fleet vehicles for export, one by one or in batches, with fast payment and collection.', 'Do you have a list of the vehicles you are about to renew or sell (make, model, year, mileage, fuel, asking price)?'], 'thanks'),
    de: compose('de', 'MC Export – Ankauf Ihrer ausscheidenden Flottenfahrzeuge', ['MC Export kauft ausscheidende Firmenflottenfahrzeuge für den Export, einzeln oder im Paket, mit schneller Zahlung und Abholung.', 'Haben Sie eine Liste der Fahrzeuge, die Sie demnächst erneuern oder verkaufen möchten (Marke, Modell, Baujahr, Kilometerstand, Kraftstoff, Preisvorstellung)?'], 'thanks'),
    nl: compose('nl', 'MC Export – aankoop van uw uitstromende wagenparkvoertuigen', ['MC Export koopt uitstromende bedrijfswagens voor export, per stuk of in partijen, met snelle betaling en afhaling.', 'Heeft u een lijst van de voertuigen die u binnenkort vervangt of verkoopt (merk, model, bouwjaar, kilometerstand, brandstof, vraagprijs)?'], 'thanks'),
    da: compose('da', 'MC Export – opkøb af biler fra jeres flåde', ['MC Export køber udgående firmabiler til eksport, enkeltvis eller i partier, med hurtig betaling og afhentning.', 'Har I en liste over de biler, I snart udskifter eller sælger (mærke, model, årgang, kilometertal, drivmiddel, ønsket pris)?'], 'thanks'),
    sv: compose('sv', 'MC Export – köp av era utgående fordon', ['MC Export köper utgående företagsfordon för export, styckvis eller i partier, med snabb betalning och hämtning.', 'Har ni en lista över de fordon ni snart byter ut eller säljer (märke, modell, årsmodell, miltal, drivmedel, önskat pris)?'], 'thanks'),
    it: compose('it', 'MC Export – acquisto dei veicoli in uscita dalla vostra flotta', ['MC Export acquista per l\'esportazione i veicoli in uscita dalle flotte aziendali, singolarmente o a lotti, con pagamento e ritiro rapidi.', 'Avete una lista dei veicoli che state per rinnovare o cedere (marca, modello, anno, chilometraggio, alimentazione, prezzo richiesto)?'], 'thanks'),
    es: compose('es', 'MC Export – compra de los vehículos que salen de su flota', ['MC Export compra para exportación los vehículos que salen de las flotas de empresa, por unidad o por lotes, con pago y recogida rápidos.', '¿Tienen una lista de los vehículos que van a renovar o vender (marca, modelo, año, kilometraje, combustible, precio deseado)?'], 'thanks'),
  },
  concession: {
    fr: compose('fr', 'MC Export – vos véhicules d\'occasion disponibles pour l\'export', ['MC Export rachète des véhicules d\'occasion pour l\'export : reprises, stock ancien, véhicules difficiles à vendre localement. Paiement et enlèvement rapides.', 'Pourriez-vous nous envoyer la liste des véhicules que vous souhaitez céder (marque, modèle, année, kilométrage, énergie, prix) ?'], 'thanks'),
    en: compose('en', 'MC Export – your used vehicles available for export', ['MC Export buys used vehicles for export: trade-ins, ageing stock, cars that are hard to sell locally. Fast payment and collection.', 'Could you send us the list of vehicles you would like to sell (make, model, year, mileage, fuel, price)?'], 'thanks'),
    de: compose('de', 'MC Export – Ihre Gebrauchtwagen für den Export', ['MC Export kauft Gebrauchtwagen für den Export: Inzahlungnahmen, Standfahrzeuge, lokal schwer verkäufliche Fahrzeuge. Schnelle Zahlung und Abholung.', 'Könnten Sie uns die Liste der Fahrzeuge senden, die Sie abgeben möchten (Marke, Modell, Baujahr, Kilometerstand, Kraftstoff, Preis)?'], 'thanks'),
    nl: compose('nl', 'MC Export – uw occasions beschikbaar voor export', ['MC Export koopt occasions voor export: inruilers, oude voorraad, auto\'s die lokaal moeilijk verkopen. Snelle betaling en afhaling.', 'Zou u ons de lijst kunnen sturen van de voertuigen die u wilt verkopen (merk, model, bouwjaar, kilometerstand, brandstof, prijs)?'], 'thanks'),
    da: compose('da', 'MC Export – jeres brugte biler til eksport', ['MC Export køber brugte biler til eksport: byttebiler, gammelt lager, biler der er svære at sælge lokalt. Hurtig betaling og afhentning.', 'Kan I sende os listen over de biler, I ønsker at sælge (mærke, model, årgang, kilometertal, drivmiddel, pris)?'], 'thanks'),
    sv: compose('sv', 'MC Export – era begagnade fordon för export', ['MC Export köper begagnade fordon för export: inbyten, gammalt lager, bilar som är svåra att sälja lokalt. Snabb betalning och hämtning.', 'Skulle ni kunna skicka oss listan över de fordon ni vill sälja (märke, modell, årsmodell, miltal, drivmedel, pris)?'], 'thanks'),
    it: compose('it', 'MC Export – i vostri veicoli usati disponibili per l\'esportazione', ['MC Export acquista veicoli usati per l\'esportazione: permute, stock datato, veicoli difficili da vendere localmente. Pagamento e ritiro rapidi.', 'Potreste inviarci la lista dei veicoli che desiderate cedere (marca, modello, anno, chilometraggio, alimentazione, prezzo)?'], 'thanks'),
    es: compose('es', 'MC Export – sus vehículos de ocasión disponibles para exportación', ['MC Export compra vehículos de ocasión para exportación: retomas, stock antiguo, vehículos difíciles de vender localmente. Pago y recogida rápidos.', '¿Podrían enviarnos la lista de los vehículos que desean vender (marca, modelo, año, kilometraje, combustible, precio)?'], 'thanks'),
  },
  trader: {
    fr: compose('fr', 'MC Export – nos arrivages et vos besoins', ['Petit point sur nos arrivages : dites-nous les marques et modèles que vous recherchez en ce moment (année, kilométrage, budget), nous vous enverrons nos véhicules correspondants.', 'De notre côté nous restons preneurs de vos listes disponibles à la vente.'], 'regards'),
    en: compose('en', 'MC Export – our arrivals and your needs', ['A quick note on our arrivals: let us know the makes and models you are currently looking for (year, mileage, budget) and we will send you our matching vehicles.', 'We also remain interested in your lists of vehicles for sale.'], 'regards'),
    de: compose('de', 'MC Export – unsere Eingänge und Ihr Bedarf', ['Kurz zu unseren Eingängen: Nennen Sie uns die Marken und Modelle, die Sie derzeit suchen (Baujahr, Kilometerstand, Budget), und wir senden Ihnen unsere passenden Fahrzeuge.', 'Wir bleiben unsererseits an Ihren Verkaufslisten interessiert.'], 'regards'),
    nl: compose('nl', 'MC Export – onze aanvoer en uw behoeften', ['Even over onze aanvoer: laat ons weten welke merken en modellen u momenteel zoekt (bouwjaar, kilometerstand, budget), dan sturen wij u onze passende voertuigen.', 'Van onze kant blijven wij geïnteresseerd in uw lijsten van te koop staande voertuigen.'], 'regards'),
    da: compose('da', 'MC Export – vores nye biler og jeres behov', ['Kort om vores nye biler: fortæl os hvilke mærker og modeller I søger lige nu (årgang, kilometertal, budget), så sender vi jer vores matchende biler.', 'Vi er fortsat interesserede i jeres lister over biler til salg.'], 'regards'),
    sv: compose('sv', 'MC Export – våra inkommande fordon och era behov', ['Kort om våra inkommande fordon: berätta vilka märken och modeller ni söker just nu (årsmodell, miltal, budget), så skickar vi er våra matchande fordon.', 'Vi är fortsatt intresserade av era listor över fordon till salu.'], 'regards'),
    it: compose('it', 'MC Export – i nostri arrivi e le vostre esigenze', ['Un breve punto sui nostri arrivi: indicateci marche e modelli che cercate in questo momento (anno, chilometraggio, budget) e vi invieremo i nostri veicoli corrispondenti.', 'Da parte nostra restiamo interessati alle vostre liste di veicoli in vendita.'], 'regards'),
    es: compose('es', 'MC Export – nuestras llegadas y sus necesidades', ['Un breve apunte sobre nuestras llegadas: indíquennos las marcas y modelos que buscan ahora (año, kilometraje, presupuesto) y les enviaremos nuestros vehículos correspondientes.', 'Por nuestra parte seguimos interesados en sus listas de vehículos en venta.'], 'regards'),
  },
  convoyeur: {
    fr: compose('fr', 'MC Export – disponibilités et tarifs de convoyage', ['Pourriez-vous nous confirmer vos disponibilités des prochaines semaines et vos tarifs à jour (plaque W garage, camion, par zone) ?'], 'thanks'),
    en: compose('en', 'MC Export – availability and transport rates', ['Could you confirm your availability over the coming weeks and your current rates (driven delivery, truck, by area)?'], 'thanks'),
    de: compose('de', 'MC Export – Verfügbarkeit und Überführungstarife', ['Könnten Sie uns Ihre Verfügbarkeit in den kommenden Wochen und Ihre aktuellen Tarife bestätigen (Überführung auf Achse, LKW, nach Zone)?'], 'thanks'),
    nl: compose('nl', 'MC Export – beschikbaarheid en transporttarieven', ['Kunt u ons uw beschikbaarheid voor de komende weken en uw actuele tarieven bevestigen (rijdend transport, vrachtwagen, per zone)?'], 'thanks'),
    da: compose('da', 'MC Export – ledige tider og transportpriser', ['Kan I bekræfte jeres ledige tider de kommende uger og jeres aktuelle priser (kørende levering, lastbil, pr. zone)?'], 'thanks'),
    sv: compose('sv', 'MC Export – tillgänglighet och transportpriser', ['Kan ni bekräfta er tillgänglighet de kommande veckorna och era aktuella priser (körd leverans, lastbil, per zon)?'], 'thanks'),
    it: compose('it', 'MC Export – disponibilità e tariffe di trasporto', ['Potreste confermarci le vostre disponibilità per le prossime settimane e le vostre tariffe aggiornate (consegna su strada, bisarca, per zona)?'], 'thanks'),
    es: compose('es', 'MC Export – disponibilidad y tarifas de transporte', ['¿Podrían confirmarnos su disponibilidad para las próximas semanas y sus tarifas actualizadas (entrega conducida, camión, por zona)?'], 'thanks'),
  },
  autre: {
    fr: compose('fr', 'MC Export – prise de contact', [''], 'regards'),
    en: compose('en', 'MC Export – getting in touch', [''], 'regards'),
    de: compose('de', 'MC Export – Kontaktaufnahme', [''], 'regards'),
    nl: compose('nl', 'MC Export – contactopname', [''], 'regards'),
    da: compose('da', 'MC Export – kontakt', [''], 'regards'),
    sv: compose('sv', 'MC Export – kontakt', [''], 'regards'),
    it: compose('it', 'MC Export – presa di contatto', [''], 'regards'),
    es: compose('es', 'MC Export – toma de contacto', [''], 'regards'),
  },
};

/* ── VENTE : proposer nos véhicules (même fond pour toutes les catégories) ──────────────────────────────── */
const VENTE: Record<MailLang, Tpl> = {
  fr: compose('fr', 'MC Export – nos véhicules d\'occasion pour {societe}', [
    'MC Export vend des véhicules d\'occasion en volume aux professionnels en Europe : électriques, hybrides rechargeables et thermiques récents, livrés avec leurs documents et le transport organisé.',
    `Nos bonnes affaires du moment sont en ligne ici : ${BONNES_AFFAIRES_URL} — nous aurons régulièrement de nouveaux véhicules à proposer.`,
    'Pour vous envoyer en priorité ce qui vous correspond, pouvez-vous nous indiquer vos critères : marques et modèles recherchés, budget, volumes, énergies ?',
  ], 'regards'),
  en: compose('en', 'MC Export – our used vehicles for {societe}', [
    'MC Export sells used vehicles in volume to trade buyers across Europe: electric, plug-in hybrid and recent petrol/diesel cars, delivered with their documents and transport arranged.',
    `Our current best deals are online here: ${BONNES_AFFAIRES_URL} — we regularly have new vehicles to offer.`,
    'To send you first what suits you, could you tell us your criteria: makes and models you are looking for, budget, volumes, fuel types?',
  ], 'regards'),
  de: compose('de', 'MC Export – unsere Gebrauchtwagen für {societe}', [
    'MC Export verkauft Gebrauchtwagen in Stückzahlen an Händler in ganz Europa: Elektro-, Plug-in-Hybrid- sowie junge Benzin- und Dieselfahrzeuge, geliefert mit Papieren und organisiertem Transport.',
    `Unsere aktuellen Angebote finden Sie hier: ${BONNES_AFFAIRES_URL} — wir haben regelmäßig neue Fahrzeuge anzubieten.`,
    'Damit wir Ihnen vorrangig das Passende senden können: Welche Marken und Modelle suchen Sie, mit welchem Budget, in welchen Stückzahlen und mit welchen Antrieben?',
  ], 'regards'),
  nl: compose('nl', 'MC Export – onze occasions voor {societe}', [
    'MC Export verkoopt occasions in volume aan handelaren in heel Europa: elektrische, plug-in hybride en jonge benzine-/dieselauto\'s, geleverd met hun documenten en georganiseerd transport.',
    `Onze huidige aanbiedingen staan hier online: ${BONNES_AFFAIRES_URL} — wij hebben regelmatig nieuwe voertuigen aan te bieden.`,
    'Om u met voorrang te sturen wat bij u past: welke merken en modellen zoekt u, met welk budget, in welke aantallen en met welke brandstoffen?',
  ], 'regards'),
  da: compose('da', 'MC Export – vores brugte biler til {societe}', [
    'MC Export sælger brugte biler i volumen til forhandlere i hele Europa: elbiler, plug-in hybrider og nyere benzin- og dieselbiler, leveret med dokumenter og organiseret transport.',
    `Vores aktuelle gode tilbud findes her: ${BONNES_AFFAIRES_URL} — vi får løbende nye biler ind.`,
    'For at sende jer det, der passer bedst, først: hvilke mærker og modeller søger I, med hvilket budget, i hvilke mængder og med hvilke drivmidler?',
  ], 'regards'),
  sv: compose('sv', 'MC Export – våra begagnade fordon för {societe}', [
    'MC Export säljer begagnade fordon i volym till handlare i hela Europa: elbilar, laddhybrider och nyare bensin- och dieselbilar, levererade med dokument och ordnad transport.',
    `Våra aktuella erbjudanden finns här: ${BONNES_AFFAIRES_URL} — vi har regelbundet nya fordon att erbjuda.`,
    'För att först skicka er det som passar: vilka märken och modeller söker ni, med vilken budget, i vilka volymer och med vilka drivmedel?',
  ], 'regards'),
  it: compose('it', 'MC Export – i nostri veicoli usati per {societe}', [
    'MC Export vende veicoli usati in volume a operatori professionali in tutta Europa: elettrici, ibridi plug-in e termici recenti, consegnati con i documenti e con trasporto organizzato.',
    `Le nostre occasioni del momento sono online qui: ${BONNES_AFFAIRES_URL} — abbiamo regolarmente nuovi veicoli da proporre.`,
    'Per inviarvi in via prioritaria ciò che vi corrisponde: quali marche e modelli cercate, con quale budget, in quali volumi e con quali alimentazioni?',
  ], 'regards'),
  es: compose('es', 'MC Export – nuestros vehículos de ocasión para {societe}', [
    'MC Export vende vehículos de ocasión en volumen a profesionales de toda Europa: eléctricos, híbridos enchufables y térmicos recientes, entregados con su documentación y transporte organizado.',
    `Nuestras mejores ofertas del momento están aquí: ${BONNES_AFFAIRES_URL} — tenemos regularmente nuevos vehículos que proponer.`,
    'Para enviarles primero lo que les corresponde: ¿qué marcas y modelos buscan, con qué presupuesto, en qué volúmenes y con qué combustibles?',
  ], 'regards'),
};

/* ── RELANCE : rappel court ─────────────────────────────────────────────────────────────────────────────── */
const RELANCE: Record<MailLang, Tpl> = {
  fr: compose('fr', 'MC Export – petit rappel', ['Je reviens vers vous à la suite de mon précédent message, resté sans réponse.', 'Nous restons intéressés par un échange sur vos véhicules à vendre et sur ceux que nous pouvons vous proposer : un simple retour, même rapide, nous suffit pour avancer.'], 'regards'),
  en: compose('en', 'MC Export – quick follow-up', ['I am following up on my previous message, which has remained unanswered.', 'We remain interested in talking about the vehicles you have for sale and those we can offer you: a short reply is all we need to move forward.'], 'regards'),
  de: compose('de', 'MC Export – kurze Nachfrage', ['Ich komme auf meine vorherige Nachricht zurück, die bisher unbeantwortet geblieben ist.', 'Wir bleiben an einem Austausch über Ihre zum Verkauf stehenden Fahrzeuge und über die Fahrzeuge, die wir Ihnen anbieten können, interessiert: eine kurze Rückmeldung genügt uns, um weiterzukommen.'], 'regards'),
  nl: compose('nl', 'MC Export – korte herinnering', ['Ik kom terug op mijn vorige bericht, dat onbeantwoord is gebleven.', 'Wij blijven geïnteresseerd in een gesprek over uw te koop staande voertuigen en over die wij u kunnen aanbieden: een kort antwoord is voldoende om verder te gaan.'], 'regards'),
  da: compose('da', 'MC Export – kort opfølgning', ['Jeg følger op på min tidligere besked, som er forblevet ubesvaret.', 'Vi er fortsat interesserede i en dialog om de biler, I har til salg, og dem vi kan tilbyde jer: et kort svar er alt, vi behøver for at komme videre.'], 'regards'),
  sv: compose('sv', 'MC Export – kort uppföljning', ['Jag återkommer angående mitt tidigare meddelande, som förblivit obesvarat.', 'Vi är fortsatt intresserade av ett samtal om de fordon ni har till salu och de vi kan erbjuda er: ett kort svar räcker för att komma vidare.'], 'regards'),
  it: compose('it', 'MC Export – breve promemoria', ['Torno a scrivervi in seguito al mio precedente messaggio, rimasto senza risposta.', 'Restiamo interessati a un confronto sui veicoli che avete in vendita e su quelli che possiamo proporvi: una breve risposta ci basta per procedere.'], 'regards'),
  es: compose('es', 'MC Export – breve recordatorio', ['Retomo mi mensaje anterior, que ha quedado sin respuesta.', 'Seguimos interesados en hablar de los vehículos que tienen en venta y de los que podemos proponerles: una breve respuesta nos basta para avanzar.'], 'regards'),
};

/** Le modèle d'un thème, pour une catégorie et une langue. */
export function groupTemplate(theme: MailTheme, kind: ContactKind, lang: MailLang): Tpl {
  if (theme === 'vente') return VENTE[lang];
  if (theme === 'relance') return RELANCE[lang];
  return ACHAT[kind][lang];
}
