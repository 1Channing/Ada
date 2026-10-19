/**
 * LES PERSONNES ET LEURS ADRESSES (19/10) — ce qui sert à reconnaître une
 * personne d'une source à l'autre (« FLORENT JABOUILLE » sur la carte,
 * « Florent Jabouille » dans une page) et le domaine d'une adresse (une
 * messagerie grand public — gmail, orange… — ne dit rien de l'entreprise).
 * Logique pure ; testée par test/agents-banc.test.ts.
 */

/** Minuscules, sans accents. */
export const deburr = (x: string | null | undefined): string => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'van', 'von', 'der', 'den', 'ter', 'het', 'di', 'da', 'del', 'dos', 'mr', 'mme', 'mrs', 'm']);

/** Les mots d'un nom de personne (prénoms, noms), sans particules ni civilités. */
export function personTokens(name: string | null | undefined): string[] {
  return deburr(name).split(/[^a-z]+/).filter((t) => t.length >= 2 && !PARTICLES.has(t));
}

/**
 * La même personne : tous les mots du nom le plus court (deux au moins) se
 * retrouvent dans l'autre — « Jabouille Florent » = « Florent Jabouille »,
 * mais pas « Florent Martin ». Un nom d'un seul mot ne suffit pas.
 */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = personTokens(a);
  const y = personTokens(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 2) return false;
  return short.every((t) => long.includes(t));
}

/** Le domaine d'une adresse (« groupe-dmd.fr »), ou ''. */
export const emailDomain = (email: string | null | undefined): string => {
  const m = String(email ?? '').trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,24})$/);
  return m ? m[1] : '';
};

/** Les messageries grand public : une adresse chez elles ne dit rien de l'entreprise. */
const WEBMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|web|t-online|freenet|orange|wanadoo|free|sfr|neuf|laposte|bbox|numericable|club-internet|aliceadsl|libero|virgilio|tiscali|telenet|skynet|ziggo|kpnmail|planet|home|hetnet|chello|xs4all|online|protonmail|proton|mail|yandex|seznam|wp|onet|o2|interia|telia|bredband|tele2|jubii|ofir|stofanet|post|bluewin|sunrise|hispeed)$/;
export function isWebmail(domain: string | null | undefined): boolean {
  const labels = String(domain ?? '').toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return true;
  // Le nom avant l'extension (« orange » dans orange.fr, « yahoo » dans yahoo.co.uk).
  const second = labels[labels.length - 2];
  const base = labels.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(second) ? labels[labels.length - 3] : second;
  return WEBMAIL.test(base);
}
