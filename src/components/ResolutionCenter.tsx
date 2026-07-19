/**
 * Resolution center — collapsible panel (bottom of the campaigns section)
 * listing EVERY recorded gap across ALL campaigns. Nothing gets lost when a
 * new campaign replaces the live panel: each unknown stays here until someone
 * closes it — by fixing it, by asserting the market is empty (URL valid,
 * mapping learned without a sample), or by knowingly ignoring it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Loader2, ExternalLink, Wrench, Check, Ban, EyeOff, RotateCcw, RefreshCw, FileText } from 'lucide-react';
import {
  loadAllGaps, resolveGapItem, reopenGapItem, validateEmptyMarket,
  RESOLUTION_LABELS,
} from '../services/resolutionCenter';
import type { GapItem } from '../services/resolutionCenter';
import { loadUnreviewedDossiers, markDossiersReviewed, buildDailyDigest } from '../services/errorDossiers';
import type { ErrorDossier } from '../services/errorDossiers';
import { startCampaign } from '../services/campaignRunner';
import type { CampaignPlanItem } from '../lib/linkgen/campaignPlanner';

/**
 * Dedupe the open gaps into UNIQUE plan segments: 377 gap rows often share
 * the same site×brand×model×fuel×year — one re-test study covers them all,
 * and a confirmed result retro-heals every matching open gap.
 */
function buildRetestPlan(items: GapItem[]): CampaignPlanItem[] {
  const seen = new Set<string>();
  const plan: CampaignPlanItem[] = [];
  for (const g of items) {
    const c = (g.criteria ?? {}) as Record<string, unknown>;
    const fuel = c.fuel ? String(c.fuel) : undefined;
    const trim = c.trim ? String(c.trim) : undefined;
    const rawYear = c.year ?? c.yearFrom;
    const year = rawYear != null && /^\d{4}$/.test(String(rawYear)) ? Number(rawYear) : undefined;
    if (!g.site || !g.brand || !g.model) continue;
    const key = [g.site, g.brand.toUpperCase(), g.model.toUpperCase(), (fuel ?? '').toUpperCase(), trim ?? '', year ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push({
      site: g.site, brand: g.brand, model: g.model, fuel, trim, year,
      kind: 'reinforcement', reason: 're-test centre de résolution',
    });
  }
  return plan;
}

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
  const [dossiers, setDossiers] = useState<ErrorDossier[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [toolBusy, setToolBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { items, loadError } = await loadAllGaps();
    setGaps(items);
    setError(loadError ? `Chargement impossible : ${loadError}` : null);
    const { items: dossierRows } = await loadUnreviewedDossiers();
    setDossiers(dossierRows);
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

  // Re-passer TOUTES les inconnues ouvertes dans le moteur actuel (slugs
  // corrigés, sondes 404, API Marktplaats, saut de domaine CF) : chaque
  // segment confirmé rétro-guérit ses lacunes automatiquement.
  const retestPlan = useMemo(() => buildRetestPlan(openGaps), [openGaps]);
  const handleRetest = async () => {
    if (retestPlan.length === 0) return;
    const ok = window.confirm(
      `Lancer une campagne de re-test sur ${retestPlan.length} segment(s) unique(s) (${openGaps.length} inconnues ouvertes) ?\n` +
      'Les segments confirmés fermeront leurs inconnues automatiquement.'
    );
    if (!ok) return;
    setToolBusy(true);
    setToolNote(null);
    const res = await startCampaign({
      sites: [...new Set(retestPlan.map((p) => p.site))],
      total: retestPlan.length,
      plan: retestPlan,
      label: `Re-test résolution (${retestPlan.length})`,
    });
    setToolBusy(false);
    setToolNote(res.started
      ? 'Re-test lancé — suivi dans Campagnes ; les inconnues résolues se fermeront toutes seules.'
      : `Lancement impossible : ${res.reason ?? 'inconnu'}`);
  };

  // Boîte noire : le rapport quotidien à coller en session de dev.
  const handleCopyDigest = async () => {
    const digest = buildDailyDigest(dossiers);
    try {
      await navigator.clipboard.writeText(digest);
      setToolNote(`Rapport copié (${dossiers.length} dossier(s)) — collez-le dans la session de dev, puis marquez revus.`);
    } catch {
      setToolNote('Copie refusée par le navigateur — sélectionnez le texte de la console.');
      console.log(digest);
    }
  };
  const handleMarkReviewed = async () => {
    setToolBusy(true);
    await markDossiersReviewed(dossiers.map((d) => d.id));
    setToolBusy(false);
    setToolNote('Dossiers marqués revus.');
    await reload();
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

          {/* Outils : re-test en masse + boîte noire (revue quotidienne) */}
          <div className="flex items-center gap-2 flex-wrap text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
            <button
              onClick={() => void handleRetest()}
              disabled={toolBusy || retestPlan.length === 0}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-900/40 border border-violet-800 text-violet-300 hover:bg-violet-900/60 disabled:opacity-40"
              title="Re-passer toutes les inconnues ouvertes dans le moteur corrigé"
            >
              {toolBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Re-tester les inconnues ({retestPlan.length} segments)
            </button>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-1.5 text-zinc-400">
              <FileText className="w-3.5 h-3.5" />
              Boîte noire : <b className="text-zinc-200">{dossiers.length}</b> dossier(s) non revu(s)
            </span>
            <button
              onClick={() => void handleCopyDigest()}
              disabled={dossiers.length === 0}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
              title="Copier le rapport du jour (à coller en session de dev)"
            >
              Copier le rapport du jour
            </button>
            <button
              onClick={() => void handleMarkReviewed()}
              disabled={toolBusy || dossiers.length === 0}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-40"
              title="À faire une fois le rapport traité"
            >
              Marquer revus
            </button>
            {toolNote && <span className="text-emerald-400">{toolNote}</span>}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {loading && (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement des inconnues…
            </p>
          )}
          {!loading && shown.length === 0 && !error && (
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
