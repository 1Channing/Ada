/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPPORTUNITÉS À CONTRÔLER — cross-country price-gap alerts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mines the observations every scrape already records (campaigns included)
 * for models whose cheap end (median of the 5 cheapest) differs by ≥ threshold
 * between two countries. Coarse by design: it points at a MARKET to work,
 * the market study then hunts the listings. Ordered by gap × volume — no
 * displayed score, just priority. "Contrôlée" hides an alert until the gap
 * moves ±1000€; "Créer l'étude" crée une ÉTUDE QUOTIDIENNE pré-remplie dans
 * le Workflow (elle tourne chaque matin et reste affinable).
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, Search, ClipboardCheck, FlaskConical, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  loadMarketOpportunities, loadOpportunityAcks, ackOpportunity, opportunityKey, fuelLabel,
  brandKey, canonKey,
} from '../services/marketData';
import type { MarketOpportunity } from '../services/marketData';
import { saveDailySearch, listDailySearches } from '../services/workflow';

const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪',
};

// Canonical fuel token → LinkGen criteria label
const TOKEN_TO_CRITERIA: Record<string, string> = {
  electric: 'ELECTRIQUE', petrol: 'ESSENCE', diesel: 'DIESEL',
  hybrid: 'HYBRIDE', phev: 'PLUG_IN_HYBRID', lpg: 'GPL', cng: 'CNG',
};

function eur(n: number): string {
  return `${n.toLocaleString('fr-FR')} €`;
}

function defaultName(): string {
  try {
    const raw = localStorage.getItem('ada_contributor_names');
    const names = raw ? (JSON.parse(raw) as string[]) : [];
    return names[0] ?? '';
  } catch { return ''; }
}

const PAGE_SIZE = 10;

export function OpportunityAlerts({ onInspect, touchedSince }: {
  onInspect: (o: MarketOpportunity) => void;
  /** Accueil : ne montrer que les opportunités touchées par la dernière campagne. */
  touchedSince?: string | null;
}) {
  const [threshold, setThreshold] = useState(5000);
  const [opps, setOpps] = useState<MarketOpportunity[]>([]);
  const [acks, setAcks] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The list can get huge — collapsible panel + progressive reveal.
  const [collapsed, setCollapsed] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);

  // Garde anti-réponse périmée : le calcul lit ~40 000 observations paginées,
  // donc deux chargements lancés coup sur coup (changement de seuil, ou portée
  // qui arrive après le premier rendu) peuvent revenir dans le désordre — la
  // réponse la plus LENTE écrasait alors la plus récente et l'accueil
  // affichait la liste non filtrée (110 écarts au lieu de 4, constat 29/07).
  const reqSeq = useRef(0);
  const refresh = async (th: number) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    const [o, a] = await Promise.all([loadMarketOpportunities(th, 5, touchedSince), loadOpportunityAcks()]);
    if (seq !== reqSeq.current) return; // un chargement plus récent a pris la main
    setOpps(o); setAcks(a); setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(threshold); }, [threshold, touchedSince]);

  const visible = opps.filter((o) => {
    const acked = acks.get(opportunityKey(o));
    return acked == null || Math.abs(o.deltaEur - acked) >= 1000;
  });
  const ackedCount = opps.length - visible.length;

  const handleAck = async (o: MarketOpportunity) => {
    const by = window.prompt('Contrôlée par (votre nom) :', defaultName())?.trim();
    if (!by) return;
    await ackOpportunity(o, by);
    setAcks((m) => new Map(m).set(opportunityKey(o), o.deltaEur));
  };

  /**
   * Un écart repéré devient une ÉTUDE QUOTIDIENNE du Workflow (choix Channing
   * 30/07) : elle tourne chaque matin, alimente les résultats et reste
   * modifiable (finitions, kilométrage, écart, heure) — l'ancien dossier
   * studies_v2 n'était ni exécuté ni affiché nulle part.
   *
   * Source = pays le MOINS cher (on y achète), cible = le plus cher (on y
   * revend). Millésime figé sur celui de l'écart : comparer 2021 et 2024,
   * c'est comparer des âges, pas un arbitrage.
   */
  const handleCreateStudy = async (o: MarketOpportunity) => {
    const key = opportunityKey(o);
    setBusyKey(key);
    setNotice(null);
    try {
      // Pas deux fois le même dossier : le même segment entre les mêmes pays
      // renvoie vers l'étude existante, à affiner plutôt qu'à dupliquer.
      const existing = (await listDailySearches()).find((s) =>
        brandKey(s.brand) === brandKey(o.brand)
        && canonKey(s.model) === canonKey(o.model)
        && s.source_country === o.lowCountry && s.target_country === o.highCountry
        && (s.year_min ?? 0) <= o.year && (s.year_max ?? 9999) >= o.year);
      if (existing) {
        setNotice(`Étude « ${existing.label} » déjà en place pour ce segment — ajuste-la dans le Workflow.`);
        return;
      }

      // Écart : le seuil que TU surveilles comme plancher, le double de l'écart
      // observé comme plafond — bornes de départ, affinables dans le Workflow.
      const gapMax = Math.max(10_000, Math.round((o.deltaEur * 2) / 1000) * 1000);
      const err = await saveDailySearch({
        label: `${o.brand} ${o.model} ${o.year}`.replace(/\s+/g, ' ').trim(),
        source_country: o.lowCountry,
        target_country: o.highCountry,
        brand: o.brand,
        model: o.model,
        year_min: o.year,
        year_max: o.year,
        fuel: TOKEN_TO_CRITERIA[o.fuel] ?? '',
        trim: '',
        trim_target: '',
        mileage_max: null,
        price_gap_min: threshold,
        price_gap_max: gapMax,
        run_hour: 7,
        active: true,
      });
      if (err) throw new Error(err);
      setNotice(`Étude « ${o.brand} ${o.model} ${o.year} » créée dans le Workflow (${o.lowCountry} → ${o.highCountry}, 7 h) — ajoute la finition et le kilométrage pour l'affiner.`);
    } catch (e) {
      setNotice(`Création impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && opps.length === 0) return null;
  if (visible.length === 0 && ackedCount === 0) return null;

  const rows = visible.slice(0, shown);

  return (
    <div className="bg-white border border-amber-300 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-sm font-semibold text-slate-800 flex items-center gap-2 hover:text-blue-700"
          title={collapsed ? 'Déplier' : 'Réduire'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          <Bell className="w-4 h-4 text-amber-600" />
          Opportunités à contrôler — {visible.length} écart(s) inter-pays
          {ackedCount > 0 && <span className="text-slate-500 font-normal">· {ackedCount} contrôlée(s)</span>}
        </button>
        {!collapsed && (
          <label className="text-xs text-slate-500 flex items-center gap-2">
            Seuil
            <select
              value={threshold}
              onChange={(e) => { setThreshold(Number(e.target.value)); setShown(PAGE_SIZE); }}
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            >
              <option value={3000}>3 000 €</option>
              <option value={5000}>5 000 €</option>
              <option value={8000}>8 000 €</option>
            </select>
          </label>
        )}
      </div>

      {!collapsed && (
        <>
          <p className="text-xs text-slate-500">
            Médiane des 5 annonces les moins chères par pays — <span className="text-slate-600">même carburant
            ET même année des deux côtés</span> (30 derniers jours, prix &lt; 1 000 € exclus), triées par
            écart × volume. « Inspecter » ouvre la comparaison des deux marchés en dessous.
          </p>
          {notice && <p className="text-xs text-emerald-600">{notice}</p>}

          <div className="space-y-1.5">
            {rows.map((o) => {
              const key = opportunityKey(o);
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-800">{o.brand} {o.model}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{o.year}</span>
                  <span className="text-xs text-slate-600">{fuelLabel(o.fuel)}</span>
                  <span className="text-xs text-slate-600">
                    {COUNTRY_FLAG[o.lowCountry] ?? o.lowCountry} {eur(o.lowMedian)}
                    <span className="text-slate-500"> ({o.lowCount})</span>
                    <span className="text-slate-400"> vs </span>
                    {COUNTRY_FLAG[o.highCountry] ?? o.highCountry} {eur(o.highMedian)}
                    <span className="text-slate-500"> ({o.highCount})</span>
                  </span>
                  <span className="font-semibold text-amber-600">écart {eur(o.deltaEur)}</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => onInspect(o)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    title="Ouvrir les deux marchés en études comparées, juste en dessous"
                  >
                    <Search className="w-3.5 h-3.5" /> Inspecter
                  </button>
                  <button
                    onClick={() => void handleCreateStudy(o)}
                    disabled={busyKey === key}
                    className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 disabled:opacity-50"
                    title={`Créer une étude quotidienne ${o.lowCountry} → ${o.highCountry} dans le Workflow (7 h), à affiner ensuite`}
                  >
                    {busyKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                    Créer l'étude
                  </button>
                  <button
                    onClick={() => void handleAck(o)}
                    className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
                    title="Marquer contrôlée — réapparaît si l'écart bouge de ±1 000 €"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" /> Contrôlée
                  </button>
                </div>
              );
            })}
            {visible.length === 0 && (
              <p className="text-xs text-slate-500">Toutes les opportunités actuelles ont été contrôlées.</p>
            )}
            {visible.length > shown && (
              <button
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="w-full text-xs text-slate-600 hover:text-slate-800 py-1.5 rounded-lg border border-dashed border-slate-200 hover:border-slate-300"
              >
                Afficher plus ({visible.length - shown} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
