import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExternalLink, CheckCircle, RefreshCw, X } from 'lucide-react';

interface NegotiationListing {
  id: string;
  listing_url: string;
  title: string;
  price: number;
  mileage: number | null;
  year: number | null;
  trim: string | null;
  status: string;
  is_damaged: boolean;
  defects_summary: string | null;
  maintenance_summary: string | null;
  options_summary: string | null;
  entretien: string | null;
  options: string[] | null;
  study_run_results: {
    target_market_price: number | null;
    price_difference: number | null;
    studies_v2: {
      id: string;
      brand: string;
      model: string;
      year: number;
      country_target: string;
      country_source: string;
    };
  };
}

type StatusFilter = 'APPROVED' | 'COMPLETED' | 'ALL';

export function StudiesV2Negotiations() {
  const [listings, setListings] = useState<NegotiationListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('APPROVED');

  useEffect(() => {
    loadListings();
  }, [statusFilter]);

  async function loadListings() {
    try {
      setLoading(true);

      let query = supabase
        .from('study_source_listings')
        .select(`
          *,
          study_run_results (
            target_market_price,
            price_difference,
            studies_v2 (
              id,
              brand,
              model,
              year,
              country_target,
              country_source
            )
          )
        `)
        .neq('status', 'DELETED')
        .order('created_at', { ascending: false });

      if (statusFilter === 'APPROVED') {
        query = query.eq('status', 'APPROVED');
      } else if (statusFilter === 'COMPLETED') {
        query = query.eq('status', 'COMPLETED');
      } else {
        query = query.in('status', ['APPROVED', 'COMPLETED']);
      }

      const { data, error } = await query;

      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.error('Error loading negotiations:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateListingStatus(listingId: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from('study_source_listings')
        .update({ status: newStatus })
        .eq('id', listingId);

      if (error) throw error;

      await loadListings();
    } catch (error) {
      console.error('Error updating listing status:', error);
      alert(`Error updating status: ${(error as Error).message}`);
    }
  }

  async function deleteListing(listingId: string) {
    if (!confirm('Are you sure you want to delete this listing from negotiations?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('study_source_listings')
        .update({ status: 'DELETED' })
        .eq('id', listingId);

      if (error) throw error;

      await loadListings();
    } catch (error) {
      console.error('Error deleting listing:', error);
      alert(`Error deleting listing: ${(error as Error).message}`);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'APPROVED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400">In Negotiation</span>;
      case 'COMPLETED':
        return <span className="px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-400">Completed</span>;
      default:
        return <span className="px-2 py-1 rounded text-xs font-medium bg-zinc-700 text-zinc-300">{status}</span>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">Negotiations</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Track and manage approved listings in negotiation
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('APPROVED')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'APPROVED'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            In Negotiation
          </button>
          <button
            onClick={() => setStatusFilter('COMPLETED')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'COMPLETED'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Completed
          </button>
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-zinc-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            All
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">
            {statusFilter === 'APPROVED' && `Listings in Negotiation (${listings.length})`}
            {statusFilter === 'COMPLETED' && `Completed Negotiations (${listings.length})`}
            {statusFilter === 'ALL' && `All Negotiations (${listings.length})`}
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading negotiations...</div>
        ) : listings.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            {statusFilter === 'APPROVED' && 'No listings in negotiation. Approve listings from the Results tab.'}
            {statusFilter === 'COMPLETED' && 'No completed negotiations yet.'}
            {statusFilter === 'ALL' && 'No negotiations found.'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {listings.map((listing) => (
              <div key={listing.id} className="p-4 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-zinc-100">{listing.title}</h4>
                        {getStatusBadge(listing.status)}
                      </div>
                      <div className="text-sm text-zinc-400">
                        <span className="font-medium text-blue-400">
                          {listing.study_run_results.studies_v2.brand} {listing.study_run_results.studies_v2.model}
                        </span>
                        {' • '}
                        <span>{listing.study_run_results.studies_v2.year}</span>
                        {' • '}
                        <span className="text-emerald-400">{listing.study_run_results.studies_v2.country_source}</span>
                        {' → '}
                        <span className="text-blue-400">{listing.study_run_results.studies_v2.country_target}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Source Price</div>
                        <div className="font-bold text-emerald-400">{listing.price.toLocaleString()}€</div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Target Median</div>
                        <div className="font-medium text-zinc-300">
                          {listing.study_run_results.target_market_price
                            ? `${listing.study_run_results.target_market_price.toLocaleString()}€`
                            : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Opportunity</div>
                        <div className="font-medium text-emerald-400">
                          {listing.study_run_results.price_difference
                            ? `+${listing.study_run_results.price_difference.toLocaleString()}€`
                            : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Details</div>
                        <div className="text-zinc-300">
                          {listing.year && <span>{listing.year} • </span>}
                          {listing.mileage && <span>{listing.mileage.toLocaleString()} km</span>}
                        </div>
                      </div>
                    </div>

                    {(listing.defects_summary || listing.entretien || (listing.options && listing.options.length > 0)) && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2 border-t border-zinc-800">
                        {listing.defects_summary && (
                          <div>
                            <div className="text-zinc-500 font-semibold uppercase mb-1">Defects</div>
                            <div className="text-zinc-400">{listing.defects_summary}</div>
                          </div>
                        )}
                        {(listing.entretien && listing.entretien.trim()) && (
                          <div>
                            <div className="text-zinc-500 font-semibold uppercase mb-1">Entretien</div>
                            <div className="text-zinc-400">{listing.entretien}</div>
                          </div>
                        )}
                        {listing.options && Array.isArray(listing.options) && listing.options.length > 0 && (
                          <div>
                            <div className="text-zinc-500 font-semibold uppercase mb-1">Options</div>
                            <div className="text-zinc-400">{listing.options.join(', ')}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-2">
                      <a
                        href={listing.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        View Listing
                        <ExternalLink size={14} />
                      </a>

                      {listing.status === 'APPROVED' && (
                        <button
                          onClick={() => updateListingStatus(listing.id, 'COMPLETED')}
                          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <CheckCircle size={14} />
                          Mark Completed
                        </button>
                      )}

                      {listing.status === 'COMPLETED' && (
                        <button
                          onClick={() => updateListingStatus(listing.id, 'APPROVED')}
                          className="px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <RefreshCw size={14} />
                          Reopen
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => deleteListing(listing.id)}
                      className="p-2 hover:bg-red-900/30 text-zinc-500 hover:text-red-400 rounded transition-colors"
                      title="Delete from negotiations"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
