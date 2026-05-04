/**
 * Normalise a string for fuzzy matching between generated params and scraped listing text.
 * Strips accents, lowercases, replaces separators with space, collapses whitespace.
 *
 * Examples:
 *   "RAV-4"           → "rav 4"
 *   "GR+Sport"        → "gr sport"
 *   "Hybride recharg." → "hybride recharg "
 *   "Mercedes-Benz"   → "mercedes benz"
 */
export function normalizeForMatch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/\p{M}/gu, '')   // strip combining diacritical marks (accents)
    .toLowerCase()
    .replace(/[-_+]/g, ' ')   // separators → space
    .replace(/\s+/g, ' ')     // collapse multiple spaces
    .trim();
}
