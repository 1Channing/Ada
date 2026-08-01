/**
 * Bilbasen (DK) site adapter.
 *
 * Migrated as-is from the pre-refactor:
 *   - src/lib/linkgen/templates.ts (BILBASEN template/domain/country)
 *   - src/lib/linkgen/mappings.ts (BILBASEN brand/model/fuel maps)
 *   - src/lib/linkgen/generator.ts (BILBASEN branch of generateSearchUrl)
 *   - src/lib/linkgen/siteValidators/bilbasenValidator.ts (validateBilbasen)
 *   - src/lib/linkgen/correctionStrategies.ts (bilbasenHypotheses)
 *
 * No behavior change intended — see ADA architecture discussion, 2026-07-15.
 * Note: the Bilbasen template has no {trim} placeholder (trim was never
 * injected for this site pre-refactor) — preserved as-is, not a new gap.
 */

import { parseListings } from '../parsers/bilbasen';
import { normalizeForMatch } from './normalizer';
import { resolveYearRange } from './urlTemplate';
import { defaultBuildPaginatedUrl } from './registry';
import { decomposeUrl } from './urlDecompose';
import type {
  SiteAdapter,
  SearchCriteria,
  BuildUrlResult,
  SiteValidationResult,
  SampleListing,
  AppliedFilters,
  LinkGenIssue,
  ZyteProfileOverrides,
  CandidateSegment,
} from './types';

const URL_TEMPLATE =
  'https://www.bilbasen.dk/brugt/bil' +
  '?make={brand}' +
  '&model={model}' +
  '&yearfrom={yearFrom}' +
  '&yearto={yearTo}' +
  '&mileageto={mileage}' +
  '&fuel={fuel}' +
  '&hpfrom={powerFrom}' +
  '&sortby=price&sortorder=asc';

const BRAND_MAP: Record<string, string> = {
  TOYOTA: 'Toyota',
  BMW: 'BMW',
  // Path /brugt/bil/mercedes-benz/... silently falls back to the ALL-CARS page
  // (campaign scrape titled "Køb brugte biler" returned Fiat 500e's for a CLA
  // query → confirmed=[]). The site's brand slug is plain 'mercedes'.
  MERCEDES: 'Mercedes',
  // Graphies alternatives vues dans les critères (dossiers 20/07 : slug
  // 'mercedes-benz' → page toutes-marques, "brand (MERCEDES-BENZ) : 0/60").
  'MERCEDES-BENZ': 'Mercedes',
  'MERCEDES BENZ': 'Mercedes',
  // Native path slug is 'vw' (human URL /brugt/bil/vw/ms-tiguan-serie), and
  // reverseLookup maps a pasted 'vw' back to VOLKSWAGEN for the prefill.
  VOLKSWAGEN: 'VW',
  AUDI: 'Audi',
  PEUGEOT: 'Peugeot',
  RENAULT: 'Renault',
  FORD: 'Ford',
  HONDA: 'Honda',
  NISSAN: 'Nissan',
  HYUNDAI: 'Hyundai',
  KIA: 'Kia',
  VOLVO: 'Volvo',
  SKODA: 'Skoda',
  SEAT: 'Seat',
  CITROEN: 'Citroen',
  OPEL: 'Opel',
};

const MODEL_MAP: Record<string, string> = {
  RAV4: 'RAV4',
  'RAV 4': 'RAV4',
  // Graphie AS24 : /toyota/rav-4?fuel=6 servait des pages Yaris (dossiers 20/07).
  'RAV-4': 'RAV4',
  YARIS: 'Yaris',
  COROLLA: 'Corolla',
  CAMRY: 'Camry',
  PRIUS: 'Prius',
  'C-HR': 'C-HR',
  CHR: 'C-HR',
  // Bilbasen groups the Golf under a SERIES page: /brugt/bil/vw/golf is an
  // invalid slug the site silently falls back from (brand-wide "VW - 384
  // brugte" mixing ID.4s → model 0/100 in campaigns). Human-confirmed slug:
  // /brugt/bil/vw/ms-golf-serie ("VW Golf-Serie" page). reverseLookup maps it
  // back to GOLF for URL prefill.
  GOLF: 'ms-golf-serie',
  POLO: 'Polo',
  PASSAT: 'Passat',
  '3 SERIES': '3',
  '5 SERIES': '5',
  'A-CLASS': 'A-Klasse',
  'C-CLASS': 'C-Klasse',
  'E-CLASS': 'E-Klasse',
  // French Mercedes naming (Leboncoin-learned models) → Danish native
  'CLASSE A': 'A-Klasse',
  'CLASSE B': 'B-Klasse',
  'CLASSE C': 'C-Klasse',
  'CLASSE E': 'E-Klasse',
  'CLASSE S': 'S-Klasse',
  'CLASSE V': 'V-Klasse',
  'CLASSE CLA': 'CLA',
  'CLASSE CLS': 'CLS',
  'CLASSE GLA': 'GLA',
  'CLASSE GLB': 'GLB',
  'CLASSE GLC': 'GLC',
  'CLASSE GLE': 'GLE',
};

// Codes fuel NUMÉRIQUES — les labels texte ('Hybrid', 'El', 'Benzin') sont
// IGNORÉS en silence par le site (rapport 20/07 : fuel=Hybrid sur Aygo X →
// 49× Benzin / 49× Hybrid mélangés). Vérifiés : '6' = Hybrid (URL live
// Channing 20/07), '3' = El (ingestion 89/89). '1'/'2' suivent la séquence
// classique Benzin/Diesel — à confirmer par échantillon : un code faux donne
// un échantillon hors-sujet que l'analyse REJETTE, jamais un silence.
const FUEL_MAP: Record<string, string> = {
  ESSENCE: '1',
  GASOLINE: '1',
  PETROL: '1',
  DIESEL: '2',
  ELECTRIQUE: '3',
  ELECTRIC: '3',
  HYBRIDE: '6',
  HYBRID: '6',
  PLUG_IN_HYBRID: '',
  GPL: '',
};

const UNSUPPORTED_PARAMS: string[] = [];

function mapBrand(raw: string): string {
  return BRAND_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

function mapModel(raw: string): string {
  return MODEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

// ─── Slugs modèle APPRIS des annonces (moisson, 28/07) ───────────────────────
// La sonde [BILBASEN_TAXO] (dump réel du 28/07 16:54) a prouvé que chaque
// annonce embarque son URI avec les slugs EXACTS du site :
// dehydratedState.queries[].state.data.listings[].uri =
// "https://www.bilbasen.dk/brugt/bil/leapmotor/t03/41-design-5d/6897749"
// → marque 'leapmotor', modèle 't03'. Chaque scrape apprend les slugs des
// modèles affichés ; réinjectés ici, prioritaires sur la dérivation naïve
// (les Classes Mercedes prouvées par URL humaine gardent le dernier mot).
const LEARNED_MODEL_SLUG: Record<string, string> = {};
const canonSlug = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function harvestTaxonomy(html: string): Array<{ field: string; code: string; label: string }> {
  const out: Array<{ field: string; code: string; label: string }> = [];
  try {
    const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return out;
    const queries = JSON.parse(m[1])?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return out;
    const seen = new Set<string>();
    for (const q of queries) {
      const listings = (q as { state?: { data?: { listings?: unknown } } })?.state?.data?.listings;
      if (!Array.isArray(listings)) continue;
      for (const l of listings as Array<{ uri?: unknown; model?: unknown }>) {
        if (typeof l?.uri !== 'string') continue;
        const um = l.uri.match(/\/brugt\/bil\/([a-z0-9._-]+)\/([a-z0-9._-]+)\//);
        if (!um) continue;
        const [, brandSlug, modelSlug] = um;
        const code = `${brandSlug};${modelSlug}`;
        if (seen.has(code)) continue;
        seen.add(code);
        const label = typeof l.model === 'string' && l.model.trim()
          ? l.model.trim()
          : typeof (l.model as { name?: unknown } | null)?.name === 'string'
            ? String((l.model as { name: string }).name).trim()
            : modelSlug.replace(/_/g, ' ');
        out.push({ field: 'bb:model', code, label });
      }
    }
    // Filtres énumérés de la page (sonde [BILBASEN_TAXO] 29/07) :
    // data.filterOptions[].filterOptions[] = { key, optionValues:[{name,value}] }.
    // Les filtres à plage (prix, km) n'ont pas d'optionValues — ignorés d'office.
    const seenF = new Set<string>();
    for (const q of queries) {
      const groups = (q as { state?: { data?: { filterOptions?: unknown } } })?.state?.data?.filterOptions;
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const filters = (g as { filterOptions?: unknown })?.filterOptions;
        if (!Array.isArray(filters)) continue;
        for (const f of filters as Array<{ key?: unknown; optionValues?: unknown }>) {
          const key = typeof f?.key === 'string' ? f.key.trim() : '';
          if (!key || !Array.isArray(f.optionValues)) continue;
          for (const ov of f.optionValues as Array<{ name?: unknown; value?: unknown }>) {
            const code = typeof ov?.value === 'string' ? ov.value.trim()
              : typeof ov?.value === 'number' ? String(ov.value) : '';
            if (!code) continue;
            const dedup = `${key}|${code}`;
            if (seenF.has(dedup)) continue;
            seenF.add(dedup);
            const label = typeof ov?.name === 'string' && ov.name.trim() ? ov.name.trim() : code;
            out.push({ field: `bb:filter:${key}`, code, label });
          }
        }
      }
    }
  } catch { /* moisson silencieuse — jamais bloquante */ }
  return out;
}

function learnEnumValues(field: string, pairs: Array<{ code: string; label: string }>): void {
  if (field !== 'bb:model') return;
  for (const p of pairs) {
    const [, modelSlug] = p.code.split(';');
    if (!modelSlug) continue;
    // Indexé par label ET par slug canonisé ('yaris_cross' ≡ 'YARIS CROSS').
    for (const k of [canonSlug(p.label), canonSlug(modelSlug)]) {
      if (k && !LEARNED_MODEL_SLUG[k]) LEARNED_MODEL_SLUG[k] = modelSlug;
    }
  }
}

function mapFuel(raw: string): string {
  return FUEL_MAP[raw.trim().toUpperCase()] ?? raw.trim();
}

/**
 * Bilbasen path slug — VÉRIFIÉ sur URL live (Channing 20/07) :
 * /brugt/bil/toyota/yaris_cross → minuscules, ESPACES → '_' (les tirets des
 * vrais noms restent). L'ancienne règle (espaces → '-') produisait
 * 'yaris-cross', slug invalide que le site remplaçait EN SILENCE par la page
 * marque entière (des Aygo dans une étude Yaris Cross).
 */
function pathSlug(raw: string): string {
  // Translittération AVANT le filtre ascii : « Mégane » → 'megane' — sans elle
  // le é était SUPPRIMÉ ('mgane', slug inconnu → page marque entière, 27/07).
  return raw.normalize('NFD').replace(/\p{M}/gu, '')
    .trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '');
}

/**
 * Slug des Classes Mercedes chez Bilbasen : `ms-{code}-klasse` — PROUVÉ par
 * URL humaine (Channing 26/07) : /brugt/bil/mercedes/ms-cla-klasse. Même
 * famille préfixée que 'ms-golf-serie' (VW). Les codes non vérifiés héritent
 * du schéma ; le détecteur de repli silencieux (clé Model dans
 * initialSearchRequest) tranche et les sondes corrigent si un code dévie.
 */
function mercedesModelSlug(brand: string | undefined, model: string): string | null {
  // Un modèle déjà en forme slug (tout minuscule — candidats de sonde H0,
  // 'e-klasse'/'ms-x-klasse') passe tel quel par pathSlug, sans re-mapping.
  const t = model.trim();
  if (/[a-z]/.test(t) && !/[A-Z]/.test(t)) return null;
  const up = t.toUpperCase();
  const isMercedes = String(brand ?? '').trim().toUpperCase().includes('MERCEDES');
  const code = (up.match(/^(?:CLASSE|CLASE|CLASS)\s+([A-Z]{1,3})$/) ?? up.match(/^([A-Z]{1,3})[- ]?(?:CLASS|KLASSE)$/))?.[1]
    ?? (isMercedes && /^[A-Z]{1,3}$/.test(up) ? up : null);
  return code ? `ms-${code.toLowerCase()}-klasse` : null;
}

function buildSearchUrl(params: SearchCriteria): BuildUrlResult {
  const warnings: string[] = [];

  // Brand/model go in the PATH — campaign #6 (Tiguan) proved the site silently
  // IGNORES ?make=&model= query params ("Diesel - 5864 brugte", mixed brands).
  // The native form /brugt/bil/{brand}/{model} is the site's own filter
  // (human-confirmed with /brugt/bil/skoda/elroq).
  const brandSlug = pathSlug(mapBrand(params.brand || ''));
  const mercSlug = params.model ? mercedesModelSlug(params.brand, String(params.model)) : null;
  // Mercedes (URL humaine) > slug APPRIS des annonces du site > dérivation naïve.
  const modelSlug = mercSlug
    ?? (params.model ? LEARNED_MODEL_SLUG[canonSlug(params.model)] : undefined)
    ?? pathSlug(mapModel(params.model || ''));
  const segs = ['https://www.bilbasen.dk/brugt/bil'];
  if (brandSlug) segs.push(brandSlug);
  if (brandSlug && modelSlug) segs.push(modelSlug);

  const qs = new URLSearchParams();
  const { yearFrom, yearTo } = resolveYearRange(params);
  if (yearFrom) qs.set('yearfrom', yearFrom);
  if (yearTo) qs.set('yearto', yearTo);
  if (params.mileage) qs.set('mileageto', String(params.mileage));
  // Only inject fuel if mapping produced a non-empty value (GPL maps to '' for Bilbasen)
  const mappedFuel = params.fuel ? mapFuel(params.fuel) : null;
  if (mappedFuel && mappedFuel.trim()) qs.set('fuel', mappedFuel);
  // Texte libre `free=` — PROUVÉ URL humaine (Channing 27/07 :
  // ?free=gr+sport sur yaris_cross). La finition passe par là, jamais en
  // critère structuré.
  if (params.trim && params.trim.trim()) qs.set('free', params.trim.trim());
  // Native param `hpfrom` — human-confirmed (ingestion 89/89 with hpfrom=250).
  const power = params.powerFrom ?? params.minPower;
  if (power !== undefined && String(power).trim()) qs.set('hpfrom', String(power));
  // Miroir de l'usage réel (URL live Channing 20/07) : pas d'offres leasing
  // (mensualités qui polluent les prix), engros inclus (le garde-fou
  // isRetailPrice les écarte déjà des médianes à l'écriture).
  qs.set('includeengroscvr', 'true');
  qs.set('includeleasing', 'false');
  qs.set('sortby', 'price');
  qs.set('sortorder', 'asc');

  return { url: `${segs.join('/')}?${qs.toString()}`, warnings };
}

// H1: fuel suspect → drop fuel; else regenerate structured
// H2: brand+model only
function generateCorrectionHypotheses(
  params: SearchCriteria,
  issueTypes: Set<string>
): Array<{ url: string; reason: string }> {
  const result: Array<{ url: string; reason: string }> = [];

  // H0 — Mercedes model slug probe: /mercedes/cla silently served the
  // brand-wide page (EQAs inside a CLA study — daily report 19/07). Bilbasen
  // likely uses the Danish '<code>-klasse' form; a wrong slug never 404s,
  // it falls back to the whole brand, so only a probe can settle it.
  if (issueTypes.has('model_missing')) {
    const raw = String(params.model ?? '').trim().toUpperCase();
    const isMercedes = String(params.brand ?? '').trim().toUpperCase().includes('MERCEDES');
    const code = (raw.match(/^CLASSE\s+([A-Z]{1,3})$/) ?? raw.match(/^([A-Z])-CLASS$/))?.[1]?.toLowerCase()
      ?? (isMercedes && /^[A-Z]{1,3}$/.test(raw) ? raw.toLowerCase() : null);
    if (code) {
      // Le primaire est désormais 'ms-{code}-klasse' (prouvé CLA 26/07) —
      // les sondes essaient les anciennes formes si un code dévie du schéma.
      for (const cand of [`${code}-klasse`, `${code}_klasse`]) {
        const { url } = buildSearchUrl({ ...params, model: cand });
        if (url) result.push({ url, reason: `BILBASEN H0: slug Mercedes '${cand}'` });
      }
    } else {
      // Familles « -Serie » : le facet modèle Bilbasen regroupe les variantes
      // d'une lignée (GOLF → 'ms-golf-serie', prouvé par les logs ; le site
      // affiche « C4-Serie », qui couvre aussi les ë-C4). Deux sondes, la
      // forme préfixée d'abord (précédent Golf).
      const s = String(params.model ?? '').normalize('NFD').replace(/\p{M}/gu, '')
        .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (s && !s.includes('-serie')) {
        for (const cand of [`ms-${s}-serie`, `${s}-serie`]) {
          const { url } = buildSearchUrl({ ...params, model: cand });
          if (url) result.push({ url, reason: `BILBASEN H0: slug famille '${cand}'` });
        }
      }
    }
  }

  if (issueTypes.has('fuel_mapping_suspect') && params.fuel) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H1: fuel removed (mapping suspect)' });
  } else {
    const { url } = buildSearchUrl(params);
    if (url) result.push({ url, reason: 'BILBASEN H1: regenerated structured params brand+model' });
  }

  if (result.length < 2 && (params.fuel || params.trim)) {
    const { url } = buildSearchUrl({ ...params, fuel: undefined, trim: undefined });
    if (url) result.push({ url, reason: 'BILBASEN H2: fuel + trim removed, brand+model only' });
  }

  return result;
}

function inferFuelFromTitle(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  if (text.includes('diesel')) return 'diesel';
  if (text.includes('el') || text.includes('elbil') || text.includes('electr')) return 'electric';
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('benzin') || text.includes('petrol')) return 'petrol';
  if (text.includes('lpg') || text.includes('autogas')) return 'lpg';
  return '';
}

function statusFromScore(score: number): 'valid' | 'partial' | 'invalid' {
  if (score >= 80) return 'valid';
  if (score >= 60) return 'partial';
  return 'invalid';
}

function scoreSample(
  sample: SampleListing[],
  params: SearchCriteria,
  url: string
): { score: number; appliedFilters: AppliedFilters; issues: LinkGenIssue[] } {
  const normBrand = normalizeForMatch(params.brand ?? '');
  const normModel = normalizeForMatch(params.model ?? '');
  const normFuel = params.fuel ? normalizeForMatch(params.fuel) : null;
  const normTrim = params.trim ? normalizeForMatch(params.trim) : null;

  const yearFrom = params.yearFrom ? Number(params.yearFrom) : (params.year ? Number(params.year) : null);
  const yearTo = params.yearTo ? Number(params.yearTo) : null;
  const maxMileage = params.mileage ? Number(params.mileage) : null;

  let brandHit = false;
  let modelHit = false;
  let yearHit = false;
  let mileageHit = false;
  let fuelHit = false;
  let trimHit = false;

  for (const l of sample) {
    const normTitle = normalizeForMatch(l.title);
    if (!brandHit && normBrand && normTitle.includes(normBrand)) brandHit = true;
    if (!modelHit && normModel && normTitle.includes(normModel)) modelHit = true;
    if (!trimHit && normTrim && normTitle.includes(normTrim)) trimHit = true;

    if (!yearHit && l.year !== null) {
      const y = l.year;
      if (yearFrom && yearTo) yearHit = y >= yearFrom && y <= yearTo;
      else if (yearFrom) yearHit = y >= yearFrom;
    }

    if (!mileageHit && l.mileage !== null && maxMileage !== null) {
      mileageHit = l.mileage <= maxMileage;
    }

    if (!fuelHit && normFuel) {
      const listingFuel = normalizeForMatch(l.fuel);
      if (listingFuel && listingFuel.includes(normFuel)) fuelHit = true;
    }
  }

  const sortApplied = url.includes('sort') || url.includes('orderBy') || url.includes('order=');

  let score = 0;
  if (brandHit) score += 20;
  if (modelHit) score += 25;
  if (!yearFrom || yearHit) score += 15;
  if (!maxMileage || mileageHit) score += 15;
  if (!normFuel || fuelHit) score += 15;
  if (!normTrim || trimHit) score += 10;

  const issues: LinkGenIssue[] = [];
  if (!brandHit) issues.push({ type: 'brand_missing' });
  if (!modelHit) issues.push({ type: 'model_missing' });
  if (normFuel && !fuelHit) issues.push({ type: 'fuel_mismatch' });
  if (yearFrom && !yearHit && sample.some((l) => l.year !== null)) issues.push({ type: 'year_filter_not_applied' });
  if (maxMileage && !mileageHit && sample.some((l) => l.mileage !== null)) issues.push({ type: 'mileage_filter_not_applied' });

  if (normTrim && !trimHit && sample.length > 0) {
    issues.push({ type: 'trim_removed_for_broader_market' });
  }

  const appliedFilters: AppliedFilters = {
    brand: brandHit,
    model: modelHit,
    year: !yearFrom || yearHit,
    mileage: !maxMileage || mileageHit,
    fuel: !normFuel || fuelHit,
    trim: !normTrim || trimHit,
    sort: sortApplied,
  };

  return { score, appliedFilters, issues };
}

function scoreSearchResults(
  html: string,
  url: string,
  params: SearchCriteria,
  listingCount: number
): SiteValidationResult {
  const htmlLength = html.length;

  const rawAll = parseListings(html, url);
  const raw = rawAll.slice(0, 10);

  const parsedSampleCount = raw.length;
  const firstCandidateTitle = raw[0]?.title ?? null;
  const extractionMethod = 'context-window anchor regex';

  console.log('[SCOUT_PARSE] BILBASEN', {
    htmlLength,
    parserUsed: 'study-core/parsers/bilbasen',
    rawListingCandidatesCount: rawAll.length,
    parsedSampleCount,
    firstCandidateTitle,
    extractionMethod,
  });

  const structuredFieldsAvailable = raw.some((l) => l.year !== null || l.mileage !== null);
  const fieldsUsed: string[] = ['title'];
  const missingFields: string[] = [];

  if (structuredFieldsAvailable) {
    if (raw.some((l) => l.year !== null)) fieldsUsed.push('year');
    else missingFields.push('year');
    if (raw.some((l) => l.mileage !== null)) fieldsUsed.push('mileage');
    else missingFields.push('mileage');
  } else {
    missingFields.push('year', 'mileage');
    console.log('[SCOUT_PARSE] structured_fields_missing site=BILBASEN url=' + url);
  }

  const sampleListings: SampleListing[] = raw.map((l) => ({
    title: l.title,
    price: l.price,
    year: l.year,
    mileage: l.mileage,
    fuel: inferFuelFromTitle(l.title, l.description),
    url: l.listing_url,
  }));

  const { score, appliedFilters, issues } = scoreSample(sampleListings, params, url);
  const status = statusFromScore(score);

  if (parsedSampleCount === 0 && htmlLength > 100_000) {
    issues.push({ type: 'parser_failed_on_html' });
    console.warn('[SCOUT_PARSE] parser_failed_on_html — htmlLength=' + htmlLength + ' but 0 listings extracted site=BILBASEN');
  }

  return {
    site: 'BILBASEN',
    url,
    listingCount,
    sampleListings,
    appliedFilters,
    score,
    status,
    issues,
    evidence: {
      structuredFieldsAvailable,
      fieldsUsed,
      missingFields,
    },
    parserDetails: {
      htmlLength,
      parserUsed: 'study-core/parsers/bilbasen',
      parsedSampleCount,
      extractionMethod,
    },
  };
}

function getFetchProfile(_attempt: number): ZyteProfileOverrides {
  // No JS-rendering escalation for Bilbasen today — matches pre-refactor
  // getZyteRequestProfile(), which only special-cased Marktplaats.
  return {};
}

// ─── Ingestion support ────────────────────────────────────────────────────────

const FUEL_SITE_TO_LABEL: Record<string, string> = {
  'benzin': 'ESSENCE',
  'diesel': 'DIESEL',
  'el': 'ELECTRIQUE',
  'hybrid': 'HYBRIDE',
  'plugin-hybrid': 'PLUG_IN_HYBRID',
  // Native numeric codes. ONLY human-confirmed codes belong here ('3' proven
  // electric via ingestion 89/89, '6' proven hybrid via live URL 20/07) —
  // unknown codes go through the learned enum dictionary
  // (linkgen_enum_mappings), never guessed. '1'/'2' = séquence classique,
  // à confirmer par échantillon.
  '1': 'ESSENCE',
  '2': 'DIESEL',
  '3': 'ELECTRIQUE',
  '6': 'HYBRIDE',
};

function reverseLookup(map: Record<string, string>, siteValue: string): string {
  const target = siteValue.trim().toLowerCase();
  for (const [canonical, mapped] of Object.entries(map)) {
    if (mapped.toLowerCase() === target) return canonical;
  }
  return siteValue.trim();
}

/**
 * Bilbasen exposes brand/model two ways: ADA-generated URLs put them in the
 * query (`?make=&model=`), but the native search URLs users paste carry them
 * in the PATH — `/brugt/bil/{brand}/{model}[/...]`. Pull them from the path so
 * re-pasting a native URL still pre-fills the form.
 */
function pathBrandModel(segs: string[]): { brand?: string; model?: string } {
  const i = segs.findIndex((s) => s.toLowerCase() === 'bil');
  if (i >= 0 && segs[i + 1]) return { brand: segs[i + 1], model: segs[i + 2] };
  return {};
}

function prefillCriteriaFromUrl(url: string): Partial<SearchCriteria> {
  const d = decomposeUrl(url);
  if (!d) return {};
  const q = d.queryParams;
  const out: Partial<SearchCriteria> = {};

  const path = pathBrandModel(d.pathSegments);
  const rawMake = q['make'] ?? path.brand;
  const rawModel = q['model'] ?? path.model;
  if (rawMake) out.brand = reverseLookup(BRAND_MAP, rawMake);
  if (rawModel) {
    // Slugs de famille : 'ms-cla-klasse' → CLASSE CLA (URL humaine 26/07),
    // 'ms-golf-serie' → GOLF.
    const klasse = rawModel.match(/^ms-([a-z0-9]+)-klasse$/i);
    const serie = rawModel.match(/^(?:ms-)?([a-z0-9-]+)-serie$/i);
    out.model = klasse ? `CLASSE ${klasse[1].toUpperCase()}`
      : serie ? serie[1].toUpperCase().replace(/-/g, ' ')
      : reverseLookup(MODEL_MAP, rawModel);
  }
  if (q['yearfrom'] && /^\d{4}$/.test(q['yearfrom'])) out.yearFrom = q['yearfrom'];
  if (q['yearto'] && /^\d{4}$/.test(q['yearto'])) out.yearTo = q['yearto'];
  // Variante mensuelle du site (URL humaine : regfrom=2023-01&regto=2023-12).
  const regFrom = (q['regfrom'] ?? '').match(/^(\d{4})/);
  const regTo = (q['regto'] ?? '').match(/^(\d{4})/);
  if (!out.yearFrom && regFrom) out.yearFrom = regFrom[1];
  if (!out.yearTo && regTo) out.yearTo = regTo[1];
  if (q['mileageto'] && /^\d+$/.test(q['mileageto'])) out.mileage = q['mileageto'];
  if (q['fuel'] && FUEL_SITE_TO_LABEL[q['fuel'].toLowerCase()]) out.fuel = FUEL_SITE_TO_LABEL[q['fuel'].toLowerCase()];
  if (q['hpfrom'] && /^\d+$/.test(q['hpfrom'])) out.powerFrom = q['hpfrom'];
  if (q['free']) out.trim = q['free'];

  return out;
}

function extractCandidateSegments(url: string): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  const q = d.queryParams;
  const out: CandidateSegment[] = [];
  const push = (paramName: string, guessField: CandidateSegment['guessField']) => {
    if (q[paramName]) out.push({ raw: q[paramName], location: 'query', paramName, guessField });
  };
  // Native-path brand/model (when not already in query).
  const path = pathBrandModel(d.pathSegments);
  if (!q['make'] && path.brand) out.push({ raw: path.brand, location: 'path', paramName: 'make', guessField: 'brand' });
  if (!q['model'] && path.model) out.push({ raw: path.model, location: 'path', paramName: 'model', guessField: 'model' });
  push('make', 'brand');
  push('model', 'model');
  push('yearfrom', 'year');
  push('yearto', 'year');
  push('mileageto', 'mileage');
  push('fuel', 'fuel');
  push('hpfrom', 'power');
  push('free', 'trim');
  return out;
}

/**
 * Danish fuel detection with word boundaries. Deliberately NOT reusing the
 * Scout-internal inferFuelFromTitle: its `text.includes('el')` matches 'el'
 * inside any word ('model', 'gele'…), which is tolerable for a Scout score
 * but not for a 100%-certainty ingestion decision.
 */
function inferFuel(title: string, description: string): string {
  const text = ` ${(title + ' ' + description).toLowerCase()} `;
  if (/\bdiesel\b/.test(text)) return 'diesel';
  if (/\bplug-?in\b|\bplugin-?hybrid\b|\bphev\b/.test(text)) return 'hybrid';
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bel\b|\belbil\b|\belektrisk\b|\belectric\b/.test(text)) return 'electric';
  if (/\bbenzin\b|\bpetrol\b/.test(text)) return 'petrol';
  if (/\blpg\b|\bautogas\b/.test(text)) return 'lpg';
  return '';
}

/**
 * Verdict déterministe « filtre modèle appliqué ? » — preuve par la sonde
 * [BILBASEN_ISR] (campagne du 26/07) : le NEXT_DATA de chaque page porte
 * `initialSearchRequest.selectedFilters`. Page modèle valide (/vw/id.3) →
 * clé `Model` présente ({values:["ID.3"]}) ; slug inconnu (/mercedes/glc,
 * /mercedes/vito…) → Make/FuelType/ModelYear présents mais AUCUNE clé
 * `Model` : le site a jeté le filtre en silence et sert la marque entière.
 */
/**
 * Vide CONFIRMÉ vs COQUILLE anti-bot — preuve du 01/08 : la mise à jour DK
 * e-tron a reçu 4× une page-squelette (habillage complet, dehydratedState
 * réduit aux listes de villes, initialSearchRequest **null**) et l'a prise
 * pour « 0 annonce » alors que le site en montrait 64. Or TOUTE vraie page de
 * résultats — y compris à 0 voiture (sondes [BILBASEN_ISR] Vauxhall/HiPhi
 * 2026) — porte initialSearchRequest.selectedFilters ET sa query listings.
 *   → ISR absent/null : coquille, PAS un vide (le worker réessaie) ;
 *   → query listings pleine que le parseur n'a pas rendue : structure
 *     changée, pas un vide non plus ;
 *   → ISR présent + listings [] : vide confirmé par le site.
 */
function detectEmptyState(html: string): boolean | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const pp = JSON.parse(m[1])?.props?.pageProps as {
      initialSearchRequest?: { selectedFilters?: unknown } | null;
      dehydratedState?: { queries?: Array<{ state?: { data?: { listings?: unknown } } }> };
    } | undefined;
    if (!pp?.initialSearchRequest?.selectedFilters) return false; // coquille anti-bot
    const queries = pp.dehydratedState?.queries;
    if (Array.isArray(queries)) {
      for (const q of queries) {
        const listings = q?.state?.data?.listings;
        if (Array.isArray(listings)) return listings.length === 0;
      }
    }
    return false; // vraie recherche mais aucune query listings : suspect, pas un vide
  } catch { return null; }
}

function detectSilentFallback(html: string): { modelApplied: boolean; evidence: string } | null {
  const m = html.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const sf = JSON.parse(m[1])?.props?.pageProps?.initialSearchRequest?.selectedFilters as
      Record<string, unknown> | undefined;
    if (!sf || typeof sf !== 'object') return null;
    const model = sf['Model'] as { values?: Array<{ values?: string[] }> } | undefined;
    if (!model) {
      return { modelApplied: false, evidence: `selectedFilters sans clé Model (${Object.keys(sf).join(',')})` };
    }
    const applied = model.values?.flatMap((v) => v.values ?? []).join('+') ?? '?';
    return { modelApplied: true, evidence: `Model=${applied}` };
  } catch {
    return null;
  }
}

export const bilbasenAdapter: SiteAdapter = {
  key: 'BILBASEN',
  displayName: 'Bilbasen',
  country: 'Denmark',
  countryCode: 'DK',
  domain: 'bilbasen.dk',
  urlTemplate: URL_TEMPLATE,

  mapBrand,
  mapModel,
  mapFuel,
  supportsParam: (param) => !UNSUPPORTED_PARAMS.includes(param),

  buildSearchUrl,
  buildPaginatedUrl: defaultBuildPaginatedUrl,

  parseSearchResults: parseListings,

  scoreSearchResults,
  generateCorrectionHypotheses,
  detectSilentFallback,
  detectEmptyState,

  getFetchProfile,
  harvestTaxonomy,
  learnEnumValues,

  prefillCriteriaFromUrl,
  extractCandidateSegments,
  inferFuel,
};
