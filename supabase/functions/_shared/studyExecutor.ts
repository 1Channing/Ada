import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const ZYTE_API_KEY = Deno.env.get('ZYTE_API_KEY') || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

export type Currency = 'EUR' | 'DKK' | 'UNKNOWN';

export interface ScrapedListing {
  title: string;
  price: number;
  currency: Currency;
  mileage: number | null;
  year: number | null;
  trim: string | null;
  listing_url: string;
  description: string;
  price_type: 'one-off' | 'per-month' | 'unknown';
}

export interface SearchResult {
  listings: ScrapedListing[];
  blockedByProvider?: boolean;
  blockReason?: string;
  error?: 'SCRAPER_FAILED';
}

export interface StudyV2 {
  id: string;
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
  country_target: string;
  market_target_url: string;
  country_source: string;
  market_source_url: string;
  trim_text?: string | null;
  trim_text_target?: string | null;
  trim_text_source?: string | null;
}

const FX_RATES: Record<Currency, number> = {
  EUR: 1,
  DKK: 0.13,
  UNKNOWN: 1,
};

function toEur(price: number, currency: Currency): number {
  return price * (FX_RATES[currency] ?? 1);
}

async function fetchHtmlWithScraper(targetUrl: string): Promise<string | null> {
  if (!ZYTE_API_KEY) {
    console.error('[EXECUTOR] Missing Zyte API key');
    return null;
  }

  try {
    const authHeader = `Basic ${btoa(ZYTE_API_KEY + ':')}`;
    const requestBody = { url: targetUrl, browserHtml: true };

    const response = await fetch(ZYTE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EXECUTOR] Zyte API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    return result.browserHtml || null;
  } catch (error) {
    console.error('[EXECUTOR] Scraper fetch error:', error);
    return null;
  }
}

function parseMarktplaatsListings(html: string, baseUrl: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const listingPattern = /<article[^>]*data-item-id="(\d+)"[^>]*>([\s\S]*?)<\/article>/g;

  let match;
  while ((match = listingPattern.exec(html)) !== null) {
    const itemId = match[1];
    const articleHtml = match[2];

    const titleMatch = /<h3[^>]*>(.*?)<\/h3>/.exec(articleHtml);
    const priceMatch = /€\s*([\d.,]+)/.exec(articleHtml);
    const mileageMatch = /([\d.,]+)\s*km/.exec(articleHtml);
    const yearMatch = /(\d{4})/.exec(articleHtml);

    if (titleMatch && priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/[.,]/g, ''));
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[.,]/g, '')) : null;
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      listings.push({
        title: titleMatch[1].trim(),
        price,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: `https://www.marktplaats.nl/a/${itemId}`,
        description: '',
        price_type: 'one-off',
      });
    }
  }

  return listings;
}

function parseLeboncoinListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/.exec(html);
  if (!nextDataMatch) {
    console.log('[EXECUTOR] No __NEXT_DATA__ found in Leboncoin HTML');
    return listings;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const ads = nextData?.props?.pageProps?.searchData?.ads || [];

    for (const ad of ads) {
      if (!ad.subject || !ad.price || ad.price.length === 0) continue;

      const priceValue = ad.price[0];
      const price = typeof priceValue === 'number' ? priceValue : (priceValue?.value || 0);

      listings.push({
        title: ad.subject,
        price,
        currency: 'EUR',
        mileage: ad.attributes?.mileage || null,
        year: ad.attributes?.regdate || null,
        trim: null,
        listing_url: ad.url || `https://www.leboncoin.fr/${ad.list_id}`,
        description: ad.body || '',
        price_type: 'one-off',
      });
    }
  } catch (error) {
    console.error('[EXECUTOR] Error parsing Leboncoin JSON:', error);
  }

  return listings;
}

function parseBilbasenListings(html: string): ScrapedListing[] {
  const listings: ScrapedListing[] = [];
  const listingPattern = /<div[^>]*class="[^"]*listing[^"]*"[^>]*>([\s\S]*?)<\/div>/g;

  let match;
  while ((match = listingPattern.exec(html)) !== null) {
    const listingHtml = match[1];

    const titleMatch = /<h2[^>]*>(.*?)<\/h2>/.exec(listingHtml);
    const priceMatch = /([\d.]+)\s*kr/.exec(listingHtml);
    const mileageMatch = /([\d.]+)\s*km/.exec(listingHtml);
    const yearMatch = /(\d{4})/.exec(listingHtml);

    if (titleMatch && priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/\./g, ''));
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/\./g, '')) : null;
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      listings.push({
        title: titleMatch[1].trim(),
        price,
        currency: 'DKK',
        mileage,
        year,
        trim: null,
        listing_url: '',
        description: '',
        price_type: 'one-off',
      });
    }
  }

  return listings;
}

export async function scrapeSearch(url: string, scrapeMode: 'fast' | 'full'): Promise<SearchResult> {
  console.log(`[EXECUTOR] Scraping ${url} in ${scrapeMode.toUpperCase()} mode`);

  const html = await fetchHtmlWithScraper(url);

  if (!html) {
    return { listings: [], error: 'SCRAPER_FAILED' };
  }

  if (html.includes('/download/website-ban') || html.toLowerCase().includes('website ban')) {
    return {
      listings: [],
      blockedByProvider: true,
      blockReason: 'Zyte website-ban error detected',
    };
  }

  let listings: ScrapedListing[] = [];

  if (url.includes('marktplaats.nl')) {
    listings = parseMarktplaatsListings(html, url);
  } else if (url.includes('leboncoin.fr')) {
    listings = parseLeboncoinListings(html);
  } else if (url.includes('bilbasen.dk')) {
    listings = parseBilbasenListings(html);
  }

  console.log(`[EXECUTOR] Extracted ${listings.length} listings from ${url}`);

  return { listings };
}

function filterListingsByStudy(listings: ScrapedListing[], study: StudyV2): ScrapedListing[] {
  return listings.filter(listing => {
    if (listing.price_type !== 'one-off') return false;
    if (listing.price <= 0) return false;

    if (listing.year && Math.abs(listing.year - study.year) > 1) return false;

    if (listing.mileage && study.max_mileage > 0) {
      if (listing.mileage > study.max_mileage) return false;
    }

    return true;
  });
}

function computeTargetMarketStats(listings: ScrapedListing[]) {
  const prices = listings.map(l => toEur(l.price, l.currency)).sort((a, b) => a - b);

  if (prices.length === 0) {
    return {
      median_price: 0,
      average_price: 0,
      min_price: 0,
      max_price: 0,
      count: 0,
      percentile_25: 0,
      percentile_75: 0,
    };
  }

  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / prices.length;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

  const p25Index = Math.floor(prices.length * 0.25);
  const p75Index = Math.floor(prices.length * 0.75);

  return {
    median_price: median,
    average_price: avg,
    min_price: prices[0],
    max_price: prices[prices.length - 1],
    count: prices.length,
    percentile_25: prices[p25Index],
    percentile_75: prices[p75Index],
  };
}

function applyTrimLeboncoin(url: string, trim?: string): string {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('text=')) {
    return url.replace(/text=[^&]*/, `text=${encoded}`);
  }

  const kstIndex = url.indexOf('&kst=');
  if (kstIndex !== -1) {
    return url.slice(0, kstIndex) + `&text=${encoded}` + url.slice(kstIndex);
  }

  return url + `&text=${encoded}`;
}

function applyTrimMarktplaats(url: string, trim?: string): string {
  if (!trim) return url;
  const [base, hash = ''] = url.split('#');
  if (!hash) return url;

  const encoded = trim.toLowerCase();
  let newHash: string;

  if (hash.startsWith('q:')) {
    newHash = hash.replace(/^q:[^|]*/, `q:${encoded}`);
  } else {
    newHash = `q:${encoded}|` + hash;
  }

  return `${base}#${newHash}`;
}

function applyTrimBilbasen(url: string, trim?: string): string {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('free=')) {
    return url.replace(/free=[^&]*/, `free=${encoded}`);
  }

  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return url + `${sep}free=${encoded}`;
}

export interface ExecuteStudyParams {
  study: StudyV2;
  runId: string;
  threshold: number;
  scrapeMode: 'fast' | 'full';
  supabase: SupabaseClient;
}

export interface ExecuteStudyResult {
  status: 'NULL' | 'OPPORTUNITIES' | 'TARGET_BLOCKED';
  nullCount: number;
  opportunitiesCount: number;
}

export async function executeStudy(params: ExecuteStudyParams): Promise<ExecuteStudyResult> {
  const { study, runId, threshold, scrapeMode, supabase } = params;

  console.log(`[EXECUTOR] Processing study ${study.id} in ${scrapeMode.toUpperCase()} mode`);

  const trimTarget = study.trim_text_target?.trim() || study.trim_text?.trim() || undefined;
  const trimSource = study.trim_text_source?.trim() || study.trim_text?.trim() || undefined;

  let targetUrl = study.market_target_url;
  let sourceUrl = study.market_source_url;

  if (trimTarget) {
    if (study.country_target === 'NL') {
      targetUrl = applyTrimMarktplaats(targetUrl, trimTarget);
    } else if (study.country_target === 'FR') {
      targetUrl = applyTrimLeboncoin(targetUrl, trimTarget);
    } else if (study.country_target === 'DK') {
      targetUrl = applyTrimBilbasen(targetUrl, trimTarget);
    }
  }

  if (trimSource) {
    if (study.country_source === 'NL') {
      sourceUrl = applyTrimMarktplaats(sourceUrl, trimSource);
    } else if (study.country_source === 'FR') {
      sourceUrl = applyTrimLeboncoin(sourceUrl, trimSource);
    } else if (study.country_source === 'DK') {
      sourceUrl = applyTrimBilbasen(sourceUrl, trimSource);
    }
  }

  try {
    const targetResult = await scrapeSearch(targetUrl, scrapeMode);

    if (targetResult.error === 'SCRAPER_FAILED') {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: 'Zyte scraper failed',
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    if (targetResult.blockedByProvider) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'TARGET_BLOCKED',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: targetResult.blockReason,
      }]);

      return { status: 'TARGET_BLOCKED', nullCount: 0, opportunitiesCount: 0 };
    }

    const targetListings = targetResult.listings;
    const filteredTargetListings = filterListingsByStudy(targetListings, study);

    if (filteredTargetListings.length === 0) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: 'No valid target listings found',
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const targetStats = computeTargetMarketStats(filteredTargetListings);
    const targetMarketPriceEur = targetStats.median_price;

    console.log(`[EXECUTOR] Target median: ${targetMarketPriceEur.toFixed(0)} EUR`);

    const sourceResult = await scrapeSearch(sourceUrl, scrapeMode);

    if (sourceResult.error === 'SCRAPER_FAILED') {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: 'Zyte scraper failed on source',
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourceListings = sourceResult.listings;
    const filteredSourceListings = filterListingsByStudy(sourceListings, study);

    if (filteredSourceListings.length === 0) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: 'No valid source listings found',
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourcePricesEur = filteredSourceListings
      .map(l => toEur(l.price, l.currency))
      .sort((a, b) => a - b);
    const bestSourcePriceEur = sourcePricesEur[0];
    const priceDifferenceEur = targetMarketPriceEur - bestSourcePriceEur;

    console.log(`[EXECUTOR] Best source: ${bestSourcePriceEur.toFixed(0)} EUR, diff: ${priceDifferenceEur.toFixed(0)} EUR`);

    if (priceDifferenceEur < threshold) {
      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: bestSourcePriceEur,
        price_difference: priceDifferenceEur,
        target_stats: targetStats,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    console.log(`[EXECUTOR] OPPORTUNITY: ${priceDifferenceEur.toFixed(0)} EUR >= ${threshold} EUR`);

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'OPPORTUNITIES',
      target_market_price: targetMarketPriceEur,
      best_source_price: bestSourcePriceEur,
      price_difference: priceDifferenceEur,
      target_stats: {
        ...targetStats,
        targetMarketUrl: targetUrl,
        sourceMarketUrl: sourceUrl,
        targetMarketMedianEur: targetMarketPriceEur,
      },
    }]);

    return { status: 'OPPORTUNITIES', nullCount: 0, opportunitiesCount: 1 };
  } catch (error) {
    console.error(`[EXECUTOR] Error processing study ${study.id}:`, error);

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Error: ${(error as Error).message}`,
    }]);

    return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
  }
}
