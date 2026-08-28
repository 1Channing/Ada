/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHARED PURE EXTRACTION UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure functions for extracting data from text/HTML.
 * NO I/O, NO side effects, NO environment variables.
 * Deterministic outputs only.
 */

// DKK → EUR. Single conversion point for the active Bilbasen parser: the
// listing is stored in EUR (currency 'EUR'), so nothing downstream re-converts.
const DKK_TO_EUR = 0.134;

/**
 * Extract EUR price from text
 */
export function extractEuroPrice(text: string): number | null {
  if (!text || typeof text !== 'string') return null;

  const normalizedText = text
    .replace(/\u00A0/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€');

  const eurPatterns = [
    /€\s*([\d\s.]+)(?:,-|,\d{1,2})?/,
    /([\d\s.]+)\s*€/,
    /([\d\s.]+)\s*EUR\b/i,
    /([\d\s.]+)\s*euros?\b/i,
    /prix[:\s]*([\d\s.]+)/i,
  ];

  for (const pattern of eurPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const captured = match[1];
      const cleaned = captured.replace(/\s/g, '').replace(/\./g, '');
      const price = parseInt(cleaned, 10);

      if (!isNaN(price) && price > 100 && price < 500000) {
        return price;
      }
    }
  }

  return null;
}

/**
 * Extract price from text (supports EUR and DKK, converts DKK to EUR)
 */
export function extractPrice(text: string): number | null {
  const normalizedText = text.replace(/\u00A0/g, ' ');

  // Try EUR first
  const eurPrice = extractEuroPrice(normalizedText);
  if (eurPrice !== null) {
    return eurPrice;
  }

  // Try DKK (removed greedy space matching to avoid mileage confusion)
  const dkkPatterns = [
    /(\d[\d.,']*)\s*kr\.?/i,
    /kr\.?\s*(\d[\d.,']*)/i,
    /(\d[\d.,']*)\s*DKK\b/i,
  ];

  for (const pattern of dkkPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const numStr = match[1].replace(/[\s.,']/g, '');
      const priceDkk = parseInt(numStr, 10);
      if (!isNaN(priceDkk) && priceDkk > 100 && priceDkk < 5000000) {
        return Math.round(priceDkk * DKK_TO_EUR);
      }
    }
  }

  return null;
}

/**
 * Extract year from text
 */
export function extractYear(text: string): number | null {
  const currentYear = new Date().getFullYear();
  const yearMatch = text.match(/\b(20[0-2][0-9])\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2000 && year <= currentYear) {
      return year;
    }
  }
  return null;
}

/**
 * Extract mileage from text
 */
export function extractMileage(text: string): number | null {
  const normalizedText = text.replace(/\u00A0/g, ' ');

  const mileagePatterns = [
    /(\d[\d\s.,']*?)\s*km\b/i,
    /(\d[\d\s.,']*?)km\b/i,
    /kilom[eè]trage[:\s]*(\d[\d\s.,']*)/i,
  ];

  for (const pattern of mileagePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const numStr = match[1].replace(/[\s.,']/g, '');
      const mileage = parseInt(numStr, 10);
      if (!isNaN(mileage) && mileage > 0 && mileage < 1000000) {
        return mileage;
      }
    }
  }
  return null;
}

/**
 * Extract title from HTML
 */
export function extractTitle(html: string): string | null {
  const titlePatterns = [
    /<h[1-6][^>]*>(.*?)<\/h[1-6]>/i,
    /title=["']([^"']+)["']/i,
    /<title[^>]*>(.*?)<\/title>/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Normalize URL to absolute form
 */
export function normalizeUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('/')) {
    return `${baseUrl}${url}`;
  }
  return `${baseUrl}/${url}`;
}

/**
 * Date de MISE EN LIGNE → ISO. Formats PROUVÉS par les sondes du 28/08 :
 *  - ISO complet ou « YYYY-MM-DD hh:mm:ss » (Subito, Gaspedaal, LBC) ;
 *  - « 25 aug 26 » + Vandaag/Gisteren/Eergisteren (Marktplaats) ;
 *  - « 2026. 06. 19 » (Jófogás), ma/tegnap (hongrois aujourd'hui/hier) ;
 *  - relatifs « prieš 3 d. / 2 val. / 5 min. » (Skelbiu).
 * Fail-open : format inconnu ou date aberrante (avant 2010, plus de 2 jours
 * dans le futur) → null, jamais d'invention.
 */
const NL_MONTHS: Record<string, number> = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

export function parsePublishedAt(raw: unknown, now: Date = new Date()): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const sane = (d: Date): string | null => {
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;
    if (t < Date.UTC(2010, 0, 1) || t > now.getTime() + 2 * 86_400_000) return null;
    return d.toISOString();
  };
  // ISO / « YYYY-MM-DD hh:mm:ss » / « YYYY. MM. DD »
  let m = s.match(/^(\d{4})[-. ]+(\d{1,2})[-. ]+(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return sane(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0))));
  }
  const lower = s.toLowerCase();
  // Mots relatifs jour (NL Marktplaats, HU Jófogás)
  const dayWord = { vandaag: 0, gisteren: 1, eergisteren: 2, ma: 0, tegnap: 1 }[lower as string];
  if (dayWord != null && (lower !== 'ma' || s.length <= 3)) {
    return sane(new Date(now.getTime() - dayWord * 86_400_000));
  }
  // « 25 aug 26 » (NL)
  m = lower.match(/^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{2}|\d{4})$/);
  if (m && NL_MONTHS[m[2]]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return sane(new Date(Date.UTC(y, NL_MONTHS[m[2]] - 1, +m[1], 12)));
  }
  // « prieš 3 d. » / « prieš 2 val. » / « prieš 5 min. » / « prieš 1 mėn. » (LT)
  m = lower.match(/prieš\s+(\d+)\s*(min|val|d|mėn|men)\b/);
  if (m) {
    const n = +m[1];
    const ms = m[2] === 'min' ? n * 60_000 : m[2] === 'val' ? n * 3_600_000 : m[2] === 'd' ? n * 86_400_000 : n * 30 * 86_400_000;
    return sane(new Date(now.getTime() - ms));
  }
  return null;
}
