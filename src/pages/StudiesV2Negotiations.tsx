import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExternalLink, CheckCircle, RefreshCw, X, MessageSquare, DollarSign } from 'lucide-react';

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
  assigned_to?: string | null;
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

interface NegotiationNote {
  id: string;
  author: string;
  note: string;
  created_at: string;
}

type AssigneeFilter = 'all' | 'channing' | 'antoine';
type Author = 'channing' | 'antoine';

export function StudiesV2Negotiations() {
  const [listings, setListings] = useState<NegotiationListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all');
  const [notes, setNotes] = useState<Record<string, NegotiationNote[]>>({});
  const [newNotes, setNewNotes] = useState<Record<string, string>>({});
  const [noteAuthors, setNoteAuthors] = useState<Record<string, Author>>({});
  const [lastSelectedAuthor, setLastSelectedAuthor] = useState<Author>('channing');
  const [showSoldForm, setShowSoldForm] = useState<Record<string, boolean>>({});
  const [saleFormData, setSaleFormData] = useState<Record<string, { buyPrice: string; salePrice: string; soldBy: Author }>>({});

  useEffect(() => {
    loadListings();
  }, [assigneeFilter]);

  useEffect(() => {
    if (listings.length > 0) {
      listings.forEach((listing) => {
        loadNotes(listing.id);
        if (!noteAuthors[listing.id]) {
          setNoteAuthors((prev) => ({
            ...prev,
            [listing.id]: listing.assigned_to as Author || lastSelectedAuthor,
          }));
        }
        if (!saleFormData[listing.id]) {
          setSaleFormData((prev) => ({
            ...prev,
            [listing.id]: {
              buyPrice: '',
              salePrice: '',
              soldBy: listing.assigned_to as Author || lastSelectedAuthor,
            },
          }));
        }
      });
    }
  }, [listings]);

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
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });

      if (assigneeFilter !== 'all') {
        query = query.eq('assigned_to', assigneeFilter);
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
    }
  }

  async function loadNotes(listingId: string) {
    try {
      const { data, error } = await supabase
        .from('negotiation_notes')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setNotes((prev) => ({
        ...prev,
        [listingId]: data || [],
      }));
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  }

  async function addNote(listingId: string) {
    const noteText = newNotes[listingId]?.trim();
    if (!noteText) return;

    const author = noteAuthors[listingId];

    try {
      const { error } = await supabase
        .from('negotiation_notes')
        .insert({
          listing_id: listingId,
          author,
          note: noteText,
        });

      if (error) throw error;

      setNewNotes((prev) => ({
        ...prev,
        [listingId]: '',
      }));

      setLastSelectedAuthor(author);

      await loadNotes(listingId);
    } catch (error) {
      console.error('Error adding note:', error);
    }
  }

  async function markAsSold(listingId: string) {
    const formData = saleFormData[listingId];
    if (!formData) return;

    const buyPrice = parseFloat(formData.buyPrice);
    const salePrice = parseFloat(formData.salePrice);

    if (isNaN(buyPrice) || isNaN(salePrice) || buyPrice <= 0 || salePrice <= 0) {
      alert('Please enter valid prices');
      return;
    }

    try {
      const { error: salesError } = await supabase.from('sales').insert({
        listing_id: listingId,
        sold_by: formData.soldBy,
        buy_price: buyPrice,
        sale_price: salePrice,
      });

      if (salesError) throw salesError;

      const { error: statusError } = await supabase
        .from('study_source_listings')
        .update({ status: 'SOLD' })
        .eq('id', listingId);

      if (statusError) throw statusError;

      setShowSoldForm((prev) => ({
        ...prev,
        [listingId]: false,
      }));

      await loadListings();
    } catch (error) {
      console.error('Error marking as sold:', error);
      alert('Failed to mark as sold. The vehicle may already be sold.');
    }
  }

  function toggleSoldForm(listingId: string) {
    setShowSoldForm((prev) => ({
      ...prev,
      [listingId]: !prev[listingId],
    }));
  }

  function updateSaleFormData(listingId: string, field: 'buyPrice' | 'salePrice' | 'soldBy', value: string | Author) {
    setSaleFormData((prev) => ({
      ...prev,
      [listingId]: {
        ...prev[listingId],
        [field]: value,
      },
    }));
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
            onClick={() => setAssigneeFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              assigneeFilter === 'all'
                ? 'bg-zinc-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setAssigneeFilter('channing')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              assigneeFilter === 'channing'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Channing
          </button>
          <button
            onClick={() => setAssigneeFilter('antoine')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              assigneeFilter === 'antoine'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Antoine
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">
            {assigneeFilter === 'all' && `All Negotiations (${listings.length})`}
            {assigneeFilter === 'channing' && `Channing's Negotiations (${listings.length})`}
            {assigneeFilter === 'antoine' && `Antoine's Negotiations (${listings.length})`}
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading negotiations...</div>
        ) : listings.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            {assigneeFilter === 'all' && 'No approved listings yet. Approve listings from the Results tab.'}
            {assigneeFilter === 'channing' && 'No listings assigned to Channing yet.'}
            {assigneeFilter === 'antoine' && 'No listings assigned to Antoine yet.'}
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
                        {listing.assigned_to && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-900/30 text-blue-400">
                            {listing.assigned_to === 'channing' ? 'Channing' : 'Antoine'}
                          </span>
                        )}
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

                    <div className="pt-3 border-t border-zinc-800">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare size={16} className="text-zinc-500" />
                        <h5 className="text-sm font-semibold text-zinc-300">Call Notes</h5>
                      </div>

                      {notes[listing.id] && notes[listing.id].length > 0 && (
                        <div className="space-y-2 mb-3">
                          {notes[listing.id].map((note) => {
                            const date = new Date(note.created_at);
                            const formatted = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                            return (
                              <div key={note.id} className="text-xs text-zinc-400 bg-zinc-800/50 p-2 rounded">
                                <span className="text-zinc-500">{formatted}</span>
                                {' — '}
                                <span className="text-blue-400 font-medium">
                                  {note.author === 'channing' ? 'Channing' : 'Antoine'}:
                                </span>
                                {' '}
                                {note.note}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <select
                          value={noteAuthors[listing.id] || 'channing'}
                          onChange={(e) => {
                            const author = e.target.value as Author;
                            setNoteAuthors((prev) => ({
                              ...prev,
                              [listing.id]: author,
                            }));
                            setLastSelectedAuthor(author);
                          }}
                          className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300"
                        >
                          <option value="channing">Channing</option>
                          <option value="antoine">Antoine</option>
                        </select>
                        <textarea
                          value={newNotes[listing.id] || ''}
                          onChange={(e) =>
                            setNewNotes((prev) => ({
                              ...prev,
                              [listing.id]: e.target.value,
                            }))
                          }
                          placeholder="Add a note..."
                          className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 resize-none"
                          rows={2}
                        />
                        <button
                          onClick={() => addNote(listing.id)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {showSoldForm[listing.id] && (
                      <div className="pt-3 border-t border-zinc-800">
                        <div className="flex items-center gap-2 mb-3">
                          <DollarSign size={16} className="text-emerald-500" />
                          <h5 className="text-sm font-semibold text-zinc-300">Mark as Sold</h5>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Buy Price (€)</label>
                            <input
                              type="number"
                              value={saleFormData[listing.id]?.buyPrice || ''}
                              onChange={(e) => updateSaleFormData(listing.id, 'buyPrice', e.target.value)}
                              placeholder="10000"
                              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Sale Price (€)</label>
                            <input
                              type="number"
                              value={saleFormData[listing.id]?.salePrice || ''}
                              onChange={(e) => updateSaleFormData(listing.id, 'salePrice', e.target.value)}
                              placeholder="15000"
                              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Sold By</label>
                            <select
                              value={saleFormData[listing.id]?.soldBy || 'channing'}
                              onChange={(e) => updateSaleFormData(listing.id, 'soldBy', e.target.value as Author)}
                              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-300"
                            >
                              <option value="channing">Channing</option>
                              <option value="antoine">Antoine</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => markAsSold(listing.id)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm transition-colors"
                          >
                            Confirm Sale
                          </button>
                          <button
                            onClick={() => toggleSoldForm(listing.id)}
                            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
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
                        <>
                          <button
                            onClick={() => toggleSoldForm(listing.id)}
                            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                          >
                            <DollarSign size={14} />
                            Mark as Sold
                          </button>
                          <button
                            onClick={() => updateListingStatus(listing.id, 'COMPLETED')}
                            className="px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
                          >
                            <CheckCircle size={14} />
                            Mark Completed
                          </button>
                        </>
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
