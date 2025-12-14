import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type ScraperResponse = {
  listings: Array<{
    url_annonce: string;
    price_eur: number;
    title?: string;
    year?: number;
    km?: number;
    brand?: string;
    model?: string;
    seller_type?: string;
    description?: string;
    options?: string[];
    photos?: string[];
  }>;
};

type PricingStrategy = "mean_5_lowest" | "median_minus_5pct" | "mean_all" | "median";

function computeTargetPrice(prices: number[], strategy: PricingStrategy): number {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);

  switch (strategy) {
    case "mean_5_lowest": {
      const lowest5 = sorted.slice(0, Math.min(5, sorted.length));
      return lowest5.reduce((acc, p) => acc + p, 0) / lowest5.length;
    }
    case "median_minus_5pct": {
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      return median * 0.95;
    }
    case "mean_all":
      return sorted.reduce((acc, p) => acc + p, 0) / sorted.length;
    case "median":
      return sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    default:
      return 0;
  }
}

function computeEstimatedMargin(listingPrice: number, targetPrice: number): number {
  return targetPrice - listingPrice - 500;
}

function computeScoreMc(marginEur: number): number {
  const rawScore = marginEur / 1000;
  return Math.max(0, Math.min(15, rawScore));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const scraperApiUrl = Deno.env.get("SCRAPER_API_URL") || "";
    const scraperApiKey = Deno.env.get("SCRAPER_API_KEY") || "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const jobId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    await supabase.from("job_runs").insert({
      id: jobId,
      run_type: "daily_08h",
      started_at: startedAt,
      status: "running",
    });

    const results = {
      studiesUpdated: 0,
      listingsProcessed: 0,
      detailsScraped: 0,
      errors: [] as string[],
    };

    const { data: studies } = await supabase
      .from("market_studies")
      .select("*")
      .not("target_search_url", "is", null);

    if (studies) {
      for (const study of studies) {
        try {
          if (!scraperApiUrl) {
            results.errors.push(`No scraper API configured for study ${study.id}`);
            continue;
          }

          const targetResponse = await fetch(scraperApiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${scraperApiKey}`,
            },
            body: JSON.stringify({
              search_url: study.target_search_url,
              site: study.target_marketplace,
              country: study.target_country,
            }),
          });

          if (!targetResponse.ok) {
            results.errors.push(`Target scrape failed for study ${study.id}`);
            continue;
          }

          const targetData: ScraperResponse = await targetResponse.json();
          const targetPrices = targetData.listings.map((l) => l.price_eur).filter(p => p > 0);

          if (targetPrices.length > 0) {
            const targetPrice = computeTargetPrice(
              targetPrices,
              study.pricing_strategy as PricingStrategy
            );

            await supabase
              .from("market_studies")
              .update({
                last_computed_target_export_price_eur: targetPrice,
                last_computed_target_export_price_at: new Date().toISOString(),
              })
              .eq("id", study.id);

            results.studiesUpdated++;
          }
        } catch (error) {
          results.errors.push(`Study ${study.id}: ${(error as Error).message}`);
        }
      }
    }

    const { data: studiesForSource } = await supabase
      .from("market_studies")
      .select("*");

    if (studiesForSource) {
      for (const study of studiesForSource) {
        try {
          if (!scraperApiUrl) continue;

          const sourceResponse = await fetch(scraperApiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${scraperApiKey}`,
            },
            body: JSON.stringify({
              search_url: study.source_search_url,
              site: study.source_marketplace,
              country: study.source_country,
            }),
          });

          if (!sourceResponse.ok) {
            results.errors.push(`Source scrape failed for study ${study.id}`);
            continue;
          }

          const sourceData: ScraperResponse = await sourceResponse.json();
          const now = new Date().toISOString();

          for (const rawListing of sourceData.listings) {
            try {
              const { data: existing } = await supabase
                .from("listings")
                .select("*")
                .eq("url_annonce", rawListing.url_annonce)
                .maybeSingle();

              const targetPrice = study.last_computed_target_export_price_eur || 0;
              const margin = computeEstimatedMargin(rawListing.price_eur, targetPrice);
              const score = computeScoreMc(margin);

              const listingData = {
                market_study_id: study.id,
                source_site: study.source_marketplace,
                source_country: study.source_country,
                target_country: study.target_country,
                url_annonce: rawListing.url_annonce,
                brand: rawListing.brand || study.brand,
                model: rawListing.model || study.model_pattern,
                year: rawListing.year,
                km: rawListing.km,
                price_eur: rawListing.price_eur,
                target_export_price_eur: targetPrice,
                estimated_margin_eur: margin,
                score_mc: score,
                last_seen_at: now,
                price_current: rawListing.price_eur,
                raw_data: rawListing as any,
              };

              if (!existing) {
                await supabase.from("listings").insert({
                  ...listingData,
                  first_seen_at: now,
                  price_original: rawListing.price_eur,
                  status: "new",
                  details_scraped: false,
                });
              } else {
                const priceVariation = rawListing.price_eur - existing.price_original;
                let newStatus = existing.status;

                if (rawListing.price_eur > existing.price_current) {
                  newStatus = "price_up";
                } else if (rawListing.price_eur < existing.price_current) {
                  newStatus = "price_down";
                } else if (newStatus === "new") {
                  newStatus = "seen";
                }

                const firstSeen = new Date(existing.first_seen_at);
                const lastSeen = new Date(now);
                const daysOnline = Math.floor((lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));

                await supabase
                  .from("listings")
                  .update({
                    ...listingData,
                    status: newStatus,
                    price_variation_eur: priceVariation,
                    days_online: daysOnline,
                  })
                  .eq("id", existing.id);
              }

              results.listingsProcessed++;
            } catch (error) {
              results.errors.push(`Listing ${rawListing.url_annonce}: ${(error as Error).message}`);
            }
          }
        } catch (error) {
          results.errors.push(`Source scrape for study ${study.id}: ${(error as Error).message}`);
        }
      }
    }

    await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: results.errors.length > 0 ? "error" : "success",
        message: `Processed ${results.listingsProcessed} listings from ${results.studiesUpdated} studies`,
        details: results as any,
      })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        results,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Daily job error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});