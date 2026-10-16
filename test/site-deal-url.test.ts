/**
 * Adresse des bonnes affaires sur mc-export.com : src/lib/siteDeal.ts doit
 * rendre exactement le slug de site_good_deals() (SQL du 13/10), sinon le
 * clic depuis l'Accueil d'ADA n'arrive pas sur l'adresse canonique de la fiche.
 */
import { adaSlug, siteDealSlug, siteDealUrl } from '../src/lib/siteDeal';

let fails = 0;
const eq = (got: string, want: string, what: string) => {
  if (got === want) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what} : obtenu « ${got} », attendu « ${want} »`); }
};

console.log('\n=== ADRESSE DES BONNES AFFAIRES SUR mc-export.com ===\n');

// La vérification de la migration elle-même : public.ada_slug('Škoda Enyaq 2024') = 'skoda-enyaq-2024'.
eq(adaSlug('Škoda Enyaq 2024'), 'skoda-enyaq-2024', 'ada_slug : la vérification du SQL du 13/10');
eq(adaSlug('Mercedes-Benz Classe A 2021'), 'mercedes-benz-classe-a-2021', 'ada_slug : tirets et espaces');
eq(adaSlug('  Citroën ë-C4  '), 'citroen-e-c4', 'ada_slug : accents et bords');
eq(adaSlug('BMW Série 3 (G21) 320d'), 'bmw-serie-3-g21-320d', 'ada_slug : parenthèses');
eq(adaSlug('Straße'), 'strase', 'ada_slug : ß devient un seul s, comme translate()');
eq(adaSlug(null), '', 'ada_slug : rien');

const id = '3f2a9c1b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
eq(siteDealSlug(id, { brand: 'Audi', model: 'A4', year: 2016 }), 'audi-a4-2016-3f2a9c1b', 'slug : marque modèle année + 8 caractères de l\'id');
eq(siteDealSlug(id, { brand: 'Audi', model: 'A4', year: null }), 'audi-a4-3f2a9c1b', 'slug : sans année (concat_ws saute les null)');
eq(siteDealSlug(id, { brand: 'Toyota', model: 'C-HR', year: '2022' }), 'toyota-c-hr-2022-3f2a9c1b', 'slug : année en texte');
eq(siteDealSlug(id, { brand: '', model: '', year: null }), '-3f2a9c1b', 'slug : véhicule sans nom (le tiret reste, comme en SQL)');
eq(siteDealUrl(id, { brand: 'Škoda', model: 'Elroq', year: 2025 }), 'https://mc-export.com/bonnes-affaires/skoda-elroq-2025-3f2a9c1b', 'URL : la fiche française');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
