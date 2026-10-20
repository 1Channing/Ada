/**
 * LA RECHERCHE LINKEDIN DÉDIÉE, CÔTÉ WORKER (20/10 ; la partie pure :
 * src/lib/agents/linkedinLookup.ts). Après la recherche approfondie et
 * l'ajout des contacts connus de l'équipe : pour chaque personne de la fiche
 * sans profil (quatre au plus), un petit appel à Haiku avec une recherche
 * web ciblée. Le profil n'est gardé que s'il a été vu dans un résultat et
 * que son adresse porte le nom (acceptedLinkedin). Fail-open : une erreur
 * laisse la fiche telle quelle, avec la trace « rien trouvé » seulement si
 * la recherche a bien eu lieu.
 */
import { live } from './live';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import type { AiAgent } from './qualify';
import { acceptedLinkedin } from '../../src/lib/agents/qualification';
import { HAIKU } from '../../src/lib/agents/aiCost';
import {
  linkedinLookupCandidates, linkedinLookupPrompt, applyLinkedinLookup, displayName, LINKEDIN_LOOKUP_SYSTEM, LINKEDIN_LOOKUP_SCHEMA,
  discoveryTitles, linkedinDiscoveryPrompt, acceptDiscovered, isGroup, LINKEDIN_DISCOVERY_SYSTEM, LINKEDIN_DISCOVERY_SCHEMA, LINKEDIN_DISCOVERY_SEARCHES,
  type LinkedinLookupOutput, type LinkedinDiscoveryOutput,
} from '../../src/lib/agents/linkedinLookup';
import type { RoleSide } from '../../src/lib/agents/roles';
import type { DeepPerson, DeepBest, DeepProspect } from '../../src/lib/agents/deepResearch';

export interface LinkedinLookupResult { people: DeepPerson[]; found: number; searched: number; cost: number }

export async function lookupLinkedin(
  p: Pick<DeepProspect, 'name' | 'group_name' | 'country'>, people: DeepPerson[], best: DeepBest | null,
  a: AiAgent, taskId: string | null, prospectId: string | null, opts: { budgetUsd?: number; max?: number } = {},
): Promise<LinkedinLookupResult> {
  const candidates = linkedinLookupCandidates(people, best, opts.max);
  if (!candidates.length) return { people, found: 0, searched: 0, cost: 0 };
  const at = new Date().toISOString();
  const out = people.map((x) => ({ ...x }));
  let found = 0, searched = 0, cost = 0;
  live(taskId, `${p.name} : profils LinkedIn — ${candidates.map((x) => displayName(x.nom)).join(', ')}`);
  for (const x of candidates) {
    const idx = out.findIndex((y) => y.nom === x.nom && y.source === x.source);
    if (idx < 0) continue;
    try {
      const budget = opts.budgetUsd ?? Number(a.daily_budget_usd);
      const r = await callClaude<LinkedinLookupOutput>({
        agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'linkedin', model: HAIKU,
        system: LINKEDIN_LOOKUP_SYSTEM, user: linkedinLookupPrompt(x, p.name, p.group_name ?? null, p.country ?? null),
        schema: LINKEDIN_LOOKUP_SCHEMA as unknown as Record<string, unknown>,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        maxTokens: 1_500, effort: 'low', prospectId, taskId,
      });
      cost += r.costUsd;
      searched++;
      // Vu dans un résultat ET l'adresse porte le nom : la même règle que la recherche approfondie.
      const accepted = r.data ? acceptedLinkedin(r.data.linkedin, x.nom, r.seenUrls ?? [], r.text ?? '') : null;
      out[idx] = applyLinkedinLookup(out[idx], accepted, r.data, at);
      if (accepted) { found++; live(taskId, `${p.name} : ${displayName(x.nom)} — profil LinkedIn trouvé${r.data?.titre ? ` (« ${r.data.titre} »)` : ''}`); }
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) break; // le plafond du jour ou l'IA en panne : on s'arrête, la fiche reste lisible
      console.warn(`[AGENTS] recherche LinkedIn ${x.nom} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { people: out, found, searched, cost };
}

export interface LinkedinDiscoveryResult { people: DeepPerson[]; added: number; titles: string[]; cost: number }

/**
 * Par poste, sans nom (20/10) : « acheteur VO » Groupe DMD linkedin, « directeur VO » …, dans la langue du
 * pays — qui occupe ces postes aujourd'hui. Les profils vus dans les résultats entrent sur la fiche
 * (nom, titre, adresse) ; ceux déjà connus n'y entrent pas deux fois. Fail-open.
 */
export async function discoverLinkedin(
  p: Pick<DeepProspect, 'name' | 'group_name' | 'country' | 'kind' | 'sites'>, people: DeepPerson[], side: RoleSide,
  a: AiAgent, taskId: string | null, prospectId: string | null, opts: { budgetUsd?: number } = {},
): Promise<LinkedinDiscoveryResult> {
  const group = isGroup(p);
  const titles = discoveryTitles(side, p.country, { group });
  if (!titles.length) return { people, added: 0, titles: [], cost: 0 };
  live(taskId, `${p.name} : qui occupe les postes visés, sur LinkedIn${group ? ' (groupe : le pôle, puis chaque concession)' : ''} — ${titles.map((t) => `« ${t.titre} »`).join(', ')}`);
  try {
    const budget = opts.budgetUsd ?? Number(a.daily_budget_usd);
    const r = await callClaude<LinkedinDiscoveryOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'linkedin_postes', model: HAIKU,
      system: LINKEDIN_DISCOVERY_SYSTEM, user: linkedinDiscoveryPrompt(p.name, p.group_name ?? null, p.country ?? null, titles, { group }),
      schema: LINKEDIN_DISCOVERY_SCHEMA as unknown as Record<string, unknown>,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.max(LINKEDIN_DISCOVERY_SEARCHES, titles.length) }],
      maxTokens: 4_000, effort: 'low', prospectId, taskId,
    });
    const at = new Date().toISOString();
    const added = acceptDiscovered(r.data, people, p.name, p.group_name ?? null, (url, nom) => acceptedLinkedin(url, nom, r.seenUrls ?? [], r.text ?? ''), at);
    if (added.length) {
      const g = added.filter((x) => x.perimetre === 'groupe').length, st = added.filter((x) => x.perimetre === 'site').length;
      live(taskId, `${p.name} : ${added.length} profil${added.length > 1 ? 's' : ''} LinkedIn par poste${group ? ` — ${g} au niveau du groupe, ${st} par concession` : ''} : ${added.map((x) => `${x.nom} (${x.fonction}${x.site ? `, ${x.site}` : ''})`).join(', ')}`);
    }
    return { people: [...people, ...added], added: added.length, titles: titles.map((t) => t.titre), cost: r.costUsd };
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    console.warn(`[AGENTS] recherche LinkedIn par poste ${p.name} : ${e instanceof Error ? e.message : String(e)}`);
    return { people, added: 0, titles: titles.map((t) => t.titre), cost: 0 };
  }
}
