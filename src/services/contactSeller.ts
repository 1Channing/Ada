/**
 * CONTACT ASSISTÉ du vendeur (demande Channing 05/09) — jamais d'envoi
 * automatique (conditions des sites, anti-bot, bannissement du worker) :
 * ADA prépare le message dans la langue du pays de l'annonce, le copie dans
 * le presse-papiers et ouvre l'annonce ; l'humain colle, coche, envoie.
 * Texte validé par Channing le 05/09 (X = modèle).
 */

export type ContactLang = 'fr' | 'de' | 'nl' | 'it' | 'es' | 'da' | 'sv' | 'hu' | 'lt' | 'en';

const SIGNATURE = ['Channing - MC Export', 'channing@mc-export.com', 'Whatsapp : (+33)628094976'];

const TEXTS: Record<ContactLang, { hello: string; body: (x: string) => string; thanks: string }> = {
  fr: { hello: 'Bonjour,', body: (x) => `Votre ${x} m'intéresse, pourriez-vous m'indiquer un numéro où vous joindre, et le meilleur moment pour vous appeler ?`, thanks: "Merci d'avance," },
  de: { hello: 'Guten Tag,', body: (x) => `Ihr ${x} interessiert mich. Könnten Sie mir eine Telefonnummer nennen, unter der ich Sie erreichen kann, und wann ich am besten anrufen sollte?`, thanks: 'Vielen Dank im Voraus,' },
  nl: { hello: 'Goedendag,', body: (x) => `Uw ${x} interesseert mij. Kunt u mij een telefoonnummer geven waarop ik u kan bereiken, en het beste moment om te bellen?`, thanks: 'Alvast bedankt,' },
  it: { hello: 'Buongiorno,', body: (x) => `La vostra ${x} mi interessa. Potreste indicarmi un numero a cui contattarvi e il momento migliore per chiamare?`, thanks: 'Grazie in anticipo,' },
  es: { hello: 'Buenos días,', body: (x) => `Me interesa su ${x}. ¿Podría indicarme un número de teléfono donde localizarle y el mejor momento para llamar?`, thanks: 'Gracias de antemano,' },
  da: { hello: 'Hej,', body: (x) => `Jeg er interesseret i din ${x}. Kan du oplyse et telefonnummer, jeg kan nå dig på, og hvornår det passer bedst at ringe?`, thanks: 'På forhånd tak,' },
  sv: { hello: 'Hej,', body: (x) => `Jag är intresserad av din ${x}. Kan du ge mig ett telefonnummer där jag kan nå dig, och när det passar bäst att ringa?`, thanks: 'Tack på förhand,' },
  hu: { hello: 'Jó napot kívánok!', body: (x) => `Érdekel az Ön ${x} hirdetése. Megadna egy telefonszámot, amelyen elérhetem, és hogy mikor a legalkalmasabb hívni?`, thanks: 'Előre is köszönöm,' },
  lt: { hello: 'Laba diena,', body: (x) => `Mane domina Jūsų ${x}. Ar galėtumėte nurodyti telefono numerį, kuriuo galėčiau su Jumis susisiekti, ir kada patogiausia skambinti?`, thanks: 'Iš anksto dėkoju,' },
  en: { hello: 'Hello,', body: (x) => `I am interested in your ${x}. Could you give me a phone number where I can reach you, and the best time to call?`, thanks: 'Thank you in advance,' },
};

export function buildContactMessage(model: string, lang: ContactLang): string {
  const t = TEXTS[lang] ?? TEXTS.en;
  const x = model.trim() || 'véhicule';
  return [t.hello, '', t.body(x), '', t.thanks, ...SIGNATURE].join('\n');
}

/** Langue par pays ADA (BE : les annonces AutoScout .be sont en majorité en français côté MC Export). */
export function langForCountry(country: string): ContactLang {
  switch ((country || '').toUpperCase()) {
    case 'FR': case 'BE': return 'fr';
    case 'DE': case 'AT': return 'de';
    case 'NL': return 'nl';
    case 'IT': return 'it';
    case 'ES': return 'es';
    case 'DK': return 'da';
    case 'SE': return 'sv';
    case 'HU': return 'hu';
    case 'LT': return 'lt';
    default: return 'en';
  }
}

/** Pays d'une annonce d'après son domaine (négociations : pas de pays stocké). */
export function countryFromListingUrl(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes('leboncoin') || h.includes('lacentrale') || h.endsWith('.fr')) return 'FR';
    if (h.includes('mobile.de') || h.endsWith('.de')) return 'DE';
    if (h.includes('marktplaats') || h.includes('gaspedaal') || h.endsWith('.nl')) return 'NL';
    if (h.includes('bilbasen') || h.endsWith('.dk')) return 'DK';
    if (h.includes('blocket') || h.endsWith('.se')) return 'SE';
    if (h.includes('subito') || h.endsWith('.it')) return 'IT';
    if (h.includes('skelbiu') || h.endsWith('.lt')) return 'LT';
    if (h.includes('jofogas') || h.endsWith('.hu')) return 'HU';
    if (h.endsWith('.es')) return 'ES';
    if (h.endsWith('.be')) return 'BE';
    if (h.endsWith('.at')) return 'AT';
  } catch { /* URL illisible */ }
  return '';
}

/** « Kia Sportage 1.6 T-GDi PHEV GT-Line » → « Kia Sportage » (marque + modèle,
 *  coupé avant motorisation/chiffres/séparateurs). L'humain relit avant d'envoyer. */
export function modelFromTitle(title: string): string {
  const cleaned = (title || '').replace(/[|·•]/g, ' ').split(/\s[-–—]\s|,/)[0] ?? '';
  const words = cleaned.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 2 && (/\d/.test(w) || /^(t-?gdi|tdi|tsi|dci|hdi|phev|hybrid|hybride|plug-?in|e-?hybrid|awd|4x4|4wd|automatique|automatic|automaat|automatik|diesel|essence|benzine|benzin|electric|électrique|elektrisch)$/i.test(w))) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out.slice(0, 2).join(' ') || cleaned.slice(0, 40);
}

/** Copie le message, ouvre l'annonce ; renvoie le message préparé. */
export async function contactSeller(input: { title: string; model?: string; country?: string; url: string }): Promise<{ message: string; copied: boolean }> {
  const country = input.country || countryFromListingUrl(input.url);
  const message = buildContactMessage(input.model || modelFromTitle(input.title), langForCountry(country));
  let copied = false;
  try { await navigator.clipboard.writeText(message); copied = true; } catch { /* presse-papiers refusé — le message reste affiché */ }
  if (input.url.startsWith('http')) window.open(input.url, '_blank', 'noopener');
  return { message, copied };
}
