/**
 * LE BANC D'ESSAI (19/10, Channing : « c'était le but du test, on voulait
 * voir à quel point Dana était efficace […] elle s'en est bien sortie mais
 * on veut mieux ! »). La carte du réseau sert de grille de réponses : les
 * entreprises dont l'équipe connaît le bon interlocuteur (un nom, une
 * adresse nominative). Pour chacune, l'agente fait sa recherche approfondie
 * « à blanc » — seulement le nom, le pays, la ville et le site, rien de ce
 * que l'équipe sait de la personne, et rien n'est écrit sur une fiche —,
 * puis ADA compare ce qu'elle a trouvé au contact connu. Le même banc avant
 * et après chaque changement de méthode : on voit si elle progresse.
 * La partie pure (qui entre au banc, la fiche à blanc, le verdict, le
 * bilan) ; le travail : worker/agents/bench.ts. Testée par
 * test/agents-banc.test.ts.
 */
import { addressKind } from './qualification';
import { emailDomain, isWebmail, samePerson } from './people';
import type { DeepBest, DeepEmail, DeepPerson, DeepProspect } from './deepResearch';

/** Un contact de la carte, tel que le banc le lit. */
export interface BenchContact {
  id: string; name: string; country: string | null; city: string | null; website: string | null;
  role: string | null; kind: string | null; contact_name: string | null; email: string | null; source?: string | null;
}

/** Ce que le banc confie : n entreprises, le modèle de la recherche approfondie, une limite de dépense. */
export const BENCH_DEFAULT = { n: 10, max: 20, limitUsd: 3 } as const;

/**
 * La grille de réponses d'une agente : les contacts saisis par l'équipe (pas
 * ceux ajoutés par l'IA), avec un nom et une adresse nominative d'entreprise
 * (pas une messagerie grand public) ; du côté de l'agente — Dana : les
 * vendeurs ; Ada : les acheteurs hors de France. Une entreprise par domaine.
 */
export function benchCandidates(rows: BenchContact[], agent: 'ada' | 'dana'): BenchContact[] {
  const seen = new Set<string>();
  return rows
    .filter((c) => (c.source ?? 'manuel') === 'manuel' && !!c.contact_name?.trim() && !!c.email?.trim())
    .filter((c) => (agent === 'dana' ? c.role !== 'acheteur' : c.role !== 'vendeur' && (c.country ?? '').toUpperCase() !== 'FR'))
    .filter((c) => {
      const d = emailDomain(c.email);
      return !!d && !isWebmail(d) && addressKind(c.email as string, null, c.contact_name) === 'personne';
    })
    // Par pays ; une entreprise avec son site d'abord (le banc part de là), puis par nom.
    .sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || Number(!a.website) - Number(!b.website) || a.name.localeCompare(b.name, 'fr'))
    .filter((c) => { const d = emailDomain(c.email); if (seen.has(d)) return false; seen.add(d); return true; });
}

/** Le site de départ : celui de la carte, sinon le domaine de l'adresse de l'entreprise (pas la personne). */
export function benchWebsite(c: BenchContact): string | null {
  const w = (c.website ?? '').trim();
  if (/^https?:\/\//i.test(w)) return w;
  if (w && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(w)) return `https://${w}`;
  const d = emailDomain(c.email);
  return d && !isWebmail(d) ? `https://${d}` : null;
}

/** La fiche « à blanc » : le nom, le pays, la ville et le site — ni la personne, ni son adresse, ni son téléphone. */
export function benchProspect(c: BenchContact): DeepProspect {
  return {
    name: c.name.trim(), country: (c.country ?? '').toUpperCase() || null, city: c.city, website: benchWebsite(c), phone: null,
    kind: null, group_name: null, sites: null, summary: null, key_account: null, account_id: null,
    emails: [], people: [], best_contact: null, evidence: [], fit_score: null, fit_parts: [], score: null, lots: null,
  };
}

/** Du meilleur au moins bon : ce que l'agente a trouvé, face au contact connu de l'équipe. */
export const BENCH_VERDICTS = ['meme_personne', 'autre_direct', 'nomme_service', 'nomme_general', 'service', 'general', 'rien'] as const;
export type BenchVerdict = typeof BENCH_VERDICTS[number];
export const VERDICT_LABEL: Record<BenchVerdict, string> = {
  meme_personne: 'la même personne',
  autre_direct: 'une autre personne, avec son adresse directe',
  nomme_service: 'une personne nommée, avec l\'adresse de son service',
  nomme_general: 'une personne nommée, seulement une adresse générale',
  service: 'une adresse de service, sans nom',
  general: 'seulement une adresse générale',
  rien: 'rien d\'utilisable',
};
/** Les points d'un essai : 100 pour la même personne, 0 pour rien. */
export const VERDICT_POINTS: Record<BenchVerdict, number> = { meme_personne: 100, autre_direct: 75, nomme_service: 60, nomme_general: 40, service: 35, general: 15, rien: 0 };

/** Ce que la recherche a rendu (la fiche telle qu'elle serait après la recherche). */
export interface BenchFound {
  best: DeepBest | null; people: DeepPerson[]; emails: DeepEmail[];
  /** L'adresse probable d'une personne (format prouvé), s'il y en a une. */
  probable?: Array<{ nom: string; email: string }>;
}

export function benchVerdict(known: { name: string; email: string }, f: BenchFound): { verdict: BenchVerdict; detail: string } {
  const knownMail = known.email.trim().toLowerCase();
  const verified = new Set(f.emails.filter((e) => e.mx).map((e) => e.email.toLowerCase()));
  const persons = [...(f.best?.nom ? [{ nom: f.best.nom, email: f.best.email ?? null }] : []), ...f.people.map((p) => ({ nom: p.nom, email: p.email ?? null }))];
  // La même personne : son nom, ou son adresse exacte (publiée, ou probable d'après un format prouvé).
  const byName = persons.find((p) => samePerson(p.nom, known.name));
  if (byName) return { verdict: 'meme_personne', detail: `${byName.nom}${byName.email ? ` — ${byName.email}` : ''}` };
  if (verified.has(knownMail)) return { verdict: 'meme_personne', detail: knownMail };
  const probable = (f.probable ?? []).find((x) => x.email.toLowerCase() === knownMail);
  if (probable) return { verdict: 'meme_personne', detail: `${probable.nom} — ${probable.email} (adresse probable)` };
  // Une autre personne, joignable directement.
  const kindOf = (email: string, who: string | null) => addressKind(email, f.emails.find((e) => e.email === email)?.nature, who);
  const direct = persons.find((p) => p.email && verified.has(p.email.toLowerCase()) && kindOf(p.email, p.nom) === 'personne');
  if (direct) return { verdict: 'autre_direct', detail: `${direct.nom} — ${direct.email}` };
  const named = f.best?.nom ? f.best : persons[0] ? { nom: persons[0].nom, email: persons[0].email } : null;
  const serviceMail = [...verified].find((e) => kindOf(e, named?.nom ?? null) === 'service') ?? null;
  const anyMail = [...verified][0] ?? null;
  if (named?.nom) {
    if (serviceMail) return { verdict: 'nomme_service', detail: `${named.nom} — ${serviceMail}` };
    return { verdict: 'nomme_general', detail: `${named.nom}${anyMail ? ` — ${anyMail}` : ' — pas d\'adresse'}` };
  }
  if (serviceMail) return { verdict: 'service', detail: serviceMail };
  if (anyMail) return { verdict: 'general', detail: anyMail };
  return { verdict: 'rien', detail: 'ni nom ni adresse vérifiée' };
}

/** Un essai du banc, tel qu'il est gardé dans le résultat de la tâche. */
export interface BenchTrial {
  contact_id: string; entreprise: string; pays: string | null;
  connu: { nom: string; email: string };
  trouve: { nom: string | null; fonction: string | null; email: string | null; niveau?: string | null };
  verdict: BenchVerdict; detail: string; points: number; cout_usd: number;
}

/** Le bilan d'un passage : combien de chaque verdict, la note moyenne sur 100, la dépense. */
export function benchTally(trials: BenchTrial[]): { n: number; note: number | null; par_verdict: Record<BenchVerdict, number>; cout_usd: number } {
  const par = Object.fromEntries(BENCH_VERDICTS.map((v) => [v, 0])) as Record<BenchVerdict, number>;
  for (const t of trials) par[t.verdict]++;
  const cost = Math.round(trials.reduce((n, t) => n + t.cout_usd, 0) * 10_000) / 10_000;
  return { n: trials.length, note: trials.length ? Math.round(trials.reduce((n, t) => n + t.points, 0) / trials.length) : null, par_verdict: par, cout_usd: cost };
}
