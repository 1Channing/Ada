import { useEffect, useState } from 'react';
import { Megaphone, ExternalLink, BarChart3, ChevronDown } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listShowcase, type IntraItem } from '../services/intra';
import { verdictOf, COUNTRY_CAVEAT } from '../lib/offers/marketCheck';
import { OFFER_COUNTRIES } from '../services/offers';

/**
 * VITRINE DE L'ACCUEIL (12/10 soir, Channing) : les véhicules que l'équipe de
 * gestion MC Export a publiés depuis l'onglet Intra des offres — visible par
 * TOUS les utilisateurs d'ADA, toutes organisations. Chaque carte : le
 * véhicule, le prix MC Export HT, le verdict FRANCE du relevé de marché du
 * lot et, derrière « Étude de marché », les recherches françaises du relevé
 * (cliquables, pour vérifier le marché soi-même) — sans quitter l'Accueil.
 * Un seul pays : la vitrine parle à des vendeurs sur le marché français
 * (Channing : « à vendre sur le marché jusqu'à contre-ordre, pas les liens
 * ni l'écart des Pays-Bas »). Lecture seule ; seule l'équipe MC Export
 * publie (la base le tient).
 */
const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);
const fmtKm = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} km`);
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : null);
const VERDICT_CLASS: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200', warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200', idle: 'bg-slate-50 text-slate-500 border-slate-200',
};
const countryLabel = (code: string) => OFFER_COUNTRIES.find((x) => x.code === code)?.label ?? code;
/** La vitrine parle à des vendeurs sur le marché FRANÇAIS (12/10 soir, Channing : « ces véhicules seront à vendre
 *  sur le marché jusqu'à contre-ordre, pas les liens des Pays-Bas ni l'écart avec les Pays-Bas ») : un seul pays. */
const SHOWCASE_COUNTRIES = ['FR'];
const SITE_LABEL = (key: string) => key.replace(/^autoscout24_/, 'AS24 ').replace(/_/g, ' ');

export function IntraShowcase() {
  const { userId } = useAuth();
  const [items, setItems] = useState<IntraItem[]>([]);
  const [openStudy, setOpenStudy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    const load = () => { void listShowcase().then((r) => { setItems(r.rows); setError(r.error && !/à coller/.test(r.error) ? r.error : null); }); };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [userId]);
  if (items.length === 0 && !error) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3 flex-wrap">
        <Megaphone className="w-4 h-4 text-brand-ocean" />
        <span className="text-xs uppercase tracking-wide text-slate-500">Vitrine — véhicules disponibles</span>
        <span className="text-xs text-slate-400">{items.length} véhicule{items.length > 1 ? 's' : ''} publié{items.length > 1 ? 's' : ''} par l'équipe MC Export · prix MC Export HT · marché français</span>
      </div>
      {error && <p className="mx-5 mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 px-5 pb-5">
        {items.map((it) => {
          const v = it.vehicle;
          const countries = SHOWCASE_COUNTRIES.filter((c) => it.market?.[c]);
          const studyLinks = countries.flatMap((c) => Object.values(it.market?.[c]?.sites ?? {}).filter((s) => s.url).map((s) => ({ c, s })));
          const studyOpen = openStudy === it.id;
          const chips = [
            fmtDate(v.reg_date) ? `1re immat. ${fmtDate(v.reg_date)}` : v.year ? String(v.year) : '',
            v.km != null ? fmtKm(v.km) : '',
            v.fuel ? v.fuel.toLowerCase() : '',
            v.gearbox === 'AUTOMATIQUE' ? 'auto' : v.gearbox === 'MANUELLE' ? 'manuelle' : v.gearbox ?? '',
            v.power_ch ? `${v.power_ch} ch` : '',
            v.color ?? '',
            v.quantity > 1 ? `${v.quantity} exemplaires` : '',
          ].filter(Boolean);
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{v.brand} {v.model}</p>
                  <p className="text-xs text-slate-600 truncate" title={v.version}>{v.engine || v.version}{v.engine && v.version && v.engine !== v.version ? ` · ${v.version}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-brand-encre tabular-nums">{it.price_ht != null ? fmtEur(it.price_ht) : 'sur proposition'}</p>
                  {it.price_ht != null && <p className="text-[10px] text-slate-400">HT</p>}
                </div>
              </div>
              <p className="text-[11px] text-slate-500">{chips.join(' · ')}{v.damages ? ` · dommages ${fmtEur(v.damages)}` : ''}</p>
              {it.note && <p className="text-xs text-slate-700 whitespace-pre-wrap">« {it.note} »</p>}
              <div className="flex items-center gap-2 flex-wrap">
                {countries.length > 0 ? countries.map((c) => {
                  const res = it.market?.[c];
                  const verdict = verdictOf(it.price_ht, res, c);
                  const ref = res?.attackTtc ?? res?.medianTtc ?? null;
                  return (
                    <span key={c} title={`${countryLabel(c)} : ${verdict.text}${ref != null ? ` · prix d'attaque ${fmtEur(ref)} TTC · ${res?.competitors ?? 0} annonce(s)` : ''}${COUNTRY_CAVEAT[c] ? ` · ${COUNTRY_CAVEAT[c]}` : ''}`} className={`text-[11px] px-2 py-0.5 rounded-full border ${VERDICT_CLASS[verdict.tone]}`}>
                      {countryLabel(c)} {verdict.marginPct != null ? `${verdict.marginPct >= 0 ? '+' : ''}${verdict.marginPct} %` : verdict.text}
                    </span>
                  );
                }) : <span className="text-[11px] text-slate-400">Pas de relevé du marché français sur ce lot.</span>}
                {studyLinks.length > 0 && (
                  <button onClick={() => setOpenStudy(studyOpen ? null : it.id)} aria-expanded={studyOpen} className={`ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${studyOpen ? 'border-brand-encre bg-blue-50 text-brand-encre' : 'border-brand-ocean text-brand-ocean hover:bg-blue-50'}`}>
                    <BarChart3 className="w-3 h-3" /> Étude de marché <ChevronDown className={`w-3 h-3 transition-transform ${studyOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {studyOpen && (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                  <p className="text-[11px] text-slate-500">Les recherches du relevé, telles que lancées — clique pour voir le marché toi-même.</p>
                  {studyLinks.map(({ c, s }) => (
                    <a key={`${c}-${s.site}`} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-brand-ocean hover:underline">
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="font-medium">{SITE_LABEL(s.site)}</span>
                      <span className="text-slate-500">{s.count} annonce{s.count > 1 ? 's' : ''} lue{s.count > 1 ? 's' : ''}{s.attack != null ? ` · prix d'attaque ${fmtEur(s.attack)}` : s.median != null ? ` · médiane ${fmtEur(s.median)}` : ''}{s.error ? ` · ${s.error}` : ''}</span>
                    </a>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-400">{it.offer_title || 'offre'} · publié par {it.published_by_name} le {fmtDate(it.published_at)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
