/**
 * Réglages d'Ada et Dana (16/10) : la boîte Gmail (connexion par l'écran
 * Google, admin), l'expéditeur et la signature, le rythme anti-spam
 * (plafond du jour, jours et heures d'envoi, écart entre deux premiers
 * contacts), le responsable des alertes — et la liste « ne plus contacter »
 * commune aux deux agentes.
 */
import { useEffect, useState } from 'react';
import { Link2, Unlink, Save, Ban, Trash2, Plug } from 'lucide-react';
import {
  oauthUrl, disconnectMailbox, updateSettings, listSuppressions, addSuppression, removeSuppression,
  type AgentKey, type AgentSettings, type EditableSettings, type Suppression,
} from '../../services/agents';
import { listAssignees, type Assignee } from '../../services/userTasks';
import { AgentBadge } from './shared';
import { fmtDateTime, fmtRelative } from './helpers';

const DAYS = [{ d: 1, l: 'L' }, { d: 2, l: 'M' }, { d: 3, l: 'M' }, { d: 4, l: 'J' }, { d: 5, l: 'V' }, { d: 6, l: 'S' }, { d: 7, l: 'D' }];
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40 disabled:bg-slate-50 disabled:text-slate-500';
const REASONS: Record<Suppression['reason'], string> = { stop: 'Demande d\'arrêt', refus: 'Pas intéressé', rebond: 'Adresse morte', plainte: 'Plainte', manuel: 'Ajout manuel' };

interface Props { settings: AgentSettings[]; isAdmin: boolean; userId: string | null; refreshKey: number; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }

function AgentForm({ s, isAdmin, userId, people, onChanged, onError, onInfo }: { s: AgentSettings; isAdmin: boolean; userId: string | null; people: Assignee[]; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }) {
  const [f, setF] = useState<EditableSettings>({
    sender_name: s.sender_name, signature: s.signature, daily_first_contact_cap: s.daily_first_contact_cap, send_days: s.send_days,
    send_from: s.send_from.slice(0, 5), send_to: s.send_to.slice(0, 5), min_gap_seconds: s.min_gap_seconds, max_gap_seconds: s.max_gap_seconds, owner_id: s.owner_id,
  });
  const [busy, setBusy] = useState(false);
  const ro = !isAdmin;
  const set = <K extends keyof EditableSettings>(k: K, v: EditableSettings[K]) => setF((x) => ({ ...x, [k]: v }));

  const connect = async () => {
    setBusy(true);
    const r = await oauthUrl(s.agent);
    setBusy(false);
    if (r.error || !r.url) { onError(r.error ?? 'Connexion impossible.'); return; }
    window.location.href = r.url;
  };
  const disconnect = async () => {
    if (!window.confirm(`Débrancher ${s.mailbox} d'ADA ? Les fils déjà importés restent ; plus rien n'arrive ni ne part jusqu'à la reconnexion.`)) return;
    const e = await disconnectMailbox(s.agent);
    if (e) onError(e); else { onInfo(`${s.mailbox} débranchée.`); onChanged(); }
  };
  const save = async () => {
    if (f.send_days.length === 0) { onError('Cochez au moins un jour d\'envoi.'); return; }
    if (f.send_to <= f.send_from) { onError('L\'heure de fin doit suivre l\'heure de début.'); return; }
    setBusy(true);
    const e = await updateSettings(s.agent, {
      ...f, daily_first_contact_cap: Math.max(0, Math.min(200, Math.round(f.daily_first_contact_cap))),
      min_gap_seconds: Math.max(0, Math.round(f.min_gap_seconds)), max_gap_seconds: Math.max(0, Math.round(f.max_gap_seconds)),
    }, userId);
    setBusy(false);
    if (e) onError(e); else { onInfo(`Réglages de ${s.display_name} enregistrés.`); onChanged(); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
      <div className="flex items-center gap-2">
        <AgentBadge agent={s.agent} />
        <span className="text-sm text-slate-600">{s.role === 'acheteurs' ? 'trouve des acheteurs' : 'trouve des vendeurs'}</span>
      </div>

      <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">Boîte Gmail</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-900">{s.mailbox}</span>
          {s.gmail_connected_email
            ? <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-[11px]">connectée le {fmtDateTime(s.gmail_connected_at)}</span>
            : <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px]">pas encore connectée</span>}
        </div>
        {s.gmail_connected_email && <p className="text-xs text-slate-500">Dernière relève : {fmtRelative(s.last_sync_at)}</p>}
        {s.last_sync_error && <p className="text-xs text-red-700">{s.last_sync_error}</p>}
        {isAdmin ? (
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy} onClick={() => void connect()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50">
              {s.gmail_connected_email ? <Link2 className="w-4 h-4" /> : <Plug className="w-4 h-4" />} {s.gmail_connected_email ? 'Reconnecter' : `Connecter ${s.mailbox}`}
            </button>
            {s.gmail_connected_email && <button onClick={() => void disconnect()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Unlink className="w-4 h-4" /> Débrancher</button>}
          </div>
        ) : <p className="text-xs text-slate-500">Un administrateur connecte la boîte.</p>}
        <p className="text-[11px] text-slate-400">L'écran Google s'ouvre : connectez-vous avec <b>{s.mailbox}</b> (pas votre propre compte) et acceptez l'accès Gmail. ADA ne lit que cette boîte.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-sm"><span className="text-xs text-slate-500">Nom d'expéditeur</span>
          <input disabled={ro} className={`${input} w-full`} value={f.sender_name} onChange={(e) => set('sender_name', e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-xs text-slate-500">Responsable (reçoit les alertes)</span>
          <select disabled={ro} className={`${input} w-full`} value={f.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value || null)}>
            <option value="">— personne —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
      </div>
      <label className="block space-y-1 text-sm"><span className="text-xs text-slate-500">Signature (ajoutée à chaque nouveau message, modifiable avant envoi)</span>
        <textarea disabled={ro} className={`${input} w-full min-h-[80px]`} value={f.signature} onChange={(e) => set('signature', e.target.value)} /></label>

      <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Rythme anti-spam</p>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Premiers contacts et relances par jour :</span>
          <input disabled={ro} type="number" min={0} max={200} className={`${input} w-20`} value={f.daily_first_contact_cap} onChange={(e) => set('daily_first_contact_cap', Number(e.target.value))} />
          <span className="text-xs text-slate-400">10 la 1re semaine, puis 20, puis 30 à 40 au plus. Les réponses ne sont pas plafonnées.</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Jours :</span>
          {DAYS.map((d) => (
            <button key={d.d} disabled={ro} onClick={() => set('send_days', f.send_days.includes(d.d) ? f.send_days.filter((x) => x !== d.d) : [...f.send_days, d.d].sort())}
              className={`w-7 h-7 rounded-full border text-xs ${f.send_days.includes(d.d) ? 'border-brand-ocean bg-blue-50 text-brand-encre font-semibold' : 'border-slate-200 text-slate-400'}`}>{d.l}</button>
          ))}
          <span className="text-slate-600 ml-2">de</span>
          <input disabled={ro} type="time" className={input} value={f.send_from} onChange={(e) => set('send_from', e.target.value)} />
          <span className="text-slate-600">à</span>
          <input disabled={ro} type="time" className={input} value={f.send_to} onChange={(e) => set('send_to', e.target.value)} />
          <span className="text-xs text-slate-400">(heure de Paris)</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Écart entre deux premiers contacts : de</span>
          <input disabled={ro} type="number" min={0} className={`${input} w-20`} value={Math.round(f.min_gap_seconds / 60)} onChange={(e) => set('min_gap_seconds', Number(e.target.value) * 60)} />
          <span className="text-slate-600">à</span>
          <input disabled={ro} type="number" min={0} className={`${input} w-20`} value={Math.round(f.max_gap_seconds / 60)} onChange={(e) => set('max_gap_seconds', Number(e.target.value) * 60)} />
          <span className="text-slate-600">minutes (au hasard)</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {isAdmin && <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> Enregistrer</button>}
        <span className="text-xs text-slate-500">IA : pas encore branchée (phase 2). {s.display_name} est en {s.status === 'active' ? 'activité' : 'pause'}.</span>
      </div>
    </div>
  );
}

function Suppressions({ userId, refreshKey, onError }: { userId: string | null; refreshKey: number; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<Suppression['reason']>('manuel');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const load = async () => { const r = await listSuppressions(); if (r.error) onError(r.error); else setRows(r.rows); };
  useEffect(() => { void load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    const e = await addSuppression(email, reason, note, null, userId);
    if (e) { onError(e); return; }
    setEmail(''); setNote(''); void load();
  };
  const shown = q ? rows.filter((r) => r.email.includes(q.toLowerCase())) : rows;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Ban className="w-4 h-4 text-rose-600" />
        <h3 className="text-sm font-semibold text-slate-900">Ne plus contacter</h3>
        <span className="text-xs text-slate-400">{rows.length}</span>
        <span className="text-xs text-slate-500">— commune à Ada et Dana : rien ne part vers ces adresses. Les « stop » et adresses mortes s'ajoutent seuls.</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${input} w-64`} placeholder="jean@garage.fr ou @garage.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className={input} value={reason} onChange={(e) => setReason(e.target.value as Suppression['reason'])}>
          {(Object.keys(REASONS) as Suppression['reason'][]).map((k) => <option key={k} value={k}>{REASONS[k]}</option>)}
        </select>
        <input className={`${input} flex-1 min-w-[160px]`} placeholder="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button disabled={!email.trim()} onClick={() => void add()} className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">Ajouter</button>
      </div>
      {rows.length > 8 && <input className={`${input} w-64`} placeholder="Chercher une adresse…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
        {shown.length === 0 && <p className="py-3 text-sm text-slate-400">Personne pour l'instant.</p>}
        {shown.map((r) => (
          <div key={r.email} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="font-medium text-slate-800">{r.email}</span>
            <span className="text-xs text-slate-500">{REASONS[r.reason]}</span>
            {r.note && <span className="text-xs text-slate-400 truncate">· {r.note}</span>}
            <span className="ml-auto text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
            <button onClick={() => { if (window.confirm(`Retirer ${r.email} de la liste ?`)) void removeSuppression(r.email).then((e) => (e ? onError(e) : void load())); }} className="text-slate-300 hover:text-rose-600" title="Retirer"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Reglages({ settings, isAdmin, userId, refreshKey, onChanged, onError, onInfo }: Props) {
  const [people, setPeople] = useState<Assignee[]>([]);
  useEffect(() => { void listAssignees().then(setPeople); }, []);
  return (
    <div className="space-y-4">
      <div className="grid xl:grid-cols-2 gap-4">
        {(['ada', 'dana'] as AgentKey[]).map((k) => {
          const s = settings.find((x) => x.agent === k);
          return s ? <AgentForm key={`${k}-${s.updated_at}-${s.gmail_connected_at ?? ''}`} s={s} isAdmin={isAdmin} userId={userId} people={people} onChanged={onChanged} onError={onError} onInfo={onInfo} /> : null;
        })}
      </div>
      <Suppressions userId={userId} refreshKey={refreshKey} onError={onError} />
    </div>
  );
}
