import { useEffect, useState } from 'react';
import { Users, Shield, Plus, Trash2, ChevronRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../services/auth';
import { APP_TABS } from '../lib/appTabs';

/**
 * Page ÉQUIPE (admin) — demande Channing 30/08 :
 * 1. Comptes : clic sur un compte → activer/désactiver chaque onglet de
 *    l'app pour cet utilisateur (l'onglet apparaît/disparaît chez lui à son
 *    prochain chargement d'ADA). Convention : NULL = tout (un onglet ajouté
 *    plus tard apparaît de lui-même) ; les admins voient toujours tout.
 * 2. Adresses autorisées à s'inscrire (auth_allowlist) — tant que la liste
 *    est vide, l'inscription reste libre (fail-open, migration 30/08).
 */

interface Account {
  id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  is_admin: boolean;
  allowed_tabs: string[] | null;
  created_at: string;
  last_sign_in_at: string | null;
  /** Dernier événement de page de la télémétrie (visitor = prénom) — la
   *  VRAIE activité ; last_sign_in_at ne bouge qu'à une saisie du mot de
   *  passe, la session restant ouverte des semaines. */
  last_activity_at?: string | null;
}

interface AllowRow { email: string; note: string | null; created_at: string }

/** Études quotidiennes de tous les comptes (RPC admin, migration 31/08). */
interface TeamSearch {
  id: string; user_id: string; label: string; brand: string; model: string;
  source_country: string; target_country: string; fuel: string;
  vehicle_type: string; active: boolean; last_run_at: string | null; created_at: string;
}

/** Négociations de tous les comptes (RPC admin, migration 31/08). */
interface TeamNego {
  id: string; user_id: string; title: string; listing_url: string;
  asking_price: number | null; negotiated_price: number | null;
  status: string; notes: string; updated_at: string; created_at: string;
}

export function Equipe() {
  const { isAdmin, userId } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allow, setAllow] = useState<AllowRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  // null = RPC absente (migration pas encore collée) → sections masquées.
  const [searches, setSearches] = useState<TeamSearch[] | null>(null);
  const [negos, setNegos] = useState<TeamNego[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');

  const reload = async () => {
    setError(null);
    const [{ data: acc, error: e1 }, { data: al, error: e2 }, sr, ng] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_accounts' as never) as any,
      supabase.from('auth_allowlist').select('email, note, created_at').order('created_at'),
      // Activité par compte (migration 31/08) — dégradation propre tant que
      // le SQL n'est pas collé : sections simplement absentes, pas d'erreur.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_daily_searches' as never) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_negotiations' as never) as any,
    ]);
    if (e1) setError(`Comptes : ${e1.message} — la migration 20260830120000 est-elle appliquée ?`);
    else setAccounts((acc ?? []) as Account[]);
    if (e2) setError((prev) => prev ?? `Liste d'inscription : ${e2.message}`);
    else setAllow((al ?? []) as AllowRow[]);
    setSearches(sr.error ? null : ((sr.data ?? []) as TeamSearch[]));
    setNegos(ng.error ? null : ((ng.data ?? []) as TeamNego[]));
    setLoading(false);
  };
  useEffect(() => { void reload(); }, []);

  if (!isAdmin) {
    return <p className="text-sm text-slate-500 py-10 text-center">Page réservée aux admins.</p>;
  }

  const saveTabs = async (a: Account, tabs: string[] | null) => {
    // Optimiste : l'UI répond au clic, la base suit ; on recharge derrière.
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, allowed_tabs: tabs } : x)));
    const { error: err } = await supabase.from('profiles').update({ allowed_tabs: tabs }).eq('id', a.id);
    if (err) { setError(err.message); void reload(); }
  };

  const toggleTab = (a: Account, key: string) => {
    const all = APP_TABS.map((t) => t.key as string);
    const current = a.allowed_tabs ?? all;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    // Tout coché → NULL (= tout, y compris les onglets futurs).
    void saveTabs(a, next.length === all.length ? null : next);
  };

  const toggleAdmin = async (a: Account) => {
    if (a.id === userId) return; // jamais se rétrograder soi-même
    const next = !a.is_admin;
    if (!confirm(next
      ? `Donner les droits ADMIN à ${a.email} ? (Truth Center, Télémétrie, Équipe, tous les onglets)`
      : `Retirer les droits admin à ${a.email} ?`)) return;
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, is_admin: next } : x)));
    const { error: err } = await supabase.from('profiles').update({ is_admin: next }).eq('id', a.id);
    if (err) { setError(err.message); void reload(); }
  };

  const addAllow = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const { error: err } = await supabase.from('auth_allowlist').insert({ email, note: newNote.trim() || null });
    if (err) { setError(err.message); return; }
    setNewEmail(''); setNewNote('');
    void reload();
  };

  const removeAllow = async (email: string) => {
    if (!confirm(`Retirer ${email} des adresses autorisées ?${allow.length === 1 ? '\n\nAttention : liste vide = inscription redevient LIBRE (fail-open).' : ''}`)) return;
    const { error: err } = await supabase.from('auth_allowlist').delete().eq('email', email);
    if (err) setError(err.message);
    void reload();
  };

  const nameOf = (a: Account) =>
    [a.first_name, a.last_name].filter(Boolean).join(' ') || a.display_name || a.email.split('@')[0];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-brand-ocean" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Équipe</h1>
          <p className="text-sm text-slate-500">Comptes, onglets visibles par personne, et adresses autorisées à s'inscrire.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>}

      {/* ── Comptes ── */}
      {!loading && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Comptes ({accounts.length})</h2>
          {accounts.map((a) => {
            const isOpen = openId === a.id;
            const all = APP_TABS.map((t) => t.key as string);
            const visible = a.is_admin ? all : (a.allowed_tabs ?? all);
            return (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <button
                  onClick={() => setOpenId(isOpen ? null : a.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${isOpen ? 'rounded-t-xl' : 'rounded-xl'}`}
                >
                  <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="font-medium text-slate-900">{nameOf(a)}</span>
                  <span className="text-xs text-slate-500 truncate">{a.email}</span>
                  {a.is_admin && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-brand-ocean bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 shrink-0">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400 shrink-0">
                    {visible.length === all.length ? 'tous les onglets' : `${visible.length}/${all.length} onglets`}
                    {(() => {
                      // La plus récente des deux traces : activité télémétrie
                      // (la vraie) ou saisie du mot de passe (repli).
                      const t = [a.last_activity_at, a.last_sign_in_at]
                        .filter((d): d is string => Boolean(d))
                        .map((d) => new Date(d).getTime());
                      return t.length
                        ? ` · actif le ${new Date(Math.max(...t)).toLocaleDateString('fr-FR')}`
                        : ' · jamais connecté';
                    })()}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 p-4 space-y-3">
                    {a.is_admin ? (
                      <p className="text-xs text-slate-500">Compte admin : accès complet, non restreignable. {a.id !== userId ? 'Retire d’abord les droits admin pour piloter ses onglets.' : '(C’est toi.)'}</p>
                    ) : (
                      <>
                        <p className="text-xs text-slate-500">Onglets visibles pour ce compte — un onglet décoché disparaît de son bandeau (effet à son prochain chargement d'ADA). Accueil reste toujours accessible.</p>
                        <div className="flex flex-wrap gap-2">
                          {APP_TABS.map((t) => {
                            const on = (a.allowed_tabs ?? all).includes(t.key);
                            return (
                              <button
                                key={t.key}
                                onClick={() => toggleTab(a, t.key)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                  on
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                                    : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 line-through'
                                }`}
                              >
                                {on && <CheckCircle2 className="w-3.5 h-3.5" />}
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {searches && (() => {
                      const mine = searches.filter((s) => s.user_id === a.id);
                      if (mine.length === 0) return (
                        <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">Aucune étude quotidienne.</p>
                      );
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-xs font-semibold text-slate-700">Études quotidiennes ({mine.length})</p>
                          {mine.map((s) => (
                            <div key={s.id} className="flex items-center gap-2 text-xs text-slate-600">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              <span className="font-medium text-slate-800 truncate">
                                {s.label || `${s.brand} ${s.model}`.trim()}
                              </span>
                              <span className="text-slate-400 shrink-0">
                                {s.source_country} → {s.target_country}{s.fuel ? ` · ${s.fuel}` : ''}
                              </span>
                              <span className="ml-auto text-slate-400 shrink-0">
                                {s.active
                                  ? (s.last_run_at ? `passée le ${new Date(s.last_run_at).toLocaleDateString('fr-FR')}` : 'jamais passée')
                                  : 'en pause'}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {negos && (() => {
                      const open = negos.filter((n) => n.user_id === a.id && n.status !== 'closed');
                      const done = negos.filter((n) => n.user_id === a.id && n.status === 'closed').length;
                      if (open.length === 0) return (
                        <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
                          Aucune négociation en cours{done > 0 ? ` (${done} clôturée${done > 1 ? 's' : ''})` : ''}.
                        </p>
                      );
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-2">
                          <p className="text-xs font-semibold text-slate-700">
                            Négociations en cours ({open.length}){done > 0 ? <span className="font-normal text-slate-400"> · {done} clôturée{done > 1 ? 's' : ''}</span> : null}
                          </p>
                          {open.map((n) => (
                            <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                {n.listing_url
                                  ? <a href={n.listing_url} target="_blank" rel="noreferrer" className="font-medium text-brand-ocean hover:underline truncate">{n.title || 'Sans titre'}</a>
                                  : <span className="font-medium text-slate-800 truncate">{n.title || 'Sans titre'}</span>}
                                <span className="ml-auto text-slate-500 shrink-0">
                                  {n.negotiated_price != null
                                    ? `négocié ${n.negotiated_price.toLocaleString('fr-FR')} €`
                                    : n.asking_price != null
                                      ? `affiché ${n.asking_price.toLocaleString('fr-FR')} €`
                                      : ''}
                                </span>
                                {n.status === 'pushed_to_sale' && (
                                  <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 shrink-0">envoyée en vente</span>
                                )}
                              </div>
                              {n.notes?.trim() && (
                                <p className="text-[11px] text-slate-500 whitespace-pre-wrap">{n.notes.trim().slice(0, 400)}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {a.id !== userId && (
                      <div className="pt-2 border-t border-slate-100">
                        <button
                          onClick={() => void toggleAdmin(a)}
                          className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${
                            a.is_admin
                              ? 'text-red-700 border-red-200 bg-red-50 hover:bg-red-100'
                              : 'text-slate-700 border-slate-300 bg-white hover:bg-slate-50'
                          }`}
                        >
                          {a.is_admin ? 'Retirer les droits admin' : 'Donner les droits admin'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Adresses autorisées à s'inscrire ── */}
      {!loading && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Adresses autorisées à s'inscrire ({allow.length})</h2>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            {allow.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Liste vide : l'inscription est LIBRE (n'importe quelle adresse peut créer un compte). Ajoute la première adresse pour armer le verrou d'équipe.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {allow.map((r) => (
                  <li key={r.email} className="flex items-center gap-3 py-2">
                    <span className="text-sm text-slate-800">{r.email}</span>
                    {r.note && <span className="text-xs text-slate-400">{r.note}</span>}
                    <button
                      onClick={() => void removeAllow(r.email)}
                      className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Retirer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addAllow} className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="prenom@mc-export.com"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
                required
              />
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Note (ex. prénom)"
                className="w-36 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
              />
              <button type="submit" className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <p className="text-[11px] text-slate-400">
              Le verrou s'applique à l'INSCRIPTION seulement — les comptes existants ne sont jamais bloqués. Une adresse = un compte.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
