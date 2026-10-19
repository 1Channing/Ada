/**
 * LA MÉMOIRE DE L'ÉQUIPE (19/10, Channing, sur Groupe DMD : « J'ai fait un
 * test avec Dana pour un client que nous avons déjà […] pour voir si elle
 * trouvait ce que nous avons déjà »). Florent Jabouille était sur la carte —
 * « MUSTIÈTE AUTOMOBILES », faute de frappe —, et Mustière dans le Workflow ;
 * Dana ne lisait ces données que pour écarter les doublons, et même là, la
 * faute de frappe et un autre site (centrevoapro.com) l'ont trompée.
 * Désormais, avant de chercher sur le web, l'agente lit ce que l'équipe sait
 * déjà d'une entreprise — la carte (saisie par l'équipe), le Workflow
 * (clients et fournisseurs), les offres reçues, les mails de sa boîte et
 * les copies de l'équipe — et le rapproche par le domaine des adresses, le
 * site, le téléphone, le nom (même mal orthographié), le groupe.
 * La partie pure (les clés d'une entreprise, le rapprochement, ce qui part
 * dans la consigne, les personnes connues) ; la lecture des tables :
 * worker/agents/team.ts. Testée par test/agents-memoire.test.ts.
 */
import { deburr, emailDomain, isWebmail, samePerson } from './people';
import { phoneKey9 } from './keys';
import type { DeepPerson } from './deepResearch';

/** D'où vient ce que l'équipe sait. */
export type TeamSource = 'carte' | 'workflow' | 'offre' | 'mail' | 'copie' | 'channing';
export const TEAM_SOURCE_LABEL: Record<TeamSource, string> = {
  carte: 'carte du réseau', workflow: 'Workflow', offre: 'offre reçue', mail: 'boîte de l\'agente', copie: 'copie de l\'équipe', channing: 'donné par Channing',
};
/** Les personnes d'une fiche qui viennent de l'équipe (pas d'une page lue). */
export const TEAM_VIAS: ReadonlySet<string> = new Set(['carte', 'workflow', 'offre', 'mail', 'copie', 'channing', 'aiguillage']);

export interface TeamRecord {
  source: TeamSource;
  /** L'identifiant de la ligne d'origine (contact de la carte, du Workflow, message…). */
  ref: string | null;
  company: string | null; country: string | null;
  person: string | null; role: string | null; email: string | null; phone: string | null; website: string | null;
  /** Ce qui lie l'équipe à elle, en clair : « vendeur sur la carte », « client : 5 ventes », « a écrit à Dana le 12/10 ». */
  relation: string | null;
  at?: string | null;
}

/** Ce qui identifie une entreprise : les mots distinctifs de son nom, ses domaines (site, adresses), ses téléphones, son pays. */
export interface CompanyKeys { tokens: string[]; domains: string[]; phones: string[]; country: string | null }

/** Le site sans « www » (« groupe-dmd.fr »), ou ''. */
export function hostOf(url: string | null | undefined): string {
  const u = String(url ?? '').trim().toLowerCase();
  if (!u) return '';
  const h = u.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/:?#].*$/, '').replace(/^www\d?\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,24}$/.test(h) ? h : '';
}

/** Deux domaines de la même entreprise : le même, ou l'un sous l'autre (« mail.groupe-dmd.fr » et « groupe-dmd.fr »). */
export const sameDomain = (a: string, b: string): boolean => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

/** Ce qui ne distingue pas une entreprise : formes juridiques, métier, géographie, marques automobiles. */
const NOT_DISTINCTIVE = new Set([
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'snc', 'sci', 'gmbh', 'bv', 'nv', 'vof', 'bvba', 'sprl', 'srl', 'spa', 'sl', 'slu', 'ag', 'kg', 'ltd', 'llc', 'aps', 'ab', 'oy', 'as', 'co', 'cie', 'ets', 'etablissements',
  'auto', 'autos', 'automobile', 'automobiles', 'automotive', 'automobili', 'autohaus', 'autobedrijf', 'garage', 'garages', 'groupe', 'group', 'gruppe', 'grupo', 'gruppo', 'holding', 'centre', 'center', 'centrum',
  'car', 'cars', 'motor', 'motors', 'occasion', 'occasions', 'pro', 'pros', 'concession', 'concessions', 'concessionnaire', 'agence', 'agent', 'service', 'services', 'distribution', 'diffusion', 'vente', 'ventes',
  'location', 'leasing', 'lease', 'rent', 'rental', 'fleet', 'flotte', 'trading', 'trade', 'handel', 'international', 'europe', 'european', 'france', 'french', 'nederland', 'deutschland', 'belgique', 'belgium', 'italia', 'espana', 'danmark',
  'the', 'and', 'des', 'les', 'van', 'der', 'den', 'het', 'und', 'von', 'del', 'los', 'las', 'sud', 'nord', 'est', 'ouest', 'west', 'east', 'north', 'south', 'neuf', 'neuve', 'plus', 'premium', 'select', 'selection',
  'toyota', 'peugeot', 'renault', 'citroen', 'opel', 'ford', 'volkswagen', 'mercedes', 'benz', 'bmw', 'audi', 'nissan', 'kia', 'hyundai', 'suzuki', 'fiat', 'dacia', 'skoda', 'seat', 'cupra', 'volvo', 'mazda',
  'honda', 'mitsubishi', 'jeep', 'tesla', 'mini', 'lexus', 'alfa', 'romeo', 'porsche', 'land', 'rover', 'jaguar', 'smart', 'byd', 'subaru', 'chevrolet', 'lancia', 'abarth', 'iveco', 'man', 'stellantis',
]);

/** Les mots distinctifs d'un nom d'entreprise (« Centre VO@PRO (Groupe DMD – Mustière Automobiles) » → dmd, mustiere), sans la ville. */
export function distinctiveTokens(name: string | null | undefined, city?: string | null): string[] {
  const where = new Set(deburr(city).split(/[^a-z0-9]+/).filter(Boolean));
  return [...new Set(deburr(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !NOT_DISTINCTIVE.has(t) && !where.has(t)))];
}

/** La distance d'édition (insertion, suppression, remplacement), arrêtée au-delà de `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Deux noms de la même entreprise : un mot distinctif en commun (« dmd »), ou un long mot à une lettre
 * près (« mustiere » / « mustiete » : la faute de frappe de la carte).
 */
export function similarNames(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x === y || (x.length >= 6 && y.length >= 6 && editDistance(x, y, 1) <= 1)));
}

export function companyKeys(c: {
  name: string; group_name?: string | null; website?: string | null; emails?: Array<string | null | undefined>; phone?: string | null; city?: string | null; country?: string | null;
  /** D'autres sites de l'entreprise (celui du groupe, vu par la recherche approfondie). */
  sites?: Array<string | null | undefined>;
}): CompanyKeys {
  const domains = new Set<string>();
  const addHost = (h: string) => { if (h && !isWebmail(h)) domains.add(h); };
  addHost(hostOf(c.website));
  for (const s of c.sites ?? []) addHost(hostOf(s));
  for (const e of c.emails ?? []) addHost(emailDomain(e));
  const tokens = [...new Set([...distinctiveTokens(c.name, c.city), ...distinctiveTokens(c.group_name, c.city)])];
  const phones = [phoneKey9(c.phone)].filter((p) => p.length === 9);
  return { tokens, domains: [...domains], phones, country: (c.country ?? '').toUpperCase() || null };
}

export type TeamWhy = 'domaine' | 'site' | 'telephone' | 'nom';
export type TeamMatch = TeamRecord & { why: TeamWhy };

/**
 * Ce que l'équipe sait de cette entreprise : par le domaine d'une adresse ou du site (quel que soit le
 * pays), par le téléphone, ou par le nom — le nom seulement dans le même pays (deux « Garage Martin »
 * ne sont pas la même entreprise d'un pays à l'autre).
 */
export function teamMatchesFor(k: CompanyKeys, records: TeamRecord[]): TeamMatch[] {
  const out: TeamMatch[] = [];
  for (const r of records) {
    const mail = emailDomain(r.email);
    const site = hostOf(r.website);
    let why: TeamWhy | null = null;
    if (mail && !isWebmail(mail) && k.domains.some((d) => sameDomain(d, mail))) why = 'domaine';
    else if (site && !isWebmail(site) && k.domains.some((d) => sameDomain(d, site))) why = 'site';
    else if (k.phones.length && k.phones.includes(phoneKey9(r.phone))) why = 'telephone';
    else if ((!k.country || !r.country || r.country.toUpperCase() === k.country) && similarNames(k.tokens, distinctiveTokens(r.company))) why = 'nom';
    if (why) out.push({ ...r, why });
  }
  // Une personne une fois : la même adresse, ou le même nom dans la même entreprise.
  const kept: TeamMatch[] = [];
  for (const m of out) {
    const twin = kept.find((x) => (m.email && x.email && m.email.toLowerCase() === x.email.toLowerCase()) || (m.person && x.person && samePerson(m.person, x.person)));
    if (!twin) { kept.push(m); continue; }
    // On garde les deux sources dans la relation (« carte · Workflow »).
    if (m.relation && !(twin.relation ?? '').includes(m.relation)) twin.relation = [twin.relation, m.relation].filter(Boolean).join(' · ');
    twin.phone ??= m.phone; twin.email ??= m.email; twin.role ??= m.role;
  }
  return kept;
}

const WHY_LABEL: Record<TeamWhy, string> = { domaine: 'même domaine e-mail', site: 'même site', telephone: 'même téléphone', nom: 'nom proche' };

/** Une ligne lisible : « Carte du réseau — MUSTIÈTE AUTOMOBILES : Florent Jabouille, fjabouille@groupe-dmd.fr — vendeur sur la carte (même domaine e-mail) ». */
export function teamLine(m: TeamMatch): string {
  const who = [m.person, m.role ? `(${m.role})` : null].filter(Boolean).join(' ');
  const how = [m.email, m.phone].filter(Boolean).join(', ');
  return `${TEAM_SOURCE_LABEL[m.source]}${m.company ? ` — ${m.company}` : ''}${who || how ? ` : ${[who, how].filter(Boolean).join(', ')}` : ''}${m.relation ? ` — ${m.relation}` : ''} (${WHY_LABEL[m.why]})`;
}

/** Ce qui part dans la consigne de l'agente (fiche, recherche approfondie) : ce que l'équipe sait, et quoi en faire. */
export function teamPromptLines(matches: TeamMatch[]): string[] {
  if (!matches.length) return [];
  return [
    '<ce_que_l_equipe_sait_deja>',
    ...matches.slice(0, 8).map((m) => `- ${teamLine(m)}`),
    '</ce_que_l_equipe_sait_deja>',
    'Ces contacts sont DÉJÀ connus de l\'équipe MC Export : ne les cherche pas et ne les rends pas comme une découverte. Cherche ce qui manque (qui décide au-dessus d\'eux, l\'interlocuteur d\'un autre site, le bon service) ; si l\'entreprise est la même, dis-le dans le résumé.',
  ];
}

/** Les personnes connues de l'équipe, telles qu'elles entrent sur la fiche (« via » : leur source ; jamais une page lue). */
export function teamPeople(matches: TeamMatch[]): DeepPerson[] {
  return matches.filter((m) => !!m.person?.trim()).map((m) => ({
    nom: (m.person as string).trim(), fonction: m.role?.trim() || 'contact de l\'équipe', email: m.email?.toLowerCase() ?? null, telephone: m.phone ?? null,
    source: `${TEAM_SOURCE_LABEL[m.source]}${m.relation ? ` — ${m.relation}` : ''}`, via: m.source, connu: true,
  }));
}

/** Ajoute à la fiche les personnes connues de l'équipe qui n'y sont pas encore (rien n'est retiré). */
export function withTeamPeople(people: DeepPerson[], known: DeepPerson[]): DeepPerson[] {
  const out = people.map((x) => ({ ...x }));
  for (const k of known) {
    const twin = out.find((x) => samePerson(x.nom, k.nom) || (!!x.email && !!k.email && x.email.toLowerCase() === k.email.toLowerCase()));
    if (twin) {
      if (!twin.connu) { twin.connu = true; twin.via = twin.via ?? k.via; }
      twin.email ??= k.email; twin.telephone ??= k.telephone;
      continue;
    }
    out.push(k);
  }
  return out;
}

/** La fiche a-t-elle un contact déjà connu de l'équipe ? (Pas de premier mail à froid d'office.) */
export const teamKnownOf = (people: Array<{ nom: string; via?: string | null; connu?: boolean | null }> | null | undefined): Array<{ nom: string; via?: string | null }> =>
  (people ?? []).filter((x) => x.connu === true || (!!x.via && TEAM_VIAS.has(x.via) && x.via !== 'aiguillage'));

/** En une phrase : « carte : Florent Jabouille · Workflow : client, 5 ventes ». */
export function teamSummary(matches: TeamMatch[]): string | null {
  if (!matches.length) return null;
  return matches.slice(0, 3).map((m) => `${m.source === 'carte' ? 'carte' : TEAM_SOURCE_LABEL[m.source]} : ${m.person ?? m.company ?? '?'}${m.person && m.relation ? ` (${m.relation})` : !m.person && m.relation ? ` — ${m.relation}` : ''}`).join(' · ');
}
