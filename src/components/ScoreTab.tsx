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

export function ScoreTab() {
  const { isAdmin, organisation, userId } = useAuth();
  const [org, setOrg] = useState<string>(organisation || DEFAULT_ORG);
  const [orgs, setOrgs] = useState<string[]>([organisation || DEFAULT_ORG]);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => { if (isAdmin) void listOrganisations().then((r) => setOrgs(r.names)); }, [isAdmin]);
  const reload = (o: string) => { setLoading(true); void listScoreboard(isAdmin ? o : null).then((r) => { setRows(r.rows); setError(r.error); setAt(new Date()); }).finally(() => setLoading(false)); };
  useEffect(() => { reload(org); }, [org]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = rows.reduce((t, r) => ({ leads: t.leads + r.leads_taken, negos: t.negos + r.negotiations, rdv: t.rdv + r.rdv }), { leads: 0, negos: 0, rdv: 0 });
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Score <span className="text-base font-normal text-slate-500">· {org}</span></h2>
            <p className="text-sm text-slate-500">Leads pris, rendez-vous pris et taux de conversion de chacun. Conversion = rendez-vous pris / négociations lancées.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select value={org} onChange={(e) => setOrg(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-800">
              {[...new Set([org, ...orgs])].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <button onClick={() => reload(org)} className="flex items-center gap-1.5 text-xs text-brand-ocean hover:underline"><RefreshCw className="w-3.5 h-3.5" /> Actualiser{at ? ` · ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</button>
        </div>
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p> : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 px-4">Commercial</th>
                <th className="py-2 px-3 text-right">Leads pris</th>
                <th className="py-2 px-3 text-right">Négociations lancées</th>
                <th className="py-2 px-3 text-right text-emerald-700">Rendez-vous pris</th>
                <th className="py-2 px-4 text-right" title="Rendez-vous pris / négociations lancées">Taux de conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Aucun compte dans cette organisation.</td></tr>}
              {rows.map((r, i) => {
                const conv = conversionRate(r.rdv, r.negotiations);
                const me = r.user_id === userId;
                return (
                  <tr key={r.user_id} className={me ? 'bg-blue-50/50' : ''}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{medal(i) ? <span className="mr-1.5">{medal(i)}</span> : <span className="inline-block w-6 text-slate-400 text-xs">{i + 1}.</span>}{r.display_name}{me ? <span className="ml-1.5 text-[10px] text-brand-ocean border border-blue-200 rounded-full px-1.5">moi</span> : null}{r.is_manager ? <span className="ml-1.5 text-[10px] text-slate-500 border border-slate-200 rounded-full px-1.5">manager</span> : null}</td>
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
                  <td className="py-2 px-4">Organisation</td>
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
