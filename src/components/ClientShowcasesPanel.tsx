/**
 * VITRINES DE NOS CLIENTS FACE À UN MODÈLE DE L'OFFRE (13/11, Channing) — sous les relevés marché de l'onglet Analyse.
 * Un pays, un modèle retenu : les clients de ce pays dont la vitrine relevée contient des équivalents (en stock et
 * vendus), avec prix, jours de stock, stock moyen, prix de vente ; ceux qui ont tout vendu sont proposés aussi.
 * Graphiques : équivalents en stock / vendus par client ; prix des équivalents face à notre prix TTC du pays.
 */
import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ReferenceLine, ZAxis } from 'recharts';
import { Store, Loader2, ExternalLink, ChevronDown, ChevronRight, BadgeCheck, Info } from 'lucide-react';
import { loadNetwork, type NetworkContact } from '../services/network';
import { listRefBrandModels } from '../services/workflow';
import { loadLearnedModelsByBrand, mergeKnownModels } from '../lib/offers/knownModels';
import { loadFxRates } from '../services/fxRates';
import { analyzeClients, loadCountryBrandVehicles, lotVehiclesOf, type ClientRow, type ClientMatch } from '../services/clientShowcases';
import { FUEL_LABEL, KM_TOLERANCE, type KnownModels } from '../services/stockCompare';
import { countryVat } from '../lib/offers/vat';
import { OFFER_COUNTRIES } from '../services/offers';
import type { OfferLot } from '../lib/offers/marketCheck';
import type { OfferVehicle } from '../lib/offers/parseSupplierFile';
import { ShowcaseModal } from './ShowcaseModal';

const OCEAN = '#2C5F9E'; // en stock
const AMBER = '#A16207'; // vendus (palette validée : chroma, CVD, contraste)
const ENCRE = '#22346E';
const GRID = '#e2e8f0'; const AXIS = '#64748b';
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' };
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
const km = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} km`);
const d = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

export function ClientShowcasesPanel({ lots, vehicles, countries, priceHtOf }: { lots: OfferLot[]; vehicles: OfferVehicle[]; countries: string[]; priceHtOf: (v: OfferVehicle) => number | null }) {
  const [country, setCountry] = useState(countries[0] ?? 'NL');
  const [lotKey, setLotKey] = useState(lots[0]?.key ?? '');
  const [contacts, setContacts] = useState<NetworkContact[] | null>(null);
  const [known, setKnown] = useState<KnownModels | null>(null);
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showcaseFor, setShowcaseFor] = useState<NetworkContact | null>(null);
  useEffect(() => { if (!countries.includes(country)) setCountry(countries[0] ?? 'NL'); }, [countries, country]);
  useEffect(() => { if (!lots.some((l) => l.key === lotKey)) setLotKey(lots[0]?.key ?? ''); }, [lots, lotKey]);
  useEffect(() => {
    let alive = true;
    (async () => {
      await loadFxRates().catch(() => { /* repli EUR */ });
      const [net, ref, learned] = await Promise.all([loadNetwork(), listRefBrandModels().then((r) => r.modelsByBrand).catch(() => ({} as Record<string, string[]>)), loadLearnedModelsByBrand().catch(() => ({} as Record<string, string[]>))]);
      if (!alive) return;
      setContacts(net.contacts); setKnown(mergeKnownModels(ref, learned));
      if (net.error) setError(net.error);
    })();
    return () => { alive = false; };
  }, []);
  const lot = lots.find((l) => l.key === lotKey) ?? null;
  const cc = country.toUpperCase();
  const vat = countryVat(cc);
  const countryContacts = useMemo(() => (contacts ?? []).filter((c) => (c.country ?? '').toUpperCase() === cc && (c.website || c.website2)), [contacts, cc]);
  const ours = useMemo(() => (lot ? lotVehiclesOf(vehicles.filter((v) => lot.vehicleIds.includes(v.id)), priceHtOf) : []), [lot, vehicles, priceHtOf]);
  const ourHt = useMemo(() => { const p = ours.map((o) => o.priceHt).filter((x): x is number => x != null); return p.length ? { min: Math.min(...p), max: Math.max(...p), med: [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)] } : null; }, [ours]);
  const ourTtc = ourHt ? Math.round(ourHt.med * (1 + vat)) : null;

  useEffect(() => {
    if (!lot || !contacts || !known) return;
    let alive = true;
    setLoading(true); setRows(null); setError(null);
    (async () => {
      const r = await loadCountryBrandVehicles(countryContacts.map((c) => c.id), lot.brand);
      if (!alive) return;
      if (r.error) { setError(r.error); setLoading(false); return; }
      setRows(analyzeClients(countryContacts, r.vehicles, r.runs, { brand: lot.brand, model: lot.model }, ours, known));
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot?.key, cc, contacts, known]);

  const totals = useMemo(() => rows ? { clients: rows.length, inStock: rows.reduce((a, r) => a + r.inStock.length, 0), sold: rows.reduce((a, r) => a + r.sold.length, 0), soldOut: rows.filter((r) => r.soldOut).length } : null, [rows]);
  const bars = useMemo(() => (rows ?? []).slice(0, 14).map((r) => ({ name: r.contact.name.length > 22 ? `${r.contact.name.slice(0, 21)}…` : r.contact.name, 'en stock': r.inStock.length, vendus: r.sold.length })), [rows]);
  const dots = useMemo(() => {
    const list = (rows ?? []).slice(0, 14);
    const inStock: Array<{ x: number; y: number; name: string; title: string }> = []; const sold: typeof inStock = [];
    list.forEach((r, i) => {
      for (const m of r.inStock) if (m.priceEur != null) inStock.push({ x: m.priceEur, y: i, name: r.contact.name, title: m.theirs.title ?? '' });
      for (const m of r.sold) if (m.lastEur != null) sold.push({ x: m.lastEur, y: i, name: r.contact.name, title: m.theirs.title ?? '' });
    });
    return { inStock, sold, names: list.map((r) => r.contact.name) };
  }, [rows]);
  const countryName = (c: string) => OFFER_COUNTRIES.find((x) => x.code === c)?.label ?? c;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <Store className="w-4 h-4 text-brand-ocean" />
        <h2 className="text-base font-semibold text-slate-900">Vitrines de nos clients</h2>
        <span className="text-xs text-slate-500">ce qu'ils ont en stock et ce qu'ils ont vendu, face à un modèle de l'offre</span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">Pays
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
              {(countries.length ? countries : ['NL']).map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-600">Modèle
            <select value={lotKey} onChange={(e) => setLotKey(e.target.value)} className="max-w-[360px] px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm">
              {lots.map((l) => <option key={l.key} value={l.key}>{l.label} · {l.count} véh.</option>)}
            </select>
          </label>
        </div>
      </div>
      {!lot ? <p className="px-4 py-6 text-sm text-slate-500">Retiens au moins un véhicule dans Sélection : les modèles retenus apparaissent ici.</p> : (
        <div className="px-4 py-3 space-y-4">
          <p className="text-xs text-slate-500">
            Équivalent = même marque et modèle, même énergie, <strong>année exacte</strong>, km à ± {KM_TOLERANCE.toLocaleString('fr-FR')}, puissance à 10 % quand connue ; la finition est comparée mais ne bloque pas (« Collection » en France = « Executive » aux Pays-Bas) : un équivalent à finition différente est marqué. Vitrines relevées des contacts {countryName(cc)} ({countryContacts.length}).
            {ourHt && <> Notre HT {eur(ourHt.min)}{ourHt.max !== ourHt.min ? ` – ${eur(ourHt.max)}` : ''} → TTC {cc} {Math.round(vat * 100)} % {eur(ourTtc)} (médiane).</>}
          </p>
          {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
          {loading || !rows ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lecture des vitrines {countryName(cc)} pour {lot.brand}…</p> : rows.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun client {countryName(cc)} n'a d'équivalent {lot.brand} {lot.model} dans sa vitrine relevée, ni en stock ni vendu.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile label="Clients avec des équivalents" value={String(totals!.clients)} />
                <Tile label="Équivalents en stock" value={String(totals!.inStock)} tone="ocean" />
                <Tile label="Équivalents vendus" value={String(totals!.sold)} hint="disparus de la vitrine" tone="amber" />
                <Tile label="Ont tout vendu" value={String(totals!.soldOut)} hint="plus rien en stock, à proposer" tone={totals!.soldOut > 0 ? 'ok' : undefined} />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-800 mb-1">Équivalents par client <span className="font-normal text-slate-500">· en stock et vendus{rows.length > 14 ? ' · 14 premiers' : ''}</span></p>
                  <ResponsiveContainer width="100%" height={Math.max(140, 26 * bars.length + 40)}>
                    <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barGap={2}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={130} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#0f172a0a' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="en stock" fill={OCEAN} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="vendus" fill={AMBER} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-800 mb-1">Prix des équivalents <span className="font-normal text-slate-500">· en stock (prix affiché) et vendus (dernier prix){ourTtc ? ` · trait = notre TTC ${cc}` : ''}</span></p>
                  <ResponsiveContainer width="100%" height={Math.max(140, 26 * dots.names.length + 40)}>
                    <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" dataKey="x" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} tickFormatter={(v: number) => `${Math.round(v / 1000)} k€`} domain={['auto', 'auto']} />
                      <YAxis type="number" dataKey="y" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} width={130} domain={[-0.5, Math.max(0.5, dots.names.length - 0.5)]} ticks={dots.names.map((_, i) => i)} tickFormatter={(i: number) => { const n = dots.names[i] ?? ''; return n.length > 22 ? `${n.slice(0, 21)}…` : n; }} reversed />
                      <ZAxis range={[48, 48]} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} formatter={(v, _n, p) => [eur(typeof v === 'number' ? v : null), String((p?.payload as { title?: string } | undefined)?.title ?? '')]} labelFormatter={() => ''} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {ourTtc && <ReferenceLine x={ourTtc} stroke={ENCRE} strokeDasharray="4 4" label={{ value: `notre TTC ${eur(ourTtc)}`, fill: ENCRE, fontSize: 10, position: 'insideTopRight' }} />}
                      <Scatter name="en stock" data={dots.inStock} fill={OCEAN} />
                      <Scatter name="vendus" data={dots.sold} fill={AMBER} shape="diamond" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium text-right">En stock</th>
                  <th className="py-2 pr-3 font-medium text-right">Prix mini · médian</th>
                  <th className="py-2 pr-3 font-medium text-right">Jours de stock</th>
                  <th className="py-2 pr-3 font-medium text-right">Vendus</th>
                  <th className="py-2 pr-3 font-medium text-right">Prix de vente · délai</th>
                  <th className="py-2 pr-3 font-medium text-right">Stock moyen</th>
                  <th className="py-2 pr-3 font-medium"></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <ClientRows key={r.contact.id} r={r} open={open === r.contact.id} onToggle={() => setOpen(open === r.contact.id ? null : r.contact.id)} onShowcase={() => setShowcaseFor(r.contact)} />
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-400 flex items-start gap-1"><Info className="w-3 h-3 mt-0.5 shrink-0" /> « Vendus » = équivalents présents à un relevé puis disparus de la vitrine (vendus ou retirés) ; le prix de vente est le dernier prix vu avant disparition, la baisse compare au premier prix vu. « Stock moyen » = nombre d'équivalents présents en moyenne aux relevés des 90 derniers jours. « Même modèle » compte toutes les voitures de ce modèle, sans condition d'année ni de km.</p>
            </>
          )}
        </div>
      )}
      {showcaseFor && <ShowcaseModal contactId={showcaseFor.id} name={showcaseFor.name} url={showcaseFor.website} url2={showcaseFor.website2 ?? null} country={showcaseFor.country} frequency={showcaseFor.stock_frequency ?? null} unreadable={showcaseFor.showcase_unreadable ?? null} onClose={() => setShowcaseFor(null)} />}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'ocean' | 'amber' }) {
  const cls = tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'ocean' ? 'border-blue-200 bg-blue-50 text-brand-encre' : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <p className="text-[11px] opacity-80">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] opacity-70">{hint}</p>}
    </div>
  );
}

function ClientRows({ r, open, onToggle, onShowcase }: { r: ClientRow; open: boolean; onToggle: () => void; onShowcase: () => void }) {
  return (
    <>
      <tr className={`${r.soldOut ? 'bg-emerald-50/40' : ''} hover:bg-slate-50/60`}>
        <td className="py-2 pr-3 align-top">
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-brand-ocean" aria-expanded={open}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} {r.contact.name}
          </button>
          <span className="block text-slate-500 pl-5">{r.contact.city ?? ''}{r.lastRunAt ? ` · relevé ${d(r.lastRunAt)}` : ''} · même modèle : {r.sameModelInStock} en stock, {r.sameModelSold} vendus</span>
          {r.soldOut && <span className="ml-5 mt-0.5 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800"><BadgeCheck className="w-3 h-3" /> tout vendu — à proposer</span>}
        </td>
        <td className="py-2 pr-3 align-top text-right tabular-nums font-semibold text-slate-800">{r.inStock.length || '—'}</td>
        <td className="py-2 pr-3 align-top text-right tabular-nums">{r.priceMin != null ? <>{eur(r.priceMin)}<span className="text-slate-400"> · {eur(r.priceMedian)}</span></> : '—'}</td>
        <td className="py-2 pr-3 align-top text-right tabular-nums">{r.daysMedian != null ? `${r.daysMedian} j` : '—'}</td>
        <td className="py-2 pr-3 align-top text-right tabular-nums font-semibold text-slate-800">{r.sold.length || '—'}</td>
        <td className="py-2 pr-3 align-top text-right tabular-nums">{r.sold.length ? <>{eur(r.soldLastMedian)}{r.soldDropPct != null && r.soldDropPct !== 0 ? <span className={`ml-1 text-[10px] ${r.soldDropPct < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{r.soldDropPct > 0 ? '+' : ''}{r.soldDropPct.toLocaleString('fr-FR')} %</span> : ''}<span className="block text-slate-400">{r.soldDaysMedian != null ? `vendus en ${r.soldDaysMedian} j` : ''}</span></> : '—'}</td>
        <td className="py-2 pr-3 align-top text-right tabular-nums">{r.avgStock != null ? r.avgStock.toLocaleString('fr-FR') : '—'}</td>
        <td className="py-2 pr-3 align-top text-right whitespace-nowrap"><button type="button" onClick={onShowcase} className="text-[11px] px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">Vitrine</button></td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={8} className="px-3 py-2">
            <div className="grid md:grid-cols-2 gap-3">
              <MatchList title={`En stock · ${r.inStock.length}`} list={r.inStock} sold={false} />
              <MatchList title={`Vendus · ${r.sold.length}`} list={r.sold} sold />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MatchList({ title, list, sold }: { title: string; list: ClientMatch[]; sold: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-700 mb-1">{title}</p>
      {list.length === 0 ? <p className="text-[11px] text-slate-400">aucun</p> : (
        <ul className="space-y-1">
          {list.slice(0, 30).map((m) => {
            const t = m.theirs;
            return (
              <li key={t.id} className="flex items-start gap-2 text-[11px]">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800">{t.title || `${t.brand ?? ''} ${t.model ?? ''}`}</span>
                  {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-ocean align-middle" aria-label="Ouvrir l'annonce"><ExternalLink className="w-3 h-3" /></a>}
                  <span className="block text-slate-500">{t.year ?? '—'} · {km(t.km)}{m.fuel ? ` · ${FUEL_LABEL[m.fuel]}` : ''}{m.power ? ` · ${m.power} ch` : ''}{m.trim ? ` · ${m.trim}` : ''}{m.trimState === 'different' ? ' · finition ≠' : ''}{sold ? ` · disparu le ${d(t.gone_at)}` : ''}{m.days != null ? ` · ${m.days} j` : ''}</span>
                </div>
                <div className="text-right tabular-nums whitespace-nowrap">
                  <span className="font-semibold text-slate-800">{eur(sold ? m.lastEur : m.priceEur)}</span>
                  {m.firstEur != null && m.lastEur != null && m.firstEur !== m.lastEur && <span className="block text-[10px] text-slate-400">vu d'abord à {eur(m.firstEur)}</span>}
                </div>
              </li>
            );
          })}
          {list.length > 30 && <li className="text-[11px] text-slate-400">+ {list.length - 30} autres</li>}
        </ul>
      )}
    </div>
  );
}
