/**
 * ADA MCP — lecture seule, V1 (14/09/2026).
 *
 * Surface MCP privée pour interroger ADA à la voix (ChatGPT) SANS SQL libre
 * et SANS toucher au worker de production. Câblée sur les tables VIVANTES
 * d'ADA depuis fin juillet : études quotidiennes (daily_searches), leurs
 * annonces (daily_search_hits), négociations + dossiers, tableaux du Market
 * Intelligence (market_snapshots), Truth Center (truth_dossiers), boîte noire
 * du worker (worker_logs). Les tables studies_v2 / study_runs de l'ancienne
 * architecture (dernière ligne le 17/07) ne sont plus lues.
 *
 * Règles : tout outil est déclaré lecture seule, borné (limit), fail-open sur
 * les colonnes/tables dont le SQL n'est pas encore collé (dossiers,
 * dropped_at), et fail-closed sur l'authentification (jeton dédié obligatoire
 * au démarrage). La clé service-role ne quitte jamais ce serveur.
 */
import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import * as z from 'zod/v4';

const PORT = Number.parseInt(process.env.PORT || '3002', 10);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[ADA_MCP] Missing required environment variable: ${name}`);
  }
  return value;
}

function csvEnv(name: string, required = false): string[] {
  const raw = process.env[name]?.trim() || '';
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (required && values.length === 0) {
    throw new Error(`[ADA_MCP] Missing required environment variable: ${name}`);
  }

  return values;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ADA_MCP_API_KEY = requireEnv('ADA_MCP_API_KEY');
const ALLOWED_HOSTS = csvEnv('ADA_MCP_ALLOWED_HOSTS', true);
const ALLOWED_ORIGINS = csvEnv('ADA_MCP_ALLOWED_ORIGINS');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function jsonToolResult(value: unknown) {
  const structuredContent =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { data: value };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent,
  };
}

function assertDb(error: { message?: string } | null, context: string): void {
  if (error) {
    throw new Error(`[ADA_MCP] ${context}: ${error.message || 'database error'}`);
  }
}

/** Colonne ou table absente (SQL pas encore collé) → on dégrade, jamais on plante. */
function isMissingSchema(error: { message?: string } | null): boolean {
  return !!error && /does not exist|schema cache|column|relation/i.test(error.message || '');
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

const sinceIso = (days: number) => new Date(Date.now() - Math.max(0.05, days) * 86_400_000).toISOString();

// ── Personnes ────────────────────────────────────────────────────────────────

interface Person {
  id: string; name: string; isAdmin: boolean;
  /** Libellé UNIQUE : « Antoine » devient « Antoine (f27d) » quand deux comptes portent le même nom. */
  label: string;
  activity: { studies: number; inbox: number; openNegotiations: number };
}

/**
 * Les comptes, avec leur ACTIVITÉ (études, annonces à traiter, négociations)
 * et un libellé unique. Constat GPT 14/09 : deux profils « Antoine » ; le
 * premier trouvé était le compte vide, « Antoine a zéro annonce » était faux.
 */
async function listPeople(): Promise<Person[]> {
  const [profiles, studies, inbox, negos] = await Promise.all([
    supabase.from('profiles').select('id, display_name, is_admin').limit(200),
    supabase.from('daily_searches').select('user_id').eq('active', true).limit(5000),
    supabase.from('daily_search_hits').select('user_id').eq('status', 'inbox').limit(5000),
    supabase.from('negotiations').select('user_id').neq('status', 'closed').limit(5000),
  ]);
  assertDb(profiles.error, 'Unable to list people');
  const count = (rows: Array<{ user_id?: unknown }> | null) => {
    const m = new Map<string, number>();
    for (const r of rows || []) { const k = String(r.user_id); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const cs = count(studies.data), ci = count(inbox.data), cn = count(negos.data);
  const people: Person[] = (profiles.data || []).map((p) => {
    const id = String(p.id);
    return {
      id,
      name: String((p as { display_name?: string }).display_name || '').trim() || 'sans nom',
      isAdmin: Boolean((p as { is_admin?: boolean }).is_admin),
      label: '',
      activity: { studies: cs.get(id) ?? 0, inbox: ci.get(id) ?? 0, openNegotiations: cn.get(id) ?? 0 },
    };
  });
  const byName = new Map<string, number>();
  for (const p of people) byName.set(p.name.toLowerCase(), (byName.get(p.name.toLowerCase()) ?? 0) + 1);
  for (const p of people) p.label = (byName.get(p.name.toLowerCase()) ?? 0) > 1 ? `${p.name} (${p.id.slice(0, 4)})` : p.name;
  return people;
}

/**
 * « Antoine », « channing », « Antoine (f27d) »… → TOUS les comptes qui
 * correspondent (homonymes compris : le filtre porte sur l'union, chaque
 * ligne garde son libellé unique). Insensible à la casse, partiel accepté.
 */
async function resolvePerson(person?: string): Promise<{ people: Person[]; ids: string[] | null; matched: Person[]; error?: string }> {
  const people = await listPeople();
  const wanted = normalizeText(person)?.toLowerCase();
  if (!wanted) return { people, ids: null, matched: [] };
  const byLabel = people.filter((p) => p.label.toLowerCase() === wanted);
  const exact = byLabel.length ? byLabel : people.filter((p) => p.name.toLowerCase() === wanted);
  const matched = exact.length ? exact : people.filter((p) => p.name.toLowerCase().includes(wanted) || p.label.toLowerCase().includes(wanted));
  if (matched.length === 0) {
    return { people, ids: null, matched, error: `Personne inconnue : « ${person} ». Comptes : ${people.map((p) => p.label).join(', ')}` };
  }
  return { people, ids: matched.map((p) => p.id), matched };
}

const nameOf = (people: Person[], id: string) => people.find((p) => p.id === id)?.label ?? 'inconnu';
const describePerson = (p: Person) => ({ name: p.label, admin: p.isAdmin, activeStudies: p.activity.studies, inboxToProcess: p.activity.inbox, openNegotiations: p.activity.openNegotiations });

// ── Études quotidiennes ──────────────────────────────────────────────────────

const STUDY_COLUMNS = 'id,user_id,label,brand,model,trim,trim_target,fuel,gearbox,vehicle_type,power_min,mileage_max,year_min,year_max,source_country,target_country,price_gap_min,price_gap_max,run_hour,active,last_run_at,created_at';

interface StudyRow {
  id: string; user_id: string; label: string; brand: string; model: string; trim: string; trim_target: string;
  fuel: string; gearbox: string; vehicle_type?: string; power_min: number | null; mileage_max: number | null;
  year_min: number | null; year_max: number | null; source_country: string; target_country: string;
  price_gap_min: number; price_gap_max: number; run_hour: number; active: boolean; last_run_at: string | null; created_at?: string;
}

/**
 * Dernier BILAN de vague par étude, lu dans la boîte noire du worker :
 * « [DAILY] « label » (FR→NL) : source 3 site(s)/55 annonces [LEBONCOIN 29 ·
 * LACENTRALE 23 · AUTOSCOUT_FR 3], cible … , 0 nouvelle(s), 2 baisse(s) ·
 * médiane cible 46 950 € (jour) ». Un site « ✗ » = en échec (pas un marché
 * vide). Clé = label nettoyé (les libellés portent parfois des espaces).
 */
async function lastBilans(hours = 48): Promise<Map<string, { at: string; bilan: string }>> {
  const out = new Map<string, { at: string; bilan: string }>();
  const { data, error } = await supabase
    .from('worker_logs')
    .select('created_at, message')
    .gte('created_at', sinceIso(hours / 24))
    .like('message', '[DAILY] « %')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return out; // boîte noire indisponible → pas de bilan, jamais d'échec
  for (const row of data || []) {
    const m = String(row.message).match(/^\[DAILY\] « (.+?) » \(\w+→\w+\) : (.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!out.has(key)) out.set(key, { at: String(row.created_at), bilan: m[2] });
  }
  return out;
}

function describeStudy(s: StudyRow, people: Person[], bilan?: { at: string; bilan: string }) {
  const criteria: string[] = [];
  if (s.year_min || s.year_max) criteria.push(`années ${s.year_min ?? '…'}-${s.year_max ?? '…'}`);
  if (s.fuel) criteria.push(`carburant ${s.fuel}`);
  if (s.trim) criteria.push(`finition « ${s.trim} »${s.trim_target ? ` (cible « ${s.trim_target} »)` : ''}`);
  if (s.gearbox) criteria.push(`boîte ${s.gearbox}`);
  if (s.vehicle_type) criteria.push(`carrosserie ${s.vehicle_type}`);
  if (s.power_min != null) criteria.push(`≥ ${s.power_min} ch`);
  if (s.mileage_max != null) criteria.push(`≤ ${s.mileage_max.toLocaleString('fr-FR')} km`);
  criteria.push(`écart voulu ${s.price_gap_min.toLocaleString('fr-FR')}–${s.price_gap_max.toLocaleString('fr-FR')} €`);
  return {
    id: s.id,
    owner: nameOf(people, s.user_id),
    label: s.label,
    vehicle: `${s.brand} ${s.model}${s.trim ? ` ${s.trim}` : ''}`.trim(),
    route: `${s.source_country} → ${s.target_country}`,
    criteria,
    active: s.active,
    runHour: s.run_hour,
    lastRunAt: s.last_run_at,
    lastWave: bilan ? { at: bilan.at, summary: bilan.bilan } : null,
  };
}

// ── Annonces (daily_search_hits) ────────────────────────────────────────────

const HIT_COLUMNS = 'id,search_id,user_id,listing_url,title,price,previous_price,year,mileage,fuel,site,source_country,target_median,price_gap,kind,status,resolution,first_seen_at,last_seen_at';
const HIT_COLUMNS_DATED = `${HIT_COLUMNS},dropped_at`;

const STATUS_LABEL: Record<string, string> = { inbox: 'à traiter', saved: 'en négociation', cleared: 'vidée', dismissed: 'traitée' };
const RESOLUTION_LABEL: Record<string, string> = { trop_chere: 'trop chère', hors_criteres: 'hors critères', plus_disponible: 'plus disponible', pas_de_deal: 'pas de deal' };

function describeHit(h: Record<string, unknown>, studies: Map<string, StudyRow>, people: Person[]) {
  const s = studies.get(String(h.search_id));
  const status = String(h.status);
  const resolution = h.resolution ? String(h.resolution) : null;
  const price = typeof h.price === 'number' ? h.price : null;
  const prev = typeof h.previous_price === 'number' ? h.previous_price : null;
  const droppedAt = (h as { dropped_at?: string | null }).dropped_at ?? null;
  return {
    id: h.id,
    owner: nameOf(people, String(h.user_id)),
    study: s ? s.label : null,
    title: h.title,
    url: h.listing_url,
    site: h.site,
    price,
    priceDrop: h.kind === 'price_drop' && prev != null && price != null ? prev - price : null,
    year: h.year,
    mileage: h.mileage,
    targetMedian: h.target_median,
    gap: h.price_gap,
    kind: h.kind === 'price_drop' ? 'baisse de prix' : 'nouvelle annonce',
    status: STATUS_LABEL[status] ?? status,
    resolution: resolution ? (RESOLUTION_LABEL[resolution] ?? resolution) : null,
    enteredAt: droppedAt ?? h.first_seen_at,
    firstSeenAt: h.first_seen_at,
    lastSeenAt: h.last_seen_at,
  };
}

async function loadStudies(ids?: string[]): Promise<Map<string, StudyRow>> {
  let q = supabase.from('daily_searches').select(STUDY_COLUMNS).limit(1000);
  if (ids && ids.length) q = q.in('id', [...new Set(ids)]);
  const { data, error } = await q;
  assertDb(error, 'Unable to load studies');
  return new Map(((data || []) as unknown as StudyRow[]).map((s) => [s.id, s]));
}

// ── Serveur ─────────────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'ada-readonly',
    version: MCP_VERSION,
  });

  server.registerTool(
    'ada_health',
    {
      title: 'ADA : état de santé',
      description: "Vérifie qu'ADA répond : dernière activité du worker, résumé de la dernière vague d'études quotidiennes, nombre d'études actives, d'annonces à traiter et de négociations en cours.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const [lastLog, digest, studies, inbox, negos] = await Promise.all([
        supabase.from('worker_logs').select('created_at').order('created_at', { ascending: false }).limit(1),
        supabase.from('worker_logs').select('created_at, message').like('message', '[TRUTH_DIGEST]%').order('created_at', { ascending: false }).limit(1),
        supabase.from('daily_searches').select('*', { count: 'exact', head: true }).eq('active', true),
        supabase.from('daily_search_hits').select('*', { count: 'exact', head: true }).eq('status', 'inbox'),
        supabase.from('negotiations').select('*', { count: 'exact', head: true }).neq('status', 'closed'),
      ]);
      assertDb(lastLog.error, 'Unable to read worker logs');
      assertDb(studies.error, 'Unable to count studies');
      assertDb(inbox.error, 'Unable to count inbox');
      assertDb(negos.error, 'Unable to count negotiations');
      const lastAt = lastLog.data?.[0]?.created_at ? String(lastLog.data[0].created_at) : null;
      const silenceMin = lastAt ? Math.round((Date.now() - new Date(lastAt).getTime()) / 60_000) : null;
      return jsonToolResult({
        status: 'ok',
        mode: 'read-only',
        sourceOfTruth: 'ADA / Supabase (études quotidiennes, négociations, MI, Truth Center)',
        worker: { lastLogAt: lastAt, silenceMinutes: silenceMin, healthy: silenceMin != null && silenceMin < 90 },
        lastWave: digest.data?.[0] ? { at: digest.data[0].created_at, summary: String(digest.data[0].message).replace(/^\[TRUTH_DIGEST\]\s*/, '') } : null,
        activeStudies: studies.count ?? 0,
        inboxToProcess: inbox.count ?? 0,
        openNegotiations: negos.count ?? 0,
        checkedAt: new Date().toISOString(),
      });
    },
  );

  server.registerTool(
    'list_people',
    {
      title: 'ADA : les comptes',
      description: "Liste les comptes de l'équipe ADA avec leur activité (études actives, annonces à traiter, négociations en cours). Deux comptes peuvent porter le même prénom : le libellé unique les distingue.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => jsonToolResult({
      note: 'Deux comptes peuvent porter le même prénom : le libellé entre parenthèses les distingue ; l\'activité dit lequel est utilisé.',
      people: (await listPeople()).map(describePerson),
    }),
  );

  server.registerTool(
    'list_studies',
    {
      title: 'ADA : études quotidiennes',
      description: "Liste les études quotidiennes (recherches d'arbitrage d'un véhicule entre un pays source et un pays cible) avec leurs critères, leur propriétaire et le bilan de leur dernière vague (annonces par site ; « ✗ » = site en échec). Filtres facultatifs : personne, marque, modèle, pays.",
      inputSchema: z.object({
        person: z.string().trim().min(1).optional().describe('Prénom ou nom d\'affichage du propriétaire (ex. « Antoine »)'),
        brand: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        countrySource: z.string().trim().min(2).max(3).optional(),
        countryTarget: z.string().trim().min(2).max(3).optional(),
        includeInactive: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(100),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ person, brand, model, countrySource, countryTarget, includeInactive, limit }) => {
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error, count: 0, studies: [] });
      let query = supabase.from('daily_searches').select(STUDY_COLUMNS).order('label', { ascending: true }).limit(limit);
      if (who.ids) query = query.in('user_id', who.ids);
      if (!includeInactive) query = query.eq('active', true);
      const b = normalizeText(brand); const m = normalizeText(model);
      if (b) query = query.ilike('brand', `%${b}%`);
      if (m) query = query.ilike('model', `%${m}%`);
      if (countrySource) query = query.eq('source_country', countrySource.toUpperCase());
      if (countryTarget) query = query.eq('target_country', countryTarget.toUpperCase());
      const { data, error } = await query;
      assertDb(error, 'Unable to list studies');
      const rows = (data || []) as unknown as StudyRow[];
      const bilans = await lastBilans();
      return jsonToolResult({
        count: rows.length,
        studies: rows.map((s) => describeStudy(s, who.people, bilans.get(s.label.trim().toLowerCase()))),
      });
    },
  );

  server.registerTool(
    'get_study',
    {
      title: 'ADA : une étude en détail',
      description: "Une étude quotidienne par identifiant ou par libellé : critères, bilans des dernières vagues, comptes d'annonces par statut et les annonces actuellement à traiter.",
      inputSchema: z.object({
        studyId: z.string().uuid().optional(),
        label: z.string().trim().min(2).optional().describe('Libellé de l\'étude (recherche partielle, insensible à la casse)'),
        person: z.string().trim().min(1).optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ studyId, label, person }) => {
      if (!studyId && !label) return jsonToolResult({ error: 'Donne studyId ou label.' });
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error });
      let query = supabase.from('daily_searches').select(STUDY_COLUMNS).limit(10);
      if (studyId) query = query.eq('id', studyId);
      if (label) query = query.ilike('label', `%${label.trim()}%`);
      if (who.ids) query = query.in('user_id', who.ids);
      const { data, error } = await query;
      assertDb(error, 'Unable to get study');
      const rows = (data || []) as unknown as StudyRow[];
      if (rows.length === 0) return jsonToolResult({ found: false, study: null });
      if (rows.length > 1) {
        return jsonToolResult({
          found: false,
          ambiguous: rows.map((s) => ({ id: s.id, label: s.label, owner: nameOf(who.people, s.user_id), route: `${s.source_country} → ${s.target_country}` })),
          hint: 'Plusieurs études correspondent : précise la personne ou passe studyId.',
        });
      }
      const s = rows[0];
      const [hits, logs] = await Promise.all([
        supabase.from('daily_search_hits').select(HIT_COLUMNS).eq('search_id', s.id).neq('kind', 'seed').order('first_seen_at', { ascending: false }).limit(2000),
        supabase.from('worker_logs').select('created_at, message').gte('created_at', sinceIso(7)).like('message', `[DAILY] « ${s.label}%`).order('created_at', { ascending: false }).limit(40),
      ]);
      assertDb(hits.error, 'Unable to read study hits');
      const all = (hits.data || []) as Record<string, unknown>[];
      const byStatus: Record<string, number> = {};
      for (const h of all) { const k = STATUS_LABEL[String(h.status)] ?? String(h.status); byStatus[k] = (byStatus[k] ?? 0) + 1; }
      const studies = new Map([[s.id, s]]);
      const waves = (logs.data || [])
        .map((l) => ({ at: String(l.created_at), line: String(l.message) }))
        .filter((l) => /site\(s\)\//.test(l.line))
        .slice(0, 7)
        .map((l) => ({ at: l.at, bilan: l.line.replace(/^\[DAILY\] « .+? » \(\w+→\w+\) : /, '') }));
      return jsonToolResult({
        found: true,
        study: describeStudy(s, who.people, waves[0]),
        hitsByStatus: byStatus,
        recentWaves: waves,
        inbox: all.filter((h) => h.status === 'inbox').slice(0, 50).map((h) => describeHit(h, studies, who.people)),
      });
    },
  );

  server.registerTool(
    'list_inbox',
    {
      title: 'ADA : annonces à traiter',
      description: "Les annonces actuellement à traiter dans la boîte des études quotidiennes (nouvelles annonces et baisses de prix dans l'écart voulu), les plus récentes en premier. Filtres facultatifs : personne, étude, marque, modèle.",
      inputSchema: z.object({
        person: z.string().trim().min(1).optional(),
        studyId: z.string().uuid().optional(),
        brand: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ person, studyId, brand, model, limit }) => {
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error, count: 0, hits: [] });
      let studyIds: string[] | null = null;
      const b = normalizeText(brand); const m = normalizeText(model);
      if (b || m) {
        let sq = supabase.from('daily_searches').select('id').limit(1000);
        if (b) sq = sq.ilike('brand', `%${b}%`);
        if (m) sq = sq.ilike('model', `%${m}%`);
        const { data, error } = await sq; assertDb(error, 'Unable to filter studies');
        studyIds = (data || []).map((r) => String(r.id));
        if (studyIds.length === 0) return jsonToolResult({ count: 0, hits: [] });
      }
      let query = supabase.from('daily_search_hits').select(HIT_COLUMNS).eq('status', 'inbox').neq('kind', 'seed')
        .order('last_seen_at', { ascending: false }).limit(limit);
      if (who.ids) query = query.in('user_id', who.ids);
      if (studyId) query = query.eq('search_id', studyId);
      if (studyIds) query = query.in('search_id', studyIds);
      const { data, error } = await query;
      assertDb(error, 'Unable to list inbox');
      const rows = (data || []) as Record<string, unknown>[];
      const studies = await loadStudies(rows.map((r) => String(r.search_id)));
      return jsonToolResult({ accounts: who.matched.map(describePerson), count: rows.length, hits: rows.map((h) => describeHit(h, studies, who.people)) });
    },
  );

  server.registerTool(
    'list_leads',
    {
      title: 'ADA : leads entrés récemment',
      description: "Les annonces ENTRÉES dans la boîte sur les derniers jours (nouvelles + baisses de prix dans l'écart), qu'elles aient été traitées ou non — même compte que la carte « Leads du Workflow » de la page Équipe. Une annonce compte une fois, à la date du dernier événement qui l'a mise dans la boîte.",
      inputSchema: z.object({
        person: z.string().trim().min(1).optional(),
        days: z.number().min(0.25).max(30).default(1),
        limit: z.number().int().min(1).max(300).default(100),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ person, days, limit }) => {
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error, count: 0, leads: [] });
      const since = sinceIso(days);
      const shownFilter = 'status.in.(inbox,saved,cleared),and(status.eq.dismissed,resolution.not.is.null)';
      const base = () => {
        let q = supabase.from('daily_search_hits').select(HIT_COLUMNS_DATED).neq('kind', 'seed').or(shownFilter).limit(limit);
        if (who.ids) q = q.in('user_id', who.ids);
        return q;
      };
      // Date d'entrée = dropped_at (baisse) sinon first_seen_at. Colonne
      // dropped_at absente (SQL du 12/09 pas collé) → first_seen_at seul.
      const datedRes = await base().or(`dropped_at.gte.${since},and(dropped_at.is.null,first_seen_at.gte.${since})`).order('first_seen_at', { ascending: false });
      let dated = true;
      let rows: Record<string, unknown>[] = (datedRes.data || []) as Record<string, unknown>[];
      if (datedRes.error && isMissingSchema(datedRes.error)) {
        dated = false;
        let q2 = supabase.from('daily_search_hits').select(HIT_COLUMNS).neq('kind', 'seed').or(shownFilter)
          .gte('first_seen_at', since).order('first_seen_at', { ascending: false }).limit(limit);
        if (who.ids) q2 = q2.in('user_id', who.ids);
        const plainRes = await q2;
        assertDb(plainRes.error, 'Unable to list leads');
        rows = (plainRes.data || []) as Record<string, unknown>[];
      } else {
        assertDb(datedRes.error, 'Unable to list leads');
      }
      const studies = await loadStudies(rows.map((r) => String(r.search_id)));
      const leads = rows.map((h) => describeHit(h, studies, who.people)).sort((a, b) => String(b.enteredAt).localeCompare(String(a.enteredAt)));
      const perPerson: Record<string, { total: number; priceDrops: number }> = {};
      for (const l of leads) { const p = perPerson[l.owner] ?? (perPerson[l.owner] = { total: 0, priceDrops: 0 }); p.total++; if (l.kind === 'baisse de prix') p.priceDrops++; }
      return jsonToolResult({ accounts: who.matched.map(describePerson), since, count: leads.length, dropDatesReliable: dated, perPerson, leads });
    },
  );

  server.registerTool(
    'list_negotiations',
    {
      title: 'ADA : négociations en cours',
      description: 'Les négociations en cours (véhicules enregistrés pour négociation, pas encore clôturées), avec propriétaire, dossier, prix affiché et négocié, notes et date d\'ajout. Filtres facultatifs : personne, dossier.',
      inputSchema: z.object({
        person: z.string().trim().min(1).optional(),
        folder: z.string().trim().min(1).optional().describe('Nom (partiel) du dossier de classement'),
        includeClosed: z.boolean().default(false),
        limit: z.number().int().min(1).max(300).default(100),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ person, folder, includeClosed, limit }) => {
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error, count: 0, negotiations: [] });
      // Dossiers (SQL du 10/09) : table absente → tout est « sans dossier ».
      const foldersRes = await supabase.from('negotiation_folders').select('id, user_id, name, position').limit(1000);
      const folders = foldersRes.error ? [] : (foldersRes.data || []) as Array<{ id: string; user_id: string; name: string; position: number }>;
      const folderName = new Map(folders.map((f) => [f.id, f.name]));
      let query = supabase.from('negotiations')
        .select('id,user_id,title,listing_url,asking_price,negotiated_price,notes,status,folder_id,created_at,updated_at')
        .order('created_at', { ascending: false }).limit(limit);
      if (!includeClosed) query = query.neq('status', 'closed');
      if (who.ids) query = query.in('user_id', who.ids);
      let res = await query;
      if (res.error && isMissingSchema(res.error)) {
        let q2 = supabase.from('negotiations').select('id,user_id,title,listing_url,asking_price,negotiated_price,notes,status,created_at,updated_at')
          .order('created_at', { ascending: false }).limit(limit);
        if (!includeClosed) q2 = q2.neq('status', 'closed');
        if (who.ids) q2 = q2.in('user_id', who.ids);
        res = await q2 as typeof res;
      }
      assertDb(res.error, 'Unable to list negotiations');
      const wantedFolder = normalizeText(folder)?.toLowerCase();
      const rows = ((res.data || []) as Array<Record<string, unknown>>).map((n) => {
        const fid = (n.folder_id as string | null | undefined) ?? null;
        const created = String(n.created_at);
        return {
          id: n.id,
          owner: nameOf(who.people, String(n.user_id)),
          title: n.title,
          url: n.listing_url,
          folder: fid ? (folderName.get(fid) ?? null) : null,
          askingPrice: n.asking_price,
          negotiatedPrice: n.negotiated_price,
          status: n.status === 'pushed_to_sale' ? 'envoyée en vente' : n.status === 'closed' ? 'clôturée' : 'en cours',
          notes: typeof n.notes === 'string' ? n.notes.trim().slice(0, 600) : '',
          addedAt: created,
          ageDays: Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000),
          updatedAt: n.updated_at,
        };
      }).filter((n) => !wantedFolder || (n.folder ?? '').toLowerCase().includes(wantedFolder));
      return jsonToolResult({
        count: rows.length,
        folders: folders.map((f) => ({ owner: nameOf(who.people, f.user_id), name: f.name })),
        negotiations: rows,
      });
    },
  );

  server.registerTool(
    'market_prices',
    {
      title: 'ADA : prix du marché (Market Intelligence)',
      description: "Les derniers relevés de prix d'un véhicule sur un pays, site par site, CHACUN avec ses critères (années, finition, km, carburant), médiane, quartiles, échantillon et URL. Une cote unique n'est donnée que si tous les relevés partagent les mêmes critères. Utile pour « combien vaut une Yaris Cross 2022 aux Pays-Bas ».",
      inputSchema: z.object({
        brand: z.string().trim().min(1),
        model: z.string().trim().min(1),
        country: z.string().trim().min(2).max(3).describe('Code pays ISO (FR, NL, DE, DK, ES, IT, BE, SE, LT, HU…)'),
        fuel: z.string().trim().min(1).optional(),
        trim: z.string().trim().min(1).optional().describe('Finition du relevé (vide = relevé toutes finitions)'),
        year: z.number().int().min(1990).max(2100).optional().describe('Ne garder que les relevés dont les critères couvrent cette année'),
        days: z.number().int().min(1).max(120).default(30),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ brand, model, country, fuel, trim, year, days, limit }) => {
      let query = supabase.from('market_snapshots')
        .select('site,country,brand,model,fuel,trim,scraped_at,listing_count,sample_size,price_min,price_p25,price_median,price_p75,price_max,price_avg,currency,source_url,submitted_by,segment_key')
        .ilike('brand', brand.trim()).ilike('model', `%${model.trim()}%`).eq('country', country.toUpperCase())
        .gte('scraped_at', sinceIso(days)).gt('sample_size', 0)
        .order('scraped_at', { ascending: false }).limit(400);
      if (fuel) query = query.ilike('fuel', `%${fuel.trim()}%`);
      if (trim !== undefined) query = query.ilike('trim', trim ? `%${trim.trim()}%` : '');
      const { data, error } = await query;
      assertDb(error, 'Unable to read market snapshots');
      // Un relevé par (site, carburant, finition, segment) : le plus récent.
      const seen = new Set<string>();
      const latest: Array<Record<string, unknown>> = [];
      for (const row of (data || []) as Array<Record<string, unknown>>) {
        const key = [row.site, row.fuel, row.trim, row.segment_key ?? ''].join('|');
        if (seen.has(key)) continue;
        seen.add(key); latest.push(row);
      }
      // CRITÈRES DU RELEVÉ explicites (constat GPT 14/09 : trim/fuel vides
      // alors que l'URL portait année, finition, km). Segment 'study:<id>' →
      // les critères de l'étude ; 'mi:a=…&b=…&km=…&t=…' → décodés ; '' →
      // modèle entier.
      const studyIds = latest.map((r) => String(r.segment_key ?? '')).filter((k) => k.startsWith('study:')).map((k) => k.slice(6));
      const studies = studyIds.length ? await loadStudies(studyIds) : new Map<string, StudyRow>();
      const criteriaOf = (r: Record<string, unknown>) => {
        const key = String(r.segment_key ?? '');
        if (key.startsWith('study:')) {
          const st = studies.get(key.slice(6));
          if (!st) return { scope: 'étude (critères inconnus)', yearMin: null, yearMax: null, mileageMax: null, trim: null, fuel: null, gearbox: null };
          return {
            scope: `étude « ${st.label} »`, yearMin: st.year_min, yearMax: st.year_max, mileageMax: st.mileage_max,
            trim: (String(r.country) === st.target_country ? st.trim_target || st.trim : st.trim) || null,
            fuel: st.fuel || null, gearbox: st.gearbox || null,
          };
        }
        if (key.startsWith('mi:')) {
          const p = new URLSearchParams(key.slice(3));
          const num = (k: string) => (p.get(k) != null && /^\d+$/.test(p.get(k)!) ? Number(p.get(k)) : null);
          return { scope: 'mise à jour MI à critères', yearMin: num('a'), yearMax: num('b'), mileageMax: num('km'), trim: p.get('t'), fuel: p.get('f'), gearbox: p.get('g') };
        }
        return { scope: 'modèle entier (toutes années, toutes finitions)', yearMin: null, yearMax: null, mileageMax: null, trim: String(r.trim || '') || null, fuel: String(r.fuel || '') || null, gearbox: null };
      };
      const described = latest.map((r) => ({ row: r, criteria: criteriaOf(r) }));
      const kept = described.filter(({ criteria }) => {
        if (year == null) return true;
        if (criteria.yearMin != null && year < criteria.yearMin) return false;
        if (criteria.yearMax != null && year > criteria.yearMax) return false;
        return true;
      }).slice(0, limit);
      // Médiane globale UNIQUEMENT si tous les relevés partagent le même
      // segment : sinon on mélangerait des années et finitions différentes.
      const segKeys = new Set(kept.map(({ criteria }) => JSON.stringify([criteria.yearMin, criteria.yearMax, criteria.mileageMax, (criteria.trim || '').toLowerCase(), (criteria.fuel || '').toLowerCase()])));
      const medians = kept.map(({ row }) => row.price_median).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
      // Critères inconnus (étude supprimée, lecture bloquée) ≠ critères égaux : pas de cote unique.
      const homogeneous = segKeys.size === 1 && kept.every(({ criteria }) => !criteria.scope.includes('inconnus'));
      return jsonToolResult({
        vehicle: `${brand.trim().toUpperCase()} ${model.trim().toUpperCase()}`,
        country: country.toUpperCase(),
        count: kept.length,
        segments: segKeys.size,
        overallMedianOfMedians: homogeneous && medians.length ? medians[Math.floor((medians.length - 1) / 2)] : null,
        overallNote: homogeneous
          ? 'Tous les relevés partagent les mêmes critères : la médiane des médianes est comparable.'
          : segKeys.size === 1
            ? 'Critères des relevés non lisibles : pas de cote unique, lire chaque relevé avec son URL.'
            : `Relevés sur ${segKeys.size} jeux de critères différents (années, finitions, km) : pas de cote unique, lire chaque relevé avec ses critères.`,
        snapshots: kept.map(({ row: r, criteria }) => ({
          site: r.site, scrapedAt: r.scraped_at,
          criteria,
          listingCount: r.listing_count, sampleSize: r.sample_size,
          priceMin: r.price_min, priceP25: r.price_p25, priceMedian: r.price_median, priceP75: r.price_p75, priceMax: r.price_max, priceAvg: r.price_avg,
          currency: r.currency, sourceUrl: r.source_url, origin: r.submitted_by,
        })),
      });
    },
  );

  server.registerTool(
    'truth_status',
    {
      title: 'ADA : Truth Center',
      description: "L'état de fiabilité des données : résumé de la dernière vague (études passées, nouvelles annonces, baisses, erreurs), dossiers de vérité ouverts par signal et par site, et les dossiers les plus prioritaires.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(15),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ limit }) => {
      const [digests, dossiers] = await Promise.all([
        supabase.from('worker_logs').select('created_at, message').like('message', '[TRUTH_DIGEST]%').order('created_at', { ascending: false }).limit(3),
        supabase.from('truth_dossiers').select('id,site,country,brand,model,fuel,signal,layer,doubt_score,priority,status,summary,first_detected_at,last_seen_at')
          .eq('status', 'detected').order('priority', { ascending: false }).order('doubt_score', { ascending: false }).limit(500),
      ]);
      assertDb(dossiers.error, 'Unable to read truth dossiers');
      const open = (dossiers.data || []) as Array<Record<string, unknown>>;
      const bySignal: Record<string, number> = {}; const bySite: Record<string, number> = {};
      for (const d of open) {
        bySignal[String(d.signal)] = (bySignal[String(d.signal)] ?? 0) + 1;
        bySite[String(d.site)] = (bySite[String(d.site)] ?? 0) + 1;
      }
      return jsonToolResult({
        recentDigests: (digests.data || []).map((d) => ({ at: d.created_at, summary: String(d.message).replace(/^\[TRUTH_DIGEST\]\s*/, '') })),
        openDossiers: open.length,
        bySignal, bySite,
        top: open.slice(0, limit).map((d) => ({
          site: d.site, country: d.country, vehicle: `${d.brand} ${d.model}`.trim(), fuel: d.fuel,
          signal: d.signal, layer: d.layer, doubt: d.doubt_score, priority: d.priority, status: d.status, summary: d.summary, since: d.first_detected_at, lastSeenAt: d.last_seen_at,
        })),
      });
    },
  );

  // ── Offres fournisseur (29/09, demande Channing : « donne-lui l'accès aux
  //    offres et au tableau édité ») ────────────────────────────────────────
  server.registerTool(
    'list_offers',
    {
      title: 'ADA : offres fournisseur',
      description: "Liste les offres fournisseur importées dans ADA (page Offres) : titre, fournisseur, statut (draft / sent / closed), pays visés, règle de prix (marge ajoutée au HT fournisseur ou prix fixe), nombre de véhicules et de véhicules retenus, propriétaire, dates. Pour le tableau des véhicules avec nos prix : get_offer.",
      inputSchema: z.object({
        person: z.string().trim().min(1).optional().describe('Propriétaire de l\'offre (prénom)'),
        status: z.enum(['draft', 'sent', 'closed']).optional(),
        supplier: z.string().trim().min(1).optional().describe('Filtre sur le nom du fournisseur (contient)'),
        days: z.number().int().min(1).max(365).default(90).describe('Offres modifiées dans les N derniers jours'),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ person, status, supplier, days, limit }) => {
      const who = await resolvePerson(person);
      if (who.error) return jsonToolResult({ error: who.error, count: 0, offers: [] });
      let q = supabase.from('supplier_offers')
        .select('id,user_id,title,supplier,source_filename,status,countries,price_rule,vehicles,notes,created_at,updated_at')
        .gte('updated_at', sinceIso(days)).order('updated_at', { ascending: false }).limit(limit);
      if (who.ids) q = q.in('user_id', who.ids);
      if (status) q = q.eq('status', status);
      const sup = normalizeText(supplier); if (sup) q = q.ilike('supplier', `%${sup}%`);
      const { data, error } = await q;
      if (isMissingSchema(error)) return jsonToolResult({ note: 'Table supplier_offers absente (SQL du 14/09 non collé).', count: 0, offers: [] });
      assertDb(error, 'Unable to list offers');
      const rows = (data || []) as Array<Record<string, unknown>>;
      return jsonToolResult({
        count: rows.length,
        offers: rows.map((o) => {
          const vehicles = Array.isArray(o.vehicles) ? (o.vehicles as Array<Record<string, unknown>>) : [];
          const rule = (o.price_rule ?? {}) as { mode?: string; margin?: number };
          return {
            id: o.id, title: o.title, supplier: o.supplier, sourceFile: o.source_filename, status: o.status,
            countries: o.countries, priceRule: rule.mode === 'fixed' ? `prix fixe ${rule.margin} €` : `HT fournisseur + ${rule.margin} €`,
            vehicles: vehicles.length, selected: vehicles.filter((v) => v.selected !== false).length,
            owner: nameOf(who.people, String(o.user_id)), notes: o.notes || null, createdAt: o.created_at, updatedAt: o.updated_at,
          };
        }),
      });
    },
  );

  server.registerTool(
    'get_offer',
    {
      title: 'ADA : une offre et son tableau',
      description: "Le tableau édité d'une offre fournisseur : chaque véhicule avec VIN, marque, modèle, version, première immatriculation, km, énergie, motorisation, puissance, boîte, couleur, dommages, lieu, prix fournisseur HT / TTC, TVA récupérable, et NOTRE prix de vente HT (sale_price, règle appliquée puis éventuellement corrigé à la main). Ajoute, s'il existe, le relevé « Où vendre » : par lot et par pays, la médiane des prix affichés et le nombre de concurrents, site par site.",
      inputSchema: z.object({
        id: z.string().trim().min(1).optional().describe('Identifiant de l\'offre (list_offers)'),
        title: z.string().trim().min(1).optional().describe('Sinon : titre de l\'offre (contient)'),
        onlySelected: z.boolean().default(true).describe('Ne garder que les véhicules retenus (cochés)'),
        limit: z.number().int().min(1).max(1000).default(300),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id, title, onlySelected, limit }) => {
      let q = supabase.from('supplier_offers').select('*').limit(1);
      if (id) q = q.eq('id', id);
      else if (normalizeText(title)) q = q.ilike('title', `%${normalizeText(title)}%`).order('updated_at', { ascending: false });
      else return jsonToolResult({ error: 'Donne id ou title.' });
      const { data, error } = await q.maybeSingle();
      if (isMissingSchema(error)) return jsonToolResult({ note: 'Table supplier_offers absente (SQL du 14/09 non collé).' });
      assertDb(error, 'Unable to read offer');
      if (!data) return jsonToolResult({ error: 'Offre introuvable.' });
      const o = data as Record<string, unknown>;
      const people = (await resolvePerson()).people;
      const all = Array.isArray(o.vehicles) ? (o.vehicles as Array<Record<string, unknown>>) : [];
      const kept = (onlySelected ? all.filter((v) => v.selected !== false) : all).slice(0, limit);
      const rule = (o.price_rule ?? {}) as { mode?: string; margin?: number };
      const supplierHt = (v: Record<string, unknown>) => (typeof v.price_ht === 'number' ? Math.round(v.price_ht)
        : typeof v.price_ttc === 'number' && v.vat_recoverable !== false ? Math.round(v.price_ttc / 1.2) : null);
      const market = (o.market ?? null) as Record<string, Record<string, { medianTtc?: number | null; competitors?: number; at?: string; sites?: Record<string, { site: string; count: number; total: number | null; median: number | null; error: string | null; url: string }> }>> | null;
      return jsonToolResult({
        id: o.id, title: o.title, supplier: o.supplier, sourceFile: o.source_filename, status: o.status, countries: o.countries,
        priceRule: rule.mode === 'fixed' ? `prix fixe ${rule.margin} €` : `HT fournisseur + ${rule.margin} €`,
        owner: nameOf(people, String(o.user_id)), notes: o.notes || null, createdAt: o.created_at, updatedAt: o.updated_at,
        vehiclesTotal: all.length, vehiclesSelected: all.filter((v) => v.selected !== false).length, returned: kept.length,
        pricesNote: 'Prix en euros. supplierHt = HT fournisseur (TTC / 1,2 si TVA récupérable). ourPriceHt = notre prix de vente HT (sale_price). Les prix TTC fournisseur sont ceux du fichier, taxes locales telles quelles.',
        vehicles: kept.map((v) => ({
          vin: v.vin, brand: v.brand, model: v.model, version: v.version, firstRegistration: v.reg_date, year: v.year, km: v.km,
          fuel: v.fuel, engine: v.engine, powerCh: v.power_ch, gearbox: v.gearbox, color: v.color, damages: v.damages, location: v.location,
          supplierPriceHt: v.price_ht, supplierPriceTtc: v.price_ttc, supplierHt: supplierHt(v), vatRecoverable: v.vat_recoverable, imported: v.imported,
          ourPriceHt: v.sale_price, selected: v.selected !== false, reportUrl: v.report_url || null, extras: v.extras && Object.keys(v.extras as object).length ? v.extras : undefined,
        })),
        whereToSell: market ? Object.entries(market).map(([lot, byCountry]) => ({
          lot,
          countries: Object.entries(byCountry).map(([country, r]) => ({
            country, medianDisplayedPrice: r.medianTtc ?? null, competitors: r.competitors ?? null, at: r.at ?? null,
            sites: Object.values(r.sites ?? {}).map((s) => ({ site: s.site, listings: s.count, total: s.total, median: s.median, error: s.error, url: s.url })),
          })),
        })) : null,
        lotCriteria: o.lot_criteria ?? null,
      });
    },
  );

  // ── Carte du réseau (29/09 : « la carte, les données et coordonnées ») ───
  server.registerTool(
    'network_contacts',
    {
      title: 'ADA : carte du réseau',
      description: "Les contacts de la carte Europe du réseau MC Export : nom, type (concession, loueur, trader, convoyeur, autre), rôle (vendeur, acheteur, les deux), pays, ville, coordonnées GPS, personne de contact, téléphone, e-mail, site web, relation, types de véhicules, volume mensuel, opportunité, marge, fiabilité, commentaires, part de marché, stock, et les modèles travaillés. Filtres : pays, type, rôle, texte libre.",
      inputSchema: z.object({
        country: z.string().trim().min(2).max(3).optional().describe('Code ISO-2 (FR, NL, DK, ES…)'),
        kind: z.string().trim().min(1).optional().describe('concession | loueur | trader | convoyeur | autre'),
        role: z.string().trim().min(1).optional().describe('vendeur | acheteur | les_deux'),
        query: z.string().trim().min(1).optional().describe('Texte cherché dans le nom, la ville, le contact, la relation ou le commentaire'),
        withModels: z.boolean().default(true),
        limit: z.number().int().min(1).max(500).default(200),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ country, kind, role, query, withModels, limit }) => {
      let q = supabase.from('network_contacts').select('*').order('country', { ascending: true }).order('name', { ascending: true }).limit(limit);
      if (country) q = q.eq('country', country.toUpperCase());
      if (normalizeText(kind)) q = q.eq('kind', normalizeText(kind));
      if (normalizeText(role)) q = q.eq('role', normalizeText(role));
      const text = normalizeText(query);
      if (text) q = q.or(`name.ilike.%${text}%,city.ilike.%${text}%,contact_name.ilike.%${text}%,relation.ilike.%${text}%,comment.ilike.%${text}%,notes.ilike.%${text}%`);
      const { data, error } = await q;
      if (isMissingSchema(error)) return jsonToolResult({ note: 'Table network_contacts absente (SQL du 07/09 non collé).', count: 0, contacts: [] });
      assertDb(error, 'Unable to read network contacts');
      const rows = (data || []) as Array<Record<string, unknown>>;
      const models = new Map<string, Array<{ brand: string; model: string; qty: number | null; note: string }>>();
      if (withModels && rows.length > 0) {
        const { data: mrows } = await supabase.from('network_contact_models').select('contact_id,brand,model,qty,note').in('contact_id', rows.map((r) => String(r.id))).limit(5000);
        for (const m of (mrows || []) as Array<{ contact_id: string; brand: string; model: string; qty: number | null; note: string }>) {
          const list = models.get(m.contact_id) ?? []; list.push({ brand: m.brand, model: m.model, qty: m.qty, note: m.note }); models.set(m.contact_id, list);
        }
      }
      return jsonToolResult({
        count: rows.length,
        contacts: rows.map((c) => ({
          id: c.id, name: c.name, kind: c.kind, role: c.role, country: c.country, city: c.city,
          coordinates: typeof c.lat === 'number' && typeof c.lng === 'number' ? { lat: c.lat, lng: c.lng } : null,
          contactName: c.contact_name || null, phone: c.phone || null, email: c.email || null, website: c.website || null,
          relation: c.relation || null, vehicleTypes: c.vehicle_types || null, monthlyVolume: c.monthly_volume || null,
          opportunity: c.opportunity || null, margin: c.margin || null, reliability: c.reliability || null,
          comment: c.comment || null, notes: c.notes || null, marketShare: c.market_share, stockTotal: c.stock_total,
          models: models.get(String(c.id)) ?? [], updatedAt: c.updated_at,
        })),
      });
    },
  );

  // ── Stock des vitrines relevées (30/09 : « comparer les stocks avec ce
  //    qu'on a dans le MI ») ─────────────────────────────────────────────────
  server.registerTool(
    'dealer_stock',
    {
      title: 'ADA : stock relevé des concessions',
      description: "Le stock des concessions de la carte dont ADA a relevé la vitrine (bouton « Stock relevé » de la carte) : chaque voiture avec prix, prix précédent, km, année, énergie, boîte, plaque, VIN, date de mise en ligne ou de première vue, disparue ou non. Sans contact : vue d'ensemble des concessions relevées (dernier relevé, total, arrivées, départs) ou, avec brand/model, qui a ce modèle en stock. Avec un contact : sa liste, plus un résumé par modèle (nombre, prix médian, km médian, années) prêt à comparer au Market Intelligence via market_prices(brand, model, country du contact).",
      inputSchema: z.object({
        contact: z.string().trim().min(1).optional().describe('Nom de la concession (contient), tel que sur la carte'),
        contactId: z.string().trim().min(1).optional().describe('Identifiant du contact (network_contacts)'),
        country: z.string().trim().min(2).max(3).optional().describe('Code ISO-2 (NL, FR, DE…)'),
        brand: z.string().trim().min(1).optional().describe('Marque (contient)'),
        model: z.string().trim().min(1).optional().describe('Modèle (contient, cherché aussi dans le titre de l\'annonce)'),
        view: z.enum(['stock', 'new', 'gone', 'price_changed', 'all']).default('stock').describe('stock = en stock aujourd\'hui ; new = arrivés depuis N jours ; gone = partis (vendus ?) depuis N jours ; price_changed = prix modifié au dernier relevé ; all = tout'),
        days: z.number().int().min(1).max(365).default(30).describe('Fenêtre pour new / gone'),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ contact, contactId, country, brand, model, view, days, limit }) => {
      const missingNote = { note: 'Tables network_stock_* absentes (SQL du 30/09 non collé).', count: 0, vehicles: [] };
      type Run = { id: string; contact_id: string; url: string; provider: string | null; status: string; total: number | null; new_count: number | null; gone_count: number | null; price_changes: number | null; warnings: string[] | null; error: string | null; started_at: string; finished_at: string | null };
      type Vehicle = Record<string, unknown> & { contact_id: string; brand: string | null; model: string | null; title: string | null; price: number | null; price_prev: number | null; km: number | null; year: number | null; gone_at: string | null; first_seen_at: string; last_seen_at?: string; listed_at: string | null; status?: string | null; price_first?: number | null; price_history?: Array<{ at: string; price: number }> | null };
      const priceMovesOf = (v: Vehicle) => {
        let steps = Array.isArray(v.price_history) ? v.price_history.filter((s) => s && typeof s.price === 'number' && s.price > 0) : [];
        if (steps.length === 0) {
          if (v.price_prev != null && v.price_prev > 0) steps.push({ at: v.first_seen_at, price: v.price_prev });
          if (v.price != null && v.price > 0) steps.push({ at: v.last_seen_at ?? v.first_seen_at, price: v.price });
        }
        steps = [...steps].sort((a, b) => a.at.localeCompare(b.at));
        let drops = 0, raises = 0;
        for (let i = 1; i < steps.length; i++) { if (steps[i].price < steps[i - 1].price) drops++; else if (steps[i].price > steps[i - 1].price) raises++; }
        const first = v.price_first ?? steps[0]?.price ?? null;
        const last = steps.length ? steps[steps.length - 1].price : null;
        const delta = first != null && last != null ? last - first : null;
        return { priceFirst: first, priceHistory: steps, priceDrops: drops, priceRaises: raises, priceDelta: delta, priceDeltaPct: delta != null && first ? Math.round((delta / first) * 1000) / 10 : null };
      };
      const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
      // Lignes relevées avant le 30/09 soir : le fournisseur autodata ne
      // séparait pas le modèle du titre. Même déduction que le worker
      // (splitTitle), en repli seulement.
      const modelOf = (v: Vehicle): string | null => {
        if (v.model) return String(v.model);
        const words = String(v.title ?? '').replace(/\s+/g, ' ').trim().split(' ');
        const two = words.length >= 2 ? `${words[0]} ${words[1]}`.toLowerCase() : '';
        const rest = words.slice(['alfa romeo', 'land rover', 'aston martin', 'rolls royce', 'rolls-royce', 'lynk & co', 'mercedes benz', 'great wall', 'mg motor'].includes(two) ? 2 : 1);
        if (!rest.length) return null;
        const twoWord = ['model', 'range', 'grand', 'serie', 'série', 'classe', 'klasse', 'santa', 'ds', 'id.', 'ioniq'].includes(rest[0].toLowerCase()) || /^[a-z]-$/i.test(rest[0])
          || (/^\d$/.test(rest[0]) && /^(serie|series|série|reeks)$/i.test(rest[1] ?? ''));
        return rest.slice(0, twoWord && rest.length >= 2 ? 2 : 1).join(' ');
      };
      const contactCard = (c: Record<string, unknown>) => ({ id: c.id, name: c.name, kind: c.kind, country: c.country, city: c.city, website: c.website || null, phone: c.phone || null, email: c.email || null, stockTotal: c.stock_total ?? null });
      const runCard = (r: Run) => ({ at: r.started_at, provider: r.provider, status: r.status, total: r.total, newCount: r.new_count, goneCount: r.gone_count, priceChanges: r.price_changes, url: r.url, warnings: r.warnings ?? [], error: r.error });
      const vehicleCard = (v: Vehicle) => ({
        title: v.title, brand: v.brand, model: modelOf(v),
        // Prix absent = null, jamais 0 ; status dit pourquoi (price_on_request / expected / reserved / sold).
        price: typeof v.price === 'number' && v.price > 0 ? v.price : null, pricePrev: v.price_prev, status: v.status ?? null, km: v.km, year: v.year, fuel: v.fuel, gearbox: v.gearbox,
        // Mouvements de prix (01/10 soir) : premier prix, chaque prix daté, baisses comptées — « ont-ils dû baisser pour vendre ? »
        ...priceMovesOf(v),
        plate: v.plate, vin: v.vin, body: v.body, url: v.url, listedAt: v.listed_at, firstSeenAt: v.first_seen_at, lastSeenAt: v.last_seen_at, goneAt: v.gone_at,
        daysListed: Math.floor(((v.gone_at ? new Date(v.gone_at).getTime() : Date.now()) - new Date(String(v.listed_at ?? v.first_seen_at)).getTime()) / 86_400_000),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyFilters = (q: any) => {
        const b = normalizeText(brand); const m = normalizeText(model);
        if (b) q = q.ilike('brand', `%${b}%`);
        if (m) q = q.or(`model.ilike.%${m}%,title.ilike.%${m}%`); // le titre couvre les lignes sans modèle
        if (view === 'stock' || view === 'price_changed') q = q.is('gone_at', null);
        if (view === 'new') q = q.is('gone_at', null).gte('first_seen_at', sinceIso(days));
        if (view === 'gone') q = q.gte('gone_at', sinceIso(days));
        if (view === 'price_changed') q = q.not('price_prev', 'is', null);
        return q;
      };

      // Résolution du contact (aucun, un seul, plusieurs).
      let contactsPool: Array<Record<string, unknown>> = [];
      if (contactId || normalizeText(contact)) {
        let cq = supabase.from('network_contacts').select('*').limit(10);
        cq = contactId ? cq.eq('id', contactId) : cq.ilike('name', `%${normalizeText(contact)}%`);
        if (country) cq = cq.eq('country', country.toUpperCase());
        const { data, error } = await cq;
        assertDb(error, 'Unable to resolve contact');
        contactsPool = (data || []) as Array<Record<string, unknown>>;
        if (contactsPool.length === 0) return jsonToolResult({ error: 'Contact introuvable sur la carte.', count: 0, vehicles: [] });
        if (contactsPool.length > 1) return jsonToolResult({ error: 'Plusieurs contacts correspondent : précise contactId.', choices: contactsPool.map(contactCard), count: 0, vehicles: [] });
      }

      if (contactsPool.length === 0) {
        // Vue d'ensemble : concessions relevées, dernier relevé chacune ;
        // avec brand/model : qui a ce modèle (vue demandée).
        const runsRes = await supabase.from('network_stock_runs').select('*').eq('status', 'done').order('started_at', { ascending: false }).limit(2000);
        if (isMissingSchema(runsRes.error)) return jsonToolResult(missingNote);
        assertDb(runsRes.error, 'Unable to read stock runs');
        const lastRun = new Map<string, Run>();
        for (const r of (runsRes.data || []) as Run[]) if (!lastRun.has(r.contact_id)) lastRun.set(r.contact_id, r);
        const ids = [...lastRun.keys()];
        if (ids.length === 0) return jsonToolResult({ note: 'Aucune vitrine relevée pour l\'instant : lancer « Stock relevé » sur une concession de la carte.', count: 0, dealers: [] });
        let cq = supabase.from('network_contacts').select('*').in('id', ids).limit(ids.length);
        if (country) cq = cq.eq('country', country.toUpperCase());
        const { data: crows, error: cerr } = await cq;
        assertDb(cerr, 'Unable to read contacts');
        const contacts = (crows || []) as Array<Record<string, unknown>>;
        const wantedIds = contacts.map((c) => String(c.id));
        let vq = applyFilters(supabase.from('network_stock_vehicles').select('*').in('contact_id', wantedIds).order('last_seen_at', { ascending: false }).limit(20000));
        const { data: vrows, error: verr } = await vq;
        if (isMissingSchema(verr)) return jsonToolResult(missingNote);
        assertDb(verr, 'Unable to read stock vehicles');
        const byContact = new Map<string, Vehicle[]>();
        for (const v of (vrows || []) as Vehicle[]) { const l = byContact.get(v.contact_id) ?? []; l.push(v); byContact.set(v.contact_id, l); }
        const filtered = !!(normalizeText(brand) || normalizeText(model));
        return jsonToolResult({
          view, filter: filtered ? { brand: normalizeText(brand) ?? null, model: normalizeText(model) ?? null } : null,
          count: contacts.length,
          note: filtered
            ? 'Pour chaque concession : ses véhicules qui correspondent (bornés par limit). Comparer au MI avec market_prices(brand, model, country).'
            : 'Vue d\'ensemble. Pour la liste d\'une concession : rappeler avec contact ou contactId.',
          dealers: contacts.map((c) => {
            const list = byContact.get(String(c.id)) ?? [];
            const prices = list.map((v) => v.price).filter((p): p is number => typeof p === 'number' && p > 0);
            return {
              ...contactCard(c), lastRun: runCard(lastRun.get(String(c.id))!),
              matching: list.length, medianPrice: median(prices),
              vehicles: filtered ? list.slice(0, limit).map(vehicleCard) : undefined,
            };
          }).filter((d) => !filtered || d.matching > 0).sort((a, b) => b.matching - a.matching),
        });
      }

      // Une concession : ses relevés, sa liste, son résumé par modèle.
      const c = contactsPool[0];
      const [runsRes, vehRes] = await Promise.all([
        supabase.from('network_stock_runs').select('*').eq('contact_id', String(c.id)).order('started_at', { ascending: false }).limit(10),
        applyFilters(supabase.from('network_stock_vehicles').select('*').eq('contact_id', String(c.id)).order('price', { ascending: false, nullsFirst: false }).limit(5000)),
      ]);
      if (isMissingSchema(runsRes.error) || isMissingSchema(vehRes.error)) return jsonToolResult(missingNote);
      assertDb(runsRes.error, 'Unable to read stock runs');
      assertDb(vehRes.error, 'Unable to read stock vehicles');
      const runs = (runsRes.data || []) as Run[];
      const vehicles = (vehRes.data || []) as Vehicle[];
      const groups = new Map<string, Vehicle[]>();
      for (const v of vehicles) { const k = `${(v.brand ?? '?').toString().toUpperCase()} ${modelOf(v) ?? '?'}`; const l = groups.get(k) ?? []; l.push(v); groups.set(k, l); }
      const byModel = [...groups.entries()].map(([key, list]) => {
        const prices = list.map((v) => v.price).filter((p): p is number => typeof p === 'number' && p > 0);
        const kms = list.map((v) => v.km).filter((k): k is number => typeof k === 'number');
        const years = list.map((v) => v.year).filter((y): y is number => typeof y === 'number');
        return {
          vehicle: key, brand: list[0].brand, model: modelOf(list[0]), count: list.length,
          priceMin: prices.length ? Math.min(...prices) : null, priceMedian: median(prices), priceMax: prices.length ? Math.max(...prices) : null,
          kmMedian: median(kms), yearMin: years.length ? Math.min(...years) : null, yearMax: years.length ? Math.max(...years) : null,
        };
      }).sort((a, b) => b.count - a.count);
      const gone = vehicles.filter((v) => v.gone_at);
      const stayDays = gone.map((v) => vehicleCard(v).daysListed).filter((d) => d >= 0);
      return jsonToolResult({
        contact: contactCard(c),
        view, days,
        lastRun: runs.find((r) => r.status === 'done') ? runCard(runs.find((r) => r.status === 'done')!) : null,
        runs: runs.map(runCard),
        count: vehicles.length, returned: Math.min(vehicles.length, limit),
        velocityDaysMedian: stayDays.length >= 3 ? median(stayDays) : null,
        // « Ont-ils dû baisser pour vendre ? » : parmi les disparus, part avec ≥ 1 baisse et baisse médiane en %.
        goneWithPriceDrops: (() => {
          const ms = gone.map(priceMovesOf).filter((m) => m.priceFirst != null);
          const dropped = ms.filter((m) => m.priceDrops > 0);
          return { gone: ms.length, dropped: dropped.length, medianDropPct: median(dropped.map((m) => m.priceDeltaPct).filter((p): p is number => p != null)) };
        })(),
        note: `Prix affichés en euros TTC sur le site de la concession (pays ${c.country}). Pour comparer au Market Intelligence : market_prices(brand, model, country="${c.country}"). Les dates listedAt viennent du site quand il les donne, sinon firstSeenAt = première vue par ADA.`,
        byModel,
        vehicles: vehicles.slice(0, limit).map(vehicleCard),
      });
    },
  );

  // ── Boîte à apprendre (01/10 : les cas qu'ADA ne sait pas encore traiter) ─
  server.registerTool(
    'learning_cases',
    {
      title: 'ADA : boîte à apprendre',
      description: "Les cas rencontrés par ADA sans savoir les traiter, enregistrés par le worker au moment où ils se présentent : d'abord les vitrines de concession non reconnues (hôte, URL, titre de page, indices techniques repérés : wordpress, nextjs, typesense…). Chaque cas est unique (kind + key), compté à chaque rencontre, avec un statut open / done / ignored et la résolution notée. Sert à préparer les adaptateurs à écrire ; aucune écriture possible par cet outil.",
      inputSchema: z.object({
        status: z.enum(['open', 'done', 'ignored', 'all']).default('open'),
        kind: z.string().trim().min(1).optional().describe('dealer_site_unknown…'),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ status, kind, limit }) => {
      let q = supabase.from('learning_cases').select('*').order('last_seen_at', { ascending: false }).limit(limit);
      if (status !== 'all') q = q.eq('status', status);
      if (normalizeText(kind)) q = q.eq('kind', normalizeText(kind));
      const { data, error } = await q;
      if (isMissingSchema(error)) return jsonToolResult({ note: 'Table learning_cases absente (SQL du 01/10 non collé).', count: 0, cases: [] });
      assertDb(error, 'Unable to read learning cases');
      const rows = (data || []) as Array<Record<string, unknown>>;
      return jsonToolResult({
        count: rows.length, status,
        cases: rows.map((c) => ({
          id: c.id, kind: c.kind, key: c.key, title: c.title, url: c.url, link: c.link ?? null, actor: c.actor ?? null, contactId: c.contact_id, submittedBy: c.submitted_by,
          detail: c.detail, status: c.status, seenCount: c.seen_count, resolution: c.resolution, createdAt: c.created_at, lastSeenAt: c.last_seen_at, resolvedAt: c.resolved_at,
        })),
      });
    },
  );

  return server;
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

// /health vit HORS de la protection Host/Origin de l'adaptateur MCP : le
// contrôle de santé de Railway se présente avec son propre nom d'hôte
// (healthcheck.railway.app) et restait bloqué en « Invalid Host » — le
// déploiement ne devenait jamais actif (constat 14/09). La protection
// couvre tout le reste, /mcp compris.
const outer = express();
// /health dit QUELLE version tourne et QUELS outils elle publie (29/09 :
// ChatGPT ne voyait que 9 outils — impossible de savoir, depuis le
// navigateur, si le service avait redéployé ou si le connecteur gardait
// une liste en cache). Aucune donnée, aucun secret.
const MCP_VERSION = '0.5.0';
const TOOL_NAMES = ['ada_health', 'list_people', 'list_studies', 'get_study', 'list_inbox', 'list_leads', 'list_negotiations', 'market_prices', 'truth_status', 'list_offers', 'get_offer', 'network_contacts', 'dealer_stock', 'learning_cases'];
outer.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ada-mcp-readonly',
    version: MCP_VERSION,
    mode: 'read-only',
    tools: TOOL_NAMES,
    timestamp: new Date().toISOString(),
  });
});

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ALLOWED_HOSTS,
  ...(ALLOWED_ORIGINS.length > 0 ? { allowedOrigins: ALLOWED_ORIGINS } : {}),
});
outer.use(app);

/**
 * Deux portes, même secret, même comparaison en temps constant :
 *   - en-tête `Authorization: Bearer <ADA_MCP_API_KEY>` sur /mcp ;
 *   - URL secrète /mcp/<ADA_MCP_API_KEY> — pour les clients qui ne savent
 *     poser ni en-tête ni OAuth (connecteur ChatGPT en « sans
 *     authentification »). L'URL vaut alors un mot de passe : ne la coller
 *     que dans la configuration du connecteur.
 */
function tokenFromRequest(req: { header(name: string): string | undefined; params: Record<string, string | undefined> }): string {
  const authorization = req.header('authorization') || '';
  const prefix = 'Bearer ';
  if (authorization.startsWith(prefix)) return authorization.slice(prefix.length).trim();
  return (req.params.token || '').trim();
}

const handler = createMcpHandler(() => buildServer());
const nodeHandler = toNodeHandler(handler);

const guardedMcp = (req: Parameters<typeof nodeHandler>[0] & { header(name: string): string | undefined; params: Record<string, string | undefined>; body?: unknown }, res: Parameters<typeof nodeHandler>[1] & { setHeader(n: string, v: string): unknown; status(c: number): { json(b: unknown): unknown } }) => {
  const token = tokenFromRequest(req);
  if (!token || !constantTimeTokenMatch(token, ADA_MCP_API_KEY)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="ada-mcp"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  void nodeHandler(req, res, req.body);
};

app.all('/mcp', guardedMcp);
app.all('/mcp/:token', guardedMcp);

outer.listen(PORT, '0.0.0.0', () => {
  console.log(`[ADA_MCP] Read-only MCP service listening on 0.0.0.0:${PORT}`);
  console.log(`[ADA_MCP] Allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
  console.log(`[ADA_MCP] Database configured: true`);
  console.log(`[ADA_MCP] Authentication configured: true`);
});
