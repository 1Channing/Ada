import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarCheck, ChevronRight, ExternalLink, MessageSquare, RefreshCw, Share2, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listOrganisations, DEFAULT_ORG } from '../services/organisations';
import { listTeamMembers, listTeamNegotiations, listTeamAnalyses, isOpenTeamNego, TEAM_OUTCOME_LABEL, type TeamMember, type TeamNegotiation, type TeamAnalyses } from '../services/managerStats';
import { readNote, agoLabel } from '../lib/noteJournal';
import { fmtPhone } from '../lib/phoneKey';

/**
 * STATISTIQUES (12/10 soir) — l'onglet du MANAGER d'une organisation : les
 * chiffres de prospection de ses commerciaux, et le détail derrière chaque
 * chiffre (négociations avec notes et URL, analyses lancées, rendez-vous
 * pris, Open space). Un admin voit l'organisation de son choix. La base
 * borne tout à l'organisation (RPC manager_*) : la page n'affiche que ce
 * qu'elle reçoit.
 */
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
const fmtEur = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString('fr-FR')} €`);

interface MemberStats {
  m: TeamMember;
  negos: TeamNegotiation[];
  open: number; openSpace: number; rdv: number; flux: number; noCallback: number; unavailable: number; deleted: number; closed: number;
  analyses: TeamAnalyses | null;
  lastActivity: string | null;
}

export function Statistiques() {
  const { isAdmin, isManager, organisation } = useAuth();
  const allowed = isAdmin || isManager;
  // Admin : choix de l'organisation ; manager : la sienne, imposée par la base.
  const [org, setOrg] = useState<string>(organisation || DEFAULT_ORG);
  const [orgs, setOrgs] = useState<string[]>([organisation || DEFAULT_ORG]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [negos, setNegos] = useState<TeamNegotiation[]>([]);
  const [analyses, setAnalyses] = useState<TeamAnalyses[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { if (isAdmin) void listOrganisations().then((r) => setOrgs(r.names)); }, [isAdmin]);
  const reload = async (o: string) => {
    setLoading(true);
    const [m, n, a] = await Promise.all([listTeamMembers(isAdmin ? o : null), listTeamNegotiations(isAdmin ? o : null), listTeamAnalyses(isAdmin ? o : null)]);
    setMembers(m.rows); setNegos(n.rows); setAnalyses(a.rows);
    setError(m.error ?? n.error ?? a.error);
    setAt(new Date()); setLoading(false);
  };
  useEffect(() => { if (allowed) void reload(org); }, [org, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo<MemberStats[]>(() => {
    const byUser = new Map<string, TeamNegotiation[]>();
    for (const n of negos) byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);
    const anBy = new Map(analyses.map((a) => [a.user_id, a]));
    // Un compte dont le profil manque mais qui a des négociations apparaît quand même.
    const ids = [...new Set([...members.map((m) => m.id), ...byUser.keys()])];
    return ids.map((id) => {
      const m = members.find((x) => x.id === id) ?? { id, display_name: byUser.get(id)?.[0]?.owner_name ?? 'collègue', email: null, organisation: org, is_manager: false, created_at: null };
      const list = (byUser.get(id) ?? []).slice().sort((x, y) => y.updated_at.localeCompare(x.updated_at));
      const count = (o: string) => list.filter((n) => n.status === 'archived' && n.outcome === o).length;
      return {
        m, negos: list,
        open: list.filter(isOpenTeamNego).length,
        openSpace: list.filter((n) => isOpenTeamNego(n) && n.in_open_space).length,
        rdv: count('rdv'), flux: count('flux'), noCallback: count('no_callback'), unavailable: count('unavailable'), deleted: count('deleted'),
        closed: list.filter((n) => n.status === 'closed').length,
        analyses: anBy.get(id) ?? null,
        lastActivity: list[0]?.updated_at ?? anBy.get(id)?.last_at ?? null,
      };
    }).sort((a, b) => (b.open + b.rdv) - (a.open + a.rdv) || a.m.display_name.localeCompare(b.m.display_name, 'fr'));
  }, [members, negos, analyses, org]);

  const totals = useMemo(() => ({
    open: stats.reduce((s, x) => s + x.open, 0),
    openSpace: stats.reduce((s, x) => s + x.openSpace, 0),
    rdv: stats.reduce((s, x) => s + x.rdv, 0),
    analyses: stats.reduce((s, x) => s + (x.analyses?.total ?? 0), 0),
    today: stats.reduce((s, x) => s + (x.analyses?.today ?? 0), 0),
    week: stats.reduce((s, x) => s + (x.analyses?.week ?? 0), 0),
  }), [stats]);
  const rdvList = useMemo(() => negos.filter((n) => n.status === 'archived' && n.outcome === 'rdv').sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? '')), [negos]);
  const openSpaceList = useMemo(() => negos.filter((n) => isOpenTeamNego(n) && n.in_open_space), [negos]);

  if (!allowed) return <p className="text-sm text-slate-500 py-10 text-center">Page réservée aux managers d'organisation.</p>;

  const Tile = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="text-3xl font-bold tabular-nums mt-1 text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
  const stateBadge = (n: TeamNegotiation) => {
    const label = n.status === 'archived' ? (TEAM_OUTCOME_LABEL[n.outcome ?? ''] ?? 'archivée') : n.status === 'pushed_to_sale' ? 'poussée en vente' : n.status === 'closed' ? 'clôturée' : 'en cours';
    const cls = n.outcome === 'rdv' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : n.outcome === 'no_callback' ? 'bg-rose-50 text-rose-700 border-rose-200' : n.outcome === 'flux' ? 'bg-amber-50 text-amber-700 border-amber-200' : n.status === 'archived' || n.status === 'closed' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200';
    return <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 border shrink-0 ${cls}`}>{label}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-brand-ocean" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Statistiques <span className="text-base font-normal text-slate-500">· {org}</span></h1>
            <p className="text-sm text-slate-500">La prospection de tes commerciaux : négociations, analyses lancées, rendez-vous pris, Open space.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select value={org} onChange={(e) => setOrg(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-800">
              {[...new Set([org, ...orgs])].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <button onClick={() => void reload(org)} className="flex items-center gap-1.5 text-xs text-brand-ocean hover:underline"><RefreshCw className="w-3.5 h-3.5" /> Actualiser{at ? ` · ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</button>
        </div>
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile icon={<MessageSquare className="w-4 h-4 text-blue-600" />} label="Négociations en cours" value={totals.open} sub={`${stats.length} commercia${stats.length > 1 ? 'ux' : 'l'}`} />
            <Tile icon={<CalendarCheck className="w-4 h-4 text-emerald-600" />} label="Rendez-vous pris" value={totals.rdv} sub="depuis l'ouverture des comptes" />
            <Tile icon={<Sparkles className="w-4 h-4 text-violet-600" />} label="Analyses lancées" value={totals.analyses} sub={`aujourd'hui ${totals.today} · 7 jours ${totals.week}`} />
            <Tile icon={<Share2 className="w-4 h-4 text-violet-600" />} label="Dans l'Open space" value={totals.openSpace} sub="annonces partagées en cours" />
          </div>

          {/* Par commercial : une ligne, le détail derrière. */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 px-4 py-3">
              <Users className="w-4 h-4 text-brand-ocean" />
              <h2 className="text-sm font-semibold text-slate-700">Par commercial</h2>
              <span className="text-xs text-slate-400">clique une ligne pour voir ses négociations, notes et annonces</span>
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-2 px-4">Commercial</th>
                    <th className="py-2 px-2 text-right">En cours</th>
                    <th className="py-2 px-2 text-right">Open space</th>
                    <th className="py-2 px-2 text-right" title="Analyses d'annonces lancées : total · 7 jours · aujourd'hui">Analyses</th>
                    <th className="py-2 px-2 text-right text-emerald-700">RDV pris</th>
                    <th className="py-2 px-2 text-right">Flux</th>
                    <th className="py-2 px-2 text-right">Sans rappel</th>
                    <th className="py-2 px-2 text-right">Plus dispo</th>
                    <th className="py-2 px-2 text-right">Suppr.</th>
                    <th className="py-2 px-4 text-right">Dernière activité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-400">Aucun compte dans cette organisation.</td></tr>}
                  {stats.map((s) => {
                    const isOpen = openId === s.m.id;
                    return (
                      <>
                        <tr key={s.m.id} onClick={() => setOpenId(isOpen ? null : s.m.id)} className="cursor-pointer hover:bg-slate-50">
                          <td className="py-2 px-4 font-medium text-slate-800">
                            <span className="flex items-center gap-1.5"><ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />{s.m.display_name}{s.m.is_manager ? <span className="text-[10px] text-slate-500 border border-slate-200 rounded-full px-1.5">manager</span> : null}</span>
                            {s.m.created_at && <span className="block pl-5 text-[11px] text-slate-400">compte ouvert le {fmtDate(s.m.created_at)}</span>}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold text-slate-800">{s.open}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{s.openSpace || '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-700">{s.analyses ? <>{s.analyses.total}<span className="text-slate-400"> · {s.analyses.week} · {s.analyses.today}</span></> : '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-semibold text-emerald-700">{s.rdv || '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{s.flux || '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{s.noCallback || '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{s.unavailable || '—'}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{s.deleted || '—'}</td>
                          <td className="py-2 px-4 text-right text-slate-500 whitespace-nowrap">{s.lastActivity ? `${fmtDate(s.lastActivity)} · ${agoLabel(new Date(s.lastActivity))}` : 'jamais'}</td>
                        </tr>
                        {isOpen && (
                          <tr key={`${s.m.id}-detail`}>
                            <td colSpan={10} className="bg-slate-50/70 px-4 py-3">
                              {s.negos.length === 0 ? <p className="text-slate-400">Aucune négociation.</p> : (
                                <div className="space-y-1.5">
                                  {s.negos.map((n) => {
                                    const note = readNote(n.notes);
                                    return (
                                      <div key={n.id} className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {n.listing_url?.startsWith('http')
                                            ? <a href={n.listing_url} target="_blank" rel="noreferrer" className="font-medium text-brand-ocean hover:underline truncate flex items-center gap-1">{n.title || 'Sans titre'} <ExternalLink className="w-3 h-3 shrink-0" /></a>
                                            : <span className="font-medium text-slate-800 truncate">{n.title || 'Sans titre'}</span>}
                                          {stateBadge(n)}
                                          {n.in_open_space && isOpenTeamNego(n) && <span className="flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5"><Share2 className="w-3 h-3" /> Open space</span>}
                                          <span className="ml-auto text-slate-500 shrink-0">{n.negotiated_price != null ? `négocié ${fmtEur(n.negotiated_price)}` : n.asking_price != null ? `affiché ${fmtEur(n.asking_price)}` : ''}</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-0.5">
                                          ajoutée le {fmtDate(n.created_at)}{n.archived_at ? ` · ${TEAM_OUTCOME_LABEL[n.outcome ?? ''] ?? 'archivée'} le ${fmtDate(n.archived_at)}` : ''}{n.phone ? ` · vendeur ${fmtPhone(n.phone)}` : ''}{n.photos_count ? ` · ${n.photos_count} photo${n.photos_count > 1 ? 's' : ''}` : ''}
                                        </p>
                                        {note.text && <p className="text-[11px] text-slate-600 mt-0.5 whitespace-pre-wrap"><span className="text-slate-400">note{note.at ? ` ${agoLabel(note.at)}` : ''} · </span>{note.text.slice(0, 600)}</p>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Rendez-vous pris : les réussites. */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3"><CalendarCheck className="w-4 h-4 text-emerald-600" /><h2 className="text-sm font-semibold text-slate-700">Rendez-vous pris ({rdvList.length})</h2></div>
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {rdvList.length === 0 && <p className="px-4 py-4 text-xs text-slate-400">Aucun pour l'instant — depuis la flèche d'après appel : « Rendez-vous pris ! ».</p>}
                {rdvList.slice(0, 50).map((n) => (
                  <div key={n.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                    <span className="text-slate-400 w-16 shrink-0">{fmtDate(n.archived_at)}</span>
                    <span className="font-medium text-slate-700 w-24 truncate shrink-0">{n.owner_name}</span>
                    {n.listing_url?.startsWith('http') ? <a href={n.listing_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline truncate">{n.title}</a> : <span className="text-slate-700 truncate">{n.title}</span>}
                    {n.phone && <span className="ml-auto text-slate-400 shrink-0">{fmtPhone(n.phone)}</span>}
                  </div>
                ))}
              </div>
            </div>
            {/* Open space de l'organisation : ce que l'équipe a partagé. */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3"><Share2 className="w-4 h-4 text-violet-600" /><h2 className="text-sm font-semibold text-slate-700">Open space ({openSpaceList.length})</h2></div>
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {openSpaceList.length === 0 && <p className="px-4 py-4 text-xs text-slate-400">Rien de partagé en cours.</p>}
                {openSpaceList.slice(0, 50).map((n) => (
                  <div key={n.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                    <span className="font-medium text-slate-700 w-24 truncate shrink-0">{n.owner_name}</span>
                    {n.listing_url?.startsWith('http') ? <a href={n.listing_url} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline truncate">{n.title}</a> : <span className="text-slate-700 truncate">{n.title}</span>}
                    <span className="ml-auto text-slate-400 shrink-0">{readNote(n.notes).at ? `note ${agoLabel(readNote(n.notes).at!)}` : fmtDate(n.updated_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
