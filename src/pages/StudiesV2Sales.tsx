import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';

interface Sale {
  id: string;
  sold_by: string;
  sold_at: string;
  buy_price: number;
  sale_price: number;
  listing: {
    id: string;
    title: string;
    listing_url: string;
    year: number | null;
    mileage: number | null;
    study_run_results: {
      studies_v2: {
        brand: string;
        model: string;
        year: number;
        country_source: string;
        country_target: string;
      };
    };
  };
}

export function StudiesV2Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSales();
  }, []);

  async function loadSales() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('sales')
        .select(`
          *,
          listing:study_source_listings (
            id,
            title,
            listing_url,
            year,
            mileage,
            study_run_results (
              studies_v2 (
                brand,
                model,
                year,
                country_source,
                country_target
              )
            )
          )
        `)
        .order('sold_at', { ascending: false });

      if (error) throw error;
      setSales(data || []);
    } catch (error) {
      console.error('Error loading sales:', error);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function calculateMargin(buyPrice: number, salePrice: number) {
    return salePrice - buyPrice;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">Sales</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Track completed vehicle sales and margins
          </p>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">
            All Sales ({sales.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading sales...</div>
        ) : sales.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            No sales yet. Mark vehicles as sold from the Negotiations tab.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {sales.map((sale) => {
              const margin = calculateMargin(sale.buy_price, sale.sale_price);
              const marginPercent = (margin / sale.buy_price) * 100;
              const isProfit = margin > 0;

              return (
                <div key={sale.id} className="p-4 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-zinc-100">{sale.listing.title}</h4>
                          <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400">
                            {sale.sold_by === 'channing' ? 'Channing' : 'Antoine'}
                          </span>
                        </div>
                        <div className="text-sm text-zinc-400">
                          <span className="font-medium text-blue-400">
                            {sale.listing.study_run_results.studies_v2.brand}{' '}
                            {sale.listing.study_run_results.studies_v2.model}
                          </span>
                          {' • '}
                          <span>{sale.listing.study_run_results.studies_v2.year}</span>
                          {' • '}
                          <span className="text-emerald-400">
                            {sale.listing.study_run_results.studies_v2.country_source}
                          </span>
                          {' → '}
                          <span className="text-blue-400">
                            {sale.listing.study_run_results.studies_v2.country_target}
                          </span>
                          {' • '}
                          <span className="text-zinc-500">Sold {formatDate(sale.sold_at)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-zinc-500 mb-1">Buy Price</div>
                          <div className="font-bold text-zinc-300">
                            {sale.buy_price.toLocaleString()}€
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-500 mb-1">Sale Price</div>
                          <div className="font-bold text-zinc-300">
                            {sale.sale_price.toLocaleString()}€
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-500 mb-1">Margin</div>
                          <div
                            className={`font-bold flex items-center gap-1 ${
                              isProfit ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {isProfit ? (
                              <TrendingUp size={14} />
                            ) : (
                              <TrendingDown size={14} />
                            )}
                            {isProfit ? '+' : ''}
                            {margin.toLocaleString()}€
                            <span className="text-xs">
                              ({marginPercent.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-500 mb-1">Details</div>
                          <div className="text-zinc-300">
                            {sale.listing.year && <span>{sale.listing.year} • </span>}
                            {sale.listing.mileage && (
                              <span>{sale.listing.mileage.toLocaleString()} km</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <a
                      href={sale.listing.listing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                    >
                      View Listing
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
