import type { CsvLearnerRow } from './types';

export interface GptUrlAnalysisResult {
  status: 'ok' | 'not_available' | 'error';
  reason?: string;
  inferredParams?: {
    brandParam?: string | null;
    modelParam?: string | null;
    yearFromParam?: string | null;
    yearToParam?: string | null;
    mileageParam?: string | null;
    fuelParam?: string | null;
    trimParam?: string | null;
    sortParam?: string | null;
  };
  explanation?: string;
  confidence?: number;
  suggestedTemplate?: string;
}

/**
 * Calls the server-side analyze-url-with-gpt edge function.
 * Returns null if not available (no key configured) or on error.
 * Never calls OpenAI directly from the browser.
 */
export async function analyzeUrlWithGPT(
  url: string,
  context: Partial<Pick<CsvLearnerRow, 'brand' | 'model' | 'year' | 'mileage' | 'fuel' | 'trim' | 'site'>>
): Promise<GptUrlAnalysisResult | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[GPT_URL_ANALYSIS] Supabase env vars missing — skipping GPT analysis');
    return null;
  }

  console.log('[GPT_URL_ANALYSIS] Sending URL to edge function', { url, context });

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-url-with-gpt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ url, context }),
    });

    if (!response.ok) {
      console.warn('[GPT_URL_ANALYSIS] Edge function returned HTTP error', response.status);
      return null;
    }

    const data: GptUrlAnalysisResult = await response.json();

    if (data.status === 'not_available') {
      console.info('[GPT_URL_ANALYSIS] GPT not configured server-side — status: not_available');
      return { status: 'not_available', reason: data.reason };
    }

    if (data.status === 'error') {
      console.warn('[GPT_URL_ANALYSIS] Edge function returned error', data.reason);
      return null;
    }

    console.log('[GPT_URL_ANALYSIS] Result received', {
      confidence: data.confidence,
      explanation: data.explanation?.slice(0, 100),
    });

    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[GPT_URL_ANALYSIS] Fetch failed', message);
    return null;
  }
}
