import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, CheckCircle, AlertCircle, X } from 'lucide-react';

type CSVImportProps = {
  onClose: () => void;
  onSuccess: () => void;
};

export function CSVImport({ onClose, onSuccess }: CSVImportProps) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; updated: number; errors: string[]; skipped: number } | null>(null);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const values = parseCSVLine(line);
          if (values.length < headers.length) {
            skipped++;
            continue;
          }

          const row: Record<string, string> = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });

          if (!row.id || !row.brand || !row.model || !row.source_marketplace || !row.source_search_url) {
            errors.push(`Row ${i}: Missing required fields`);
            continue;
          }

          const { data: existing } = await supabase
            .from('market_studies')
            .select('id')
            .eq('id', row.id)
            .maybeSingle();

          const studyData = {
            id: row.id,
            name: row.id.replace(/^MS_/, '').replace(/_/g, ' '),
            brand: row.brand,
            model_pattern: row.model,
            year_min: row.year && row.year !== 'XX' ? parseInt(row.year) : null,
            year_max: row.year && row.year !== 'XX' ? parseInt(row.year) : null,
            mileage_min: row.mileage_min ? parseInt(row.mileage_min) : null,
            mileage_max: row.mileage_max ? parseInt(row.mileage_max) : null,
            source_country: row.source_country || 'UNKNOWN',
            source_marketplace: row.source_marketplace,
            source_search_url: row.source_search_url,
            target_country: row.target_country || '',
            target_marketplace: row.target_marketplace || '',
            target_search_url: row.target_search_url || null,
            pricing_strategy: row.pricing_strategy || 'mean_5_lowest',
            last_computed_target_export_price_eur: row.last_computed_target_export_price_eur
              ? parseFloat(row.last_computed_target_export_price_eur)
              : null,
            last_computed_target_export_price_at: row.last_computed_target_export_price_at || null,
            notes: row.notes || null,
          };

          if (existing) {
            const { error } = await supabase
              .from('market_studies')
              .update(studyData)
              .eq('id', row.id);

            if (error) throw error;
            updated++;
          } else {
            const { error } = await supabase
              .from('market_studies')
              .insert(studyData);

            if (error) throw error;
            inserted++;
          }
        } catch (error) {
          errors.push(`Row ${i}: ${(error as Error).message}`);
        }
      }

      setResult({ inserted, updated, errors: errors.slice(0, 20), skipped });

      if (errors.length === 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (error) {
      setResult({ inserted: 0, updated: 0, errors: [(error as Error).message], skipped: 0 });
    } finally {
      setImporting(false);
    }
  }

  function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 max-w-2xl w-full">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Import Market Studies CSV</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Upload the market_studies.csv file from MC Export
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center">
            <Upload size={48} className="mx-auto text-zinc-500 mb-4" />
            <label className="cursor-pointer">
              <span className="text-emerald-400 hover:text-emerald-300 font-medium">
                Choose CSV file
              </span>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={importing}
                className="hidden"
              />
            </label>
            <p className="text-xs text-zinc-500 mt-2">
              Expected format: id, brand, model, year, source_country, etc.
            </p>
          </div>

          {importing && (
            <div className="mt-4 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400 mx-auto"></div>
              <p className="text-zinc-400 mt-2">Importing studies...</p>
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              {(result.inserted > 0 || result.updated > 0) && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <CheckCircle size={20} className="text-emerald-400 mt-0.5" />
                  <div>
                    <div className="font-medium text-emerald-400">
                      Import Complete
                    </div>
                    <div className="text-sm text-zinc-300 mt-1">
                      {result.inserted} inserted, {result.updated} updated
                    </div>
                    {result.skipped > 0 && (
                      <div className="text-xs text-zinc-400 mt-1">
                        {result.skipped} incomplete rows skipped
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertCircle size={20} className="text-amber-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-amber-400 mb-2">
                      {result.errors.length} errors occurred
                    </div>
                    <div className="text-xs text-zinc-400 space-y-1 max-h-40 overflow-auto">
                      {result.errors.map((err, idx) => (
                        <div key={idx}>• {err}</div>
                      ))}
                      {result.errors.length >= 20 && (
                        <div className="text-amber-400">... and more</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
