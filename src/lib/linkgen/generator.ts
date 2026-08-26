import { getSiteAdapter } from '../study-core/marketplaces';
import { resolveYearRange } from '../study-core/marketplaces/urlTemplate';
import { sharedSupabase as supabase } from '../supabaseShared';
import { ensureLearnedTaxonomy } from './taxonomy';
import { applyVariableCriteria, injectTrimIntoUrl, mpNormalize, setQueryParamRaw } from './grammar';

// Le REGISTRE UNIQUE des grammaires (année/km/puissance/boîte/finition par
// site) vit dans ./grammar.ts — les deux voies (native et mémoire) le
// partagent, et scripts/grammar-gate.mts le contre-vérifie au gate.
export { applyVariableCriteria, injectTrimIntoUrl, setQueryParamRaw } from './grammar';
import type {
  LinkGenParams,
  LinkGenResult,
  LinkGenLogEntry,
  LinkGenUrlResult,
  MappingMemoryRecord,
  InferredMapping,
  SiteKey,
} from './types';

export function generateSearchUrl(params: LinkGenParams & { site: SiteKey }): LinkGenResult {
  const logs: LinkGenLogEntry[] = [];
  const adapter = getSiteAdapter(params.site);
  const { yearFrom, yearTo } = resolveYearRange(params);

  logs.push({
    level: 'INPUT',
    message: '[LINKGEN_INPUT] Parameters received',
    data: { ...params } as Record<string, unknown>,
  });

  const mappedBrand = adapter.mapBrand(params.brand || '');
  const mappedModel = adapter.mapModel(params.model || '');
  const mappedFuel = params.fuel ? adapter.mapFuel(params.fuel) : null;

  logs.push({
    level: 'MAPPING',
    message: '[LINKGEN_MAPPING] Values after mapping',
    data: {
      brand: `${params.brand} → ${mappedBrand}`,
      model: `${params.model} → ${mappedModel}`,
      fuel: params.fuel ? `${params.fuel} → ${mappedFuel}` : '(not provided)',
      trim: params.trim || '(not provided)',
      yearFrom: yearFrom || '(not provided)',
      yearTo: yearTo || '(not provided)',
    },
  });

  const { url, warnings } = adapter.buildSearchUrl(params);

  for (const w of warnings) {
    logs.push({ level: 'WARNING', message: w, data: { minPower: params.minPower } });
  }

  // Guard: ensure generated URL belongs to the expected domain
  if (!url.includes(adapter.domain)) {
    logs.push({
      level: 'WARNING',
      message: `[LINKGEN_ROUTE_ERROR] Generated URL does not match expected domain`,
      data: { site: params.site, expectedDomain: adapter.domain, url },
    });
  }

  logs.push({
    level: 'OUTPUT',
    message: '[LINKGEN_OUTPUT] URL generated',
    data: { url },
  });

  return { url, site: params.site, debugLogs: logs };
}

export function generateSearchUrls(params: LinkGenParams): LinkGenUrlResult[] {
  const sites = params.selectedSites ?? (params.site ? [params.site] : []);

  return sites.map((site) => {
    const singleParams = { ...params, site };
    const result = generateSearchUrl(singleParams);
    const adapter = getSiteAdapter(site);

    const warnings = result.debugLogs
      .filter((l) => l.level === 'WARNING')
      .map((l) => l.message);

    // Domain guard at the multi-site level
    const domainOk = result.url.includes(adapter.domain);

    return {
      site,
      country: adapter.country,
      url: result.url,
      debugLogs: result.debugLogs,
      warnings,
      validationStatus: domainOk ? ('not_checked' as const) : ('invalid' as const),
      ...(domainOk ? {} : {
        validationIssues: [{ type: 'wrong_domain' as const }],
      }),
    };
  });
}

// ─── Facettes modèle Marktplaats apprises (générique, tous modèles) ─────────
//
// La grammaire serveur de Marktplaats filtre le modèle par facette de chemin
// `/f/{slug}/{id}/` — l'id est opaque et ne peut PAS être deviné. Chaque
// ingestion humaine d'une URL à facette l'enregistre dans la mémoire
// (fieldToParam.model → _path:model_id). Ce module extrait cette facette de
// N'IMPORTE QUELLE ligne mémoire du même modèle (peu importe son scope
// carburant/finition) et réécrit l'URL native pour y déplacer le modèle du
// texte libre vers la facette. Appris une fois → sert toutes les études.

interface MpFacet { slug: string; id: string }

export function extractMarktplaatsModelFacet(rows: Array<Record<string, unknown>>): MpFacet | null {
  for (const row of rows) {
    const mapping = (row.validated_mapping ?? row.inferred_mapping) as InferredMapping | null;
    const modelEntry = mapping?.fieldToParam?.model as { paramName?: string; rawValue?: string } | undefined;
    if (!modelEntry || modelEntry.paramName !== '_path:model_id' || !modelEntry.rawValue) continue;
    const id = String(modelEntry.rawValue);
    const segs = ((row.detected_params as { pathSegments?: string[] } | null)?.pathSegments ?? []);
    const fIdx = segs.indexOf('f');
    if (fIdx < 0 || fIdx + 2 >= segs.length) continue;
    const slugs = segs[fIdx + 1].split('+');
    const ids = segs[fIdx + 2].split('+');
    const i = ids.indexOf(id);
    if (i < 0 || !slugs[i]) continue;
    return { slug: slugs[i], id };
  }
  return null;
}

/**
 * Déplace le modèle du texte libre `/q/…/` vers la facette `/f/…/` d'une URL
 * Marktplaats générée par la grammaire native. Sans texte restant, le segment
 * /q/ disparaît ; la facette modèle passe DEVANT les facettes existantes
 * (ordre prouvé par les URLs humaines : modèle+carburant).
 */
export function applyMarktplaatsModelFacet(url: string, facet: MpFacet, modelText: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('marktplaats.nl')) return url;
    const segs = u.pathname.split('/').filter(Boolean); // l / auto-s / brand / [q, txt] / [f, slugs, ids]
    if (segs.length < 3 || segs[0] !== 'l') return url;
    const head = segs.slice(0, 3);
    let qText = '';
    let slugs: string[] = [];
    let ids: string[] = [];
    for (let i = 3; i < segs.length; i++) {
      if (segs[i] === 'q' && i + 1 < segs.length) { qText = segs[i + 1]; i += 1; }
      else if (segs[i] === 'f' && i + 2 < segs.length) { slugs = segs[i + 1].split('+'); ids = segs[i + 2].split('+'); i += 2; }
    }
    if (ids.includes(facet.id)) return url; // facette déjà posée
    // Retire les tokens du modèle du texte libre (ils passent en facette).
    const modelTokens = new Set(mpNormalize(modelText).split('+').filter(Boolean));
    const remaining = qText.split('+').filter((t) => t && !modelTokens.has(t));
    const newSlugs = [facet.slug, ...slugs];
    const newIds = [facet.id, ...ids];
    const path = ['', ...head, ...(remaining.length ? ['q', remaining.join('+')] : []), 'f', newSlugs.join('+'), newIds.join('+'), ''].join('/');
    u.pathname = path;
    return u.toString();
  } catch {
    return url;
  }
}

// ─── Learned secondary params (BACKLOG 2bis) ─────────────────────────────────
//
// A confirmed ingestion stores EVERY confirmed field↔param pair in
// fieldToParam (e.g. Bilbasen power → hpfrom), and opaque enum codes in
// linkgen_enum_mappings (e.g. Bilbasen fuel code '3' ↔ ELECTRIQUE). Re-inject
// them when regenerating a URL so a validated mapping is immediately reusable
// for any criterion — numeric fields carry the user's value, enum fields carry
// the learned site code (never guessed: no learned code → param untouched).

const LEARNED_ENUM_FIELDS = ['fuel', 'gearbox', 'color', 'vehicleType'] as const;

/**
 * A reused validated_url embeds the ORIGINAL ingestion's year/mileage values —
 * variables by design. Override them with the current request's values (or
 * remove them when the request doesn't filter), in the query string AND in a
 * Marktplaats-style `#key:value|…` hash.
 */
function overrideVariableParams(url: string, mapping: InferredMapping, params: LinkGenParams): string {
  const { yearFrom, yearTo } = resolveYearRange(params);
  // Leboncoin : la grammaire kilométrage PROUVÉE (8 URLs humaines en mémoire)
  // est `mileage=min-90000` — le littéral `min` fait partie de la syntaxe du
  // site. La valeur nue (`mileage=90000`) est lue comme borne BASSE : toutes
  // les voitures sous le plafond disparaissent (études GR SPORT à 0 dès
  // l'ajout du critère 90 000 km, 29/07).
  const isLbc = url.includes('leboncoin.fr');
  const mileageValue = params.mileage
    ? (isLbc ? `min-${params.mileage}` : String(params.mileage))
    : '';
  const overrides: Array<[string | undefined, string]> = [
    [mapping.yearFromParam ?? mapping.fieldToParam?.year?.paramName, yearFrom],
    [mapping.yearToParam ?? mapping.fieldToParam?.yearTo?.paramName, yearTo],
    [mapping.mileageParam ?? mapping.fieldToParam?.mileage?.paramName, mileageValue],
  ];
  try {
    let out = url;
    const hashIdx = out.indexOf('#');
    let hash = hashIdx >= 0 ? out.slice(hashIdx + 1) : '';
    const hashStyle = hash.includes(':'); // Marktplaats `#q:…|mileageTo:…`
    for (const [param, value] of overrides) {
      if (!param || param.startsWith('_path')) continue;
      if (hashStyle) {
        const parts = hash.split('|').filter((seg) => seg && !seg.startsWith(`${param}:`));
        if (value) parts.push(`${param}:${value}`);
        hash = parts.join('|');
      } else {
        out = setQueryParamRaw(out, param, value || null);
      }
    }
    if (hashStyle) {
      const base = out.indexOf('#') >= 0 ? out.slice(0, out.indexOf('#')) : out;
      out = hash ? `${base}#${hash}` : base;
    }
    return out;
  } catch {
    return url;
  }
}

/**
 * AS24 + hybride rechargeable : fuel=2 couvre TOUS les hybrides, aucun code ne
 * distingue les PHEV (constat opérateur 01/08 : le filtre du site ne fonctionne
 * pas). Le resserrage passe par le texte : « PHEV » devant la finition dans
 * kwd=. L'adaptateur le fait sur les URL construites ; ce correctif couvre la
 * voie URL APPRISE, qui ne repasse pas par l'adaptateur. Idempotent, et
 * strictement limité aux hôtes autoscout24 + carburant PLUG_IN_HYBRID.
 */
/**
 * Gaspedaal/Subito : les campagnes DÉCOUVERTE scrapent en tri pertinence
 * (couverture de gamme) — une URL apprise pendant une découverte porte donc
 * srt=df-a / order=relevance. Les études et campagnes précision, elles,
 * exigent le PRIX CROISSANT (le bas du marché fait le prix). Ce correctif
 * l'impose sur la voie URL APPRISE, qui ne repasse pas par l'adaptateur.
 * Idempotent, limité à ces deux hôtes ; paramètres prouvés par paires
 * d'URLs humaines (02/08 : srt=pr-a/df-a, order=priceasc/relevance).
 */
export function enforcePriceSort(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('gaspedaal.nl')) return setQueryParamRaw(url, 'srt', 'pr-a');
    if (host.includes('subito.it')) return setQueryParamRaw(url, 'order', 'priceasc');
  } catch { /* URL illisible — inchangée */ }
  return url;
}

export function ensureAs24PhevKeyword(url: string, params: LinkGenParams): string {
  const fuelUp = String(params.fuel ?? '').trim().toUpperCase();
  if (fuelUp !== 'PLUG_IN_HYBRID' && fuelUp !== 'PHEV') return url;
  try {
    const u = new URL(url);
    if (!u.hostname.includes('autoscout24.')) return url;
    const cur = (u.searchParams.get('kwd') ?? '').trim();
    if (/\bphev\b/i.test(cur)) return url;
    return setQueryParamRaw(url, 'kwd', cur ? `PHEV ${cur}` : 'PHEV');
  } catch { return url; }
}

function numericParamValue(field: string, params: LinkGenParams): string | undefined {
  const raw =
    field === 'power' ? params.minPower :
    field === 'doors' ? params.doors :
    field === 'seats' ? params.seats :
    undefined;
  const s = raw != null ? String(raw).trim() : '';
  return /^\d+$/.test(s) ? s : undefined;
}

async function applyLearnedSecondaryParams(
  url: string,
  site: SiteKey,
  mapping: InferredMapping,
  params: LinkGenParams,
  logs: LinkGenLogEntry[]
): Promise<string> {
  const fieldToParam = mapping.fieldToParam ?? {};
  const hash = url.indexOf('#') >= 0 ? url.slice(url.indexOf('#')) : '';
  let out = url;

  for (const [field, seg] of Object.entries(fieldToParam)) {
    if (!seg?.paramName || seg.paramName.startsWith('_path')) continue; // path/hash IDs: template's job
    if (hash.includes(`${seg.paramName}:`)) continue; // hash-param sites (Marktplaats)
    // minPower is a LOWER bound — never inject it into an upper-bound param
    // (powerto/hpto) a confirmed mapping may have attributed to 'power'.
    if (field === 'power' && /to$|max/i.test(seg.paramName)) continue;

    // Numeric criteria: transparent values, inject directly.
    const numeric = numericParamValue(field, params);
    if (numeric !== undefined) {
      out = setQueryParamRaw(out, seg.paramName, numeric);
      logs.push({ level: 'MAPPING', message: `[MAPPING_MEMORY] Learned param ${seg.paramName}=${numeric} (${field})`, data: {} });
      continue;
    }

    // Enum criteria: only inject a HUMAN-CONFIRMED site code.
    if ((LEARNED_ENUM_FIELDS as readonly string[]).includes(field)) {
      const label = String((params as unknown as Record<string, unknown>)[field] ?? '').trim();
      if (!label) continue;
      const { data } = await supabase
        .from('linkgen_enum_mappings')
        .select('code')
        .eq('site', site)
        .eq('field', field)
        .ilike('label', label)
        .maybeSingle();
      if (data?.code) {
        out = setQueryParamRaw(out, seg.paramName, data.code);
        logs.push({ level: 'MAPPING', message: `[MAPPING_MEMORY] Learned enum ${seg.paramName}=${data.code} (${field}=${label})`, data: {} });
      }
    }
  }
  return out;
}

/**
 * Memory-first async variant of generateSearchUrls.
 * For each site, looks up linkgen_mapping_memory for a validated mapping
 * (validation_status = 'valid', confidence >= 0.75).
 * Falls back to the standard template if no valid mapping found.
 *
 * The original generateSearchUrls() is NOT modified — it stays synchronous.
 */
export async function generateSearchUrlsWithMemory(
  params: LinkGenParams
): Promise<LinkGenUrlResult[]> {
  // Codes taxonomie moissonnés (marques/modèles mobile.de) → adaptateurs,
  // une fois par session : sans ça le FRONT ne connaît que les graines.
  await ensureLearnedTaxonomy().catch(() => { /* dictionnaire indisponible — graines seules */ });
  const sites = params.selectedSites ?? (params.site ? [params.site] : []);
  const results: LinkGenUrlResult[] = [];

  for (const site of sites) {
    const logs: LinkGenLogEntry[] = [];
    const adapter = getSiteAdapter(site);

    // Look up validated mappings in memory — several rows can exist for the
    // same brand+model (fuel/trim variants); prefer the one matching the
    // requested fuel/trim, then the neutral (no fuel/trim) one.
    const { data: memoryRows } = await supabase
      .from('linkgen_mapping_memory')
      .select('*')
      .eq('site', site)
      .ilike('brand', params.brand ?? '')
      .ilike('model', params.model ?? '')
      .eq('validation_status', 'valid')
      .gte('confidence', 0.75)
      .order('confidence', { ascending: false })
      .limit(5);
    const wantFuel = (params.fuel ?? '').trim().toUpperCase();
    const wantTrim = (params.trim ?? '').trim().toUpperCase();
    const rowFuel = (r: Record<string, unknown>) => String(r.fuel ?? '').trim().toUpperCase();
    const rowTrim = (r: Record<string, unknown>) => String(r.trim ?? '').trim().toUpperCase();
    const candidates = (memoryRows ?? []) as unknown as Array<Record<string, unknown>>;
    const memoryRecord =
      candidates.find((r) => rowFuel(r) === wantFuel && rowTrim(r) === wantTrim) ??
      candidates.find((r) => rowFuel(r) === '' && rowTrim(r) === '') ??
      candidates[0] ?? null;

    if (memoryRecord) {
      const record = memoryRecord as unknown as MappingMemoryRecord;
      const mapping = (record.validated_mapping ?? record.inferred_mapping) as InferredMapping | null;

      logs.push({
        level: 'INPUT',
        message: '[MAPPING_MEMORY] Found validated mapping',
        data: {
          site,
          confidence: String(record.confidence),
          validation_status: record.validation_status,
          source_url: record.source_url ?? '',
        },
      });

      // BEST source: the human-validated URL itself — it carries site-specific
      // path facets (Marktplaats model IDs) no template can rebuild. Usable
      // only when its fuel/trim scope matches the request; year/mileage are
      // variables and get overridden below.
      const recFuel = rowFuel(memoryRecord as Record<string, unknown>);
      const recTrim = rowTrim(memoryRecord as Record<string, unknown>);
      // Une URL apprise portant un placeholder brut ('{query}') est une ligne
      // mémoire polluée (écho de template) — jamais réutilisable telle quelle.
      const validatedUrlRaw = (record as unknown as { validated_url?: string | null }).validated_url ?? null;
      const validatedUrl = validatedUrlRaw && !validatedUrlRaw.includes('{') ? validatedUrlRaw : null;
      // A trim-less learned URL still pins brand+model via its path facets —
      // it can serve a trim request too: the trim goes into the site's
      // free-text slot below (Marktplaats `q:` = the Variant box, AS24 kwd=).
      const scopeMatches = (recFuel === wantFuel || (recFuel === '' && wantFuel === '')) &&
        (recTrim === wantTrim || recTrim === '');
      if (validatedUrl && scopeMatches && mapping) {
        let url = overrideVariableParams(validatedUrl, mapping, params);
        url = enforcePriceSort(url);
        // AS24: even a trim-scoped learned URL can predate kwd= (daily report:
        // GR SPORT study reused a kwd-less URL → 6% trim match). Setting kwd is
        // idempotent, so guarantee it. Marktplaats keeps the trim-less-row-only
        // rule: replacing q: on a trim-scoped learned URL would lose its text.
        if (wantTrim && (recTrim === '' || url.includes('autoscout24.') || url.includes('gaspedaal.nl'))) {
          url = injectTrimIntoUrl(url, params.trim ?? '');
        }
        url = ensureAs24PhevKeyword(url, params);
        url = await applyLearnedSecondaryParams(url, site, mapping, params, logs);
        // REGISTRE UNIQUE en DERNIER : réparations + année/km/puissance/boîte
        // (chaque paramètre posé-ou-retiré, anti-fossile) + canal finition LBC
        // + politiques de site — il écrase toute réinjection héritée (unités
        // comprises : les params secondaires appris réinjecteraient des ch là
        // où AS24/mobile.de/Skelbiu lisent des kW).
        url = applyVariableCriteria(url, params);
        logs.push({
          level: 'OUTPUT',
          message: '[MAPPING_MEMORY] Reusing human-validated URL (variables overridden)',
          data: { url },
        });
        results.push({
          site,
          country: adapter.country,
          url,
          debugLogs: logs,
          warnings: [],
          validationStatus: 'not_checked',
          mappingSource: 'learned',
        });
        continue;
      }

      // PAS de reconstruction par template ici : cette voie strippait
      // silencieusement les critères qu'elle ne savait pas placer (AS24 NL
      // 27/07 : URL sans carburant ni finition sur l'étude RAV4 GR SPORT).
      // Quand l'URL validée n'est pas réutilisable, la seule voie sûre est la
      // grammaire native de l'adaptateur (buildSearchUrl, fallback ci-dessous)
      // + les paramètres secondaires appris par-dessus.
      logs.push({
        level: 'INPUT',
        message: '[MAPPING_MEMORY] Validated URL not reusable for this scope — native grammar fallback',
        data: { site, wantFuel, wantTrim, recFuel: rowFuel(memoryRecord as Record<string, unknown>), recTrim: rowTrim(memoryRecord as Record<string, unknown>) },
      });
    } else {
      logs.push({
        level: 'INPUT',
        message: '[MAPPING_MEMORY] No validated mapping found — using default template',
        data: { site, brand: params.brand ?? '', model: params.model ?? '' },
      });
    }

    // Fallback to standard template
    const singleParams = { ...params, site };
    const fallbackResult = generateSearchUrl(singleParams);

    // Even on template fallback, a memory record's learned secondary params
    // (power/doors/seats + enum codes) still apply on top of the template URL.
    let fallbackUrl = fallbackResult.url;
    // Facette modèle Marktplaats apprise par N'IMPORTE QUELLE ligne mémoire du
    // modèle (même à scope carburant/finition différent) : retrofittée sur
    // l'URL native — le modèle sort du texte libre, la finition y reste seule.
    if (site === 'MARKTPLAATS' && params.model) {
      const facet = extractMarktplaatsModelFacet(candidates);
      if (facet) {
        const before = fallbackUrl;
        fallbackUrl = applyMarktplaatsModelFacet(fallbackUrl, facet, params.model);
        if (fallbackUrl !== before) {
          logs.push({
            level: 'MAPPING',
            message: '[MAPPING_MEMORY] Facette modèle Marktplaats retrofittée depuis la mémoire',
            data: { slug: facet.slug, id: facet.id, url: fallbackUrl },
          });
        }
      }
    }
    if (memoryRecord) {
      const record = memoryRecord as unknown as MappingMemoryRecord;
      const mapping = (record.validated_mapping ?? record.inferred_mapping) as InferredMapping | null;
      if (mapping) fallbackUrl = await applyLearnedSecondaryParams(fallbackUrl, site, mapping, params, logs);
    }
    // REGISTRE UNIQUE aussi sur la voie native : idempotent quand l'adaptateur
    // a tout posé (mêmes grammaires prouvées), filet quand une réinjection
    // apprise a déposé une unité ou une forme fausse par-dessus.
    fallbackUrl = applyVariableCriteria(fallbackUrl, params);

    results.push({
      site,
      country: adapter.country,
      url: fallbackUrl,
      debugLogs: [...logs, ...fallbackResult.debugLogs],
      warnings: fallbackResult.debugLogs
        .filter((l) => l.level === 'WARNING')
        .map((l) => l.message),
      validationStatus: fallbackUrl.includes(adapter.domain)
        ? 'not_checked'
        : 'invalid',
      mappingSource: 'default_template',
    });
  }

  return results;
}
