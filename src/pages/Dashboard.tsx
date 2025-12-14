import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExternalLink, Eye, Phone, ShoppingCart, X, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Listing = Database['public']['Tables']['listings']['Row'];

type Filters = {
  minScore: number;
  maxScore: number;
  sourceCountry: string;
  targetCountry: string;
  brand: string;
  riskLevel: string;
  onlyRunning: boolean;
  hideAccident: boolean;
  onlyValidated: boolean;
};

export function Dashboard() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    minScore: 0,
    maxScore: 15,
    sourceCountry: '',
    targetCountry: '',
    brand: '',
    riskLevel: '',
    onlyRunning: false,
    hideAccident: false,
    onlyValidated: false,
  });

  useEffect(() => {
    loadListings();
  }, [filters]);

  async function loadListings() {
    setLoading(true);
    try {
      let query = supabase
        .from('listings')
        .select('*')
        .order('score_mc', { ascending: false })
        .order('last_seen_at', { ascending: false });

      if (filters.minScore > 0) {
        query = query.gte('score_mc', filters.minScore);
      }

      if (filters.maxScore < 15) {
        query = query.lte('score_mc', filters.maxScore);
      }

      if (filters.sourceCountry) {
        query = query.eq('source_country', filters.sourceCountry);
      }

      if (filters.targetCountry) {
        query = query.eq('target_country', filters.targetCountry);
      }

      if (filters.brand) {
        query = query.ilike('brand', `%${filters.brand}%`);
      }

      if (filters.riskLevel) {
        query = query.eq('risk_level', filters.riskLevel);
      }

      if (filters.onlyRunning) {
        query = query.eq('is_running', true);
      }

      if (filters.hideAccident) {
        query = query.or('is_accident_suspected.is.null,is_accident_suspected.eq.false');
      }

      if (filters.onlyValidated) {
        query = query.eq('details_scraped', true).neq('risk_level', 'high');
      }

      const { data, error } = await query.limit(100);

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Error loading listings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateListingStatus(id: string, status: Listing['status']) {
    try {
      const { error } = await supabase
        .from('listings')
        .update({ status })
        .eq('id', id);

      if (error) throw error;
      loadListings();
    } catch (error) {
      console.error('Error updating listing:', error);
    }
  }

  function getScoreBadgeColor(score: number | null): string {
    if (!score) return 'bg-zinc-700 text-zinc-400';
    if (score >= 10) return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    if (score >= 6) return 'bg-green-500/20 text-green-400 border border-green-500/30';
    if (score >= 3) return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    return 'bg-red-500/20 text-red-400 border border-red-500/30';
  }

  function getRiskIcon(riskLevel: string | null) {
    if (!riskLevel) return null;
    if (riskLevel === 'low') return <CheckCircle size={16} className="text-green-400" />;
    if (riskLevel === 'medium') return <AlertCircle size={16} className="text-amber-400" />;
    return <AlertTriangle size={16} className="text-red-400" />;
  }

  function getDaysOnlineBadge(days: number | null) {
    if (days === null || days === undefined) return null;
    if (days < 2) return <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Fresh</span>;
    if (days >= 30) return <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">Stale</span>;
    return <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-400">{days}d</span>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">Deals of the Day</h1>
          <p className="text-zinc-400 mt-1">Top export opportunities based on margin potential</p>
        </div>
        <button
          onClick={() => loadListings()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-6">
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Min Score</label>
            <input
              type="number"
              value={filters.minScore}
              onChange={(e) => setFilters({ ...filters, minScore: Number(e.target.value) })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
              min="0"
              max="15"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Max Score</label>
            <input
              type="number"
              value={filters.maxScore}
              onChange={(e) => setFilters({ ...filters, maxScore: Number(e.target.value) })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
              min="0"
              max="15"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Source Country</label>
            <input
              type="text"
              value={filters.sourceCountry}
              onChange={(e) => setFilters({ ...filters, sourceCountry: e.target.value })}
              placeholder="e.g. FR, NL"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Target Country</label>
            <input
              type="text"
              value={filters.targetCountry}
              onChange={(e) => setFilters({ ...filters, targetCountry: e.target.value })}
              placeholder="e.g. DK, IT"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Brand</label>
            <input
              type="text"
              value={filters.brand}
              onChange={(e) => setFilters({ ...filters, brand: e.target.value })}
              placeholder="e.g. Toyota"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Risk Level</label>
            <select
              value={filters.riskLevel}
              onChange={(e) => setFilters({ ...filters, riskLevel: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100"
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={filters.onlyRunning}
                onChange={(e) => setFilters({ ...filters, onlyRunning: e.target.checked })}
                className="rounded bg-zinc-800 border-zinc-700"
              />
              Running only
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={filters.hideAccident}
                onChange={(e) => setFilters({ ...filters, hideAccident: e.target.checked })}
                className="rounded bg-zinc-800 border-zinc-700"
              />
              Hide accident
            </label>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={filters.onlyValidated}
                onChange={(e) => setFilters({ ...filters, onlyValidated: e.target.checked })}
                className="rounded bg-zinc-800 border-zinc-700"
              />
              Top validated only
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading listings...</div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">No listings found with current filters</div>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-800 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Vehicle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Price / Target / Margin</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Route</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Days / Risk</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className={`inline-block px-3 py-1 rounded-lg font-bold text-sm ${getScoreBadgeColor(listing.score_mc)}`}>
                      {listing.score_mc?.toFixed(1) || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-zinc-100">{listing.brand} {listing.model}</div>
                    <div className="text-xs text-zinc-500">
                      {listing.year || '?'} • {listing.km ? `${listing.km.toLocaleString()} km` : 'N/A km'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <div className="text-zinc-100">€{listing.price_eur.toLocaleString()}</div>
                      <div className="text-zinc-500 text-xs">
                        Target: €{listing.target_export_price_eur?.toLocaleString() || 'N/A'}
                      </div>
                      <div className={`text-xs font-medium ${(listing.estimated_margin_eur || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        Margin: €{listing.estimated_margin_eur?.toLocaleString() || 'N/A'}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-zinc-300">
                      {listing.source_country} → {listing.target_country}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getDaysOnlineBadge(listing.days_online)}
                      {getRiskIcon(listing.risk_level)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 inline-block">
                      {listing.status}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <a
                        href={listing.url_annonce}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                        title="Open listing"
                      >
                        <ExternalLink size={16} className="text-zinc-400" />
                      </a>
                      <button
                        onClick={() => updateListingStatus(listing.id, 'seen')}
                        className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                        title="Mark as seen"
                      >
                        <Eye size={16} className="text-zinc-400" />
                      </button>
                      <button
                        onClick={() => updateListingStatus(listing.id, 'contacted')}
                        className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                        title="Mark as contacted"
                      >
                        <Phone size={16} className="text-zinc-400" />
                      </button>
                      <button
                        onClick={() => updateListingStatus(listing.id, 'bought')}
                        className="p-1.5 hover:bg-emerald-700 rounded transition-colors"
                        title="Mark as bought"
                      >
                        <ShoppingCart size={16} className="text-emerald-400" />
                      </button>
                      <button
                        onClick={() => updateListingStatus(listing.id, 'rejected')}
                        className="p-1.5 hover:bg-red-700 rounded transition-colors"
                        title="Mark as rejected"
                      >
                        <X size={16} className="text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
