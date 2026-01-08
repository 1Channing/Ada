/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHARED PURE EXTRACTION UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure functions for extracting data from text/HTML.
 * NO I/O, NO side effects, NO environment variables.
 * Deterministic outputs only.
 */

const DKK_TO_EUR = 0.13;

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
