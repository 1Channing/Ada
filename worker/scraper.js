const ZYTE_API_KEY = process.env.ZYTE_API_KEY || '';
const ZYTE_ENDPOINT = 'https://api.zyte.com/v1/extract';

const FX_RATES = {
  EUR: 1,
  DKK: 0.13,
  UNKNOWN: 1,
};

const BLOCKED_KEYWORDS = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'access denied',
  'blocked',
  'bot detection',
  'unusual traffic',
  'not a robot',
  'security check',
  'verify you are human',
  'cloudflare',
];

export function toEur(price, currency) {
  return price * (FX_RATES[currency] ?? 1);
}

function detectBlockedContent(html) {
  const lowerHtml = html.toLowerCase();

  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerHtml.includes(keyword)) {
      return {
        isBlocked: true,
        matchedKeyword: keyword,
      };
    }
  }

  return { isBlocked: false, matchedKeyword: null };
}

function extractDiagnostics(html, marketplace) {
  const blockedDetection = detectBlockedContent(html);

  const htmlSnippet = html.slice(0, 1500)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT]')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '[STYLE]');

  const hasNextData = html.includes('id="__NEXT_DATA__"');

  return {
    marketplace,
    htmlLength: html.length,
    htmlSnippet,
    hasNextData,
    detectedBlocked: blockedDetection.isBlocked,
    matchedKeyword: blockedDetection.matchedKeyword,
  };
}

async function fetchHtmlWithScraper(targetUrl) {
  if (!ZYTE_API_KEY) {
    console.error('[WORKER] Missing ZYTE_API_KEY environment variable');
    return null;
  }

  try {
    const authHeader = `Basic ${Buffer.from(ZYTE_API_KEY + ':').toString('base64')}`;
    const requestBody = { url: targetUrl, browserHtml: true };

    console.log(`[WORKER] Fetching ${targetUrl.slice(0, 100)}...`);

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
      console.error(`[WORKER] Zyte API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();
    return result.browserHtml || null;
  } catch (error) {
    console.error('[WORKER] Scraper fetch error:', error);
    return null;
  }
}

function parseMarktplaatsListingsFromNextData(html) {
  const listings = [];

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/.exec(html);
  if (!nextDataMatch) {
    console.log('[WORKER] No __NEXT_DATA__ found in Marktplaats HTML');
    return null;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]);

    const searchResults = nextData?.props?.pageProps?.searchResults?.listings ||
                         nextData?.props?.pageProps?.initialState?.listings?.listings ||
                         nextData?.props?.pageProps?.listings ||
                         [];

    console.log(`[WORKER] __NEXT_DATA__ found, attempting to parse ${searchResults.length} items`);

    for (const item of searchResults) {
      if (!item) continue;

      const itemId = item.itemId || item.id || item.vipUrl?.split('/').pop();
      const title = item.title || item.description || '';

      const priceInfo = item.priceInfo || item.price || {};
      const priceValue = priceInfo.priceCents ? priceInfo.priceCents / 100 :
                        (priceInfo.price || priceInfo.amount || 0);

      if (!title || !priceValue || priceValue <= 0) continue;

      const attributes = item.attributes || {};
      const mileageAttr = attributes.find?.(a => a.key === 'mileage' || a.key === 'kilometer-stand') || {};
      const yearAttr = attributes.find?.(a => a.key === 'year' || a.key === 'bouwjaar') || {};

      const mileage = mileageAttr.value ? parseInt(String(mileageAttr.value).replace(/\D/g, '')) : null;
      const year = yearAttr.value ? parseInt(String(yearAttr.value).replace(/\D/g, '')) : null;

      const listingUrl = item.vipUrl || (itemId ? `https://www.marktplaats.nl/a/${itemId}` : '');

      listings.push({
        title: title.trim(),
        price: priceValue,
        currency: 'EUR',
        mileage,
        year,
        trim: null,
        listing_url: listingUrl,
        description: item.description || '',
        price_type: 'one-off',
      });
    }

    console.log(`[WORKER] Successfully parsed ${listings.length} listings from __NEXT_DATA__`);
  } catch (error) {
    console.error('[WORKER] Error parsing Marktplaats __NEXT_DATA__:', error.message);
    return null;
  }

  return listings;
}

function parseMarktplaatsListingsFromHtml(html) {
  const listings = [];
  console.log('[WORKER] Falling back to HTML parsing for Marktplaats');

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

  console.log(`[WORKER] HTML fallback extracted ${listings.length} listings`);
  return listings;
}

function parseMarktplaatsListings(html) {
  const nextDataListings = parseMarktplaatsListingsFromNextData(html);

  if (nextDataListings && nextDataListings.length > 0) {
    return nextDataListings;
  }

  return parseMarktplaatsListingsFromHtml(html);
}

function parseLeboncoinListings(html) {
  const listings = [];

  const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/.exec(html);
  if (!nextDataMatch) {
    console.log('[WORKER] No __NEXT_DATA__ found in Leboncoin HTML');
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
    console.error('[WORKER] Error parsing Leboncoin JSON:', error);
  }

  return listings;
}

function parseBilbasenListings(html) {
  const listings = [];
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

export async function scrapeSearch(url, scrapeMode) {
  console.log(`[WORKER] Scraping ${url} in ${scrapeMode.toUpperCase()} mode`);

  const html = await fetchHtmlWithScraper(url);

  if (!html) {
    return {
      listings: [],
      error: 'SCRAPER_FAILED',
      errorReason: 'Zyte API returned no HTML',
    };
  }

  let marketplace = 'unknown';
  if (url.includes('marktplaats.nl')) marketplace = 'marktplaats';
  else if (url.includes('leboncoin.fr')) marketplace = 'leboncoin';
  else if (url.includes('bilbasen.dk')) marketplace = 'bilbasen';

  if (html.includes('/download/website-ban') || html.toLowerCase().includes('website ban')) {
    const diagnostics = extractDiagnostics(html, marketplace);
    return {
      listings: [],
      blockedByProvider: true,
      blockReason: 'Zyte website-ban error detected',
      diagnostics,
    };
  }

  const blockedDetection = detectBlockedContent(html);
  if (blockedDetection.isBlocked) {
    const diagnostics = extractDiagnostics(html, marketplace);
    console.log(`[WORKER] 🚫 Blocked content detected: ${blockedDetection.matchedKeyword}`);
    return {
      listings: [],
      blockedByProvider: true,
      blockReason: `${marketplace.toUpperCase()}_BLOCKED: ${blockedDetection.matchedKeyword}`,
      diagnostics,
    };
  }

  let listings = [];

  if (marketplace === 'marktplaats') {
    listings = parseMarktplaatsListings(html);
  } else if (marketplace === 'leboncoin') {
    listings = parseLeboncoinListings(html);
  } else if (marketplace === 'bilbasen') {
    listings = parseBilbasenListings(html);
  }

  console.log(`[WORKER] Extracted ${listings.length} listings from ${url}`);

  if (listings.length === 0) {
    const diagnostics = extractDiagnostics(html, marketplace);
    console.log(`[WORKER] ⚠️ Zero listings extracted from ${marketplace}`);
    console.log(`[WORKER] 📊 Diagnostics:`, JSON.stringify(diagnostics, null, 2));
    return {
      listings: [],
      diagnostics,
      errorReason: `${marketplace.toUpperCase()}_PARSE_ZERO_LISTINGS`,
    };
  }

  return { listings };
}

export function filterListingsByStudy(listings, study) {
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

export function computeTargetMarketStats(listings) {
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

function applyTrimLeboncoin(url, trim) {
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

function applyTrimMarktplaats(url, trim) {
  if (!trim) return url;
  const [base, hash = ''] = url.split('#');
  if (!hash) return url;

  const encoded = trim.toLowerCase();
  let newHash;

  if (hash.startsWith('q:')) {
    newHash = hash.replace(/^q:[^|]*/, `q:${encoded}`);
  } else {
    newHash = `q:${encoded}|` + hash;
  }

  return `${base}#${newHash}`;
}

function applyTrimBilbasen(url, trim) {
  if (!trim) return url;
  const encoded = encodeURIComponent(trim);

  if (url.includes('free=')) {
    return url.replace(/free=[^&]*/, `free=${encoded}`);
  }

  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return url + `${sep}free=${encoded}`;
}

export async function executeStudy({ study, runId, threshold, scrapeMode, supabase }) {
  console.log(`[WORKER] Processing study ${study.id} in ${scrapeMode.toUpperCase()} mode`);

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
      const errorReason = targetResult.errorReason || 'Zyte scraper failed';

      if (targetResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SCRAPER_FAILED',
          last_stage: 'target_scrape',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'target_scrape',
            error: errorReason,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    if (targetResult.blockedByProvider) {
      console.log(`[WORKER] 🚫 Target market blocked: ${targetResult.blockReason}`);

      if (targetResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'TARGET_BLOCKED',
          last_stage: 'target_scrape',
          error_message: targetResult.blockReason,
          logs_json: {
            studyId: study.id,
            stage: 'target_scrape',
            blocked: true,
            blockReason: targetResult.blockReason,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

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
      const errorReason = targetResult.errorReason ||
                         (targetListings.length === 0 ? 'No target listings extracted' : 'No valid target listings after filtering');

      if (targetResult.diagnostics) {
        console.log(`[WORKER] ⚠️ Logging zero-listings diagnostics to study_run_logs`);
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'NO_TARGET_LISTINGS',
          last_stage: 'target_filter',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'target_filter',
            rawListingsCount: targetListings.length,
            filteredListingsCount: filteredTargetListings.length,
            errorReason,
            diagnostics: targetResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: null,
        best_source_price: null,
        price_difference: null,
        target_stats: null,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const targetStats = computeTargetMarketStats(filteredTargetListings);
    const targetMarketPriceEur = targetStats.median_price;

    console.log(`[WORKER] Target median: ${targetMarketPriceEur.toFixed(0)} EUR`);

    const sourceResult = await scrapeSearch(sourceUrl, scrapeMode);

    if (sourceResult.error === 'SCRAPER_FAILED') {
      const errorReason = sourceResult.errorReason || 'Zyte scraper failed on source';

      if (sourceResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SCRAPER_FAILED',
          last_stage: 'source_scrape',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_scrape',
            error: errorReason,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    if (sourceResult.blockedByProvider) {
      console.log(`[WORKER] 🚫 Source market blocked: ${sourceResult.blockReason}`);

      if (sourceResult.diagnostics) {
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'SOURCE_BLOCKED',
          last_stage: 'source_scrape',
          error_message: sourceResult.blockReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_scrape',
            blocked: true,
            blockReason: sourceResult.blockReason,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: sourceResult.blockReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourceListings = sourceResult.listings;
    const filteredSourceListings = filterListingsByStudy(sourceListings, study);

    if (filteredSourceListings.length === 0) {
      const errorReason = sourceResult.errorReason ||
                         (sourceListings.length === 0 ? 'No source listings extracted' : 'No valid source listings after filtering');

      if (sourceResult.diagnostics) {
        console.log(`[WORKER] ⚠️ Logging zero-source-listings diagnostics to study_run_logs`);
        await supabase.from('study_run_logs').insert([{
          study_run_id: runId,
          status: 'NO_SOURCE_LISTINGS',
          last_stage: 'source_filter',
          error_message: errorReason,
          logs_json: {
            studyId: study.id,
            stage: 'source_filter',
            rawListingsCount: sourceListings.length,
            filteredListingsCount: filteredSourceListings.length,
            errorReason,
            diagnostics: sourceResult.diagnostics,
          },
        }]);
      }

      await supabase.from('study_run_results').insert([{
        run_id: runId,
        study_id: study.id,
        status: 'NULL',
        target_market_price: targetMarketPriceEur,
        best_source_price: null,
        price_difference: null,
        target_stats: targetStats,
        target_error_reason: errorReason,
      }]);

      return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
    }

    const sourcePricesEur = filteredSourceListings
      .map(l => toEur(l.price, l.currency))
      .sort((a, b) => a - b);
    const bestSourcePriceEur = sourcePricesEur[0];
    const priceDifferenceEur = targetMarketPriceEur - bestSourcePriceEur;

    console.log(`[WORKER] Best source: ${bestSourcePriceEur.toFixed(0)} EUR, diff: ${priceDifferenceEur.toFixed(0)} EUR`);

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

    console.log(`[WORKER] OPPORTUNITY: ${priceDifferenceEur.toFixed(0)} EUR >= ${threshold} EUR`);

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
    console.error(`[WORKER] Error processing study ${study.id}:`, error);

    await supabase.from('study_run_results').insert([{
      run_id: runId,
      study_id: study.id,
      status: 'NULL',
      target_market_price: null,
      best_source_price: null,
      price_difference: null,
      target_stats: null,
      target_error_reason: `Error: ${error.message}`,
    }]);

    return { status: 'NULL', nullCount: 1, opportunitiesCount: 0 };
  }
}
