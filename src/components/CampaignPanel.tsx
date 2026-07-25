/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN PANEL — mass-ingestion campaigns (bottom of the Link Gen page)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Config → launch → live progress → gap report ("ce qu'on ne sait pas").
 * The engine itself is a module singleton (campaignRunner) so navigating
 * around ADA never interrupts a run; this panel is just a window onto it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Rocket, Square, Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Wrench, Check, Ban } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { brandKey } from '../services/marketData';
import { allSiteAdapters, findSiteAdapterByDomain } from '../lib/study-core/marketplaces';
import { startCampaign, stopCampaign, markItemResolved } from '../services/campaignRunner';
import { validateEmptyMarketForCampaignItem } from '../services/resolutionCenter';
import { useCampaignStore } from '../store/campaignStore';
import type { CampaignItemResult, CampaignOutcome } from '../store/campaignStore';
import { ResolutionCenter } from './ResolutionCenter';

const OUTCOME_LABELS: Record<CampaignOutcome, string> = {
  confirmed: 'confirmé',
  taxonomy_gap: 'lacune taxonomie',
  enum_gap: 'lacune critère',
  no_url: 'URL impossible',
  insufficient: 'échantillon insuffisant',
  technical: 'technique',
};

const OUTCOME_STYLE: Record<CampaignOutcome, string> = {
  confirmed: 'bg-emerald-900/40 text-emerald-400',
  taxonomy_gap: 'bg-red-900/40 text-red-400',
  enum_gap: 'bg-amber-900/40 text-amber-400',
  no_url: 'bg-zinc-800 text-zinc-400',
  insufficient: 'bg-zinc-800 text-zinc-500',
  technical: 'bg-blue-900/30 text-blue-400',
};

const SECONDS_PER_ITEM = 18; // scrape + persist + pause, empirically

/**
 * The filters ACTUALLY in the tested URL — decoded by the site adapter
 * (ground truth), merged with the planned variants. Empty → explicit
 * 'sans filtre', so a gap is never ambiguous about what was tested.
 */
function testedFilterChips(item: CampaignItemResult): string[] {
  const chips: string[] = [];
  const push = (v: unknown, fmt?: (s: string) => string) => {
    const s = v == null ? '' : String(v).trim();
    if (s && !chips.includes(fmt ? fmt(s) : s)) chips.push(fmt ? fmt(s) : s);
  };
  if (item.url) {
    try {
      const pre = findSiteAdapterByDomain(item.url)?.prefillCriteriaFromUrl?.(item.url) ?? {};
      push(pre.fuel);
      push(pre.gearbox);
      if (pre.yearFrom || pre.yearTo) {
        const from = String(pre.yearFrom ?? '');
        const to = String(pre.yearTo ?? '');
        push(from === to ? from : `${from || '…'}–${to || '…'}`);
      }
      push(pre.mileage, (s) => `≤${s} km`);
      push(pre.powerFrom, (s) => `≥${s} ch`);
      push(pre.trim);
    } catch { /* URL shape not decodable — fall back to planned variants */ }
  }
  // Planned variants (may not appear in the URL when the site can't express them).
  push(item.fuel);
  push(item.trim);
  push(item.year);
  return chips;
}

const FUEL_TARGETS = ['ESSENCE', 'DIESEL', 'HYBRIDE', 'ELECTRIQUE'];

export function CampaignPanel() {
  const state = useCampaignStore();
  const [total, setTotal] = useState(200);
  const [sites, setSites] = useState<string[]>(() => allSiteAdapters().map((a) => a.key));
  const [reinforcePct, setReinforcePct] = useState(15);
  const [variantPct, setVariantPct] = useState(40);
  const [startError, setStartError] = useState<string | null>(null);

  // Modular targeting — everything optional, combinable: brands, models,
  // fuels, year window (e.g. hybrides only across all sites; one brand
  // across every country).
  const [filterBrands, setFilterBrands] = useState<string[]>([]);
  const [filterFuels, setFilterFuels] = useState<string[]>([]);
  const [filterModels, setFilterModels] = useState('');
  const [yearMin, setYearMin] = useState<string>('');
  const [yearMax, setYearMax] = useState<string>('');
  // Deep pagination (10 pages / ~300 annonces) — off by default: ~2× Zyte cost.
  const [deepScan, setDeepScan] = useState(false);
  const [knownBrands, setKnownBrands] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('linkgen_mapping_memory')
        .select('brand')
        .eq('validation_status', 'valid')
        .limit(1000);
      // UNE puce par marque canonique : 'VW' et 'VOLKSWAGEN' sont la même
      // marque (signalement 23/07 — deux puces à cocher). Affichage = la
      // graphie la plus longue (la plus lisible) ; le filtre du planificateur
      // compare en canonique, n'importe quelle graphie cochée matche tout.
      const byKey = new Map<string, string>();
      for (const r of data ?? []) {
        const b = String((r as { brand: string | null }).brand ?? '').trim().toUpperCase();
        if (!b) continue;
        const k = brandKey(b);
        const cur = byKey.get(k);
        if (!cur || b.length > cur.length) byKey.set(k, b);
      }
      setKnownBrands([...byKey.values()].sort((a, b) => a.localeCompare(b)));
    })();
  }, []);
  const toggleIn = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const running = state.status === 'running' || state.status === 'planning' || state.status === 'stopping';

  // Auto-resolution: a gap whose site×brand×model is NOW validated in memory
  // (e.g. fixed via a manual re-ingestion) displays as resolved on its own.
  const [validatedKeys, setValidatedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('linkgen_mapping_memory')
        .select('site, brand, model')
        .eq('validation_status', 'valid')
        .limit(10000);
      const keys = new Set<string>();
      for (const r of data ?? []) {
        keys.add(`${r.site}|${String(r.brand ?? '').trim().toUpperCase()}|${String(r.model ?? '').trim().toUpperCase()}`);
      }
      setValidatedKeys(keys);
    })();
  }, [state.done, state.status]); // refresh as the campaign progresses / after corrections

  const isResolved = (item: CampaignItemResult): boolean =>
    Boolean(item.resolvedAt) ||
    validatedKeys.has(`${item.site}|${item.brand.trim().toUpperCase()}|${item.model.trim().toUpperCase()}`);

  const gaps = useMemo(
    () => state.items.filter((i) => i.outcome === 'taxonomy_gap' || i.outcome === 'enum_gap'),
    [state.items]
  );
  const gapsBySite = useMemo(() => {
    const g: Record<string, CampaignItemResult[]> = {};
    for (const item of gaps) (g[item.site] ??= []).push(item);
    return g;
  }, [gaps]);

  const estMinutes = Math.round((total * SECONDS_PER_ITEM) / 60);

  const toggleSite = (key: string) =>
    setSites((prev) => prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]);

  const handleStart = async () => {
    setStartError(null);
    const models = filterModels.split(',').map((s) => s.trim()).filter(Boolean);
    const filters = {
      ...(filterBrands.length > 0 ? { brands: filterBrands } : {}),
      ...(models.length > 0 ? { models } : {}),
      ...(filterFuels.length > 0 ? { fuels: filterFuels } : {}),
      ...(yearMin.trim() ? { yearMin: Number(yearMin) } : {}),
      ...(yearMax.trim() ? { yearMax: Number(yearMax) } : {}),
    };
    const res = await startCampaign({
      sites, total,
      reinforceShare: reinforcePct / 100,
      variantShare: variantPct / 100,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(deepScan ? { deepScan: true } : {}),
    });
    if (!res.started) setStartError(res.reason ?? 'Lancement impossible');
  };

  const openInIngestion = (url: string) => {
    window.history.pushState({}, '', `/ingestion?url=${encodeURIComponent(url)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  // « Marché vide » directement depuis le rapport de campagne : apprend le
  // mapping sans échantillon (assertion humaine) puis clôt l'inconnue —
  // même mécanique que le centre de résolution.
  const handleEmptyMarket = async (item: CampaignItemResult) => {
    if (!state.campaignId) return;
    const ok = window.confirm(
      `Déclarer « marché vide » pour ${item.brand} ${item.model}` +
      `${item.fuel ? ' · ' + item.fuel : ''}${item.year ? ' · ' + item.year : ''} sur ${item.site} ?\n\n` +
      `⚠️ Uniquement si l'URL cible bien ce modèle et que le marché n'a VRAIMENT rien.\n` +
      `Si les voitures existent sous un autre nom sur le site (ex. ë-C4 pour une C4 électrique),\n` +
      `utilisez plutôt « Corriger » pour apprendre la bonne URL.`
    );
    if (!ok) return;
    const res = await validateEmptyMarketForCampaignItem(state.campaignId, item.seq, {
      site: item.site, brand: item.brand, model: item.model,
      criteria: { fuel: item.fuel ?? null, trim: item.trim ?? null, year: item.year ?? null },
      url: item.url,
    });
    if (!res.ok) { window.alert(`Échec : ${res.error ?? 'inconnu'}`); return; }
    useCampaignStore.setState((st) => ({
      items: st.items.map((i) => (i.seq === item.seq ? { ...i, resolvedAt: new Date().toISOString() } : i)),
    }));
  };

  const feed = state.items.slice(-12).reverse();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Rocket className="w-4 h-4 text-violet-400" />
          Campagnes de mapping — exploration de masse
        </h2>
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-violet-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {state.status === 'stopping' ? 'arrêt en cours…' : `${state.done}/${state.total}`}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Projette les critères déjà validés (marques, modèles, carburants, finitions — liés à leur marque)
        sur les sites où ils ne le sont pas encore. Chaque étude passe par le pipeline d'ingestion normal :
        ce qui se confirme enrichit la mémoire (réutilisable immédiatement), ce qui échoue devient la liste
        de ce qu'il faut aller chercher à la main. La campagne tourne côté serveur : elle continue même
        navigateur fermé — lancez le soir, le rapport vous attend au réveil.
      </p>

      {/* Config */}
      {!running && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-zinc-400">Nombre d'études : <span className="text-zinc-200 font-semibold">{total}</span> (~{estMinutes} min, {total} appels Zyte)</span>
              <input
                type="range" min={10} max={1000} step={10} value={total}
                onChange={(e) => setTotal(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Renforcement (re-test de combos déjà validés) : {reinforcePct}%</span>
              <input
                type="range" min={0} max={50} step={5} value={reinforcePct}
                onChange={(e) => setReinforcePct(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Variantes carburant / finition (liées à leur marque+modèle) : {variantPct}%</span>
              <input
                type="range" min={0} max={100} step={10} value={variantPct}
                onChange={(e) => setVariantPct(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
            <p className="text-[11px] text-zinc-500">
              Chaque étude cible <span className="text-zinc-300">une année précise</span> (min = max,
              tirée entre 2020 et {new Date().getFullYear()}) — obligatoire, sinon la recherche est
              trop vaste et les médianes mélangent tous les âges.
            </p>
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={deepScan}
                onChange={(e) => setDeepScan(e.target.checked)}
                className="accent-violet-500"
              />
              Scan profond — 10 pages (~300 annonces) au lieu de 5 <span className="text-zinc-600">· ~2× d'appels Zyte</span>
            </label>
          </div>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-zinc-400 block mb-1.5">Sites cibles</span>
              <div className="flex flex-wrap gap-1.5">
                {allSiteAdapters().map((a) => (
                  <button
                    key={a.key}
                    onClick={() => toggleSite(a.key)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      sites.includes(a.key)
                        ? 'bg-violet-900/40 border-violet-700 text-violet-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {a.displayName}
                  </button>
                ))}
              </div>
            </div>

            {/* Ciblage modulable : marques × carburants × modèles × années,
                combinables librement. Vide = pas de restriction. */}
            <div>
              <span className="text-xs text-zinc-400 block mb-1.5">
                Ciblage carburant {filterFuels.length > 0 && <span className="text-violet-300">· {filterFuels.length} forcé(s)</span>}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {FUEL_TARGETS.map((fu) => (
                  <button
                    key={fu}
                    onClick={() => setFilterFuels((prev) => toggleIn(prev, fu))}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      filterFuels.includes(fu)
                        ? 'bg-sky-900/40 border-sky-700 text-sky-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {fu}
                  </button>
                ))}
              </div>
            </div>

            {knownBrands.length > 0 && (
              <div>
                <span className="text-xs text-zinc-400 block mb-1.5">
                  Ciblage marques {filterBrands.length > 0 ? <span className="text-violet-300">· {filterBrands.length} sélectionnée(s)</span> : '(toutes)'}
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                  {knownBrands.map((b) => (
                    <button
                      key={b}
                      onClick={() => setFilterBrands((prev) => toggleIn(prev, b))}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                        filterBrands.includes(b)
                          ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-zinc-400">Modèles (optionnel, séparés par des virgules)</span>
                <input
                  value={filterModels}
                  onChange={(e) => setFilterModels(e.target.value)}
                  placeholder="GOLF, RAV4…"
                  className="w-full mt-1 px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-zinc-400">Année min</span>
                  <input
                    type="number" min={2020} max={new Date().getFullYear()} value={yearMin}
                    onChange={(e) => setYearMin(e.target.value)}
                    placeholder="2020"
                    className="w-full mt-1 px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-400">Année max</span>
                  <input
                    type="number" min={2020} max={new Date().getFullYear()} value={yearMax}
                    onChange={(e) => setYearMax(e.target.value)}
                    placeholder={String(new Date().getFullYear())}
                    className="w-full mt-1 px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={handleStart}
            disabled={sites.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Rocket className="w-4 h-4" />
            Lancer la campagne ({total})
          </button>
        ) : (
          <button
            onClick={stopCampaign}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            <Square className="w-4 h-4" />
            Arrêt immédiat
          </button>
        )}
        {startError && <span className="text-xs text-red-400">{startError}</span>}
        {state.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>

      {/* Live progress */}
      {(running || state.items.length > 0) && (
        <div className="space-y-3">
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-violet-500 h-2 transition-all"
              style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-400">
              <CheckCircle2 className="w-3 h-3 inline mr-1" />{state.counts.confirmed} confirmés
            </span>
            <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400">
              <XCircle className="w-3 h-3 inline mr-1" />{state.counts.taxonomy_gap} lacunes taxonomie
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-400">
              <AlertTriangle className="w-3 h-3 inline mr-1" />{state.counts.enum_gap} lacunes critère
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{state.counts.no_url} URL impossibles</span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">{state.counts.insufficient} insuffisants</span>
            <span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-400">{state.counts.technical} techniques</span>
          </div>
          {state.current ? (
            <div className="text-xs text-zinc-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
              #{state.current.seq} — {state.current.site} · {state.current.brand} {state.current.model}
              <span className="text-zinc-600">({state.current.reason})</span>
            </div>
          ) : (state.status === 'running' && state.done < state.total && (
            <div className="text-xs text-zinc-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
              étude #{state.done + 1}/{state.total} en cours côté serveur…
            </div>
          ))}
          {feed.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {feed.map((item) => (
                <div key={item.seq} className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600 font-mono w-8 shrink-0">#{item.seq}</span>
                  <span className={`shrink-0 px-1.5 rounded text-[10px] font-medium ${OUTCOME_STYLE[item.outcome]}`}>
                    {OUTCOME_LABELS[item.outcome]}
                  </span>
                  {/* Vérifiable d'un clic : la ligne ouvre l'URL réellement
                      scrapée — indispensable pour juger un « marché vide ». */}
                  {item.url ? (
                    <a
                      href={item.url} target="_blank" rel="noreferrer"
                      className="text-zinc-400 hover:text-violet-300 hover:underline truncate"
                      title={`Ouvrir la recherche scrapée :\n${item.url}`}
                    >
                      {item.site} · {item.brand} {item.model}
                      {item.fuel ? ` · ${item.fuel}` : ''}{item.trim ? ` · ${item.trim}` : ''}{item.year ? ` · ${item.year}` : ''}
                    </a>
                  ) : (
                    <span className="text-zinc-400 truncate">
                      {item.site} · {item.brand} {item.model}
                      {item.fuel ? ` · ${item.fuel}` : ''}{item.trim ? ` · ${item.trim}` : ''}{item.year ? ` · ${item.year}` : ''}
                    </span>
                  )}
                  <span className="text-zinc-600 truncate hidden md:inline">{item.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gap report — "ce qu'on ne sait pas" */}
      {gaps.length > 0 && (() => {
        const open = gaps.filter((g) => !isResolved(g));
        const resolved = gaps.filter((g) => isResolved(g));
        return (
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <h3 className="text-xs font-semibold text-zinc-300">
              Rapport d'inconnues — {open.length} à traiter
              {resolved.length > 0 && <span className="text-emerald-400"> · {resolved.length} résolue(s)</span>}
            </h3>
            {Object.entries(gapsBySite).map(([site, items]) => (
              <div key={site}>
                <div className="text-xs font-medium text-zinc-400 mb-1">{site} ({items.filter((i) => !isResolved(i)).length})</div>
                <div className="space-y-1">
                  {items.map((item) => {
                    const done = isResolved(item);
                    return (
                      <div
                        key={item.seq}
                        className={`text-xs bg-zinc-950 border rounded px-2 py-1.5 space-y-1 ${
                          done ? 'border-emerald-900/50 opacity-70' : 'border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {done ? (
                            <span className="shrink-0 px-1.5 rounded text-[10px] font-medium bg-emerald-900/40 text-emerald-400">
                              résolue
                            </span>
                          ) : (
                            <span className={`shrink-0 px-1.5 rounded text-[10px] font-medium ${OUTCOME_STYLE[item.outcome]}`}>
                              {OUTCOME_LABELS[item.outcome]}
                            </span>
                          )}
                          <span className={`shrink-0 ${done ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                            {item.brand} {item.model}
                          </span>
                          {/* Filtres réellement présents dans l'URL testée (décodés
                              par l'adaptateur) — jamais ambigu : 'sans filtre' si nus. */}
                          {(() => {
                            const chips = testedFilterChips(item);
                            return chips.length > 0 ? chips.map((c) => (
                              <span key={c} className="shrink-0 px-1.5 rounded text-[10px] bg-blue-900/30 text-blue-300">{c}</span>
                            )) : (
                              <span className="shrink-0 px-1.5 rounded text-[10px] bg-zinc-800 text-zinc-500">sans filtre</span>
                            );
                          })()}
                          <span className="text-zinc-500 truncate flex-1">{item.detail}</span>
                          {!done && item.url && (
                            <button
                              onClick={() => openInIngestion(item.url!)}
                              className="flex items-center gap-1 text-violet-400 hover:text-violet-300 shrink-0"
                              title="Corriger en Ingestion (URL pré-remplie)"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              Corriger
                            </button>
                          )}
                          {!done && state.campaignId && (
                            <button
                              onClick={() => void markItemResolved(state.campaignId!, item.seq)}
                              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 shrink-0"
                              title="Marquer comme corrigée (déjà traitée ailleurs)"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Corrigé
                            </button>
                          )}
                          {!done && state.campaignId && (
                            <button
                              onClick={() => void handleEmptyMarket(item)}
                              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 shrink-0"
                              title="Le marché est vide mais l'URL cible bien ce modèle — apprendre le mapping sans échantillon. ⚠️ À ne PAS utiliser si les voitures existent sous un autre nom (ex. ë-C4) : là c'est Corriger."
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Marché vide
                            </button>
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
        );
      })()}

      {/* Centre de résolution — toutes les inconnues, toutes campagnes */}
      <ResolutionCenter />
    </div>
  );
}
