/**
 * ONGLET SCORE (30/10, Channing : « les agents voient vite les stats des autres : leads pris, rendez-vous
 * pris, taux de conversion »). Pour les organisations de prospection : chaque compte de l'organisation,
 * lu par la RPC org_scoreboard (bornée à MON organisation côté base ; un admin choisit l'organisation).
 * Taux de conversion = rendez-vous pris / négociations lancées.
 */
import { useEffect, useState } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listScoreboard, conversionRate, type ScoreRow } from '../services/managerStats';
import { listOrganisations, DEFAULT_ORG } from '../services/organisations';

const ALL = '__toutes__';
/** Premier jour du mois en cours à Paris, en ISO (la base compare des timestamptz). */
function monthStartIso(): string {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value, m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}-01T00:00:00+01:00`;
}
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', month: 'long', year: 'numeric' }).format(new Date());
export function ScoreTab() {
  const { organisation, userId } = useAuth();
  // 09/11 (Channing : « tout le monde voit les scores de tout le monde ») : toutes les organisations par défaut,
  // pour tout compte ; un filtre par organisation reste disponible.
  const [org, setOrg] = useState<string>(ALL);
  const [orgs, setOrgs] = useState<string[]>([organisation || DEFAULT_ORG]);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<Date | null>(null);
  // PÉRIODE (09/11 soir, Channing : « une option monthly, remise à jour tous les mois, et une option All time ») :
  // le mois civil en cours (heure de Paris) par défaut, ou depuis toujours. Retenue sur ce navigateur.
  const [period, setPeriod] = useState<'month' | 'all'>(() => { try { return localStorage.getItem('ada_score_period') === 'all' ? 'all' : 'month'; } catch { return 'month'; } });
  const since = period === 'month' ? monthStartIso() : null;
  useEffect(() => { void listOrganisations().then((r) => { if (r.names.length) setOrgs(r.names); }); }, []);
  const reload = (o: string, s: string | null) => { setLoading(true); void listScoreboard(o === ALL ? null : o, s).then((r) => { setRows(r.rows); setError(r.error); setAt(new Date()); }).finally(() => setLoading(false)); };
  useEffect(() => { reload(org, since); try { localStorage.setItem('ada_score_period', period); } catch { /* rien */ } }, [org, since, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const podium = rows.filter((r) => r.rdv > 0).slice(0, 3);
  const totals = rows.reduce((t, r) => ({ leads: t.leads + r.leads_taken, negos: t.negos + r.negotiations, rdv: t.rdv + r.rdv }), { leads: 0, negos: 0, rdv: 0 });
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Score <span className="text-base font-normal text-slate-500">· {org === ALL ? 'toutes les organisations' : org} · {period === 'month' ? MONTH_LABEL : 'depuis toujours'}</span></h2>
            <p className="text-sm text-slate-500">Leads pris, rendez-vous pris et taux de conversion de chacun. Conversion = rendez-vous pris / négociations lancées.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={org} onChange={(e) => setOrg(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-800">
            <option value={ALL}>Toutes les organisations</option>
            {[...new Set([...orgs, ...rows.map((r) => r.organisation).filter((x): x is string => !!x)])].sort().map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
            <button onClick={() => setPeriod('month')} className={`px-2.5 py-1 rounded-md ${period === 'month' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`} title="Le mois civil en cours : les compteurs repartent de zéro chaque 1er du mois">Ce mois-ci</button>
            <button onClick={() => setPeriod('all')} className={`px-2.5 py-1 rounded-md ${period === 'all' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Depuis toujours</button>
          </div>
          <button onClick={() => reload(org, since)} className="flex items-center gap-1.5 text-xs text-brand-ocean hover:underline"><RefreshCw className="w-3.5 h-3.5" /> Actualiser{at ? ` · ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</button>
        </div>
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {/* PODIUM (09/11 soir, Channing : « un podium de rendez-vous en haut, juste le nombre de rdv pris ») */}
      {!loading && podium.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-w-2xl">
          {[1, 0, 2].map((i) => { const r = podium[i]; const h = i === 0 ? 'h-28' : i === 1 ? 'h-24' : 'h-20'; return (
            <div key={i} className="flex flex-col justify-end">
              {r ? (
                <div className={`rounded-xl border text-center px-2 py-2 flex flex-col justify-end ${h} ${i === 0 ? 'bg-amber-50 border-amber-300' : i === 1 ? 'bg-slate-50 border-slate-300' : 'bg-orange-50 border-orange-200'}`}>
                  <span className="text-2xl leading-none">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                  <span className="text-sm font-semibold text-slate-900 truncate mt-1">{r.display_name}{r.user_id === userId ? ' (moi)' : ''}</span>
                  <span className="text-xs text-slate-500 truncate">{org === ALL && r.organisation ? r.organisation : ''}</span>
                  <span className="text-xl font-bold text-emerald-700 tabular-nums leading-tight">{r.rdv} <span className="text-xs font-medium text-emerald-700/80">rdv</span></span>
                </div>
              ) : <div className={h} />}
            </div>
          ); })}
        </div>
      )}
      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p> : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 px-4">Commercial</th>
                {org === ALL && <th className="py-2 px-3">Organisation</th>}
                <th className="py-2 px-3 text-right">Leads pris</th>
                <th className="py-2 px-3 text-right">Négociations lancées</th>
                <th className="py-2 px-3 text-right text-emerald-700">Rendez-vous pris</th>
                <th className="py-2 px-4 text-right" title="Rendez-vous pris / négociations lancées">Taux de conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Aucun compte dans cette organisation.</td></tr>}
              {rows.map((r, i) => {
                const conv = conversionRate(r.rdv, r.negotiations);
                const me = r.user_id === userId;
                return (
                  <tr key={r.user_id} className={me ? 'bg-blue-50/50' : ''}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{medal(i) ? <span className="mr-1.5">{medal(i)}</span> : <span className="inline-block w-6 text-slate-400 text-xs">{i + 1}.</span>}{r.display_name}{me ? <span className="ml-1.5 text-[10px] text-brand-ocean border border-blue-200 rounded-full px-1.5">moi</span> : null}{r.is_manager ? <span className="ml-1.5 text-[10px] text-slate-500 border border-slate-200 rounded-full px-1.5">manager</span> : null}</td>
                    {org === ALL && <td className="py-2.5 px-3 text-slate-600">{r.organisation ?? '—'}</td>}
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-800">{r.leads_taken || '—'}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{r.negotiations || '—'}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-700">{r.rdv || '—'}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-slate-700">{conv == null ? '—' : `${conv} %`}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="text-xs text-slate-500 border-t border-slate-200">
                  <td className="py-2 px-4">{org === ALL ? 'Total' : 'Organisation'}</td>
                  {org === ALL && <td className="py-2 px-3" />}
                  <td className="py-2 px-3 text-right tabular-nums">{totals.leads}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{totals.negos}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{totals.rdv}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{conversionRate(totals.rdv, totals.negos) == null ? '—' : `${conversionRate(totals.rdv, totals.negos)} %`}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
