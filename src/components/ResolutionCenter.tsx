/**
 * Resolution center — collapsible panel (bottom of the campaigns section)
 * listing EVERY recorded gap across ALL campaigns. Nothing gets lost when a
 * new campaign replaces the live panel: each unknown stays here until someone
 * closes it — by fixing it, by asserting the market is empty (URL valid,
 * mapping learned without a sample), or by knowingly ignoring it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Loader2, ExternalLink, Wrench, Check, Ban, EyeOff, RotateCcw } from 'lucide-react';
import {
  loadAllGaps, resolveGapItem, reopenGapItem, validateEmptyMarket,
  RESOLUTION_LABELS,
} from '../services/resolutionCenter';
import type { GapItem } from '../services/resolutionCenter';

const OUTCOME_LABELS: Record<string, string> = {
  taxonomy_gap: 'lacune taxonomie',
  enum_gap: 'lacune critère',
  no_url: 'URL impossible',
  insufficient: 'échantillon insuffisant',
  technical: 'technique',
};

const OUTCOME_STYLE: Record<string, string> = {
  taxonomy_gap: 'bg-red-900/40 text-red-400',
  enum_gap: 'bg-amber-900/40 text-amber-400',
  no_url: 'bg-zinc-800 text-zinc-400',
  insufficient: 'bg-zinc-800 text-zinc-500',
  technical: 'bg-blue-900/30 text-blue-400',
};

function variantChips(item: GapItem): string[] {
  const c = (item.criteria ?? {}) as Record<string, unknown>;
  const chips: string[] = [];
  for (const v of [c.fuel, c.trim, c.yearFrom ?? c.year]) {
    const s = v == null ? '' : String(v).trim();
    if (s && !chips.includes(s)) chips.push(s);
  }
  return chips;
}

export function ResolutionCenter() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const { items, loadError } = await loadAllGaps();
    setGaps(items);
    setError(loadError ? `Chargement impossible : ${loadError}` : null);
    setLoading(false);
  };

  useEffect(() => { if (open) void reload(); }, [open]);

  const openGaps = useMemo(() => gaps.filter((g) => !g.resolvedAt), [gaps]);
  const shown = showResolved ? gaps : openGaps;
  const bySite = useMemo(() => {
    const m: Record<string, GapItem[]> = {};
    for (const g of shown) (m[g.site] ??= []).push(g);
    return m;
  }, [shown]);

  const act = async (item: GapItem, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusyId(item.id);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(`${item.brand} ${item.model} : ${res.error ?? 'échec'}`);
    else await reload();
    setBusyId(null);
  };

  const openInIngestion = (url: string) => {
    window.history.pushState({}, '', `/ingestion?url=${encodeURIComponent(url)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="pt-2 border-t border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
          open
            ? 'bg-violet-900/40 border-violet-700 text-violet-300'
            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Inbox className="w-3.5 h-3.5" />
        Centre de résolution
        {open && !loading && (
          <span className="px-1.5 rounded-full bg-zinc-800 text-zinc-300">{openGaps.length} ouverte(s)</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>
              Toutes les inconnues enregistrées, toutes campagnes confondues — rien ne se perd, tout se
              corrige : réparer, déclarer le marché vide (URL valide, mapping appris), ou ignorer en
              connaissance de cause.
            </span>
            <label className="flex items-center gap-1.5 shrink-0 cursor-pointer text-zinc-400">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="accent-violet-500"
              />
              afficher les résolues
            </label>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {loading && (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement des inconnues…
            </p>
          )}
          {!loading && shown.length === 0 && (
            <p className="text-xs text-emerald-400">Aucune inconnue ouverte — tout est traité.</p>
          )}

          {Object.entries(bySite).map(([site, items]) => (
            <div key={site}>
              <div className="text-xs font-medium text-zinc-400 mb-1">
                {site} ({items.filter((i) => !i.resolvedAt).length})
              </div>
              <div className="space-y-1">
                {items.map((item) => {
                  const done = Boolean(item.resolvedAt);
                  const busy = busyId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`text-xs bg-zinc-950 border rounded px-2 py-1.5 space-y-1 ${
                        done ? 'border-emerald-900/50 opacity-70' : 'border-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {done ? (
                          <span className="shrink-0 px-1.5 rounded text-[10px] font-medium bg-emerald-900/40 text-emerald-400">
                            {RESOLUTION_LABELS[item.resolution ?? ''] ?? 'résolue'}
                          </span>
                        ) : (
                          <span className={`shrink-0 px-1.5 rounded text-[10px] font-medium ${OUTCOME_STYLE[item.outcome] ?? 'bg-zinc-800 text-zinc-400'}`}>
                            {OUTCOME_LABELS[item.outcome] ?? item.outcome}
                          </span>
                        )}
                        <span className={`shrink-0 ${done ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                          {item.brand} {item.model}
                        </span>
                        {variantChips(item).map((c) => (
                          <span key={c} className="shrink-0 px-1.5 rounded text-[10px] bg-blue-900/30 text-blue-300">{c}</span>
                        ))}
                        <span className="text-zinc-500 truncate flex-1 min-w-[8rem]">{item.detail}</span>
                        <span className="text-zinc-700 shrink-0 hidden lg:inline" title={item.campaignLabel}>
                          {item.createdAt.slice(0, 10)}
                        </span>
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400 shrink-0" />
                        ) : done ? (
                          <button
                            onClick={() => void act(item, () => reopenGapItem(item.id))}
                            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 shrink-0"
                            title="Rouvrir cette inconnue"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Rouvrir
                          </button>
                        ) : (
                          <>
                            {item.url && (
                              <button
                                onClick={() => openInIngestion(item.url!)}
                                className="flex items-center gap-1 text-violet-400 hover:text-violet-300 shrink-0"
                                title="Corriger en Ingestion (URL pré-remplie)"
                              >
                                <Wrench className="w-3.5 h-3.5" /> Corriger
                              </button>
                            )}
                            <button
                              onClick={() => void act(item, () => resolveGapItem(item.id, 'corrected'))}
                              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 shrink-0"
                              title="Déjà corrigée ailleurs"
                            >
                              <Check className="w-3.5 h-3.5" /> Corrigé
                            </button>
                            <button
                              onClick={() => void act(item, () => validateEmptyMarket(item))}
                              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 shrink-0"
                              title="Le marché est vide mais l'URL cible bien ce modèle — apprendre le mapping sans échantillon"
                            >
                              <Ban className="w-3.5 h-3.5" /> Marché vide
                            </button>
                            <button
                              onClick={() => void act(item, () => resolveGapItem(item.id, 'ignored'))}
                              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 shrink-0"
                              title="Ignorer (non pertinent)"
                            >
                              <EyeOff className="w-3.5 h-3.5" /> Ignorer
                            </button>
                          </>
                        )}
                      </div>
                      {item.url && (
                        <a
                          href={item.url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 font-mono text-[10px] text-zinc-600 hover:text-zinc-400 truncate"
                          title={item.url}
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{item.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
