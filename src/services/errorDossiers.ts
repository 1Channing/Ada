/**
 * Boîte noire — lecture des dossiers d'erreur et RAPPORT QUOTIDIEN.
 *
 * Le rituel : chaque jour, un clic « Copier le rapport » produit un digest
 * markdown des dossiers non revus (groupés par signature site × type
 * d'erreur, avec l'URL, le diagnostic scrape, l'échantillon et l'analyse
 * champ-par-champ d'un cas représentatif). Channing le colle en session de
 * dev, on corrige ce qu'il révèle, on marque revu — et par récurrence le
 * mapping converge vers le parfait.
 */

import { supabase } from '../lib/supabase';

export interface ErrorDossier {
  id: string;
  createdAt: string;
  campaignId: string | null;
  seq: number;
  site: string;
  country: string;
  brand: string;
  model: string;
  outcome: string;
  detail: string;
  url: string | null;
  urlSource: string;
  dossier: Record<string, unknown>;
  reviewed: boolean;
}

export async function loadUnreviewedDossiers(limit = 500): Promise<{ items: ErrorDossier[]; error: string | null }> {
  const { data, error } = await supabase
    .from('linkgen_error_dossiers')
    .select('*')
    .eq('reviewed', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], error: error.message };
  return {
    error: null,
    items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at ?? ''),
      campaignId: (r.campaign_id as string | null) ?? null,
      seq: Number(r.seq ?? 0),
      site: String(r.site ?? ''),
      country: String(r.country ?? ''),
      brand: String(r.brand ?? ''),
      model: String(r.model ?? ''),
      outcome: String(r.outcome ?? ''),
      detail: String(r.detail ?? ''),
      url: (r.url as string | null) ?? null,
      urlSource: String(r.url_source ?? ''),
      dossier: (r.dossier as Record<string, unknown>) ?? {},
      reviewed: Boolean(r.reviewed),
    })),
  };
}

export async function markDossiersReviewed(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: true };
  const { error } = await supabase
    .from('linkgen_error_dossiers')
    .update({ reviewed: true, reviewed_at: new Date().toISOString() })
    .in('id', ids);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Signature de regroupement : même site × même type × même début de détail. */
function signatureOf(d: ErrorDossier): string {
  return `${d.site}|${d.outcome}|${d.detail.slice(0, 60)}`;
}

function fmtScrape(scrape: unknown): string {
  const s = (scrape ?? {}) as Record<string, unknown>;
  if (Object.keys(s).length === 0) return '—';
  const parts = [
    s.attempts != null ? `tentatives=${s.attempts}` : '',
    s.mode ? `mode=${s.mode}` : '',
    s.htmlLength != null ? `taille=${s.htmlLength}o` : '',
    s.blocked ? `bloqué=${s.blockReason ?? 'oui'}` : '',
    s.emptyResults ? (s.emptyConfirmed === true ? 'vide-confirmé-par-le-site' : s.emptyConfirmed === false ? 'vide-SUSPECT-marqueur-absent' : 'résultat-vide') : '',
    s.listingCount != null ? `annonces=${s.listingCount}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '—';
}

function fmtAnalysis(analysis: unknown): string[] {
  const rows = Array.isArray(analysis) ? (analysis as Array<Record<string, unknown>>) : [];
  return rows
    .filter((r) => r.status !== 'confirmed')
    .map((r) => `    - ${r.field}: "${r.declared}" ${r.status} (${r.matches ?? '?'}/${r.sample ?? '?'}, ${r.method ?? '?'})${r.reason ? ` — ${r.reason}` : ''}`);
}

function fmtSample(sample: unknown): string[] {
  const rows = Array.isArray(sample) ? (sample as Array<Record<string, unknown>>) : [];
  return rows.slice(0, 3).map((l) =>
    `    - "${String(l.title ?? '').slice(0, 80)}" · ${l.price ?? '?'}€ · ${l.year ?? '?'} · ${l.fuel ?? '?'}`);
}

/** Digest markdown des dossiers non revus — à coller en session de dev. */
export function buildDailyDigest(items: ErrorDossier[]): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    `# Boîte noire ADA — ${now} — ${items.length} dossier(s) non revu(s)`,
    '',
  ];
  const groups = new Map<string, ErrorDossier[]>();
  for (const d of items) {
    const k = signatureOf(d);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [, group] of sorted) {
    const first = group[0];
    const segments = [...new Set(group.map((d) =>
      [d.brand, d.model, (d.dossier.criteria as Record<string, unknown> | undefined)?.fuel, (d.dossier.criteria as Record<string, unknown> | undefined)?.year]
        .filter(Boolean).join(' ')
    ))];
    lines.push(`## ${first.site} · ${first.outcome} · ${group.length} cas`);
    lines.push(`- détail: ${first.detail}`);
    lines.push(`- segments: ${segments.slice(0, 8).join(' | ')}${segments.length > 8 ? ` (+${segments.length - 8})` : ''}`);
    lines.push(`- url (source=${first.urlSource}): ${first.url ?? '—'}`);
    lines.push(`- scrape: ${fmtScrape(first.dossier.scrape)}`);
    const probes = first.dossier.probesTried;
    if (Array.isArray(probes) && probes.length > 0) lines.push(`- sondes tentées: ${probes.join(' ; ')}`);
    const analysisLines = fmtAnalysis(first.dossier.analysis);
    if (analysisLines.length > 0) {
      lines.push('- champs rejetés:');
      lines.push(...analysisLines);
    }
    const sampleLines = fmtSample(first.dossier.sample);
    if (sampleLines.length > 0) {
      lines.push('- échantillon:');
      lines.push(...sampleLines);
    }
    lines.push('');
  }
  return lines.join('\n');
}
