import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingUp, TrendingDown, Clock, ShoppingCart } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Listing = Database['public']['Tables']['listings']['Row'];

type AggregatedMetrics = {
  brand: string;
  model: string;
  count: number;
  avgPrice: number;
  avgMargin: number;
  avgDaysOnline: number;
  boughtCount: number;
};

export function ListingsHistory() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [metrics, setMetrics] = useState<AggregatedMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    loadListings();
    loadMetrics();
  }, [selectedBrand, selectedModel, selectedStatus, startDate, endDate]);

  async function loadListings() {
    setLoading(true);
    try {
      let query = supabase
        .from('listings')
        .select('*')
        .order('last_seen_at', { ascending: false });

      if (selectedBrand) {
        query = query.ilike('brand', `%${selectedBrand}%`);
      }

      if (selectedModel) {
        query = query.ilike('model', `%${selectedModel}%`);
      }

      if (selectedStatus) {
        query = query.eq('status', selectedStatus);
      }

      if (startDate) {
        query = query.gte('first_seen_at', startDate);
      }

      if (endDate) {
        query = query.lte('last_seen_at', endDate);
      }

      const { data, error } = await query.limit(200);

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Error loading listings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadMetrics() {
    try {
      let query = supabase
        .from('listings')
        .select('brand, model, price_current, estimated_margin_eur, days_online, status');

      if (startDate) {
        query = query.gte('first_seen_at', startDate);
      }

      if (endDate) {
        query = query.lte('last_seen_at', endDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      const grouped = (data || []).reduce((acc, listing) => {
        const key = `${listing.brand}_${listing.model}`;
        if (!acc[key]) {
          acc[key] = {
            brand: listing.brand,
            model: listing.model,
            prices: [],
            margins: [],
            days: [],
            boughtCount: 0,
          };
        }

        acc[key].prices.push(listing.price_current);
        if (listing.estimated_margin_eur) {
          acc[key].margins.push(listing.estimated_margin_eur);
        }
        if (listing.days_online) {
          acc[key].days.push(listing.days_online);
        }
        if (listing.status === 'bought') {
          acc[key].boughtCount++;
        }

        return acc;
      }, {} as Record<string, any>);

      const aggregated: AggregatedMetrics[] = Object.values(grouped).map((g: any) => ({
        brand: g.brand,
        model: g.model,
        count: g.prices.length,
        avgPrice: g.prices.reduce((a: number, b: number) => a + b, 0) / g.prices.length,
        avgMargin: g.margins.length > 0
          ? g.margins.reduce((a: number, b: number) => a + b, 0) / g.margins.length
          : 0,
        avgDaysOnline: g.days.length > 0
          ? g.days.reduce((a: number, b: number) => a + b, 0) / g.days.length
          : 0,
        boughtCount: g.boughtCount,
      }));

      aggregated.sort((a, b) => b.count - a.count);
      setMetrics(aggregated);
    } catch (error) {
      console.error('Error loading metrics:', error);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-100">Listings History</h1>
        <p className="text-zinc-400 mt-1">Historical data and aggregated metrics</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 rounded-lg">
              <TrendingUp className="text-emerald-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">{listings.length}</div>
              <div className="text-xs text-zinc-500">Total Listings</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <ShoppingCart className="text-blue-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {listings.filter((l) => l.status === 'bought').length}
              </div>
              <div className="text-xs text-zinc-500">Bought</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <Clock className="text-amber-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {listings.filter((l) => l.status === 'new' || l.status === 'seen').length}
              </div>
              <div className="text-xs text-zinc-500">Active</div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-500/10 rounded-lg">
              <TrendingDown className="text-red-400" size={24} />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-100">
                {listings.filter((l) => l.status === 'disappeared').length}
              </div>
              <div className="text-xs text-zinc-500">Disappeared</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-6">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Filters</h3>
        <div className="grid grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Brand</label>
            <input
              type="text"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
              placeholder="e.g. Toyota"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Model</label>
            <input
              type="text"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
              placeholder="e.g. RAV4"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="seen">Seen</option>
              <option value="contacted">Contacted</option>
              <option value="bought">Bought</option>
              <option value="rejected">Rejected</option>
              <option value="disappeared">Disappeared</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-bold text-zinc-100 mb-4">Aggregated Metrics by Model</h2>
        {metrics.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">No data available</div>
        ) : (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-800 border-b border-zinc-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Brand / Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Count</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Avg Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Avg Margin</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Avg Days Online</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Bought</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric, idx) => (
                  <tr key={idx} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-100">{metric.brand}</div>
                      <div className="text-xs text-zinc-500">{metric.model}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{metric.count}</td>
                    <td className="px-4 py-3 text-zinc-300">€{Math.round(metric.avgPrice).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={metric.avgMargin > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        €{Math.round(metric.avgMargin).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{Math.round(metric.avgDaysOnline)}d</td>
                    <td className="px-4 py-3">
                      <span className="text-blue-400 font-medium">{metric.boughtCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xl font-bold text-zinc-100 mb-4">Recent Listings</h2>
        {loading ? (
          <div className="text-center py-12 text-zinc-400">Loading listings...</div>
        ) : listings.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">No listings found</div>
        ) : (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-800 border-b border-zinc-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Vehicle</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Score</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">First Seen</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-100">{listing.brand} {listing.model}</div>
                      <div className="text-xs text-zinc-500">
                        {listing.year || '?'} • {listing.km ? `${listing.km.toLocaleString()} km` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">€{listing.price_current.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="text-emerald-400 font-medium">
                        {listing.score_mc?.toFixed(1) || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300">
                        {listing.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-sm">
                      {new Date(listing.first_seen_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-sm">
                      {new Date(listing.last_seen_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
