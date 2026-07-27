import { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../services/auth';

/**
 * Télémétrie d'usage (ADMIN) — qui utilise quoi, quand : pages visitées,
 * activité par utilisateur et par jour, dernier passage de chacun. Lecture
 * pure de app_usage_events (14 jours), aucune écriture.
 */

interface Ev { at: string; path: string; visitor: string | null }

const DAYS = 14;

const PAGE_LABELS: Record<string, string> = {
  '/': 'Accueil', '/workflow': 'Workflow', '/etudes': 'Workflow', '/ventes': 'Ventes',
  '/admin': 'Ventes', '/admin/history': 'Ventes (historique)', '/ingestion': 'Atelier',
  '/link-generator': 'Atelier (link gen)', '/ingestion/history': 'Historique',
  '/market': 'Market Intelligence', '/veille': 'Veille', '/telemetrie': 'Télémétrie',
};
const pageLabel = (p: string) => PAGE_LABELS[p] ?? p;

export function Telemetrie() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    supabase
      .from('app_usage_events')
      .select('at, path, visitor')
      .gte('at', since)
      .order('at', { ascending: false })
      .limit(8000)
      .then(({ data }) => { setEvents((data ?? []) as Ev[]); setLoading(false); });
  }, [isAdmin]);

  const stats = useMemo(() => {
    const byPage = new Map<string, number>();
    const byVisitor = new Map<string, { count: number; last: string; pages: Map<string, number> }>();
    const byDay = new Map<string, number>();
    for (const e of events) {
      const page = pageLabel(e.path);
      byPage.set(page, (byPage.get(page) ?? 0) + 1);
      const v = (e.visitor ?? 'inconnu').trim() || 'inconnu';
      const cur = byVisitor.get(v) ?? { count: 0, last: e.at, pages: new Map() };
      cur.count += 1;
      if (e.at > cur.last) cur.last = e.at;
      cur.pages.set(page, (cur.pages.get(page) ?? 0) + 1);
      byVisitor.set(v, cur);
      const day = e.at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return {
      pages: [...byPage.entries()].sort((a, b) => b[1] - a[1]),
      visitors: [...byVisitor.entries()].sort((a, b) => b[1].count - a[1].count),
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [events]);

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
