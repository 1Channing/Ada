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
 * moves ±1000€; "Créer l'étude" spawns a pre-filled studies_v2 row with
 * memory-first URLs for both sides.
 */

import { useEffect, useState } from 'react';
import { Bell, Search, ClipboardCheck, FlaskConical, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  loadMarketOpportunities, loadOpportunityAcks, ackOpportunity, opportunityKey, fuelLabel,
} from '../services/marketData';
import type { MarketOpportunity } from '../services/marketData';
import { generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import type { SiteKey } from '../lib/linkgen/types';

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

  const refresh = async (th: number) => {
    setLoading(true);
    const [o, a] = await Promise.all([loadMarketOpportunities(th, 5, touchedSince), loadOpportunityAcks()]);
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

  const handleCreateStudy = async (o: MarketOpportunity) => {
    const key = opportunityKey(o);
    setBusyKey(key);
    setNotice(null);
    try {
      const criteriaFuel = TOKEN_TO_CRITERIA[o.fuel];
      const gen = await generateSearchUrlsWithMemory({
        selectedSites: [o.lowSite as SiteKey, o.highSite as SiteKey],
        brand: o.brand, model: o.model, fuel: criteriaFuel,
        yearFrom: String(o.year), yearTo: String(o.year),
      });
      const sourceUrl = gen.find((g) => g.site === o.lowSite)?.url ?? '';
      const targetUrl = gen.find((g) => g.site === o.highSite)?.url ?? '';
      if (!sourceUrl || !targetUrl) throw new Error('URL non générable pour un des deux sites');

      const id = `ADA-${o.brand}-${o.model}-${o.year}-${o.lowCountry}-${o.highCountry}-${Date.now().toString(36)}`
        .replace(/[^A-Za-z0-9-]+/g, '-').toUpperCase();
      // Source = pays le moins cher (achat), target = pays le plus cher (revente).
      const { error } = await supabase.from('studies_v2').insert({
        id,
        brand: o.brand,
        model: o.model,
        year: o.year,
        max_mileage: null,
        country_source: o.lowCountry,
        market_source_url: sourceUrl,
        country_target: o.highCountry,
        market_target_url: targetUrl,
      });
      if (error) throw new Error(error.message);
      setNotice(`Étude ${id} créée — visible dans l'onglet Studies.`);
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
                    title={`Créer une étude ${o.lowCountry} → ${o.highCountry} pré-remplie`}
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
