import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ZYTE_API_KEY = Deno.env.get('ZYTE_API_KEY') || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';
const WORKER_SECRET = Deno.env.get('WORKER_SECRET') || '';

interface MarketStudyDefinition {
  id: string;
  brand: string;
  models: string[];
  year_min: number;
  year_max: number;
  km_max: number;
  generated_links: Record<string, string>;
  target_count: number;
  status: string;
}

interface ListingSnapshot {
  title: string;
  price: number;
  currency: string;
  mileage: number | null;
  year: number | null;
  listing_url: string;
  marketplace: string;
  extracted_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log('[MARKET_STUDY] ===== Execute Market Study Request Received =====');
  console.log('[MARKET_STUDY] Timestamp:', new Date().toISOString());

  try {
    // Authentication (same as worker)
    const authHeaderRaw = req.headers.get('authorization') || req.headers.get('x-worker-secret') || '';
    const providedSecret = authHeaderRaw.replace('Bearer ', '');

    if (!WORKER_SECRET) {
      console.warn('[MARKET_STUDY] ⚠️ WORKER_SECRET not configured - running without auth');
    } else if (providedSecret !== WORKER_SECRET) {
      console.error('[MARKET_STUDY] ❌ Unauthorized: Invalid or missing WORKER_SECRET');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or missing WORKER_SECRET' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[MARKET_STUDY] ✅ Authentication passed');

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[MARKET_STUDY] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ error: 'Missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!ZYTE_API_KEY) {
      console.error('[MARKET_STUDY] Missing ZYTE_API_KEY');
      return new Response(
        JSON.stringify({ error: 'Missing ZYTE_API_KEY configuration' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { studyId } = await req.json();

    if (!studyId) {
      console.error('[MARKET_STUDY] Missing studyId parameter');
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: studyId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[MARKET_STUDY] Fetching study definition:', studyId);

    const { data: study, error: studyError } = await supabase
      .from('market_study_definitions')
      .select('*')
      .eq('id', studyId)
      .single();

    if (studyError || !study) {
      console.error('[MARKET_STUDY] Study not found:', studyError);
      return new Response(
        JSON.stringify({ error: 'Study not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const studyDef = study as MarketStudyDefinition;
    console.log('[MARKET_STUDY] Study loaded:', {
      brand: studyDef.brand,
      models: studyDef.models,
      target_count: studyDef.target_count,
      markets: Object.keys(studyDef.generated_links),
    });

    const startTime = Date.now();

    // Update status to running
    await supabase
      .from('market_study_definitions')
      .update({
        status: 'running',
        executed_at: new Date().toISOString(),
      })
      .eq('id', studyId);

    const allListings: ListingSnapshot[] = [];

    // Process each marketplace
    for (const [market, baseUrl] of Object.entries(studyDef.generated_links)) {
      console.log(`[MARKET_STUDY] Processing ${market}: ${baseUrl}`);

      let pageNumber = 1;
      let marketplaceListings = 0;

      // Continue pagination until we reach target_count
      while (allListings.length < studyDef.target_count) {
        const url = buildPaginatedUrl(baseUrl, pageNumber);
        console.log(`[MARKET_STUDY] Fetching page ${pageNumber} from ${market}`);

        const html = await fetchHtmlWithRetry(url);

        if (!html) {
          console.error(`[MARKET_STUDY] Failed to fetch ${url}`);
          break;
        }

        const listings = parseListings(html, url, market);
        console.log(`[MARKET_STUDY] Extracted ${listings.length} listings from page ${pageNumber}`);

        if (listings.length === 0) {
          console.log(`[MARKET_STUDY] No more listings found for ${market}`);
          break;
        }

        // Add listings up to target_count
        for (const listing of listings) {
          if (allListings.length >= studyDef.target_count) {
            console.log(`[MARKET_STUDY] ✅ Target count reached (${studyDef.target_count})`);
            break;
          }
          allListings.push(listing);
          marketplaceListings++;
        }

        // Stop if we've reached target_count
        if (allListings.length >= studyDef.target_count) {
          break;
        }

        pageNumber++;
      }

      console.log(`[MARKET_STUDY] ${market}: collected ${marketplaceListings} listings`);

      // Stop processing other markets if target reached
      if (allListings.length >= studyDef.target_count) {
        break;
      }
    }

    const executionDuration = Date.now() - startTime;

    console.log(`[MARKET_STUDY] ✅ Execution complete: ${allListings.length} listings in ${executionDuration}ms`);

    // Update study with results
    await supabase
      .from('market_study_definitions')
      .update({
        status: 'completed',
        results: allListings,
        execution_duration_ms: executionDuration,
      })
      .eq('id', studyId);

    return new Response(
      JSON.stringify({
        success: true,
        studyId,
        listingsCollected: allListings.length,
        targetCount: studyDef.target_count,
        executionDurationMs: executionDuration,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[MARKET_STUDY] ❌ Fatal error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Helper functions

function buildPaginatedUrl(baseUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) return baseUrl;

  try {
    const urlObj = new URL(baseUrl);
    urlObj.searchParams.set('page', String(pageNumber));
    return urlObj.toString();
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}page=${pageNumber}`;
  }
}

async function fetchHtmlWithRetry(url: string, maxRetries = 3): Promise<string | null> {
  const retryDelays = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const authHeader = `Basic ${btoa(ZYTE_API_KEY + ':')}`;
      const requestBody = {
        url,
        browserHtml: true,
      };

      console.log(`[MARKET_STUDY] Zyte API request (attempt ${attempt + 1}/${maxRetries})`);

      const response = await fetch(ZYTE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Only retry on transient errors (429, 5xx)
      if (!response.ok) {
        const statusCode = response.status;
        const shouldRetry = statusCode === 429 || (statusCode >= 500 && statusCode < 600);

        console.error(`[MARKET_STUDY] Zyte API error: ${statusCode}`);

        if (shouldRetry && attempt < maxRetries - 1) {
          const delay = retryDelays[attempt];
          console.log(`[MARKET_STUDY] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return null;
      }

      const result = await response.json() as { browserHtml?: string };
      return result.browserHtml || null;

    } catch (error) {
      console.error(`[MARKET_STUDY] Fetch error (attempt ${attempt + 1}):`, error);

      if (attempt < maxRetries - 1) {
        const delay = retryDelays[attempt];
        console.log(`[MARKET_STUDY] Retrying after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return null;
    }
  }

  return null;
}

function parseListings(html: string, url: string, market: string): ListingSnapshot[] {
  const listings: ListingSnapshot[] = [];
  const marketplace = detectMarketplace(url);

  // Simple parsing - extract basic info only (no full HTML storage)
  if (marketplace === 'marktplaats') {
    return parseMarktplaatsListings(html, market);
  } else if (marketplace === 'leboncoin') {
    return parseLeboncoinListings(html, market);
  } else if (marketplace === 'bilbasen') {
    return parseBilbasenListings(html, market);
  } else if (marketplace === 'gaspedaal') {
    return parseGaspedaalListings(html, market);
  }

  return listings;
}

function detectMarketplace(url: string): string {
  if (url.includes('marktplaats.nl')) return 'marktplaats';
  if (url.includes('leboncoin.fr')) return 'leboncoin';
  if (url.includes('bilbasen.dk')) return 'bilbasen';
  if (url.includes('gaspedaal.nl')) return 'gaspedaal';
  return 'unknown';
}

function parseMarktplaatsListings(html: string, market: string): ListingSnapshot[] {
  const listings: ListingSnapshot[] = [];

  // Extract from HTML cards
  const listingPattern = /<li\s+class="[^"]*hz-Listing\s+hz-Listing--list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const matches = Array.from(html.matchAll(listingPattern));

  for (const match of matches) {
    const cardHtml = match[0];

    // Extract URL
    const urlMatch = cardHtml.match(/<a\s+[^>]*href=["'](\/[av]\/[^"']+)["']/i);
    if (!urlMatch) continue;

    const listingUrl = `https://www.marktplaats.nl${urlMatch[1]}`;

    // Extract text content
    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract price
    const priceMatch = textContent.match(/€\s*([\d\s.]+)/);
    if (!priceMatch) continue;

    const price = parseInt(priceMatch[1].replace(/\s/g, '').replace(/\./g, ''), 10);
    if (isNaN(price) || price <= 0) continue;

    // Extract title
    const titleMatch = cardHtml.match(/title=["']([^"']+)["']/);
    const title = titleMatch ? titleMatch[1] : textContent.substring(0, 100).trim();

    // Extract year
    const yearMatch = textContent.match(/\b(20[0-2][0-9])\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Extract mileage
    const mileageMatch = textContent.match(/(\d[\d\s.]*?)\s*km\b/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[\s.]/g, ''), 10) : null;

    listings.push({
      title,
      price,
      currency: 'EUR',
      mileage,
      year,
      listing_url: listingUrl,
      marketplace: market,
      extracted_at: new Date().toISOString(),
    });
  }

  return listings;
}

function parseLeboncoinListings(html: string, market: string): ListingSnapshot[] {
  const listings: ListingSnapshot[] = [];

  // Try to extract from __NEXT_DATA__
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return listings;

  try {
    const data = JSON.parse(nextDataMatch[1]);
    const ads = data?.props?.pageProps?.searchData?.ads || data?.props?.pageProps?.ads || [];

    for (const ad of ads) {
      const price = typeof ad.price === 'object' ? ad.price[0] : ad.price;
      if (!price) continue;

      let url = ad.url || ad.link;
      if (url && url.startsWith('/')) {
        url = `https://www.leboncoin.fr${url}`;
      }

      const attributes = ad.attributes || {};
      const year = attributes.regdate || attributes.year || null;
      const mileage = attributes.mileage || null;

      listings.push({
        title: ad.subject || ad.title || 'Untitled',
        price: typeof price === 'number' ? price : parseInt(String(price).replace(/\D/g, ''), 10),
        currency: 'EUR',
        mileage: mileage ? (typeof mileage === 'number' ? mileage : parseInt(String(mileage).replace(/\D/g, ''), 10)) : null,
        year: year ? (typeof year === 'number' ? year : parseInt(String(year), 10)) : null,
        listing_url: url,
        marketplace: market,
        extracted_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[MARKET_STUDY] Error parsing LeBonCoin JSON:', error);
  }

  return listings;
}

function parseBilbasenListings(html: string, market: string): ListingSnapshot[] {
  const listings: ListingSnapshot[] = [];

  const anchorRegex = /<a\s+[^>]*href=["']([^"']*\/brugt\/bil\/[^"']*)["'][^>]*>/gi;
  const anchorMatches = Array.from(html.matchAll(anchorRegex));

  const processedUrls = new Set<string>();

  for (const anchorMatch of anchorMatches) {
    const href = anchorMatch[1];
    if (href.startsWith('#') || href.startsWith('javascript:')) continue;

    let listingUrl = href.startsWith('/') ? `https://www.bilbasen.dk${href}` : href;
    if (processedUrls.has(listingUrl)) continue;
    processedUrls.add(listingUrl);

    // Extract context
    const anchorIndex = html.indexOf(anchorMatch[0]);
    if (anchorIndex === -1) continue;

    const contextStart = Math.max(0, anchorIndex - 2000);
    const contextEnd = Math.min(html.length, anchorIndex + 2000);
    const cardHtml = html.substring(contextStart, contextEnd);

    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract price (DKK)
    const priceMatch = textContent.match(/(\d[\d.,']*)\s*kr\.?/i);
    if (!priceMatch) continue;

    const priceDkk = parseInt(priceMatch[1].replace(/[\s.,']/g, ''), 10);
    if (isNaN(priceDkk) || priceDkk <= 0) continue;

    const priceEur = Math.round(priceDkk * 0.13); // DKK to EUR conversion

    // Extract year
    const yearMatch = textContent.match(/\b(20[0-2][0-9])\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Extract mileage
    const mileageMatch = textContent.match(/(\d[\d\s.,']*?)\s*km\b/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[\s.,']/g, ''), 10) : null;

    const titleMatch = cardHtml.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const title = titleMatch ? titleMatch[1].trim() : textContent.substring(0, 100).trim();

    listings.push({
      title,
      price: priceEur,
      currency: 'EUR',
      mileage,
      year,
      listing_url: listingUrl,
      marketplace: market,
      extracted_at: new Date().toISOString(),
    });
  }

  return listings;
}

function parseGaspedaalListings(html: string, market: string): ListingSnapshot[] {
  const listings: ListingSnapshot[] = [];

  const cardPattern = /<article[^>]*class="[^"]*car-card[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  const matches = Array.from(html.matchAll(cardPattern));

  for (const match of matches) {
    const cardHtml = match[0];

    // Extract URL
    const urlMatch = cardHtml.match(/<a[^>]*href=["']([^"']+)["']/i);
    if (!urlMatch) continue;

    let listingUrl = urlMatch[1];
    if (listingUrl.startsWith('/')) {
      listingUrl = `https://www.gaspedaal.nl${listingUrl}`;
    }

    const textContent = cardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract price
    const priceMatch = textContent.match(/€\s*([\d\s.]+)/);
    if (!priceMatch) continue;

    const price = parseInt(priceMatch[1].replace(/\s/g, '').replace(/\./g, ''), 10);
    if (isNaN(price) || price <= 0) continue;

    // Extract title
    const titleMatch = cardHtml.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const title = titleMatch ? titleMatch[1].trim() : textContent.substring(0, 100).trim();

    // Extract year
    const yearMatch = textContent.match(/\b(20[0-2][0-9])\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Extract mileage
    const mileageMatch = textContent.match(/(\d[\d\s.]*?)\s*km\b/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/[\s.]/g, ''), 10) : null;

    listings.push({
      title,
      price,
      currency: 'EUR',
      mileage,
      year,
      listing_url: listingUrl,
      marketplace: market,
      extracted_at: new Date().toISOString(),
    });
  }

  return listings;
}
