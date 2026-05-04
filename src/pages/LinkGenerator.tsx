import { useState } from 'react';
import {
  Link2,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Check,
  Zap,
  Clock,
} from 'lucide-react';
import { generateSearchUrl } from '../lib/linkgen/generator';
import type { LinkGenParams, LinkGenResult, SiteKey } from '../lib/linkgen/types';

const FUEL_OPTIONS: { label: string; value: string }[] = [
  { label: 'Essence / Petrol', value: 'ESSENCE' },
  { label: 'Diesel', value: 'DIESEL' },
  { label: 'Hybride / Hybrid', value: 'HYBRIDE' },
  { label: 'Électrique / Electric', value: 'ELECTRIQUE' },
  { label: 'GPL', value: 'GPL' },
];

const SITE_OPTIONS: { label: string; value: SiteKey; flag: string }[] = [
  { label: 'Leboncoin', value: 'LEBONCOIN', flag: '🇫🇷' },
  { label: 'Marktplaats', value: 'MARKTPLAATS', flag: '🇳🇱' },
];

interface HistoryEntry {
  result: LinkGenResult;
  params: LinkGenParams;
  timestamp: Date;
}

export function LinkGenerator() {
  const [site, setSite] = useState<SiteKey>('MARKTPLAATS');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState('');
  const [trim, setTrim] = useState('');

  const [result, setResult] = useState<LinkGenResult | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const handleGenerate = () => {
    const params: LinkGenParams = {
      site,
      brand: brand.trim(),
      model: model.trim(),
      year: year.trim() || undefined,
      mileage: mileage.trim() || undefined,
      fuel: fuel || undefined,
      trim: trim.trim() || undefined,
    };

    const generated = generateSearchUrl(params);
    setResult(generated);
    setDebugOpen(false);

    setHistory((prev) => [
      { result: generated, params, timestamp: new Date() },
      ...prev.slice(0, 4),
    ]);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpen = () => {
    if (!result) return;
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const isFormValid = brand.trim().length > 0 && model.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-600/10 rounded-lg border border-blue-600/20">
          <Link2 className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Link Generator</h1>
          <p className="text-sm text-zinc-500">
            Generate marketplace search URLs dynamically
          </p>
        </div>
      </div>

      {/* Form card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
        {/* Site selector */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
            Marketplace
          </label>
          <div className="flex gap-2">
            {SITE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSite(opt.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  site === opt.value
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                }`}
              >
                <span>{opt.flag}</span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Brand & Model */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Brand <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="ex: TOYOTA"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Model <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="ex: RAV4"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Year & Mileage */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Year (from)
            </label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="ex: 2020"
              min="1990"
              max="2030"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Max Mileage (km)
            </label>
            <input
              type="number"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="ex: 100000"
              min="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Fuel & Trim */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Fuel
            </label>
            <select
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
            >
              <option value="">— Optional —</option>
              {FUEL_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">
              Trim / Version
            </label>
            <input
              type="text"
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              placeholder="ex: GR SPORT"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!isFormValid}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isFormValid
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
        >
          <Zap className="w-4 h-4" />
          Generate URL
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Generated URL
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleOpen}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </button>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <code className="text-xs text-blue-300 break-all leading-relaxed font-mono">
              {result.url}
            </code>
          </div>

          {/* Debug panel */}
          <div>
            <button
              onClick={() => setDebugOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {debugOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Debug logs
            </button>

            {debugOpen && (
              <div className="mt-3 space-y-3">
                {result.debugLogs.map((log, i) => {
                  const color =
                    log.level === 'INPUT'
                      ? 'text-amber-400'
                      : log.level === 'MAPPING'
                      ? 'text-cyan-400'
                      : 'text-green-400';
                  return (
                    <div
                      key={i}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2"
                    >
                      <p className={`text-xs font-mono font-semibold ${color}`}>
                        {log.message}
                      </p>
                      {log.data && (
                        <table className="w-full text-xs font-mono">
                          <tbody>
                            {Object.entries(log.data).map(([k, v]) => (
                              <tr key={k}>
                                <td className="text-zinc-500 pr-4 py-0.5 align-top whitespace-nowrap">
                                  {k}
                                </td>
                                <td className="text-zinc-300 py-0.5 break-all">
                                  {String(v)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session history */}
      {history.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Session History
            </span>
          </div>
          <div className="space-y-2">
            {history.map((entry, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-3 py-2 border-b border-zinc-800 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                      {entry.params.site}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {entry.params.brand} {entry.params.model}
                      {entry.params.trim ? ` · ${entry.params.trim}` : ''}
                    </span>
                  </div>
                  <code className="text-xs text-zinc-500 font-mono truncate block">
                    {entry.result.url}
                  </code>
                </div>
                <div className="flex gap-1 shrink-0 mt-0.5">
                  <button
                    onClick={() => navigator.clipboard.writeText(entry.result.url)}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                    title="Copy"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() =>
                      window.open(entry.result.url, '_blank', 'noopener,noreferrer')
                    }
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 transition-colors"
                    title="Open"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
