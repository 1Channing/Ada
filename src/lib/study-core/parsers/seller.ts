/**
 * LE GARAGE D'UNE ANNONCE, SUR TOUS LES SITES (17/10, Channing : « fais tous
 * les sites directement »). Chaque site range le vendeur à sa façon ; ces
 * lecteurs rendent la même fiche (ListingSeller) pour l'annuaire d'Ada.
 * Professionnels seulement : un particulier n'est jamais un acheteur.
 *
 * Formes PROUVÉES sur pages réelles (17/10) :
 * - coches.net : seller {name, isProfessional, contractId}, location
 *   {cityLiteral, mainProvince}, phone (33 pros sur 33 nommés).
 * - Blocket : docs du state React-Query — org_id, organisation_name,
 *   dealer_segment « Företag » / « Privat », location (ville), coordinates.
 * - Jófogás : adList.ads — company_ad, company_name, account_list_id,
 *   profileData {user_name, account_type:'pro'}, latitude / longitude.
 * - Marktplaats : sellerInformation {sellerId, sellerName, sellerLogoUrl,
 *   sellerWebsiteUrl}, traits DEALER_* / COMPANY_*, location {cityName,
 *   latitude, longitude} (particuliers : prénom seul, sans ces traits).
 * - Gaspedaal : JSON-LD offers.seller {@type AutoDealer, name}.
 * Formes à confirmer sur page lue par le worker : Leboncoin (owner {type,
 * store_id, name, siren}), Subito (advertiser), Bilbasen (seller), La
 * Centrale, mobile.de — la lecture générique cherche le vendeur sous les
 * clés d'usage (seller, dealer, owner, advertiser, contactInfo, customer…).
 * Pur, sans import d'exécution ; testé par test/agents-sites.test.ts.
 */
import type { ListingSeller } from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v === 'string') { const t = v.trim(); return t || null; }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const first = (o: Obj | null | undefined, keys: string[]): string | null => {
  if (!o) return null;
  for (const k of keys) { const v = str(o[k]); if (v) return v; }
  return null;
};

/** Un nom d'entreprise (« Autobedrijf P. Troost & Zonen », « Bilia Nacka Volvo », « MCC AUTO's »). */
const BUSINESS = /\b(auto'?s?|automobiles?|automobielen|autobedrijf|autohaus|autohandel|autocenter|autos?hop|cars?|car ?center|garage|motors?|gmbh|ag|kg|b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|sarl|sas|eurl|s\.?r\.?l\.?|s\.?p\.?a\.?|ltd|aps|a\/s|kft|bt|uab|e\.?v\.?|group|groupe|gruppo|lease|leasing|rent(al)?|vans?|trucks?|bedrijfswagens?|occasions?|dealer|concession(naire)?|centre|center|centro|service|bil(ar|er|hus|handel|center)?|handel|import|export|trading|concesionario|automoviles|automóviles|autosalone|autoveicoli|kereskedés)\b|&|\b(volvo|toyota|ford|renault|peugeot|citro[eë]n|opel|volkswagen|vw|mercedes|bmw|audi|kia|hyundai|skoda|fiat|nissan|suzuki|mazda|dacia|seat|cupra|tesla|mg|byd)\b/i;
export const looksLikeCompany = (name: string | null | undefined): boolean => !!name && BUSINESS.test(name);

const PRO_TYPE = /^(pro|professional|professionnel|profesional|professionale|dealer|autodealer|h[äa]endler|händler|concessionnaire|company|business|f[öo]retag|forhandler|handlare|bedrijf|kereskedés|commerciante|empresa|pro_seller)$/i;
const PRIVATE_TYPE = /^(private?|privat|particulier|part|particular|privato|privé|prive|mag[aá]nszem[eé]ly|privatperson|privatanbieter|private_seller|privado)$/i;

/** Pays d'un libellé de site (« Nederland », « België »…) → ISO. */
const COUNTRY_OF: Record<string, string> = {
  nederland: 'NL', netherlands: 'NL', belgie: 'BE', 'belgië': 'BE', belgique: 'BE', belgium: 'BE', deutschland: 'DE', germany: 'DE',
  france: 'FR', espana: 'ES', 'españa': 'ES', italia: 'IT', danmark: 'DK', sverige: 'SE', magyarorszag: 'HU', 'magyarország': 'HU', lietuva: 'LT',
};
const isoOf = (c: string | null) => (c ? COUNTRY_OF[c.trim().toLowerCase()] ?? (/^[A-Z]{2}$/.test(c.trim()) ? c.trim() : null) : null);

/** Identifiant de repli quand le site ne donne que le nom (Gaspedaal). */
export const nameId = (name: string) => `n:${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')}`;

/** Un lien de suivi publicitaire (admarkt de Marktplaats…) n'est pas le site du garage. */
const TRACKING = /admarkt\.|\/bside\/url\/|doubleclick|googleadservices|\/redirect\b/i;

function finish(s: Omit<Partial<ListingSeller>, 'id' | 'name'> & { id: string | null; name: string | null }): ListingSeller | null {
  if (!s.name) return null;
  const name = s.name.replace(/\s+/g, ' ').trim().slice(0, 200);
  // 0,0 = position inconnue (Marktplaats « Action Lease »), pas le golfe de Guinée.
  const noPlace = !s.lat && !s.lng;
  if (s.website && TRACKING.test(s.website)) s = { ...s, website: null };
  return {
    id: s.id || nameId(name), name,
    contactName: s.contactName ?? null, siteUrl: s.siteUrl ?? null, imprintUrl: s.imprintUrl ?? null,
    phone: s.phone ?? null, country: s.country ?? null, zip: s.zip ?? null, city: s.city ?? null, street: s.street ?? null,
    website: s.website && /^https?:\/\//i.test(s.website) ? s.website : s.website ? `https://${s.website.replace(/^\/+/, '')}` : null,
    lat: noPlace ? null : s.lat ?? null, lng: noPlace ? null : s.lng ?? null, legalId: s.legalId ?? null,
  };
}

/** « DE-91325 Adelsdorf », « 75011 Paris », « Linköping » → code postal et ville. */
function splitPlace(raw: string | null): { zip: string | null; city: string | null; country: string | null } {
  if (!raw) return { zip: null, city: null, country: null };
  const m = raw.trim().match(/^(?:([A-Z]{2})[- ])?(\d{4,5}(?:\s?[A-Z]{2})?)\s+(.+)$/);
  return m ? { zip: m[2], city: m[3].trim(), country: m[1] ?? null } : { zip: null, city: raw.trim(), country: null };
}

/** Où se trouve l'annonce (ville, code postal, GPS), quelle que soit la forme du site. */
function placeOf(ad: Obj): Pick<ListingSeller, 'city' | 'zip' | 'lat' | 'lng' | 'country'> {
  const loc = isObj(ad.location) ? ad.location : null;
  const geo = isObj(ad.geo) ? ad.geo : null;
  // Subito : geo.map {latitude, longitude} ; Blocket : coordinates {lat, lon}.
  const coords = isObj(ad.coordinates) ? ad.coordinates : geo && isObj(geo.map) ? geo.map : null;
  const geoVal = (k: string) => (geo && isObj(geo[k]) ? str((geo[k] as Obj).value) : null);
  const flat = splitPlace(typeof ad.location === 'string' ? str(ad.location) : null);
  return {
    city: first(loc, ['city', 'cityName', 'cityLiteral', 'city_label', 'town', 'locality']) ?? geoVal('town') ?? geoVal('city') ?? flat.city,
    zip: first(loc, ['zipcode', 'zipCode', 'zip', 'postalCode', 'postcode', 'zip_code']) ?? flat.zip,
    lat: num(loc?.lat ?? loc?.latitude ?? coords?.lat ?? coords?.latitude ?? ad.latitude),
    lng: num(loc?.lng ?? loc?.lon ?? loc?.longitude ?? coords?.lon ?? coords?.lng ?? coords?.longitude ?? ad.longitude),
    country: isoOf(first(loc, ['countryName', 'countryCode', 'country'])) ?? flat.country,
  };
}

const CONTAINERS = ['seller', 'dealer', 'owner', 'advertiser', 'sellerInformation', 'sellerInfo', 'contactInfo', 'contact', 'customer', 'vendor', 'organisation', 'organization', 'company', 'shop', 'store', 'account', 'profileData', 'publisher', 'merchant'];
const ID_KEYS = ['sellerId', 'dealerId', 'customerId', 'storeId', 'store_id', 'contractId', 'orgId', 'org_id', 'companyId', 'accountId', 'account_id', 'userId', 'user_id', 'id', 'uuid'];
const NAME_KEYS = ['companyName', 'company_name', 'organisationName', 'organisation_name', 'organizationName', 'dealerName', 'sellerName', 'storeName', 'store_name', 'shopName', 'displayName', 'name', 'title'];
const TYPE_KEYS = ['type', 'sellerType', 'seller_type', 'account_type', 'accountType', 'customerType', 'kind', 'segment', 'dealer_segment', 'typeLocalized', '@type'];
const PRO_FLAGS = ['isPro', 'is_pro', 'isProfessional', 'professional', 'isDealer', 'is_dealer', 'company', 'isCompany', 'company_ad', 'isBusiness'];
const PHONE_KEYS = ['phone', 'phoneNumber', 'phone_number', 'telephone', 'tel', 'mobile', 'callTo'];
const WEB_KEYS = ['website', 'websiteUrl', 'sellerWebsiteUrl', 'homepage', 'homepageUrl', 'webUrl'];
// À plat sur l'annonce (Blocket, Jófogás) : jamais « id » ni « name » de l'annonce elle-même.
const FLAT_ID_KEYS = ['org_id', 'account_list_id', 'sellerId', 'dealerId', 'customerId', 'store_id', 'storeId', 'contractId'];
const FLAT_NAME_KEYS = ['organisation_name', 'company_name', 'companyName', 'dealerName', 'sellerName', 'organisationName', 'customerName', 'customerDisplayName'];

/** Lecture générique : le vendeur sous une clé d'usage, ou à plat sur l'annonce. */
export function genericSeller(adRaw: unknown, hint: { type?: string | null; pro?: boolean | null } = {}): ListingSeller | null {
  if (!isObj(adRaw)) return null;
  const ad = adRaw;
  const box = CONTAINERS.map((k) => ad[k]).find(isObj) as Obj | undefined;
  const id = (box ? first(box, ID_KEYS) : null) ?? first(ad, FLAT_ID_KEYS);
  let name = (box ? first(box, NAME_KEYS) : null) ?? first(ad, FLAT_NAME_KEYS);
  if (name && /^(pro|private?|dealer|particulier)$/i.test(name)) name = null;
  // Pro ou particulier : drapeau, type déclaré, indice du site, puis le nom.
  let pro: boolean | null = hint.pro ?? null;
  for (const o of [box, ad]) {
    if (!o) continue;
    for (const k of PRO_FLAGS) if (typeof o[k] === 'boolean') { pro = o[k] as boolean; break; }
    if (pro !== null) break;
  }
  if (pro === null) {
    const type = (box ? first(box, TYPE_KEYS) : null) ?? first(ad, ['sellerType', 'seller_type', 'dealer_segment', 'customerType', 'st']) ?? hint.type ?? null;
    if (type && PRO_TYPE.test(type)) pro = true;
    else if (type && PRIVATE_TYPE.test(type)) pro = false;
  }
  if (pro === false) return null;
  if (pro === null && !looksLikeCompany(name)) return null;
  const place = placeOf(ad);
  const boxPlace = box ? placeOf(box) : null;
  return finish({
    id, name,
    contactName: box ? first(box, ['contactName', 'user_name', 'userName', 'contact_name']) : null,
    phone: (box ? first(box, PHONE_KEYS) : null) ?? first(ad, ['phone', 'phoneNumber']),
    website: box ? first(box, WEB_KEYS) : null,
    city: boxPlace?.city ?? place.city, zip: boxPlace?.zip ?? place.zip,
    lat: place.lat ?? boxPlace?.lat ?? null, lng: place.lng ?? boxPlace?.lng ?? null,
    country: boxPlace?.country ?? place.country,
    legalId: box ? first(box, ['siren', 'siret', 'kvk', 'vatNumber', 'vat', 'cvr']) : null,
  });
}

const probed = new Set<string>();
/**
 * Sonde, une fois par site et par processus : une page d'annonces dont aucune
 * n'a nommé son garage. On logge les CLÉS de la 1re annonce et de ses
 * sous-objets — jamais leurs valeurs — pour reconnaître dans worker_logs la
 * forme du vendeur sur les sites pas encore relevés (Leboncoin, Subito,
 * Bilbasen, La Centrale, mobile.de).
 */
export function probeSellerShape(site: string, ad: unknown): void {
  if (probed.has(site) || !isObj(ad)) return;
  probed.add(site);
  const nested = Object.entries(ad).filter(([, v]) => isObj(v)).slice(0, 15)
    .map(([k, v]) => `${k}{${Object.keys(v as Obj).slice(0, 20).join(',')}}`).join(' ');
  console.warn(`[ANNUAIRE_OBS] ${site} : aucune annonce de la page ne nomme son garage — clés : ${Object.keys(ad).slice(0, 50).join(',')} ; objets : ${nested}`.slice(0, 2000));
}

// --- Lecteurs propres à un site (formes prouvées) ------------------------------------

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Marktplaats : sellerInformation + traits de concessionnaire. */
export function marktplaatsSeller(ad: unknown): ListingSeller | null {
  if (!isObj(ad) || !isObj(ad.sellerInformation)) return null;
  const si = ad.sellerInformation;
  const name = str(si.sellerName);
  const id = str(si.sellerId);
  if (!name || !id) return null;
  const traits = Array.isArray(ad.traits) ? ad.traits.map(String) : [];
  const pro = traits.some((t) => /DEALER|COMPANY/.test(t)) || !!str(si.sellerLogoUrl) || !!str(si.sellerWebsiteUrl) || si.showWebsiteUrl === true || looksLikeCompany(name);
  if (!pro) return null;
  const place = placeOf(ad);
  return finish({ id, name, siteUrl: `https://www.marktplaats.nl/u/${slug(name) || 'verkoper'}/${id}/`, website: str(si.sellerWebsiteUrl), ...place });
}

/** Leboncoin : owner {type 'pro', store_id, user_id, name, siren}, location {city, zipcode, lat, lng}. */
export function leboncoinSeller(ad: unknown): ListingSeller | null {
  if (!isObj(ad) || !isObj(ad.owner)) return genericSeller(ad);
  const o = ad.owner;
  if (str(o.type) && !/^pro$/i.test(str(o.type) as string)) return null;
  const name = str(o.name);
  if (!name) return null;
  return finish({ id: str(o.store_id) ?? str(o.user_id), name, legalId: str(o.siren), ...placeOf(ad), country: 'FR' });
}

/** coches.net : seller {name, isProfessional, contractId}, téléphone et ville de l'annonce. */
export function cochesSeller(it: unknown): ListingSeller | null {
  if (!isObj(it)) return null;
  const s = isObj(it.seller) ? it.seller : null;
  if (!s || (it.isProfessional === false && s.isProfessional !== true)) return null;
  const loc = isObj(it.location) ? it.location : null;
  return finish({ id: str(s.contractId) ?? str(s.id), name: str(s.name), phone: str(it.phone), city: str(loc?.cityLiteral) ?? str(loc?.mainProvince), country: 'ES' });
}

/** Blocket : docs du state React-Query (org_id, organisation_name, dealer_segment). */
export function blocketSeller(doc: unknown): ListingSeller | null {
  if (!isObj(doc)) return null;
  if (!/f[öo]retag/i.test(str(doc.dealer_segment) ?? '')) return null;
  const c = isObj(doc.coordinates) ? doc.coordinates : null;
  return finish({ id: str(doc.org_id), name: str(doc.organisation_name), city: str(doc.location), lat: num(c?.lat), lng: num(c?.lon), country: 'SE' });
}

/** Jófogás : company_ad, company_name, account_list_id, profileData, paramètres code postal / ville. */
export function jofogasSeller(ad: unknown): ListingSeller | null {
  if (!isObj(ad)) return null;
  const prof = isObj(ad.profileData) ? ad.profileData : null;
  if (ad.company_ad !== true && str(prof?.account_type) !== 'pro') return null;
  const params = Array.isArray(ad.parameters) ? ad.parameters.filter(isObj) : [];
  const param = (key: string, field: 'value' | 'label') => {
    const p = params.find((x) => x.key === key);
    const v = Array.isArray(p?.values) && isObj(p.values[0]) ? (p.values[0] as Obj)[field] : null;
    return str(v);
  };
  return finish({
    id: str(ad.account_list_id), name: str(ad.company_name) ?? str(prof?.company_name), contactName: str(prof?.user_name),
    zip: param('zipcode', 'value'), city: param('city', 'label') ?? (isObj(ad.region) ? str(ad.region.label) : null),
    lat: num(ad.latitude), lng: num(ad.longitude), country: 'HU',
  });
}

/**
 * Gaspedaal : JSON-LD offers.seller (AutoDealer, nom ; adresse si présente).
 * `dealerUrl` : le lien du portail « dealer » de l'annonce (redirection
 * api.gaspedaal.nl vers la fiche chez le garage, preuve 07/09) — gardé comme
 * page du garage : la qualification le suit pour trouver son site.
 */
export function gaspedaalSeller(item: unknown, dealerUrl?: string | null): ListingSeller | null {
  if (!isObj(item) || !isObj(item.offers) || !isObj(item.offers.seller)) return null;
  const s = item.offers.seller;
  if (str(s['@type']) && !/dealer|organization|autodealer|localbusiness/i.test(str(s['@type']) as string)) return null;
  const a = isObj(s.address) ? s.address : null;
  return finish({
    id: null, name: str(s.name), city: str(a?.addressLocality), zip: str(a?.postalCode), street: str(a?.streetAddress), phone: str(s.telephone), country: 'NL',
    siteUrl: dealerUrl && /^https:\/\/api\.gaspedaal\.nl\/redirect\//.test(dealerUrl) ? dealerUrl : null,
  });
}
