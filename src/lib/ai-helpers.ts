export type DestinationListing = {
  price: number;
  year?: number;
  km?: number;
  title?: string;
  description?: string;
};

export type TargetPriceResult = {
  targetExportPriceEur: number;
  aiComment: string;
};

export type ListingAnalysisResult = {
  isRunning: boolean;
  isAccidentSuspected: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  riskFlags: string;
  aiComment: string;
  aiDetailComment: string;
  scoreAdjustment: number;
};

export async function computeTargetExportPriceWithAI(
  destinationListings: DestinationListing[],
  modelPattern: string,
  targetCountry: string,
  pricingStrategy: string,
  computedPrice: number
): Promise<TargetPriceResult> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    return {
      targetExportPriceEur: computedPrice,
      aiComment: 'No AI validation (API key missing)',
    };
  }

  try {
    const listingsSummary = destinationListings
      .slice(0, 10)
      .map((l, i) => `${i + 1}. €${l.price} - ${l.year || '?'} - ${l.km || '?'}km - ${l.title || 'N/A'}`)
      .join('\n');

    const prompt = `You are analyzing car export pricing data.

Model: ${modelPattern}
Target Country: ${targetCountry}
Pricing Strategy: ${pricingStrategy}
Computed Target Price: €${computedPrice}

Destination Market Sample (${destinationListings.length} listings):
${listingsSummary}

Task: Validate if the computed target price of €${computedPrice} is reasonable for export purposes. Consider:
1. Market positioning
2. Price distribution
3. Any outliers
4. Export viability

Respond in JSON format:
{
  "targetExportPriceEur": <validated_price>,
  "aiComment": "<brief 1-sentence comment on pricing>"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a car export pricing analyst. Respond only with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    const parsed = JSON.parse(content);

    return {
      targetExportPriceEur: parsed.targetExportPriceEur || computedPrice,
      aiComment: parsed.aiComment || 'AI validation completed',
    };
  } catch (error) {
    console.error('AI target price computation failed:', error);
    return {
      targetExportPriceEur: computedPrice,
      aiComment: `Fallback: ${(error as Error).message}`,
    };
  }
}

export async function analyzeListingDetails(
  listingData: {
    price: number;
    year?: number;
    km?: number;
    brand: string;
    model: string;
    description?: string;
    sellerType?: string;
    options?: string[];
  },
  targetExportPriceEur: number
): Promise<ListingAnalysisResult> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    return {
      isRunning: true,
      isAccidentSuspected: false,
      riskLevel: 'medium',
      riskFlags: 'No AI analysis (API key missing)',
      aiComment: 'Manual review required',
      aiDetailComment: 'AI analysis unavailable - manual verification needed',
      scoreAdjustment: 0,
    };
  }

  try {
    const margin = targetExportPriceEur - listingData.price - 500;

    const prompt = `You are analyzing a car listing for export potential.

LISTING DETAILS:
- Brand/Model: ${listingData.brand} ${listingData.model}
- Year: ${listingData.year || 'Unknown'}
- Mileage: ${listingData.km || 'Unknown'} km
- Price: €${listingData.price}
- Target Export Price: €${targetExportPriceEur}
- Estimated Margin: €${margin}
- Seller Type: ${listingData.sellerType || 'Unknown'}

DESCRIPTION:
${listingData.description || 'No description available'}

OPTIONS/FEATURES:
${listingData.options?.join(', ') || 'Not specified'}

ANALYSIS REQUIRED:
1. Is the car clearly running/operational? (check for keywords like "non roulante", "for parts", "pièces", "ne roule pas", "HS")
2. Is there suspicion of accident damage? (check for "accidenté", "crash", "collision", "damaged")
3. What is the risk level? (low/medium/high)
4. List any red flags or concerns
5. Is this listing attractive for export?
6. Score adjustment (-3 to +3 points)

Respond in JSON format:
{
  "isRunning": <true/false>,
  "isAccidentSuspected": <true/false>,
  "riskLevel": "<low|medium|high>",
  "riskFlags": "<comma-separated list of concerns or 'None'>",
  "aiComment": "<1 sentence summary>",
  "aiDetailComment": "<2-3 sentences detailed analysis>",
  "scoreAdjustment": <-3 to +3>
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a car export risk analyst. Respond only with valid JSON. Be conservative in your analysis.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    const parsed = JSON.parse(content);

    return {
      isRunning: parsed.isRunning ?? true,
      isAccidentSuspected: parsed.isAccidentSuspected ?? false,
      riskLevel: parsed.riskLevel || 'medium',
      riskFlags: parsed.riskFlags || 'None',
      aiComment: parsed.aiComment || 'Analysis completed',
      aiDetailComment: parsed.aiDetailComment || 'Detailed analysis completed',
      scoreAdjustment: Math.max(-3, Math.min(3, parsed.scoreAdjustment || 0)),
    };
  } catch (error) {
    console.error('AI listing analysis failed:', error);
    return {
      isRunning: true,
      isAccidentSuspected: false,
      riskLevel: 'medium',
      riskFlags: `Analysis error: ${(error as Error).message}`,
      aiComment: 'Manual review required',
      aiDetailComment: `AI analysis failed: ${(error as Error).message}`,
      scoreAdjustment: 0,
    };
  }
}
