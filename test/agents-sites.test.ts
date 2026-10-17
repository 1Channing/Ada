/**
 * Ada, l'annuaire sur tous les sites (17/10, Channing : « fais tous les sites
 * directement »). Le garage de chaque annonce, lu à la façon de chaque site
 * (formes relevées sur pages réelles le 17/10 : Marktplaats, coches.net,
 * Blocket, Jófogás ; Gaspedaal d'après la fixture au format réel ; les autres
 * d'après leurs clés d'usage) ; les particuliers jamais retenus ; l'écriture
 * dans l'annuaire (fonction de la base, ou écriture d'avant tant que le SQL
 * n'est pas collé) ; la découverte sur chaque site et sa rotation.
 * Les pages sont SYNTHÉTIQUES (gabarits réduits, valeurs d'exemple) : aucune
 * page réelle avec des données de particuliers n'est versionnée.
 */
import { readFileSync } from 'node:fs';
import { coreParseSearchPage } from '../src/lib/study-core/parsers';
import {
  marktplaatsSeller, leboncoinSeller, cochesSeller, blocketSeller, jofogasSeller, gaspedaalSeller, genericSeller, looksLikeCompany, nameId,
} from '../src/lib/study-core/parsers/seller';
import { recordDealerSightings, dealerSiteFamily, isVanSearch } from '../src/services/dealerDirectory';
import { discoveryUrl, discoverySiteKey, discoveryPairs, nextDiscoveryPair, DISCOVERY_SITES } from '../src/lib/agents/discovery';
import { qualifyPrompt, fitScore, DEFAULT_ADA_TARGETS, buyerCountries, EXPORT_MARKETS } from '../src/lib/agents/qualification';
import { ADA_IDEAL_BUYER } from '../src/lib/agents/playbook';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA : LES GARAGES DE TOUS LES SITES ===\n');

// --- 1. Les lecteurs de chaque site ----------------------------------------------------------
const mpAd = (o: Record<string, unknown>) => ({
  itemId: 'm1', title: 'Ford Transit Custom 2.0 TDCI', priceInfo: { priceCents: 1_995_000 }, vipUrl: '/v/auto-s/ford/m1',
  location: { cityName: 'Langerak', countryName: 'Nederland', latitude: 51.93, longitude: 4.87 },
  sellerInformation: { sellerId: 25779722, sellerName: 'Van der Wal Vans', showWebsiteUrl: true },
  traits: ['DEALER_ACTIVE'], ...o,
});
const mp = marktplaatsSeller(mpAd({}));
ok(mp?.id === '25779722' && mp.name === 'Van der Wal Vans' && mp.city === 'Langerak' && mp.country === 'NL' && mp.lat === 51.93, 'Marktplaats : garage, ville, pays et position', mp);
ok(mp?.siteUrl === 'https://www.marktplaats.nl/u/van-der-wal-vans/25779722/', 'Marktplaats : page du vendeur', mp?.siteUrl);
ok(marktplaatsSeller(mpAd({ sellerInformation: { sellerId: 9, sellerName: 'Jan' }, traits: [] })) === null, 'Marktplaats : un particulier (prénom seul, sans trait de concessionnaire) écarté');
const mpBe = marktplaatsSeller(mpAd({ location: { cityName: 'Gent', countryName: 'België', latitude: 0, longitude: 0 }, sellerInformation: { sellerId: 7, sellerName: 'Garage Vermeulen', sellerWebsiteUrl: 'https://www.admarkt.nl/bside/url/xyz' } }));
ok(mpBe?.country === 'BE' && mpBe.lat === null && mpBe.lng === null && mpBe.website === null, 'Marktplaats : Belgique ; position 0,0 = inconnue ; lien de suivi publicitaire ≠ site web', mpBe);

const lbc = leboncoinSeller({ list_id: 1, owner: { store_id: '4471', user_id: 'u-1', type: 'pro', name: 'GARAGE MARTIN', siren: '123456789' }, location: { city: 'Lyon', zipcode: '69003', lat: 45.75, lng: 4.85 } });
ok(lbc?.id === '4471' && lbc.name === 'GARAGE MARTIN' && lbc.legalId === '123456789' && lbc.zip === '69003' && lbc.city === 'Lyon' && lbc.country === 'FR' && lbc.lat === 45.75, 'Leboncoin : boutique pro, SIREN, adresse et position', lbc);
ok(leboncoinSeller({ owner: { user_id: 'u-2', type: 'private', name: 'Julie' } }) === null, 'Leboncoin : un particulier écarté');

const cn = cochesSeller({ isProfessional: true, phone: '946891322', seller: { name: 'Revivauto Bilbao - Sestao', contractId: '114272', isProfessional: true }, location: { cityLiteral: 'Sestao', mainProvince: 'Bizkaia' } });
ok(cn?.id === '114272' && cn.phone === '946891322' && cn.city === 'Sestao' && cn.country === 'ES', 'coches.net : garage, téléphone, ville', cn);
ok(cochesSeller({ isProfessional: false, seller: { name: 'Pedro', isProfessional: false } }) === null, 'coches.net : un particulier écarté');

const bl = blocketSeller({ id: '1', org_id: 7730907, organisation_name: 'Bilia Nacka Volvo', dealer_segment: 'Företag', location: 'Nacka', coordinates: { lat: 59.30, lon: 18.18 } });
ok(bl?.id === '7730907' && bl.name === 'Bilia Nacka Volvo' && bl.city === 'Nacka' && bl.country === 'SE' && bl.lng === 18.18, 'Blocket : organisation, ville, position', bl);
ok(blocketSeller({ id: '2', dealer_segment: 'Privat', organisation_name: null }) === null, 'Blocket : un particulier écarté');

const jfAd = { company_ad: true, company_name: 'Sárváry Autó Kft.', account_list_id: 'a1b2', profileData: { user_name: 'Vári Csaba', account_type: 'pro' }, latitude: 47.56, longitude: 19.09,
  parameters: [{ key: 'zipcode', values: [{ value: '1042', label: '1042' }] }, { key: 'city', values: [{ value: '1', label: 'Budapest IV.' }] }] };
const jf = jofogasSeller(jfAd);
ok(jf?.id === 'a1b2' && jf.name === 'Sárváry Autó Kft.' && jf.contactName === 'Vári Csaba' && jf.zip === '1042' && jf.city === 'Budapest IV.' && jf.country === 'HU', 'Jófogás : société, interlocuteur, code postal et ville', jf);
ok(jofogasSeller({ company_ad: false, profileData: { account_type: 'private' } }) === null, 'Jófogás : un particulier écarté');

const gpItem = { offers: { price: 26950, seller: { '@type': 'AutoDealer', name: 'Tesselaar BV' } } };
const gp = gaspedaalSeller(gpItem, 'https://api.gaspedaal.nl/redirect/vehicle/203151550');
ok(gp?.id === nameId('Tesselaar BV') && gp.id === 'n:tesselaarbv' && gp.siteUrl === 'https://api.gaspedaal.nl/redirect/vehicle/203151550', 'Gaspedaal : nom seul (identifiant tiré du nom), lien du portail « dealer »', gp);
ok(gaspedaalSeller(gpItem, 'https://evil.example/redirect/1')?.siteUrl === null, 'Gaspedaal : seul un lien api.gaspedaal.nl est gardé');

// Lecture générique (sites pas encore relevés sur page réelle)
const sub = genericSeller({ kind: 'AdItem', subject: 'Fiat Ducato', advertiser: { userId: '555', name: 'Autosalone Rossi Srl', company: true }, geo: { town: { value: 'Verona' }, map: { latitude: 45.43, longitude: 10.99 } } });
ok(sub?.id === '555' && sub.name === 'Autosalone Rossi Srl' && sub.city === 'Verona' && sub.lat === 45.43, 'Subito : advertiser société, ville et position', sub);
ok(genericSeller({ advertiser: { userId: '9', name: 'Marco', company: false } }) === null, 'Subito : un particulier écarté');
const mob = genericSeller({ sellerId: 12345678, contactInfo: { typeLocalized: 'Händler', name: 'Autohaus Müller GmbH', location: 'DE-91325 Adelsdorf' } }, { type: 'Händler' });
ok(mob?.id === '12345678' && mob.zip === '91325' && mob.city === 'Adelsdorf' && mob.country === 'DE', 'mobile.de : contactInfo (Händler), code postal, ville, pays', mob);
ok(genericSeller({ st: 'Privatanbieter', contactInfo: { name: 'K. Schmidt' } }, { type: 'Privatanbieter' }) === null, 'mobile.de : un particulier écarté');
const bb = genericSeller({ seller: { name: 'Bilhuset Vejle ApS', type: 'Forhandler', id: 'b-77' }, location: { city: 'Vejle', zipCode: '7100' } });
ok(bb?.id === 'b-77' && bb.city === 'Vejle' && bb.zip === '7100', 'Bilbasen : forhandler (concessionnaire)', bb);
ok(genericSeller({ customerType: 'PRO', reference: 'E1', vehicle: {} }, { type: 'PRO' }) === null, 'La Centrale : un pro sans nom n\'invente pas de garage');
ok(genericSeller({ customerType: 'PART', customerName: 'SPOTICAR Lyon' }, { type: 'PART' }) === null, 'La Centrale : « PART » = particulier');
ok(genericSeller({ seller: { name: 'Jean Dupont' } }) === null && genericSeller({ seller: { name: 'Dupont Automobiles' } })?.name === 'Dupont Automobiles', 'type inconnu : un nom de personne écarté, un nom d\'entreprise gardé');
ok(looksLikeCompany('MCC AUTO’s Westland') && looksLikeCompany('Van Happen Auto\'s B.V.') && !looksLikeCompany('Kees'), 'noms d\'entreprise reconnus');

// --- 2. Les pages complètes : chaque lecteur de site est branché -------------------------------
const nextPage = (data: unknown) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
const sellerOf = (html: string, url: string) => coreParseSearchPage(html, url).map((l) => l.seller ?? null);

const gaspedaal = coreParseSearchPage(readFileSync('test/fixtures/html/gaspedaal-page1.html', 'utf8'), 'https://www.gaspedaal.nl/toyota/yaris-cross');
const gTess = gaspedaal.find((l) => l.seller?.name === 'Tesselaar BV');
ok(!!gTess && gTess.seller?.siteUrl === 'https://api.gaspedaal.nl/redirect/vehicle/203151550' && gaspedaal.filter((l) => l.seller).length === 1, 'page Gaspedaal : Tesselaar BV et le lien de son portail « dealer » ; l\'annonce sans vendeur reste sans garage', gaspedaal.map((l) => l.seller));

const jfPage = nextPage({ props: { pageProps: { adList: { ads: [
  { url: 'https://auto.jofogas.hu/budapest/Toyota_Corolla_162443327.htm', subject: 'Toyota Corolla 1.8 Hybrid', price: { value: 7_599_999 }, list_time: { value: 1_760_257_127 }, ...jfAd,
    parameters: [...jfAd.parameters, { key: 'brand_cars', values: [{ value: '1', label: 'Toyota' }] }, { key: 'model_cars', values: [{ value: '2', label: 'Corolla' }] }, { key: 'regdate', values: [{ value: '2023', label: '2023' }] }, { key: 'mileage', values: [{ value: '151821', label: '151 821 km' }] }] },
  { url: 'https://auto.jofogas.hu/pest/Suzuki_Vitara_1.htm', subject: 'Suzuki Vitara', price: { value: 5_200_000 }, company_ad: false, profileData: { account_type: 'private' } },
] } } } });
const jfL = coreParseSearchPage(jfPage, 'https://auto.jofogas.hu/magyarorszag/auto/toyota');
ok(jfL.length === 2 && jfL[0].brand === 'Toyota' && jfL[0].year === 2023 && jfL[0].mileage === 151_821 && jfL[0].seller?.name === 'Sárváry Autó Kft.' && jfL[1].seller === null,
  'page Jófogás (Next.js) : annonces structurées, garage du pro, particulier sans garage', jfL.map((l) => ({ b: l.brand, y: l.year, s: l.seller?.name ?? null })));

const blState = { queries: [{ state: { data: { docs: [
  { id: '20000001', org_id: 7730907, organisation_name: 'Bilia Nacka Volvo', dealer_segment: 'Företag', location: 'Nacka', coordinates: { lat: 59.3, lon: 18.18 } },
  { id: '20000002', dealer_segment: 'Privat', location: 'Solna' },
] } } }] };
const blLd = { '@type': 'CollectionPage', mainEntity: { itemListElement: [
  { item: { name: 'Volvo XC40', description: 'B4 AWD', brand: { name: 'Volvo' }, model: 'XC40', url: 'https://www.blocket.se/mobility/item/20000001', offers: { price: 389_000 } } },
  { item: { name: 'Toyota Yaris', description: '1.5 Hybrid', brand: { name: 'Toyota' }, model: 'Yaris', url: 'https://www.blocket.se/mobility/item/20000002', offers: { price: 159_000 } } },
] } };
const blPage = `<html><head><script type="application/ld+json">${JSON.stringify(blLd)}</script></head><body><script type="application/json" data-react-query-state>${Buffer.from(JSON.stringify(blState)).toString('base64')}</script></body></html>`;
const blS = sellerOf(blPage, 'https://www.blocket.se/mobility/search/car?variant=0.813');
ok(blS.length === 2 && blS[0]?.name === 'Bilia Nacka Volvo' && blS[0]?.id === '7730907' && blS[1] === null, 'page Blocket : garage lu dans le state de la page, particulier sans garage', blS);

const cnProps = { initialResults: { items: [
  { id: 1, url: '/toyota-c-hr-1.htm', title: 'Toyota C-HR 125H', price: 21_900, km: 40_000, year: 2021, make: 'Toyota', model: 'C-HR', isProfessional: true, phone: '946891322', seller: { name: 'Revivauto Bilbao - Sestao', contractId: '114272', isProfessional: true }, location: { cityLiteral: 'Sestao' } },
  { id: 2, url: '/toyota-yaris-2.htm', title: 'Toyota Yaris', price: 12_500, km: 80_000, year: 2018, make: 'Toyota', model: 'Yaris', isProfessional: false, seller: { name: 'Pedro' } },
] } };
const cnPage = `<html><script>window.__INITIAL_PROPS__ = JSON.parse(${JSON.stringify(JSON.stringify(cnProps))});</script></html>`;
const cnS = sellerOf(cnPage, 'https://www.coches.net/toyota/segunda-mano/');
ok(cnS.length === 2 && cnS[0]?.id === '114272' && cnS[0]?.phone === '946891322' && cnS[1] === null, 'page coches.net : garage et téléphone, particulier sans garage', cnS);

const subPage = nextPage({ props: { pageProps: { initialState: { items: { total: 2, originalList: [
  { kind: 'AdItem', subject: 'Fiat Ducato 2.3 MJT', body: '', urls: { default: 'https://www.subito.it/veicoli-commerciali/fiat-ducato-verona-1.htm' },
    features: { '/price': { values: [{ key: '18900', value: '18.900 €' }] }, '/year': { values: [{ key: '2020' }] }, '/car': { values: [{ value: 'Fiat' }, { value: 'Ducato' }] } },
    advertiser: { userId: '555', name: 'Autosalone Rossi Srl', company: true }, geo: { town: { value: 'Verona' }, map: { latitude: 45.43, longitude: 10.99 } } },
  { kind: 'AdItem', subject: 'Fiat Panda', body: '', urls: { default: 'https://www.subito.it/auto/fiat-panda-roma-2.htm' },
    features: { '/price': { values: [{ key: '6500' }] } }, advertiser: { userId: '9', name: 'Marco', company: false } },
] } } } } });
const subS = sellerOf(subPage, 'https://www.subito.it/annunci-italia/vendita/auto/fiat/');
ok(subS.length === 2 && subS[0]?.name === 'Autosalone Rossi Srl' && subS[0]?.city === 'Verona' && subS[1] === null, 'page Subito : advertiser société, particulier sans garage', subS);

const lbcPage = nextPage({ props: { pageProps: { searchData: { total: 2, ads: [
  { list_id: 11, subject: 'Peugeot 2008', url: 'https://www.leboncoin.fr/ad/voitures/11', price: [18_900], attributes: [], location: { city: 'Lyon', zipcode: '69003', lat: 45.75, lng: 4.85 },
    owner: { store_id: '4471', user_id: 'u-1', type: 'pro', name: 'GARAGE MARTIN', siren: '123456789' } },
  { list_id: 12, subject: 'Peugeot 208', url: 'https://www.leboncoin.fr/ad/voitures/12', price: [9_900], attributes: [], location: { city: 'Lyon', zipcode: '69007' }, owner: { user_id: 'u-2', type: 'private', name: 'Julie' } },
] } } } });
const lbcS = sellerOf(lbcPage, 'https://www.leboncoin.fr/recherche?category=2&u_car_brand=PEUGEOT');
ok(lbcS.length === 2 && lbcS[0]?.legalId === '123456789' && lbcS[0]?.zip === '69003' && lbcS[1] === null, 'page Leboncoin : boutique pro et SIREN, particulier sans garage', lbcS);

const mpJson = JSON.stringify({ totalResultCount: 2, listings: [
  mpAd({ itemId: 'm1', vipUrl: '/v/auto-s/ford/m1-ford-transit-custom', attributes: [{ key: 'constructionYear', value: '2021' }, { key: 'mileage', value: '45.000 km' }] }),
  mpAd({ itemId: 'm2', title: 'Toyota Aygo', priceInfo: { priceCents: 795_000 }, vipUrl: '/v/auto-s/toyota/m2-toyota-aygo', sellerInformation: { sellerId: 3, sellerName: 'Kees' }, traits: [], attributes: [{ key: 'constructionYear', value: '2015' }] }),
] });
const mpS = sellerOf(mpJson, 'https://www.marktplaats.nl/lrp/api/search?l1CategoryId=91&limit=30&offset=0');
ok(mpS.length === 2 && mpS[0]?.name === 'Van der Wal Vans' && mpS[1] === null, 'réponse Marktplaats (API de recherche) : garage, particulier sans garage', mpS);

const bbPage = nextPage({ props: { pageProps: { listings: [
  { uri: '/brugt/bil/toyota/yaris/1', make: 'Toyota', model: 'Yaris', title: 'Toyota Yaris 1,5 Hybrid', price: { price: 189_900 }, year: 2021, mileage: 45_000, seller: { id: 'b-77', name: 'Bilhuset Vejle ApS', type: 'Forhandler' }, location: { city: 'Vejle', zipCode: '7100' } },
  { uri: '/brugt/bil/toyota/aygo/2', make: 'Toyota', model: 'Aygo', title: 'Toyota Aygo', price: { price: 59_900 }, year: 2016, mileage: 99_000, seller: { name: 'Lars', type: 'Privat' } },
] } } });
const bbS = sellerOf(bbPage, 'https://www.bilbasen.dk/brugt/bil/toyota');
ok(bbS.length === 2 && bbS[0]?.name === 'Bilhuset Vejle ApS' && bbS[1] === null, 'page Bilbasen (forme supposée) : forhandler gardé, particulier écarté', bbS);

// --- 3. L'annuaire ---------------------------------------------------------------------------
ok(dealerSiteFamily('AUTOSCOUT_NL') === 'autoscout24' && dealerSiteFamily('MOBILE_DE') === 'mobilede' && dealerSiteFamily('MARKTPLAATS') === 'marktplaats' && dealerSiteFamily('LACENTRALE') === 'lacentrale',
  'familles de sites : tous les AutoScout24 = un seul site ; « MOBILE_DE » → mobilede');
ok(isVanSearch('https://www.autoscout24.nl/lst/ford?atype=X') && isVanSearch('https://www.leboncoin.fr/c/utilitaires?u_utility_brand=FORD') && isVanSearch('https://www.subito.it/annunci-italia/vendita/veicoli-commerciali/')
  && isVanSearch('https://www.marktplaats.nl/l/auto-s/bedrijfsauto-s/') && isVanSearch('https://www.coches.net/furgonetas-segunda-mano/') && isVanSearch('https://www.bilbasen.dk/brugt/varebil')
  && !isVanSearch('https://www.autoscout24.fr/lst/ford?atype=C') && !isVanSearch('https://www.leboncoin.fr/recherche?category=2&u_car_brand=FORD') && !isVanSearch(null),
  'pages d\'utilitaires reconnues à leur adresse (AutoScout24, Leboncoin, Subito, Marktplaats, coches.net, Bilbasen)');

const mpListings = coreParseSearchPage(mpJson, 'https://www.marktplaats.nl/lrp/api/search?l1CategoryId=91');
const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const written: Record<string, Array<Record<string, unknown>>> = {};
const client = (rpcError: string | null) => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (rpcError) return { data: null, error: { message: rpcError } };
    const rows = args.p_rows as Array<{ site_dealer_id: string }>;
    return { data: rows.map((r, i) => ({ id: `ada-${i}`, site_dealer_id: r.site_dealer_id })), error: null };
  },
  from: (t: string) => ({
    upsert: (rows: Array<Record<string, unknown>>) => {
      written[t] = rows;
      const res = { data: rows.map((r, i) => ({ id: `old-${i}`, site_dealer_id: r.site_dealer_id })), error: null };
      return Object.assign(Promise.resolve({ error: null }), { select: async () => res });
    },
  }),
});
const n1 = await recordDealerSightings(client(null), mpListings, { site: 'MARKTPLAATS', country: 'NL', sourceUrl: 'https://www.marktplaats.nl/l/auto-s/ford/' });
const sent = (calls[0]?.args.p_rows ?? []) as Array<Record<string, unknown>>;
ok(n1 === 1 && calls[0]?.fn === 'agents_record_dealers' && sent.length === 1 && sent[0].site === 'marktplaats' && sent[0].lat === 51.93 && 'legal_id' in sent[0] && 'website' in sent[0],
  'annuaire : la fonction de la base reçoit le garage (site, position, SIREN, site web)', sent);
ok(written.market_dealer_listings?.length === 1 && written.market_dealer_listings[0].dealer_id === 'ada-0' && written.market_dealer_listings[0].price_eur === 19_950 && !written.market_dealers,
  'annuaire : annonces rattachées à l\'identifiant rendu par la base ; pas d\'écriture directe', written);
delete written.market_dealer_listings;
const n2 = await recordDealerSightings(client('Could not find the function public.agents_record_dealers(p_rows) in the schema cache'), mpListings, { site: 'MARKTPLAATS', country: 'NL' });
ok(n2 === 1 && written.market_dealers?.length === 1 && !('lat' in written.market_dealers[0]) && !('website' in written.market_dealers[0]) && written.market_dealer_listings?.[0].dealer_id === 'old-0',
  'annuaire sans le SQL « tous sites » : écriture d\'avant, sur ses colonnes d\'avant (un site web connu n\'est pas effacé)', written.market_dealers);

// --- 4. La découverte sur chaque site ----------------------------------------------------------
const u = (p: Parameters<typeof discoveryUrl>[0]) => { try { return discoveryUrl(p); } catch (e) { return `ERREUR ${(e as Error).message}`; } };
ok(u({ site: 'MARKTPLAATS', country: 'NL', brand: 'Toyota' }).startsWith('https://www.marktplaats.nl/l/auto-s/toyota/'), 'découverte : Marktplaats Toyota', u({ site: 'MARKTPLAATS', country: 'NL', brand: 'Toyota' }));
ok(u({ site: 'GASPEDAAL', country: 'NL', brand: 'Toyota' }).startsWith('https://www.gaspedaal.nl/toyota'), 'découverte : Gaspedaal Toyota');
ok(u({ site: 'LEBONCOIN', country: 'FR', brand: 'Toyota' }).includes('u_car_brand=TOYOTA'), 'découverte : Leboncoin Toyota');
ok(u({ site: 'BILBASEN', country: 'DK', brand: 'Toyota' }).startsWith('https://www.bilbasen.dk/brugt/bil/toyota'), 'découverte : Bilbasen Toyota (Danemark, sans AutoScout24)');
ok(u({ site: 'JOFOGAS', country: 'HU', brand: 'Suzuki' }).startsWith('https://auto.jofogas.hu/magyarorszag/auto/suzuki'), 'découverte : Jófogás Suzuki');
ok(/ne connaît pas encore la marque/.test(u({ site: 'COCHES', country: 'ES', brand: 'Zzzmarque' })), 'découverte : marque pas encore apprise sur le site → refusée (on ne lit pas tout le site)');
ok(/AutoScout24 seulement/.test(u({ site: 'MARKTPLAATS', country: 'NL', brand: 'Ford', vans: true })), 'découverte : utilitaires hors AutoScout24 → refusés');
ok(/ne couvre pas ce pays/.test(u({ site: 'LEBONCOIN', country: 'NL', brand: 'Toyota' })), 'découverte : un site hors de son pays → refusé');
ok(u({ country: 'FR', brand: 'Toyota' }).includes('autoscout24.fr/lst/toyota') && discoverySiteKey({ country: 'fr' }) === 'AUTOSCOUT_FR' && discoverySiteKey({ site: 'mobile_de', country: 'DE' }) === 'MOBILE_DE',
  'découverte : AutoScout24 par défaut (anciennes tâches sans site)');
ok(!DISCOVERY_SITES.LT && DISCOVERY_SITES.FR.length === 3, 'sites : Skelbiu absent (ses pages ne donnent pas le vendeur), trois sites en France');

const pairs = discoveryPairs(['NL', 'DK', 'fr'], ['Toyota'], ['Ford']);
const key = (p: { site: string; country: string; vans: boolean }) => `${p.site}:${p.country}${p.vans ? ':van' : ''}`;
ok(JSON.stringify(pairs.map(key)) === JSON.stringify(['AUTOSCOUT:NL', 'AUTOSCOUT:NL:van', 'BILBASEN:DK', 'AUTOSCOUT:FR:van', 'AUTOSCOUT:FR', 'MARKTPLAATS:NL', 'LEBONCOIN:FR', 'GASPEDAAL:NL', 'LACENTRALE:FR']),
  'rotation : chaque site de chaque pays, AutoScout24 d\'abord ; utilitaires sur AutoScout24 seulement', pairs.map(key));
const next = nextDiscoveryPair(pairs, [
  { params: { country: 'NL', brand: 'Toyota' }, created_at: '2026-10-16T08:00:00Z' },
  { params: { country: 'NL', brand: 'Ford', vans: true }, created_at: '2026-10-16T09:00:00Z' },
], (p) => p.site !== 'BILBASEN');
ok(next?.site === 'AUTOSCOUT' && next.country === 'FR' && next.vans, 'rotation : une ancienne tâche sans site compte pour AutoScout24 ; une découverte impossible est sautée', next);

// --- 5. La qualification d'un garage vu hors d'AutoScout24 ------------------------------------
const fit = fitScore({ country: 'NL', targetCountries: ['NL'], targets: DEFAULT_ADA_TARGETS, listings: [], opportunities: 0, nbBrands: 1, hasEmail: false, hasNamedContact: false });
const pr = qualifyPrompt({
  dealer: { name: 'Tesselaar BV', country: 'NL', city: 'Hoorn', zip: null, street: null, phone: null, contactName: null, sources: ['Marktplaats', 'Gaspedaal'], legalId: null },
  fit, stock: { listings: 3, brands: ['TOYOTA'], vans: 0, medianPrice: 24_900, opportunities: [] }, page: null, emailsFound: [], pages: [], webSearch: true,
});
ok(pr.includes('Annonces vues sur : Marktplaats, Gaspedaal') && pr.includes('(pas de fiche AutoScout24 : garage vu sur Marktplaats, Gaspedaal)') && pr.includes('cherche sur le web'),
  'consigne : sources du garage, pas de fiche AutoScout24, recherche web demandée');
const pr2 = qualifyPrompt({ dealer: { name: 'GARAGE MARTIN', country: 'FR', city: 'Lyon', zip: '69003', street: null, phone: '0472000000', contactName: null, sources: ['Leboncoin'], legalId: '123456789' }, fit, stock: { listings: 1, brands: [], vans: 0, medianPrice: null, opportunities: [] }, page: null, emailsFound: [], pages: [], webSearch: true });
ok(pr2.includes('Identifiant légal déclaré (SIREN…) : 123456789') && pr2.includes('Téléphone (annonces) : 0472000000'), 'consigne : SIREN et téléphone des annonces');

// --- 6. Ada vend à l'export (17/10 : « Ada est censée trouver des acheteurs, pas des vendeurs ! ») --------
ok(JSON.stringify(buyerCountries(['FR', 'nl', 'DK', 'NL'])) === '["NL","DK"]', 'pays d\'Ada : jamais la France (pays d\'achat), sans doublon', buyerCountries(['FR', 'nl', 'DK', 'NL']));
ok(JSON.stringify(buyerCountries(['FR'])) === JSON.stringify(EXPORT_MARKETS) && JSON.stringify(buyerCountries([])) === JSON.stringify(EXPORT_MARKETS), 'pays d\'Ada : nos marchés d\'export quand il ne reste rien', buyerCountries(['FR']));
ok(/HORS DE FRANCE/.test(ADA_IDEAL_BUYER) && /tout garage installé en France/.test(ADA_IDEAL_BUYER) && /flotte d'entreprise qui renouvelle/.test(ADA_IDEAL_BUYER), 'consigne d\'Ada : acheteurs hors de France, flottes qui renouvellent leur parc');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}
