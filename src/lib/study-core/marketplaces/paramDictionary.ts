/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GENERIC URL-PARAM → FIELD DICTIONARY (all sites, current and future)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. Adapters declare the params they KNOW; this layer proposes candidate
 * segments for every other query/hash param whose NAME matches a precise
 * multilingual pattern (FR/NL/DK/DE/generic English). These are HYPOTHESES
 * only — the discovery scrape confirms or rejects each one, and only
 * confirmed pairs are retained ("certain-or-nothing"). This is what makes a
 * brand-new site learnable without writing adapter code for every filter.
 */

import type { CandidateSegment } from './types';
import { decomposeUrl } from './urlDecompose';

type GuessField = NonNullable<CandidateSegment['guessField']>;

/**
 * Ordered patterns — first match wins. Names are matched on the WHOLE param
 * name, lowercased. Patterns are deliberately narrow: a false guess costs a
 * wasted confirmation attempt, a missed one costs a learning opportunity —
 * we prefer precision.
 */
const NAME_PATTERNS: Array<{ re: RegExp; field: GuessField; numeric?: boolean }> = [
  { re: /brand|\bmake\b|^make$|merk|marque|maerke|mærke/, field: 'brand' },
  { re: /model/, field: 'model' },
  { re: /fuel|brandstof|braendstof|brændstof|carburant|energie/, field: 'fuel' },
  { re: /gear|transmission|boite|bo[îi]te/, field: 'gearbox' },
  { re: /door|porte|deur|d[øo]r/, field: 'doors', numeric: true },
  { re: /seat|place|zitplaats|s[æa]de/, field: 'seats', numeric: true },
  { re: /colou?r|couleur|kleur|farve|bcol/, field: 'color' },
  { re: /body|carross|karross|vehicle_?type|voertuig/, field: 'vehicleType' },
  { re: /power|puissance|vermogen|effekt|^hp|hpfrom|hpto|horse/, field: 'power', numeric: true },
  { re: /year|freg|regdate|bouwjaar|a{1,2}rgang|årgang|construction/, field: 'year', numeric: true },
  { re: /mileage|kilometer|^km|kmfrom|kmto/, field: 'mileage', numeric: true },
];

/** Params that are never business criteria — skip before pattern matching. */
const NOISE = /sort|order|^page$|offset|limit|^cursor|price|lease|leasing|engros|cvr|^atype$|^cy$|^ustate$|^desc$|^size$|^search_?in|shippable|^ad_type|locations|^lat|^lng|^radius/;

/**
 * Candidate segments for query/hash params the adapter did NOT already claim.
 * `claimed` = param names present in the adapter's own segments.
 */
export function genericCandidateSegments(url: string, claimed: Set<string>): CandidateSegment[] {
  const d = decomposeUrl(url);
  if (!d) return [];
  const out: CandidateSegment[] = [];

  const scan = (params: Record<string, string>, location: 'query' | 'hash') => {
    for (const [name, value] of Object.entries(params)) {
      if (!value || claimed.has(name)) continue;
      const lower = name.toLowerCase();
      if (NOISE.test(lower)) continue;
      const hit = NAME_PATTERNS.find((p) => p.re.test(lower));
      if (!hit) continue;
      // Numeric-valued fields must carry digits (filters out powertype=hp etc.)
      if (hit.numeric && !/\d/.test(value)) continue;
      out.push({ raw: value, location, paramName: name, guessField: hit.field });
    }
  };

  scan(d.queryParams, 'query');
  scan(d.hashParams, 'hash');
  return out;
}

/**
 * The adapter's own candidate segments PLUS generic dictionary guesses for
 * everything the adapter didn't claim. This is the single entry point the
 * ingestion pipeline (analysis + form prefill) should use.
 */
export function collectCandidateSegments(
  adapter: { extractCandidateSegments?: (url: string) => CandidateSegment[] },
  url: string
): CandidateSegment[] {
  const own = adapter.extractCandidateSegments?.(url) ?? [];
  const claimed = new Set(own.map((s) => s.paramName));
  return [...own, ...genericCandidateSegments(url, claimed)];
}

/**
 * Pre-fill criteria from candidate segments whose values are TRANSPARENT
 * (numeric: the URL value IS the human value). Enum codes are handled by the
 * learned dictionary (linkgen_enum_mappings), never guessed here.
 * From/to direction comes from the param name; a bare name means the site's
 * usual single-bound convention (mileage → max, power → min).
 */
export function prefillFromSegments(segments: CandidateSegment[]): {
  yearFrom?: string; yearTo?: string; mileage?: string;
  powerFrom?: string; powerTo?: string; doors?: string; seats?: string;
} {
  const out: Record<string, string> = {};
  const isTo = (n: string) => /to$|to\b|max/i.test(n);
  const isFrom = (n: string) => /from|min/i.test(n);

  for (const s of segments) {
    const digits = (s.raw.match(/\d+/) ?? [])[0];
    if (!digits) continue;
    const name = s.paramName;
    switch (s.guessField) {
      case 'year': {
        const y = digits.length >= 4 ? digits.slice(0, 4) : '';
        if (!y) break;
        if (isTo(name)) out.yearTo ??= y;
        else out.yearFrom ??= y;
        break;
      }
      case 'mileage':
        if (!isFrom(name)) out.mileage ??= digits; // max by convention
        break;
      case 'power':
        if (isTo(name)) out.powerTo ??= digits;
        else out.powerFrom ??= digits;
        break;
      case 'doors': out.doors ??= digits; break;
      case 'seats': out.seats ??= digits; break;
      default: break;
    }
  }
  return out;
}
