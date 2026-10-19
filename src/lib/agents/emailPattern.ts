/**
 * L'ADRESSE PROBABLE (19/10, Channing : « on garde cette exception, pourquoi
 * pas »). La règle reste : jamais d'adresse devinée. L'exception : quand ADA
 * connaît déjà une VRAIE adresse nominative de la même société — publiée sur
 * une page, sur la carte, dans le Workflow, dans un mail reçu —, le format de
 * la société est prouvé (fjabouille@groupe-dmd.fr → initiale du prénom + nom)
 * et l'agente peut en déduire l'adresse probable d'une autre personne de la
 * société. Elle est affichée comme telle, avec son motif ; elle ne part
 * jamais d'office : seulement sur le clic d'un administrateur, qui sait
 * qu'un rebond abîme la réputation de mc-export.com.
 * Logique pure ; testée par test/agents-memoire.test.ts.
 */
import { deburr, emailDomain, isWebmail } from './people';
import { addressKind } from './qualification';

export const PATTERNS = ['p.n', 'pn', 'p_n', 'p-n', 'in', 'i.n', 'i_n', 'n.p', 'np', 'n_p', 'ni', 'n.i', 'p.i', 'pi', 'p', 'n'] as const;
export type Pattern = typeof PATTERNS[number];
export const PATTERN_LABEL: Record<Pattern, string> = {
  'p.n': 'prénom.nom', pn: 'prénomnom', p_n: 'prénom_nom', 'p-n': 'prénom-nom', in: 'initiale du prénom + nom', 'i.n': 'initiale.nom', i_n: 'initiale_nom',
  'n.p': 'nom.prénom', np: 'nomprénom', n_p: 'nom_prénom', ni: 'nom + initiale du prénom', 'n.i': 'nom.initiale', 'p.i': 'prénom.initiale', pi: 'prénom + initiale', p: 'prénom seul', n: 'nom seul',
};

/** Le prénom et le nom d'une personne : « Prénom Nom », sauf un nom de famille écrit en capitales devant (« DELTEIL Christophe »). */
export function splitName(full: string | null | undefined): { first: string[]; last: string[] } | null {
  const raw = String(full ?? '').trim().replace(/^(m\.|mr\.?|mme|mrs\.?|mlle|dr\.?)\s+/i, '');
  const words = raw.split(/\s+/).filter((w) => /[a-zà-ÿ]/i.test(w));
  if (words.length < 2) return null;
  const upper = (w: string) => w === w.toUpperCase() && w !== w.toLowerCase();
  const surnameFirst = upper(words[0]) && !words.slice(1).every(upper);
  const clean = (ws: string[]) => ws.map((w) => deburr(w).replace(/[^a-z-]/g, '')).filter(Boolean);
  return surnameFirst ? { first: clean(words.slice(1)), last: clean(words.slice(0, 1)) } : { first: clean(words.slice(0, 1)), last: clean(words.slice(1)) };
}

/** Les écritures possibles d'un prénom ou d'un nom composé (« jean-pierre » → jeanpierre, jean-pierre ; « de la tour » → delatour, de-la-tour, tour). */
function variants(parts: string[], last: boolean): string[] {
  const flat = parts.flatMap((p) => p.split('-')).filter(Boolean);
  const out = new Set([flat.join(''), flat.join('-')]);
  if (last && flat.length > 1) out.add(flat[flat.length - 1]);
  return [...out].filter(Boolean);
}

function build(pattern: Pattern, p: string, n: string): string {
  const i = p[0] ?? '';
  switch (pattern) {
    case 'p.n': return `${p}.${n}`;
    case 'pn': return `${p}${n}`;
    case 'p_n': return `${p}_${n}`;
    case 'p-n': return `${p}-${n}`;
    case 'in': return `${i}${n}`;
    case 'i.n': return `${i}.${n}`;
    case 'i_n': return `${i}_${n}`;
    case 'n.p': return `${n}.${p}`;
    case 'np': return `${n}${p}`;
    case 'n_p': return `${n}_${p}`;
    case 'ni': return `${n}${i}`;
    case 'n.i': return `${n}.${i}`;
    case 'p.i': return `${p}.${n[0] ?? ''}`;
    case 'pi': return `${p}${n[0] ?? ''}`;
    case 'p': return p;
    case 'n': return n;
  }
}

/** Les formats qui reproduisent exactement cette adresse pour cette personne (vide : la personne et l'adresse ne vont pas ensemble). */
export function patternsOf(name: string | null | undefined, email: string | null | undefined): Pattern[] {
  const s = splitName(name);
  const local = String(email ?? '').trim().toLowerCase().split('@')[0] ?? '';
  if (!s || !local) return [];
  const out: Pattern[] = [];
  for (const pattern of PATTERNS) {
    if (variants(s.first, false).some((p) => variants(s.last, true).some((n) => build(pattern, p, n) === local))) out.push(pattern);
  }
  return out;
}

/** Une paire connue : une personne et sa vraie adresse (publiée, sur la carte, dans le Workflow, dans un mail reçu). */
export interface KnownPair { name: string; email: string; source: string }
export interface ProvenFormat { domain: string; pattern: Pattern; example: string }

/**
 * Le format prouvé de chaque domaine : celui que toutes les paires connues du domaine partagent (une
 * seule suffit ; deux qui se contredisent : pas de format). Les adresses de service et les messageries
 * grand public ne prouvent rien.
 */
export function provenFormats(pairs: KnownPair[]): ProvenFormat[] {
  const byDomain = new Map<string, Array<{ pats: Pattern[]; email: string }>>();
  for (const x of pairs) {
    const email = x.email.trim().toLowerCase();
    const domain = emailDomain(email);
    if (!domain || isWebmail(domain) || addressKind(email, null, x.name) !== 'personne') continue;
    const pats = patternsOf(x.name, email);
    if (!pats.length) continue;
    const list = byDomain.get(domain) ?? [];
    if (!list.some((y) => y.email === email)) list.push({ pats, email });
    byDomain.set(domain, list);
  }
  const out: ProvenFormat[] = [];
  for (const [domain, list] of byDomain) {
    const common = PATTERNS.filter((p) => list.every((y) => y.pats.includes(p)));
    // Un format « prénom seul » ou « nom seul » ne se prouve pas avec une seule paire (trop d'homonymes).
    const pattern = common.find((p) => (p !== 'p' && p !== 'n') || list.length >= 2);
    if (pattern) out.push({ domain, pattern, example: list[0].email });
  }
  return out;
}

/** L'adresse probable d'une personne dans ce format, ou null (nom illisible). */
export function probableEmail(name: string | null | undefined, f: ProvenFormat): { email: string; motif: string } | null {
  const s = splitName(name);
  if (!s) return null;
  const p = variants(s.first, false)[0];
  const n = variants(s.last, true)[0];
  if (!p || !n) return null;
  const local = build(f.pattern, p, n);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(local)) return null;
  return { email: `${local}@${f.domain}`, motif: `même format que ${f.example} (${PATTERN_LABEL[f.pattern]})` };
}

/**
 * Les adresses probables des personnes d'une fiche qui n'ont pas d'adresse vérifiée : dans le format
 * prouvé d'un domaine de l'entreprise (le premier qui en a un). Jamais pour une personne déjà joignable,
 * jamais une adresse déjà connue comme fausse (« ne plus contacter »).
 */
export function withProbableEmails<T extends { nom: string; email: string | null; email_probable?: string | null; motif?: string | null }>(
  people: T[], formats: ProvenFormat[], companyDomains: string[], blocked: (email: string) => boolean = () => false,
): T[] {
  const f = formats.find((x) => companyDomains.some((d) => d === x.domain || d.endsWith(`.${x.domain}`) || x.domain.endsWith(`.${d}`)));
  if (!f) return people;
  return people.map((x) => {
    if (x.email) return x;
    const p = probableEmail(x.nom, f);
    if (!p || p.email === f.example || blocked(p.email)) return x;
    return { ...x, email_probable: p.email, motif: p.motif };
  });
}
