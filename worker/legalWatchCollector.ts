/**
 * VEILLE JURIDIQUE & FISCALE AUTOMATIQUE — collecte réelle par IA.
 *
 * Objectif (demande Channing 27/07) : un référentiel fiscal par pays
 * (UE + Schengen) — coût à l'immatriculation, où les électriques sont
 * favorisées, malus, historique des bonus — plus un fil d'actualités.
 *
 * Fonctionnement :
 *   - Un passage quotidien. À chaque passage, les N profils les plus
 *     périmés de `country_fiscal_profiles` (non vérifiés d'abord, pays ADA
 *     en tête) sont rafraîchis via l'API Claude avec recherche web réelle
 *     et sortie JSON contrainte par schéma. Rotation complète ≈ 1 semaine.
 *   - Chaque rafraîchissement peut aussi remonter des actualités (12
 *     derniers mois) → insérées en 'draft' dans legal_watch_entries,
 *     l'équipe valide depuis la page Veille avant publication.
 *
 * Branchement : variable Railway `ANTHROPIC_API_KEY`. Réglages optionnels
 * dans app_config, clé 'legal_watch' :
 *   { "model": "claude-opus-5", "countries_per_day": 4, "max_searches": 8 }
 * (aucun n'est requis — valeurs par défaut ci-dessous, modifiables sans
 * redéploiement).
 *
 * Appel HTTP brut volontaire : le worker n'embarque aucun SDK (même
 * pattern zéro-dépendance que salesSheetSync).
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

const POLL_MS = 24 * 3600 * 1000;
const DEFAULT_MODEL = 'claude-opus-5';
// Défauts calibrés sur le passage réel du 27/07 : ~1,30 $/pays avec 8
// recherches sur Opus (chaque résultat de recherche est refacturé en entrée à
// chaque itération). On divise le débit par défaut ; tout reste réglable sans
// redéploiement via app_config 'legal_watch'.
const DEFAULT_COUNTRIES_PER_DAY = 2;
const DEFAULT_MAX_SEARCHES = 4;
const DEFAULT_REFRESH_DAYS = 14; // un profil vérifié n'est re-vérifié que tous les N jours
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface LegalWatchConfig {
  model?: string;
  countries_per_day?: number;
  max_searches?: number;
  refresh_days?: number;
}

// Tarifs $/Mtoken (entrée, sortie) pour l'estimation de coût loggée — à titre
// indicatif seulement, la facture Anthropic fait foi.
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

interface FiscalProfileRow {
  country: string;
  country_name: string;
  bloc: string;
  ada_market: boolean;
  verified: boolean;
  updated_at: string;
}

interface CollectedNews {
  kind: 'loi' | 'taxe' | 'reglement';
  title: string;
  summary: string;
  effective_date: string | null;
  source_url: string;
}

interface CollectedProfile {
  registration_cost: string;
  registration_cost_level: 'faible' | 'moyen' | 'eleve';
  ev_favorable: boolean;
  ev_incentives: string;
  malus: string;
  bonus_history: Array<{ year: string; label: string }>;
  news: CollectedNews[];
  sources: string[];
}

/** Schéma de sortie contraint (structured outputs) — le modèle DOIT le respecter. */
const FISCAL_SCHEMA = {
  type: 'object',
  properties: {
    registration_cost: {
      type: 'string',
      description:
        "Coût à l'immatriculation d'une voiture d'occasion importée d'un autre pays de l'UE : taxes et frais, montants ou barèmes concrets, en français, 2-3 phrases max.",
    },
    registration_cost_level: {
      type: 'string',
      enum: ['faible', 'moyen', 'eleve'],
      description: "Niveau relatif du coût d'immatriculation comparé au reste de l'Europe.",
    },
    ev_favorable: {
      type: 'boolean',
      description: 'true si la fiscalité actuelle favorise nettement les véhicules électriques.',
    },
    ev_incentives: {
      type: 'string',
      description: 'Traitement fiscal actuel des électriques (exonérations, réductions), 1-2 phrases.',
    },
    malus: {
      type: 'string',
      description: 'Malus / taxes CO2 actuels applicables, seuils et ordres de grandeur, 1-2 phrases.',
    },
    bonus_history: {
      type: 'array',
      description: "Historique des bonus/subventions à l'achat depuis ~2019, du plus ancien au plus récent.",
      items: {
        type: 'object',
        properties: {
          year: { type: 'string', description: 'Année ou période, ex: "2023" ou "2020-2022".' },
          label: { type: 'string', description: 'Description courte du dispositif et des montants.' },
        },
        required: ['year', 'label'],
        additionalProperties: false,
      },
    },
    news: {
      type: 'array',
      description:
        "Actualités des 12 derniers mois pertinentes pour un négociant automobile (changements de taxes, lois, règlements). Vide si rien de notable.",
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['loi', 'taxe', 'reglement'] },
          title: { type: 'string', description: 'Titre court en français.' },
          summary: { type: 'string', description: 'Résumé en 2-3 phrases, en français.' },
          effective_date: { type: ['string', 'null'], description: "Date d'effet YYYY-MM-DD, ou null si inconnue." },
          source_url: { type: 'string', description: 'URL de la source consultée (vide si aucune).' },
        },
        required: ['kind', 'title', 'summary', 'effective_date', 'source_url'],
        additionalProperties: false,
      },
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description: 'URLs des sources réellement consultées pour ce profil (officielles de préférence).',
    },
  },
  required: [
    'registration_cost',
    'registration_cost_level',
    'ev_favorable',
    'ev_incentives',
    'malus',
    'bonus_history',
    'news',
    'sources',
  ],
  additionalProperties: false,
} as const;

export function startLegalWatchCollector(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[LEGAL_WATCH] en attente de ANTHROPIC_API_KEY — veille automatique inactive');
    return;
  }
  setInterval(() => void collectOnce().catch((e) => console.warn('[LEGAL_WATCH] passage en erreur:', e)), POLL_MS);
  setTimeout(() => void collectOnce().catch((e) => console.warn('[LEGAL_WATCH] passage en erreur:', e)), 180_000);
  console.warn('[LEGAL_WATCH] veille automatique active — rafraîchissement fiscal quotidien par rotation');
}

async function loadConfig(): Promise<Required<LegalWatchConfig>> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'legal_watch').maybeSingle();
  const cfg = (data?.value ?? {}) as LegalWatchConfig;
  return {
    model: cfg.model || DEFAULT_MODEL,
    countries_per_day: cfg.countries_per_day ?? DEFAULT_COUNTRIES_PER_DAY,
    max_searches: cfg.max_searches ?? DEFAULT_MAX_SEARCHES,
    refresh_days: cfg.refresh_days ?? DEFAULT_REFRESH_DAYS,
  };
}

async function collectOnce(): Promise<void> {
  const cfg = await loadConfig();
  // Rotation : non vérifiés d'abord, pays ADA en tête, puis les plus périmés.
  const { data, error } = await supabase
    .from('country_fiscal_profiles')
    .select('country, country_name, bloc, ada_market, verified, updated_at')
    .order('verified', { ascending: true })
    .order('ada_market', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(cfg.countries_per_day * 3);
  if (error) {
    console.warn('[LEGAL_WATCH] lecture des profils impossible:', error.message);
    return;
  }
  const staleBefore = Date.now() - cfg.refresh_days * 24 * 3600 * 1000;
  const due = ((data ?? []) as FiscalProfileRow[])
    .filter((p) => !p.verified || new Date(p.updated_at).getTime() < staleBefore)
    .slice(0, cfg.countries_per_day);
  if (!due.length) {
    console.warn('[LEGAL_WATCH] tous les profils sont frais — rien à rafraîchir aujourd\'hui');
    return;
  }
  console.warn(`[LEGAL_WATCH] passage: ${due.map((p) => p.country).join(', ')} (modèle ${cfg.model})`);
  for (const profile of due) {
    try {
      await refreshCountry(profile, cfg);
    } catch (e) {
      console.warn(`[LEGAL_WATCH] ${profile.country} en échec:`, e instanceof Error ? e.message : e);
    }
  }
}

async function refreshCountry(profile: FiscalProfileRow, cfg: Required<LegalWatchConfig>): Promise<void> {
  const prompt = [
    `Tu travailles pour un négociant automobile européen (arbitrage de voitures d'occasion entre pays UE/Schengen).`,
    `Pays à analyser : ${profile.country_name} (${profile.country}), ${profile.bloc}.`,
    `Recherche sur le web l'état ACTUEL (${new Date().getFullYear()}) de la fiscalité automobile de ce pays, en particulier :`,
    `1. Le coût à l'immatriculation d'une VOITURE D'OCCASION IMPORTÉE d'un autre pays de l'UE (taxes d'immatriculation, barèmes, décotes appliquées aux occasions).`,
    `2. Si les véhicules électriques y sont fiscalement favorisés, et comment.`,
    `3. Les malus / taxes CO2 en vigueur (seuils, montants).`,
    `4. L'HISTORIQUE des bonus/subventions à l'achat depuis 2019 environ (montants, dates de fin ou de réforme).`,
    `5. Les actualités fiscales/légales des 12 derniers mois utiles à un négociant (réformes votées, barèmes ${new Date().getFullYear() + 1}, fins de dispositifs).`,
    `Privilégie les sources officielles (administrations fiscales, journaux officiels) et cite les URLs consultées.`,
    `Réponds en français, de façon factuelle et chiffrée.`,
    // Le passage réel du 27/07 : la prose entre les recherches a fait sauter
    // le plafond de sortie (FR perdu, appel facturé quand même).
    `IMPORTANT : n'écris AUCUN texte d'accompagnement ni commentaire entre tes recherches — ta seule sortie rédigée est le JSON final. Sois dense et bref dans les champs texte.`,
  ].join('\n');

  const body = {
    model: cfg.model,
    // 16000 : l'Autriche a claqué 8000 (28/07, appel facturé perdu) — le
    // plafond ne coûte que s'il est consommé, le JSON final reste petit.
    max_tokens: 16000,
    stream: true,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: cfg.max_searches }],
    output_config: { format: { type: 'json_schema', schema: FISCAL_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12 * 60 * 1000), // CZ a dépassé 8 min (28/07)
  });
  if (!res.ok || !res.body) {
    const errText = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`API ${res.status}: ${errText}`);
  }

  const { text, stopReason, usage } = await readSseText(res.body);
  const [pIn, pOut] = PRICE_PER_MTOK[cfg.model] ?? [0, 0];
  const cost = pIn ? ((usage.input / 1e6) * pIn + (usage.output / 1e6) * pOut).toFixed(2) : '?';
  console.warn(
    `[LEGAL_WATCH] ${profile.country} — ${usage.input} tok entrée / ${usage.output} tok sortie ≈ ${cost} $ (${cfg.model}, ${cfg.max_searches} recherches max)`,
  );
  if (stopReason && stopReason !== 'end_turn') {
    // max_tokens / refusal : on ne parse pas un JSON potentiellement tronqué.
    throw new Error(`stop_reason inattendu: ${stopReason}`);
  }
  let parsed: CollectedProfile;
  try {
    parsed = JSON.parse(text) as CollectedProfile;
  } catch {
    throw new Error(`sortie non-JSON (${text.slice(0, 120)}…)`);
  }

  const { error: upErr } = await supabase
    .from('country_fiscal_profiles')
    .update({
      registration_cost: parsed.registration_cost,
      registration_cost_level: parsed.registration_cost_level,
      ev_favorable: parsed.ev_favorable,
      ev_incentives: parsed.ev_incentives,
      malus: parsed.malus,
      bonus_history: parsed.bonus_history,
      sources: parsed.sources.filter((s) => s.startsWith('http')).slice(0, 10),
      verified: true,
      updated_by: 'collecte IA',
      updated_at: new Date().toISOString(),
    })
    .eq('country', profile.country);
  if (upErr) throw new Error(`écriture profil: ${upErr.message}`);

  const inserted = await insertNewsDrafts(profile.country, parsed.news);
  console.warn(
    `[LEGAL_WATCH] ${profile.country} rafraîchi (immat ${parsed.registration_cost_level}, EV ${parsed.ev_favorable ? 'favorisé' : 'non'}, ${parsed.sources.length} source(s), ${inserted} actu(s) en brouillon)`,
  );
}

/** Insère les actualités en 'draft' (validation humaine) en évitant les doublons titre/URL. */
async function insertNewsDrafts(country: string, news: CollectedNews[]): Promise<number> {
  const items = (news ?? []).filter((n) => n.title?.trim());
  if (!items.length) return 0;
  const { data } = await supabase
    .from('legal_watch_entries')
    .select('title, source_url')
    .eq('country', country)
    .limit(1000);
  const known = new Set<string>();
  for (const e of (data ?? []) as Array<{ title: string; source_url: string }>) {
    known.add(normTitle(e.title));
    if (e.source_url) known.add(e.source_url);
  }
  let inserted = 0;
  for (const n of items) {
    if (known.has(normTitle(n.title)) || (n.source_url && known.has(n.source_url))) continue;
    const effective = /^\d{4}-\d{2}-\d{2}$/.test(n.effective_date ?? '') ? n.effective_date : null;
    const { error } = await supabase.from('legal_watch_entries').insert({
      country,
      kind: ['loi', 'taxe', 'reglement'].includes(n.kind) ? n.kind : 'reglement',
      title: n.title.trim(),
      summary: (n.summary ?? '').trim(),
      effective_date: effective,
      source_url: n.source_url?.startsWith('http') ? n.source_url : '',
      status: 'draft',
      created_by: 'ADA (IA)',
    });
    if (!error) {
      inserted += 1;
      known.add(normTitle(n.title));
    }
  }
  return inserted;
}

const normTitle = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Accumule le texte final d'un flux SSE de l'API Messages (les blocs
 * web_search_tool_result sont ignorés — seul le JSON final nous intéresse)
 * et remonte le stop_reason.
 */
async function readSseText(stream: NodeJS.ReadableStream | ReadableStream<Uint8Array>): Promise<{ text: string; stopReason: string | null; usage: { input: number; output: number } }> {
  let buffer = '';
  let stopReason: string | null = null;
  const usage = { input: 0, output: 0 };
  // Un buffer par bloc texte : le modèle peut parler AVANT ses recherches ;
  // seul le DERNIER bloc texte contient le JSON contraint par le schéma.
  const textByBlock = new Map<number, string>();

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let ev: any;
    try {
      ev = JSON.parse(payload);
    } catch {
      return;
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') textByBlock.set(ev.index, '');
    else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && textByBlock.has(ev.index))
      textByBlock.set(ev.index, textByBlock.get(ev.index) + ev.delta.text);
    else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      if (typeof ev.usage?.output_tokens === 'number') usage.output = Math.max(usage.output, ev.usage.output_tokens);
      if (typeof ev.usage?.input_tokens === 'number') usage.input = Math.max(usage.input, ev.usage.input_tokens);
    } else if (ev.type === 'message_start') {
      const u = ev.message?.usage;
      if (typeof u?.input_tokens === 'number') usage.input = Math.max(usage.input, u.input_tokens);
    } else if (ev.type === 'error') throw new Error(`stream error: ${JSON.stringify(ev.error).slice(0, 300)}`);
  };

  const feed = (chunk: string) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, idx).trimEnd());
      buffer = buffer.slice(idx + 1);
    }
  };

  const decoder = new TextDecoder();
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    feed(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  if (buffer) handleLine(buffer.trimEnd());
  const lastIndex = Math.max(...textByBlock.keys(), -1);
  return { text: lastIndex >= 0 ? (textByBlock.get(lastIndex) as string) : '', stopReason, usage };
}
