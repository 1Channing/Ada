/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DETAIL PAGE PARSERS - FAIL-CLOSED, SOURCE-LIMITED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HARD RULES:
 * 1. Extract ONLY from seller's description text (ad body), not entire DOM
 * 2. Extract ONLY from structured equipment sections (if available)
 * 3. NEVER parse footer, nav, legal, reviews, or global page content
 * 4. If unsure, return "None mentioned"
 * 5. Store evidence snippets showing exact phrases that triggered extraction
 *
 * Premium options: whitelist only, no inference
 * Maintenance/Defects: sentence-level extraction from seller text only
 */

export interface DetailPageData {
  options: string[];
  entretien: string;
  defects_summary: string;
  maintenance_summary: string;
  car_image_urls: string[];
  year?: number | null;
  mileage?: number | null;
}

interface SellerContent {
  description: string;
  structuredEquipment: string[];
  rawDescriptionLength?: number; // For Leboncoin logging
  year?: number | null;
  mileage?: number | null;
}

const PREMIUM_OPTIONS = [
  { keywords: ['toit panoramique', 'toit ouvrant panoramique', 'sunroof panoramic', 'panoramic roof'], label: 'Toit panoramique' },
  { keywords: ['jbl', 'harman kardon', 'bose', 'b&o', 'bang & olufsen', 'burmester'], label: 'Audio premium' },
  { keywords: ['hayon électrique', 'coffre électrique', 'hands-free tailgate', 'power tailgate'], label: 'Hayon électrique' },
  { keywords: ['phares laser', 'laser headlights', 'matrix led', 'phares matrix', 'adaptive led'], label: 'Phares LED/Matrix' },
  { keywords: ['affichage tête haute', 'head-up display', 'hud'], label: 'Affichage tête haute' },
  { keywords: ['caméra 360', 'camera 360', '360 camera', 'vue 360'], label: 'Caméra 360°' },
  { keywords: ['aide au stationnement', 'park assist', 'parking automatique', 'auto park'], label: 'Aide au stationnement' },
  { keywords: ['régulateur adaptatif', 'adaptive cruise', 'acc', 'cruise control adaptatif'], label: 'Régulateur adaptatif' },
  { keywords: ['détection angle mort', 'blind spot', 'surveillance angle mort', 'blis'], label: 'Détection angle mort' },
  { keywords: ['sièges chauffants', 'sièges ventilés', 'heated seats', 'ventilated seats', 'sieges chauffants'], label: 'Sièges chauffants/ventilés' },
  { keywords: ['sièges à mémoire', 'memory seats', 'sieges memoire'], label: 'Sièges à mémoire' },
  { keywords: ['attelage', 'trekhaak', 'towbar', 'crochet attelage'], label: 'Attelage' },
  { keywords: ['suspension adaptative', 'adaptive suspension', 'suspension pneumatique', 'air suspension'], label: 'Suspension adaptative' },
];

const STRONG_MAINTENANCE_TOKENS = [
  'révision', 'vidange', 'carnet', 'factures', 'entretien toyota', 'entretien mercedes',
  'entretien bmw', 'entretien audi', 'distribution', 'courroie', 'timing belt',
  'embrayage', 'plaquettes', 'pneus neufs', 'ct ', 'contrôle technique',
  'concessionnaire', 'historique entretien', 'carnet entretien', 'service complet',
  'révisions', 'vidanges',
];

const DEFECT_TOKENS = [
  'rayé', 'rayure', 'rayures', 'égratignure', 'éraflure',
  'bosse', 'bosses', 'choc', 'impact', 'coup',
  'usure', 'usé', 'abîmé', 'endommagé',
  'rouille', 'corrosion', 'oxydation',
  'fissure', 'fissuré', 'craquelé', 'brisé',
  'peinture', 'carrosserie', 'jante', 'jantes', 'pare-choc', 'pare-chocs',
  'griffe', 'griffure', 'défaut', 'problème',
];

/**
 * Template/equipment patterns that indicate boilerplate content
 */
const LEBONCOIN_TEMPLATE_PATTERNS = [
  'OPTIONS ET ÉQUIPEMENTS',
  'Télécommunications',
  'Label Toyota Occasions',
  'Consommation',
  'Audio :',
  'Sécurité :',
  'Confort :',
  'Équipements :',
  'Garantie :',
];

/**
 * Clean seller description by removing template/equipment boilerplate
 * FAIL-CLOSED: Strip everything from first template pattern onward
 */
function cleanLeboncoinDescription(rawDescription: string): string {
  if (!rawDescription) return '';

  let cleaned = rawDescription;

  // Find first occurrence of any template pattern
  let firstPatternIndex = -1;
  for (const pattern of LEBONCOIN_TEMPLATE_PATTERNS) {
    const index = cleaned.indexOf(pattern);
    if (index !== -1 && (firstPatternIndex === -1 || index < firstPatternIndex)) {
      firstPatternIndex = index;
    }
  }

  // Strip from first pattern onward
  if (firstPatternIndex !== -1) {
    cleaned = cleaned.substring(0, firstPatternIndex).trim();
  }

  return cleaned;
}

/**
 * Quality gate: detect if text looks like an equipment list (fail-closed)
 * Returns true if text appears to be boilerplate/lists rather than prose
 */
function isEquipmentList(text: string): boolean {
  if (!text || text.length < 20) return true;

  const colonCount = (text.match(/:/g) || []).length;
  const dashCount = (text.match(/-/g) || []).length;
  const words = text.split(/\s+/);
  const uppercaseWords = words.filter(w => w === w.toUpperCase() && w.length > 2).length;

  // Detect list-like patterns
  const hasManySeparators = colonCount >= 3 || dashCount >= 5;
  const hasManyUppercase = words.length > 0 && (uppercaseWords / words.length) > 0.6;

  return hasManySeparators || hasManyUppercase;
}

/**
 * Extract seller's description text from Leboncoin HTML
 * FAIL-CLOSED: Only extracts from __NEXT_DATA__ ad body, strips templates
 */
function extractLeboncoinSellerContent(html: string): SellerContent {
  const nextDataPatterns = [
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script\s+type=["']application\/json["'][^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];

  let nextDataMatch = null;
  for (const pattern of nextDataPatterns) {
    nextDataMatch = html.match(pattern);
    if (nextDataMatch) break;
  }

  if (!nextDataMatch) {
    return { description: '', structuredEquipment: [] };
  }

  try {
    const data = JSON.parse(nextDataMatch[1]);

    // Navigate to ad data
    const possiblePaths = [
      data?.props?.pageProps?.ad,
      data?.props?.pageProps?.adData,
      data?.props?.pageProps?.initialData?.ad,
    ];

    let adData = null;
    for (const path of possiblePaths) {
      if (path && typeof path === 'object') {
        adData = path;
        break;
      }
    }

    if (!adData) {
      return { description: '', structuredEquipment: [] };
    }

    // Extract and clean seller's description (body text)
    const rawDescription = adData.body || adData.description || adData.text || '';
    const description = cleanLeboncoinDescription(rawDescription);

    // Extract year and mileage if explicitly present (FAIL-CLOSED)
    let year: number | null = null;
    let mileage: number | null = null;

    if (adData.attributes && Array.isArray(adData.attributes)) {
      for (const attr of adData.attributes) {
        if (attr.key === 'regdate' && attr.value) {
          const yearMatch = String(attr.value).match(/(\d{4})/);
          if (yearMatch) year = parseInt(yearMatch[1], 10);
        }
        if (attr.key === 'mileage' && attr.value) {
          const mileageNum = parseInt(String(attr.value), 10);
          if (!isNaN(mileageNum) && mileageNum > 0) mileage = mileageNum;
        }
      }
    }

    // Extract structured equipment from attributes (FAIL-CLOSED)
    const structuredEquipment: string[] = [];
    if (adData.attributes && Array.isArray(adData.attributes)) {
      for (const attr of adData.attributes) {
        // Look for equipment-related attributes
        if (attr.key && attr.value && typeof attr.value === 'string') {
          const attrLower = attr.key.toLowerCase();
          // Common Leboncoin equipment attribute keys
          if (attrLower.includes('equipment') || attrLower.includes('options') ||
              attrLower === 'vehicule_equipments' || attrLower === 'equipments') {
            const values = String(attr.value).toLowerCase().split(/[,;|]/);
            for (const val of values) {
              const cleaned = val.trim();
              if (cleaned.length > 2) {
                structuredEquipment.push(cleaned);
              }
            }
          }
        }
        // Also check if value is an array of equipment items
        if (attr.key && Array.isArray(attr.value)) {
          for (const item of attr.value) {
            if (typeof item === 'string' && item.trim().length > 2) {
              structuredEquipment.push(item.toLowerCase().trim());
            }
          }
        }
      }
    }

    return {
      description,
      structuredEquipment,
      rawDescriptionLength: rawDescription.length,
      year,
      mileage
    };
  } catch (error) {
    return { description: '', structuredEquipment: [] };
  }
}

/**
 * Extract seller's description text from Marktplaats HTML
 * FAIL-CLOSED: Only extracts from description container
 */
function extractMarktplaatsSellerContent(html: string): SellerContent {
  const descPatterns = [
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  ];

  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      const description = match[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (description.length > 50) {
        return { description, structuredEquipment: [] };
      }
    }
  }

  return { description: '', structuredEquipment: [] };
}

/**
 * Extract seller's description text from Bilbasen HTML
 * FAIL-CLOSED: Only extracts from description section
 */
function extractBilbasenSellerContent(html: string): SellerContent {
  const descPatterns = [
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="description"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      const description = match[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (description.length > 50) {
        return { description, structuredEquipment: [] };
      }
    }
  }

  return { description: '', structuredEquipment: [] };
}

/**
 * Extract seller's description text from Gaspedaal HTML
 * FAIL-CLOSED: Only extracts from description section
 */
function extractGaspedaalSellerContent(html: string): SellerContent {
  const descPatterns = [
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      const description = match[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (description.length > 50) {
        return { description, structuredEquipment: [] };
      }
    }
  }

  return { description: '', structuredEquipment: [] };
}

/**
 * Extract seller content based on marketplace
 */
function extractSellerContent(html: string, listingUrl: string): SellerContent {
  if (listingUrl.includes('leboncoin.fr')) {
    return extractLeboncoinSellerContent(html);
  } else if (listingUrl.includes('marktplaats.nl')) {
    return extractMarktplaatsSellerContent(html);
  } else if (listingUrl.includes('bilbasen.dk')) {
    return extractBilbasenSellerContent(html);
  } else if (listingUrl.includes('gaspedaal.nl')) {
    return extractGaspedaalSellerContent(html);
  }

  return { description: '', structuredEquipment: [] };
}

/**
 * Extract premium options from seller description and structured equipment
 * STRICT: Only returns options found in whitelist with exact keyword match
 * FAIL-CLOSED: Uses structured equipment for Leboncoin if available
 */
function extractPremiumOptions(content: SellerContent, _isLeboncoin: boolean): { options: string[]; evidence: string[]; source: string } {
  const options: string[] = [];
  const evidence: string[] = [];
  let source = 'none';
  const descLower = content.description.toLowerCase();

  for (const { keywords, label } of PREMIUM_OPTIONS) {
    let found = false;
    let foundEvidence = '';
    let foundSource = '';

    // Check structured equipment first (preferred for Leboncoin)
    if (content.structuredEquipment.length > 0) {
      for (const keyword of keywords) {
        for (const equipment of content.structuredEquipment) {
          if (equipment.includes(keyword.toLowerCase())) {
            found = true;
            foundEvidence = `[Equipment: ${equipment.substring(0, 60)}]`;
            foundSource = 'structured';
            break;
          }
        }
        if (found) break;
      }
    }

    // Check in description text as fallback
    if (!found) {
      for (const keyword of keywords) {
        if (descLower.includes(keyword.toLowerCase())) {
          found = true;
          foundSource = 'desc';
          // Extract sentence containing the keyword
          const sentences = content.description.split(/[.!?]+/);
          for (const sentence of sentences) {
            if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
              foundEvidence = sentence.trim().substring(0, 80);
              break;
            }
          }
          break;
        }
      }
    }

    if (found && !options.includes(label)) {
      options.push(label);
      if (foundEvidence) {
        evidence.push(`${label}: "${foundEvidence}"`);
      }
      if (source === 'none') source = foundSource;
    }
  }

  return { options, evidence: evidence.slice(0, 3), source };
}

/**
 * Extract maintenance info from seller description ONLY
 * Returns sentences containing maintenance keywords
 * FAIL-CLOSED: Requires STRONG evidence - must have strong token AND supporting evidence (date/km/dealer)
 */
function extractMaintenanceInfo(description: string): {
  entretien: string;
  evidence: string[];
  gatePass: boolean;
  hasStrongToken: boolean;
  evidenceType: string;
} {
  if (!description || description.length < 20) {
    return { entretien: '', evidence: [], gatePass: false, hasStrongToken: false, evidenceType: 'none' };
  }

  const sentences = description.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const matchedSentences: string[] = [];
  let hasStrongToken = false;
  let evidenceType = 'none';

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();

    // Quality gate: reject equipment-list-like sentences
    if (isEquipmentList(sentence)) {
      continue;
    }

    // Check for strong maintenance tokens
    let hasStrongTokenInSentence = false;
    for (const token of STRONG_MAINTENANCE_TOKENS) {
      if (sentenceLower.includes(token.toLowerCase())) {
        hasStrongTokenInSentence = true;
        hasStrongToken = true;
        break;
      }
    }

    if (hasStrongTokenInSentence) {
      // Check for supporting evidence (date, mileage, or dealer)
      const hasDate = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}[\/\-\.]\d{4}|\d{4}/.test(sentence);
      const hasMileage = /\d{1,3}[\s\.]?\d{3}[\s]?km|à\s+\d{1,3}[\s\.]?\d{3}\s?km/i.test(sentence);
      const hasDealerMention = /toyota|mercedes|bmw|audi|volkswagen|ford|renault|peugeot|citroën|garage|concession/i.test(sentence);

      if (hasDate || hasMileage || hasDealerMention) {
        matchedSentences.push(sentence);
        if (evidenceType === 'none') {
          if (hasDate) evidenceType = 'date';
          else if (hasMileage) evidenceType = 'km';
          else if (hasDealerMention) evidenceType = 'dealer';
        }
      }
    }
  }

  const gatePass = matchedSentences.length > 0;
  const entretien = gatePass ? matchedSentences.slice(0, 3).join('. ').substring(0, 500) : '';
  const evidence = matchedSentences.slice(0, 2).map(s => s.substring(0, 80));

  return { entretien: entretien || '', evidence, gatePass, hasStrongToken, evidenceType };
}

/**
 * Extract defects from seller description ONLY
 * Returns sentences containing defect keywords
 * FAIL-CLOSED: Applies quality gate to reject equipment-list-like text
 */
function extractDefects(description: string): { defects_summary: string; evidence: string[] } {
  if (!description || description.length < 20) {
    return { defects_summary: '', evidence: [] };
  }

  const sentences = description.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const matchedSentences: string[] = [];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();

    // Quality gate: reject equipment-list-like sentences
    if (isEquipmentList(sentence)) {
      continue;
    }

    for (const token of DEFECT_TOKENS) {
      if (sentenceLower.includes(token)) {
        matchedSentences.push(sentence);
        break;
      }
    }
  }

  const defects_summary = matchedSentences.slice(0, 3).join('. ').substring(0, 500);
  const evidence = matchedSentences.slice(0, 2).map(s => s.substring(0, 80));

  return { defects_summary: defects_summary || '', evidence };
}

/**
 * Extract car images from Leboncoin detail page
 */
function extractLeboncoinImages(html: string): string[] {
  const images: string[] = [];

  // Source PRIMAIRE : l'annonce déclare ses images dans __NEXT_DATA__
  // (ad.images.urls — recon 28/08 : 22 URLs rule=ad-image, chemin haché en
  // segments 7e/e6/9b/…). Les motifs regex ci-dessous, calés sur l'ancien
  // format rule=classified-*, ne matchaient plus rien : gardés en repli.
  const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) {
    try {
      const ad = JSON.parse(nextData[1])?.props?.pageProps?.ad as { images?: { urls?: unknown } } | undefined;
      const urls = ad?.images?.urls;
      if (Array.isArray(urls)) {
        for (const u of urls) {
          if (typeof u === 'string' && u.startsWith('https://') && !images.includes(u)) images.push(u);
        }
      }
    } catch { /* blob illisible — les motifs regex prennent le relais */ }
  }
  if (images.length > 0) return images.slice(0, 20);

  const patterns = [
    /https:\/\/img\d*\.leboncoin\.fr\/api\/v1\/lbcpb1\/images\/[a-f0-9/]+\.jpg\?rule=ad-image/gi,
    /https:\/\/img\d*\.leboncoin\.fr\/api\/v1\/lbcpb1\/images\/[a-f0-9-]+\.jpg\?rule=classified-[0-9x]+/gi,
    /https:\/\/img\d*\.leboncoin\.fr\/[^"'\s]+\.jpg/gi,
  ];

  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches) {
      for (const url of matches) {
        if (!images.includes(url) && !url.includes('thumb') && !url.includes('logo')) {
          images.push(url);
        }
      }
    }
  }

  return images.slice(0, 20);
}

/**
 * Extract car images from Marktplaats detail page
 */
function extractMarktplaatsImages(html: string): string[] {
  const images: string[] = [];

  const patterns = [
    /https:\/\/i\.ebayimg\.com\/[^"'\s]+/gi,
    /"largeImageUrl":"([^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const url = match[1] || match[0];
      if (url && !images.includes(url)) {
        images.push(url);
      }
    }
  }

  return images.slice(0, 20);
}

/**
 * Bilbasen : la galerie de l'annonce vit dans le JSON embarqué
 * `"media":{"images":[{"url":"https://billeder.bilbasen.dk/bilinfo/{uuid}.jpeg
 * ?class=S960X960"},…]}` — sonde 30/08 : liste ORDONNÉE, host billeder.
 * bilbasen.dk (les miroirs billeder.bilinfo.net sont des doublons). L'ancien
 * motif exigeait `.jpg` final : il tronquait les URLs `.jpeg?class=…` (1 seule
 * photo cassée au banc). On lit le bloc media.images tel quel, repli sur tout
 * URL billeder.bilbasen.dk de la page.
 */
function extractBilbasenImages(html: string): string[] {
  const norm = html.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
  const images: string[] = [];
  const push = (u: string) => { if (!images.includes(u)) images.push(u); };
  const media = norm.match(/"media"\s*:\s*\{\s*"images"\s*:\s*\[([\s\S]{0,20000}?)\]/);
  if (media) {
    for (const m of media[1].matchAll(/"url"\s*:\s*"(https:\/\/billeder\.bilbasen\.dk\/[^"]+)"/g)) push(m[1]);
  }
  if (images.length === 0) {
    for (const m of norm.matchAll(/https:\/\/billeder\.bilbasen\.dk\/bilinfo\/[0-9a-f-]{36}\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)) push(m[0]);
  }
  return images.slice(0, 20);
}

/**
 * mobile.de : galerie balisée `data-testid="image-{n}"`, chaque diapo porte
 * un srcSet `img.classistatic.de/api/v1/mo-prod/images/{aa}/{uuid}?rule=mo-…`
 * en 8 variantes (mo-80 → mo-1600) — sonde 30/08 : 18 diapos, le logo
 * concession et les visuels statiques vivent HORS de ces balises. On garde
 * une entrée par diapo, variante la plus grande (mo-1600), ordre des indices.
 */
function extractMobiledeImages(html: string): string[] {
  const seen = new Map<string, number>();
  for (const m of html.matchAll(/data-testid="image-(\d+)"[\s\S]{0,800}?img\.classistatic\.de\/api\/v1\/mo-prod\/images\/([0-9a-f]{2}\/[0-9a-f-]{36})\?rule=mo-/g)) {
    const idx = parseInt(m[1], 10);
    if (!seen.has(m[2]) || idx < (seen.get(m[2]) ?? Infinity)) seen.set(m[2], idx);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1])
    .map(([id]) => `https://img.classistatic.de/api/v1/mo-prod/images/${id}?rule=mo-1600`)
    .slice(0, 20);
}

/**
 * Blocket : les photos de l'annonce sont
 * `images.blocketcdn.se/dynamic/default/item/{idAnnonce}/{uuid}` — sonde
 * 30/08 : 37 distinctes, TOUTES portent l'id de l'annonce (les reco du bas
 * de page ne sont pas rendues serveur) ; le JSON-LD n'en liste que 3 (le
 * repli générique plafonnait là). Id relu de l'URL détail /item/{id} quand
 * il est présent, ordre d'apparition (= ordre du tableau "images").
 */
function extractBlocketImages(html: string, listingUrl: string): string[] {
  const itemId = listingUrl.match(/\/item\/(\d+)/)?.[1];
  const images: string[] = [];
  for (const m of html.matchAll(/https:\/\/images\.blocketcdn\.se\/dynamic\/default\/item\/(\d+)\/[0-9a-f-]{36}/g)) {
    if (itemId && m[1] !== itemId) continue;
    if (!images.includes(m[0])) images.push(m[0]);
  }
  return images.slice(0, 20);
}

/**
 * Extract car images from Gaspedaal detail page
 */
function extractGaspedaalImages(html: string): string[] {
  const images: string[] = [];

  const pattern = /https:\/\/[^"'\s]*gaspedaal[^"'\s]*\.(?:jpg|jpeg|png)/gi;
  const matches = html.match(pattern);

  if (matches) {
    for (const url of matches) {
      if (!images.includes(url)) {
        images.push(url);
      }
    }
  }

  return images.slice(0, 20);
}

/**
 * Extract car images based on marketplace
 */
/**
 * Repli GÉNÉRIQUE (constat Yaris Cross 28/08 : seuls 4 sites avaient un
 * extracteur — AutoScout, mobile.de, Blocket, Subito… rendaient 0 photo) :
 * les images que la page DÉCLARE elle-même dans ses blocs JSON-LD
 * (schema.org Vehicle/Product/Offer) — même doctrine que les enums moissonnés,
 * la donnée vient du site, jamais devinée. og:image en dernier secours
 * (souvent la seule photo de couverture).
 */
function extractGenericImages(html: string): string[] {
  const images: string[] = [];
  const push = (u: unknown) => {
    if (typeof u !== 'string') return;
    const url = u.trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (/\.svg|logo|favicon|sprite|icon|placeholder/i.test(url)) return;
    if (!images.includes(url)) images.push(url);
  };
  const ldBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of ldBlocks) {
    if (images.length >= 20) break;
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const walk = (node: unknown): void => {
        if (!node || images.length >= 20) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        const img = o['image'];
        if (typeof img === 'string') push(img);
        else if (Array.isArray(img)) {
          for (const it of img) push(it && typeof it === 'object' ? (it as { url?: unknown; contentUrl?: unknown }).url ?? (it as { contentUrl?: unknown }).contentUrl : it);
        } else if (img && typeof img === 'object') {
          push((img as { url?: unknown; contentUrl?: unknown }).url ?? (img as { contentUrl?: unknown }).contentUrl);
        }
        for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'offers', 'itemOffered']) {
          if (o[k]) walk(o[k]);
        }
      };
      walk(JSON.parse(body));
    } catch { /* bloc illisible — repli suivant */ }
  }
  if (images.length === 0) {
    for (const m of html.matchAll(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/gi)) push(m[1]);
    for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::url)?["']/gi)) push(m[1]);
  }
  return images.slice(0, 20);
}

/**
 * AutoScout24 : chaque photo vit en N variantes de taille
 * `listing-images/{idAnnonce}_{idImage}.jpg/{LxH}.{jpg|webp}` (sonde 28/08,
 * 64 URLs sur une page de détail). Une entrée par image (groupée par idImage),
 * la PLUS GRANDE variante .jpg, dans l'ordre d'apparition.
 */
function extractAutoscoutImages(html: string): string[] {
  // Le rendu navigateur ne charge en GRAND que les premières diapos du
  // carrousel (extraction « aléatoire » constatée 28/08 : 1 puis 3 photos
  // sur la même annonce) — mais la BANDE DE VIGNETTES 120x90 porte TOUTES
  // les images. Le CDN est un redimensionneur par chemin : on reconstruit
  // la variante 1920x1080 depuis chaque id vu, quelle que soit la taille
  // rencontrée. Fail-open : une taille absente fait sauter la photo au
  // téléchargement, jamais l'extraction.
  const seen = new Map<string, number>();
  let order = 0;
  for (const m of html.matchAll(/https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\/([a-f0-9-]+_[a-f0-9-]+)\.jpg\/\d+x\d+\.(?:jpg|webp)/gi)) {
    if (!seen.has(m[1])) seen.set(m[1], order++);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1])
    .map(([id]) => `https://prod.pictures.autoscout24.net/listing-images/${id}.jpg/1920x1080.jpg`)
    .slice(0, 20);
}

function extractLacentraleImages(html: string, listingUrl: string): string[] {
  // La page détail porte TOUTES les photos de l'annonce dans un tableau
  // "pictures":[{…,"src1_5x":"https://pictures.lacentrale.fr/classifieds/
  // W103542718_STANDARD_0.jpg?…signature=…"}] — sonde 30/08 : 14/14 indices
  // présents, la plus grande variante servie (1096x829) est src1_5x. Les
  // annonces SIMILAIRES du bas de page ont leurs propres images (max 3) :
  // on ne garde que la référence de l'annonce COURANTE, reconnue par les
  // chiffres de l'URL détail (id = préfixe 2 chiffres + chiffres de la
  // référence — loi prouvée sur 22 paires). Les URLs signées sont copiées
  // TELLES QUELLES (la signature fait partie de l'accès).
  const digits = listingUrl.match(/auto-occasion-annonce-\d{2}(\d{6,})\.html/)?.[1];
  const seen = new Map<string, number>();
  let order = 0;
  for (const m of html.matchAll(/"src1_5x"\s*:\s*"(https:[^"]*?classifieds(?:\/|\\u002F)([A-Z])(\d+)_[A-Z]+_\d+\.jpg[^"]*)"/g)) {
    if (digits && m[3] !== digits) continue;
    const url = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    if (!seen.has(url)) seen.set(url, order++);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([u]) => u).slice(0, 20);
}

/**
 * Skelbiu (plateforme Autoplius) : photos
 * `autoplius-img.dgn.lt/ann_{variante}_{idImage}/{slug}-{idx}.jpg` — sonde
 * 30/08 : la page détail ne rend AUCUNE annonce similaire côté serveur
 * (1 seul slug, 50 indices 0..49) ; la grande variante est ann_3 (source
 * du zoom min-width 401px ; og:image sert ann_6, vignettes ann_2/4/25).
 * Une entrée par indice, ordre croissant, ann_3 préférée puis 1re vue.
 */
function extractSkelbiuImages(html: string): string[] {
  const byIdx = new Map<number, { url: string; big: boolean }>();
  for (const m of html.matchAll(/https:\/\/autoplius-img\.dgn\.lt\/ann_(\d+)_\d+\/[a-z0-9-]+?-(\d+)\.jpg/gi)) {
    const idx = parseInt(m[2], 10);
    const big = m[1] === '3';
    const cur = byIdx.get(idx);
    if (!cur || (big && !cur.big)) byIdx.set(idx, { url: m[0], big });
  }
  return [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.url).slice(0, 20);
}

/**
 * Jófogás : galerie `img.jofogas.hu/620x620aspect/{slugTitre}_{id}.jpg` —
 * sonde 30/08 : le slug d'image reprend le slug de l'URL détail
 * (/{region}/{Slug}_{idAnnonce}.htm) ; les annonces similaires portent
 * d'autres slugs (et le chemin /images/). Filtre par slug quand l'URL le
 * donne, variante 620x620aspect (la grande servie), ordre d'apparition.
 */
function extractJofogasImages(html: string, listingUrl: string): string[] {
  const slug = listingUrl.match(/\/([A-Za-z0-9_]+?)_\d+\.htm/)?.[1];
  const images: string[] = [];
  for (const m of html.matchAll(/https:\/\/img\.jofogas\.hu\/620x620aspect\/([A-Za-z0-9_]+?)_\d+\.jpg/g)) {
    if (slug && !m[1].startsWith(slug)) continue;
    if (!images.includes(m[0])) images.push(m[0]);
  }
  return images.slice(0, 20);
}

function extractCarImages(html: string, listingUrl: string): string[] {
  let siteImages: string[] = [];
  if (listingUrl.includes('autoscout24.')) {
    siteImages = extractAutoscoutImages(html);
  } else if (listingUrl.includes('lacentrale.fr')) {
    siteImages = extractLacentraleImages(html, listingUrl);
  } else if (listingUrl.includes('leboncoin.fr')) {
    siteImages = extractLeboncoinImages(html);
  } else if (listingUrl.includes('marktplaats.nl')) {
    siteImages = extractMarktplaatsImages(html);
  } else if (listingUrl.includes('bilbasen.dk')) {
    siteImages = extractBilbasenImages(html);
  } else if (listingUrl.includes('gaspedaal.nl')) {
    siteImages = extractGaspedaalImages(html);
  } else if (listingUrl.includes('mobile.de')) {
    siteImages = extractMobiledeImages(html);
  } else if (listingUrl.includes('blocket.se')) {
    siteImages = extractBlocketImages(html, listingUrl);
  } else if (listingUrl.includes('skelbiu.lt')) {
    siteImages = extractSkelbiuImages(html);
  } else if (listingUrl.includes('jofogas.hu')) {
    siteImages = extractJofogasImages(html, listingUrl);
  }
  // Extracteur de site muet (ou site sans extracteur) → le repli générique
  // couvre TOUTE la classe d'un coup.
  return siteImages.length > 0 ? siteImages : extractGenericImages(html);
}

/**
 * Parse detail page HTML to extract enriched listing data
 * FAIL-CLOSED: Only extracts from verified seller content
 *
 * @param html - Detail page HTML
 * @param listingUrl - Listing URL (for marketplace detection)
 * @returns Enriched detail data with evidence
 */
export function parseDetailPage(html: string, listingUrl: string): DetailPageData {
  const isLeboncoin = listingUrl.includes('leboncoin.fr');
  const sellerContent = extractSellerContent(html, listingUrl);
  // Les PHOTOS ne dépendent PAS du texte vendeur : extraites AVANT le
  // court-circuit fail-closed (constat Yaris Cross 28/08 : description
  // illisible → 0 photo alors que la page en portait 14).
  const car_image_urls = extractCarImages(html, listingUrl);

  if (!sellerContent.description && sellerContent.structuredEquipment.length === 0) {
    return {
      options: [],
      entretien: '',
      defects_summary: '',
      maintenance_summary: '',
      car_image_urls,
    };
  }

  const optionsResult = extractPremiumOptions(sellerContent, isLeboncoin);
  const maintenanceResult = extractMaintenanceInfo(sellerContent.description);
  const defectsResult = extractDefects(sellerContent.description);

  // Store evidence in entretien/defects_summary (append at end with delimiter)
  let entretien = maintenanceResult.entretien;
  if (maintenanceResult.evidence.length > 0) {
    entretien = entretien ? `${entretien} [Evidence: ${maintenanceResult.evidence[0]}...]` : '';
  }

  let defects_summary = defectsResult.defects_summary;
  if (defectsResult.evidence.length > 0) {
    defects_summary = defects_summary ? `${defects_summary} [Evidence: ${defectsResult.evidence[0]}...]` : '';
  }

  // Log extraction metrics for Leboncoin
  if (isLeboncoin) {
    const gateStatus = maintenanceResult.gatePass ? 'pass' : 'fail';
    const strongToken = maintenanceResult.hasStrongToken ? 'yes' : 'no';
    const evidence = maintenanceResult.evidenceType || 'none';
    const optionsFrom = optionsResult.source || 'none';
    const optionsCount = optionsResult.options.length;

    console.log(
      `[DETAIL_SCRAPE] lb_entretien_gate=${gateStatus} strong_token=${strongToken} ` +
      `evidence=${evidence} options_from=${optionsFrom} options_count=${optionsCount}`
    );
  }

  return {
    options: optionsResult.options,
    entretien: entretien || '',
    defects_summary: defects_summary || '',
    maintenance_summary: maintenanceResult.entretien ? 'Entretien mentionné' : '',
    car_image_urls,
    year: sellerContent.year,
    mileage: sellerContent.mileage,
  };
}
