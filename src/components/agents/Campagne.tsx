/**
 * CAMPAGNE DEPUIS LA CARTE (19/11, Channing : « dans DANA, j'aimerais qu'on puisse contacter les concessions de ces
 * groupes, et qu'on ait juste les e-mails à appuyer "envoyer", pour chaque e-mail bien cibler le contact, la marque…
 * contacter à grande échelle, chaque e-mail adapté, on appuie sur envoyer à la chaîne et on attend les retours ; qu'on
 * choisisse par pays et par marque » ; « les envois doivent se faire manuellement, on enchaîne les mails, on relit
 * avec la traduction à côté, et on envoie ; pas d'appel à un call, juste une ouverture à la discussion »).
 * Trois temps :
 *  1. CHOISIR — un pays, des marques (celles vues sur les vitrines relevées), les contacts de la Carte qui ont une
 *     adresse ; ceux déjà en discussion sont signalés et décochés ; les consignes données à Dana ; « Préparer ».
 *  2. RELIRE ET ENVOYER — un mail après l'autre : le texte (dans la langue du pays, corrigeable) et sa traduction
 *     française côte à côte, les points à vérifier ; « Envoyer » valide le mail, qui part de la boîte de Dana dans ses
 *     horaires, au rythme réglé, sous le plafond du jour (Réglages) ; « Passer », « Refuser ».
 *  3. SUIVI — chaque mail : son état, le retour reçu (répondu, rebond, absence, stop), sans réponse ; ouvrir le fil.
 * Le worker rédige (worker/agents/carteCampaign.ts) ; rien ne part sans un clic ici.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, SkipForward, Ban, Loader2, Megaphone, ListChecks, Eye, Mail } from 'lucide-react';
import {
  queueCampaign, listCampaignMessages, contactsInThreads, brandsOfContacts, editDraft, setMessageStatus, listTasks,
  type AgentSettings, type CampaignMessage, type Campaign,
} from '../../services/agents';
import { loadNetwork, KIND_LABEL, type NetworkContact } from '../../services/network';
import { CARTE_CAMPAIGN_DEFAULT_INSTRUCTIONS } from '../../lib/agents/firstMail';
import { COUNTRY_FR } from '../../lib/agents/research';
import { brandKey } from '../../lib/agents/opportunity';
import { INTENT_LABEL, type REPLY_INTENTS } from '../../lib/agents/reply';
import { workHoursLabel } from '../../lib/agents/sendPolicy';
import { Banner } from './shared';
import { fmtDateTime } from './helpers';

interface Props {
  settings: AgentSettings | undefined;
  isAdmin: boolean;
  userId: string | null;
  refreshKey: number;
  onError: (m: string) => void;
  onInfo: (m: string) => void;
  onOpenThread: (id: string) => void;
}

type Step = 'choisir' | 'relire' | 'suivi';
const STEP: Record<Step, { label: string; icon: React.ReactNode }> = {
  choisir: { label: '1. Choisir', icon: <ListChecks className="w-4 h-4" /> },
  relire: { label: '2. Relire et envoyer', icon: <Eye className="w-4 h-4" /> },
  suivi: { label: '3. Suivi', icon: <Mail className="w-4 h-4" /> },
};
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
const CLASS_FR: Record<string, string> = { rebond: 'rebond (adresse invalide)', absence: 'réponse automatique (absence)', antispam: 'filtre anti-spam', stop: 'ne plus contacter', copie: 'copie de l\'équipe', reponse: 'a répondu' };
const STATUS_FR: Record<string, string> = { a_valider: 'à relire', valide: 'validé, en attente d\'envoi', envoi: 'envoi en cours', envoye: 'envoyé', echec: 'échec d\'envoi', refuse: 'refusé', brouillon: 'brouillon' };
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null);

export function Campagne({ settings, isAdmin, userId, refreshKey, onError, onInfo, onOpenThread }: Props) {
  const [step, setStep] = useState<Step>('choisir');
  const [contacts, setContacts] = useState<NetworkContact[]>([]);
  const [brands, setBrands] = useState<Map<string, Array<{ brand: string; n: number }>>>(new Map());
  const [inThreads, setInThreads] = useState<{ ids: Set<string>; emails: Set<string> }>({ ids: new Set(), emails: new Set() });
  const [country, setCountry] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [consignes, setConsignes] = useState(CARTE_CAMPAIGN_DEFAULT_INSTRUCTIONS);
  const [loading, setLoading] = useState(true);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<CampaignMessage[]>([]);
  const [pending, setPending] = useState(0);
  const [campaignFilter, setCampaignFilter] = useState('');

  const loadMessages = useCallback(async () => {
    const [{ rows, error }, { rows: tasks }] = await Promise.all([listCampaignMessages(), listTasks(60, 'dana')]);
    if (error) onError(error);
    setMessages(rows);
    setPending(tasks.filter((t) => t.params?.campagne && (t.status === 'en_attente' || t.status === 'en_cours')).length);
  }, [onError]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const [{ contacts: cs, error }, th] = await Promise.all([loadNetwork(), contactsInThreads()]);
      if (!alive) return;
      if (error) onError(error);
      const withMail = cs.filter((c) => !!c.email?.trim());
      setContacts(withMail);
      setInThreads(th);
      setLoading(false);
      setBrandsLoading(true);
      const b = await brandsOfContacts(withMail.map((c) => c.id));
      if (alive) { setBrands(b); setBrandsLoading(false); }
    })();
    void loadMessages();
    return () => { alive = false; };
  }, [refreshKey, loadMessages, onError]);

  // Tant que Dana rédige, la liste se rafraîchit toute seule (10 s).
  useEffect(() => {
    if (pending === 0) return;
    const h = window.setInterval(() => void loadMessages(), 10_000);
    return () => window.clearInterval(h);
  }, [pending, loadMessages]);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) m.set(c.country, (m.get(c.country) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [contacts]);
  const inCountry = useMemo(() => contacts.filter((c) => !country || c.country === country), [contacts, country]);
  const brandChoices = useMemo(() => {
    const m = new Map<string, { brand: string; contacts: number }>();
    for (const c of inCountry) for (const b of brands.get(c.id) ?? []) {
      const k = brandKey(b.brand);
      (m.get(k) ?? m.set(k, { brand: b.brand, contacts: 0 }).get(k)!).contacts++;
    }
    return [...m.values()].sort((x, y) => y.contacts - x.contacts);
  }, [inCountry, brands]);
  const inDiscussion = useCallback((c: NetworkContact) => inThreads.ids.has(c.id) || inThreads.emails.has((c.email ?? '').toLowerCase()), [inThreads]);
  const listed = useMemo(() => {
    const keys = new Set(picked.map(brandKey));
    return inCountry.filter((c) => keys.size === 0 || (brands.get(c.id) ?? []).some((b) => keys.has(brandKey(b.brand))))
      .sort((x, y) => Number(inDiscussion(x)) - Number(inDiscussion(y)) || (y.stock_total ?? 0) - (x.stock_total ?? 0) || x.name.localeCompare(y.name));
  }, [inCountry, picked, brands, inDiscussion]);
  // Une même adresse sur plusieurs fiches (un groupe, ses sites : Hedin ×5) : un seul mail, à la fiche au plus gros stock ; les autres le disent.
  const sameAs = useMemo(() => {
    const first = new Map<string, NetworkContact>(), out = new Map<string, NetworkContact>();
    for (const c of listed) {
      if (inDiscussion(c)) continue;
      const e = (c.email ?? '').toLowerCase();
      const f = first.get(e);
      if (f) out.set(c.id, f); else first.set(e, c);
    }
    return out;
  }, [listed, inDiscussion]);
  const already = useCallback((c: NetworkContact) => inDiscussion(c) || sameAs.has(c.id), [inDiscussion, sameAs]);
  const whyNot = useCallback((c: NetworkContact) => (inDiscussion(c) ? 'déjà en discussion' : sameAs.has(c.id) ? `même adresse que ${sameAs.get(c.id)!.name}` : ''), [inDiscussion, sameAs]);
  const selectable = useMemo(() => listed.filter((c) => !already(c)), [listed, already]);
  // Un changement de pays ou de marques : tout ce qui est proposé est coché (sauf les contacts déjà en discussion).
  useEffect(() => { setChecked(new Set(selectable.map((c) => c.id))); }, [selectable]);

  const prepare = async () => {
    const ids = selectable.filter((c) => checked.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    const pays = country || 'tous';
    if (!window.confirm(`Dana rédige ${ids.length} mail${ids.length > 1 ? 's' : ''} (${pays}${picked.length ? `, ${picked.join(', ')}` : ''}), un par contact, dans la langue du pays. Rien ne part : vous relirez et enverrez un par un. Lancer ?`)) return;
    setBusy(true);
    const campagne: Campaign = { id: crypto.randomUUID(), pays, marques: picked, consignes: consignes.trim() };
    const e = await queueCampaign(ids, campagne, userId);
    setBusy(false);
    if (e) { onError(e); return; }
    onInfo(`${ids.length} mail${ids.length > 1 ? 's' : ''} en préparation par Dana (5 à la fois, un peu moins d'une minute par mail). Ils arrivent dans « 2. Relire et envoyer » à mesure ; suivez-la dans Live.`);
    setChecked(new Set());
    setStep('relire');
    void loadMessages();
  };

  const toReview = useMemo(() => messages.filter((m) => m.status === 'a_valider'), [messages]);
  const waiting = messages.filter((m) => m.status === 'valide').length;
  const campaigns = useMemo(() => {
    const m = new Map<string, { id: string; label: string; at: string }>();
    for (const x of messages) {
      const c = x.ai_notes?.campagne;
      if (!c || m.has(c.id)) continue;
      m.set(c.id, { id: c.id, label: `${COUNTRY_FR[c.pays] ?? c.pays}${c.marques?.length ? ` · ${c.marques.join(', ')}` : ''} · ${fmtDateTime(x.created_at)}`, at: x.created_at });
    }
    return [...m.values()].sort((x, y) => y.at.localeCompare(x.at));
  }, [messages]);
  const tracked = useMemo(() => messages.filter((m) => !campaignFilter || m.ai_notes?.campagne?.id === campaignFilter), [messages, campaignFilter]);
  const counts = useMemo(() => {
    const c = { total: tracked.length, relire: 0, attente: 0, envoyes: 0, repondu: 0, rebond: 0, sans: 0, echec: 0 };
    for (const m of tracked) {
      if (m.status === 'a_valider') c.relire++;
      else if (m.status === 'valide' || m.status === 'envoi') c.attente++;
      else if (m.status === 'echec') c.echec++;
      else if (m.status === 'envoye') {
        c.envoyes++;
        const k = m.reply?.classification ?? null;
        if (!m.reply) c.sans++;
        else if (k === 'rebond' || k === 'antispam') c.rebond++;
        else if (k !== 'absence') c.repondu++;
        else c.sans++;
      }
    }
    return c;
  }, [tracked]);

  const sendWindow = settings ? workHoursLabel(settings) : '';
  const cap = settings?.daily_first_contact_cap ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STEP) as Step[]).map((s) => (
          <button key={s} type="button" onClick={() => setStep(s)}
            className={`${btn} border ${step === s ? 'bg-brand-encre text-white border-brand-encre' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
            {STEP[s].icon}{STEP[s].label}
            {s === 'relire' && toReview.length > 0 && <span className={`ml-1 rounded-full px-1.5 text-[11px] ${step === s ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>{toReview.length}</span>}
          </button>
        ))}
        {pending > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><Loader2 className="w-3.5 h-3.5 animate-spin" />Dana rédige ({pending} lot{pending > 1 ? 's' : ''} de 5 en cours ou en attente)</span>}
      </div>

      {settings && (
        <p className="text-xs text-slate-500">
          Les mails validés partent de {settings.mailbox} {sendWindow ? `(${sendWindow})` : ''}, espacés de {Math.round(settings.min_gap_seconds / 60)} à {Math.round(settings.max_gap_seconds / 60)} min,
          au plus {cap} premiers contacts par jour (Réglages de Dana). {waiting > 0 && <span className="text-slate-700">{waiting} validé{waiting > 1 ? 's' : ''} en attente d'envoi.</span>}
          {!settings.gmail_connected_email && <span className="text-red-700"> Boîte Gmail non connectée : rien ne partira (Réglages).</span>}
        </p>
      )}

      {step === 'choisir' && (
        <Choose loading={loading} brandsLoading={brandsLoading} countries={countries} country={country} setCountry={(c) => { setCountry(c); setPicked([]); }}
          brandChoices={brandChoices} picked={picked} setPicked={setPicked} listed={listed} brands={brands} already={already} whyNot={whyNot}
          checked={checked} setChecked={setChecked} consignes={consignes} setConsignes={setConsignes} busy={busy} isAdmin={isAdmin} onPrepare={() => void prepare()} />
      )}
      {step === 'relire' && (
        <Review rows={toReview} pending={pending} isAdmin={isAdmin} onError={onError} onInfo={onInfo} onChanged={() => void loadMessages()} onOpenThread={onOpenThread} />
      )}
      {step === 'suivi' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <select className={input} value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
              <option value="">Toutes les campagnes</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="text-xs text-slate-600">
              {counts.total} mail{counts.total > 1 ? 's' : ''} · {counts.relire} à relire · {counts.attente} en attente d'envoi · {counts.envoyes} envoyé{counts.envoyes > 1 ? 's' : ''} ·{' '}
              <span className="text-emerald-700 font-medium">{counts.repondu} répondu{counts.repondu > 1 ? 's' : ''}</span> · {counts.rebond} rebond{counts.rebond > 1 ? 's' : ''} · {counts.sans} sans réponse{counts.echec ? ` · ${counts.echec} échec${counts.echec > 1 ? 's' : ''}` : ''}
            </span>
          </div>
          {tracked.length === 0 ? <p className="text-sm text-slate-500">Aucun mail de campagne pour l'instant.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Pays</th><th className="px-3 py-2">Ses marques</th><th className="px-3 py-2">État</th><th className="px-3 py-2">Retour</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody>
                  {tracked.map((m) => {
                    const c = m.ai_notes?.campagne;
                    const r = m.reply;
                    const ret = m.status !== 'envoye' ? '—'
                      : !r ? `sans réponse${daysSince(m.sent_at) != null ? ` depuis ${daysSince(m.sent_at)} j` : ''}`
                        : `${CLASS_FR[r.classification ?? 'reponse'] ?? 'a répondu'}${r.intention ? ` : ${INTENT_LABEL[r.intention as typeof REPLY_INTENTS[number]] ?? r.intention}` : ''}${r.received_at ? ` (${fmtDateTime(r.received_at)})` : ''}`;
                    const good = !!r && !['rebond', 'absence', 'antispam', 'stop'].includes(r.classification ?? '');
                    return (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{m.thread?.counterpart_name || m.to_emails[0]}</div>
                          <div className="text-xs text-slate-500">{m.to_emails[0]}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{COUNTRY_FR[c?.pays ?? ''] ?? c?.pays ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{c?.marques_contact?.join(', ') || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{STATUS_FR[m.status] ?? m.status}{m.status === 'envoye' && m.sent_at ? ` le ${fmtDateTime(m.sent_at)}` : ''}{m.status === 'echec' && m.error ? ` — ${m.error}` : ''}</td>
                        <td className={`px-3 py-2 ${good ? 'text-emerald-700 font-medium' : 'text-slate-700'}`}>{ret}</td>
                        <td className="px-3 py-2 text-right"><button type="button" onClick={() => onOpenThread(m.thread_id)} className="text-xs text-brand-ocean hover:underline">ouvrir le fil</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Choose(p: {
  loading: boolean; brandsLoading: boolean; countries: Array<[string, number]>; country: string; setCountry: (c: string) => void;
  brandChoices: Array<{ brand: string; contacts: number }>; picked: string[]; setPicked: (b: string[]) => void;
  listed: NetworkContact[]; brands: Map<string, Array<{ brand: string; n: number }>>; already: (c: NetworkContact) => boolean; whyNot: (c: NetworkContact) => string;
  checked: Set<string>; setChecked: (s: Set<string>) => void; consignes: string; setConsignes: (s: string) => void;
  busy: boolean; isAdmin: boolean; onPrepare: () => void;
}) {
  const togglePick = (b: string) => p.setPicked(p.picked.includes(b) ? p.picked.filter((x) => x !== b) : [...p.picked, b]);
  const selectable = p.listed.filter((c) => !p.already(c));
  const n = selectable.filter((c) => p.checked.has(c.id)).length;
  const keys = new Set(p.picked.map(brandKey));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-700">Pays
          <select className={`${input} ml-2`} value={p.country} onChange={(e) => p.setCountry(e.target.value)}>
            <option value="">Tous ({p.countries.reduce((s, [, k]) => s + k, 0)})</option>
            {p.countries.map(([c, k]) => <option key={c} value={c}>{COUNTRY_FR[c] ?? c} ({k})</option>)}
          </select>
        </label>
        {p.loading && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />lecture de la Carte…</span>}
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1.5">Marques (vues sur leurs vitrines ; aucune cochée = toutes) :</p>
        <div className="flex flex-wrap gap-1.5">
          {p.brandsLoading && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />lecture des vitrines…</span>}
          {p.brandChoices.length === 0 && !p.loading && !p.brandsLoading && <span className="text-xs text-slate-400">aucune vitrine relevée pour ce pays</span>}
          {p.brandChoices.map((b) => (
            <button key={b.brand} type="button" onClick={() => togglePick(b.brand)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${p.picked.includes(b.brand) ? 'bg-brand-encre text-white border-brand-encre' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {b.brand} <span className="opacity-70">{b.contacts}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span>{p.listed.length} contact{p.listed.length > 1 ? 's' : ''} avec e-mail, {n} coché{n > 1 ? 's' : ''}</span>
        <button type="button" className="text-brand-ocean hover:underline" onClick={() => p.setChecked(new Set(selectable.map((c) => c.id)))}>tout cocher</button>
        <button type="button" className="text-brand-ocean hover:underline" onClick={() => p.setChecked(new Set())}>aucun</button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 sticky top-0">
            <tr><th className="px-3 py-2" /><th className="px-3 py-2">Entreprise</th><th className="px-3 py-2">Personne</th><th className="px-3 py-2">E-mail</th><th className="px-3 py-2">Marques en stock</th></tr>
          </thead>
          <tbody>
            {p.listed.map((c) => {
              const done = p.already(c);
              const bs = p.brands.get(c.id) ?? [];
              return (
                <tr key={c.id} className={`border-t border-slate-100 ${done ? 'text-slate-400' : ''}`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" disabled={done} checked={!done && p.checked.has(c.id)}
                      onChange={(e) => { const s = new Set(p.checked); if (e.target.checked) s.add(c.id); else s.delete(c.id); p.setChecked(s); }} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className={`font-medium ${done ? '' : 'text-slate-900'}`}>{c.name}</div>
                    <div className="text-xs text-slate-500">{[KIND_LABEL[c.kind], c.city].filter(Boolean).join(' · ')}{done ? ` · ${p.whyNot(c)}` : ''}</div>
                  </td>
                  <td className="px-3 py-1.5">{c.contact_name || <span className="text-slate-400">— (salutation générale)</span>}</td>
                  <td className="px-3 py-1.5 text-xs">{c.email}</td>
                  <td className="px-3 py-1.5 text-xs">{bs.length ? [...bs].sort((x, y) => Number(keys.has(brandKey(y.brand))) - Number(keys.has(brandKey(x.brand))) || y.n - x.n).slice(0, 4).map((b) => `${b.brand} ${b.n}`).join(', ') : <span className="text-slate-400">vitrine non relevée</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Consignes à Dana (le mail propose les deux sens, dans la langue du pays, et ouvre la discussion — sans appel ni rendez-vous) :</p>
        <textarea className={`${input} w-full`} rows={3} value={p.consignes} onChange={(e) => p.setConsignes(e.target.value)} />
      </div>
      <button type="button" disabled={!p.isAdmin || p.busy || n === 0} onClick={p.onPrepare} className={`${btn} bg-brand-encre text-white hover:bg-brand-ocean`}>
        {p.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}Préparer {n} brouillon{n > 1 ? 's' : ''}
      </button>
      {!p.isAdmin && <p className="text-xs text-slate-500">Seul un administrateur lance une campagne.</p>}
    </div>
  );
}

function Review({ rows, pending, isAdmin, onError, onInfo, onChanged, onOpenThread }: {
  rows: CampaignMessage[]; pending: number; isAdmin: boolean; onError: (m: string) => void; onInfo: (m: string) => void; onChanged: () => void; onOpenThread: (id: string) => void;
}) {
  const [i, setI] = useState(0);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const queue = useMemo(() => rows.filter((m) => !skipped.has(m.id)), [rows, skipped]);
  const m = queue[Math.min(i, Math.max(0, queue.length - 1))];
  useEffect(() => { if (m) { setSubject(m.subject); setBody(m.body_text); } }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) {
    return (
      <div className="space-y-2">
        <Banner tone="ok">{pending > 0 ? 'Dana rédige : les prochains mails arrivent ici dans quelques instants.' : rows.length === 0 ? 'Aucun mail à relire. Préparez une campagne dans « 1. Choisir ».' : 'Tous les mails ont été passés.'}</Banner>
        {skipped.size > 0 && <button type="button" className="text-xs text-brand-ocean hover:underline" onClick={() => { setSkipped(new Set()); setI(0); }}>revoir les {skipped.size} mail{skipped.size > 1 ? 's' : ''} passé{skipped.size > 1 ? 's' : ''}</button>}
      </div>
    );
  }
  const changed = subject.trim() !== m.subject || body !== m.body_text;
  const next = () => setI((x) => Math.min(x, Math.max(0, queue.length - 2)));
  const send = async () => {
    setBusy(true);
    const e1 = changed ? await editDraft(m.id, { to: m.to_emails, cc: m.cc_emails, subject, body }) : null;
    const e2 = e1 ? null : await setMessageStatus(m.id, 'valide');
    setBusy(false);
    if (e1 || e2) { onError(e1 ?? e2 ?? '?'); return; }
    onInfo(`Validé : le mail à ${m.to_emails[0]} part de la boîte de Dana dès que ses horaires, son plafond du jour et l'écart entre deux envois le permettent.`);
    next();
    onChanged();
  };
  const refuse = async () => {
    const reason = window.prompt('Pourquoi refuser ce mail ? (facultatif — Dana en tient compte)', '') ?? null;
    if (reason === null) return;
    setBusy(true);
    const e = await setMessageStatus(m.id, 'refuse', reason);
    setBusy(false);
    if (e) { onError(e); return; }
    next();
    onChanged();
  };
  const skip = () => { setSkipped((s) => new Set(s).add(m.id)); next(); };
  const c = m.ai_notes?.campagne;
  const alerts = m.ai_notes?.alertes ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium text-slate-900">{m.thread?.counterpart_name || '(personne inconnue)'}</span>
          <span className="text-slate-500"> · {m.to_emails[0]} · {COUNTRY_FR[c?.pays ?? ''] ?? c?.pays ?? ''}{c?.marques_contact?.length ? ` · ${c.marques_contact.join(', ')}` : ''}{m.ai_notes?.langue ? ` · écrit en ${m.ai_notes.langue}` : ''}</span>
        </div>
        <span className="text-xs text-slate-500">{Math.min(i + 1, queue.length)} sur {queue.length}{pending > 0 ? ' (d\'autres arrivent)' : ''}</span>
      </div>
      {alerts.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-0.5">
          {alerts.map((a, k) => <li key={k}>• {a}</li>)}
        </ul>
      )}
      <input className={`${input} w-full font-medium`} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs text-slate-500 mb-1">Le mail (corrigeable) :</p>
          <textarea className={`${input} w-full font-mono text-[13px]`} rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Traduction française{m.translation_fr ? '' : ' (mail en français)'} :</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 whitespace-pre-wrap min-h-[20rem]">{m.translation_fr ?? body}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!isAdmin || busy} onClick={() => void send()} className={`${btn} bg-brand-encre text-white hover:bg-brand-ocean`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Envoyer{changed ? ' (corrigé)' : ''}
        </button>
        <button type="button" disabled={busy} onClick={skip} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><SkipForward className="w-4 h-4" />Passer</button>
        <button type="button" disabled={!isAdmin || busy} onClick={() => void refuse()} className={`${btn} border border-red-200 bg-white text-red-700 hover:bg-red-50`}><Ban className="w-4 h-4" />Refuser</button>
        <button type="button" onClick={() => onOpenThread(m.thread_id)} className="text-xs text-brand-ocean hover:underline ml-auto">ouvrir le fil</button>
      </div>
      {!isAdmin && <p className="text-xs text-slate-500">Seul un administrateur envoie.</p>}
    </div>
  );
}
