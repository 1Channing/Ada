/**
 * QUALIFIER UN GARAGE SANS IA (17/10) — tout ce qu'on peut lire soi-même
 * avant de payer un appel : la page du garage sur AutoScout24 (site web,
 * Impressum / mentions légales, vendeurs, type de concession, succursales)
 * et les pages « contact » de son propre site (e-mails publiés, noms).
 * Preuve relevée le 17/10 (autoscout24.de, .nl, .fr) : pageProps.dealerInfoPage
 * { homepageUrl, imprint, contactPersons [{name, position}], dealerTypes
 * [{type, name, makes}], branches, callPhoneNumbers, customerAddress }.
 * Logique pure, partagée par le worker ; testée par test/agents-qualification.test.ts.
 */
import { htmlToText } from './mail';

export interface DealerPageInfo {
  name: string | null;
  website: string | null;
  imprint: string | null;
  contactName: string | null;
  contactPersons: Array<{ name: string; position: string | null }>;
  /** « Vertragshändler Auto : SEAT, Volkswagen » — le libellé du site, dans sa langue. */
  dealerTypes: Array<{ code: string; label: string; makes: string[] }>;
  branches: Array<{ name: string; city: string | null }>;
  phones: string[];
  aboutUs: string | null;
  ratingCount: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function nextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as Record<string, unknown>; } catch { return null; }
}

/** La page « garage » ou « mentions légales » d'AutoScout24 → ce que le garage y déclare. */
export function parseDealerInfoPage(html: string): DealerPageInfo | null {
  const pp = (nextData(html)?.props as { pageProps?: Record<string, unknown> } | undefined)?.pageProps;
  const d = pp?.dealerInfoPage as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return null;
  const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : []);
  const addr = (v: unknown) => (v && typeof v === 'object' ? str((v as Record<string, unknown>).city) : null);
  let ratingCount: number | null = null;
  try {
    const jl = typeof pp?.jsonLd === 'string' ? JSON.parse(pp.jsonLd as string) : pp?.jsonLd;
    const n = Number((jl as { aggregateRating?: { ratingCount?: unknown } } | undefined)?.aggregateRating?.ratingCount);
    ratingCount = Number.isFinite(n) ? n : null;
  } catch { /* jsonLd illisible : sans importance */ }
  const website = str(d.homepageUrl);
  return {
    name: str(d.customerName),
    website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
    imprint: str(d.imprint),
    contactName: str(d.contactName),
    contactPersons: arr(d.contactPersons).map((p) => ({ name: str(p.name) ?? '', position: str(p.position) })).filter((p) => p.name),
    dealerTypes: arr(d.dealerTypes).map((t) => ({
      code: str(t.type) ?? '', label: str(t.name) ?? '',
      makes: arr(t.makes).map((m) => str(m.name)).filter((x): x is string => !!x),
    })).filter((t) => t.label),
    branches: arr(d.branches).map((b) => ({ name: str(b.customerName) ?? '', city: addr(b.customerAddress) })).filter((b) => b.name),
    phones: (Array.isArray(d.callPhoneNumbers) ? d.callPhoneNumbers : []).map(str).filter((x): x is string => !!x),
    aboutUs: str(d.aboutUs)?.slice(0, 600) ?? null,
    ratingCount,
  };
}

// --- E-mails publiés ------------------------------------------------------------

const JUNK_DOMAIN = /(^|\.)(example\.(com|org|net)|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|domain\.(com|tld)|email\.com|test\.com|autoscout24\.[a-z.]+|mobile\.de|schema\.org|w3\.org|googleapis\.com|gstatic\.com)$/i;
const JUNK_LOCAL = /^(no-?reply|noreply|do-?not-?reply|postmaster|mailer-daemon|abuse|webmaster|wordpress|privacy|datenschutz|dpo|rgpd|gdpr|jobs?|karriere|career|vacatures|recrutement|bewerbung)$/i;
const ASSET = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;

/** E-mails écrits dans un texte, y compris masqués : « info(at)garage(dot)de », « vo [at] garage.fr ». */
export function extractEmails(text: string): string[] {
  const t = (text ?? '')
    .replace(/&#64;|&#x40;|%40|＠/gi, '@')
    .replace(/\s*[([{]\s*(at|arobase|ät)\s*[)\]}]\s*/gi, '@')
    .replace(/\s*[([{]\s*(dot|punkt|point|punt)\s*[)\]}]\s*/gi, '.')
    // « vo at garage.fr » : seulement devant un vrai domaine (pas « we are at home »).
    .replace(/\b([a-z0-9._%+-]+)\s+(?:at|arobase)\s+([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:de|fr|nl|be|com|net|org|eu|it|es|dk|at|ch|lu|info|biz))\b/gi, '$1@$2');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of t.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)) {
    const e = m[0].toLowerCase().replace(/\.+$/, '');
    const [local, domain] = e.split('@');
    if (!local || !domain || ASSET.test(e) || JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) continue;
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

/** Les e-mails de liens « mailto: » d'une page. */
export function mailtoEmails(html: string): string[] {
  const out = new Set<string>();
  for (const m of (html ?? '').matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    let e = m[1];
    try { e = decodeURIComponent(e); } catch { /* adresse déjà lisible */ }
    for (const x of extractEmails(e)) out.add(x);
  }
  return [...out];
}

// --- Personnes déclarées ----------------------------------------------------------

// « Geschäftsführer: Michael Fleischmann », « Directeur : Serge Huffmeijer », « Gérant M. Dupont »…
const ROLE_LINE = /^\s*(gesch[äa]ftsf[üu]hr(?:er|erin|ung)|inhaber(?:in)?|vertretungsberechtigt(?:e|er)?|vorstand|directeur(?:\s+g[ée]n[ée]ral)?|directrice|g[ée]rante?|pr[ée]sident(?:e)?|eigena(?:ar|ren)|directie|bestuurder|manager|owner|managing director|ceo|amministratore|titolare|director(?:a)?|gerente|administrador|direkt[øo]r|ejer|indehaver)\b\s*[:\-–]?\s*(.+)$/i;

/** Les dirigeants nommés dans un Impressum / des mentions légales. */
export function extractPeople(text: string): Array<{ name: string; role: string }> {
  const out: Array<{ name: string; role: string }> = [];
  for (const line of (text ?? '').split(/\n|;|\|/)) {
    const m = line.match(ROLE_LINE);
    if (!m) continue;
    for (const raw of m[2].split(/,| und | en | et | and /)) {
      const name = raw.replace(/\(.*?\)/g, '').replace(/^(m\.|mme|herr|frau|dhr\.?|mevr\.?|mr\.?|mrs\.?)\s+/i, '').trim();
      // Un nom propre : 2 à 4 mots, sans chiffres ni « GmbH ».
      if (!/^[\p{L}][\p{L}'’.-]+(\s+[\p{L}][\p{L}'’.-]+){1,3}$/u.test(name) || /gmbh|sarl|b\.?v\.?|ltd|registergericht|telefon/i.test(name)) continue;
      if (!out.some((p) => p.name.toLowerCase() === name.toLowerCase())) out.push({ name, role: m[1].trim() });
    }
  }
  return out.slice(0, 6);
}

// --- Le site du garage ------------------------------------------------------------

const CONTACT_HINT = /(contact|kontakt|impressum|mentions|legal|about|over-?ons|wie-?zijn|over-?ons|equipe|[ée]quipe|team|ueber-?uns|uber-?uns|chi-?siamo|contatti|quienes|contacto|qui-?sommes|ansprechpartner|medewerkers|personeel|verkoop|vente|occasion|gebraucht|vehicules-?occasion)/i;

/** Jusqu'à `max` liens du même site vers les pages contact, équipe, mentions légales. */
export function contactLinks(html: string, baseUrl: string, max = 3): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, '');
  const scored: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>([base.toString().replace(/#.*$/, '')]);
  for (const m of (html ?? '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(m[1], base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
    if (/\.(pdf|jpe?g|png|zip|docx?)$/i.test(u.pathname)) continue;
    const href = u.toString().replace(/#.*$/, '');
    if (seen.has(href)) continue;
    const label = htmlToText(m[2]).toLowerCase();
    const hit = `${u.pathname} ${label}`;
    if (!CONTACT_HINT.test(hit)) continue;
    seen.add(href);
    const score = (/(impressum|mentions|legal)/i.test(hit) ? 3 : 0) + (/(contact|kontakt|contatti|contacto)/i.test(hit) ? 4 : 0)
      + (/(team|[ée]quipe|ansprechpartner|medewerkers|over-?ons|about|qui-?sommes)/i.test(hit) ? 2 : 0) - u.pathname.split('/').length * 0.1;
    scored.push({ url: href, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.url);
}

/** Texte lisible d'une page, borné (les longs menus ne remplissent pas l'appel). */
export function pageText(html: string, maxChars = 6000): string {
  return htmlToText((html ?? '').replace(/<(nav|svg|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1)
    .join('\n').slice(0, maxChars);
}

/** Type de garage d'après les libellés d'AutoScout24 (dans la langue du site). */
export function dealerKindHint(types: DealerPageInfo['dealerTypes']): 'concession_marque' | 'independant' | null {
  const labels = types.map((t) => t.label).join(' | ');
  if (/vertragsh|concession|merkdealer|official|franchis|contract|offici[ae]l|autoris|concesionario/i.test(labels)) return 'concession_marque';
  if (/onafhankelijk|unabh|ind[ée]pendant|multi|freie|independ|plurimarca|multimarca/i.test(labels)) return 'independant';
  return null;
}
