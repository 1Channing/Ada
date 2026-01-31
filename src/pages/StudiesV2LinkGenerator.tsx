import { useState, useEffect } from 'react';
import { Link2, Plus, Trash2, ExternalLink } from 'lucide-react';
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

  return (
    <div className="space-y-6">
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
