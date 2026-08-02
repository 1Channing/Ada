import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Save, X } from 'lucide-react';
import type { Database } from '../lib/database.types';

type SearchQuery = Database['public']['Tables']['search_queries']['Row'];
type SearchQueryInsert = Database['public']['Tables']['search_queries']['Insert'];

export function SearchQueries() {
  const [queries, setQueries] = useState<SearchQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<SearchQueryInsert>>({
    date_recherche: new Date().toISOString().split('T')[0],
    source_country: '',
    target_country: '',
    source_marketplace: '',
    source_search_url: '',
    modele: '',
    type_recherche: 'etude',
    commentaire: '',
  });

  useEffect(() => {
    loadQueries();
  }, []);

  async function loadQueries() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('search_queries')
        .select('*')
        .order('date_recherche', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setQueries(data || []);
    } catch (error) {
      console.error('Error loading queries:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveQuery() {
    try {
      const { error } = await supabase
        .from('search_queries')
        .insert([formData as SearchQueryInsert]);

      if (error) throw error;

      setShowForm(false);
      resetForm();
      loadQueries();
    } catch (error) {
      console.error('Error saving query:', error);
      alert('Error saving query. Check console for details.');
    }
  }

  async function deleteQuery(id: string) {
    if (!confirm('Delete this search query?')) return;

    try {
      const { error } = await supabase
        .from('search_queries')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadQueries();
    } catch (error) {
      console.error('Error deleting query:', error);
    }
  }

  function resetForm() {
    setFormData({
      date_recherche: new Date().toISOString().split('T')[0],
      source_country: '',
      target_country: '',
      source_marketplace: '',
      source_search_url: '',
      modele: '',
      type_recherche: 'etude',
      commentaire: '',
    });
  }

  function cancelForm() {
    setShowForm(false);
    resetForm();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Search Queries</h1>
          <p className="text-slate-600 mt-1">Ad-hoc and daily searches on source markets</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          New Search
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 mb-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">New Search Query</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Date</label>
              <input
                type="date"
                value={formData.date_recherche}
                onChange={(e) => setFormData({ ...formData, date_recherche: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Model</label>
              <input
                type="text"
                value={formData.modele}
                onChange={(e) => setFormData({ ...formData, modele: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                placeholder="e.g. Toyota RAV4"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Source Country</label>
              <input
                type="text"
                value={formData.source_country}
                onChange={(e) => setFormData({ ...formData, source_country: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                placeholder="FR"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Target Country</label>
              <input
                type="text"
                value={formData.target_country}
                onChange={(e) => setFormData({ ...formData, target_country: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                placeholder="DK"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Source Marketplace</label>
              <input
                type="text"
                value={formData.source_marketplace}
                onChange={(e) => setFormData({ ...formData, source_marketplace: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                placeholder="leboncoin"
              />
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Search Type</label>
              <select
                value={formData.type_recherche}
                onChange={(e) => setFormData({ ...formData, type_recherche: e.target.value as any })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
              >
                <option value="etude">Etude</option>
                <option value="manuel">Manuel</option>
                <option value="test">Test</option>
                <option value="veille">Veille</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-sm text-slate-600 mb-1 block">Search URL</label>
              <input
                type="text"
                value={formData.source_search_url}
                onChange={(e) => setFormData({ ...formData, source_search_url: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                placeholder="https://..."
              />
            </div>

            <div className="col-span-2">
              <label className="text-sm text-slate-600 mb-1 block">Comment (optional)</label>
              <textarea
                value={formData.commentaire || ''}
                onChange={(e) => setFormData({ ...formData, commentaire: e.target.value })}
                className="w-full bg-slate-200 border border-slate-300 rounded px-3 py-2 text-slate-900"
                rows={3}
                placeholder="Any notes or comments..."
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={saveQuery}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Save size={18} />
              Save
            </button>
            <button
              onClick={cancelForm}
              className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <X size={18} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-600">Loading queries...</div>
      ) : queries.length === 0 ? (
        <div className="text-center py-12 text-slate-600">No search queries yet. Create one to get started.</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden max-md:overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-200 border-b border-slate-300">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Model</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Route</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Marketplace</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Comment</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((query) => (
                <tr key={query.id} className="border-b border-slate-200 hover:bg-slate-100 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-slate-900">
                      {new Date(query.date_recherche).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{query.modele}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-700">
                      {query.source_country} → {query.target_country}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-700">{query.source_marketplace}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700">
                      {query.type_recherche}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-600 max-w-xs truncate">
                      {query.commentaire || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteQuery(query.id)}
                      className="p-1.5 hover:bg-red-700 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} className="text-red-600" />
                    </button>
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
