import { useEffect, useState } from 'react';
import { ExternalLink, Check, EyeOff, RotateCcw, Loader2, GraduationCap, ArrowUpRight, Image as ImageIcon } from 'lucide-react';
import { listLearningCases, setLearningCaseStatus, KIND_LABEL, ACTOR_LABEL, type LearningCase, type LearningActor } from '../services/learningCases';
import { startCampaign } from '../services/campaignRunner';
import { useAuth } from '../services/auth';
import { AssignTask } from './AssignTask';

/**
 * BOÎTE À APPRENDRE (01/10 → 02/10, décision Channing) : tout ce qui attend
 * une action de correction, d'où que ça vienne — cas du worker (vitrines,
 * relevés vides, services bloqués, sites en échec, tableur, mails),
 * signalements de l'équipe, lacunes de campagne. Chaque cas dit qui agit et
 * où aller ; « Fait » note la résolution pour la mémoire.
 */
export function LearningBox() {
  const { displayName, email } = useAuth();
  const [cases, setCases] = useState<LearningCase[]>([]);
  const [filter, setFilter] = useState<'open' | 'done' | 'ignored' | 'all'>('open');
  const [actor, setActor] = useState<LearningActor | 'tous'>('tous');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  // « Confier à… » depuis un cas : préremplit le panneau des tâches (02/10).
  const [prefill, setPrefill] = useState<{ title: string; note?: string; link?: string | null } | null>(null);

  const load = async (f = filter) => {
    setLoading(true);
    const r = await listLearningCases(f);
    setCases(r.cases); setError(r.error); setLoading(false);
  };
  useEffect(() => { void load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (c: LearningCase, status: 'open' | 'done' | 'ignored') => {
    let resolution: string | undefined;
    if (status === 'done' && c.source === 'box') { const r = window.prompt('Comment ce cas a été réglé ? (une ligne, pour la mémoire)', c.resolution ?? ''); if (r == null) return; resolution = r; }
    setBusy(c.id);
    const err = await setLearningCaseStatus(c, status, resolution, displayName || email || '');
    if (err) setError(err);
    await load();
    setBusy(null);
  };

  const go = (link: string) => { window.history.pushState({}, '', link); window.dispatchEvent(new PopStateEvent('popstate')); };

  // RE-TEST DES LACUNES (02/10) : après une correction de classe (ex. le
  // modèle structuré « CLA 200 » confirme « CLASSE CLA »), toutes les lacunes
  // ouvertes repartent en campagne, telles quelles (plan explicite, pas de
  // planificateur) ; celles qui se confirment écrivent la mémoire et
  // disparaissent d'elles-mêmes de la boîte.
  const gaps = cases.filter((c) => c.source === 'campaign' && c.status === 'open');
  const [retesting, setRetesting] = useState(false);
  const retestGaps = async () => {
    if (gaps.length === 0) return;
    if (!window.confirm(`Relancer ${gaps.length} lacune${gaps.length > 1 ? 's' : ''} en campagne ? (~${Math.round(gaps.length * 18 / 60)} min, ${gaps.length} appels Zyte)`)) return;
    setRetesting(true);
    const plan = gaps.map((c) => {
      const d = c.detail as { site: string; brand: string; model: string; fuel: string | null; year: number | null; trim: string | null };
      return { site: d.site, brand: d.brand, model: d.model, ...(d.fuel ? { fuel: d.fuel } : {}), ...(d.year ? { year: d.year } : {}), ...(d.trim ? { trim: d.trim } : {}), kind: 'exploration' as const, reason: 're-test boîte à apprendre' };
    });
    const r = await startCampaign({ sites: [...new Set(plan.map((p) => p.site))], total: plan.length, plan, label: `Re-test boîte à apprendre ${new Date().toISOString().slice(0, 16)}` });
    setRetesting(false);
    if (!r.started) setError(r.reason ?? 'Lancement impossible');
    else go('/link-generator');
  };
  const fmt = (s: string) => new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const shown = cases.filter((c) => actor === 'tous' || c.actor === actor);
  const nEquipe = cases.filter((c) => c.actor === 'equipe').length;
  const nDev = cases.filter((c) => c.actor === 'dev').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-500 flex items-center gap-1.5"><GraduationCap className="w-4 h-4 text-emerald-600" /> Tout ce qui attend une action de correction : cas rencontrés par ADA, signalements de l'équipe, lacunes de campagne.</p>
        <div className="ml-auto flex flex-wrap gap-1">
          {gaps.length > 0 && filter === 'open' && (
            <button onClick={() => void retestGaps()} disabled={retesting} title="Relance toutes les lacunes de campagne ouvertes, telles quelles ; celles qui se confirment disparaissent de la boîte" className="px-2.5 py-1 rounded-full text-xs border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60 flex items-center gap-1">
              {retesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Re-tester les {gaps.length} lacunes en campagne
            </button>
          )}
          <span className="w-px bg-slate-200 mx-1" />
          {(['tous', 'equipe', 'dev'] as const).map((a) => (
            <button key={a} onClick={() => setActor(a)} className={`px-2.5 py-1 rounded-full text-xs border ${actor === a ? 'bg-emerald-700 border-emerald-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {a === 'tous' ? 'Tous' : a === 'equipe' ? `Équipe · ${nEquipe}` : `Développement · ${nDev}`}
            </button>
          ))}
          <span className="w-px bg-slate-200 mx-1" />
          {(['open', 'done', 'ignored', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs border ${filter === f ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {f === 'open' ? 'À traiter' : f === 'done' ? 'Faits' : f === 'ignored' ? 'Ignorés' : 'Tous'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</p>
        : shown.length === 0 ? <p className="text-sm text-slate-500 py-6 text-center">Rien à traiter{filter === 'open' ? ' : la boîte est vide.' : '.'}</p>
          : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {shown.map((c) => {
                const d = (c.detail ?? {}) as { pageTitle?: string | null; hints?: string[]; error?: string; why?: string; client?: string; detail?: string };
                const info = d.error ?? d.why ?? d.detail ?? null;
                return (
                  <li key={c.id} className="p-3 flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-2">
                        {KIND_LABEL[c.kind] ?? c.kind}
                        <span className={`normal-case tracking-normal rounded-full px-1.5 py-0.5 text-[10px] font-medium ${c.actor === 'equipe' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>{ACTOR_LABEL[c.actor]}</span>
                      </p>
                      <p className="font-medium text-slate-900 break-words">{c.title}</p>
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-brand-ocean hover:underline inline-flex items-center gap-1 break-all">{c.url}<ExternalLink className="w-3 h-3 shrink-0" /></a>}
                      <p className="text-xs text-slate-500 mt-1">
                        {d.pageTitle && <>« {d.pageTitle} » · </>}
                        {d.hints && (d.hints.length > 0 ? <>indices : {d.hints.join(', ')} · </> : <>aucun indice technique repéré · </>)}
                        {info && <>{String(info).slice(0, 200)} · </>}
                        {c.seen_count > 1 ? `vu ${c.seen_count} fois, dernière le ${fmt(c.last_seen_at)}` : `le ${fmt(c.last_seen_at)}`}{c.submitted_by ? ` · ${c.submitted_by}` : ''}
                      </p>
                      {c.resolution && <p className="text-xs text-emerald-700 mt-1">Réglé : {c.resolution}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      {c.screenshot && <button onClick={() => setShot(c.screenshot!)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><ImageIcon className="w-3.5 h-3.5" /> Capture</button>}
                      {c.link && <button onClick={() => go(c.link!)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><ArrowUpRight className="w-3.5 h-3.5" /> Ouvrir</button>}
                      {c.status === 'open' && <button onClick={() => { setPrefill({ title: c.title, note: (c.detail as { client?: string } | null)?.client ? `Client « ${(c.detail as { client?: string }).client} » à créer dans les contacts (ou corriger le nom dans le tableur).` : '', link: c.url ?? c.link ?? null }); document.getElementById('assign-task-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} title="Préremplit « Confier une tâche » en bas de page" className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100">Confier à…</button>}
                      {c.status !== 'done' && <button disabled={busy === c.id} onClick={() => void act(c, 'done')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><Check className="w-3.5 h-3.5" /> Fait</button>}
                      {c.status === 'open' && c.source === 'box' && <button disabled={busy === c.id} onClick={() => void act(c, 'ignored')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><EyeOff className="w-3.5 h-3.5" /> Ignorer</button>}
                      {c.status !== 'open' && c.source !== 'campaign' && <button disabled={busy === c.id} onClick={() => void act(c, 'open')} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"><RotateCcw className="w-3.5 h-3.5" /> Rouvrir</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      {/* Tâches par compte (02/10) : confier, suivre, supprimer. */}
      <div className="pt-4 border-t border-slate-200">
        <AssignTask prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
      </div>
      {shot && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShot(null)}>
          <img src={shot} alt="capture du signalement" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  );
}
