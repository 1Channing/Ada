/**
 * Notification bell (right side of the nav) — monthly re-scan reminders.
 *
 * Stale segments (> 30 days without a scan) ACCUMULATE here until the operator
 * deals with them. Nothing is ever scanned automatically: the re-scan launches
 * ONLY on the human's click (a worker campaign with the exact ticked segments).
 * Markets that don't interest MC Export are opted out for good ("Ignorer") —
 * shared with the whole team, they never nag again.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bell, Loader2, RotateCw, EyeOff, X } from 'lucide-react';
import { loadStaleSegments, optOutSegments, buildRescanPlan, RESCAN_AFTER_DAYS } from '../services/rescanService';
import type { StaleSegment } from '../services/rescanService';
import { startCampaign } from '../services/campaignRunner';

const COUNTRY_FLAG: Record<string, string> = {
  FR: '🇫🇷', NL: '🇳🇱', DK: '🇩🇰', DE: '🇩🇪', IT: '🇮🇹', ES: '🇪🇸', BE: '🇧🇪',
};

function defaultName(): string {
  try {
    const raw = localStorage.getItem('ada_contributor_names');
    const names = raw ? (JSON.parse(raw) as string[]) : [];
    return names[0] ?? '';
  } catch { return ''; }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<StaleSegment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Facet filters — valider PAR marché ce qu'on re-scanne.
  const [fCountry, setFCountry] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fFuel, setFFuel] = useState('');
  const [fYear, setFYear] = useState('');

  const reload = async () => {
    setLoading(true);
    const segs = await loadStaleSegments();
    setSegments(segs);
    setSelected(new Set());
    setLoading(false);
  };
  useEffect(() => { void reload(); }, []);

  const facets = useMemo(() => ({
    countries: [...new Set(segments.map((s) => s.country).filter(Boolean))].sort(),
    brands: [...new Set(segments.map((s) => s.brand).filter(Boolean))].sort(),
    fuels: [...new Set(segments.map((s) => s.fuel).filter(Boolean))].sort(),
    years: [...new Set(segments.map((s) => s.year).filter((y): y is number => y != null))].sort((a, b) => b - a),
  }), [segments]);

  const shown = useMemo(() => segments.filter((s) =>
    (!fCountry || s.country === fCountry) &&
    (!fBrand || s.brand === fBrand) &&
    (!fFuel || s.fuel === fFuel) &&
    (!fYear || String(s.year ?? '') === fYear)
  ), [segments, fCountry, fBrand, fFuel, fYear]);

  const toggleOne = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.key));
  const toggleAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allShownSelected) shown.forEach((s) => next.delete(s.key));
    else shown.forEach((s) => next.add(s.key));
    return next;
  });

  const selectedSegments = segments.filter((s) => selected.has(s.key));

  const handleRescan = async () => {
    if (selectedSegments.length === 0) return;
    setBusy(true);
    setNotice(null);
    const plan = buildRescanPlan(selectedSegments);
    const res = await startCampaign({
      sites: [...new Set(plan.map((p) => p.site))],
      total: plan.length,
      plan,
      label: `Re-scan mensuel (${plan.length})`,
    });
    setBusy(false);
    if (res.started) {
      setNotice(`Re-scan lancé sur ${plan.length} segment(s) — suivi dans Link Generator › Campagnes.`);
      // They'll leave the stale list once their fresh snapshots land.
    } else {
      setNotice(`Lancement impossible : ${res.reason ?? 'inconnu'}`);
    }
  };

  const handleIgnore = async () => {
    if (selectedSegments.length === 0) return;
    const by = window.prompt(`Ignorer ${selectedSegments.length} marché(s) définitivement ? Votre nom :`, defaultName())?.trim();
    if (by == null) return;
    setBusy(true);
    await optOutSegments(selectedSegments, by);
    setBusy(false);
    await reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 rounded-lg transition-colors ${open ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
        title={`Segments sans scan depuis ${RESCAN_AFTER_DAYS} j`}
      >
        <Bell className="w-5 h-5" />
        {segments.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-bold flex items-center justify-center">
            {segments.length > 99 ? '99+' : segments.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[520px] max-w-[92vw] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">
              Re-scan mensuel — {segments.length} segment(s) à plus de {RESCAN_AFTER_DAYS} j
            </h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Rien ne se relance tout seul : cochez les marchés qui vous intéressent puis validez le
            re-scan (campagne côté serveur), ou ignorez définitivement ceux qui ne vous intéressent pas.
          </p>

          {/* Facet filters */}
          <div className="grid grid-cols-4 gap-2">
            <select value={fCountry} onChange={(e) => setFCountry(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs">
              <option value="">Pays</option>
              {facets.countries.map((c) => <option key={c} value={c}>{COUNTRY_FLAG[c] ?? ''} {c}</option>)}
            </select>
            <select value={fBrand} onChange={(e) => setFBrand(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs">
              <option value="">Marque</option>
              {facets.brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={fFuel} onChange={(e) => setFFuel(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs">
              <option value="">Carburant</option>
              {facets.fuels.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={fYear} onChange={(e) => setFYear(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs">
              <option value="">Année</option>
              {facets.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>

          {notice && <p className="text-xs text-emerald-400">{notice}</p>}
          {loading ? (
            <p className="text-xs text-zinc-500 flex items-center gap-2 py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyse des derniers scans…
            </p>
          ) : segments.length === 0 ? (
            <p className="text-xs text-emerald-400 py-4">Tout est à jour — aucun segment en retard de scan.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer border-b border-zinc-800 pb-2">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} className="accent-amber-500" />
                Tout {allShownSelected ? 'décocher' : 'cocher'} ({shown.length} affiché(s))
              </label>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {shown.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 cursor-pointer hover:border-zinc-600">
                    <input
                      type="checkbox"
                      checked={selected.has(s.key)}
                      onChange={() => toggleOne(s.key)}
                      className="accent-amber-500 shrink-0"
                    />
                    <span className="shrink-0">{COUNTRY_FLAG[s.country] ?? s.country}</span>
                    <span className="text-zinc-200 font-medium shrink-0">{s.brand} {s.model}</span>
                    {s.year != null && <span className="shrink-0 px-1 rounded bg-blue-900/30 text-blue-300 text-[10px]">{s.year}</span>}
                    {s.fuel && <span className="shrink-0 text-zinc-400">{s.fuel}</span>}
                    {s.trim && <span className="shrink-0 text-zinc-500 truncate max-w-[80px]">{s.trim}</span>}
                    <span className="ml-auto text-zinc-600 shrink-0">{s.daysSince} j · {s.site}</span>
                  </label>
                ))}
                {shown.length === 0 && <p className="text-xs text-zinc-600 py-2">Aucun segment pour ces filtres.</p>}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleRescan()}
                  disabled={busy || selectedSegments.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                  Re-scanner la sélection ({selectedSegments.length})
                </button>
                <button
                  onClick={() => void handleIgnore()}
                  disabled={busy || selectedSegments.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs"
                  title="Ces marchés ne m'intéressent pas — ne plus jamais les proposer"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Ignorer définitivement
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
