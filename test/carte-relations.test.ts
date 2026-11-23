/**
 * NIVEAUX DE RELATION DE LA CARTE (23/11, Channing : « ceux avec lesquels on a fait des deals → contact actif ; ceux
 * dont les acheteurs VO sont connus ; les vitrines sans acheteur ni deal pour les data » — « des noms parlants »).
 * Partenaire / Discussion / Prospect / Données, établis par les faits ; un niveau posé à la main n'est jamais abaissé ;
 * rôle tiré des deals ; rapprochement Ventes ↔ Carte sans faux amis.
 */
import { relationLevelOf, higherLevel, factLevel, roleFor, companyCore, carteMatchesOf, dealsByCarte, buyerKnown, RELATION_LEVELS, RELATION_LEVEL_HELP } from '../src/lib/network/relations';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== NIVEAUX : NOMS, ANCIENS MOTS, JAMAIS ABAISSÉS ===\n');
ok(RELATION_LEVELS.join(',') === 'partenaire,discussion,prospect,donnees' && RELATION_LEVELS.every((l) => RELATION_LEVEL_HELP[l].length > 20), 'quatre niveaux, chacun avec sa définition (ce que l\'on coche)');
ok(relationLevelOf('chaud') === 'discussion' && relationLevelOf('Tiède') === 'prospect' && relationLevelOf('froid') === 'donnees' && relationLevelOf('nouveau') === null && relationLevelOf('') === null && relationLevelOf('Données') === 'donnees',
  'anciens mots traduits une fois : chaud → Discussion, tiède → Prospect, froid → Données, nouveau / vide → au calcul');
ok(higherLevel('partenaire', 'donnees') === 'partenaire' && higherLevel('prospect', 'discussion') === 'discussion' && higherLevel(null, 'prospect') === 'prospect' && higherLevel('discussion', null) === 'discussion',
  'le calcul relève un niveau, il ne l\'abaisse jamais (un Partenaire posé à la main reste Partenaire)');
ok(factLevel({ deals: 2, replied: false, buyerKnown: false }) === 'partenaire' && factLevel({ deals: 0, replied: true, buyerKnown: true }) === 'discussion'
  && factLevel({ deals: 0, replied: false, buyerKnown: true }) === 'prospect' && factLevel({ deals: 0, replied: false, buyerKnown: false }) === 'donnees',
  'faits : deal → Partenaire, réponse → Discussion, acheteur VO connu → Prospect, sinon Données');
ok(buyerKnown({ contact_name: 'Andrea Domenicucci — acheteur VO « Responsabile commerciale »' }) && buyerKnown({ contact_name: 'Erik Domjen — responsable VO « Manažér predaja jazdených vozidiel »' })
  && !buyerKnown({ contact_name: 'Marek Lochaj — vendeur VO « Predajca jazdených vozidiel »' }) && !buyerKnown({ contact_name: null }),
  'acheteur ou responsable VO connu (lecture de la Campagne) ; un vendeur ne l\'est pas');

console.log('\n=== RÔLE : « S\'ILS VENDENT, C\'EST QU\'ILS ONT ACHETÉ QUELQUE PART » ===\n');
ok(roleFor('concession', 'vendeur', { bought: 0, sold: 0 }) === 'les_deux' && roleFor('trader', 'acheteur', { bought: 3, sold: 0 }) === 'les_deux',
  'concession et trader : acheteur ET vendeur');
ok(roleFor('loueur', 'vendeur', { bought: 0, sold: 1 }) === 'vendeur' && roleFor('leasing', 'vendeur', { bought: 2, sold: 0 }) === 'les_deux' && roleFor('flotte', 'acheteur', { bought: 0, sold: 0 }) === 'vendeur',
  'loueur, leasing, flotte : vendeur, sauf s\'il nous a acheté');
ok(roleFor('autre', 'vendeur', { bought: 1, sold: 0 }) === 'les_deux' && roleFor('convoyeur', 'acheteur', { bought: 0, sold: 0 }) === 'acheteur',
  'autres types : leur rôle, précisé par les deals');

console.log('\n=== VENTES ↔ CARTE : LES BONNES FICHES, PAS DE FAUX AMIS ===\n');
ok(companyCore('AUTOGROEP OOSTENDORP') === 'oostendorp' && companyCore('De Waal Autogroep B.V.') === 'dewaal' && companyCore('LOUWMAN OCCASION CENTER B.V') === 'louwman' && companyCore('Kamux Oyj') === 'kamux',
  'cœur d\'un nom de société sans les mots communs (autogroep, occasion, B.V., Oyj…)', [companyCore('AUTOGROEP OOSTENDORP'), companyCore('De Waal Autogroep B.V.'), companyCore('LOUWMAN OCCASION CENTER B.V'), companyCore('Kamux Oyj')]);
const carte = [
  { id: 'oost', name: 'Oostendorp Autogroep', email: null, phone: null, website: 'https://www.oostendorp-autogroep.nl/occasions' },
  { id: 'waal', name: 'Dewaal autogroep', email: null, phone: null, website: null },
  { id: 'car', name: 'C.A.R', email: null, phone: '+39 051 123456', website: 'https://www.carbologna.com/auto/usate/' },
  { id: 'kmx', name: 'Kamux', email: 'myynti@kamux.fi', phone: null, website: null },
  { id: 'tel', name: 'Garage du Centre', email: null, phone: '+33 4 73 00 00 00', website: null },
];
ok(carteMatchesOf({ id: 's1', company_name: 'AUTOGROEP OOSTENDORP', email: null, phone: null }, carte).join() === 'oost'
  && carteMatchesOf({ id: 's2', company_name: 'De Waal Autogroep B.V.', email: null, phone: null }, carte).join() === 'waal',
  'nom : « AUTOGROEP OOSTENDORP » = « Oostendorp Autogroep », « De Waal Autogroep B.V. » = « Dewaal autogroep »');
ok(carteMatchesOf({ id: 's3', company_name: 'ISSOIRE PARC AUTO', email: null, phone: null }, carte).length === 0,
  'pas de faux ami : « ISSOIRE PARC AUTO » ne devient pas « C.A.R » (lettres communes « c a »)');
ok(carteMatchesOf({ id: 's4', company_name: 'X', email: 'info@kamux.fi', phone: null }, carte).join() === 'kmx' && carteMatchesOf({ id: 's5', company_name: 'Y', email: 'jean@gmail.com', phone: null }, [{ ...carte[4], email: 'paul@gmail.com' }]).length === 0,
  'domaine d\'e-mail commun reconnu, sauf une messagerie gratuite (gmail…)');
ok(carteMatchesOf({ id: 's6', company_name: 'Z', email: null, phone: '04 73 00 00 00' }, carte).join() === 'tel', 'même téléphone (9 derniers chiffres)');
const deals = dealsByCarte([
  { buyer_contact_id: 's1', client_contact_id: 's1', transaction_date: '2026-11-02' },
  { buyer_contact_id: 's1', transaction_date: '2026-11-10' },
  { seller_contact_id: 's2', transaction_date: '2026-10-01' },
  { buyer_contact_id: 's1', transaction_date: '2026-11-20', status: 'annulée' },
  { seller_contact_id: 'mc', buyer_contact_id: 's3', transaction_date: '2026-11-11' },
], [{ id: 's1', company_name: 'AUTOGROEP OOSTENDORP', email: null, phone: null }, { id: 's2', company_name: 'De Waal Autogroep B.V.', email: null, phone: null }, { id: 's3', company_name: 'ISSOIRE PARC AUTO', email: null, phone: null }], carte);
ok(deals.get('oost')?.bought === 2 && deals.get('oost')?.last === '2026-11-10' && deals.get('waal')?.sold === 1 && !deals.has('car'),
  'deals : une transaction compte une fois (acheteur ET client), les annulées ne comptent pas, dernier deal daté', [...deals]);

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);
