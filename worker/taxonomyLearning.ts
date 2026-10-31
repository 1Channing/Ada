/**
 * L'APPRENTISSAGE DES SITES, CÔTÉ WORKER (30/10, Channing : « Il est important que nous ne polluons pas nos
 * taxonomies, elles doivent être parfaites. Il est également important que ce soit automatisé »).
 *
 * - Toutes les 60 s, deux à la fois : les adresses proposées par Claude (linkgen_learning_items « proposee »).
 *   La règle est DÉDUITE (src/lib/linkgen/learning.ts) — sinon la ligne repart « à chercher » avec le motif
 *   (refus automatique : autre site, autre filtre touché, finition, mauvaise valeur). Puis DEUX scrapes : l'adresse
 *   de Claude, et une adresse construite par ADA avec la règle (une autre valeur, ou une autre marque, ou une
 *   année en plus) — c'est le lien « Vérifier sur le site ». La ligne passe « à valider » avec les deux contrôles.
 * - Toutes les heures :
 *   · Jófogás : le catalogue OFFICIEL des modèles d'une marque (service searchparams du site) remplit le
 *     dictionnaire exact (jf:modelid) — les modèles de cette marque se règlent sans Claude ;
 *   · les lignes qu'ADA sait désormais écrire (moisson, catalogue, autre validation) se ferment (« résolue ») ;
 *   · trois règles validées au plus sont re-testées, chacune une fois par semaine : deux échecs de suite →
 *     suspendue, la ligne repart à chercher, alerte dans la cloche ;
 *   · à partir de 8 h (Paris), une fois par jour : « N lignes à valider » dans la cloche.
 * Table absente (SQL du 30/10 pas encore collé) : un avertissement, puis le silence.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { getSiteAdapter } from '../src/lib/study-core/marketplaces';
import type { SiteAdapter, SearchCriteria } from '../src/lib/study-core/marketplaces/types';
import type { ScrapedListing } from '../src/lib/study-core/types';
import { analyzeIngestion, type IngestionField } from '../src/lib/study-core/ingestion';
import { persistTaxonomyHarvest, ensureLearnedTaxonomy } from '../src/lib/linkgen/taxonomy';
import { applyVariableCriteria, missingUrlCriteria } from '../src/lib/linkgen/grammar';
import { loadLearnedRules, learnedRulesFor } from '../src/lib/linkgen/learnedRules';
import { refModelKey } from '../src/services/marketData';
import {
  deduceModelFragment, deduceFilterRule, applyModelFragment, applyLearnedFilters, checkNumeric, verifyValueFor,
  ruleValueKey, brandKeyOf, isLearnableCriterion, isNumericCriterion, criterionParams, CRITERION_LABEL,
  type ModelFragment, type FilterRule, type LearnedRuleRow, type LearnableCriterion, type LearningParams,
} from '../src/lib/linkgen/learning';
import { healOpenGaps } from '../src/lib/linkgen/gapHealing';
import { modelCandidates, modelLabelForms } from '../src/lib/linkgen/modelProbe';
import { mcExportAccounts } from './agents/recap';

type Sb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const sb = () => supabase as unknown as Sb;

/** Ce qu'un scrape rend ici (sous-ensemble de ScrapeSearchResult, worker/scraper.ts). */
export interface ScrapeLite {
  listings: ScrapedListing[];
  error?: string;
  diagnostics?: { taxonomyHarvest?: Array<{ field: string; code: string; label: string }> } | null;
}
export interface LearningDeps {
  scrape: (url: string) => Promise<ScrapeLite>;
  /** Lecture directe d'une page ou d'un JSON public (catalogue Jófogás) ; null = échec. */
  fetchText: (url: string) => Promise<string | null>;
}

const defaultDeps: LearningDeps = {
  scrape: async (url) => {
    const { scrapeSearch } = await import('./scraper');
    return scrapeSearch(url, 'full', { maxPagesCap: 1, maxListingsCap: 40 });
  },
  fetchText: async (url) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', Accept: 'text/html,application/json' } });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  },
};

interface Item {
  id: string; kind: 'modele' | 'filtre'; site: string; brand: string; model: string; criterion: string; value: string;
  start_url: string | null; proposed_url: string | null; status: string; attempts: number;
  /** Le nom exact lu sur le site par Claude (SQL du 31/10) — ADA en construit et vérifie l'adresse. */
  proposed_label?: string | null;
}
const ITEM_COLS = 'id, kind, site, brand, model, criterion, value, start_url, proposed_url, status, attempts';

/** Un même scrape au plus une fois par passage (l'adresse candidate trouvée est re-lue par le contrôle). */
const memoScrape = (deps: LearningDeps): LearningDeps => {
  const memo = new Map<string, Promise<ScrapeLite>>();
  return { ...deps, scrape: (u) => { if (!memo.has(u)) memo.set(u, deps.scrape(u)); return memo.get(u)!; } };
};

let warned = false;
const tableMissing = (e: { message: string } | null): boolean => {
  if (!e) return false;
  if (!warned) console.warn(`[APPRENTISSAGE] file illisible (SQL du 30/10 à coller ?) : ${e.message}`);
  warned = true;
  return true;
};

// ─── Contrôler une proposition ────────────────────────────────────────────────────────────────────

/** Une marque de repli pour vérifier une règle propre à une valeur (code, segment) sur une autre marque. */
const OTHER_BRANDS = ['VOLKSWAGEN', 'TOYOTA', 'PEUGEOT', 'RENAULT', 'BMW'];
const thisYear = () => new Date().getFullYear();

/** L'adresse construite par ADA avec la règle candidate — le lien « Vérifier sur le site ». */
export function buildVerification(adapter: SiteAdapter, item: Pick<Item, 'kind' | 'site' | 'brand' | 'model' | 'criterion' | 'value'>, rule: ModelFragment | FilterRule, valueKey: string):
  { url: string | null; brand: string; value: string; params: LearningParams } {
  if (item.kind === 'modele') {
    // Le modèle appris POSÉ sur la page marque avec une année en plus : la règle tient-elle avec d'autres critères ?
    const params: LearningParams = { brand: item.brand, model: '', yearFrom: String(thisYear() - 6) };
    const base = applyVariableCriteria(adapter.buildSearchUrl(params).url, params);
    return { url: base ? applyModelFragment(base, rule as ModelFragment) : null, brand: item.brand, value: '', params: { ...params, model: item.model } };
  }
  const c = item.criterion as LearnableCriterion;
  const perValue = (rule as FilterRule).encoding === 'code' || (rule as FilterRule).encoding === 'segment';
  const brand = perValue ? (OTHER_BRANDS.find((b) => brandKeyOf(b) !== brandKeyOf(item.brand)) ?? item.brand) : (item.brand || 'TOYOTA');
  const value = perValue ? item.value : verifyValueFor(c, item.value);
  const params: LearningParams = { brand, model: '', ...criterionParams(c, value) };
  const native = applyVariableCriteria(adapter.buildSearchUrl(params).url, params);
  const row: LearnedRuleRow = { id: 'candidate', site: item.site, kind: 'filtre', brand_key: '', model_key: '', criterion: c, value_key: valueKey, rule, status: 'active' };
  const res = applyLearnedFilters(native, params, [row], new Set(missingUrlCriteria(native, params)));
  return { url: res.applied.includes(c) ? res.url : null, brand, value, params };
}

const FIELD_OF: Partial<Record<LearnableCriterion, IngestionField>> = { fuel: 'fuel', gearbox: 'gearbox', vehicleType: 'vehicleType' };
const FIELD_FR: Partial<Record<IngestionField, string>> = { brand: 'marque', model: 'modèle', fuel: 'carburant', gearbox: 'boîte', vehicleType: 'carrosserie' };
const fr = (f: IngestionField) => FIELD_FR[f] ?? f;

export interface Evaluation {
  verdict: 'ok' | 'echec' | 'humain' | 'impossible';
  url: string;
  sample: number;
  detail: string;
  titles: string[];
  /** Fiable à 100 % (31/10, Channing : « lorsqu'il est fiable à 100 % se fasse automatique ») : TOUTES les annonces
   *  renseignées conformes, et au moins AUTO_MIN d'entre elles. */
  strict?: boolean;
}

/** Au moins 5 annonces renseignées, toutes conformes, sur CHACUNE des deux adresses : validé sans humain. */
export const AUTO_MIN = 5;

/** Les annonces d'une adresse confirment-elles ce qui a été appris ? */
export function evaluate(adapter: SiteAdapter, kind: 'modele' | 'filtre', criterion: string, url: string, criteria: SearchCriteria, value: string, r: ScrapeLite | null): Evaluation {
  const listings = r?.listings ?? [];
  const titles = listings.slice(0, 3).map((l) => l.title).filter(Boolean);
  if (!r || listings.length === 0) {
    return { verdict: 'impossible', url, sample: 0, detail: r?.error ? `scrape en échec : ${r.error}` : 'aucune annonce lue', titles };
  }
  if (kind === 'filtre' && isLearnableCriterion(criterion) && isNumericCriterion(criterion)) {
    const n = checkNumeric(criterion, value, listings as never);
    return {
      verdict: n.verdict, url, sample: listings.length, titles, strict: n.considered >= AUTO_MIN && n.matching === n.considered,
      detail: `${n.matching}/${n.considered} annonce(s) renseignée(s) conformes (${CRITERION_LABEL[criterion]} ${value})`,
    };
  }
  const fields: IngestionField[] = kind === 'modele' ? ['brand', 'model'] : [FIELD_OF[criterion as LearnableCriterion] ?? 'brand'];
  if (listings.length < 3) return { verdict: 'humain', url, sample: listings.length, detail: `${listings.length} annonce(s) seulement : à juger sur la page`, titles };
  const a = analyzeIngestion(url, criteria, listings, adapter);
  const bad = a.confirmations.filter((c) => fields.includes(c.field) && c.status === 'rejected');
  const good = a.confirmations.filter((c) => fields.includes(c.field) && c.status === 'confirmed');
  if (bad.length) return { verdict: 'echec', url, sample: listings.length, detail: bad.map((c) => `${fr(c.field)} : ${c.reason ?? `${c.matchCount}/${c.sampleSize}`}`).join(' ; '), titles };
  if (good.length === fields.length) {
    const strict = good.every((c) => c.sampleSize >= AUTO_MIN && c.matchCount === c.sampleSize);
    return { verdict: 'ok', url, sample: listings.length, detail: good.map((c) => `${fr(c.field)} ${c.matchCount}/${c.sampleSize} conformes`).join(' ; '), titles, strict };
  }
  return { verdict: 'humain', url, sample: listings.length, detail: 'contrôle incomplet : à juger sur la page', titles };
}

const combine = (a: Evaluation['verdict'], b: Evaluation['verdict'] | null): Evaluation['verdict'] => {
  const all = [a, b ?? 'impossible'];
  if (all.includes('echec')) return 'echec';
  if (all.every((v) => v === 'ok')) return 'ok';
  if (all.every((v) => v === 'impossible')) return 'impossible';
  return 'humain';
};

/**
 * Les lignes en cours de contrôle dans ce processus (31/10) : jamais deux contrôles de la même ligne en même temps.
 * L'essai seul d'ADA passe une ligne « proposee » puis la contrôle aussitôt ; sans ce verrou, le passage des
 * propositions (60 s) la reprenait en parallèle — deux scrapes de trop, un journal trompeur, et dans un cas rare
 * une règle active pendant que la ligne restait « à valider ».
 */
const inCheck = new Set<string>();
/** Une écriture gardée par le statut a-t-elle touché la ligne ? (.select('id') : les lignes réellement modifiées) */
const touched = (r: { data?: unknown } | null | undefined) => Array.isArray(r?.data) && r.data.length > 0;
const whatOf = (it: Item) => `${it.site} ${it.kind === 'modele' ? `${it.brand} ${it.model}` : `${it.criterion} ${it.value}`}`;
type Written = { data?: unknown; error?: { message?: string } | null } | null | undefined;
const changedMeanwhile = (it: Item, r?: Written) => console.warn(`[APPRENTISSAGE] ${whatOf(it)} : ${r?.error
  ? `écriture en échec (${r.error.message ?? 'erreur inconnue'}) — la ligne sera reprise au prochain passage`
  : 'la ligne a changé pendant le contrôle (décision prise ailleurs) — rien écrit'}`);

async function refuse(it: Item, reasons: string[]): Promise<void> {
  const r = await sb().from('linkgen_learning_items').update({
    status: 'a_chercher', decision_note: `Refus automatique : ${reasons.join(' ; ')}`.slice(0, 500), attempts: (it.attempts ?? 0) + 1,
    proposed_url: null, learned: null, check_result: null, verify_url: null, updated_at: new Date().toISOString(),
  }).eq('id', it.id).eq('status', 'proposee').select('id');
  if (!touched(r)) { changedMeanwhile(it, r); return; }
  console.warn(`[APPRENTISSAGE] ${it.site} ${it.kind === 'modele' ? `${it.brand} ${it.model}` : it.criterion} : refus automatique — ${reasons.join(' ; ')}`);
}

async function harvest(adapter: SiteAdapter, r: ScrapeLite | null): Promise<void> {
  const taxo = r?.diagnostics?.taxonomyHarvest;
  if (taxo?.length) await persistTaxonomyHarvest(adapter.key, taxo).catch(() => undefined);
}

/**
 * VALIDATION AUTOMATIQUE (31/10, Channing : « Je veux que l'apprentissage de taxonomie lorsqu'il est fiable à 100 %
 * se fasse automatique […] intervenir le moins possible ») : règle exacte, aucun conflit, et les DEUX adresses
 * (Claude, ADA) à 100 % sur au moins 5 annonces. La règle entre active, la ligne passe « validée » ; sinon elle
 * reste « à valider ». Une course avec une autre validation (index unique) la laisse aussi à valider. Si la ligne
 * a changé pendant le contrôle (plus « proposee »), la règle tout juste écrite est effacée : jamais de règle active
 * sans sa ligne validée.
 */
async function autoValidate(it: Item, learned: Record<string, unknown>, check: Record<string, unknown>, verifyUrl: string | null, detail: string): Promise<boolean> {
  const at = new Date().toISOString();
  const { data: rule, error } = await sb().from('linkgen_learned_rules').insert({
    site: it.site, kind: it.kind, brand_key: learned.brand_key, model_key: learned.model_key, brand: it.brand, model: it.model,
    criterion: it.kind === 'filtre' ? it.criterion : '', value_key: learned.value_key, value: it.value, rule: learned.rule,
    status: 'active', item_id: it.id, proof_url: it.proposed_url, verify_url: verifyUrl, check_result: check, validated_by: null, validated_at: at,
    last_check_at: at, // contrôlée à l'instant : le re-test hebdomadaire part d'ici
  }).select('id').single();
  if (error || !rule?.id) return false;
  const r = await sb().from('linkgen_learning_items').update({
    status: 'validee', learned, check_result: check, verify_url: verifyUrl, decided_by: null, decided_at: at,
    decision_note: `Validé automatiquement : contrôles à 100 % (${detail})`.slice(0, 500), updated_at: at,
  }).eq('id', it.id).eq('status', 'proposee').select('id');
  if (!touched(r)) {
    await sb().from('linkgen_learned_rules').delete().eq('id', rule.id);
    return false;
  }
  if (it.kind === 'modele') await healOpenGaps(it.site, it.brand, it.model).catch(() => 0);
  await loadLearnedRules().catch(() => undefined);
  return true;
}

/** Ce que devient une proposition ; « deja_traitee » : la ligne a changé pendant le contrôle, rien n'est écrit. */
export type Outcome = 'validee' | 'a_valider' | 'refusee' | 'deja_traitee';

/** Une proposition : déduction, contrôles, validation automatique à 100 % ou « à valider » (exporté pour les tests). */
export async function checkProposal(it: Item, deps: LearningDeps = defaultDeps): Promise<Outcome> {
  const adapter = getSiteAdapter(it.site);
  if (!adapter) { await refuse(it, [`site inconnu (${it.site})`]); return 'refusee'; }
  const start = it.start_url ?? '', proposed = it.proposed_url ?? '';
  let rule: ModelFragment | FilterRule;
  let change: string;
  let brandKey = '', modelKey = '', valueKey = '';
  if (it.kind === 'modele') {
    const d = deduceModelFragment(start, proposed, adapter.domain);
    if ('reasons' in d) { await refuse(it, d.reasons); return 'refusee'; }
    rule = d.learned; change = d.change;
    brandKey = brandKeyOf(it.brand); modelKey = refModelKey(it.brand, it.model);
  } else {
    if (!isLearnableCriterion(it.criterion)) { await refuse(it, [`critère non apprenable (${it.criterion})`]); return 'refusee'; }
    const d = deduceFilterRule(it.criterion, it.value, start, proposed, adapter.domain);
    if ('reasons' in d) { await refuse(it, d.reasons); return 'refusee'; }
    rule = d.learned; change = d.change;
    valueKey = ruleValueKey(it.criterion, d.learned, it.value);
  }
  // Jamais deux règles actives pour le même cas : signalé tout de suite (la validation le refusera aussi).
  const { data: twins } = await sb().from('linkgen_learned_rules').select('id')
    .eq('status', 'active').eq('site', it.site).eq('kind', it.kind).eq('brand_key', brandKey).eq('model_key', modelKey)
    .eq('criterion', it.kind === 'filtre' ? it.criterion : '').eq('value_key', valueKey).limit(1);
  const conflict = ((twins ?? []) as unknown[]).length > 0;

  const verif = buildVerification(adapter, it, rule, valueKey);
  const criteriaA: SearchCriteria = it.kind === 'modele'
    ? { brand: it.brand, model: it.model }
    : { brand: it.brand, model: '', ...criterionParams(it.criterion as LearnableCriterion, it.value) };
  const ra = await deps.scrape(proposed).catch((e: unknown) => ({ listings: [], error: e instanceof Error ? e.message : String(e) }) as ScrapeLite);
  const rb = verif.url ? await deps.scrape(verif.url).catch((e: unknown) => ({ listings: [], error: e instanceof Error ? e.message : String(e) }) as ScrapeLite) : null;
  await harvest(adapter, ra); await harvest(adapter, rb);
  const evA = evaluate(adapter, it.kind, it.criterion, proposed, criteriaA, it.value, ra);
  const evB = verif.url ? evaluate(adapter, it.kind, it.criterion, verif.url, verif.params, verif.value, rb) : null;
  const verdict = combine(evA.verdict, evB?.verdict ?? null);
  const check = {
    verdict, conflict, change,
    claude: evA,
    ada: evB ?? { verdict: 'impossible', url: '', sample: 0, detail: "ADA n'a pas pu construire l'adresse de vérification avec cette règle", titles: [] },
    checked_at: new Date().toISOString(),
  };
  const learned = { brand_key: brandKey, model_key: modelKey, value_key: valueKey, rule, change };
  const what = whatOf(it);
  if (verdict === 'ok' && !conflict && evA.strict && evB?.strict
    && await autoValidate(it, learned, check, verif.url, `${evA.detail} ; ${evB.detail}`)) {
    console.warn(`[APPRENTISSAGE] ${what} : ${change} → validé automatiquement (contrôles à 100 %)`);
    return 'validee';
  }
  const r = await sb().from('linkgen_learning_items').update({
    status: 'a_valider', learned, check_result: check, verify_url: verif.url, updated_at: new Date().toISOString(),
  }).eq('id', it.id).eq('status', 'proposee').select('id');
  if (!touched(r)) { changedMeanwhile(it, r); return 'deja_traitee'; }
  console.warn(`[APPRENTISSAGE] ${what} : ${change} → contrôle ${verdict}${conflict ? ' (conflit avec une règle active)' : ''}, à valider`);
  return 'a_valider';
}

let busy = false;
/** Le passage des propositions (exporté pour les tests). */
export async function learningProposalsTick(deps: LearningDeps = defaultDeps): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    // proposed_label : SQL du 31/10 — sans lui, la file se lit comme avant (adresses seulement).
    let res = await sb().from('linkgen_learning_items').select(`${ITEM_COLS}, proposed_label`)
      .eq('status', 'proposee').order('proposed_at', { ascending: true }).limit(6);
    if (res.error && /proposed_label/.test(res.error.message)) {
      res = await sb().from('linkgen_learning_items').select(ITEM_COLS).eq('status', 'proposee').order('proposed_at', { ascending: true }).limit(6);
    }
    if (tableMissing(res.error)) return 0;
    const d = memoScrape(deps);
    let n = 0;
    // Une ligne déjà en contrôle (l'essai seul d'ADA la contrôle lui-même) n'est pas reprise.
    for (const it of ((res.data ?? []) as Item[]).filter((x) => !inCheck.has(x.id)).slice(0, 2)) {
      inCheck.add(it.id);
      try {
        if (it.proposed_url) await checkProposal(it, d);
        else if (it.kind === 'modele' && it.proposed_label) await checkLabel(it, it.proposed_label, d);
        else await refuse(it, ['proposition vide (ni adresse ni nom)']);
        n++;
      } catch (e) { console.warn(`[APPRENTISSAGE] contrôle en échec (${it.id}) : ${e instanceof Error ? e.message : String(e)}`); }
      finally { inCheck.delete(it.id); }
    }
    return n;
  } finally {
    busy = false;
  }
}

/**
 * L'adresse d'un modèle à partir d'un NOM (31/10) : les adresses candidates « page marque + modèle » (modelProbe.ts)
 * scrapées une à une ; la première dont les annonces sont conformes à 100 % (au moins 5) — null sinon.
 */
export async function findModelUrl(it: Pick<Item, 'site' | 'brand' | 'model'>, name: string, deps: LearningDeps): Promise<{ url: string | null; tried: string[] }> {
  const adapter = getSiteAdapter(it.site);
  if (!adapter) return { url: null, tried: [] };
  const tried: string[] = [];
  for (const url of modelCandidates(adapter, it.brand, name)) {
    tried.push(url);
    const r = await deps.scrape(url).catch(() => null);
    await harvest(adapter, r);
    const ev = evaluate(adapter, 'modele', '', url, { brand: it.brand, model: it.model }, '', r);
    if (ev.verdict === 'ok' && ev.strict) return { url, tried };
  }
  return { url: null, tried };
}

/** Le nom exact envoyé par Claude : ADA construit l'adresse, la vérifie, puis le contrôle habituel (exporté pour les tests). */
export async function checkLabel(it: Item, label: string, deps: LearningDeps): Promise<Outcome> {
  const found = await findModelUrl(it, label, deps);
  if (!found.url) {
    await sb().from('linkgen_learning_items').update({ proposed_label: null }).eq('id', it.id).eq('status', 'proposee');
    await refuse(it, [found.tried.length
      ? `avec le nom « ${label} », aucune des ${found.tried.length} adresse(s) construites n'a donné 100 % d'annonces conformes — vérifier l'orthographe exacte sur le site`
      : `ADA ne sait pas construire d'adresse sur ce site à partir d'un nom (identifiant numérique nécessaire)`]);
    return 'refusee';
  }
  const r = await sb().from('linkgen_learning_items').update({ proposed_url: found.url }).eq('id', it.id).eq('status', 'proposee').select('id');
  if (!touched(r)) { changedMeanwhile(it, r); return 'deja_traitee'; }
  return checkProposal({ ...it, proposed_url: found.url }, deps);
}

const probed = new Map<string, number>();
let probeBusy = false;
/**
 * ADA ESSAIE SEULE D'ABORD (31/10, Channing : « intervenir le moins possible ») : toutes les 10 minutes, deux lignes
 * « modèle » au plus, chacune une fois par jour — les écritures connues du nom d'ADA (« CLS-CLASS », « Classe CLS »…).
 * Trouvée à 100 % : la ligne part au contrôle (et à la validation automatique) sans personne. Sinon une note dit à
 * Claude ce qui a été essayé : il ne manque plus que le nom exact affiché sur le site. Exporté pour les tests.
 */
export async function learningProbeTick(deps: LearningDeps = defaultDeps, now = Date.now()): Promise<number> {
  if (probeBusy) return 0;
  probeBusy = true;
  try {
    const { data, error } = await sb().from('linkgen_learning_items').select(ITEM_COLS)
      .eq('status', 'a_chercher').eq('kind', 'modele').order('priority', { ascending: false }).limit(50);
    if (tableMissing(error)) return 0;
    const todo = ((data ?? []) as Item[]).filter((it) => (probed.get(it.id) ?? 0) < now - 86_400_000).slice(0, 2);
    const d = memoScrape(deps);
    let n = 0;
    for (const it of todo) {
      probed.set(it.id, now);
      try {
        const found = await findModelUrl(it, it.model, d);
        if (!found.url) {
          const forms = modelLabelForms(it.model).map((f) => `« ${f} »`).join(', ');
          await sb().from('linkgen_learning_items').update({
            decision_note: (found.tried.length
              ? `ADA a essayé seule ${forms} : aucune adresse à 100 %. Il faut le nom exact affiché sur le site.`
              : 'ADA ne sait pas construire ce modèle à partir d\'un nom sur ce site : il faut le nom exact (ou « Absent du site »).').slice(0, 500),
            updated_at: new Date(now).toISOString(),
          }).eq('id', it.id).eq('status', 'a_chercher');
          continue;
        }
        const at = new Date(now).toISOString();
        // Le verrou AVANT le passage en « proposee » : le passage des propositions ne la reprendra pas en parallèle.
        inCheck.add(it.id);
        try {
          const claimed = await sb().from('linkgen_learning_items').update({ status: 'proposee', proposed_url: found.url, proposed_by: null, proposed_at: at, updated_at: at })
            .eq('id', it.id).eq('status', 'a_chercher').select('id');
          // Proposée (ou écartée) pendant l'essai : c'est cette proposition-là qui compte, rien n'est contrôlé ici.
          if (!touched(claimed)) {
            console.warn(`[APPRENTISSAGE] ${it.site} ${it.brand} ${it.model} : adresse trouvée seule, mais ${claimed?.error
              ? `écriture en échec (${claimed.error.message ?? 'erreur inconnue'})` : 'la ligne a changé entre-temps'} — laissée telle quelle`);
            continue;
          }
          console.warn(`[APPRENTISSAGE] ${it.site} ${it.brand} ${it.model} : adresse trouvée seule (${found.url})`);
          await checkProposal({ ...it, status: 'proposee', proposed_url: found.url }, d);
          n++;
        } finally { inCheck.delete(it.id); }
      } catch (e) { console.warn(`[APPRENTISSAGE] essai seul en échec (${it.id}) : ${e instanceof Error ? e.message : String(e)}`); }
    }
    return n;
  } finally {
    probeBusy = false;
  }
}

// ─── Les passages horaires ────────────────────────────────────────────────────────────────────────

const slugify = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const jofogasDone = new Map<string, number>();

/**
 * Jófogás : le catalogue officiel d'une marque (au plus 3 marques par passage, chacune une fois par jour).
 * Le code marque du site (cb_cars) se lit sur la page marque, la liste { id: libellé } au service searchparams
 * — les mêmes appels que les filtres du site. « Egyéb » (« Autre ») n'est jamais retenu.
 */
export async function jofogasCatalogue(items: Array<Pick<Item, 'site' | 'kind' | 'brand'>>, deps: LearningDeps = defaultDeps, now = Date.now()): Promise<number> {
  const brands = [...new Set(items.filter((i) => i.site === 'JOFOGAS' && i.kind === 'modele' && i.brand).map((i) => i.brand.trim().toUpperCase()))]
    .filter((b) => (jofogasDone.get(b) ?? 0) < now - 86_400_000).slice(0, 3);
  let learned = 0;
  for (const brand of brands) {
    jofogasDone.set(brand, now);
    const slug = slugify(brand);
    const html = await deps.fetchText(`https://auto.jofogas.hu/magyarorszag/auto/${slug}?rs=2000`);
    const next = html?.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    let code = '';
    try { code = String((JSON.parse(next ?? '{}') as { props?: { pageProps?: { selectedParams?: { cb_cars?: unknown } } } }).props?.pageProps?.selectedParams?.cb_cars ?? ''); } catch { /* page illisible */ }
    if (!/^[a-z0-9_]+$/.test(code)) { console.warn(`[APPRENTISSAGE] Jófogás : code marque introuvable pour ${brand}`); continue; }
    const json = await deps.fetchText(`https://searchparams.jofogas.hu/models?cg=2020&cb_cars=${code}`);
    let options: Record<string, unknown> = {};
    try { options = ((JSON.parse(json ?? '{}') as { data?: { options?: Record<string, unknown> } }).data?.options) ?? {}; } catch { /* réponse illisible */ }
    const entries = Object.entries(options)
      .filter(([id, label]) => /^\d+$/.test(id) && typeof label === 'string' && label.trim() && !/^egy[ée]b$/i.test(label.trim()))
      .map(([id, label]) => ({ field: `jf:modelid:${slug}`, code: id, label: String(label).trim() }));
    if (!entries.length) continue;
    await persistTaxonomyHarvest('JOFOGAS', entries).catch(() => undefined);
    learned += entries.length;
    console.warn(`[APPRENTISSAGE] Jófogás : catalogue officiel ${brand} → ${entries.length} modèle(s) au dictionnaire`);
  }
  return learned;
}

/** Les lignes qu'ADA sait désormais écrire, fermées en « résolue » (exporté pour les tests). */
export async function autoResolve(items: Item[]): Promise<number> {
  let n = 0;
  for (const it of items) {
    const adapter = getSiteAdapter(it.site);
    if (!adapter) continue;
    const rules = learnedRulesFor(it.site);
    let known = false;
    if (it.kind === 'modele') {
      const bk = brandKeyOf(it.brand), mk = refModelKey(it.brand, it.model);
      const r = adapter.buildSearchUrl({ brand: it.brand, model: it.model });
      known = rules.some((x) => x.kind === 'modele' && x.brand_key === bk && x.model_key === mk)
        || (Boolean(r.url) && r.modelExpressed !== false && !r.modelGuessed);
    } else if (isLearnableCriterion(it.criterion)) {
      const params: LearningParams = { brand: it.brand || 'TOYOTA', model: '', ...criterionParams(it.criterion, it.value) };
      const url = applyVariableCriteria(adapter.buildSearchUrl(params).url, params);
      const res = applyLearnedFilters(url, params, rules, new Set(missingUrlCriteria(url, params)));
      known = Boolean(url) && !res.gaps.some((g) => g.criterion === it.criterion);
    }
    if (!known) continue;
    await sb().from('linkgen_learning_items').update({ status: 'resolue', decision_note: 'ADA sait désormais l\'écrire (moisson, catalogue ou autre validation)', updated_at: new Date().toISOString() })
      .eq('id', it.id).eq('status', 'a_chercher');
    n++;
  }
  return n;
}

interface RuleRow extends LearnedRuleRow { brand: string; model: string; value: string; fail_count: number; last_check_at: string | null; item_id: string | null }

/** Les règles validées re-testées (trois au plus, une fois par semaine chacune) — exporté pour les tests. */
export async function weeklyRecheck(deps: LearningDeps = defaultDeps, now = new Date()): Promise<number> {
  const { data, error } = await sb().from('linkgen_learned_rules')
    .select('id, site, kind, brand_key, model_key, brand, model, criterion, value_key, value, rule, status, fail_count, last_check_at, item_id')
    .eq('status', 'active').order('last_check_at', { ascending: true }).limit(50);
  if (error) return 0;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const due = ((data ?? []) as RuleRow[]).filter((r) => !r.last_check_at || r.last_check_at < weekAgo).slice(0, 3);
  let n = 0;
  for (const r of due) {
    const adapter = getSiteAdapter(r.site);
    if (!adapter) continue;
    const item = { kind: r.kind, site: r.site, brand: r.brand, model: r.model, criterion: r.criterion, value: r.value };
    const v = buildVerification(adapter, item, r.rule, r.value_key);
    const res = v.url ? await deps.scrape(v.url).catch(() => null) : null;
    const ev = v.url ? evaluate(adapter, r.kind, r.criterion, v.url, v.params, v.value, res) : null;
    const at = now.toISOString();
    if (!ev || ev.verdict === 'impossible' || ev.verdict === 'humain') {
      await sb().from('linkgen_learned_rules').update({ last_check_at: at }).eq('id', r.id);
    } else if (ev.verdict === 'ok') {
      await sb().from('linkgen_learned_rules').update({ last_check_at: at, fail_count: 0, check_result: ev }).eq('id', r.id);
    } else {
      const fails = (r.fail_count ?? 0) + 1;
      if (fails >= 2) {
        await sb().from('linkgen_learned_rules').update({ last_check_at: at, fail_count: fails, check_result: ev, status: 'suspendue' }).eq('id', r.id);
        if (r.item_id) {
          await sb().from('linkgen_learning_items').update({
            status: 'a_chercher', proposed_url: null, learned: null, check_result: null, verify_url: null,
            decision_note: 'Règle suspendue : deux contrôles hebdomadaires en échec (le site a changé ?)', updated_at: at,
          }).eq('id', r.item_id);
        }
        await remind(`apprentissage-suspendue:${r.id}`, `Apprentissage des sites : une règle ${r.site} suspendue (${r.kind === 'modele' ? `${r.brand} ${r.model}` : r.criterion})`,
          `Deux contrôles hebdomadaires en échec : ${ev.detail}. La ligne est repartie « à chercher » pour Claude.`, now);
        console.warn(`[APPRENTISSAGE] règle ${r.id} (${r.site}) suspendue après deux contrôles en échec`);
      } else {
        await sb().from('linkgen_learned_rules').update({ last_check_at: at, fail_count: fails, check_result: ev }).eq('id', r.id);
      }
    }
    n++;
  }
  return n;
}

const ownerEmail = (): string => (process.env.LEARNING_OWNER ?? process.env.SITE_LEADS_OWNER ?? 'channing@mc-export.com').trim().toLowerCase();

/** Un rappel dans la cloche du responsable (une seule fois par clé). */
async function remind(key: string, title: string, note: string, now: Date, link = '/apprentissage-sites'): Promise<void> {
  const owner = (await mcExportAccounts()).find((a) => a.email === ownerEmail())?.id;
  if (!owner) return;
  await sb().from('user_tasks').upsert({
    assignee_id: owner, created_by: owner, key, title: title.slice(0, 200), note: note.slice(0, 1500), link, due_at: now.toISOString(),
  }, { onConflict: 'key', ignoreDuplicates: true });
}

const parisDay = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const parisHour = (d: Date) => Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));

let hourlyBusy = false;
/** Le passage horaire (exporté pour les tests). */
export async function learningHourlyTick(deps: LearningDeps = defaultDeps, now = new Date()): Promise<{ catalogue: number; resolved: number; rechecked: number; reminded: boolean }> {
  const out = { catalogue: 0, resolved: 0, rechecked: 0, reminded: false };
  if (hourlyBusy) return out;
  hourlyBusy = true;
  try {
    const { data, error } = await sb().from('linkgen_learning_items').select(ITEM_COLS).eq('status', 'a_chercher').limit(300);
    if (tableMissing(error)) return out;
    const open = (data ?? []) as Item[];
    out.catalogue = await jofogasCatalogue(open, deps, now.getTime());
    await ensureLearnedTaxonomy(0).catch(() => undefined);
    await loadLearnedRules().catch(() => undefined);
    out.resolved = await autoResolve(open);
    out.rechecked = await weeklyRecheck(deps, now);
    if (parisHour(now) >= 8) {
      const { data: pending } = await sb().from('linkgen_learning_items').select('id').eq('status', 'a_valider').limit(500);
      const n = ((pending ?? []) as unknown[]).length;
      if (n > 0) {
        await remind(`apprentissage:${parisDay(now)}`, `Apprentissage des sites : ${n} ligne(s) à valider`,
          'Atelier › Apprentissage des sites › À valider : pour chaque ligne, le contrôle et le lien « Vérifier sur le site ».', now, '/apprentissage-sites?onglet=valider');
        out.reminded = true;
      }
    }
    if (out.catalogue || out.resolved || out.rechecked) console.warn(`[APPRENTISSAGE] passage horaire : ${out.catalogue} modèle(s) Jófogás, ${out.resolved} ligne(s) résolue(s), ${out.rechecked} règle(s) re-testée(s)`);
    return out;
  } finally {
    hourlyBusy = false;
  }
}

export function startTaxonomyLearning(): void {
  setInterval(() => void learningProposalsTick(), 60_000);
  setTimeout(() => void learningProposalsTick(), 50_000);
  setInterval(() => void learningProbeTick(), 10 * 60_000);
  setTimeout(() => void learningProbeTick(), 2 * 60_000);
  setInterval(() => void learningHourlyTick(), 3_600_000);
  setTimeout(() => void learningHourlyTick(), 5 * 60_000);
  console.log('[APPRENTISSAGE] propositions toutes les 60 s, essais seuls toutes les 10 min, catalogue/résolution/contrôles toutes les heures');
}
