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
}

interface SellerContent {
  description: string;
  structuredEquipment: string[];
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

const MAINTENANCE_TOKENS = [
  'révision', 'entretien', 'service', 'vidange', 'carnet', 'historique',
  'factures', 'toyota', 'mercedes', 'bmw', 'audi', 'concessionnaire',
  'distribution', 'courroie', 'timing belt', 'pneus neufs', 'ct', 'contrôle technique',
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
 * Extract seller's description text from Leboncoin HTML
 * FAIL-CLOSED: Only extracts from __NEXT_DATA__ ad body
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

    // Extract seller's description (body text)
    const description = adData.body || adData.description || adData.text || '';

    // Extract structured equipment if available
    const structuredEquipment: string[] = [];
    if (adData.options && Array.isArray(adData.options)) {
      structuredEquipment.push(...adData.options.map((o: any) => String(o.label || o.name || o).toLowerCase()));
    }
    if (adData.attributes && Array.isArray(adData.attributes)) {
      for (const attr of adData.attributes) {
        if (attr.key === 'options' || attr.key === 'equipment') {
          if (Array.isArray(attr.values)) {
            structuredEquipment.push(...attr.values.map((v: any) => String(v).toLowerCase()));
          } else if (attr.value) {
            structuredEquipment.push(String(attr.value).toLowerCase());
          }
        }
      }
    }

    return { description, structuredEquipment };
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
 * STRICT: Only returns options found in whitelist, with evidence
 */
function extractPremiumOptions(content: SellerContent): { options: string[]; evidence: string[] } {
  const options: string[] = [];
  const evidence: string[] = [];
  const descLower = content.description.toLowerCase();
  const allEquipment = [...content.structuredEquipment];

  for (const { keywords, label } of PREMIUM_OPTIONS) {
    let found = false;
    let foundEvidence = '';

    // Check in description text
    for (const keyword of keywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        found = true;
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

    // Check in structured equipment
    if (!found) {
      for (const keyword of keywords) {
        for (const equipment of allEquipment) {
          if (equipment.includes(keyword.toLowerCase())) {
            found = true;
            foundEvidence = `[Equipment: ${equipment.substring(0, 60)}]`;
            break;
          }
        }
        if (found) break;
      }
    }

    if (found && !options.includes(label)) {
      options.push(label);
      if (foundEvidence) {
        evidence.push(`${label}: "${foundEvidence}"`);
      }
    }
  }

  return { options, evidence: evidence.slice(0, 3) };
}

/**
 * Extract maintenance info from seller description ONLY
 * Returns sentences containing maintenance keywords
 */
function extractMaintenanceInfo(description: string): { entretien: string; evidence: string[] } {
  if (!description || description.length < 20) {
    return { entretien: '', evidence: [] };
  }

  const sentences = description.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const matchedSentences: string[] = [];
  const descLower = description.toLowerCase();

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    for (const token of MAINTENANCE_TOKENS) {
      if (sentenceLower.includes(token)) {
        matchedSentences.push(sentence);
        break;
      }
    }
  }

  const entretien = matchedSentences.slice(0, 3).join('. ').substring(0, 500);
  const evidence = matchedSentences.slice(0, 2).map(s => s.substring(0, 80));

  return { entretien: entretien || '', evidence };
}

/**
 * Extract defects from seller description ONLY
 * Returns sentences containing defect keywords
 */
function extractDefects(description: string): { defects_summary: string; evidence: string[] } {
  if (!description || description.length < 20) {
    return { defects_summary: '', evidence: [] };
  }

  const sentences = description.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const matchedSentences: string[] = [];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
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

  const patterns = [
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

  return images.slice(0, 8);
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

  return images.slice(0, 8);
}

/**
 * Extract car images from Bilbasen detail page
 */
function extractBilbasenImages(html: string): string[] {
  const images: string[] = [];

  const pattern = /https:\/\/[^"'\s]*bilbasen[^"'\s]*\.jpg/gi;
  const matches = html.match(pattern);

  if (matches) {
    for (const url of matches) {
      if (!images.includes(url) && !url.includes('logo') && !url.includes('icon')) {
        images.push(url);
      }
    }
  }

  return images.slice(0, 8);
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

  return images.slice(0, 8);
}

/**
 * Extract car images based on marketplace
 */
function extractCarImages(html: string, listingUrl: string): string[] {
  if (listingUrl.includes('leboncoin.fr')) {
    return extractLeboncoinImages(html);
  } else if (listingUrl.includes('marktplaats.nl')) {
    return extractMarktplaatsImages(html);
  } else if (listingUrl.includes('bilbasen.dk')) {
    return extractBilbasenImages(html);
  } else if (listingUrl.includes('gaspedaal.nl')) {
    return extractGaspedaalImages(html);
  }

  return [];
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
  const sellerContent = extractSellerContent(html, listingUrl);

  if (!sellerContent.description && sellerContent.structuredEquipment.length === 0) {
    return {
      options: [],
      entretien: '',
      defects_summary: '',
      maintenance_summary: '',
      car_image_urls: [],
    };
  }

  const optionsResult = extractPremiumOptions(sellerContent);
  const maintenanceResult = extractMaintenanceInfo(sellerContent.description);
  const defectsResult = extractDefects(sellerContent.description);
  const car_image_urls = extractCarImages(html, listingUrl);

  // Store evidence in entretien/defects_summary (append at end with delimiter)
  let entretien = maintenanceResult.entretien;
  if (maintenanceResult.evidence.length > 0) {
    entretien = entretien ? `${entretien} [Evidence: ${maintenanceResult.evidence[0]}...]` : '';
  }

  let defects_summary = defectsResult.defects_summary;
  if (defectsResult.evidence.length > 0) {
    defects_summary = defects_summary ? `${defects_summary} [Evidence: ${defectsResult.evidence[0]}...]` : '';
  }

  return {
    options: optionsResult.options,
    entretien: entretien || '',
    defects_summary: defects_summary || '',
    maintenance_summary: maintenanceResult.entretien ? 'Entretien mentionné' : '',
    car_image_urls,
  };
}
