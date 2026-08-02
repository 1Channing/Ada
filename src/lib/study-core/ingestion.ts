/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INGESTION — discovery-scrape confirmation (PURE, no I/O)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Confirms a user's declared search criteria against a scraped listing
 * sample, field by field. Cardinal retention rule: a field is either
 * confirmed beyond the threshold or discarded entirely — no reduced
 * confidence, no "needs review" state. An absent mapping always beats a
 * doubtful one.
 *
 * Data sources per field, structured first:
 * - year, mileage → the parsers' STRUCTURED fields (ScrapedListing.year /
 *   .mileage), more reliable than title text. Fields not present in enough
 *   listings are rejected for insufficient structured data, never guessed
 *   from text.
 * - brand, model → title text (normalizeForMatch: accent/case/separator safe
 *   across FR/NL/DA).
 * - trim → title + description text.
 * - fuel → per-site language-aware detector (adapter.inferFuel); parsers do
 *   not extract a structured fuel field today (see BACKLOG.md).
 *
 * No price comparison happens here, so site currencies (EUR vs DKK) never
 * enter a confirmation decision. Mileage is expressed in km on all
 * supported sites.
 */

import type { ScrapedListing } from './types';
import type { SearchCriteria, SiteAdapter, CandidateSegment } from './marketplaces/types';
import { normalizeForMatch } from './marketplaces/normalizer';
import { collectCandidateSegments } from './marketplaces/paramDictionary';

// Minimum priced sample to confirm a mapping. Kept low (3) so RARE vehicles —
// often where the best arbitrage margins hide — still get captured. The ≥90%
// coherence rule stays, so at 3 listings all 3 must match: strict but inclusive.
export const INGESTION_MIN_SAMPLE = 3;
export const INGESTION_CONFIRM_THRESHOLD = 0.9;

export type IngestionField =
  | 'brand' | 'model' | 'fuel' | 'year' | 'mileage' | 'trim'
  | 'gearbox' | 'power' | 'doors' | 'seats' | 'color' | 'vehicleType';

/** Secondary fields confirmed against structured listing attributes. */
const SECONDARY_FIELDS: IngestionField[] = ['gearbox', 'power', 'doors', 'seats', 'color', 'vehicleType'];

export interface FieldConfirmation {
  field: IngestionField;
  declaredValue: string;
  status: 'confirmed' | 'rejected';
  matchCount: number;
  /** Denominator actually used (full sample for text fields, structured-field count for year/mileage). */
  sampleSize: number;
  method: 'structured' | 'text';
  /** Set when rejected — the audit reason, human-readable. */
  reason?: string;
}

/** Mirrors linkgen's InferredMapping shape (kept structurally compatible). */
export interface IngestionInferredMapping {
  brandParam?: string;
  modelParam?: string;
  yearFromParam?: string;
  yearToParam?: string;
  mileageParam?: string;
  fuelParam?: string;
  trimParam?: string;
  paramToField: Record<string, string>;
  fieldToParam: Record<string, { paramName: string; rawValue: string }>;
}

export interface IngestionAnalysis {
  confirmations: FieldConfirmation[];
  confirmedFields: IngestionField[];
  rejectedFields: FieldConfirmation[];
  /**
   * The submitted URL, reusable as-is, ONLY when no declared field was
   * rejected. One rejected field means the URL contains an unverified
   * portion — the whole URL is then not trustworthy as a validated_url,
   * even though the confirmed segment↔field pairs are still retained.
   */
  validatedUrl: string | null;
  /** Built from CONFIRMED fields only, each attributed to a URL segment. */
  inferredMapping: IngestionInferredMapping;
  candidateSegments: CandidateSegment[];
}

// ─── Fuel canonicalisation ────────────────────────────────────────────────────
// Canonical fuel tokens shared across the app. Covers the full Leboncoin +
// Marktplaats taxonomies (see the two marketplace energy screens): petrol,
// diesel, electric, hybrid (full HEV, incl. Marktplaats "Hybride
// Elektrisch/Benzine|Diesel"), mild_hybrid (half hybride / MHEV), phev
// (plug-in / hybride rechargeable), hydrogen (waterstof), cng (GNV / aardgas),
// lpg (GPL). Order matters: hybrid variants are tested before 'electric' so
// "Hybride Elektrisch" is never mis-read as electric.

// ES « híbrido enchufable », IT « ibrida ricaricabile », VW badge « GTE ».
const PHEV_TOKENS = /plug\s?in|phev|hybride rechargeable|oplaadbare|\be[\s-]?hybrid|enchufable|ricaricabile|\bgte\b/;
const MILD_HYBRID_TOKENS = /half hybrid|mild hybrid|micro hybrid|\bmhev\b/;

/**
 * Marketplace cards rarely distinguish a PLUG-IN from a full hybrid: Marktplaats
 * and AutoScout both label everything "Hybride"/"Elektro/Benzine", so NO
 * per-listing observation ever canonicalised to 'phev' — the dashboard showed
 * zero rechargeable data for whole countries. The signal lives in the TITLE
 * ("Plug-In Hybrid", "eHybrid", "PHEV", "P400e"…): when the structured fuel
 * says hybrid (or nothing) but the ad text says plug-in, upgrade the token.
 */
export function refineFuelToken(structured: FuelToken, adText: string): FuelToken {
  if (structured !== 'hybrid' && structured !== '') return structured;
  if (PHEV_TOKENS.test(normalizeForMatch(adText))) return 'phev';
  // Badge Lexus « 450h+ » : le + EST le marqueur plug-in (350h = full hybrid,
  // 450h+ = rechargeable). Testé sur le texte BRUT : normalizeForMatch
  // transforme '+' en espace et détruit la preuve. Constat 01/08 : 7/7
  // NX 450h+ étiquetées famille « Hybride » par Marktplaats, invisibles du
  // filtre rechargeable du MI.
  // Sans frontière de mot à gauche : le badge s'écrit aussi collé au modèle
  // (« NX450h+ ») — \b ne coupe pas entre deux caractères de mot.
  if (/\d{3}h\+/i.test(adText)) return 'phev';
  return structured;
}

export type FuelToken =
  | 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'mild_hybrid'
  | 'phev' | 'hydrogen' | 'cng' | 'lpg' | '';

export const FUEL_LABELS: Record<Exclude<FuelToken, ''>, string> = {
  petrol: 'Essence',
  diesel: 'Diesel',
  electric: 'Électrique',
  hybrid: 'Hybride',
  mild_hybrid: 'Hybride léger',
  phev: 'Hybride rechargeable',
  hydrogen: 'Hydrogène',
  cng: 'GNV',
  lpg: 'GPL',
};

/**
 * Map ANY fuel text — a declared form value, a structured attribute label, or
 * free title text — to a canonical token. Cross-language (FR/NL/DA) + engine
 * badges (TDI/TSI…).
 */
export function canonicalizeFuel(raw: string): FuelToken {
  const t = normalizeForMatch(raw); // accent-stripped, lowercased, separators → space
  if (!t) return '';
  if (PHEV_TOKENS.test(t)) return 'phev';
  if (MILD_HYBRID_TOKENS.test(t)) return 'mild_hybrid';
  // hibrid = ES « híbrido » accent-strippé ; ibrid = IT « ibrida/ibrido ».
  // e-Power (Nissan), e:HEV (Honda — « : » devient espace au normalisage),
  // HSD (Toyota Hybrid Synergy Drive) : hybrides sans le mot « hybride ».
  if (/hybrid|hybride|hibrid|ibrid|\bhev\b|volledig hybride|e ?power|\be hev\b|\bhsd\b/.test(t)) return 'hybrid';
  // Electric + combustion listed together (AutoScout "Elektro/Benzin",
  // "Électrique/Essence", ES "Electro/Gasolina", IT "Elettrica/Benzina") is a
  // hybrid, not a pure EV. Test before 'electric' — the ES combo fell through
  // to 'electric' and hid Spanish hybrids from the Hybride filter.
  if (/electr|elektr|elettr/.test(t) && /essence|benzine|benzin|petrol|gasoline|gasolina|gasolio|diesel/.test(t)) return 'hybrid';
  if (/hydrogen|hydrogene|waterstof|\bh2\b/.test(t)) return 'hydrogen';
  if (/\bcng\b|\bgnv\b|gaz naturel|aardgas|metano/.test(t)) return 'cng';
  if (/\bgpl\b|\blpg\b|\bglp\b|autogas/.test(t)) return 'lpg';
  if (/electr|elektr|elettr|elektrisk|\bel\b|\belbil\b|\bev\b|zero emission/.test(t)) return 'electric';
  // gasoil (FR), gasóleo (ES), gasolio (IT) — word-bounded so « gasolina »
  // (essence ES) ne matche jamais la branche diesel.
  // Brandings moteur (backlog 1) : les vendeurs écrivent la motorisation sans
  // le mot carburant — 2.0 TDI, 1.5 TCe, 1.6 CRDi… Chaque token est un
  // branding constructeur univoque, jamais une devinette.
  if (/diesel|gasoil|\bgasoleo\b|\bgasolio\b|\bhdi\b|\btdi\b|\btdci\b|\bcdti\b|\bdci\b|\bcdi\b|\bcrdi\b|blue ?hdi|bluetec|multijet|\bd4d\b|\bd 4d\b/.test(t)) return 'diesel';
  if (/essence|benzine|benzin|petrol|gasoline|gasolina|\btsi\b|\btfsi\b|\btce\b|\bgdi\b|\bvti\b|vvt ?i|puretech|ecoboost|\bmpi\b/.test(t)) return 'petrol';
  return '';
}

/**
 * Canonicalise a gearbox label across languages + site codes to a token
 * ('automatic'|'manual'|'semi'|''). AutoScout DE returns "Automatik", FR
 * "Automatique", NL "Automaat", and some sites a code (A/M/S) — a raw text
 * match failed to confirm them. Order: 'semi' before 'automatic' (semi-auto
 * contains "automat").
 */
export type GearboxToken = 'automatic' | 'manual' | 'semi' | '';
export function canonicalizeGearbox(raw: string): GearboxToken {
  const t = normalizeForMatch(raw);
  if (!t) return '';
  if (t === 'a') return 'automatic';
  if (t === 'm') return 'manual';
  if (t === 's') return 'semi';
  if (/semi|halbautomat|semiautomat/.test(t)) return 'semi';
  if (/automat|automaat|\bdsg\b|\bcvt\b|e ?cvt|tiptronic|s ?tronic|\bdct\b|\bedc\b|steptronic|powershift|\bat\b/.test(t)) return 'automatic';
  if (/manuel|manual|manuale|schaltgetriebe|handgeschakeld|\bmt\b|mecanique/.test(t)) return 'manual';
  return '';
}

/**
 * Couleur multilingue → jeton canonique (backlog 2quinquies) : chaque site
 * écrit sa langue (Zwart≡Noir≡Schwarz≡Sort≡Nero≡Negro) — la confirmation en
 * texte brut rejetait des couleurs identiques. Vocabulaire relevé sur les
 * valeurs RÉELLES de la base (relevé du 30/07) + langues des sites couverts.
 * Libellé inconnu → '' : confirmStructuredLabel retombe alors sur la
 * comparaison texte, jamais une mauvaise catégorie en silence.
 */
export function canonicalizeColor(raw: string): string {
  const t = normalizeForMatch(raw);
  if (!t) return '';
  if (/noir|zwart|schwarz|\bsort\b|nero|negro|black/.test(t)) return 'noir';
  if (/blanc|\bwit\b|weiss|hvid|bianco|white/.test(t)) return 'blanc';
  // argent AVANT gris : « Zilver of Grijs » (NL) et « gris argent » penchent
  // argent — le libellé le plus précis gagne.
  if (/argent|zilver|silber|solv|silver|plata|plateado/.test(t)) return 'argent';
  if (/gris|grijs|grau|\bgra\b|grigio|grey|gray/.test(t)) return 'gris';
  if (/bleu|blauw|blau|\bbla\b|\bblu\b|azul|blue/.test(t)) return 'bleu';
  if (/rouge|rood|\brot\b|\brod\b|rosso|rojo|red/.test(t)) return 'rouge';
  if (/vert|groen|grun|\bgron\b|verde|green/.test(t)) return 'vert';
  if (/jaune|geel|gelb|\bgul\b|giallo|amarillo|yellow/.test(t)) return 'jaune';
  if (/orange|oranje|naranja|arancio/.test(t)) return 'orange';
  if (/beige/.test(t)) return 'beige';
  if (/marron|brun|bruin|braun|marrone|brown/.test(t)) return 'marron';
  if (/violet|prune|paars|lila|purple|morado/.test(t)) return 'violet';
  if (/\bor\b|goud|gold|dore|oro/.test(t)) return 'or';
  return '';
}

/**
 * Carrosserie multilingue → jeton canonique : Berline≡Limousine≡Sedan,
 * SUV≡Terreinwagen≡Geländewagen, Break≡Kombi≡Stationwagen≡Touring…
 * Même règle : inconnu → '' (repli texte, jamais de fausse catégorie).
 */
export function canonicalizeVehicleType(raw: string): string {
  const t = normalizeForMatch(raw);
  if (!t) return '';
  if (/suv|terreinwagen|gelandewagen|4x4|tout ?terrain|crossover/.test(t)) return 'suv';
  if (/break|kombi|stationwagen|stationcar|estate|touring|\bsw\b|familiale/.test(t)) return 'break';
  if (/berline|limousine|sedan|saloon|berlina/.test(t)) return 'berline';
  if (/coupe|\bcoupé\b/.test(t)) return 'coupe';
  if (/cabrio|convertible|roadster|spider|spyder|decapotable/.test(t)) return 'cabriolet';
  if (/monospace|\bmpv\b|minivan|ruimtewagen|van personen/.test(t)) return 'monospace';
  if (/citadine|kleinwagen|hatchback|compact|city ?car|petite voiture/.test(t)) return 'citadine';
  if (/utilitaire|bestelwagen|fourgon|kastenwagen|\bvan\b|pick ?up/.test(t)) return 'utilitaire';
  return '';
}

/** Per-listing fuel: prefer the structured attribute, fall back to title/desc. */
function listingFuelCanonical(l: ScrapedListing, adapter: SiteAdapter): { canonical: string; source: 'structured' | 'text'; raw: string } {
  const structured = (l.fuel ?? '').trim();
  if (structured) return { canonical: canonicalizeFuel(structured), source: 'structured', raw: structured };
  const detect = adapter.inferFuel ?? (() => '');
  const fromText = detect(l.title ?? '', l.description ?? '');
  const canonical = fromText ? canonicalizeFuel(fromText) : canonicalizeFuel(`${l.title ?? ''} ${l.description ?? ''}`);
  return { canonical, source: 'text', raw: canonical || 'indétecté' };
}

// ─── Field-by-field confirmation ──────────────────────────────────────────────

// ─── Intelligent brand/model matching ────────────────────────────────────────
// Marketplace taxonomies name a model differently from how the listing titles
// spell it: Leboncoin's internal model is "Classe CLA" but titles say "CLA".
// So model matching is token-based with generic words stripped, and short
// tokens are matched on word boundaries (so "cla" matches "Mercedes CLA
// Shooting Brake" but not the inside of another word).

const MODEL_NOISE_TOKENS = new Set([
  'classe', 'class', 'klasse', 'serie', 'series', 'gamme', 'the', 'nouvelle', 'nouveau', 'new',
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Token present in already-normalized text; whole-word for short tokens (≤3). */
function tokenInText(normText: string, tok: string): boolean {
  if (!tok) return false;
  if (tok.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(tok)}([^a-z0-9]|$)`).test(normText);
  }
  return normText.includes(tok);
}

/**
 * Model token match, tolerant to the manufacturer habit of GLUING the engine/
 * power onto the model name: "CLA250+", "A180", "GLC300", BMW "320d". A plain
 * whole-word check on "cla" fails against "cla250" (0/69 on a genuine CLA
 * pre-filtered by the URL). So beyond a whole-word hit, also accept the model
 * immediately followed by a digit — the integrated-power form. Kept to tokens
 * of ≥2 chars so a single-letter model can't match half the market.
 */
function modelTokenInText(normText: string, tok: string): boolean {
  if (!tok) return false;
  if (tokenInText(normText, tok)) return true;
  // Integrated-power form. 2+ char models accept any trailing digit
  // ("cla250", "glc300"). A 1-char model (Mercedes A/B/C/E/S classe) requires
  // 2+ digits ("a180", "c220") so a bare "a" can't grab Audi "a4".
  const digits = tok.length >= 2 ? '[0-9]' : '[0-9]{2}';
  if (new RegExp(`(^|[^a-z0-9])${escapeRegex(tok)}${digits}`).test(normText)) return true;
  // Split form: sites write the letter/digit boundary with a space where the
  // criterion glues it — AutoScout "RAV 4" vs "RAV4", Mercedes "A 180" vs
  // "A180" (5/16 on a genuine RAV4 page came from exactly this). Boundaries on
  // both sides so "a 45" can never satisfy "a4".
  const parts = tok.match(/^([a-z]+)([0-9]+)$/);
  if (parts) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(parts[1])} ${parts[2]}([^a-z0-9]|$)`).test(normText);
  }
  // Graphie compacte du critère vs graphie ÉCLATÉE du site : les titres
  // écrivent « e-tron » (normalisé 'e tron', DEUX jetons) quand le critère
  // porte 'etron' en un seul — « Q6-etron » faisait 0/46 sur une page dont
  // 100 % des titres disaient e-tron (01/08). Accepté si deux jetons ADJACENTS
  // du texte, recollés, ÉGALENT le jeton (égalité stricte, pas de sous-chaîne :
  // « q6 » ne peut pas sortir de « sq6 »). Même famille : E-Tech, T-Roc, C-HR.
  if (tok.length >= 4) {
    const words = normText.split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i + 1 < words.length; i++) {
      if (words[i] + words[i + 1] === tok) return true;
    }
  }
  return false;
}

// A brand and its aliases are ONE brand: the criterion may say "VW" while the
// site's structured attribute says "Volkswagen" (0/85 on a genuine Golf page
// came from exactly this). First entry of each group = canonical form.
const BRAND_ALIAS_GROUPS: string[][] = [
  ['volkswagen', 'vw'],
  ['mercedes', 'mercedes benz'],
];

/** All normalized spellings of a brand (itself + alias-group members). */
function brandVariants(raw: string): string[] {
  const n = normalizeForMatch(raw);
  const grp = BRAND_ALIAS_GROUPS.find((g) => g.includes(n));
  return grp ?? [n];
}

/** Canonical label for structured comparison ("VW" and "Volkswagen" → same). */
function canonBrandLabel(raw: string): string {
  return brandVariants(raw)[0];
}

/** Brand matches if ANY token of ANY of its alias spellings appears. */
function brandMatchesTitle(title: string, brand: string): boolean {
  const normTitle = normalizeForMatch(title);
  return brandVariants(brand).some((variant) =>
    variant.split(' ').filter(Boolean).some((t) => t.length >= 2 && tokenInText(normTitle, t)));
}

/** Model matches if ALL its DISTINCTIVE tokens appear (generic words stripped).
 *  Exporté : le moteur de campagne s'en sert pour post-filtrer les résultats
 *  des recherches TEXTE (Marktplaats q:, Leboncoin) avant analyse. */
export function modelMatchesTitle(title: string, model: string): boolean {
  const normTitle = normalizeForMatch(title);
  const toks = normalizeForMatch(model).split(' ').filter(Boolean);
  const distinctive = toks.filter((t) => !MODEL_NOISE_TOKENS.has(t));
  const effective = distinctive.length > 0 ? distinctive : toks;
  if (effective.every((t) => modelTokenInText(normTitle, t))) return true;
  // Compact form of a multi-token model: criterion "RAV 4" vs title "RAV4".
  return effective.length > 1 && modelTokenInText(normTitle, effective.join(''));
}

function pct(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

export function confirmCriteriaAgainstSample(
  criteria: SearchCriteria,
  listings: ScrapedListing[],
  adapter: SiteAdapter
): FieldConfirmation[] {
  const out: FieldConfirmation[] = [];
  const n = listings.length;

  const declared = (value: string | number | undefined | null): string | null => {
    const s = value === undefined || value === null ? '' : String(value).trim();
    return s.length > 0 ? s : null;
  };

  const insufficientSample = n < INGESTION_MIN_SAMPLE;

  // Generic text confirmation with a per-listing predicate (brand/model use
  // token-aware matchers; trim uses a plain substring over title+description).
  const pushMatch = (field: IngestionField, value: string, matchFn: (l: ScrapedListing) => boolean) => {
    if (insufficientSample) {
      out.push({
        field, declaredValue: value, status: 'rejected', matchCount: 0, sampleSize: n,
        method: 'text', reason: `échantillon insuffisant (${n} annonces < ${INGESTION_MIN_SAMPLE})`,
      });
      return;
    }
    const matchCount = listings.filter(matchFn).length;
    const rate = matchCount / n;
    if (rate >= INGESTION_CONFIRM_THRESHOLD) {
      out.push({ field, declaredValue: value, status: 'confirmed', matchCount, sampleSize: n, method: 'text' });
    } else {
      out.push({
        field, declaredValue: value, status: 'rejected', matchCount, sampleSize: n, method: 'text',
        reason: `${matchCount}/${n} annonces contiennent "${value}" (${pct(matchCount, n)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
      });
    }
  };

  // brand — prefer the structured brand attribute (titles often omit the make,
  // e.g. "Megane E-Tech" with no "Renault"); fall back to token matching on
  // the title. model — token-aware matching (site model name ≠ title spelling).
  const brand = declared(criteria.brand);
  if (brand) {
    const structuredBrandCount = listings.filter((l) => (l.brand ?? '').trim().length > 0).length;
    if (structuredBrandCount >= INGESTION_MIN_SAMPLE) {
      // Compare canonical alias forms so "VW" == "Volkswagen"; the report keeps
      // the user's original spelling via declaredValue below.
      const c = confirmStructuredLabel('brand', canonBrandLabel(brand), listings,
        (l) => (l.brand ? canonBrandLabel(l.brand) : null), n);
      out.push({ ...c, declaredValue: brand });
    } else {
      pushMatch('brand', brand, (l) => brandMatchesTitle(l.title ?? '', brand));
    }
  }
  const model = declared(criteria.model);
  if (model) pushMatch('model', model, (l) => modelMatchesTitle(l.title ?? '', model));
  // trim — title + description (same sources as the study pipeline's matchesTrim).
  // Graphie compacte vs éclatée, comme les modèles : « m sport » déclaré vs
  // « MSport » écrit collé par les vendeurs (Subito 02/08 — la confirmation
  // ratait la moitié des annonces). Égalité STRICTE de jetons pour la forme
  // compacte : « quantum sport » ne peut pas satisfaire « msport ».
  const trim = declared(criteria.trim);
  if (trim) {
    const trimNorm = normalizeForMatch(trim);
    const compact = trimNorm.replace(/ /g, '');
    const trimHit = (raw: string): boolean => {
      const text = normalizeForMatch(raw);
      if (text.includes(trimNorm)) return true;
      if (compact === trimNorm) return false;
      const words = text.split(' ');
      for (let i = 0; i < words.length; i++) {
        if (words[i] === compact) return true; // écrit collé (« msport »)
        if (i + 1 < words.length && words[i] + words[i + 1] === compact) return true;
      }
      return false;
    };
    pushMatch('trim', trim, (l) => trimHit(`${l.title ?? ''} ${l.description ?? ''}`));
  }

  // fuel — prefer the seller-declared structured attribute; fall back to
  // title/description text only when the parser couldn't read it. A listing
  // whose fuel can't be established counts AGAINST confirmation (certainty
  // or nothing).
  const fuel = declared(criteria.fuel);
  if (fuel) {
    const declaredCanon = canonicalizeFuel(fuel);
    const structuredCount = listings.filter((l) => (l.fuel ?? '').trim().length > 0).length;
    const useStructured = structuredCount >= INGESTION_MIN_SAMPLE;
    const pool = useStructured ? listings.filter((l) => (l.fuel ?? '').trim().length > 0) : listings;
    const method: 'structured' | 'text' = useStructured ? 'structured' : 'text';

    if (pool.length < INGESTION_MIN_SAMPLE) {
      out.push({
        field: 'fuel', declaredValue: fuel, status: 'rejected', matchCount: 0, sampleSize: pool.length,
        method, reason: `données insuffisantes (${pool.length} annonces exploitables < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      let matchCount = 0;
      let familyCount = 0;
      let voting = 0;
      let unreadable = 0;
      const seen: Record<string, number> = {};
      for (const l of pool) {
        const { canonical, raw } = listingFuelCanonical(l, adapter);
        seen[raw] = (seen[raw] ?? 0) + 1;
        // Un carburant ILLISIBLE (« o », libellé inconnu du canonicaliseur)
        // n'est pas une preuve CONTRE : il s'abstient. Seuls les carburants
        // reconnus votent — rapport 20/07 : 43× hybride + 10× « o » rejetait
        // à 81 % un segment en réalité confirmé à 100 %.
        if (!canonical) { unreadable++; continue; }
        voting++;
        // Le titre de l'annonce peut préciser ce que l'attribut du site ne
        // dit pas (« Plug-in Hybrid GT-Line » étiqueté famille) — même
        // raffineur que le Market Intelligence, jamais un second.
        const refined = refineFuelToken(canonical as FuelToken, `${l.title ?? ''} ${l.description ?? ''} ${l.trim ?? ''}`);
        if (refined === declaredCanon) { matchCount++; continue; }
        // CONFIRMATION HIÉRARCHIQUE (backlog 0ter, 30/07) : Marktplaats
        // étiquette chaque annonce avec la FAMILLE (« Hybride
        // Elektrisch/Benzine »), jamais le sous-type — un plug-in déclaré y
        // était rejeté À VIE (0 % < 90 %) et l'URL jamais mémorisée. La
        // famille observée CONFIRME le sous-type déclaré : elle ne le
        // contredit pas. Un carburant d'une AUTRE famille vote toujours contre.
        if (canonical === 'hybrid' && (declaredCanon === 'phev' || declaredCanon === 'mild_hybrid')) {
          familyCount++;
        }
      }
      const okCount = matchCount + familyCount;
      if (voting < INGESTION_MIN_SAMPLE) {
        out.push({
          field: 'fuel', declaredValue: fuel, status: 'rejected', matchCount: 0, sampleSize: voting,
          method, reason: `données insuffisantes (${voting} carburant(s) lisible(s) < ${INGESTION_MIN_SAMPLE}${unreadable ? ` ; ${unreadable} illisible(s)` : ''})`,
        });
      } else if (okCount / voting >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({
          field: 'fuel', declaredValue: fuel, status: 'confirmed', matchCount: okCount, sampleSize: voting, method,
          ...(familyCount > 0
            ? { reason: `retenu (famille) : ${familyCount}/${voting} au niveau famille hybride — le site n'étiquette pas le sous-type` }
            : {}),
        });
      } else {
        const dist = Object.entries(seen).map(([k, v]) => `${v}× ${k}`).join(', ');
        out.push({
          field: 'fuel', declaredValue: fuel, status: 'rejected', matchCount, sampleSize: voting, method,
          reason: `${method === 'structured' ? 'structuré' : 'texte'}: ${dist} vs déclaré ${fuel} — ${pct(matchCount, voting)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%${unreadable ? ` (${unreadable} illisible(s) hors vote)` : ''}`,
        });
      }
    }
  }

  // year — STRUCTURED field; denominator = listings that carry a parsed year
  const yearFrom = declared(criteria.yearFrom ?? criteria.year);
  const yearTo = declared(criteria.yearTo);
  if (yearFrom) {
    const withYear = listings.filter((l) => l.year !== null && l.year !== undefined);
    const declaredLabel = yearTo ? `${yearFrom}-${yearTo}` : `≥${yearFrom}`;
    if (withYear.length < INGESTION_MIN_SAMPLE) {
      out.push({
        field: 'year', declaredValue: declaredLabel, status: 'rejected',
        matchCount: 0, sampleSize: withYear.length, method: 'structured',
        reason: `données structurées insuffisantes (${withYear.length} annonces avec année < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      const from = Number(yearFrom);
      const to = yearTo ? Number(yearTo) : null;
      const matchCount = withYear.filter((l) => {
        const y = l.year as number;
        return to ? y >= from && y <= to : y >= from;
      }).length;
      const rate = matchCount / withYear.length;
      if (rate >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({ field: 'year', declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: withYear.length, method: 'structured' });
      } else {
        out.push({
          field: 'year', declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: withYear.length, method: 'structured',
          reason: `${matchCount}/${withYear.length} années structurées dans ${declaredLabel} (${pct(matchCount, withYear.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
        });
      }
    }
  }

  // mileage — STRUCTURED field; same denominator rule as year
  const mileage = declared(criteria.mileage);
  if (mileage) {
    const withMileage = listings.filter((l) => l.mileage !== null && l.mileage !== undefined);
    if (withMileage.length < INGESTION_MIN_SAMPLE) {
      out.push({
        field: 'mileage', declaredValue: `≤${mileage} km`, status: 'rejected',
        matchCount: 0, sampleSize: withMileage.length, method: 'structured',
        reason: `données structurées insuffisantes (${withMileage.length} annonces avec km < ${INGESTION_MIN_SAMPLE})`,
      });
    } else {
      const max = Number(mileage);
      const matchCount = withMileage.filter((l) => (l.mileage as number) <= max).length;
      const rate = matchCount / withMileage.length;
      if (rate >= INGESTION_CONFIRM_THRESHOLD) {
        out.push({ field: 'mileage', declaredValue: `≤${mileage} km`, status: 'confirmed', matchCount, sampleSize: withMileage.length, method: 'structured' });
      } else {
        out.push({
          field: 'mileage', declaredValue: `≤${mileage} km`, status: 'rejected', matchCount, sampleSize: withMileage.length, method: 'structured',
          reason: `${matchCount}/${withMileage.length} km structurés ≤ ${mileage} (${pct(matchCount, withMileage.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
        });
      }
    }
  }

  // ─── Secondary structured fields ────────────────────────────────────────────
  // All confirmed against parsed listing attributes (never the title). Where a
  // parser doesn't extract the attribute, the denominator falls below the min
  // and the field is rejected as "insufficient structured data" — honest, not
  // a false negative on the URL.

  // power — DIN horsepower range (structured ScrapedListing.powerDin)
  const powerFrom = declared(criteria.powerFrom);
  const powerTo = declared(criteria.powerTo);
  if (powerFrom || powerTo) {
    const label = `${powerFrom ?? '?'}-${powerTo ?? 'max'} ch`;
    const from = powerFrom ? Number(powerFrom) : null;
    const to = powerTo ? Number(powerTo) : null;
    out.push(confirmStructured(
      'power', label, listings,
      (l) => (l.powerDin ?? null),
      (v) => (from == null || v >= from) && (to == null || v <= to),
      n,
    ));
  }

  // doors / seats — exact structured integer
  const doors = declared(criteria.doors);
  if (doors) {
    out.push(confirmStructured(
      'doors', `${doors} portes`, listings,
      (l) => (l.doors ?? null),
      (v) => v === Number(doors),
      n,
    ));
  }
  const seats = declared(criteria.seats);
  if (seats) {
    out.push(confirmStructured(
      'seats', `${seats} places`, listings,
      (l) => (l.seats ?? null),
      (v) => v === Number(seats),
      n,
    ));
  }

  // gearbox / color / vehicleType — structured human LABEL match
  const gearbox = declared(criteria.gearbox);
  if (gearbox) out.push(confirmStructuredLabel('gearbox', gearbox, listings, (l) => l.gearbox ?? null, n, canonicalizeGearbox));
  const color = declared(criteria.color);
  if (color) out.push(confirmStructuredLabel('color', color, listings, (l) => l.color ?? null, n, canonicalizeColor));
  const vehicleType = declared(criteria.vehicleType);
  if (vehicleType) out.push(confirmStructuredLabel('vehicleType', vehicleType, listings, (l) => l.vehicleType ?? null, n, canonicalizeVehicleType));

  return out;
}

/** Confirm a numeric structured field against a predicate. */
function confirmStructured(
  field: IngestionField,
  declaredLabel: string,
  listings: ScrapedListing[],
  read: (l: ScrapedListing) => number | null,
  predicate: (v: number) => boolean,
  _fullSize: number,
): FieldConfirmation {
  const present = listings.filter((l) => read(l) !== null);
  if (present.length < INGESTION_MIN_SAMPLE) {
    return {
      field, declaredValue: declaredLabel, status: 'rejected', matchCount: 0, sampleSize: present.length,
      method: 'structured', reason: `données structurées insuffisantes (${present.length} annonces avec la donnée < ${INGESTION_MIN_SAMPLE})`,
    };
  }
  const matchCount = present.filter((l) => predicate(read(l) as number)).length;
  const rate = matchCount / present.length;
  if (rate >= INGESTION_CONFIRM_THRESHOLD) {
    return { field, declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: present.length, method: 'structured' };
  }
  return {
    field, declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: present.length, method: 'structured',
    reason: `${matchCount}/${present.length} annonces correspondent (${pct(matchCount, present.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
  };
}

/** Confirm an enum structured field by human-label match (bidirectional includes). */
function confirmStructuredLabel(
  field: IngestionField,
  declaredLabel: string,
  listings: ScrapedListing[],
  read: (l: ScrapedListing) => string | null,
  _fullSize: number,
  canon?: (s: string) => string,
): FieldConfirmation {
  const declaredNorm = normalizeForMatch(declaredLabel);
  // When a canonicaliser is given (e.g. gearbox), compare canonical tokens so
  // cross-language values match ("Automatik" DE == "Automatique" FR). Falls
  // back to text-includes when the declared value canonicalises to nothing.
  const declaredCanon = canon ? canon(declaredLabel) : '';
  const present = listings.filter((l) => {
    const v = read(l);
    return v !== null && v !== undefined && v.trim().length > 0;
  });
  if (present.length < INGESTION_MIN_SAMPLE) {
    return {
      field, declaredValue: declaredLabel, status: 'rejected', matchCount: 0, sampleSize: present.length,
      method: 'structured', reason: `données structurées insuffisantes (${present.length} annonces avec la donnée < ${INGESTION_MIN_SAMPLE})`,
    };
  }
  const matchCount = present.filter((l) => {
    const raw = read(l) as string;
    if (canon && declaredCanon) {
      const lc = canon(raw);
      return lc !== '' && lc === declaredCanon;
    }
    const lNorm = normalizeForMatch(raw);
    return lNorm.includes(declaredNorm) || declaredNorm.includes(lNorm);
  }).length;
  const rate = matchCount / present.length;
  if (rate >= INGESTION_CONFIRM_THRESHOLD) {
    return { field, declaredValue: declaredLabel, status: 'confirmed', matchCount, sampleSize: present.length, method: 'structured' };
  }
  return {
    field, declaredValue: declaredLabel, status: 'rejected', matchCount, sampleSize: present.length, method: 'structured',
    reason: `${matchCount}/${present.length} annonces = "${declaredLabel}" (${pct(matchCount, present.length)} < ${INGESTION_CONFIRM_THRESHOLD * 100}%)`,
  };
}

// ─── Mapping construction (confirmed fields only) ─────────────────────────────

function segmentForField(
  segments: CandidateSegment[],
  field: IngestionField
): CandidateSegment | undefined {
  return segments.find((s) => s.guessField === field);
}

export function buildIngestionMapping(
  confirmations: FieldConfirmation[],
  segments: CandidateSegment[]
): IngestionInferredMapping {
  const mapping: IngestionInferredMapping = { paramToField: {}, fieldToParam: {} };
  const confirmed = new Set(confirmations.filter((c) => c.status === 'confirmed').map((c) => c.field));

  const attribute = (field: IngestionField, assign: (paramName: string) => void) => {
    if (!confirmed.has(field)) return;
    const seg = segmentForField(segments, field);
    // Confirmed but not attributable to any URL segment → retained as a
    // key value on the memory row, but absent from the param mapping.
    if (!seg) return;
    assign(seg.paramName);
    mapping.fieldToParam[field] = { paramName: seg.paramName, rawValue: seg.raw };
    if (!seg.paramName.startsWith('_path')) mapping.paramToField[seg.paramName] = field;
  };

  attribute('brand', (p) => { mapping.brandParam = p; });
  attribute('model', (p) => { mapping.modelParam = p; });
  attribute('fuel', (p) => { mapping.fuelParam = p; });
  attribute('trim', (p) => { mapping.trimParam = p; });
  attribute('mileage', (p) => { mapping.mileageParam = p; });

  // Secondary fields: recorded in the generic fieldToParam/paramToField maps
  // (no dedicated *Param property — URL generation from them is a later step).
  // For enum fields this is where the opaque code↔confirmed-value pairing lands
  // (e.g. gearbox param 'gearbox' with rawValue '2', confirmed as Automatique).
  for (const field of SECONDARY_FIELDS) {
    attribute(field, () => { /* generic maps only */ });
  }

  // year: 'from'/'to' distinction when the site uses two params (Bilbasen,
  // Marktplaats hash); single range param otherwise (Leboncoin regdate).
  if (confirmed.has('year')) {
    const yearSegs = segments.filter((s) => s.guessField === 'year');
    for (const seg of yearSegs) {
      const name = seg.paramName.toLowerCase();
      if (name.includes('to') && !name.includes('from')) {
        mapping.yearToParam = seg.paramName;
      } else if (!mapping.yearFromParam) {
        mapping.yearFromParam = seg.paramName;
      }
      mapping.fieldToParam[mapping.yearToParam === seg.paramName ? 'yearTo' : 'year'] =
        { paramName: seg.paramName, rawValue: seg.raw };
      if (!seg.paramName.startsWith('_path')) mapping.paramToField[seg.paramName] = 'year';
    }
  }

  return mapping;
}

// ─── Top-level analysis ───────────────────────────────────────────────────────

export function analyzeIngestion(
  url: string,
  criteria: SearchCriteria,
  listings: ScrapedListing[],
  adapter: SiteAdapter
): IngestionAnalysis {
  const confirmations = confirmCriteriaAgainstSample(criteria, listings, adapter);
  // Adapter-declared segments + generic dictionary guesses for unclaimed
  // params — so ANY site's filter params are learnable, not just the ones an
  // adapter was hand-wired for.
  const segments = collectCandidateSegments(adapter, url);
  const rejectedFields = confirmations.filter((c) => c.status === 'rejected');
  const confirmedFields = confirmations
    .filter((c) => c.status === 'confirmed')
    .map((c) => c.field);

  return {
    confirmations,
    confirmedFields,
    rejectedFields,
    // One rejected field poisons the URL as a whole (validated example 2) —
    // but never the individually confirmed segment↔field pairs.
    validatedUrl: rejectedFields.length === 0 && confirmations.length > 0 ? url : null,
    inferredMapping: buildIngestionMapping(confirmations, segments),
    candidateSegments: segments,
  };
}
