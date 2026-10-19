/**
 * LE BILAN D'UNE RECHERCHE, À QUI L'A LANCÉE (18/10, Channing : « un bilan
 * de la recherche envoyé par mail à l'utilisateur qui a lancé la recherche,
 * le compte connecté ; si la recherche n'a pas pu aboutir par manque de
 * moyens financiers, proposer soit d'augmenter le budget, soit de finir
 * soi-même, c'est gratuit »). Un mail en texte simple : ce qui était demandé,
 * les entreprises trouvées (et pour une recherche ciblée : la fiche, qui
 * contacter, ce qui manque, les pistes), la dépense ; s'il s'est arrêté
 * faute de budget, les deux chemins — relancer avec plus, ou finir à la
 * main avec les recherches toutes prêtes.
 * La partie pure (le texte) ; l'envoi : worker/agents/targeted.ts.
 */

export interface ResearchMailCompany {
  name: string; city: string | null; type: string | null;
  /** Déjà connue de l'équipe (fiche, carte, Workflow) : pas une nouveauté. */
  known?: boolean;
  /** Sa fiche, si elle est prête : note, grand compte, qui contacter, comment, ce qui manque, les pistes. */
  fiche?: {
    score: number | null; key: boolean; contact: string | null; email: string | null; phone: string | null; missing: string[]; leads: string[];
    /** 19/10 : qui l'équipe y connaît déjà (« Florent Jabouille (carte du réseau) »). */
    team?: string | null;
  } | null;
}

export interface ResearchMailInput {
  agent: 'ada' | 'dana'; name: string;
  /** Ce qui était demandé. */
  ask: { types: string[]; country: string; notes: string | null; limit: number | null };
  companies: ResearchMailCompany[];
  /** Les entreprises écartées (site invérifiable…), en nombre. */
  dropped: number;
  cost: number;
  /** Arrêtée avant la fin : la limite de la recherche, le budget du jour de l'agente, ou l'IA indisponible. */
  stopped: { reason: 'limite' | 'budget' | 'ia'; detail: string } | null;
  /** Ce qui reste à faire à la main (gratuit), avec les recherches toutes prêtes. */
  todo: Array<{ what: string; links: Array<{ label: string; url: string }> }>;
  /** Le lien vers l'onglet Recherche de l'agente. */
  link: string;
}

const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
const s = (n: number) => (n > 1 ? 's' : '');

export const googleUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function researchMail(i: ResearchMailInput): { subject: string; body: string } {
  const what = i.ask.notes ? `« ${i.ask.notes.length > 60 ? `${i.ask.notes.slice(0, 57)}…` : i.ask.notes} »` : i.ask.types.join(', ');
  const fresh = i.companies.filter((c) => !c.known && !c.fiche?.team);
  const lines: string[] = [
    'Bonjour,',
    '',
    `Voici le résultat de la recherche que vous avez lancée${i.ask.notes ? ', avec vos notes' : ''} : ${i.ask.types.join(', ')} · ${i.ask.country}.`,
  ];
  if (i.ask.notes) lines.push(`Vos notes : « ${i.ask.notes} »`);
  lines.push('');
  lines.push(`• Entreprises trouvées : ${fresh.length}${i.companies.length > fresh.length ? ` (et ${i.companies.length - fresh.length} déjà connue${s(i.companies.length - fresh.length)} de l'équipe)` : ''}${i.dropped ? ` — ${i.dropped} écartée${s(i.dropped)} (site invérifiable ou hors sujet)` : ''}`);
  for (const c of i.companies) {
    const head = [`  – ${c.name}${c.city ? ` (${c.city})` : ''}`, c.type, c.known || c.fiche?.team ? 'déjà connue' : null].filter(Boolean).join(' · ');
    lines.push(head);
    const f = c.fiche;
    if (!f) continue;
    const who = [f.contact, f.email, f.phone].filter(Boolean).join(' — ');
    if (f.team) lines.push(`    déjà connue de l'équipe : ${f.team}`);
    lines.push(`    fiche ${f.score ?? '—'}/100${f.key ? ' · grand compte' : ''}${who ? ` · à contacter : ${who}` : ''}`);
    if (f.missing.length) lines.push(`    ce qui manque : ${f.missing.join(', ')}`);
    for (const l of f.leads.slice(0, 3)) lines.push(`    piste : ${l}`);
  }
  lines.push(`• Dépense IA : ${usd(i.cost)}${i.ask.limit ? ` (limite ${usd(i.ask.limit)})` : ''}`);
  lines.push('');
  if (i.stopped) {
    lines.push(`La recherche s'est arrêtée avant la fin : ${i.stopped.detail}.`);
    lines.push('Deux possibilités :');
    lines.push(`1. La relancer avec ${i.stopped.reason === 'limite' ? 'une limite plus haute' : i.stopped.reason === 'budget' ? `plus de budget (le budget du jour ${i.agent === 'dana' ? 'de Dana' : 'd\'Ada'} se règle dans ses Réglages)` : 'l\'IA de nouveau disponible'} : ${i.link}`);
    lines.push('2. La finir vous-même, gratuitement — ce qui reste :');
    if (i.todo.length === 0) lines.push('   (rien de précis : relire les entreprises trouvées dans ADA)');
    for (const t of i.todo) {
      lines.push(`   – ${t.what}`);
      for (const l of t.links) lines.push(`     ${l.label} : ${l.url}`);
    }
    lines.push('');
  }
  lines.push(`Ouvrir dans ADA : ${i.link}`);
  lines.push('');
  lines.push(`— ${i.name}, ${i.agent === 'dana' ? 'l\'assistante achats' : 'l\'assistante commerciale'} de MC Export (IA). Rien n'est envoyé à l'extérieur sans votre validation.`);
  return { subject: `${i.name} — votre recherche : ${what} (${i.ask.country})${i.stopped ? ' — arrêtée avant la fin' : ''}`, body: lines.join('\n') };
}
