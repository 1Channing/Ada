/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DETAIL PAGE PARSERS - PURE FUNCTIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extract enriched data from individual listing detail pages:
 * - Premium options (non-standard features)
 * - Maintenance notes (entretien)
 * - Defects/condition notes
 * - Car images
 */

export interface DetailPageData {
  options: string[];
  entretien: string;
  defects_summary: string;
  maintenance_summary: string;
  car_image_urls: string[];
}

const PREMIUM_OPTIONS_KEYWORDS = [
  // Roof/Glass
  { pattern: /(?:toit|sunroof|panoram)/i, label: 'Toit panoramique' },

  // Audio
  { pattern: /(?:jbl|harman|bose|b&o|burmester|premium\s+audio|système\s+audio)/i, label: 'Audio premium' },

  // Convenience
  { pattern: /(?:hayon|coffre|tailgate).*(?:électrique|electric|hands-free|automatique)/i, label: 'Hayon électrique' },
  { pattern: /(?:sièges?).*(?:mémoire|memory)/i, label: 'Sièges à mémoire' },

  // Lighting
  { pattern: /(?:laser|matrix|led).*(?:headlight|phare|feux)/i, label: 'Phares LED/Matrix' },
  { pattern: /(?:phares?).*(?:laser|matrix|led)/i, label: 'Phares LED/Matrix' },

  // Driver Assist
  { pattern: /(?:hud|head-up|affichage\s+tête\s+haute)/i, label: 'Affichage tête haute' },
  { pattern: /(?:caméra|camera)\s+360/i, label: 'Caméra 360°' },
  { pattern: /(?:park\s+assist|aide\s+au\s+stationnement|parking\s+automatique)/i, label: 'Aide au stationnement' },
  { pattern: /(?:acc|adaptive\s+cruise|régulateur.*adaptatif)/i, label: 'Régulateur adaptatif' },
  { pattern: /(?:blind\s+spot|angle\s+mort|blis)/i, label: 'Détection angle mort' },

  // Seating
  { pattern: /(?:sièges?).*(?:chauffants|heated|ventil)/i, label: 'Sièges chauffants/ventilés' },
  { pattern: /(?:heated|ventilated|chauffants|ventilés).*(?:seats|sièges)/i, label: 'Sièges chauffants/ventilés' },

  // Towing/Suspension
  { pattern: /(?:attelage|towbar|trekhaak|anhänger)/i, label: 'Attelage' },
  { pattern: /(?:adaptive|air|pneumatique).*(?:suspension|amortisseurs)/i, label: 'Suspension adaptative' },
];

const MAINTENANCE_KEYWORDS = [
  { pattern: /(?:révision|entretien|service).*(?:\d{4}|récent|complet|à\s+jour)/i, type: 'maintenance' },
  { pattern: /(?:carnet|historique|dossier).*(?:entretien|service|révision)/i, type: 'maintenance' },
  { pattern: /(?:distribution|courroie|timing\s+belt).*(?:changée?|remplacée?|neuve?|ok)/i, type: 'maintenance' },
  { pattern: /(?:pneus?|tyres?).*(?:neufs?|récents?|changés?|\d{4})/i, type: 'maintenance' },
  { pattern: /(?:ct|controle\s+technique).*(?:ok|valid|passé)/i, type: 'maintenance' },
];

const DEFECT_KEYWORDS = [
  { pattern: /(?:rayure|scratch|égratignure)/i, type: 'defect' },
  { pattern: /(?:choc|impact|coup|dent)/i, type: 'defect' },
  { pattern: /(?:usure|worn|abîmé|endommagé)/i, type: 'defect' },
  { pattern: /(?:rouille|rust|corrosion)/i, type: 'defect' },
  { pattern: /(?:fissure|crack|brisé)/i, type: 'defect' },
  { pattern: /(?:problème|problem|défaut|issue|fault)/i, type: 'defect' },
  { pattern: /(?:accident|accidenté|sinistre)/i, type: 'defect' },
];

/**
 * Extract text content from HTML
 */
function extractTextContent(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract premium options from listing detail page
 */
function extractPremiumOptions(text: string): string[] {
  const options: string[] = [];
  const lowerText = text.toLowerCase();

  for (const { pattern, label } of PREMIUM_OPTIONS_KEYWORDS) {
    if (pattern.test(text)) {
      if (!options.includes(label)) {
        options.push(label);
      }
    }
  }

  return options;
}

/**
 * Extract maintenance info with seller context
 */
function extractMaintenanceInfo(text: string): { entretien: string; maintenance_summary: string } {
  const sentences: string[] = [];

  // Split into sentences
  const parts = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

  for (const sentence of parts) {
    for (const { pattern } of MAINTENANCE_KEYWORDS) {
      if (pattern.test(sentence)) {
        sentences.push(sentence);
        break;
      }
    }
  }

  const entretien = sentences.slice(0, 3).join('. ').substring(0, 500);
  const maintenance_summary = entretien ? 'Entretien mentionné' : '';

  return { entretien, maintenance_summary };
}

/**
 * Extract defects/condition notes
 */
function extractDefects(text: string): string {
  const sentences: string[] = [];

  // Split into sentences
  const parts = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

  for (const sentence of parts) {
    for (const { pattern } of DEFECT_KEYWORDS) {
      if (pattern.test(sentence)) {
        sentences.push(sentence);
        break;
      }
    }
  }

  return sentences.slice(0, 3).join('. ').substring(0, 500);
}

/**
 * Extract car images from Leboncoin detail page
 */
function extractLeboncoinImages(html: string): string[] {
  const images: string[] = [];

  // Look for image URLs in various formats
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
 *
 * @param html - Detail page HTML
 * @param listingUrl - Listing URL (for marketplace detection)
 * @returns Enriched detail data
 */
export function parseDetailPage(html: string, listingUrl: string): DetailPageData {
  const textContent = extractTextContent(html);

  const options = extractPremiumOptions(textContent);
  const { entretien, maintenance_summary } = extractMaintenanceInfo(textContent);
  const defects_summary = extractDefects(textContent);
  const car_image_urls = extractCarImages(html, listingUrl);

  return {
    options,
    entretien,
    defects_summary,
    maintenance_summary,
    car_image_urls,
  };
}
