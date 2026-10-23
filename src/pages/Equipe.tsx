import { useEffect, useState } from 'react';
import { Users, Shield, Plus, Trash2, ChevronRight, CheckCircle2, ClipboardList, UserPlus, KeyRound, Wand2, Copy, Building2, Sparkles, Share2, BarChart3, SlidersHorizontal } from 'lucide-react';
import { MyTabsPanel } from '../components/MyTabs';
import { useMyTabChoices } from '../lib/navChoices';
import { supabase } from '../lib/supabase';
import { useAuth, adminCreateAccount, requestPasswordReset, suggestPassword, passwordWeakness } from '../services/auth';
import { APP_TABS, WORKFLOW_TAB_KEYS, grantedTabs } from '../lib/appTabs';
import { readNote, agoLabel } from '../lib/noteJournal';
import { fmtPhone } from '../lib/phoneKey';
import { listOrganisations, addOrganisation, removeOrganisation, setOrganisationDefaultTabs, isProspectingOrg, PROSPECTING_TABS, DEFAULT_ORG, type Organisation } from '../services/organisations';

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
  blocked?: boolean;
  /** Organisation (12/10) : Open space et anti-collision partagés en son sein seulement. */
  organisation?: string | null;
  /** Manager de son organisation (12/10 soir) : onglet Statistiques sur ses commerciaux. */
  is_manager?: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  /** Dernier événement de page de la télémétrie (visitor = prénom) — la
   *  VRAIE activité ; last_sign_in_at ne bouge qu'à une saisie du mot de
   *  passe, la session restant ouverte des semaines. */
  last_activity_at?: string | null;
}

interface AllowRow { email: string; note: string | null; created_at: string; organisation?: string | null }

/** Études quotidiennes de tous les comptes (RPC admin, migration 31/08). */
interface TeamSearch {
  id: string; user_id: string; label: string; brand: string; model: string;
  source_country: string; target_country: string; fuel: string;
  vehicle_type: string; active: boolean; last_run_at: string | null; created_at: string;
  // Paramètres complets (migration 20260909130000) — absents tant que le SQL n'est pas collé.
  year_min?: number | null; year_max?: number | null; mileage_max?: number | null;
  trim?: string; trim_target?: string; gearbox?: string; power_min?: number | null;
  price_gap_min?: number; price_gap_max?: number; run_hour?: number;
}

/** Ligne de critères lisible d'une étude (paramètres des autres comptes). */
function searchCriteriaText(s: TeamSearch): string {
  if (s.price_gap_min == null) return '';
  const parts: string[] = [];
  parts.push(s.year_min || s.year_max ? `années ${s.year_min ?? '…'}–${s.year_max ?? '…'}` : 'toutes années');
  if (s.mileage_max != null) parts.push(`≤ ${s.mileage_max.toLocaleString('fr-FR')} km`);
  if (s.trim) parts.push(`finition « ${s.trim} »${s.trim_target && s.trim_target !== s.trim ? ` (cible « ${s.trim_target} »)` : ''}`);
  if (s.gearbox) parts.push(s.gearbox.toLowerCase());
  if (s.power_min != null) parts.push(`≥ ${s.power_min} ch`);
  if (s.vehicle_type) parts.push(s.vehicle_type);
  parts.push(`écart ${(s.price_gap_min ?? 0).toLocaleString('fr-FR')}–${(s.price_gap_max ?? 0).toLocaleString('fr-FR')} €`);
  if (s.run_hour != null) parts.push(`${s.run_hour} h`);
  return parts.join(' · ');
}

/** Leads du Workflow (RPC admin, migration 10/09) : annonces entrées dans la
 *  boîte d'une étude (nouvelles ou baisses dans l'écart). */
interface TeamLead {
  id: string; user_id: string; owner_name: string; search_id: string; search_label: string;
  listing_url: string; title: string; price: number | null; previous_price: number | null;
  target_median: number | null; price_gap: number | null; site: string; kind: string;
  status: string; resolution: string | null; first_seen_at: string; last_seen_at: string;
  /** SQL du 12/09 : date de la baisse qui a fait rentrer l'annonce dans la boîte. */
  dropped_at?: string | null; lead_at?: string | null;
}
/** Date d'entrée du lead dans la boîte : la baisse (dropped_at) sinon la
 *  première vue. Jamais last_seen_at : il bouge à chaque vague où l'annonce
 *  est revue, et datait « du jour » des baisses vieilles de huit jours
 *  (constat Channing 12/09 : « je n'avais pas 19 leads à traiter »). */
const leadAt = (l: TeamLead) => l.lead_at ?? l.dropped_at ?? l.first_seen_at;
const dayKey = (iso: string) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
const LEAD_STATUS: Record<string, string> = { inbox: 'à traiter', saved: 'en négociation', cleared: 'vidée', dismissed: 'traitée' };
const LEAD_RES: Record<string, string> = { trop_chere: 'trop chère', hors_criteres: 'hors critères', plus_disponible: 'plus disponible', pas_de_deal: 'pas de deal' };

/** Négociations de tous les comptes (RPC admin, migration 31/08 ; v2 du 12/10 soir). */
interface TeamNego {
  id: string; user_id: string; title: string; listing_url: string;
  asking_price: number | null; negotiated_price: number | null;
  status: string; notes: string; updated_at: string; created_at: string;
  /** v2 (SQL equipe_prospection) : absents tant que la RPC v1 est en place. */
  phone?: string | null; outcome?: string | null; archived_at?: string | null;
  photos_count?: number; in_open_space?: boolean;
}
/** En cours = ce que la personne voit dans sa liste (ou dans l'Open space) : ni archivée après appel, ni clôturée. */
const isOpenNego = (n: TeamNego) => n.status === 'open' || n.status === 'pushed_to_sale';
const OUTCOME_LABEL: Record<string, string> = { rdv: 'rendez-vous pris', flux: 'remise dans le flux', no_callback: 'ne pas rappeler', deleted: 'supprimée', unavailable: 'plus disponible' };

/** Analyses lancées par compte (RPC admin_list_analyses, SQL du 12/10 soir) — agrégé côté base. */
interface TeamAnalyses { user_id: string; total: number; today: number; week: number; first_at: string; last_at: string }

const ORG_FILTER_KEY = 'equipe:org';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

export function Equipe() {
  const { isAdmin, userId, hiddenTabs } = useAuth();
  const myTabChoices = useMyTabChoices();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allow, setAllow] = useState<AllowRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  // null = RPC absente (migration pas encore collée) → sections masquées.
  const [searches, setSearches] = useState<TeamSearch[] | null>(null);
  const [negos, setNegos] = useState<TeamNego[] | null>(null);
  // Analyses lancées par compte (12/10 soir) — null = RPC absente (SQL pas collé).
  const [analyses, setAnalyses] = useState<Map<string, TeamAnalyses> | null>(null);
  // Comptes rangés par organisation (12/10 soir, Channing) : '' = toutes, groupées ; sinon l'organisation choisie.
  const [orgFilter, setOrgFilter] = useState<string>(() => { try { return localStorage.getItem(ORG_FILTER_KEY) ?? ''; } catch { return ''; } });
  const chooseOrg = (o: string) => { setOrgFilter(o); try { localStorage.setItem(ORG_FILTER_KEY, o); } catch { /* stockage indispo */ } };
  const [leads, setLeads] = useState<TeamLead[] | null>(null);
  const [leadsAt, setLeadsAt] = useState<Date | null>(null);
  const [leadsOpen, setLeadsOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newAllowOrg, setNewAllowOrg] = useState(DEFAULT_ORG);
  // Organisations (12/10) : la liste de référence, gérée ici.
  const [orgs, setOrgs] = useState<string[]>([DEFAULT_ORG]);
  const [orgRows, setOrgRows] = useState<Organisation[]>([{ name: DEFAULT_ORG, default_tabs: null }]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [newOrg, setNewOrg] = useState('');
  // Création de compte par l'admin (07/09).
  const [nu, setNu] = useState({ firstName: '', lastName: '', phone: '', email: '', password: '', organisation: DEFAULT_ORG, prospectingOnly: false });
  const [nuBusy, setNuBusy] = useState(false);
  const [nuInfo, setNuInfo] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    const [{ data: acc, error: e1 }, allowRes, sr, ng, orgRes, an] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_accounts' as never) as any,
      // Organisation des adresses autorisées (SQL du 12/10) — relecture sans elle si la colonne manque.
      (async () => {
        const r = await supabase.from('auth_allowlist').select('email, note, created_at, organisation' as never).order('created_at');
        return r.error && /organisation/.test(r.error.message) ? supabase.from('auth_allowlist').select('email, note, created_at').order('created_at') : r;
      })(),
      // Activité par compte (migration 31/08) — dégradation propre tant que
      // le SQL n'est pas collé : sections simplement absentes, pas d'erreur.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_daily_searches' as never) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_negotiations' as never) as any,
      listOrganisations(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('admin_list_analyses' as never) as any,
    ]);
    const { data: al, error: e2 } = allowRes as { data: unknown; error: { message: string } | null };
    void reloadLeads();
    if (e1) setError(`Comptes : ${e1.message} — la migration 20260830120000 est-elle appliquée ?`);
    else {
      // Blocage (SQL 20261006120000) : lu à part, la RPC des comptes ne le porte pas ; colonne absente = personne de bloqué.
      let { data: bl } = await supabase.from('profiles').select('id, blocked, organisation, is_manager' as never);
      if (!bl) ({ data: bl } = await supabase.from('profiles').select('id, blocked, organisation' as never)); // colonne is_manager absente (SQL du 12/10 soir)
      if (!bl) ({ data: bl } = await supabase.from('profiles').select('id, blocked' as never)); // colonne organisation absente (SQL du 12/10)
      const extra = new Map(((bl ?? []) as unknown as Array<{ id: string; blocked?: boolean; organisation?: string | null; is_manager?: boolean | null }>).map((p) => [p.id, p]));
      setAccounts(((acc ?? []) as Account[]).map((a) => ({ ...a, blocked: !!extra.get(a.id)?.blocked, organisation: extra.get(a.id)?.organisation ?? null, is_manager: extra.get(a.id)?.is_manager === true })));
    }
    if (e2) setError((prev) => prev ?? `Liste d'inscription : ${e2.message}`);
    else setAllow((al ?? []) as AllowRow[]);
    // La liste de référence (MC Export toujours en tête).
    setOrgs([...new Set([DEFAULT_ORG, ...orgRes.names])].sort((a, b) => (a === DEFAULT_ORG ? -1 : b === DEFAULT_ORG ? 1 : a.localeCompare(b, 'fr'))));
    setOrgRows(orgRes.rows);
    setOrgsError(orgRes.error);
    setSearches(sr.error ? null : ((sr.data ?? []) as TeamSearch[]));
    setNegos(ng.error ? null : ((ng.data ?? []) as TeamNego[]));
    setAnalyses(an.error ? null : new Map(((an.data ?? []) as TeamAnalyses[]).map((r) => [r.user_id, { ...r, total: Number(r.total), today: Number(r.today), week: Number(r.week) }])));
    setLoading(false);
  };
  /** Leads : rechargés à l'ouverture et toutes les 10 min (la vague du
   *  matin les écrit vers 5 h ; la page ouverte le jour se met à jour seule). */
  const reloadLeads = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (supabase as any).rpc('admin_list_daily_leads', { p_days: 14 });
    setLeads(r.error ? null : ((r.data ?? []) as TeamLead[]));
    setLeadsAt(new Date());
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const t = window.setInterval(() => { void reloadLeads(); }, 10 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (!isAdmin) {
    return <p className="text-sm text-slate-500 py-10 text-center">Page réservée aux admins.</p>;
  }

  const saveTabs = async (a: Account, tabs: string[] | null) => {
    // Optimiste : l'UI répond au clic, la base suit ; on recharge derrière.
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, allowed_tabs: tabs } : x)));
    // RPC admin (migration 20260907160000) : crée la ligne de profil si elle
    // manque — un UPDATE sur une ligne absente touchait zéro ligne SANS
    // erreur et les droits « revenaient » (constat Channing 07/09). Tant que
    // le SQL n'est pas collé : repli sur l'UPDATE, mais VÉRIFIÉ (ligne
    // renvoyée) — un écran qui ment vaut moins que rien.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = await (supabase as any).rpc('admin_set_allowed_tabs', { p_user: a.id, p_tabs: tabs });
    if (!rpc.error) return;
    const { data, error: err } = await supabase.from('profiles').update({ allowed_tabs: tabs }).eq('id', a.id).select('id');
    if (err) { setError(err.message); void reload(); return; }
    if (!data?.length) {
      setError(`Droits de ${a.email} NON enregistrés : aucune ligne de profil à mettre à jour. Colle la migration 20260907160000 (RPC admin_set_allowed_tabs) pour que la page crée la ligne manquante.`);
      void reload();
    }
  };

  /** Liste = exactement le défaut (tout sauf les droits sur autorisation
   *  explicite) → NULL (= tout, y compris les onglets futurs) ; sinon la
   *  liste telle quelle. */
  const compactTabs = (next: string[]): string[] | null => {
    const dflt = grantedTabs(null);
    const same = next.length === dflt.length && dflt.every((k) => next.includes(k));
    return same ? null : next;
  };

  const toggleTab = (a: Account, key: string) => {
    // Les listes d'avant le 07/09 (clés workflow/ventes) sont converties en
    // clés fines au premier clic — même effet, puis pilotage onglet par onglet.
    const current = grantedTabs(a.allowed_tabs);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    void saveTabs(a, compactTabs(next));
  };

  /** Organisation d'un compte (12/10) — RPC admin ; sans le SQL, message explicite. */
  const saveOrganisation = async (a: Account, raw: string) => {
    const org = raw.trim() || DEFAULT_ORG;
    if (org === (a.organisation || DEFAULT_ORG)) return;
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, organisation: org } : x)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (supabase as any).rpc('admin_set_organisation', { p_user: a.id, p_org: org });
    if (r.error) { setError(`Organisation de ${a.email} NON enregistrée : ${/does not exist|function|schema cache/i.test(r.error.message) ? 'colle la migration 20261012130000 (organisations).' : r.error.message}`); void reload(); }
  };

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newOrg.trim();
    if (!name) return;
    const err = await addOrganisation(name);
    if (err) { setOrgsError(err); return; }
    setNewOrg(''); setOrgsError(null);
    void reload();
  };
  const dropOrg = async (name: string) => {
    const members = accounts.filter((x) => (x.organisation || DEFAULT_ORG) === name).length;
    if (members > 0) { setOrgsError(`« ${name} » a ${members} compte${members > 1 ? 's' : ''} : change-les d'organisation avant de la supprimer.`); return; }
    if (!confirm(`Supprimer l'organisation « ${name} » (aucun compte) ?`)) return;
    const err = await removeOrganisation(name);
    if (err) setOrgsError(err); else void reload();
  };

  /** Manager de son organisation (12/10 soir) : onglet Statistiques sur ses commerciaux — rôle posé par un admin, vérifié par relecture. */
  const toggleManager = async (a: Account) => {
    const next = !a.is_manager;
    if (!confirm(next
      ? `Nommer ${a.email} manager de « ${a.organisation || DEFAULT_ORG} » ? Il verra l'onglet Statistiques : négociations, notes, annonces, analyses et rendez-vous de tous les comptes de son organisation.`
      : `Retirer le rôle manager à ${a.email} ?`)) return;
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, is_manager: next } : x)));
    const { data, error: err } = await supabase.from('profiles').update({ is_manager: next } as never).eq('id', a.id).select('id');
    if (err) { setError(/is_manager|column|schema cache/i.test(err.message) ? 'Rôle manager : colle le SQL du 12/10 (manager_statistiques).' : err.message); void reload(); return; }
    if (!data?.length) { setError(`Rôle manager de ${a.email} NON enregistré : aucune ligne de profil.`); void reload(); }
  };

  const toggleAdmin = async (a: Account) => {
    if (a.id === userId) return; // jamais se rétrograder soi-même
    const next = !a.is_admin;
    if (!confirm(next
      ? `Donner les droits ADMIN à ${a.email} ? (Truth Center, Télémétrie, page Admin, tous les onglets)`
      : `Retirer les droits admin à ${a.email} ?`)) return;
    setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, is_admin: next } : x)));
    const { data, error: err } = await supabase.from('profiles').update({ is_admin: next }).eq('id', a.id).select('id');
    if (err) { setError(err.message); void reload(); return; }
    if (!data?.length) { setError(`Droits admin de ${a.email} NON enregistrés : aucune ligne de profil (la personne doit s'être connectée une fois, ou colle la migration 20260907160000 puis règle d'abord ses onglets).`); void reload(); }
  };

  const addAllow = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    // Une adresse complète, ou un DOMAINE entier « @weecars.fr » (12/10) :
    // tous les comptes de ce domaine peuvent s'inscrire, dans l'organisation choisie.
    if (!/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Saisis une adresse complète (prenom@societe.fr) ou un domaine entier (@societe.fr).'); return; }
    let { error: err } = await supabase.from('auth_allowlist').insert({ email, note: newNote.trim() || null, organisation: newAllowOrg } as never);
    if (err && /organisation/.test(err.message)) ({ error: err } = await supabase.from('auth_allowlist').insert({ email, note: newNote.trim() || null }));
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

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setNuInfo(null); setError(null); setNuBusy(true);
    const email = nu.email.trim().toLowerCase();
    // Vérifications AVANT tout effet de bord (07/09 : un mot de passe refusé
    // laissait l'adresse déjà inscrite, et la 2e tentative butait sur la clé).
    const weak = passwordWeakness(nu.password);
    if (weak) { setError(`Mot de passe trop faible : ${weak}`); setNuBusy(false); return; }
    if (!nu.firstName.trim() || !nu.lastName.trim()) { setError('Prénom et nom sont requis.'); setNuBusy(false); return; }
    // Le verrou d'inscription (liste d'adresses) s'applique aussi à cette
    // création : on y inscrit l'adresse d'abord, si la liste est armée.
    // Idempotent : une adresse déjà présente ne fait pas d'erreur.
    if (allow.length > 0) {
      let { error: err } = await supabase.from('auth_allowlist')
        .upsert({ email, note: nu.firstName.trim() || null, organisation: nu.organisation } as never, { onConflict: 'email', ignoreDuplicates: true });
      if (err && /organisation/.test(err.message)) ({ error: err } = await supabase.from('auth_allowlist').upsert({ email, note: nu.firstName.trim() || null }, { onConflict: 'email', ignoreDuplicates: true }));
      if (err) { setError(`Liste d'inscription : ${err.message}`); setNuBusy(false); return; }
    }
    const r = await adminCreateAccount({ ...nu, email });
    setNuBusy(false);
    if (r.error) { setError(r.error); return; }
    const scope = `${nu.organisation}${nu.prospectingOnly ? ', prospection seule (Négociations, Archives)' : ''}`;
    setNuInfo(`${r.needsConfirmation
      ? `Compte créé pour ${email} (${scope}). Supabase lui a envoyé un email de confirmation : le mot de passe fonctionne après le clic. Transmets-lui le mot de passe : ${nu.password}`
      : `Compte créé pour ${email} (${scope}). Transmets-lui le mot de passe : ${nu.password}`}${r.warning ? ` — ⚠ ${r.warning}` : ''}`);
    setNu({ firstName: '', lastName: '', phone: '', email: '', password: '', organisation: nu.organisation, prospectingOnly: false });
    void reload();
  };

  /** Bloquer / rétablir un compte : RPC admin (security definer), vérifiée par relecture. */
  const setBlocked = async (a: Account, blocked: boolean) => {
    if (blocked && !window.confirm(`Bloquer l'accès de ${a.email} ? Il sera déconnecté et ne verra plus qu'un écran « accès suspendu ».`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (supabase as any).rpc('admin_set_blocked', { p_user: a.id, p_blocked: blocked });
    if (r.error) { setError(/admin_set_blocked/.test(r.error.message) ? 'Blocage indisponible : colle la migration 20261006120000 (profiles.blocked, RPC admin_set_blocked).' : r.error.message); return; }
    await reload();
  };
  const sendReset = async (a: Account) => {
    if (!confirm(`Envoyer à ${a.email} un email de réinitialisation du mot de passe ?`)) return;
    const err = await requestPasswordReset(a.email);
    setResetInfo(err ? `${a.email} : ${err}` : `Email de réinitialisation envoyé à ${a.email}.`);
  };

  const nameOf = (a: Account) =>
    [a.first_name, a.last_name].filter(Boolean).join(' ') || a.display_name || a.email.split('@')[0];

  // Comptes rangés par organisation (12/10 soir) : l'organisation choisie dans
  // le menu, ou toutes, groupées (MC Export en tête, puis l'ordre de la liste).
  const orgOf = (a: Account) => a.organisation || DEFAULT_ORG;
  const allOrgNames = [...new Set([...orgs, ...accounts.map(orgOf)])];
  const groups = (orgFilter ? [orgFilter] : allOrgNames)
    .map((name) => ({ name, accounts: accounts.filter((a) => orgOf(a) === name) }))
    .filter((g) => g.accounts.length > 0 || orgFilter);
  const shownCount = groups.reduce((n, g) => n + g.accounts.length, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-brand-ocean" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Admin</h1>
          <p className="text-sm text-slate-500">Mes onglets, comptes, onglets visibles par personne, et adresses autorisées à s'inscrire.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>}

      {/* ── Mes onglets (23/10) : le bandeau du compte connecté, à son goût — préférence, pas un droit ── */}
      <Section id="mytabs" icon={<SlidersHorizontal className="w-4 h-4 text-brand-ocean" />} title={`Mes onglets${hiddenTabs.length ? ` (${hiddenTabs.length} masqué${hiddenTabs.length > 1 ? 's' : ''})` : ''}`} hint="choisir ce qui reste dans mon bandeau, pour moi seul">
        <MyTabsPanel items={myTabChoices} />
      </Section>

      {/* ── Organisations (12/10) : la liste de référence, un compte appartient à l'une d'elles ── */}
      {!loading && (
        <Section id="orgs" icon={<Building2 className="w-4 h-4 text-brand-ocean" />} title={`Organisations (${orgs.length})`} hint={orgs.join(' · ')}>
          <p className="text-xs text-slate-400">Chaque organisation ne voit que ses données : Open space, « déjà en négo » et archives ne se partagent qu'en son sein, et les données MC Export (ventes, contacts, campagnes, marché, veille…) ne sont lisibles que par les comptes MC Export, dans les onglets qu'ils ont — la base refuse le reste, même par l'API. « Prospection seule » : ses nouveaux comptes n'ont que Négociations et Archives.</p>
          {orgsError && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{orgsError}</p>}
          <div className="flex flex-wrap gap-2">
            {orgs.map((o) => {
              const n = accounts.filter((x) => (x.organisation || DEFAULT_ORG) === o).length;
              return (
                <span key={o} className="inline-flex items-center gap-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  <span className="font-medium text-slate-800">{o}</span>
                  <span className="text-slate-500">{n} compte{n > 1 ? 's' : ''}</span>
                  {(() => {
                    const row = orgRows.find((r) => r.name === o);
                    const pros = isProspectingOrg(row);
                    return (
                      <button
                        onClick={async () => { const err = await setOrganisationDefaultTabs(o, pros ? null : PROSPECTING_TABS); if (err) setOrgsError(err); else void reload(); }}
                        title={pros ? 'Ses nouveaux comptes reçoivent Négociations et Archives seulement — cliquer pour revenir à tous les onglets' : 'Ses nouveaux comptes reçoivent tous les onglets — cliquer pour les limiter à la prospection (Négociations, Archives)'}
                        className={`rounded-full px-1.5 py-0.5 border ${pros ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'}`}
                      >
                        {pros ? 'prospection seule' : 'tous onglets'}
                      </button>
                    );
                  })()}
                  {o !== DEFAULT_ORG && n === 0 && <button onClick={() => void dropOrg(o)} title="Supprimer (aucun compte)" className="text-slate-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
                </span>
              );
            })}
          </div>
          <form onSubmit={createOrg} className="flex gap-2">
            <input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="Nouvelle organisation (ex. Weecars Angers)" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            <button type="submit" disabled={!newOrg.trim()} className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> Ajouter</button>
          </form>
        </Section>
      )}

      {/* ── Créer un compte (admin) ── */}
      {!loading && (
        <Section id="create" icon={<UserPlus className="w-4 h-4 text-brand-ocean" />} title="Créer un compte" hint="email + mot de passe transmis, organisation, prospection seule">
        <form onSubmit={createAccount} className="space-y-3">
          <p className="text-xs text-slate-400">La personne se connecte avec l'email et le mot de passe que tu lui transmets ; elle pourra le changer via « Mot de passe oublié ».</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <input value={nu.firstName} onChange={(e) => setNu({ ...nu, firstName: e.target.value })} placeholder="Prénom *" required className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            <input value={nu.lastName} onChange={(e) => setNu({ ...nu, lastName: e.target.value })} placeholder="Nom *" required className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            <input type="tel" value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} placeholder="Téléphone" className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            <input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="prenom@mc-export.com *" required autoComplete="off" className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
              <select value={nu.organisation} onChange={(e) => setNu({ ...nu, organisation: e.target.value, prospectingOnly: isProspectingOrg(orgRows.find((o) => o.name === e.target.value)) })} className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-ocean/40">
                {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 px-1">
              <input type="checkbox" checked={nu.prospectingOnly} onChange={(e) => setNu({ ...nu, prospectingOnly: e.target.checked })} />
              Prospection seule (Négociations et Archives)
            </label>
            <div className="flex gap-1 sm:col-span-2 lg:col-span-2">
              <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="Mot de passe * (8 caractères, lettres et chiffres)" required autoComplete="new-password" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
              <button type="button" onClick={() => setNu({ ...nu, password: suggestPassword() })} title="Proposer un mot de passe" className="px-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"><Wand2 className="w-4 h-4" /></button>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(nu.password); }} title="Copier le mot de passe" className="px-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"><Copy className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button type="submit" disabled={nuBusy} className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {nuBusy ? 'Création…' : 'Créer le compte'}
            </button>
            {allow.length > 0 && <span className="text-xs text-slate-400">L'adresse sera ajoutée à la liste des adresses autorisées.</span>}
          </div>
          {nuInfo && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 break-all">{nuInfo}</p>}
        </form>
        </Section>
      )}

      {resetInfo && <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{resetInfo}</p>}

      {/* ── Leads du Workflow par jour et par personne (7 jours) ── */}
      {!loading && leads && accounts.length > 0 && (() => {
        const days: string[] = [];
        for (let i = 6; i >= 0; i--) days.push(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()));
        const people = accounts.filter((a) => leads.some((l) => l.user_id === a.id) || searches?.some((s) => s.user_id === a.id));
        const count = (uid: string, d: string, kind?: string) => leads.filter((l) => l.user_id === uid && dayKey(leadAt(l)) === d && (!kind || l.kind === kind)).length;
        const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
        return (
          <Section id="leads" icon={<ClipboardList className="w-4 h-4 text-brand-ocean" />} title="Leads du Workflow — 7 derniers jours" hint="annonces entrées dans la boîte (nouvelles + baisses dans l'écart), par personne et par jour">
            <div className="flex justify-end">
              <button onClick={() => void reloadLeads()} className="text-xs text-brand-ocean hover:underline">Actualiser{leadsAt ? ` · ${leadsAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-400"><th className="py-1 pr-3">Personne</th>{days.map((d) => <th key={d} className="py-1 px-2 text-right whitespace-nowrap">{fmtDay(d)}</th>)}<th className="py-1 pl-3 text-right">7 j</th><th className="py-1 pl-3 text-right">14 j</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map((a) => {
                    const total7 = days.reduce((n, d) => n + count(a.id, d), 0);
                    const total14 = leads.filter((l) => l.user_id === a.id).length;
                    return (
                      <tr key={a.id}>
                        <td className="py-1.5 pr-3 font-medium text-slate-800">{nameOf(a)}</td>
                        {days.map((d) => {
                          const n = count(a.id, d), drops = count(a.id, d, 'price_drop');
                          return <td key={d} className={`py-1.5 px-2 text-right tabular-nums ${n === 0 ? 'text-slate-300' : d === days[days.length - 1] ? 'text-emerald-700 font-semibold' : 'text-slate-700'}`}>{n === 0 ? '—' : n}{drops > 0 ? <span className="text-amber-600 font-normal"> ({drops}↓)</span> : ''}</td>;
                        })}
                        <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-slate-800">{total7}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-slate-500">{total14}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })()}

      {/* ── Comptes, rangés par organisation ── */}
      {!loading && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700">Comptes ({shownCount}{orgFilter && shownCount !== accounts.length ? ` sur ${accounts.length}` : ''})</h2>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <Building2 className="w-4 h-4 text-slate-400" /> Organisation
              <select value={orgFilter} onChange={(e) => chooseOrg(e.target.value)} className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm">
                <option value="">Toutes (groupées)</option>
                {allOrgNames.map((o) => <option key={o} value={o}>{o} ({accounts.filter((a) => orgOf(a) === o).length})</option>)}
              </select>
            </label>
            {(negos || analyses) && <span className="text-xs text-slate-400">Sur chaque ligne : négociations en cours (liste et Open space) · analyses d'annonces lancées depuis l'ouverture du compte.</span>}
          </div>
          {groups.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">Aucun compte.</p>}
          {groups.map((g) => (
            <div key={g.name} className="space-y-2">
              {!orgFilter && (
                <div className="flex items-center gap-2 pt-2">
                  <Building2 className="w-4 h-4 text-brand-ocean" />
                  <span className="text-sm font-semibold text-slate-800">{g.name}</span>
                  <span className="text-xs text-slate-400">{g.accounts.length} compte{g.accounts.length > 1 ? 's' : ''}</span>
                  {isProspectingOrg(orgRows.find((r) => r.name === g.name)) && <span className="text-[11px] rounded-full px-1.5 py-0.5 bg-amber-50 border border-amber-300 text-amber-800">prospection seule</span>}
                </div>
              )}
              {g.accounts.length === 0 && <p className="text-xs text-slate-400 py-3 text-center">Aucun compte dans « {g.name} ».</p>}
              {g.accounts.map((a) => {
            const isOpen = openId === a.id;
            const all = APP_TABS.map((t) => t.key as string);
            const visible = a.is_admin ? all : grantedTabs(a.allowed_tabs);
            const hasStudies = a.is_admin || visible.includes('wf:etudes') || visible.includes('wf:resultats');
            return (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <button
                  onClick={() => setOpenId(isOpen ? null : a.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${isOpen ? 'rounded-t-xl' : 'rounded-xl'}`}
                >
                  <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="font-medium text-slate-900">{nameOf(a)}</span>
                  <span className="text-xs text-slate-500 truncate">{a.email}</span>
                  {(() => {
                    // Activité de prospection (12/10 soir) : négociations en cours · analyses lancées.
                    const open = negos ? negos.filter((n) => n.user_id === a.id && isOpenNego(n)).length : null;
                    const an = analyses ? (analyses.get(a.id)?.total ?? 0) : null;
                    if (open == null && an == null) return null;
                    return (
                      <span title="Négociations en cours (sa liste et l'Open space) · analyses d'annonces lancées depuis l'ouverture du compte" className={`hidden sm:flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 shrink-0 border ${(open ?? 0) + (an ?? 0) > 0 ? 'text-slate-700 bg-slate-50 border-slate-200' : 'text-slate-400 bg-white border-slate-200'}`}>
                        {open != null && <>{open} négo{open > 1 ? 's' : ''}</>}
                        {open != null && an != null && <span className="text-slate-300">·</span>}
                        {an != null && <><Sparkles className="w-3 h-3 text-violet-500" /> {an} analyse{an > 1 ? 's' : ''}</>}
                      </span>
                    );
                  })()}
                  {a.is_admin && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-brand-ocean bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 shrink-0">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {a.is_manager && !a.is_admin && (
                    <span title="Manager de son organisation : onglet Statistiques" className="flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
                      <BarChart3 className="w-3 h-3" /> Manager
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400 shrink-0">
                    {a.organisation && a.organisation !== 'MC Export' ? `${a.organisation} · ` : ''}
                    {visible.length === all.length ? 'tous les onglets' : `${visible.length}/${all.length} onglets`}{a.is_manager && !a.is_admin ? ' + Statistiques' : ''}
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
                        <p className="text-xs text-slate-500">Accès de ce compte — un droit décoché retire la page (ou les onglets qu'il gouverne) de son ADA, effet à son prochain chargement. Accueil reste toujours accessible. « Opportunités à contrôler » n'est donné qu'aux comptes où tu le coches.</p>
                        {(() => {
                          const granted = grantedTabs(a.allowed_tabs);
                          const wf = APP_TABS.filter((t) => WORKFLOW_TAB_KEYS.includes(t.key));
                          const others = APP_TABS.filter((t) => !WORKFLOW_TAB_KEYS.includes(t.key));
                          const wfOn = wf.filter((t) => granted.includes(t.key)).length;
                          const Card = ({ t, compact }: { t: (typeof APP_TABS)[number]; compact?: boolean }) => {
                            const on = granted.includes(t.key);
                            return (
                              <button
                                onClick={() => toggleTab(a, t.key)}
                                title={t.hint}
                                className={`flex items-start gap-2 rounded-lg text-left border transition-colors ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${
                                  on ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${on ? 'text-emerald-600' : 'text-slate-300'}`} />
                                <span className="min-w-0">
                                  <span className={`block text-xs font-medium ${on ? 'text-emerald-800' : 'text-slate-400 line-through'}`}>{t.label.replace(/^Workflow · /, '')}</span>
                                  <span className={`block text-[11px] leading-snug ${on ? 'text-emerald-700/80' : 'text-slate-400'}`}>{t.hint}</span>
                                </span>
                              </button>
                            );
                          };
                          return (
                            <div className="grid sm:grid-cols-2 gap-2">
                              {/* Sous-menu Workflow : une carte, ses cinq onglets dedans. */}
                              <div className={`sm:col-span-2 rounded-lg border p-3 space-y-2 ${wfOn > 0 ? 'bg-emerald-50/40 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <ClipboardList className={`w-4 h-4 ${wfOn > 0 ? 'text-emerald-600' : 'text-slate-300'}`} />
                                  <span className={`text-xs font-semibold ${wfOn > 0 ? 'text-emerald-900' : 'text-slate-400 line-through'}`}>Workflow</span>
                                  <span className="text-[11px] text-slate-500">{wfOn === wf.length ? 'tous les onglets' : wfOn === 0 ? 'aucun onglet — l’entrée disparaît de son bandeau' : `${wfOn}/${wf.length} onglets`}</span>
                                  <button
                                    onClick={() => void saveTabs(a, (() => { const rest = granted.filter((k) => !WORKFLOW_TAB_KEYS.includes(k as never)); return compactTabs(wfOn === wf.length ? rest : [...rest, ...wf.map((t) => t.key as string)]); })())}
                                    className="ml-auto text-[11px] font-medium text-brand-ocean hover:underline"
                                  >
                                    {wfOn === wf.length ? 'Tout retirer' : 'Tout donner'}
                                  </button>
                                </div>
                                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pl-6">
                                  {wf.map((t) => <Card key={t.key} t={t} compact />)}
                                </div>
                              </div>
                              {others.map((t) => <Card key={t.key} t={t} />)}
                              {/* Statistiques (12/10 soir) : pas un onglet par compte mais le rôle MANAGER — montré ici,
                                  au même endroit que les accès, pour voir ce qui est et ce qui n'est pas. */}
                              <button
                                onClick={() => void toggleManager(a)}
                                title="Rôle manager : l'onglet Statistiques de son organisation (négociations, notes, annonces, analyses, rendez-vous de tous ses comptes)"
                                className={`flex items-start gap-2 rounded-lg text-left border transition-colors px-3 py-2 ${a.is_manager ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                              >
                                <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${a.is_manager ? 'text-emerald-600' : 'text-slate-300'}`} />
                                <span className="min-w-0">
                                  <span className={`block text-xs font-medium ${a.is_manager ? 'text-emerald-800' : 'text-slate-400 line-through'}`}>Statistiques <span className="font-normal">(rôle manager)</span></span>
                                  <span className={`block text-[11px] leading-snug ${a.is_manager ? 'text-emerald-700/80' : 'text-slate-400'}`}>Les chiffres de prospection de son organisation : négociations, notes, annonces, analyses, rendez-vous pris, Open space</span>
                                </span>
                              </button>
                            </div>
                          );
                        })()}
                      </>
                    )}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <label className="text-slate-500">Organisation
                        <select
                          value={a.organisation || DEFAULT_ORG}
                          onChange={(e) => void saveOrganisation(a, e.target.value)}
                          className="ml-2 px-2 py-1 rounded border border-slate-300 bg-white text-slate-800"
                        >
                          {[...new Set([...orgs, a.organisation || DEFAULT_ORG])].map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </label>
                      <span className="text-slate-400">Une organisation manquante s'ajoute dans la liste en haut de page.</span>
                    </div>
                    {!a.is_admin && (
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="text-slate-500">Préréglage :</span>
                        <button
                          onClick={() => { if (confirm(`Donner à ${a.email} la prospection seule : onglets Négociations et Archives (de son organisation) uniquement, accueil réduit, cloche Rappels ?`)) void saveTabs(a, PROSPECTING_TABS); }}
                          title="Compte de prospection (équipe Weecars, 12/10) : Négociations et Archives seulement — ajout d'annonces avec lecture IA et alerte doublons, notes, rappels, archives de son organisation"
                          className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                        >
                          Prospection seule (Négociations, Archives)
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      {!a.is_admin && (a.blocked
                        ? <button onClick={() => void setBlocked(a, false)} className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 border border-emerald-300 rounded-lg px-2.5 py-1.5 hover:bg-emerald-50">Rétablir l'accès</button>
                        : <button onClick={() => void setBlocked(a, true)} className="flex items-center gap-1.5 text-xs font-medium text-red-700 border border-red-300 rounded-lg px-2.5 py-1.5 hover:bg-red-50">Bloquer l'accès</button>)}
                      <button onClick={() => void sendReset(a)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
                        <KeyRound className="w-3.5 h-3.5" /> Envoyer un lien de nouveau mot de passe
                      </button>
                    </div>
                    {/* Études et leads : seulement pour un compte qui a ces onglets (un compte de prospection n'en a pas). */}
                    {searches && hasStudies && (() => {
                      const mine = searches.filter((s) => s.user_id === a.id);
                      if (mine.length === 0) return (
                        <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">Aucune étude quotidienne.</p>
                      );
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-xs font-semibold text-slate-700">Études quotidiennes ({mine.length})</p>
                          {mine.map((s) => (
                            <div key={s.id} className="text-xs text-slate-600">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                <span className="font-medium text-slate-800 truncate">
                                  {s.label || `${s.brand} ${s.model}`.trim()}
                                </span>
                                <span className="text-slate-400 shrink-0">
                                  {s.brand} {s.model} · {s.source_country} → {s.target_country}{s.fuel ? ` · ${s.fuel}` : ''}
                                </span>
                                <span className="ml-auto text-slate-400 shrink-0">
                                  {s.active
                                    ? (s.last_run_at ? `passée le ${new Date(s.last_run_at).toLocaleDateString('fr-FR')}` : 'jamais passée')
                                    : 'en pause'}
                                </span>
                              </div>
                              {searchCriteriaText(s) && <div className="pl-3.5 text-[11px] text-slate-500">{searchCriteriaText(s)}</div>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {leads && hasStudies && (() => {
                      const mine = leads.filter((l) => l.user_id === a.id).sort((x, y) => leadAt(y).localeCompare(leadAt(x)));
                      const today = dayKey(new Date().toISOString());
                      const todayN = mine.filter((l) => dayKey(leadAt(l)) === today).length;
                      const isOpen = leadsOpen[a.id] ?? false;
                      const shown = isOpen ? mine.slice(0, 60) : mine.slice(0, 5);
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-xs font-semibold text-slate-700">Leads du Workflow — {todayN} aujourd'hui · {mine.length} sur 14 jours</p>
                          {mine.length === 0 && <p className="text-xs text-slate-400">Aucun lead sur 14 jours.</p>}
                          {shown.map((l) => (
                            <div key={l.id} className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="text-slate-400 shrink-0 w-14">{new Date(leadAt(l)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                              <a href={l.listing_url} target="_blank" rel="noreferrer" className="font-medium text-slate-800 truncate hover:text-brand-ocean hover:underline" title={l.title}>{l.title || l.listing_url}</a>
                              <span className="text-slate-400 shrink-0 truncate max-w-[160px]">{l.search_label}</span>
                              <span className="shrink-0 tabular-nums text-slate-700">{l.price != null ? `${l.price.toLocaleString('fr-FR')} €` : '—'}{l.kind === 'price_drop' && l.previous_price != null ? <span className="text-amber-600"> ↓{(l.previous_price - l.price!).toLocaleString('fr-FR')}</span> : ''}</span>
                              <span className="shrink-0 text-emerald-700 tabular-nums">{l.price_gap != null ? `+${l.price_gap.toLocaleString('fr-FR')}` : ''}</span>
                              <span className="ml-auto shrink-0 text-[10px] rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600">{LEAD_STATUS[l.status] ?? l.status}{l.resolution ? ` · ${LEAD_RES[l.resolution] ?? l.resolution}` : ''}</span>
                            </div>
                          ))}
                          {mine.length > 5 && (
                            <button onClick={() => setLeadsOpen((o) => ({ ...o, [a.id]: !isOpen }))} className="text-[11px] text-brand-ocean hover:underline">{isOpen ? 'Réduire' : `Afficher les ${Math.min(60, mine.length)} derniers`}</button>
                          )}
                        </div>
                      );
                    })()}
                    {/* Analyses lancées (12/10 soir) : une par lecture IA d'annonce (ajout ou relance des photos). */}
                    <div className="pt-2 border-t border-slate-100 text-xs">
                      {analyses ? (() => {
                        const an = analyses.get(a.id);
                        return (
                          <p className="text-slate-600 flex items-center gap-1.5 flex-wrap" title="Compteur posé le 12/10/2026. L'historique d'avant est repris à raison d'une analyse par annonce dont les photos ont été lues.">
                            <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                            <span className="font-semibold text-slate-700">Analyses lancées : {an?.total ?? 0}</span>
                            <span className="text-slate-400">depuis l'ouverture du compte ({fmtDate(a.created_at)}){an ? ` · aujourd'hui ${an.today} · 7 jours ${an.week} · dernière le ${fmtDate(an.last_at)}` : ''}</span>
                          </p>
                        );
                      })() : <p className="text-amber-700">Analyses lancées : colle le SQL du 12/10 (equipe_prospection) pour les compter.</p>}
                    </div>
                    {negos && (() => {
                      // En cours = ce que la personne voit (sa liste ou l'Open space) ; les archivées après appel et
                      // les clôturées sont comptées à part. Date d'ajout visible (demande 14/09), plus récentes en premier.
                      const mine = negos.filter((n) => n.user_id === a.id);
                      const open = mine.filter(isOpenNego)
                        .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
                      const addedOn = (iso: string) => {
                        const d = new Date(iso);
                        const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
                        const when = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        return days <= 0 ? `ajoutée aujourd'hui` : days === 1 ? `ajoutée hier` : `ajoutée le ${when} · ${days} j`;
                      };
                      const archivedN = mine.filter((n) => n.status === 'archived');
                      const done = mine.filter((n) => n.status === 'closed').length;
                      const byOutcome = Object.keys(OUTCOME_LABEL)
                        .map((o) => { const k = archivedN.filter((n) => n.outcome === o).length; return k ? `${k} ${OUTCOME_LABEL[o]}` : null; })
                        .filter(Boolean).join(', ');
                      const tail = [
                        archivedN.length ? `${archivedN.length} archivée${archivedN.length > 1 ? 's' : ''} après appel${byOutcome ? ` (${byOutcome})` : ''}` : null,
                        done ? `${done} clôturée${done > 1 ? 's' : ''}` : null,
                      ].filter(Boolean).join(' · ');
                      if (open.length === 0) return (
                        <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
                          Aucune négociation en cours{tail ? ` · ${tail}` : ''}.
                        </p>
                      );
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-2">
                          <p className="text-xs font-semibold text-slate-700">
                            Négociations en cours ({open.length}){tail ? <span className="font-normal text-slate-400"> · {tail}</span> : null}
                          </p>
                          {open.map((n) => {
                            const note = readNote(n.notes);
                            return (
                              <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                                <div className="flex items-center gap-2 text-xs flex-wrap">
                                  {n.listing_url
                                    ? <a href={n.listing_url} target="_blank" rel="noreferrer" className="font-medium text-brand-ocean hover:underline truncate">{n.title || 'Sans titre'}</a>
                                    : <span className="font-medium text-slate-800 truncate">{n.title || 'Sans titre'}</span>}
                                  {n.in_open_space && (
                                    <span title="Visible dans l'Open space de son organisation, pas dans sa liste" className="flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5 shrink-0"><Share2 className="w-3 h-3" /> Open space</span>
                                  )}
                                  {n.status === 'pushed_to_sale' && (
                                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 shrink-0">envoyée en vente</span>
                                  )}
                                  <span className="ml-auto text-slate-500 shrink-0">
                                    {n.negotiated_price != null
                                      ? `négocié ${n.negotiated_price.toLocaleString('fr-FR')} €`
                                      : n.asking_price != null
                                        ? `affiché ${n.asking_price.toLocaleString('fr-FR')} €`
                                        : ''}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-400" title={`Ajoutée le ${new Date(n.created_at).toLocaleString('fr-FR')}`}>
                                  {addedOn(n.created_at)}{n.phone ? ` · vendeur ${fmtPhone(n.phone)}` : ''}{n.photos_count ? ` · ${n.photos_count} photo${n.photos_count > 1 ? 's' : ''}` : ''}
                                </p>
                                {note.text && (
                                  <p className="text-[11px] text-slate-500 whitespace-pre-wrap">{note.at ? <span className="text-slate-400">note {agoLabel(note.at)} · </span> : null}{note.text.slice(0, 400)}</p>
                                )}
                              </div>
                            );
                          })}
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
                        {!a.is_admin && (
                          <button
                            onClick={() => void toggleManager(a)}
                            title="Manager de son organisation : onglet Statistiques sur les négociations, analyses et rendez-vous de ses commerciaux"
                            className={`ml-2 text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${a.is_manager ? 'text-emerald-800 border-emerald-300 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-700 border-slate-300 bg-white hover:bg-slate-50'}`}
                          >
                            {a.is_manager ? 'Retirer le rôle manager' : 'Nommer manager de son organisation'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))}
        </div>
      )}

      {/* ── Adresses autorisées à s'inscrire ── */}
      {!loading && (
        <Section id="allow" icon={<KeyRound className="w-4 h-4 text-brand-ocean" />} title={`Adresses autorisées à s'inscrire (${allow.length})`} hint={allow.length === 0 ? 'liste vide : inscription libre' : 'adresses et domaines, avec leur organisation'}>
          <div className="space-y-3">
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
                    <span className="text-[11px] text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">{r.organisation || DEFAULT_ORG}</span>
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
                type="text"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="prenom@societe.fr ou @societe.fr (tout le domaine)"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
                required
              />
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Note (ex. prénom)"
                className="w-36 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
              />
              <select value={newAllowOrg} onChange={(e) => setNewAllowOrg(e.target.value)} title="Organisation que recevra le compte à l'inscription" className="px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button type="submit" className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <p className="text-[11px] text-slate-400">
              Le verrou s'applique à l'INSCRIPTION seulement — les comptes existants ne sont jamais bloqués. Une adresse = un compte ; le compte reçoit l'organisation de son adresse à l'inscription. Une ligne « @societe.fr » autorise toutes les adresses de ce domaine (ex. @weecars.fr → Weecars). Une adresse refusée voit « Adresse non autorisée à s'inscrire ».
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * Bloc repliable de la page Équipe (12/10 soir, Channing : « ces menus
 * fermés par défaut, ils prennent de la place pour rien »). Fermé tant
 * qu'on ne l'ouvre pas ; le choix est retenu sur ce navigateur.
 */
function Section({ id, icon, title, hint, children }: { id: string; icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  const key = `equipe:section:${id}`;
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* stockage indispo */ } return !o; });
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button onClick={toggle} className={`w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${open ? 'rounded-t-xl' : 'rounded-xl'}`}>
        <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {icon}
        <span className="text-sm font-semibold text-slate-700 shrink-0">{title}</span>
        {hint && !open && <span className="text-xs text-slate-400 truncate">{hint}</span>}
      </button>
      {open && <div className="border-t border-slate-100 p-4 space-y-3">{children}</div>}
    </div>
  );
}
