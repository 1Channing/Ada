/**
 * BOÎTE À APPRENDRE, côté front (01/10 → 02/10, décision Channing : « tout ce
 * qui peut nécessiter une action de correction va dans la boîte, y compris
 * les signalements »).
 *
 * Trois sources, une seule liste :
 *   - learning_cases     : cas écrits par le worker (vitrines, relevés vides,
 *                          services bloqués, sites en échec, tableur, mails)
 *                          ou par ADA (fichier fournisseur mal lu)
 *   - ada_feedback       : signalements et suggestions de l'équipe (table et
 *                          capture d'écran conservées)
 *   - linkgen_campaign_items : lacunes de campagne (taxonomie, critère) non
 *                          résolues
 * Chaque entrée dit QUI agit (equipe | dev) et OÙ aller (link).
 */
import { supabase } from '../lib/supabase';
import { setFeedbackStatus } from './feedback';
import { markItemResolved } from './campaignRunner';
import { isGenericModelName, brandKey, refModelKey } from './marketData';

export type LearningActor = 'equipe' | 'dev';
export type LearningSource = 'box' | 'feedback' | 'campaign';

export interface LearningCase {
  id: string; source: LearningSource; kind: string; key: string; title: string; url: string | null; link: string | null; actor: LearningActor;
  contact_id: string | null; submitted_by: string | null; detail: Record<string, unknown> | null;
  status: 'open' | 'done' | 'ignored'; seen_count: number; resolution: string | null;
  created_at: string; last_seen_at: string; resolved_at: string | null;
  /** Capture d'écran d'un signalement (data-URL). */
  screenshot?: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  dealer_site_unknown: 'Vitrine de concession non reconnue',
  dealer_scan_empty: 'Relevé vide sur un site reconnu',
  dealer_site_blocked: 'Vitrine protégée (Cloudflare…)',
  service_blocked: 'Service bloqué',
  site_failing: 'Site d\'étude en échec',
  sheet_row_unmatched: 'Ligne du tableur non rapprochée',
  sheet_row_incoherent: 'Ligne du tableur incohérente (colonnes décalées)',
  mail_failed: 'E-mail de dossier en échec',
  offer_file_unparsed: 'Fichier fournisseur mal lu',
  bank_statement_issue: 'Relevé de compte mal lu',
  signalement_probleme: 'Signalement : problème',
  signalement_suggestion: 'Signalement : suggestion',
  mapping_gap: 'Lacune de campagne',
};
export const ACTOR_LABEL: Record<LearningActor, string> = { equipe: 'équipe', dev: 'développement' };

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
const DEFAULT_ACTOR: Record<string, LearningActor> = { service_blocked: 'equipe', sheet_row_unmatched: 'equipe', mail_failed: 'equipe', offer_file_unparsed: 'dev' };

async function fromBox(status: string): Promise<{ cases: LearningCase[]; error: string | null }> {
  let q = untyped.from('learning_cases').select('*').order('last_seen_at', { ascending: false }).limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { cases: [], error: missing(error.message) ? 'SQL du 01/10 (learning_cases) à coller.' : error.message };
  return {
    cases: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), source: 'box' as const, kind: String(r.kind), key: String(r.key), title: String(r.title), url: (r.url as string | null) ?? null,
      link: (r.link as string | null) ?? null, actor: ((r.actor as LearningActor | null) ?? DEFAULT_ACTOR[String(r.kind)] ?? 'dev'),
      contact_id: (r.contact_id as string | null) ?? null, submitted_by: (r.submitted_by as string | null) ?? null, detail: (r.detail as Record<string, unknown> | null) ?? null,
      status: (r.status as LearningCase['status']) ?? 'open', seen_count: Number(r.seen_count ?? 1), resolution: (r.resolution as string | null) ?? null,
      created_at: String(r.created_at), last_seen_at: String(r.last_seen_at ?? r.created_at), resolved_at: (r.resolved_at as string | null) ?? null,
    })),
    error: null,
  };
}

async function fromFeedback(status: string): Promise<LearningCase[]> {
  let q = untyped.from('ada_feedback').select('*').order('created_at', { ascending: false }).limit(300);
  if (status === 'open' || status === 'done') q = q.eq('status', status);
  if (status === 'ignored') return [];
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: `fb:${r.id}`, source: 'feedback' as const, kind: r.kind === 'suggestion' ? 'signalement_suggestion' : 'signalement_probleme', key: String(r.id),
    title: String(r.message ?? '').slice(0, 160), url: null, link: (r.page as string | null) ?? null, actor: 'dev' as const,
    contact_id: null, submitted_by: (r.author as string | null) ?? null, detail: { page: r.page ?? null },
    status: r.status === 'done' ? 'done' as const : 'open' as const, seen_count: 1, resolution: r.resolved_by ? `par ${String(r.resolved_by)}` : null,
    created_at: String(r.created_at), last_seen_at: String(r.created_at), resolved_at: (r.resolved_at as string | null) ?? null,
    screenshot: (r.screenshot as string | null) ?? null,
  }));
}

async function fromCampaigns(status: string): Promise<LearningCase[]> {
  if (status === 'ignored') return [];
  // Lacunes des 10 dernières campagnes : taxonomie / critère, non résolues.
  const { data: camps } = await untyped.from('linkgen_campaigns').select('id, label, created_at').order('created_at', { ascending: false }).limit(10);
  const ids = ((camps ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (ids.length === 0) return [];
  let q = untyped.from('linkgen_campaign_items').select('campaign_id, seq, site, brand, model, criteria, outcome, detail, url, resolved_at, created_at')
    .in('campaign_id', ids).in('outcome', ['taxonomy_gap', 'enum_gap']).order('created_at', { ascending: false }).limit(300);
  if (status === 'open') q = q.is('resolved_at', null);
  if (status === 'done') q = q.not('resolved_at', 'is', null);
  const { data, error } = await q;
  if (error) return [];
  const labelOf = new Map(((camps ?? []) as Array<{ id: string; label: string | null }>).map((c) => [c.id, c.label ?? '']));
  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    // Un modèle générique (« MODEL » né de « tesla model ») n'est pas une lacune : identité v4 l'a retiré.
    .filter((r) => !isGenericModelName(String(r.brand ?? ''), String(r.model ?? '')));
  // Lacune déjà comblée : le site × marque × modèle est maintenant VALIDE en
  // mémoire (ré-ingestion, campagne suivante) → elle ne s'affiche plus.
  const validated = new Set<string>();
  if (rows.length > 0) {
    const brands = [...new Set(rows.map((r) => String(r.brand ?? '').trim().toUpperCase()).filter(Boolean))];
    const { data: mem } = await untyped.from('linkgen_mapping_memory').select('site, brand, model').eq('validation_status', 'valid').in('brand', brands).limit(5000);
    for (const m of (mem ?? []) as Array<{ site: string; brand: string | null; model: string | null }>) validated.add(`${m.site}|${brandKey(m.brand ?? '')}|${refModelKey(m.brand ?? '', m.model ?? '')}`);
  }
  return rows.filter((r) => !validated.has(`${r.site}|${brandKey(String(r.brand ?? ''))}|${refModelKey(String(r.brand ?? ''), String(r.model ?? ''))}`)).map((r) => {
    const crit = (r.criteria ?? {}) as { fuel?: string | null; year?: number | null; trim?: string | null };
    return {
      id: `cg:${r.campaign_id}:${r.seq}`, source: 'campaign' as const, kind: 'mapping_gap', key: `${r.site}|${r.brand}|${r.model}`,
      title: `${r.site} · ${r.brand} ${r.model || '(page marque)'}${crit.fuel ? ' · ' + crit.fuel : ''}${crit.year ? ' · ' + crit.year : ''} — ${r.outcome === 'taxonomy_gap' ? 'lacune taxonomie' : 'lacune critère'}`,
      url: (r.url as string | null) ?? null, link: '/link-generator', actor: 'dev' as const, contact_id: null, submitted_by: labelOf.get(String(r.campaign_id)) || null,
      detail: { detail: r.detail ?? null, outcome: r.outcome, campaignId: r.campaign_id, seq: r.seq, site: r.site, brand: r.brand, model: r.model, fuel: crit.fuel ?? null, year: crit.year ?? null, trim: crit.trim ?? null },
      status: r.resolved_at ? 'done' as const : 'open' as const, seen_count: 1, resolution: r.resolved_at ? 'résolue' : null,
      created_at: String(r.created_at), last_seen_at: String(r.created_at), resolved_at: (r.resolved_at as string | null) ?? null,
    };
  });
}

export async function listLearningCases(status: 'open' | 'done' | 'ignored' | 'all' = 'open'): Promise<{ cases: LearningCase[]; error: string | null }> {
  const [box, fb, cg] = await Promise.all([fromBox(status), fromFeedback(status), fromCampaigns(status)]);
  const cases = [...box.cases, ...fb, ...cg].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  return { cases, error: box.error };
}

/** Nombre de cas ouverts, toutes sources (pastille de l'en-tête). */
export async function countOpenLearningCases(): Promise<number> {
  const r = await listLearningCases('open');
  return r.cases.length;
}

export async function setLearningCaseStatus(c: LearningCase, status: 'open' | 'done' | 'ignored', resolution?: string, by = ''): Promise<string | null> {
  if (c.source === 'feedback') {
    const r = await setFeedbackStatus(c.key, status !== 'open', by);
    return r.ok ? null : (r.error ?? 'échec');
  }
  if (c.source === 'campaign') {
    const d = (c.detail ?? {}) as { campaignId?: string; seq?: number };
    if (status === 'open' || !d.campaignId || d.seq == null) return status === 'open' ? 'Une lacune de campagne se rouvre depuis la campagne elle-même.' : 'lacune sans campagne';
    await markItemResolved(d.campaignId, d.seq);
    return null;
  }
  const { error } = await untyped.from('learning_cases').update({
    status, resolution: status === 'open' ? null : (resolution ?? null), resolved_at: status === 'open' ? null : new Date().toISOString(),
  }).eq('id', c.id);
  return error ? error.message : null;
}

/**
 * Enregistrer un cas DEPUIS ADA (02/10) : fichier fournisseur mal lu, etc.
 * Même règle que le worker : un cas par (kind, key), compté. Fail-open.
 */
export async function recordLearningCaseFromApp(c: { kind: string; key: string; title: string; url?: string | null; link?: string | null; actor?: LearningActor; submittedBy?: string | null; detail?: Record<string, unknown> }): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { data: existing, error: selErr } = await untyped.from('learning_cases').select('id, seen_count, status').eq('kind', c.kind).eq('key', c.key).maybeSingle();
    if (selErr) return false;
    if (existing) {
      const reopen = existing.status === 'done' ? { status: 'open', resolved_at: null, resolution: null } : {};
      const { error } = await untyped.from('learning_cases').update({ seen_count: (existing.seen_count ?? 1) + 1, last_seen_at: now, title: c.title, detail: c.detail ?? null, ...reopen }).eq('id', existing.id);
      return !error;
    }
    const { error } = await untyped.from('learning_cases').insert({ kind: c.kind, key: c.key, title: c.title, url: c.url ?? null, link: c.link ?? null, actor: c.actor ?? 'dev', submitted_by: c.submittedBy ?? null, detail: c.detail ?? null, status: 'open', seen_count: 1, last_seen_at: now });
    return !error;
  } catch { return false; }
}
