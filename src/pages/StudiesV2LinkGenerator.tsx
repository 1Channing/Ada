import { useState, useEffect, useCallback, useRef } from 'react';
import { Link2, Plus, Trash2, ExternalLink, Play, BarChart3, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const BRAND_MODELS: Record<string, string[]> = {
  'Mercedes-Benz': ['A-Klasse', 'B-Klasse', 'C-Klasse', 'CLA', 'CLS', 'E-Klasse', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Klasse', 'V-Klasse'],
  'BMW': ['1 Serie', '2 Serie', '3 Serie', '4 Serie', '5 Serie', '6 Serie', '7 Serie', '8 Serie', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4'],
  'Audi': ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
  'Volkswagen': ['Polo', 'Golf', 'Passat', 'Tiguan', 'Touareg', 'T-Roc', 'T-Cross', 'Arteon', 'ID.3', 'ID.4'],
  'Tesla': ['Model 3', 'Model S', 'Model X', 'Model Y'],
  'Porsche': ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  'Volvo': ['V40', 'V60', 'V90', 'XC40', 'XC60', 'XC90'],
  'Toyota': ['Yaris', 'Corolla', 'Camry', 'RAV4', 'Highlander', 'Land Cruiser'],
  'Honda': ['Civic', 'Accord', 'CR-V', 'HR-V'],
  'Ford': ['Fiesta', 'Focus', 'Mondeo', 'Kuga', 'Puma', 'Mustang'],
  'Renault': ['Clio', 'Megane', 'Captur', 'Kadjar', 'Scenic'],
  'Peugeot': ['208', '308', '508', '2008', '3008', '5008'],
  'Citroën': ['C3', 'C4', 'C5', 'Berlingo'],
  'Opel': ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Grandland'],
  'Nissan': ['Micra', 'Qashqai', 'X-Trail', 'Juke', 'Leaf'],
  'Mazda': ['2', '3', '6', 'CX-3', 'CX-5', 'CX-30', 'MX-5'],
  'Hyundai': ['i10', 'i20', 'i30', 'Kona', 'Tucson', 'Santa Fe', 'IONIQ'],
  'Kia': ['Picanto', 'Rio', 'Ceed', 'Sportage', 'Sorento', 'Niro', 'EV6'],
  'Skoda': ['Fabia', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq'],
  'SEAT': ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco'],
};

const MARKETPLACE_CONFIGS = {
  marktplaats: {
    name: 'Marktplaats (NL)',
    baseUrl: 'https://www.marktplaats.nl/l/auto-s/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const params = new URLSearchParams({
        query: `${brand} ${models.join(' OR ')}`,
        PriceCentsFrom: '0',
        attributes: `MileageRange:[0,${kmMax}]|YearRange:[${yearMin},${yearMax}]`,
      });
      return `https://www.marktplaats.nl/l/auto-s/?${params.toString()}`;
    }
  },
  autoscout24_de: {
    name: 'AutoScout24 (DE)',
    baseUrl: 'https://www.autoscout24.de/lst/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-');
      const modelParams = models.map(m => `&mmv=${encodeURIComponent(`${brand}|${m}`)}`).join('');
      return `https://www.autoscout24.de/lst/${brandSlug}?fregfrom=${yearMin}&fregto=${yearMax}&kmto=${kmMax}${modelParams}`;
    }
  },
  autoscout24_nl: {
    name: 'AutoScout24 (NL)',
    baseUrl: 'https://www.autoscout24.nl/lst/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-');
      const modelParams = models.map(m => `&mmv=${encodeURIComponent(`${brand}|${m}`)}`).join('');
      return `https://www.autoscout24.nl/lst/${brandSlug}?fregfrom=${yearMin}&fregto=${yearMax}&kmto=${kmMax}${modelParams}`;
    }
  },
  leboncoin: {
    name: 'Leboncoin (FR)',
    baseUrl: 'https://www.leboncoin.fr/recherche',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const params = new URLSearchParams({
        category: '2',
        text: `${brand} ${models.join(' ')}`,
        regdate_min: yearMin.toString(),
        regdate_max: yearMax.toString(),
        mileage_max: kmMax.toString(),
      });
      return `https://www.leboncoin.fr/recherche?${params.toString()}`;
    }
  },
  lacentrale: {
    name: 'LaCentrale (FR)',
    baseUrl: 'https://www.lacentrale.fr/listing',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-');
      return `https://www.lacentrale.fr/listing?makesModelsCommercialNames=${brand}:${models.join(',')}&yearMin=${yearMin}&yearMax=${yearMax}&mileageMax=${kmMax}`;
    }
  },
  mobile_de: {
    name: 'Mobile.de (DE)',
    baseUrl: 'https://www.mobile.de/auto/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-');
      const modelSlugs = models.map(m => m.toLowerCase().replace(/\s+/g, '-')).join(',');
      return `https://www.mobile.de/auto/${brandSlug}/${modelSlugs}?fn=${yearMin}&fx=${yearMax}&ml=${kmMax}`;
    }
  },
  bilbasen: {
    name: 'Bilbasen (DK)',
    baseUrl: 'https://www.bilbasen.dk/brugt/bil/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-');
      return `https://www.bilbasen.dk/brugt/bil/${brandSlug}?YearFrom=${yearMin}&YearTo=${yearMax}&MileageFrom=0&MileageTo=${kmMax}`;
    }
  },
  gaspedaal: {
    name: 'Gaspedaal (NL)',
    baseUrl: 'https://www.gaspedaal.nl/',
    buildUrl: (brand: string, models: string[], yearMin: number, yearMax: number, kmMax: number) => {
      const params = new URLSearchParams({
        merk: brand,
        bouwjaar_van: yearMin.toString(),
        bouwjaar_tot: yearMax.toString(),
        km_tot: kmMax.toString(),
      });
      return `https://www.gaspedaal.nl/occasions?${params.toString()}`;
    }
  },
};

export function StudiesV2LinkGenerator() {
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<number>(2018);
  const [yearMax, setYearMax] = useState<number>(new Date().getFullYear());
  const [kmMax, setKmMax] = useState<number>(150000);
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [mappingSeedUrl, setMappingSeedUrl] = useState<string>('');
  const [mappingRunId, setMappingRunId] = useState<string | null>(null);
  const [mappingStatus, setMappingStatus] = useState<string>('idle');
  const [mappingStats, setMappingStats] = useState<any>(null);
  const [showMappingStats, setShowMappingStats] = useState<boolean>(false);
  const [mappingError, setMappingError] = useState<string>('');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('linkgen_stats');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setSelectedBrand(data.brand || '');
        setSelectedModels(data.models || []);
        setYearMin(data.yearMin || 2018);
        setYearMax(data.yearMax || new Date().getFullYear());
        setKmMax(data.kmMax || 150000);
      } catch (err) {
        console.error('Failed to load saved data:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedBrand) {
      localStorage.setItem('linkgen_stats', JSON.stringify({
        brand: selectedBrand,
        models: selectedModels,
        yearMin,
        yearMax,
        kmMax,
      }));
    }
  }, [selectedBrand, selectedModels, yearMin, yearMax, kmMax]);

  const handleBrandChange = (brand: string) => {
    setSelectedBrand(brand);
    setSelectedModels([]);
    setGeneratedLinks({});
  };

  const handleModelToggle = (model: string) => {
    setSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
    setGeneratedLinks({});
  };

  const generateLinks = () => {
    if (!selectedBrand || selectedModels.length === 0) return;

    const links: Record<string, string> = {};
    Object.entries(MARKETPLACE_CONFIGS).forEach(([key, config]) => {
      links[key] = config.buildUrl(selectedBrand, selectedModels, yearMin, yearMax, kmMax);
    });

    setGeneratedLinks(links);
  };

  const saveDefinition = async () => {
    if (!selectedBrand || selectedModels.length === 0 || Object.keys(generatedLinks).length === 0) {
      setErrorMessage('Please generate links before saving');
      setSaveState('error');
      return;
    }

    setSaveState('saving');
    setErrorMessage('');

    try {
      const { error } = await supabase
        .from('market_study_definitions')
        .insert({
          brand: selectedBrand,
          models: selectedModels,
          year_min: yearMin,
          year_max: yearMax,
          km_max: kmMax,
          generated_links: generatedLinks,
        });

      if (error) throw error;

      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 3000);
    } catch (err) {
      console.error('Failed to save definition:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save definition');
      setSaveState('error');
    }
  };

  const availableModels = selectedBrand ? BRAND_MODELS[selectedBrand] || [] : [];

  const startMappingCrawl = async () => {
    if (!mappingSeedUrl.trim()) {
      setMappingError('Please enter a seed listing URL');
      return;
    }

    if (!mappingSeedUrl.includes('marktplaats.nl')) {
      setMappingError('URL must be from marktplaats.nl');
      return;
    }

    setMappingError('');
    setMappingStatus('starting');

    try {
      const workerUrl = import.meta.env.VITE_WORKER_URL || 'http://localhost:3001';
      const workerSecret = import.meta.env.VITE_WORKER_SECRET || '';

      const response = await fetch(`${workerUrl}/linkgen/mapping-auto/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          marketplace: 'MARKTPLAATS',
          seed_listing_url: mappingSeedUrl,
          steps: 100,
        }),
      });

      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error('[LINKGEN_AUTO] Failed to parse response:', text);
        throw new Error('Invalid server response (not JSON)');
      }

      if (!response.ok) {
        throw new Error(data?.error || `Server error: ${response.status}`);
      }

      if (!data?.runId) {
        throw new Error('Server did not return a valid run ID');
      }

      setMappingRunId(data.runId);
      setMappingStatus('running');
      startPolling(data.runId);
    } catch (error) {
      console.error('[LINKGEN_AUTO] Start error:', error);
      setMappingError(error instanceof Error ? error.message : 'Failed to start crawl');
      setMappingStatus('error');
    }
  };

  const fetchMappingStats = useCallback(async (runId: string) => {
    try {
      const workerUrl = import.meta.env.VITE_WORKER_URL || 'http://localhost:3001';
      const workerSecret = import.meta.env.VITE_WORKER_SECRET || '';

      const response = await fetch(`${workerUrl}/linkgen/mapping-auto/stats?runId=${runId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${workerSecret}`,
        },
      });

      const text = await response.text();
      let stats = null;
      try {
        stats = JSON.parse(text);
      } catch (parseError) {
        console.error('[LINKGEN_AUTO] Failed to parse stats response:', text);
        return;
      }

      if (!response.ok) {
        console.error('[LINKGEN_AUTO] Stats request failed:', stats?.error || response.status);
        return;
      }

      if (!stats?.run) {
        console.error('[LINKGEN_AUTO] Invalid stats response format');
        return;
      }

      setMappingStats(stats);
      setMappingStatus(stats.run.status);

      if (stats.run.status === 'completed' || stats.run.status === 'failed') {
        stopPolling();
      }
    } catch (error) {
      console.error('[LINKGEN_AUTO] Stats error:', error);
    }
  }, []);

  const startPolling = (runId: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    fetchMappingStats(runId);

    pollingIntervalRef.current = setInterval(() => {
      fetchMappingStats(runId);
    }, 5000);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const toggleStatsPanel = () => {
    setShowMappingStats(!showMappingStats);
    if (!showMappingStats && mappingRunId) {
      fetchMappingStats(mappingRunId);
    }
  };

  const copyMappingSuggestions = () => {
    if (!mappingStats?.mappingCandidates) return;

    const json = JSON.stringify(mappingStats.mappingCandidates, null, 2);
    navigator.clipboard.writeText(json);
    console.log('Mapping suggestions copied to clipboard');
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 rounded-lg shadow-sm border border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-6 h-6 text-green-400" />
          <h2 className="text-2xl font-bold text-white">Mapping Auto</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Seed Listing URL (Marktplaats)
            </label>
            <input
              type="text"
              value={mappingSeedUrl}
              onChange={(e) => setMappingSeedUrl(e.target.value)}
              placeholder="https://www.marktplaats.nl/a/..."
              className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-green-500"
              disabled={mappingStatus === 'running' || mappingStatus === 'starting'}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={startMappingCrawl}
              disabled={mappingStatus === 'running' || mappingStatus === 'starting' || !mappingSeedUrl.trim()}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {mappingStatus === 'starting' || mappingStatus === 'running' ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start (100)
                </>
              )}
            </button>

            <button
              onClick={toggleStatsPanel}
              disabled={!mappingRunId}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <BarChart3 className="w-5 h-5" />
              {showMappingStats ? 'Hide Stats' : 'Stats'}
            </button>
          </div>

          {mappingError && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-sm text-red-200">
              {mappingError}
            </div>
          )}

          {mappingStats?.run && (
            <div className="p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-400">Status</div>
                  <div className={`font-medium ${
                    mappingStats.run.status === 'completed' ? 'text-green-400' :
                    mappingStats.run.status === 'failed' ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                    {mappingStats.run.status}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Steps</div>
                  <div className="font-medium text-white">
                    {mappingStats.run.stepsDone} / {mappingStats.run.targetSteps}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Samples</div>
                  <div className="font-medium text-white">{mappingStats.run.insertedSamples}</div>
                </div>
                <div>
                  <div className="text-gray-400">Errors</div>
                  <div className="font-medium text-white">{mappingStats.run.errorsCount}</div>
                </div>
              </div>

              {mappingStats.run.lastError && (
                <div className="mt-3 p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-200">
                  {mappingStats.run.lastError}
                </div>
              )}
            </div>
          )}

          {showMappingStats && mappingStats && (
            <div className="space-y-4 p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Last 20 Samples</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {mappingStats.lastSamples?.map((sample: any, idx: number) => (
                    <div key={idx} className="p-3 bg-gray-900 rounded border border-gray-700">
                      <div className="text-sm text-gray-300 truncate mb-1">{sample.listing_url}</div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                        {sample.brand && <span>Brand: {sample.brand}</span>}
                        {sample.model && <span>Model: {sample.model}</span>}
                        {sample.price_eur && <span>€{sample.price_eur}</span>}
                        {sample.year && <span>{sample.year}</span>}
                        {sample.mileage && <span>{sample.mileage.toLocaleString()} km</span>}
                        <span className="text-gray-500">Step {sample.step_index}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Top 20 Brand-Model Combinations</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {mappingStats.topBrandModels?.map((item: any, idx: number) => (
                    <div key={idx} className="p-2 bg-gray-900 rounded border border-gray-700 text-sm">
                      <div className="text-white">{item.brand} {item.model}</div>
                      <div className="text-gray-400 text-xs">{item.count} samples</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">Mapping Candidates (Top 50)</h3>
                  <button
                    onClick={copyMappingSuggestions}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copy JSON
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {mappingStats.mappingCandidates?.map((candidate: any, idx: number) => (
                    <div key={idx} className="p-3 bg-gray-900 rounded border border-gray-700">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {candidate.brand && (
                          <div>
                            <span className="text-gray-400">Brand:</span>
                            <span className="text-white ml-2">{candidate.brand}</span>
                          </div>
                        )}
                        {candidate.model && (
                          <div>
                            <span className="text-gray-400">Model:</span>
                            <span className="text-white ml-2">{candidate.model}</span>
                          </div>
                        )}
                        {candidate.brand_id && (
                          <div>
                            <span className="text-gray-400">Brand ID:</span>
                            <span className="text-white ml-2">{candidate.brand_id}</span>
                          </div>
                        )}
                        {candidate.model_slug && (
                          <div>
                            <span className="text-gray-400">Model Slug:</span>
                            <span className="text-white ml-2">{candidate.model_slug}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-400">Occurrences:</span>
                          <span className="text-white ml-2">{candidate.occurrences}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-sm text-gray-400">
                Total visited URLs: {mappingStats.totalVisited}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Link2 className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Marketplace Link Generator</h2>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Brand
            </label>
            <select
              value={selectedBrand}
              onChange={(e) => handleBrandChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a brand...</option>
              {Object.keys(BRAND_MODELS).sort().map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>

          {selectedBrand && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Models ({selectedModels.length} selected)
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-4 border border-gray-200 rounded-lg bg-gray-50 max-h-64 overflow-y-auto">
                {availableModels.map((model) => (
                  <label
                    key={model}
                    className="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(model)}
                      onChange={() => handleModelToggle(model)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{model}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Year Min
              </label>
              <input
                type="number"
                value={yearMin}
                onChange={(e) => setYearMin(parseInt(e.target.value) || 2018)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1990"
                max={yearMax}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Year Max
              </label>
              <input
                type="number"
                value={yearMax}
                onChange={(e) => setYearMax(parseInt(e.target.value) || new Date().getFullYear())}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min={yearMin}
                max={new Date().getFullYear()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Kilometers
              </label>
              <input
                type="number"
                value={kmMax}
                onChange={(e) => setKmMax(parseInt(e.target.value) || 150000)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="0"
                step="10000"
              />
            </div>
          </div>

          <button
            onClick={generateLinks}
            disabled={!selectedBrand || selectedModels.length === 0}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Generate Marketplace Links
          </button>
        </div>
      </div>

      {Object.keys(generatedLinks).length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Generated Links</h3>
          <div className="space-y-3">
            {Object.entries(generatedLinks).map(([key, url]) => (
              <div key={key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {MARKETPLACE_CONFIGS[key as keyof typeof MARKETPLACE_CONFIGS].name}
                  </div>
                  <div className="text-xs text-gray-500 break-all">{url}</div>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Open link"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <button
              onClick={saveDefinition}
              disabled={saveState === 'saving'}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {saveState === 'saving' ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : saveState === 'saved' ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved Successfully
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  Launch Analysis
                </>
              )}
            </button>

            {saveState === 'error' && errorMessage && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
