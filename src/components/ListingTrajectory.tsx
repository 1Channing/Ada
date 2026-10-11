/**
 * TRAJECTOIRE DES PRIX (bêta, 11/10) — remplace la carte « Vélocité » du MI.
 *
 * Décision Channing : « en vélocité ce qu'on est sûr uniquement, pas de
 * supposition ». La carte n'affiche que des faits : ce qu'ADA a relevé (dates,
 * prix à chaque passage) et ce que le site déclare (mise en ligne, prix
 * barré). Pas de « vendue », pas de « temps de vente » estimé : une annonce
 * absente est « absente depuis le JJ/MM » (premier scan qui la couvrait sans
 * la revoir), une durée sans date du site est une borne basse (« ≥ N j »).
 */
import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { humanListingUrl } from '../services/marketData';
import { summarizeByCountry, type FactsSummary, type ListingFact } from '../services/listingFacts';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const fmtEur = (n: number | null | undefined) => (n == null || n === 0 ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const fmtPct = (p: number | null | undefined) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`);

export function ListingTrajectory({ facts, countryColor }: { facts: ListingFact[]; countryColor: Record<string, string> }) {
  const countries = useMemo(() => summarizeByCountry(facts), [facts]);
  const [selCountry, setSelCountry] = useState<string | null>(null);
  const [view, setView] = useState<'moves' | 'gone' | 'all'>('moves');
  const [showAll, setShowAll] = useState(false);
  const active: FactsSummary | undefined = countries.find((c) => c.country === selCountry) ?? countries[0];
  const rows = useMemo(() => {
    const list = facts.filter((f) => !active || f.country === active.country);
    const picked = view === 'moves'
      ? list.filter((f) => f.drops + f.rises > 0 || f.siteDiscountPct != null)
      : view === 'gone' ? list.filter((f) => f.status === 'gone') : list;
    const score = (f: ListingFact) => Math.min(f.observedDeltaPct ?? 0, f.siteDiscountPct ?? 0);
    return [...picked].sort((a, b) => view === 'gone'
      ? String(b.goneSince ?? '').localeCompare(String(a.goneSince ?? ''))
      : score(a) - score(b) || b.seenCount - a.seenCount);
  }, [facts, active, view]);
  const shown = showAll ? rows : rows.slice(0, 15);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-rose-600" />
        <h2 className="font-semibold text-slate-800">Trajectoire des prix</h2>
        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5">bêta</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        faits seulement : relevés ADA (prix à chaque passage, présence) et déclarations du site (mise en ligne, prix barré) · aucune estimation de vente
      </p>

      {facts.length === 0 ? (
        <div className="h-[140px] flex items-center justify-center text-sm text-slate-400 text-center px-4">Pas d'annonces sur ce filtre.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {countries.map((c) => {
              const isSel = c.country === active?.country;
              return (
                <button
                  key={c.country}
                  onClick={() => setSelCountry(c.country)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    isSel ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: countryColor[c.country] ?? '#d95926' }} />
                  <span className="font-semibold">{c.country}</span>
                  <span className={isSel ? 'text-slate-300' : 'text-slate-500'}>
                    {c.withDrop > 0 ? `${c.withDrop} baisse${c.withDrop > 1 ? 's' : ''}` : `${c.online} en ligne`}
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Fact label="Annonces" value={String(active.total)} hint={`${active.online} en ligne · ${active.gone} absente${active.gone > 1 ? 's' : ''}`} />
              <Fact label="Suivies à ≥ 2 relevés" value={String(active.followed)} hint={active.spanDays > 0 ? `relevés sur ${active.spanDays} j` : 'un seul relevé'} />
              <Fact
                label="Baisses observées"
                value={active.withDrop > 0 ? `${active.withDrop} · ${fmtPct(active.medianDropPct)}` : '0'}
                hint={active.withDrop > 0 ? `médiane de l'écart cumulé · ${active.withRise} hausse${active.withRise > 1 ? 's' : ''}` : active.followed > 0 ? 'aucun mouvement entre deux relevés' : 'pas de 2e relevé'}
                tone={active.withDrop > 0 ? 'emerald' : undefined}
              />
              <Fact
                label="Prix barré par le site"
                value={active.withSiteDiscount > 0 ? `${active.withSiteDiscount} · ${fmtPct(active.medianSiteDiscountPct)}` : '0'}
                hint={active.withSiteDiscount > 0 ? 'remise affichée par le vendeur (médiane)' : 'aucun ancien prix affiché'}
                tone={active.withSiteDiscount > 0 ? 'emerald' : undefined}
              />
              <Fact
                label="Âge du stock en ligne"
                value={active.medianAgeDays != null ? `${active.medianAgeDays} j` : '—'}
                hint={active.datedOnline > 0 ? `médiane · ${active.datedOnline} annonce${active.datedOnline > 1 ? 's' : ''} datée${active.datedOnline > 1 ? 's' : ''} par le site` : 'site sans date de mise en ligne'}
              />
              <Fact
                label="Absentes"
                value={active.gone > 0 ? `${active.gone}` : '0'}
                hint={active.gone > 0
                  ? (active.medianGoneAgeDays != null
                    ? `âge médian à la dernière vue ${active.medianGoneAgeDays} j (${active.datedGone} datées)`
                    : `vues pendant ≥ ${active.medianGoneObservedDays ?? 0} j (médiane)`)
                  : 'aucune disparition prouvée'}
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-xs">
            {([['moves', 'Prix bougés ou barrés'], ['gone', 'Absentes'], ['all', 'Toutes']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setView(k); setShowAll(false); }}
                className={`px-2 py-0.5 rounded-full border ${view === k ? 'bg-slate-100 border-slate-300 text-slate-800' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
            <span className="text-slate-400 ml-auto">{rows.length} annonce{rows.length > 1 ? 's' : ''}</span>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-slate-500">
              {view === 'moves' ? 'Aucun prix bougé entre deux relevés ni prix barré affiché par le site sur ce pays.' : view === 'gone' ? 'Aucune absence prouvée par un relevé postérieur.' : 'Aucune annonce.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1.5 pr-3">Annonce</th>
                    <th className="py-1.5 pr-3">Prix 1<sup>er</sup> relevé → courant</th>
                    <th className="py-1.5 pr-3">Observé</th>
                    <th className="py-1.5 pr-3">Barré par le site</th>
                    <th className="py-1.5 pr-3">Vue par ADA</th>
                    <th className="py-1.5 pr-3">Mise en ligne (site)</th>
                    <th className="py-1.5">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 align-top">
                      <td className="py-1.5 pr-3 max-w-[260px]">
                        {f.latest.listing_url ? (
                          <a href={humanListingUrl(f.latest.listing_url)} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline line-clamp-1" title={f.latest.title ?? ''}>
                            {f.latest.title || f.latest.listing_url}
                          </a>
                        ) : <span className="text-slate-700 line-clamp-1">{f.latest.title ?? '—'}</span>}
                        <span className="text-slate-400">{f.site}{f.latest.year ? ` · ${f.latest.year}` : ''}{f.latest.mileage != null ? ` · ${f.latest.mileage.toLocaleString('fr-FR')} km` : ''}</span>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-700">
                        {f.firstPrice != null && f.currentPrice != null && f.firstPrice !== f.currentPrice
                          ? <><span className="text-slate-400 line-through">{fmtEur(f.firstPrice)}</span> → <span className="font-medium text-slate-900">{fmtEur(f.currentPrice)}</span></>
                          : <span className="font-medium text-slate-900">{fmtEur(f.currentPrice)}</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {f.drops + f.rises > 0
                          ? <span className={f.observedDeltaPct != null && f.observedDeltaPct < 0 ? 'text-emerald-700 font-medium' : 'text-rose-600 font-medium'}>
                              {fmtPct(f.observedDeltaPct)} <span className="text-slate-400 font-normal">({f.drops}↓{f.rises > 0 ? ` ${f.rises}↑` : ''})</span>
                            </span>
                          : <span className="text-slate-400">{f.seenCount >= 2 ? 'stable' : '1 relevé'}</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {f.sitePreviousPrice != null
                          ? <span className="text-emerald-700"><span className="line-through text-slate-400">{fmtEur(f.sitePreviousPrice)}</span> {fmtPct(f.siteDiscountPct)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">
                        {fmtDate(f.firstSeenAt)}{f.seenCount > 1 ? ` → ${fmtDate(f.lastSeenAt)}` : ''} <span className="text-slate-400">({f.seenCount})</span>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">
                        {f.publishedAt ? <>{fmtDate(f.publishedAt)} <span className="text-slate-400">· {f.ageDaysAtLastSeen} j</span></> : <span className="text-slate-300">non déclarée</span>}
                      </td>
                      <td className="py-1.5 whitespace-nowrap">
                        {f.status === 'online'
                          ? <span className="text-slate-700">en ligne</span>
                          : <span className="text-amber-700" title="Premier relevé postérieur qui couvrait l'annonce sans la revoir">absente depuis le {fmtDate(f.goneSince!)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 15 && (
                <button onClick={() => setShowAll((s) => !s)} className="text-xs text-slate-500 hover:text-slate-700 pt-2">
                  {showAll ? 'Réduire' : `Voir les ${rows.length - 15} autres`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'emerald' }) {
  return (
    <div className="border border-slate-200 rounded-lg p-2.5">
      <div className={`text-base font-bold truncate ${tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
