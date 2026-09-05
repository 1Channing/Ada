/**
 * TRUTH CENTER — BRIQUE 3a : MOTEUR DE DIAGNOSTIC DÉTERMINISTE (27/08).
 *
 * Traite les dossiers de vérité SANS humain ni LLM — uniquement des règles
 * mécaniques, chacune née d'un diagnostic réellement fait à la main la
 * veille (X3/Yaris/Kona, 26/08). Tourne après le balayage (truth_sweep),
 * en service_role. Zéro scrape : lectures DB + code pur.
 *
 * Règles :
 *  R1 — DIFF D'URL : une preuve humaine porte une URL manuelle → comparaison
 *       paramètre par paramètre (query + hash + chemin) avec l'URL d'ADA ;
 *       chaque différence est nommée et classée par famille de critère.
 *       Diagnostic écrit dans le dossier — jamais de correction inventée.
 *  R2 — ARTEFACT « TOTAL = ÉCHANTILLON » : profondeur enregistrée égale à
 *       l'échantillon (bug corrigé le 26/08) → le signal ne mesurait que
 *       notre propre pagination. Auto-classé « écart compris » ; le dossier
 *       se ROUVRE seul si le signal persiste sur de vrais totaux (R5).
 *  R3 — AUTO-GUÉRISON url_incomplete/dictionnaire : l'URL du jour est
 *       régénérée (voie mémoire + registre) ; si elle exprime désormais
 *       tous les critères, le dossier se ferme « vérifié » tout seul.
 *  R4 — RE-VÉRIFICATION TOLÉRANCÉE : preuve humaine chiffrée + nouveau
 *       snapshot aux critères conformes postérieur à la preuve → si le
 *       total re-mesuré colle à la preuve (tolérance configurable),
 *       fermeture « vérifié ». La boucle §25 se boucle sans humain.
 *  R5 — RÉOUVERTURE : un dossier résolu dont le signal repart (balayage
 *       qui le re-flag après une période de grâce) redevient « detected ».
 *
 * Chaque action écrit details.diagnosis + diagnosed_by='ADA (règles)' et
 * signe une preuve kind='diagnostic' — même trace que le diagnostic humain.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { generateSearchUrlsWithMemory } from '../src/lib/linkgen/generator';
import { missingUrlCriteria, CRITERIA_DETECTORS } from '../src/lib/linkgen/grammar';
import { allSiteAdapters } from '../src/lib/study-core/marketplaces';
import { brandKey, refModelKey } from '../src/services/marketData';
import type { SiteKey } from '../src/lib/linkgen/types';

interface Dossier {
  id: string; site: string; country: string; brand: string; model: string; fuel: string;
  signal: string; layer: string; status: string; summary: string;
  details: Record<string, unknown>;
  last_seen_at: string; resolved_at: string | null;
}
interface Evidence {
  dossier_id: string; kind: string; observed_count: number | null;
  manual_url: string | null; created_at: string; submitted_by: string;
}
interface StudyRow {
  brand: string; model: string | null; fuel: string | null;
  trim: string | null; trim_target: string | null;
  year_min: number | null; year_max: number | null; mileage_max: number | null;
  gearbox: string | null; power_min: number | null;
  source_country: string; target_country: string; active: boolean;
}

const ENGINE = 'ADA (règles)';
let lastRunMs = 0;

// ── Outils ───────────────────────────────────────────────────────────────────

/** Décompose une URL en paramètres nommés : query, hash Marktplaats (k:v|…)
 *  et segments de chemin (positionnels). */
function urlParams(url: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const hashIdx = url.indexOf('#');
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
    const qIdx = base.indexOf('?');
    if (qIdx >= 0) {
      for (const pair of base.slice(qIdx + 1).split('&')) {
        const [k, ...v] = pair.split('=');
        if (k) out.set(k, decodeURIComponent(v.join('=') ?? ''));
      }
    }
    for (const seg of hash.split('|')) {
      const i = seg.indexOf(':');
      if (i > 0) out.set(`#${seg.slice(0, i)}`, seg.slice(i + 1));
    }
    // Segments de chemin en ENSEMBLE (présence), pas par position : un /q/
    // inséré décalerait tout et noierait le diff sous de faux écarts.
    for (const seg of new URL(base).pathname.split('/').filter(Boolean)) out.set(`chemin ${seg}`, '∙');
  } catch { /* URL illisible — comparaison sur ce qu'on a pu lire */ }
  return out;
}

/** Famille de critère d'un paramètre (année/km/puissance/boîte/finition/
 *  carburant) via les détecteurs du registre — 'autre' sinon. */
function familyOf(key: string, value: string): string {
  const probe = key.startsWith('#') ? `#${key.slice(1)}:${value}` : `?${key}=${value}`;
  for (const [fam, re] of Object.entries(CRITERIA_DETECTORS)) {
    if (re.test(probe)) return fam;
  }
  return 'autre';
}

/** R1 : différences nommées entre l'URL d'ADA et l'URL humaine. */
function diffUrls(adaUrl: string, humanUrl: string): string[] {
  const a = urlParams(adaUrl);
  const h = urlParams(humanUrl);
  const out: string[] = [];
  for (const [k, hv] of h) {
    const av = a.get(k);
    if (av === undefined) out.push(`${k} absent chez ADA (site: ${hv}) [${familyOf(k, hv)}]`);
    else if (av !== hv) out.push(`${k} : ADA ${av} ≠ site ${hv} [${familyOf(k, hv)}]`);
  }
  for (const [k, av] of a) {
    if (!h.has(k)) out.push(`${k} posé par ADA seulement (${av}) [${familyOf(k, av)}]`);
  }
  return out;
}

async function writeDiagnosis(
  d: Dossier,
  diagnosis: string,
  patch: { status?: string; layer?: string; resolve?: boolean },
): Promise<void> {
  const sb = supabase as never as {
    from: (t: string) => {
      update: (v: unknown) => { eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }> };
      insert: (v: unknown) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  const details = { ...d.details, diagnosis, diagnosed_by: ENGINE, diagnosed_at: new Date().toISOString() };
  const upd: Record<string, unknown> = { details };
  if (patch.status) upd.status = patch.status;
  if (patch.layer) upd.layer = patch.layer;
  if (patch.resolve) upd.resolved_at = new Date().toISOString();
  const { error } = await sb.from('truth_dossiers').update(upd).eq('id', d.id);
  if (error) { console.warn(`[TRUTH_DIAG] écriture dossier ${d.id} :`, error.message); return; }
  await sb.from('truth_evidence').insert({
    dossier_id: d.id, kind: 'diagnostic', comment: diagnosis, submitted_by: ENGINE,
  });
  console.warn(`[TRUTH_DIAG] ${d.brand} ${d.model} ${d.site} ${d.signal} → ${patch.status ?? d.status} : ${diagnosis.slice(0, 140)}`);
}

function studyFor(studies: StudyRow[], d: Dossier): StudyRow | null {
  if (!d.brand) return null;
  const bk = brandKey(d.brand);
  const mk = d.model ? refModelKey(d.brand, d.model) : '';
  const hits = studies.filter((s) => s.active && brandKey(s.brand) === bk
    && (!mk || refModelKey(s.brand, s.model ?? '') === mk));
  return hits.find((s) => d.country && (s.source_country === d.country || s.target_country === d.country)) ?? hits[0] ?? null;
}

function studyParams(s: StudyRow, site: string) {
  return {
    selectedSites: [site as SiteKey],
    brand: s.brand, model: s.model || '',
    fuel: s.fuel || undefined, trim: (s.trim || s.trim_target) || undefined,
    yearFrom: s.year_min != null ? String(s.year_min) : undefined,
    yearTo: s.year_max != null ? String(s.year_max) : undefined,
    mileage: s.mileage_max ?? undefined,
    gearbox: s.gearbox || undefined,
    minPower: s.power_min != null ? String(s.power_min) : undefined,
  };
}

// ── Le moteur ────────────────────────────────────────────────────────────────

export async function runTruthDiagnose(reason: string): Promise<void> {
  if (Date.now() - lastRunMs < 20 * 3_600_000) return;
  lastRunMs = Date.now();
  try {
    const sb = supabase as never as {
      from: (t: string) => {
        select: (c: string) => {
          in: (c: string, v: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
          eq: (c: string, v: unknown) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null }> } & PromiseLike<{ data: unknown[] | null }>;
          order: (c: string, o: unknown) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null }> };
        };
      };
    };
    const { data: rows, error } = await sb.from('truth_dossiers').select('*')
      .in('status', ['detected', 'needs_evidence', 'verified', 'accepted_variance']);
    if (error) { console.warn(`[TRUTH_DIAG] lecture (${reason}) :`, error.message); lastRunMs = 0; return; }
    const dossiers = (rows ?? []) as Dossier[];
    if (dossiers.length === 0) return;

    const { data: evRows } = await sb.from('truth_evidence').select('*')
      .in('dossier_id', dossiers.map((d) => d.id));
    const evidence = ((evRows ?? []) as Evidence[]);
    const humanEvidenceOf = (id: string): Evidence[] =>
      evidence.filter((e) => e.dossier_id === id && e.kind !== 'diagnostic')
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const { data: stRows } = await (sb.from('daily_searches').select('*') as never as {
      eq: (c: string, v: boolean) => PromiseLike<{ data: unknown[] | null }>;
    }).eq('active', true);
    const studies = ((stRows ?? []) as StudyRow[]);

    const adapters = allSiteAdapters();
    const graceMs = 2 * 86_400_000; // réouverture : 2 j de grâce après résolution
    const tolerancePct = 15;        // re-vérification : ±15 % vs preuve humaine
    let acted = 0;

    for (const d of dossiers) {
      const alreadyByEngine = d.details?.diagnosed_by === ENGINE;

      // R5 — RÉOUVERTURE : résolu, mais le balayage re-flag avec des données
      // fraîches après la période de grâce → le doute repart de zéro.
      if ((d.status === 'verified' || d.status === 'accepted_variance') && d.resolved_at) {
        if (new Date(d.last_seen_at).getTime() > new Date(d.resolved_at).getTime() + graceMs) {
          await writeDiagnosis(d, 'Signal réapparu sur données fraîches après résolution — dossier rouvert.', { status: 'detected' });
          acted++;
        }
        continue;
      }
      if (d.status !== 'detected' && d.status !== 'needs_evidence') continue;

      // R3 — AUTO-GUÉRISON des dossiers URL/dictionnaire : on regénère l'URL
      // du jour ; complète = le trou est résorbé (registre ou apprentissage).
      if (d.signal === 'url_incomplete' || d.signal === 'dictionnaire') {
        const s = studyFor(studies, d);
        if (s && d.site) {
          try {
            const params = studyParams(s, d.site);
            const gen = await generateSearchUrlsWithMemory(params);
            const url = gen[0]?.url ?? '';
            const missing = url ? missingUrlCriteria(url, params) : ['URL non générable'];
            const warnings = gen[0]?.warnings ?? [];
            // Un warning de génération est un AVIS, pas une preuve : l'URL
            // qui exprime tous les critères (détecteurs) est complète —
            // constat Sportage 05/09 : LBC portait horse_power_din=250-max
            // et restait « incomplet » sur un warning « minPower ignored ».
            if (url && missing.length === 0) {
              await writeDiagnosis(d,
                `L'URL du jour exprime désormais tous les critères de l'étude (${url.slice(0, 160)}) — trou résorbé (registre/apprentissage).${warnings.length ? ` Avis du générateur ignorés : ${warnings.join(' | ').slice(0, 200)}` : ''}`,
                { status: 'verified', resolve: true });
              acted++;
            } else if (!alreadyByEngine) {
              await writeDiagnosis(d,
                `Toujours incomplet : ${missing.join(', ') || 'warnings de génération'} — apprentissage requis (coller une URL humaine du combo dans Atelier → Ingestion).`,
                { layer: d.signal === 'dictionnaire' ? 'dictionnaire' : 'url' });
              acted++;
            }
          } catch { /* génération indisponible — au prochain passage */ }
        }
        continue;
      }

      // R2 — ARTEFACT total = échantillon (profondeurs d'avant le correctif
      // du 26/08) : le « total » enregistré n'était que notre pagination.
      const lc = Number(d.details?.listing_count ?? NaN);
      const snapAt = typeof d.details?.snapshot_at === 'string' ? String(d.details.snapshot_at) : null;
      if (d.signal.startsWith('profondeur') && Number.isFinite(lc) && snapAt && !alreadyByEngine) {
        const { data: snapRows } = await sb.from('market_snapshots')
          .select('listing_count, sample_size, source_url').eq('scraped_at', snapAt).limit(1);
        const snap = (snapRows ?? [])[0] as { listing_count: number | null; sample_size: number; source_url: string | null } | undefined;
        if (snap && snap.listing_count != null && snap.listing_count === snap.sample_size && snap.sample_size >= 60) {
          await writeDiagnosis(d,
            `Artefact de mesure : la profondeur enregistrée (${snap.listing_count}) est exactement l'échantillon ramené — le total du site n'était pas lu avant le correctif du 26/08. Signal non probant ; se rouvrira seul si l'écart persiste sur de vrais totaux.`,
            { status: 'accepted_variance', layer: 'profondeur', resolve: true });
          acted++;
          continue;
        }
      }

      // R1 + R4 — preuve humaine disponible.
      const evs = humanEvidenceOf(d.id);
      if (evs.length === 0) continue;
      const ev = evs[0];

      // R1 — DIFF D'URL contre la preuve.
      if (ev.manual_url && !alreadyByEngine) {
        const adaUrl = typeof d.details?.url === 'string' ? String(d.details.url)
          : await (async () => {
            if (!snapAt) return null;
            const { data: sr } = await sb.from('market_snapshots').select('source_url').eq('scraped_at', snapAt).limit(1);
            return ((sr ?? [])[0] as { source_url: string | null } | undefined)?.source_url ?? null;
          })();
        if (adaUrl) {
          const diffs = diffUrls(adaUrl, ev.manual_url);
          const critDiffs = diffs.filter((x) => !/\[autre\]/.test(x));
          await writeDiagnosis(d,
            critDiffs.length > 0
              ? `Diff URL ADA vs site (preuve ${ev.submitted_by}) : ${critDiffs.join(' ; ')}. Couche URL/dictionnaire selon le paramètre nommé.`
              : `Aucune différence de critère entre l'URL d'ADA et celle du site — l'écart vient d'ailleurs (profondeur/lecture).`,
            { layer: critDiffs.length > 0 ? 'url' : d.layer });
          acted++;
        }
      }

      // R4 — RE-VÉRIFICATION : nouveau snapshot conforme postérieur à la
      // preuve chiffrée → total re-mesuré vs preuve, tolérance ±15 %.
      if (ev.observed_count != null && ev.observed_count > 0 && d.site && d.brand) {
        const { data: snaps } = await sb.from('market_snapshots')
          .select('listing_count, sample_size, source_url, scraped_at')
          .eq('site', d.site)
          .order('scraped_at', { ascending: false as never })
          .limit(40);
        const s = studyFor(studies, d);
        const adapter = adapters.find((a) => a.key === d.site);
        // Périmètre de comparaison : d'abord celui de la PREUVE elle-même
        // (l'URL manuelle porte ses propres bornes — cas X3 : deux études
        // 2022-2022 et 2024-2024 sur le même segment, seule l'URL de la
        // preuve dit laquelle est jugée), sinon celui de l'étude appariée.
        const proofScope = (() => {
          if (!ev.manual_url || !adapter?.prefillCriteriaFromUrl) return null;
          try { return adapter.prefillCriteriaFromUrl(ev.manual_url); } catch { return null; }
        })();
        const fresh = ((snaps ?? []) as Array<{ listing_count: number | null; sample_size: number; source_url: string | null; scraped_at: string }>)
          // Vrai total : différent de l'échantillon, OU petit marché lu en
          // entier (total = échantillon < 60 : moins que la capacité d'une
          // vague — cas X3 re-mesuré à 11/11, parfaitement probant).
          .filter((x) => x.scraped_at > ev.created_at && x.listing_count != null
            && (x.listing_count !== x.sample_size || x.listing_count < 60))
          .find((x) => {
            if (!x.source_url || !adapter?.prefillCriteriaFromUrl) return false;
            try {
              const dec = adapter.prefillCriteriaFromUrl(x.source_url);
              const decBrand = (dec.brand ?? '').trim();
              if (decBrand && brandKey(decBrand) !== brandKey(d.brand)) return false;
              if (proofScope) {
                if (proofScope.yearFrom && dec.yearFrom && String(dec.yearFrom) !== String(proofScope.yearFrom)) return false;
                if (proofScope.yearTo && dec.yearTo && String(dec.yearTo) !== String(proofScope.yearTo)) return false;
                if (proofScope.mileage && dec.mileage && String(dec.mileage) !== String(proofScope.mileage)) return false;
                return true;
              }
              if (s?.year_min != null && dec.yearFrom && Number(dec.yearFrom) !== s.year_min) return false;
              if (s?.year_max != null && dec.yearTo && Number(dec.yearTo) !== s.year_max) return false;
              return true;
            } catch { return false; }
          });
        if (fresh && fresh.listing_count != null) {
          const gap = Math.abs(fresh.listing_count - ev.observed_count) / ev.observed_count * 100;
          if (gap <= tolerancePct) {
            await writeDiagnosis(d,
              `Re-vérifié : total re-mesuré ${fresh.listing_count} (${fresh.scraped_at.slice(0, 16)}) vs preuve humaine ${ev.observed_count} — écart ${Math.round(gap)} % ≤ ${tolerancePct} %. Réalité et lecture d'ADA concordent.`,
              { status: 'verified', resolve: true });
            acted++;
          }
        }
      }
    }
    if (acted > 0) console.warn(`[TRUTH_DIAG] ${acted} dossier(s) diagnostiqués/avancés (${reason})`);
  } catch (e) {
    console.warn(`[TRUTH_DIAG] (${reason}) :`, e instanceof Error ? e.message : e);
    lastRunMs = 0;
  }
}
