/**
 * ADA ET DANA CHERCHENT DES COMPTES (17/10, étape 2) — une tâche
 * « recherche_comptes » : un type de compte dans un pays (sociétés de
 * leasing en Belgique, flottes de taxis aux Pays-Bas…).
 * 1. Ce qu'on connaît déjà : les comptes déjà trouvés par l'agente dans ce
 *    pays, ses fiches, la carte du réseau, et les fournisseurs (Dana) ou les
 *    clients (Ada) du Workflow — la consigne demande de ne pas les rendre.
 * 2. Haiku 5.5 cherche sur le web (4 recherches, 2 pages lues au plus) et
 *    rend les entreprises vues, avec leur site officiel, leur taille et
 *    pourquoi elles comptent.
 * 3. Contrôle : on ne garde que les entreprises dont le site officiel est
 *    apparu dans un résultat lu — ou qui répond et porte leur nom —, citées
 *    par une page réellement lue, et pas déjà connues.
 * 4. Elles entrent dans agent_accounts ; la qualification (qui décide,
 *    e-mail publié, LinkedIn) les reprend ensuite, avant l'annuaire.
 * Rien n'est envoyé à personne.
 */
import { HAIKU, fmtUsd } from '../../src/lib/agents/aiCost';
import {
  segmentOf, researchSystem, researchPrompt, RESEARCH_SCHEMA, acceptedAccounts, siteNamesCompany, webKey, COUNTRY_FR,
  type ResearchOutput, type AgentRole, type Known,
} from '../../src/lib/agents/research';
import { HOME_COUNTRY } from '../../src/lib/agents/qualification';
import { live } from './live';
import { nameKey } from '../../src/lib/agents/keys';
import { callClaude } from './claude';
import { fetchPage, knownCounterparts, type AiAgent } from './qualify';
import { sb } from './store';

export interface ResearchResult {
  segment: string; country: string; trouves: number; gardes: number; deja: number; ecartes: number;
  cout_usd: number; comptes: string[]; remarque: string | null; details: string[];
}

/** Ce qu'on connaît déjà dans ce pays (sites et noms), et les noms à citer dans la consigne. */
async function knownFor(agent: string, role: AgentRole, country: string): Promise<Known & { names: string[] }> {
  const webKeys = new Set<string>();
  const nameKeys = new Set<string>();
  const names: string[] = [];
  const add = (name: string | null, website: string | null, cite = false) => {
    const k = webKey(website);
    const n = nameKey(name);
    if (k) webKeys.add(k);
    if (n) nameKeys.add(n);
    if (cite && name) names.push(name);
  };
  // Les comptes déjà trouvés par l'agente dans ce pays (écartés compris) : ce sont eux qu'il faut citer.
  const { data: acc } = await sb.from('agent_accounts').select('name, website').eq('agent', agent).eq('country', country).limit(2000);
  for (const x of (acc ?? []) as Array<{ name: string; website: string }>) add(x.name, x.website, true);
  // Ses fiches dans ce pays (garages de l'annuaire compris), la carte du réseau dans ce pays.
  const { data: pr } = await sb.from('agent_prospects').select('name, website').eq('agent', agent).eq('country', country).limit(5000);
  for (const x of (pr ?? []) as Array<{ name: string; website: string | null }>) add(x.name, x.website);
  const { data: net } = await sb.from('network_contacts').select('name, website').eq('country', country).limit(5000);
  for (const x of (net ?? []) as Array<{ name: string; website: string | null }>) add(x.name, x.website);
  // Les fournisseurs (Dana) ou les clients (Ada) du Workflow, tous pays.
  for (const n of (await knownCounterparts(role === 'dana' ? 'fournisseurs' : 'clients')).names) nameKeys.add(n);
  return { webKeys, nameKeys, names: [...new Set(names)].slice(0, 60) };
}

export async function researchAccounts(taskId: string | null, params: Record<string, unknown>, a: AiAgent): Promise<{ result: ResearchResult; summary: string }> {
  const role: AgentRole = a.agent === 'dana' ? 'dana' : 'ada';
  const segment = segmentOf(role, String(params.segment ?? ''));
  const country = String(params.country ?? '').trim().toUpperCase();
  if (!segment) throw new Error(`type de compte inconnu : ${String(params.segment ?? '?')}`);
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('pays manquant');
  if (role === 'ada' && country === HOME_COUNTRY) throw new Error('Ada vend à l\'export : pas de recherche d\'acheteurs en France');

  // 1-2. Ce qu'on connaît déjà, puis la recherche.
  live(taskId, `Ce que l'équipe connaît déjà en ${COUNTRY_FR[country] ?? country} (pour ne pas le chercher deux fois)`);
  const known = await knownFor(a.agent, role, country);
  live(taskId, `Recherche sur le web : ${segment.label.toLowerCase()} en ${COUNTRY_FR[country] ?? country} (4 recherches au plus)`);
  const budget = Number(a.daily_budget_usd);
  const r = await callClaude<ResearchOutput>({
    // Un budget illisible vaut 0 (pas d'appel), jamais « sans limite ».
    agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'recherche_comptes', model: HAIKU,
    system: researchSystem(role), user: researchPrompt({ role, segment, country, known: known.names }),
    schema: RESEARCH_SCHEMA as unknown as Record<string, unknown>,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 }],
    maxTokens: 8000, effort: 'low', taskId,
  });

  // 3. Le contrôle : site vu ou qui répond et porte son nom ; pas déjà connue.
  const { kept, dropped } = acceptedAccounts(r.data, r.seenUrls, known);
  const proposed = r.data?.comptes?.length ?? 0;
  live(taskId, `${proposed} entreprise${proposed > 1 ? 's' : ''} trouvée${proposed > 1 ? 's' : ''} (${r.webSearches} recherche${r.webSearches > 1 ? 's' : ''}) : contrôle de leur site`);
  const verified: typeof kept = [];
  for (const [i, k] of kept.entries()) {
    live(taskId, `Contrôle ${i + 1} sur ${kept.length} : ${k.name}`, { done: i, total: kept.length });
    if (k.siteSeen) { verified.push(k); continue; }
    const html = await fetchPage(k.website, false);
    if (html && siteNamesCompany(html, k.name)) verified.push(k);
    else dropped.push({ name: k.name, reason: 'site invérifiable' });
  }

  // 4. Les comptes trouvés (une fois par agente, site et pays).
  let saved: string[] = [];
  if (verified.length) {
    const rows = verified.map((k) => ({
      agent: a.agent, segment: segment.key, country, name: k.name, website: k.website, city: k.city, size_hint: k.size, why: k.why,
      sources: k.sources, task_id: taskId, status: 'nouveau',
    }));
    const { data, error } = await sb.from('agent_accounts').upsert(rows, { onConflict: 'agent,web_key,country', ignoreDuplicates: true }).select('name');
    if (error) throw new Error(`comptes non enregistrés : ${error.message}`);
    saved = ((data ?? []) as Array<{ name: string }>).map((x) => x.name);
  }
  const deja = dropped.filter((x) => x.reason === 'déjà connue' || x.reason === 'en double').length;
  const ecartes = dropped.length - deja;
  const result: ResearchResult = {
    segment: segment.key, country, trouves: r.data?.comptes?.length ?? 0, gardes: saved.length, deja, ecartes,
    cout_usd: Math.round(r.costUsd * 10_000) / 10_000, comptes: saved, remarque: r.data?.remarque ?? null,
    details: dropped.map((x) => `${x.name} : ${x.reason}`).slice(0, 20),
  };
  const pl = (n: number) => (n > 1 ? 's' : '');
  const summary = `Recherche ${segment.label.toLowerCase()} · ${COUNTRY_FR[country] ?? country} : ${saved.length} compte${pl(saved.length)} trouvé${pl(saved.length)}`
    + `${deja ? `, ${deja} déjà connu${pl(deja)}` : ''}${ecartes ? `, ${ecartes} écarté${pl(ecartes)} (invérifiable${pl(ecartes)})` : ''} — ${fmtUsd(result.cout_usd)}`;
  return { result, summary };
}
