/**
 * Ada, phase 2 (17/10) : l'annuaire des concessions — le garage lu sur une
 * page AutoScout24, l'adresse d'une découverte, et « ils vendent ce que nous
 * vendons, plus cher » (rapprochement avec nos offres).
 */
import { parseListings } from '../src/lib/study-core/parsers/autoscout24';
import { discoveryUrl, discoveryPages } from '../src/lib/agents/discovery';
import { opportunities, brandKey, sameModel, type OfferLite, type DealerListingLite } from '../src/lib/agents/opportunity';
import { recordDealerSightings, isVanSearch } from '../src/services/dealerDirectory';
import { isPlaceholderSeller } from '../src/lib/agents/keys';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA : ANNUAIRE DES CONCESSIONS ===\n');

// Une page AutoScout24 réduite à l'essentiel (forme relevée le 17/10 sur autoscout24.fr).
const ad = (over: Record<string, unknown>) => ({
  id: 'x', url: '/offres/toyota-c-hr', price: { priceFormatted: '€ 21 900', priceRaw: 21900 },
  vehicle: { make: 'Toyota', model: 'C-HR', modelVersionInput: '1.8 Hybride' },
  tracking: { firstRegistration: '03-2021', mileage: '38 000' },
  location: { countryCode: 'FR', zip: '92200', city: 'Neuilly sur Seine', street: '176 Avenue du Général De Gaulle' },
  seller: {
    id: '27207694', type: 'Dealer', companyName: 'CapCar', contactName: 'Service Commercial',
    links: { infoPage: 'https://www.autoscout24.fr/garages/capcar?atype=C', imprint: 'https://www.autoscout24.fr/garages/capcar/informations-legales' },
    phones: [{ phoneType: 'Office', formattedNumber: '+33 (0)172 - 396387', callTo: '+33172396387' }],
  },
  ...over,
});
const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { listings: [
  ad({}),
  ad({ id: 'y', url: '/offres/toyota-yaris', seller: { id: '99', type: 'Private', companyName: null } }),
] } } })}</script></html>`;
const parsed = parseListings(html, 'https://www.autoscout24.fr/lst/toyota?atype=C&cy=F');
const s = parsed[0]?.seller;
ok(parsed.length === 2, 'page lue : 2 annonces', parsed.length);
ok(s?.id === '27207694' && s?.name === 'CapCar', 'garage : identifiant et nom', s);
ok(s?.phone === '+33172396387' && s?.city === 'Neuilly sur Seine' && s?.zip === '92200' && s?.country === 'FR', 'garage : téléphone et adresse', s);
ok(s?.imprintUrl?.endsWith('/informations-legales') === true && s?.siteUrl?.includes('/garages/capcar') === true, 'garage : page du garage et mentions légales', s);
ok(parsed[1]?.seller == null, 'particulier : pas de garage enregistré', parsed[1]?.seller);

// Adresse d'une découverte
const fr = new URL(discoveryUrl({ country: 'fr', brand: 'Toyota' }));
ok(fr.hostname === 'www.autoscout24.fr' && fr.pathname === '/lst/toyota', 'découverte : AutoScout24 France, marque Toyota', fr.toString());
ok(fr.searchParams.get('sort') === 'age' && fr.searchParams.get('desc') === '1' && fr.searchParams.get('cy') === 'F' && fr.searchParams.get('atype') === 'C', 'découverte : annonces les plus récentes d\'abord, voitures', fr.toString());
const van = new URL(discoveryUrl({ country: 'FR', brand: 'Ford', model: 'Transit Custom', vans: true }));
ok(van.pathname.startsWith('/lst/ford/') && van.searchParams.get('atype') === 'X', 'découverte : utilitaires Ford (catégorie X)', van.toString());
ok(new URL(discoveryUrl({ country: 'BE', brand: 'Opel' })).pathname === '/fr/lst/opel', 'découverte : Belgique (chemin /fr)');
ok(new URL(discoveryUrl({ country: 'DE', brand: 'Mercedes-Benz', vans: true })).pathname === '/lst/mercedes-benz', 'découverte : Mercedes-Benz en Allemagne');
let threw = false;
try { discoveryUrl({ country: 'DK', brand: 'Toyota' }); } catch { threw = true; }
ok(threw, 'découverte : pays non couvert par AutoScout24 refusé');
ok(discoveryPages(0) === 5 && discoveryPages(50) === 10 && discoveryPages(3) === 3, 'découverte : 1 à 10 pages (5 par défaut)');

// Écriture dans l'annuaire (client Supabase simulé)
const written: Record<string, Array<Record<string, unknown>>> = {};
const fake = {
  from: (t: string) => ({
    upsert: (rows: Array<Record<string, unknown>>) => {
      written[t] = rows;
      const res = { data: rows.map((r, i) => ({ id: `dealer-${i}`, site_dealer_id: r.site_dealer_id })), error: null };
      return Object.assign(Promise.resolve({ error: null }), { select: async () => res });
    },
  }),
};
const vanPage = [parsed[0], { ...parsed[0], listing_url: 'https://www.autoscout24.fr/offres/autre' }, parsed[1]];
const n = await recordDealerSightings(fake, vanPage, { site: 'AUTOSCOUT_FR', country: 'FR', sourceUrl: 'https://www.autoscout24.fr/lst/ford?atype=X&cy=F&sort=age&desc=1' });
ok(n === 1 && written.market_dealers?.length === 1 && written.market_dealers[0].site === 'autoscout24', 'annuaire : un garage (le particulier est écarté), site AutoScout24 commun', written.market_dealers);
ok(written.market_dealers?.[0].phone === '+33172396387' && !('first_seen_at' in (written.market_dealers?.[0] ?? {})), 'annuaire : coordonnées écrites, date de première vue préservée', written.market_dealers?.[0]);
ok(written.market_dealer_listings?.length === 2 && written.market_dealer_listings.every((r) => r.vehicle_type === 'utilitaire' && r.brand === 'TOYOTA' && r.price_eur === 21_900), 'annuaire : 2 annonces, marquées utilitaires (page atype=X)', written.market_dealer_listings);
ok(isVanSearch('https://www.autoscout24.nl/lst/ford?atype=X') && !isVanSearch('https://www.autoscout24.fr/lst/ford?atype=C&cy=F') && !isVanSearch(null), 'annuaire : page d\'utilitaires reconnue à son adresse (atype=X)');

// 25/10 : les vendeurs qui ne sont pas des entreprises (fiches parasites « Onbekende dealer », « AutoScout24 Luxembourg »).
ok(['Onbekende dealer', 'AutoScout24 Luxembourg', 'Autoscout 24', 'mobile.de GmbH', 'Unknown dealer', 'Particulier', 'Privé', 'Privatverkauf', ' '].every(isPlaceholderSeller),
  'vendeur masqué, nom du site d\'annonces, particulier : pas une entreprise');
ok(!['Autohaus Bleker GmbH', 'Private Car Center', 'Privat Auto GmbH', 'AUTOHERO FRANCE', 'Mobile Garage Dupont', 'Particulier Motors SARL', 'Inconnue SARL'].some(isPlaceholderSeller),
  'les vraies entreprises restent, même si leur nom commence pareil');
const masked = [{ ...parsed[0], seller: { ...parsed[0].seller!, id: 'gp-0', name: 'Onbekende dealer' } }, { ...parsed[0], seller: { ...parsed[0].seller!, id: 'as-lu', name: 'AutoScout24 Luxembourg' } }, parsed[0]];
const nm = await recordDealerSightings(fake, masked, { site: 'AUTOSCOUT_FR', country: 'FR' });
ok(nm === 1 && written.market_dealers?.length === 1 && written.market_dealers[0].name === parsed[0].seller?.name, 'annuaire : les vendeurs masqués et le site d\'annonces ne sont pas enregistrés', written.market_dealers);

// « Plus cher que nous »
const offers: OfferLite[] = [
  { id: 'o1', brand: 'TOYOTA', model: 'C-HR', year: 2021, km: 40_000, priceHt: 17_000, title: 'Toyota C-HR' },
  { id: 'o2', brand: 'Mercedes-Benz', model: 'Vito', year: 2020, km: 80_000, priceHt: 22_000, title: 'Mercedes Vito' },
];
const l = (o: Partial<DealerListingLite>): DealerListingLite => ({ listing_url: 'u', brand: 'TOYOTA', model: 'C-HR', year: 2021, mileage: 38_000, price_eur: 21_900, title: '', ...o });
const opp = opportunities([
  l({ listing_url: 'a' }),
  l({ listing_url: 'b', year: 2018 }),
  l({ listing_url: 'c', model: 'Yaris' }),
  l({ listing_url: 'd', price_eur: 19_000 }),
  l({ listing_url: 'e', brand: 'MERCEDES', model: 'Vito Tourer', year: 2020, mileage: 90_000, price_eur: 31_900 }),
], offers, 0.2);
ok(opp.length === 2, 'rapprochement : 2 annonces plus chères que nos offres', opp.map((o) => o.listing.listing_url));
ok(opp[0]?.listing.listing_url === 'e' && opp[0]?.gap === 31_900 - 26_400, 'rapprochement : meilleur écart d\'abord (Vito : +5 500 €)', opp[0]);
ok(opp[1]?.listing.listing_url === 'a' && opp[1]?.ourTtc === 20_400 && opp[1]?.gap === 1_500 && opp[1]?.gapPct === 7, 'rapprochement : C-HR à 21 900 € TTC contre 20 400 € (notre HT + TVA 20 %)', opp[1]);
ok(brandKey('Mercedes-Benz') === brandKey('MERCEDES') && brandKey('VW') === brandKey('Volkswagen'), 'marques : Mercedes-Benz = Mercedes, VW = Volkswagen');
ok(sameModel('C-HR', 'CHR') && sameModel('Corolla', 'Corolla Touring Sports') && !sameModel('C-HR', 'Yaris'), 'modèles : C-HR = CHR, Corolla ≈ Corolla Touring Sports');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
