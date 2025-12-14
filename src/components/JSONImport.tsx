import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, X } from 'lucide-react';
import { computeEstimatedMarginEur, computeScoreMc, safeParseFloat, safeParseInt } from '../lib/business-logic';

type RawListing = {
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
};

type ImportConfig = {
  marketStudyId?: string;
  sourceCountry: string;
  targetCountry: string;
  sourceSite: string;
  targetExportPrice: number;
};

type JSONImportProps = {
  onClose: () => void;
  onSuccess: () => void;
};

export function JSONImport({ onClose, onSuccess }: JSONImportProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [config, setConfig] = useState<ImportConfig>({
    sourceCountry: 'FR',
    targetCountry: 'DK',
    sourceSite: 'leboncoin',
    targetExportPrice: 15000,
  });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: string[] } | null>(null);

  async function handleImport() {
    setImporting(true);
    setResult(null);

    try {
      const rawListings: RawListing[] = JSON.parse(jsonInput);

      if (!Array.isArray(rawListings)) {
        throw new Error('JSON must be an array of listings');
      }

      const success = 0;
      const errors: string[] = [];

      for (const raw of rawListings) {
        try {
          if (!raw.url_annonce || !raw.price_eur) {
            errors.push(`Missing required fields: ${JSON.stringify(raw)}`);
            continue;
          }

          const { data: existing } = await supabase
            .from('listings')
            .select('*')
            .eq('url_annonce', raw.url_annonce)
            .maybeSingle();

          const price = safeParseFloat(raw.price_eur);
          const year = raw.year ? safeParseInt(raw.year) : null;
          const km = raw.km ? safeParseInt(raw.km) : null;

          const margin = computeEstimatedMarginEur(price, {
            targetExportPrice: config.targetExportPrice,
          });
          const score = computeScoreMc(margin);

          const now = new Date().toISOString();

          const listingData = {
            market_study_id: config.marketStudyId || null,
            source_site: config.sourceSite,
            source_country: config.sourceCountry,
            target_country: config.targetCountry,
            url_annonce: raw.url_annonce,
            brand: raw.brand || 'Unknown',
            model: raw.model || 'Unknown',
            year,
            km,
            price_eur: price,
            target_export_price_eur: config.targetExportPrice,
            estimated_margin_eur: margin,
            score_mc: score,
            last_seen_at: now,
            price_current: price,
            photos_urls: raw.photos ? (raw.photos as any) : null,
            raw_data: raw as any,
          };

          if (!existing) {
            const { error } = await supabase.from('listings').insert({
              ...listingData,
              first_seen_at: now,
              price_original: price,
              status: 'new',
              details_scraped: false,
            });

            if (error) throw error;
          } else {
            const priceVariation = price - existing.price_original;
            let newStatus = existing.status;

            if (price > existing.price_current) {
              newStatus = 'price_up';
            } else if (price < existing.price_current) {
              newStatus = 'price_down';
            } else if (newStatus === 'new') {
              newStatus = 'seen';
            }

            const firstSeen = new Date(existing.first_seen_at);
            const lastSeen = new Date(now);
            const daysOnline = Math.floor(
              (lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)
            );

            const { error } = await supabase
              .from('listings')
              .update({
                ...listingData,
                status: newStatus,
                price_variation_eur: priceVariation,
                days_online: daysOnline,
              })
              .eq('id', existing.id);

            if (error) throw error;
          }
        } catch (error) {
          errors.push(`${raw.url_annonce}: ${(error as Error).message}`);
        }
      }

      setResult({ success: rawListings.length - errors.length, errors });

      if (errors.length === 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (error) {
      setResult({ success: 0, errors: [(error as Error).message] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Import JSON Listings</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Paste JSON array of listings for testing
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Source Country</label>
              <input
                type="text"
                value={config.sourceCountry}
                onChange={(e) => setConfig({ ...config, sourceCountry: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Target Country</label>
              <input
                type="text"
                value={config.targetCountry}
                onChange={(e) => setConfig({ ...config, targetCountry: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Source Site</label>
              <input
                type="text"
                value={config.sourceSite}
                onChange={(e) => setConfig({ ...config, sourceSite: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Target Export Price (€)</label>
              <input
                type="number"
                value={config.targetExportPrice}
                onChange={(e) =>
                  setConfig({ ...config, targetExportPrice: Number(e.target.value) })
                }
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-zinc-400 mb-1 block">
              JSON Listings (array of objects)
            </label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 font-mono text-xs"
              rows={15}
              placeholder={`[\n  {\n    "url_annonce": "https://...",\n    "price_eur": 12000,\n    "brand": "Toyota",\n    "model": "RAV4",\n    "year": 2017,\n    "km": 85000\n  }\n]`}
            />
          </div>

          {result && (
            <div
              className={`p-4 rounded-lg ${
                result.errors.length === 0
                  ? 'bg-emerald-500/10 border border-emerald-500/30'
                  : 'bg-amber-500/10 border border-amber-500/30'
              }`}
            >
              <div className="font-medium text-zinc-100 mb-2">
                Import completed: {result.success} successful
                {result.errors.length > 0 && `, ${result.errors.length} errors`}
              </div>
              {result.errors.length > 0 && (
                <div className="text-xs text-zinc-400 space-y-1 max-h-40 overflow-auto">
                  {result.errors.map((err, idx) => (
                    <div key={idx}>• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleImport}
              disabled={importing || !jsonInput}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload size={18} />
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
