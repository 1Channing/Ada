import { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldAlert, Wifi } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../services/auth';
import { useActiveUsers } from '../hooks/useActiveUsersCount';

/**
 * Télémétrie d'usage (ADMIN) — qui utilise quoi, quand : pages visitées,
 * activité par utilisateur et par jour, dernier passage de chacun. Lecture
 * pure de app_usage_events (14 jours), aucune écriture.
 */

interface Ev { at: string; path: string; visitor: string | null; user_id?: string | null; kind?: string | null }

const DAYS = 14;
/** Temps d'activité : 4 semaines glissantes (demande Channing 04/09). */
const WEEKS = 4;
/** Deux événements séparés de plus de 15 min = deux sessions distinctes. */
const SESSION_GAP_MS = 15 * 60_000;
/** Le battement de présence existe depuis ce jour : avant, la durée n'est
 *  estimée que d'après les changements de page (sous-estimation franche). */
const PULSE_SINCE = '2026-09-04';

/** Lundi 00:00 (heure locale) de la semaine contenant t. */
function mondayOf(t: number): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - dow);
  return d;
}

function fmtMinutes(min: number): string {
  if (min <= 0) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m.toString().padStart(2, '0')}` : `${m} min`;
}

/** Charge tous les événements depuis `since` par pages de 5 000 (le journal
 *  grossit avec les battements). Dégrade sans les colonnes user_id / kind. */
async function loadEvents(since: string): Promise<Ev[]> {
  const out: Ev[] = [];
  let cols = 'at, path, visitor, user_id, kind';
  for (let from = 0; from < 60_000; from += 5000) {
    let res = await supabase.from('app_usage_events').select(cols).gte('at', since).order('at', { ascending: false }).range(from, from + 4999);
    if (res.error && from === 0) {
      cols = 'at, path, visitor, user_id';
      res = await supabase.from('app_usage_events').select(cols).gte('at', since).order('at', { ascending: false }).range(from, from + 4999);
      if (res.error) {
        cols = 'at, path, visitor';
        res = await supabase.from('app_usage_events').select(cols).gte('at', since).order('at', { ascending: false }).range(from, from + 4999);
      }
    }
    const rows = (res.data ?? []) as unknown as Ev[];
    out.push(...rows);
    if (rows.length < 5000) break;
  }
  return out;
}

const PAGE_LABELS: Record<string, string> = {
  '/': 'Accueil', '/workflow': 'Workflow', '/etudes': 'Workflow', '/ventes': 'Workflow (négociations)',
  '/admin': 'Workflow (ventes)', '/admin/history': 'Ventes (historique)', '/ingestion': 'Atelier',
  '/link-generator': 'Atelier (link gen)', '/ingestion/history': 'Historique',
  '/market': 'Market Intelligence', '/veille': 'Veille', '/telemetrie': 'Télémétrie',
};
const pageLabel = (p: string) => PAGE_LABELS[p] ?? p;

export function Telemetrie() {
  const { isAdmin } = useAuth();
  const { count: liveCount, names: liveNames } = useActiveUsers();
  /** Tout le journal des 4 dernières semaines (pages + battements). */
  const [allEvents, setAllEvents] = useState<Ev[]>([]);
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      // user_id / kind (migrations 04/09) — tant que le SQL n'est pas collé,
      // les colonnes manquent : on relit sans elles, le regroupement retombe
      // sur le libellé sans casse (déjà mieux qu'avant).
      const since = mondayOf(Date.now() - (WEEKS - 1) * 7 * 86_400_000).toISOString();
      setAllEvents(await loadEvents(since));
      const { data: profs } = await supabase.from('profiles').select('id, display_name');
      setProfileNames(new Map(((profs ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, (p.display_name ?? '').trim()])));
      setLoading(false);
    };
    void load();
  }, [isAdmin]);

  // Identité = le COMPTE (user_id), sinon le libellé SANS casse.
  const identityKey = (e: Ev) => e.user_id ? `id:${e.user_id}` : `label:${((e.visitor ?? '').trim() || 'inconnu').toLowerCase()}`;
  const identityName = (key: string, labels: Map<string, number>): string => {
    const id = key.startsWith('id:') ? key.slice(3) : null;
    const fromProfile = id ? profileNames.get(id) : '';
    if (fromProfile) return fromProfile;
    const best = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'inconnu';
    return best.charAt(0).toUpperCase() + best.slice(1);
  };

  /** Pages visitées : les 14 derniers jours, événements de page seulement. */
  const events = useMemo(() => {
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    return allEvents.filter((e) => (e.kind ?? 'page') === 'page' && e.at >= since);
  }, [allEvents]);

  /** Temps d'activité par personne et par semaine : sessions = événements
   *  (pages ET battements) d'une même identité séparés de moins de 15 min ;
   *  durée = premier → dernier événement, 1 min minimum. Semaine = celle du
   *  début de session (lundi, heure locale). */
  const weekly = useMemo(() => {
    const weekStarts: number[] = [];
    const thisMonday = mondayOf(Date.now()).getTime();
    for (let i = WEEKS - 1; i >= 0; i--) weekStarts.push(thisMonday - i * 7 * 86_400_000);
    const weekIndex = (t: number) => {
      for (let i = weekStarts.length - 1; i >= 0; i--) if (t >= weekStarts[i]) return i;
      return -1;
    };
    const byId = new Map<string, { times: number[]; labels: Map<string, number> }>();
    for (const e of allEvents) {
      const key = identityKey(e);
      const cur = byId.get(key) ?? { times: [] as number[], labels: new Map<string, number>() };
      cur.times.push(new Date(e.at).getTime());
      const label = (e.visitor ?? '').trim() || 'inconnu';
      cur.labels.set(label, (cur.labels.get(label) ?? 0) + 1);
      byId.set(key, cur);
    }
    const rows = new Map<string, { name: string; minutes: number[]; sessions: number }>();
    for (const [key, d] of byId) {
      const name = identityName(key, d.labels);
      const k = name.toLowerCase();
      const row = rows.get(k) ?? { name, minutes: new Array<number>(WEEKS).fill(0), sessions: 0 };
      const times = [...d.times].sort((a, b) => a - b);
      let start = times[0], last = times[0];
      const close = () => {
        const w = weekIndex(start);
        if (w >= 0) { row.minutes[w] += Math.max(1, (last - start) / 60_000); row.sessions += 1; }
      };
      for (let i = 1; i < times.length; i++) {
        if (times[i] - last > SESSION_GAP_MS) { close(); start = times[i]; }
        last = times[i];
      }
      if (times.length) close();
      rows.set(k, row);
    }
    const list = [...rows.values()]
      .map((r) => ({ ...r, total: r.minutes.reduce((a, b) => a + b, 0) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    const hasPulse = allEvents.some((e) => e.kind === 'pulse');
    return { weekStarts, rows: list, hasPulse };
  }, [allEvents, profileNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const byPage = new Map<string, number>();
    // Identité = le COMPTE (user_id), sinon le libellé SANS casse (constat
    // Channing 04/09 : « channing » / « Channing » comptés deux fois).
    const byVisitor = new Map<string, { count: number; last: string; pages: Map<string, number>; labels: Map<string, number> }>();
    const byDay = new Map<string, number>();
    for (const e of events) {
      const page = pageLabel(e.path);
      byPage.set(page, (byPage.get(page) ?? 0) + 1);
      const label = (e.visitor ?? '').trim() || 'inconnu';
      const key = identityKey(e);
      const cur = byVisitor.get(key) ?? { count: 0, last: e.at, pages: new Map(), labels: new Map() };
      cur.count += 1;
      if (e.at > cur.last) cur.last = e.at;
      cur.pages.set(page, (cur.pages.get(page) ?? 0) + 1);
      cur.labels.set(label, (cur.labels.get(label) ?? 0) + 1);
      byVisitor.set(key, cur);
      const day = e.at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    // Fusion finale par nom affiché (sans casse) : les événements d'avant la
    // migration (sans user_id) rejoignent le compte qui porte le même prénom.
    const merged = new Map<string, { name: string; count: number; last: string; pages: Map<string, number> }>();
    for (const [key, d] of byVisitor) {
      const name = identityName(key, d.labels);
      const k = name.toLowerCase();
      const cur = merged.get(k) ?? { name, count: 0, last: d.last, pages: new Map<string, number>() };
      cur.count += d.count;
      if (d.last > cur.last) cur.last = d.last;
      for (const [p, n] of d.pages) cur.pages.set(p, (cur.pages.get(p) ?? 0) + n);
      merged.set(k, cur);
    }
    return {
      pages: [...byPage.entries()].sort((a, b) => b[1] - a[1]),
      visitors: [...merged.values()].sort((a, b) => b.count - a.count).map((d) => [d.name, d] as const),
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [events, profileNames]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
        <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-slate-700 font-medium">Page réservée aux administrateurs.</p>
      </div>
    );
  }

  const maxPage = stats.pages[0]?.[1] ?? 1;
  const maxDay = Math.max(1, ...stats.days.map(([, n]) => n));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2"><Activity className="w-7 h-7 text-blue-600" /> Télémétrie</h1>
        <p className="text-slate-600 mt-2">Usage réel d'ADA sur les {DAYS} derniers jours — ce qui sert, ce qui dort.</p>
      </div>

      {/* Présence temps réel : qui est sur ADA en ce moment. */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Wifi className="w-4 h-4 text-emerald-500" />
          <span className="font-semibold text-slate-900">Connectés maintenant</span>
          <span className="text-xs font-semibold text-white bg-emerald-500 rounded-full px-2 py-0.5">{liveCount ?? '…'}</span>
          <div className="flex items-center gap-1.5 flex-wrap ml-2">
            {liveNames.length === 0
              ? <span className="text-sm text-slate-400">personne d'identifié</span>
              : liveNames.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  {n}
                </span>
              ))}
          </div>
        </div>
      </section>

      {loading ? <p className="text-sm text-slate-400 py-10 text-center">Chargement…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Événements" value={events.length} />
            <Kpi label="Utilisateurs actifs" value={stats.visitors.length} />
            <Kpi label="Page la plus utilisée" value={stats.pages[0]?.[0] ?? '—'} small />
            <Kpi label="Aujourd'hui" value={stats.days[stats.days.length - 1]?.[1] ?? 0} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900 mb-3">Pages visitées</h2>
              <div className="space-y-2">
                {stats.pages.map(([page, n]) => (
                  <div key={page} className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 w-44 truncate">{page}</span>
                    <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-ocean rounded-full" style={{ width: `${(n / maxPage) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums w-10 text-right">{n}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900 mb-3">Activité par jour</h2>
              <div className="flex items-end gap-1.5 h-32">
                {stats.days.map(([day, n]) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1" title={`${day} : ${n}`}>
                    <div className="w-full bg-brand-atlantique/70 rounded-t" style={{ height: `${(n / maxDay) * 100}%` }} />
                    <span className="text-[9px] text-slate-400">{day.slice(8)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h2 className="font-semibold text-slate-900">Temps d'activité par semaine</h2>
              <span className="text-xs text-slate-500">{WEEKS} semaines glissantes · sessions = événements espacés de moins de 15 min</span>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {weekly.hasPulse
                ? <>Mesuré par battement de présence toutes les 5 min (onglet visible, utilisateur actif). Avant le {new Date(PULSE_SINCE).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}, estimation d'après les seuls changements de page — sous-estimée.</>
                : <>Estimation d'après les changements de page seulement : une longue lecture sans naviguer ne laisse aucune trace. Le battement de présence s'active dès que le SQL du 04/09 est collé.</>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Utilisateur</th>
                    {weekly.weekStarts.map((w, i) => (
                      <th key={w} className="py-2 pr-3 tabular-nums whitespace-nowrap">
                        {i === weekly.weekStarts.length - 1 ? 'Cette semaine' : `Sem. du ${new Date(w).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
                      </th>
                    ))}
                    <th className="py-2 pr-3">Total</th>
                    <th className="py-2">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.rows.length === 0 && (
                    <tr><td colSpan={WEEKS + 3} className="py-4 text-center text-slate-400">Aucune activité sur la période.</td></tr>
                  )}
                  {weekly.rows.map((r) => {
                    const max = Math.max(1, ...r.minutes);
                    return (
                      <tr key={r.name} className="border-b border-slate-100">
                        <td className="py-2 pr-3 font-medium text-slate-900">{r.name}</td>
                        {r.minutes.map((m, i) => (
                          <td key={i} className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                <div className="h-full bg-brand-ocean rounded-full" style={{ width: `${(m / max) * 100}%` }} />
                              </div>
                              <span className="tabular-nums text-slate-700 whitespace-nowrap">{fmtMinutes(m)}</span>
                            </div>
                          </td>
                        ))}
                        <td className="py-2 pr-3 tabular-nums font-semibold text-slate-900 whitespace-nowrap">{fmtMinutes(r.total)}</td>
                        <td className="py-2 tabular-nums text-slate-600">{r.sessions}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-3">Par utilisateur</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Utilisateur</th>
                    <th className="py-2 pr-3">Événements</th>
                    <th className="py-2 pr-3">Dernier passage</th>
                    <th className="py-2">Pages préférées</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.visitors.map(([v, d]) => (
                    <tr key={v} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-900">{v}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-700">{d.count}</td>
                      <td className="py-2 pr-3 text-slate-600">
                        {new Date(d.last).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2 text-slate-600">
                        {[...d.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${p} (${n})`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-bold mt-1 ${small ? 'text-lg' : 'text-3xl tabular-nums'}`}>{value}</div>
    </div>
  );
}
