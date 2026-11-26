/**
 * MON COMPTE (26/11, Channing : « en cliquant sur le nom en haut à droite, j'aimerais que chaque compte ait accès à
 * ses paramètres : nom, prénom, adresse ; il y verrait son organisation et les gens qui y sont, sans pouvoir modifier,
 * juste visuel ; et l'ajout d'une signature e-mail visuelle, avec une prévisualisation pour s'assurer de la taille,
 * et la possibilité de s'envoyer un mail à soi-même pour vérifier. Cette signature fonctionne pour les mails de la
 * Carte, du Workflow, des Ventes, partout »).
 *
 * Ouverte par le nom en haut à droite (/compte), pour tout compte connecté, sans droit particulier.
 *  1. Mes coordonnées : prénom, nom, prénom d'affichage, téléphone, adresse (profiles, ma ligne seulement).
 *  2. Mon organisation : son nom et ses membres, en lecture seule (les droits se règlent dans Admin).
 *  3. Ma signature e-mail : l'image (storage, chemin déduit de l'adresse), prévisualisée À LA TAILLE DU MAIL (420 px de
 *     large au plus, comme le serveur la met sous le texte), et « M'envoyer un e-mail de test » : une ligne dans la
 *     file dossier_emails (kind 'test', vers ma propre adresse) que le worker envoie comme n'importe quel e-mail du
 *     compte — Carte, Ventes, Demandes : une seule file, une seule signature, donc ce test montre exactement ce que
 *     reçoivent les contacts.
 */
import { useEffect, useRef, useState } from 'react';
import { UserRound, Building2, PenLine, Save, Loader2, Check, AlertTriangle, Send, ImagePlus, Trash2, ShieldCheck, Crown } from 'lucide-react';
import { useAuth } from '../services/auth';
import { loadMyAccount, saveMyAccount, listOrgMembers, type MyAccount, type OrgMember } from '../services/myAccount';
import { findSignature, uploadSignature, removeSignature } from '../services/signature';
import { queueSelfTestEmail, getDossierEmailStatus } from '../services/dossierEmails';

const SQL_HINT = 'Colle le SQL du 26/11 (supabase/migrations/20261126100000_mon_compte_relances_pj.sql) pour enregistrer l\'adresse.';

export function MonCompte() {
  const { userId, email, isMcExport } = useAuth();
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [form, setForm] = useState({ display_name: '', first_name: '', last_name: '', phone: '', address: '' });
  const [addressMissing, setAddressMissing] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      setLoading(true);
      const r = await loadMyAccount(userId);
      if (r.error) setError(r.error);
      setAddressMissing(r.addressColumnMissing);
      if (r.account) {
        setAccount(r.account);
        setForm({ display_name: r.account.display_name, first_name: r.account.first_name, last_name: r.account.last_name, phone: r.account.phone, address: r.account.address });
        const m = await listOrgMembers(r.account.organisation);
        setMembers(m.members);
      }
      setLoading(false);
    })();
  }, [userId]);

  const dirty = account && (form.display_name !== account.display_name || form.first_name !== account.first_name || form.last_name !== account.last_name || form.phone !== account.phone || form.address !== account.address);
  const save = async () => {
    if (!userId || !account) return;
    setSaving(true); setError(null); setSaved(false);
    const err = await saveMyAccount(userId, form, !addressMissing);
    if (err) setError(err);
    else {
      const next = { ...account, ...form, display_name: form.display_name.trim() || form.first_name.trim() || account.display_name };
      setAccount(next); setForm({ display_name: next.display_name, first_name: next.first_name, last_name: next.last_name, phone: next.phone, address: next.address });
      useAuth.setState({ displayName: next.display_name });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  };
  const field = (k: keyof typeof form, label: string, placeholder = '', extra?: string) => (
    <label className="block text-xs text-slate-600">{label}{extra && <span className="text-slate-400"> — {extra}</span>}
      <input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} placeholder={placeholder} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
    </label>
  );
  const memberName = (m: OrgMember) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.display_name;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <UserRound className="w-6 h-6 text-brand-ocean" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mon compte</h1>
          <p className="text-sm text-slate-500">{email ?? ''} — mes coordonnées, mon organisation, ma signature e-mail.</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>}

      {!loading && account && (<>
        <Card icon={<UserRound className="w-4 h-4 text-brand-ocean" />} title="Mes coordonnées" hint="visibles par ton équipe ; l'adresse e-mail de connexion ne se change pas ici">
          <div className="grid sm:grid-cols-2 gap-3">
            {field('first_name', 'Prénom')}
            {field('last_name', 'Nom')}
            {field('display_name', 'Prénom d\'affichage', '', 'celui du bandeau et des e-mails')}
            {field('phone', 'Téléphone', '+33 6 …')}
          </div>
          <label className="block text-xs text-slate-600">Adresse{addressMissing && <span className="text-amber-700"> — {SQL_HINT}</span>}
            <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} disabled={addressMissing} placeholder="Rue, code postal, ville" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50" />
          </label>
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={saving || !dirty} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
            </button>
            {saved && <span className="text-xs text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Enregistré</span>}
          </div>
        </Card>

        <Card icon={<Building2 className="w-4 h-4 text-brand-ocean" />} title={`Mon organisation — ${account.organisation}`} hint={`${members.length} compte${members.length > 1 ? 's' : ''} · lecture seule, les droits se règlent dans Admin`}>
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {members.map((m) => (
              <li key={m.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${m.id === userId ? 'bg-slate-50' : ''}`}>
                <span className="w-7 h-7 rounded-full bg-brand-ocean/10 text-brand-ocean text-xs font-semibold grid place-items-center uppercase">{(m.display_name || '?').slice(0, 1)}</span>
                <span className="text-slate-800">{memberName(m)}{m.id === userId && <span className="text-slate-400"> (moi)</span>}</span>
                {m.is_admin && <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><ShieldCheck className="w-3.5 h-3.5" /> admin</span>}
                {m.is_manager && <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><Crown className="w-3.5 h-3.5" /> manager</span>}
              </li>
            ))}
            {members.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Aucun autre compte visible dans cette organisation.</li>}
          </ul>
        </Card>

        <Card icon={<PenLine className="w-4 h-4 text-brand-ocean" />} title="Ma signature e-mail" hint="ajoutée sous chaque e-mail envoyé en mon nom depuis Ada : Carte, Ventes, Demandes du site — une seule file d'envoi">
          <SignatureSection email={email} userId={userId} displayName={account.display_name} canSend={isMcExport} />
        </Card>
      </>)}
    </div>
  );
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        {icon}
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <span className="text-xs text-slate-400 truncate">— {hint}</span>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

/** L'image, prévisualisée à la taille où le serveur la met dans le mail (420 px de large au plus), dépôt/retrait, et le test. */
function SignatureSection({ email, userId, displayName, canSend }: { email: string | null; userId: string | null; displayName: string; canSend: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [test, setTest] = useState<{ id: string; status: string; error: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => { if (!email) return; const s = await findSignature(email); setUrl(s?.url ?? null); if (!s) setDims(null); };
  useEffect(() => { void refresh(); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  // Suivi du test : relu toutes les 4 s jusqu'à « envoyé » ou « échec » (le worker relit la file toutes les 20 s).
  useEffect(() => {
    if (!test || (test.status !== 'queued' && test.status !== 'sending')) return;
    const t = setInterval(() => { void getDossierEmailStatus(test.id).then((r) => { if (r) setTest({ id: test.id, status: r.status, error: r.error }); }); }, 4000);
    return () => clearInterval(t);
  }, [test]);
  if (!email) return null;
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setNote(null);
    const r = await uploadSignature(email, f);
    if (r.error) setNote(r.error); else { setNote('Signature enregistrée : elle sera sous tes prochains e-mails (le serveur la relit dans la demi-heure).'); await refresh(); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm('Retirer ta signature en image ? Tes e-mails partiront sans.')) return;
    setBusy(true); const e = await removeSignature(email); if (e) setNote(e); else { setNote('Signature retirée.'); setUrl(null); setDims(null); } setBusy(false);
  };
  const sendTest = async () => {
    if (!userId) return;
    setBusy(true); setNote(null);
    const r = await queueSelfTestEmail({ email, displayName, userId });
    if (r.error || !r.id) setNote(r.error ?? 'Envoi impossible.'); else setTest({ id: r.id, status: 'queued', error: null });
    setBusy(false);
  };
  const shownW = dims ? Math.min(dims.w, 420) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">PNG ou JPEG, 1,5 Mo au plus. Le serveur l'affiche sous le texte à <span className="font-medium text-slate-700">420 px de large au plus</span> : l'aperçu ci-dessous est à cette taille exacte. Conseil : une image d'environ 420 × 120 px, fond blanc, logo et coordonnées lisibles.</p>
      {url ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] text-slate-400 mb-2">Aperçu dans un e-mail :</p>
          <div className="bg-white rounded-lg border border-slate-200 p-4 max-w-[600px]" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 14, lineHeight: 1.4, color: '#111' }}>
            <div>Bonjour,</div><div><br /></div><div>Voici le texte de l'e-mail, tel qu'il part.</div><div><br /></div>
            <div>Bien à vous,</div><div>{displayName || email}</div><div>MC Export</div><div><br /></div>
            <img src={url} alt="Ma signature" style={{ maxWidth: 420, height: 'auto', display: 'block' }} onLoad={(e) => { const im = e.currentTarget; setDims({ w: im.naturalWidth, h: im.naturalHeight }); }} />
          </div>
          {dims && <p className="text-[11px] text-slate-500 mt-2">Image de {dims.w} × {dims.h} px{shownW && shownW < dims.w ? ` — réduite à ${shownW} px de large dans le mail` : ''}{dims.h > 220 ? ' · assez haute : les contacts devront faire défiler pour la voir en entier' : ''}.</p>}
        </div>
      ) : <p className="text-xs text-slate-500">Aucune image pour {email} : tes e-mails partent avec ton nom et « MC Export » en texte (et ta signature Gmail si tu en as une).</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-brand-ocean text-white hover:bg-brand-encre disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {url ? 'Remplacer l\'image' : 'Déposer une image'}
        </button>
        {url && <button onClick={() => void remove()} disabled={busy} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Retirer</button>}
        <button onClick={() => void sendTest()} disabled={busy || !canSend} title={canSend ? `Un e-mail de test part vers ${email}, avec ta signature, par la même file que tous tes envois` : 'Réservé aux comptes MC Export (le serveur envoie avec leur adresse Google Workspace)'} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Send className="w-3.5 h-3.5" /> M'envoyer un e-mail de test
        </button>
      </div>
      {test && (
        <p className={`text-xs flex items-center gap-1.5 ${test.status === 'sent' ? 'text-emerald-700' : test.status === 'failed' ? 'text-red-700' : 'text-slate-600'}`}>
          {test.status === 'sent' ? <Check className="w-3.5 h-3.5" /> : test.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {test.status === 'sent' ? `E-mail de test envoyé à ${email} : regarde ta boîte (et les spams la première fois).` : test.status === 'failed' ? `Échec : ${test.error ?? ''}` : 'En file — le serveur l\'envoie dans la minute…'}
        </p>
      )}
      {note && <p className="text-[11px] text-amber-700">{note}</p>}
    </div>
  );
}
