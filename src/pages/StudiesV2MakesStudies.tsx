import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';

interface StudyV2 {
  id: string;
  brand: string;
  model: string;
  year: number;
  max_mileage: number;
  country_target: string;
  market_target_url: string;
  country_source: string;
  market_source_url: string;
}

export function StudiesV2MakesStudies() {
  const [studies, setStudies] = useState<StudyV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadStudies();
  }, []);

  async function loadStudies() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('studies_v2')
        .select('*')
        .order('brand', { ascending: true })
        .order('model', { ascending: true });

      if (error) throw error;
      setStudies(data || []);
    } catch (error) {
      console.error('Error loading studies:', error);
      setMessage({ type: 'error', text: 'Error loading studies' });
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').map(line => line.trim()).filter(line => line);

      if (lines.length === 0) {
        throw new Error('CSV file is empty');
      }

      function parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];

          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }

        result.push(current.trim());
        return result;
      }

      const header = parseCSVLine(lines[0]);
      const expectedColumns = [
        'ID', 'BRAND', 'MODEL', 'YEAR', 'MAX_MILEAGE',
        'COUNTRY_TARGET', 'MARKET_TARGET_URL', 'COUNTRY_SOURCE', 'MARKET_SOURCE_URL'
      ];

      if (header.length !== expectedColumns.length) {
        throw new Error(
          `Invalid CSV structure. Expected ${expectedColumns.length} columns: ${expectedColumns.join(', ')}`
        );
      }

      const newStudies: StudyV2[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = parseCSVLine(line);

        if (values.length !== expectedColumns.length) {
          throw new Error(
            `Line ${i + 1}: Invalid number of columns (expected ${expectedColumns.length}, got ${values.length})`
          );
        }

        const [id, brand, model, yearStr, maxMileageStr, countryTarget, marketTargetUrl, countrySource, marketSourceUrl] = values;

        const year = parseInt(yearStr, 10);
        const maxMileage = parseInt(maxMileageStr, 10);

        if (isNaN(year)) {
          throw new Error(`Line ${i + 1}: YEAR must be a valid number`);
        }

        if (isNaN(maxMileage)) {
          throw new Error(`Line ${i + 1}: MAX_MILEAGE must be a valid number`);
        }

        if (!id || !brand || !model || !countryTarget || !marketTargetUrl || !countrySource || !marketSourceUrl) {
          throw new Error(`Line ${i + 1}: All fields except MAX_MILEAGE must be non-empty`);
        }

        newStudies.push({
          id,
          brand,
          model,
          year,
          max_mileage: maxMileage,
          country_target: countryTarget,
          market_target_url: marketTargetUrl,
          country_source: countrySource,
          market_source_url: marketSourceUrl,
        });
      }

      if (newStudies.length === 0) {
        throw new Error('No valid studies found in CSV');
      }

      const studyIds = newStudies.map(s => s.id);
      const uniqueIds = new Set(studyIds);
      if (uniqueIds.size !== studyIds.length) {
        throw new Error('CSV contains duplicate IDs. Each study must have a unique ID.');
      }

      const { data: allExisting, error: fetchAllError } = await supabase
        .from('studies_v2')
        .select('id');

      if (fetchAllError) {
        console.error('Fetch error:', fetchAllError);
        throw new Error(`Failed to fetch existing studies: ${fetchAllError.message}`);
      }

      const existingIds = (allExisting || []).map(s => s.id);
      const idsToRemove = existingIds.filter(id => !studyIds.includes(id));

      if (idsToRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from('studies_v2')
          .delete()
          .in('id', idsToRemove);

        if (deleteError) {
          console.error('Delete error:', deleteError);
          throw new Error(`Failed to delete old studies: ${deleteError.message}`);
        }
      }

      if (existingIds.length > 0) {
        const { error: deleteAllError } = await supabase
          .from('studies_v2')
          .delete()
          .in('id', existingIds);

        if (deleteAllError) {
          console.error('Delete all error:', deleteAllError);
          throw new Error(`Failed to clear existing studies: ${deleteAllError.message}`);
        }
      }

      const { error: insertError } = await supabase
        .from('studies_v2')
        .insert(newStudies);

      if (insertError) {
        console.error('Insert error:', insertError);
        throw new Error(`Failed to insert studies: ${insertError.message}`);
      }

      setMessage({
        type: 'success',
        text: `Successfully imported ${newStudies.length} studies. All previous studies have been replaced.`
      });

      await loadStudies();
    } catch (error) {
      console.error('Error uploading CSV:', error);
      setMessage({
        type: 'error',
        text: `Error: ${(error as Error).message}`
      });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">Makes Studies</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Import studies from CSV. Upload will replace all existing studies.
          </p>
        </div>

        <label className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 cursor-pointer transition-colors">
          <Upload size={18} />
          {uploading ? 'Uploading...' : 'Import CSV'}
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg flex items-start gap-3 ${
            message.type === 'success'
              ? 'bg-emerald-900/30 border border-emerald-700/50'
              : 'bg-red-900/30 border border-red-700/50'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className={message.type === 'success' ? 'text-emerald-100' : 'text-red-100'}>
              {message.text}
            </p>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 border-b border-zinc-800">
          <h3 className="font-semibold text-zinc-100">
            Current Studies ({studies.length})
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Expected CSV format: ID, BRAND, MODEL, YEAR, MAX_MILEAGE, COUNTRY_TARGET, MARKET_TARGET_URL, COUNTRY_SOURCE, MARKET_SOURCE_URL
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-400">Loading studies...</div>
        ) : studies.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            No studies imported yet. Upload a CSV file to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Brand</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Year</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Max Mileage</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Target</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Source</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((study) => (
                  <tr key={study.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-xs font-mono text-zinc-300">{study.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{study.brand}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-zinc-300">{study.model}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-300">{study.year}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-400">
                        {study.max_mileage === 0 ? '∞' : `${study.max_mileage.toLocaleString()} km`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-blue-400">{study.country_target}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-emerald-400">{study.country_source}</div>
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
