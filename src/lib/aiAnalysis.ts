/**
 * AI Analysis Module
 *
 * Real implementation using OpenAI to analyze scraped listing descriptions.
 */

import type { DetailedListing } from './scraperClient';

const OPENAI_API_KEY =
  (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) ||
  (import.meta.env.OPENAI_API_KEY as string | undefined);

let openaiKeyWarningShown = false;

export interface AnalyzedListing {
  is_damaged: boolean;
  defects_summary: string;
  maintenance_summary: string;
  options_summary: string;
  entretien: string;
  options: string[];
}

interface OpenAIAnalysisResult {
  is_damaged_or_non_running: boolean;
  damage_reason: string;
  matches_study_criteria: boolean;
  matches_study_reason: string;
  trim: string | null;
  defects: string[];
  entretien: string;
  options: string[];
}

/**
 * Builds the prompt for OpenAI analysis with structured context.
 */
function buildPromptFromListing(
  listing: DetailedListing,
  studyContext?: {
    brand: string;
    model: string;
    yearMin: number;
    yearMax?: number;
    mileageMax: number;
    targetMedianPrice: number;
    targetCountry: string;
  }
): string {
  const studySection = studyContext ? `
STUDY CONSTRAINTS:
- Brand: ${studyContext.brand}
- Model: ${studyContext.model}
- Year: ${studyContext.yearMin}${studyContext.yearMax ? ` - ${studyContext.yearMax}` : '+'}
- Max Mileage: ${studyContext.mileageMax} km
- Target Median Price: ${studyContext.targetMedianPrice}€
- Target Country: ${studyContext.targetCountry}
` : '';

  return `Analyze this used car listing for a car sourcing/export business.
${studySection}
LISTING RAW DATA:
- Title: ${listing.title}
- Price: ${listing.price}€
- Year: ${listing.year || 'Unknown'}
- Mileage: ${listing.mileage || 'Unknown'} km
- Trim: ${listing.trim || 'Unknown'}
- Currency: ${listing.currency}
- URL: ${listing.listing_url}

FULL DESCRIPTION:
${listing.full_description || listing.description || 'No description available'}

${listing.technical_info ? `TECHNICAL/EQUIPMENT INFO:\n${listing.technical_info}\n` : ''}

TASK:
You must analyze this listing and return ONLY a valid JSON object (no markdown, no extra text) with this exact structure:

{
  "is_damaged_or_non_running": boolean,
  "damage_reason": "explanation of any damage or why not damaged",
  "matches_study_criteria": boolean,
  "matches_study_reason": "brief explanation",
  "trim": "extracted trim level or null",
  "defects": ["array", "of", "specific", "defects"],
  "entretien": "French summary of maintenance history",
  "options": ["array", "of", "high-value", "options", "only"]
}

RULES:
1. is_damaged_or_non_running: Set to true ONLY if there is serious accident damage, major mechanical failure, "for parts", "non-running", "salvage", etc. Be conservative - minor cosmetic issues are NOT damage.
2. defects: List specific problems mentioned (scratches, worn tires, minor issues). Empty array if none.
3. entretien: Write a short French summary (1-2 sentences) of maintenance history. Include ONLY: last service/revision (date, mileage), contrôle technique status, major works (engine, gearbox, battery, timing belt). If nothing mentioned, return empty string "". Never use "unknown" or null as a string.
4. options: List ONLY expensive/high-value equipment in French. Include ONLY if explicitly mentioned: toit ouvrant/panoramique, système audio premium (JBL, Bose, B&O, Harman Kardon, Burmester, Meridian), sièges cuir, sièges électriques, sièges chauffants/ventilés, volant chauffant, régulateur adaptatif/ACC, attelage, caméra 360°, détecteurs d'angles morts, head-up display, keyless entry/go, phares LED/Matrix/adaptatifs, câbles de recharge fournis, charge rapide DC. Ignore basic features like air conditioning, standard audio, basic cruise control, etc. Empty array if none.
5. Leasing/LOA mentions are NOT relevant (filtered elsewhere).
6. Be factual and concise.
7. CRITICAL: Return ONLY strict JSON. No markdown. No code blocks.

Return ONLY the JSON object, nothing else.`;
}

/**
 * Calls OpenAI API to analyze a listing.
 */
async function callOpenAI(prompt: string): Promise<OpenAIAnalysisResult | null> {
  if (!OPENAI_API_KEY) {
    if (!openaiKeyWarningShown) {
      console.error(
        '[AI] Missing OpenAI API key. Please set VITE_OPENAI_API_KEY (and optionally OPENAI_API_KEY) in your .env file.'
      );
      openaiKeyWarningShown = true;
    }
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an assistant that analyzes used car listings for a car sourcing/export business. You MUST respond with ONLY valid JSON, no extra text or markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      console.error(`[AI] OpenAI API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[AI] Invalid OpenAI response structure');
      return null;
    }

    let content = data.choices[0].message.content.trim();

    if (content.startsWith('```json')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (content.startsWith('```')) {
      content = content.replace(/```\n?/g, '').trim();
    }

    let parsed: OpenAIAnalysisResult;
    try {
      parsed = JSON.parse(content) as OpenAIAnalysisResult;
    } catch (parseError) {
      console.error('[AI] Failed to parse JSON response:', parseError);
      console.error('[AI] Raw content:', content.substring(0, 500));
      return null;
    }

    if (!parsed.entretien || typeof parsed.entretien !== 'string') {
      parsed.entretien = '';
    }

    if (!Array.isArray(parsed.options)) {
      parsed.options = [];
    }

    console.log(`[AI] Successfully analyzed listing, damaged: ${parsed.is_damaged_or_non_running}`);

    return parsed;
  } catch (error) {
    console.error('[AI] Error calling OpenAI:', error);
    return null;
  }
}

/**
 * Creates a safe fallback analysis result.
 */
function createFallbackAnalysis(listing: DetailedListing): AnalyzedListing {
  const text = `${listing.title} ${listing.full_description}`.toLowerCase();

  const damageKeywords = [
    'accidenté', 'épave', 'for parts', 'pour pièces',
    'non roulant', 'hs', 'hors service', 'damaged', 'salvage',
    'dépanneuse', 'panne', 'moteur hs', 'not running',
  ];

  const is_damaged = damageKeywords.some(keyword => text.includes(keyword));

  return {
    is_damaged,
    defects_summary: 'AI analysis unavailable - manual review required',
    maintenance_summary: 'AI analysis unavailable - manual review required',
    options_summary: listing.options.length > 0 ? listing.options.join(', ') : 'None detected',
    entretien: '',
    options: [],
  };
}

/**
 * Analyzes a listing description using OpenAI.
 */
export async function analyzeListingDescription(
  listing: DetailedListing
): Promise<AnalyzedListing> {
  console.log(`[AI] Analyzing listing: ${listing.title.substring(0, 50)}...`);

  const prompt = buildPromptFromListing(listing);
  const result = await callOpenAI(prompt);

  if (!result) {
    console.warn('[AI] OpenAI call failed, using fallback analysis');
    return createFallbackAnalysis(listing);
  }

  const maintenanceSummary = 'Legacy field - see entretien';

  return {
    is_damaged: result.is_damaged_or_non_running,
    defects_summary: result.defects.length > 0
      ? result.defects.join('; ')
      : 'None mentioned',
    maintenance_summary: maintenanceSummary,
    options_summary: result.options.length > 0
      ? result.options.join(', ')
      : 'None mentioned',
    entretien: result.entretien || '',
    options: result.options || [],
  };
}

/**
 * Batch analyze multiple listings with rate limiting.
 */
export async function analyzeListingsBatch(
  listings: DetailedListing[]
): Promise<AnalyzedListing[]> {
  console.log(`[AI] Analyzing ${listings.length} listings in batch`);

  const concurrency = 2;
  const results: AnalyzedListing[] = [];

  for (let i = 0; i < listings.length; i += concurrency) {
    const batch = listings.slice(i, i + concurrency);

    console.log(`[AI] Processing batch ${Math.floor(i / concurrency) + 1} of ${Math.ceil(listings.length / concurrency)}`);

    const batchResults = await Promise.all(
      batch.map(listing => analyzeListingDescription(listing))
    );

    results.push(...batchResults);

    if (i + concurrency < listings.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const damagedCount = results.filter(r => r.is_damaged).length;
  console.log(`[AI] Batch analysis complete: ${damagedCount}/${results.length} listings marked as damaged`);

  return results;
}
