/**
 * Détection de pages bloquées/challenge — module FEUILLE volontairement sans
 * aucun import : il est consommé à la fois par scraping.ts et par le registre
 * des adaptateurs (registry.ts). Le garder feuille évite le cycle
 * parsers/index → marketplaces/index → registry → scraping → parsers/index
 * (TDZ « Cannot access siteRegistry before initialization » au boot).
 */

/**
 * Keywords that indicate blocked/captcha pages
 */
// Unmistakable challenge signatures that NEVER appear in legitimate content —
// only on an actual Cloudflare interstitial. Any match = blocked, at any size.
export const BLOCKED_KEYWORDS = [
  'just a moment',            // Cloudflare challenge <title>
  'attention required',       // Cloudflare block page
  'cf-browser-verification',
  'challenge-platform',
  'cf_chl_opt',
  'cf-mitigated',
];

// Ambiguous tokens that ALSO appear on legitimate large pages: "captcha"/
// "recaptcha" (contact-form widgets), "not a robot"/"verify you are human"
// (widget copy), "cloudflare" (ubiquitous CDN in asset URLs / cf-* attributes,
// e.g. AutoScout), "blocked"/"security"/"access denied" (normal copy). A REAL
// block/challenge page is tiny; a real results page is hundreds of KB. So these
// only signal a block on a SMALL page — which kills the AutoScout false
// positives ("cloudflare" earlier, "captcha" on the 677 KB Suzuki page).
const WEAK_BLOCK_KEYWORDS = [
  'captcha', 'recaptcha', 'hcaptcha', 'bot detection',
  'unusual traffic', 'not a robot', 'verify you are human',
  'access denied', 'cloudflare', 'blocked', 'security check',
];
const WEAK_BLOCK_MAX_HTML = 50_000;

/**
 * Detect if HTML content indicates a blocked page
 *
 * @param html - HTML content to check
 * @param hasListings - Whether any listings were extracted
 * @returns Blocked detection result
 */
export function detectBlockedContent(
  html: string,
  hasListings = false
): {
  isBlocked: boolean;
  matchedKeyword: string | null;
  reason: string | null;
} {
  const lowerHtml = html.toLowerCase();

  // Strong signatures → always a block/challenge.
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerHtml.includes(keyword)) {
      return { isBlocked: true, matchedKeyword: keyword, reason: 'keyword_match' };
    }
  }

  // Ambiguous tokens → only trust them on a small page (a real results page is
  // large and just references Cloudflare assets; a challenge page is tiny).
  if (html.length < WEAK_BLOCK_MAX_HTML) {
    for (const keyword of WEAK_BLOCK_KEYWORDS) {
      if (lowerHtml.includes(keyword)) {
        return { isBlocked: true, matchedKeyword: keyword, reason: 'weak_keyword_small_page' };
      }
    }
  }

  // If no listings found on a small page, check for other suspicious patterns.
  if (!hasListings && html.length < WEAK_BLOCK_MAX_HTML) {
    const suspiciousPatterns = ['robot', 'access denied', 'verification'];
    for (const pattern of suspiciousPatterns) {
      if (lowerHtml.includes(pattern)) {
        return { isBlocked: true, matchedKeyword: pattern, reason: 'no_listings_with_suspicious_content' };
      }
    }
  }

  return { isBlocked: false, matchedKeyword: null, reason: null };
}
