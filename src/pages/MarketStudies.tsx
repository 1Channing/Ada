import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Edit2, Trash2, Save, X, Download } from 'lucide-react';
import type { Database } from '../lib/database.types';

type MarketStudy = Database['public']['Tables']['market_studies']['Row'];
type MarketStudyInsert = Database['public']['Tables']['market_studies']['Insert'];

export function MarketStudies() {
  const [studies, setStudies] = useState<MarketStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [countryFilter, setCountryFilter] = useState<string>('ALL');
  const [formData, setFormData] = useState<Partial<MarketStudyInsert>>({
    name: '',
    brand: '',
    model_pattern: '',
    year_min: undefined,
    year_max: undefined,
    mileage_min: undefined,
    mileage_max: undefined,
    source_country: '',
    source_marketplace: '',
    source_search_url: '',
    target_country: '',
    target_marketplace: '',
    target_search_url: '',
    pricing_strategy: 'mean_5_lowest',
    notes: '',
  });

  useEffect(() => {
    loadStudies();
  }, [countryFilter]);

  async function loadStudies() {
    setLoading(true);
    try {
      let query = supabase
        .from('market_studies')
        .select('*')
        .order('brand', { ascending: true })
        .order('model_pattern', { ascending: true })
        .order('year_min', { ascending: true })
        .order('source_country', { ascending: true });

      if (countryFilter !== 'ALL') {
        query = query.eq('source_country', countryFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setStudies(data || []);
    } catch (error) {
      console.error('Error loading studies:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveStudy() {
    try {
      if (editingId) {
        // UPDATE: Only send changed fields
        const updateData = {
          name: formData.name,
          brand: formData.brand,
          model_pattern: formData.model_pattern,
          year_min: formData.year_min ?? null,
          year_max: formData.year_max ?? null,
          mileage_min: formData.mileage_min ?? null,
          mileage_max: formData.mileage_max ?? null,
          source_country: formData.source_country,
          source_marketplace: formData.source_marketplace,
          source_search_url: formData.source_search_url,
          target_country: formData.target_country,
          target_marketplace: formData.target_marketplace,
          target_search_url: formData.target_search_url ?? null,
          pricing_strategy: formData.pricing_strategy,
          notes: formData.notes ?? null,
          updated_at: new Date().toISOString(),
        };

        console.log('Updating study:', editingId, updateData);
        const { data, error } = await supabase
          .from('market_studies')
          .update(updateData)
          .eq('id', editingId)
          .select();

        if (error) {
          console.error('Update error:', error);
          throw error;
        }
        console.log('Update successful:', data);
      } else {
        // INSERT: All required fields must be present
        if (!formData.name || !formData.brand || !formData.model_pattern ||
            !formData.source_country || !formData.source_marketplace ||
            !formData.source_search_url || !formData.target_country ||
            !formData.target_marketplace) {
          throw new Error('Please fill in all required fields');
        }

        const insertData = {
          name: formData.name,
          brand: formData.brand,
          model_pattern: formData.model_pattern,
          year_min: formData.year_min ?? null,
          year_max: formData.year_max ?? null,
          mileage_min: formData.mileage_min ?? null,
          mileage_max: formData.mileage_max ?? null,
          source_country: formData.source_country,
          source_marketplace: formData.source_marketplace,
          source_search_url: formData.source_search_url,
          target_country: formData.target_country,
          target_marketplace: formData.target_marketplace,
          target_search_url: formData.target_search_url ?? null,
          pricing_strategy: formData.pricing_strategy ?? 'mean_5_lowest',
          notes: formData.notes ?? null,
        };

        console.log('Inserting new study:', insertData);
        const { data, error } = await supabase
          .from('market_studies')
          .insert([insertData])
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }
        console.log('Insert successful:', data);
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      await loadStudies();
    } catch (error) {
      console.error('Error saving study:', error);
      alert(`Error saving study: ${(error as Error).message}`);
    }
  }

  async function deleteStudy(id: string) {
    if (!confirm('Delete this market study? This will not delete associated listings.')) return;

    try {
      const { error } = await supabase
        .from('market_studies')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadStudies();
    } catch (error) {
      console.error('Error deleting study:', error);
    }
  }

  function editStudy(study: MarketStudy) {
    setFormData({
      name: study.name,
      brand: study.brand,
      model_pattern: study.model_pattern,
      year_min: study.year_min,
      year_max: study.year_max,
      mileage_min: study.mileage_min,
      mileage_max: study.mileage_max,
      source_country: study.source_country,
      source_marketplace: study.source_marketplace,
      source_search_url: study.source_search_url,
      target_country: study.target_country,
      target_marketplace: study.target_marketplace,
      target_search_url: study.target_search_url,
      pricing_strategy: study.pricing_strategy,
      notes: study.notes,
    });
    setEditingId(study.id);
    setShowForm(true);
  }

  function resetForm() {
    setFormData({
      name: '',
      brand: '',
      model_pattern: '',
      year_min: undefined,
      year_max: undefined,
      mileage_min: undefined,
      mileage_max: undefined,
      source_country: '',
      source_marketplace: '',
      source_search_url: '',
      target_country: '',
      target_marketplace: '',
      target_search_url: '',
      pricing_strategy: 'mean_5_lowest',
      notes: '',
    });
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  }

  async function exportToCSV() {
    try {
      const { data, error } = await supabase
        .from('market_studies')
        .select('*')
        .order('brand', { ascending: true })
        .order('model_pattern', { ascending: true })
        .order('year_min', { ascending: true })
        .order('source_country', { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) {
        alert('No studies to export');
        return;
      }

      const headers = [
        'id', 'brand', 'model', 'year', 'source_country', 'mileage_min', 'mileage_max',
        'source_marketplace', 'target_country', 'target_marketplace', 'target_search_url',
        'pricing_strategy', 'last_computed_target_export_price_eur',
        'last_computed_target_export_price_at', 'notes', 'source_search_url'
      ];

      const csvRows = [headers.join(',')];

      for (const study of data) {
        const year = study.year_min || 'XX';
        const row = [
          study.id,
          study.brand,
          study.model_pattern,
          year,
          study.source_country,
          study.mileage_min || '',
          study.mileage_max || '',
          study.source_marketplace,
          study.target_country,
          study.target_marketplace,
          study.target_search_url || '',
          study.pricing_strategy,
          study.last_computed_target_export_price_eur || '',
          study.last_computed_target_export_price_at || '',
          study.notes || '',
          study.source_search_url
        ].map(val => {
          const str = String(val);
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        });
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `market_studies_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      alert('Error exporting CSV. Check console for details.');
    }
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-100">Market Studies</h1>
            <p className="text-zinc-400 mt-1">Configuration: Define model patterns to monitor across markets</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <Plus size={18} />
            New Study
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-400 font-medium">Source Country:</label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-zinc-100 text-sm"
            >
              <option value="ALL">All Countries</option>
              <option value="FR">France (FR)</option>
              <option value="NL">Netherlands (NL)</option>
              <option value="DK">Denmark (DK)</option>
            </select>
            <span className="text-sm text-zinc-500">{studies.length} studies</span>
          </div>
          <button
            onClick={exportToCSV}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <h2 className="text-xl font-semibold text-zinc-100 mb-4">
            {editingId ? 'Edit Market Study' : 'New Market Study'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Study Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="e.g. Toyota RAV4 2017 FR→DK"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Brand</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="e.g. Toyota"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Model Pattern</label>
              <input
                type="text"
                value={formData.model_pattern}
                onChange={(e) => setFormData({ ...formData, model_pattern: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="e.g. RAV4"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Year Min</label>
                <input
                  type="number"
                  value={formData.year_min || ''}
                  onChange={(e) => setFormData({ ...formData, year_min: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                  placeholder="2015"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Year Max</label>
                <input
                  type="number"
                  value={formData.year_max || ''}
                  onChange={(e) => setFormData({ ...formData, year_max: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                  placeholder="2020"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Mileage Min (km)</label>
                <input
                  type="number"
                  value={formData.mileage_min || ''}
                  onChange={(e) => setFormData({ ...formData, mileage_min: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Mileage Max (km)</label>
                <input
                  type="number"
                  value={formData.mileage_max || ''}
                  onChange={(e) => setFormData({ ...formData, mileage_max: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                  placeholder="150000"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Source Country</label>
              <input
                type="text"
                value={formData.source_country}
                onChange={(e) => setFormData({ ...formData, source_country: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="FR"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Source Marketplace</label>
              <input
                type="text"
                value={formData.source_marketplace}
                onChange={(e) => setFormData({ ...formData, source_marketplace: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="leboncoin"
              />
            </div>

            <div className="col-span-2">
              <label className="text-sm text-zinc-400 mb-1 block">Source Search URL</label>
              <input
                type="text"
                value={formData.source_search_url}
                onChange={(e) => setFormData({ ...formData, source_search_url: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Target Country</label>
              <input
                type="text"
                value={formData.target_country}
                onChange={(e) => setFormData({ ...formData, target_country: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="DK"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Target Marketplace</label>
              <input
                type="text"
                value={formData.target_marketplace}
                onChange={(e) => setFormData({ ...formData, target_marketplace: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="bilbasen"
              />
            </div>

            <div className="col-span-2">
              <label className="text-sm text-zinc-400 mb-1 block">Target Search URL (optional)</label>
              <input
                type="text"
                value={formData.target_search_url || ''}
                onChange={(e) => setFormData({ ...formData, target_search_url: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Pricing Strategy</label>
              <select
                value={formData.pricing_strategy}
                onChange={(e) => setFormData({ ...formData, pricing_strategy: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              >
                <option value="mean_5_lowest">Mean of 5 Lowest</option>
                <option value="median_minus_5pct">Median - 5%</option>
                <option value="mean_all">Mean of All</option>
                <option value="median">Median</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-sm text-zinc-400 mb-1 block">Notes (optional)</label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
                placeholder="Internal notes about this study..."
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={saveStudy}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Save size={18} />
              Save
            </button>
            <button
              onClick={cancelForm}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <X size={18} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading studies...</div>
      ) : studies.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">No market studies yet. Create one to get started.</div>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-800 border-b border-zinc-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Brand</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Model</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Year</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Source Country</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Target</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Mileage Range</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Marketplace</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((study) => (
                <tr key={study.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{study.brand}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-300">{study.model_pattern}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-zinc-300">
                      {study.year_min || '?'} - {study.year_max || '?'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-emerald-400">{study.source_country}</div>
                    <div className="text-xs text-zinc-500">{study.source_marketplace}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-blue-400">{study.target_country}</div>
                    <div className="text-xs text-zinc-500">{study.target_marketplace}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-zinc-400">
                      {(() => {
                        const min = study.mileage_min || 0;
                        const max = study.mileage_max || 0;

                        if (min === 0 && max === 0) return '0 - ∞ km';
                        if (min === 0 && max > 0) return `0 - ${max.toLocaleString()} km`;
                        if (min > 0 && max === 0) return `${min.toLocaleString()} - ∞ km`;
                        return `${min.toLocaleString()} - ${max.toLocaleString()} km`;
                      })()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-zinc-300">{study.source_marketplace}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editStudy(study)}
                        className="p-1.5 hover:bg-zinc-700 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={16} className="text-zinc-400" />
                      </button>
                      <button
                        onClick={() => deleteStudy(study.id)}
                        className="p-1.5 hover:bg-red-700 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} className="text-red-400" />
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
