/**
 * RELANCE GROUPÉE DEPUIS LA CARTE (07/11, Channing : « une fois qu'on peut trier par catégorie / pays / marques,
 * envoyer un mail à plusieurs personnes sans qu'eux puissent voir tous les mails associés, les cc »).
 *
 * Un e-mail PAR destinataire : chacun ne voit que son adresse. Les envois passent par la file d'e-mails des
 * dossiers (dossier_emails), que le worker envoie au nom de la personne connectée, un par un, avec son journal
 * (statut par destinataire ici même). Rien n'est envoyé depuis le navigateur.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Mail, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from '../services/auth';
import { queueContactEmail, listBatchEmails } from '../services/dossierEmails';
import { KIND_LABEL, type NetworkContact } from '../services/network';
import { COUNTRY_NAMES } from '../data/cities';

const DRAFT_KEY = 'ada_group_mail_draft';

export function GroupMailModal({ contacts, scope, onClose }: { contacts: NetworkContact[]; scope: string; onClose: () => void }) {
  const { userId, email, displayName } = useAuth();
  const withMail = useMemo(() => contacts.filter((c) => !!(c.email ?? '').trim()), [contacts]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(withMail.map((c) => c.id)));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [batch, setBatch] = useState<{ id: string; rows: Array<{ id: string; to_email: string; status: string; error: string | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Brouillon gardé sur ce navigateur : une relance se prépare souvent en plusieurs fois.
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); if (d) { setSubject(d.subject ?? ''); setBody(d.body ?? ''); } } catch { /* rien */ } }, []);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, body })); } catch { /* rien */ } }, [subject, body]);
  // Suivi des envois : relu toutes les 5 s tant qu'il reste des mails en file.
  useEffect(() => {
    if (!batch) return;
    const pending = batch.rows.some((r) => r.status === 'queued' || r.status === 'sending');
    if (!pending) return;
    const t = setInterval(() => { void listBatchEmails(batch.id).then((rows) => setBatch((b) => (b ? { ...b, rows } : b))); }, 5000);
    return () => clearInterval(t);
  }, [batch]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const recipients = withMail.filter((c) => picked.has(c.id));
  const firstName = (c: NetworkContact) => (c.contact_name ?? '').trim().split(/\s+/)[0] || '';
  const render = (tpl: string, c: NetworkContact) => tpl.replace(/\{prenom\}/gi, firstName(c)).replace(/\{societe\}/gi, c.name).replace(/\{ville\}/gi, c.city ?? '').replace(/\{pays\}/gi, COUNTRY_NAMES[c.country] ?? c.country);

  const send = async () => {
    if (!email || !userId) { setError('Connecte-toi avec ton adresse Google Workspace : le serveur envoie en ton nom.'); return; }
    if (!subject.trim() || !body.trim()) { setError('Il faut un objet et un texte.'); return; }
    if (recipients.length === 0) { setError('Aucun destinataire coché.'); return; }
    if (!confirm(`Envoyer ${recipients.length} e-mail${recipients.length > 1 ? 's' : ''} séparés, un par destinataire, depuis ${email} ?`)) return;
    setSending(true); setError(null);
    const batchId = crypto.randomUUID();
    const rows: Array<{ id: string; to_email: string; status: string; error: string | null }> = [];
    for (const c of recipients) {
      const r = await queueContactEmail({ contactId: c.id, batchId, to: c.email!, subject: render(subject, c), body: render(body, c), senderEmail: email, senderName: displayName || null, sentBy: userId });
      if (r.error) { setError(r.error); break; }
      rows.push({ id: r.id!, to_email: c.email!, status: 'queued', error: null });
    }
    setSending(false);
    if (rows.length) { setBatch({ id: batchId, rows }); try { localStorage.removeItem(DRAFT_KEY); } catch { /* rien */ } }
  };
  const copyAddresses = async () => { try { await navigator.clipboard.writeText(recipients.map((c) => c.email!.trim()).join(', ')); setError(null); alert(`${recipients.length} adresse${recipients.length > 1 ? 's' : ''} copiée${recipients.length > 1 ? 's' : ''} — à coller en Cci dans ta messagerie.`); } catch { setError('Copie impossible dans ce navigateur.'); } };
  const sentCount = batch ? batch.rows.filter((r) => r.status === 'sent').length : 0;
  const failedRows = batch ? batch.rows.filter((r) => r.status === 'failed') : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Mail className="w-5 h-5 text-brand-ocean" /> Relance groupée</h2>
            <p className="text-xs text-slate-500 mt-0.5">{scope} · {withMail.length} contact{withMail.length > 1 ? 's' : ''} avec une adresse{contacts.length > withMail.length ? ` (${contacts.length - withMail.length} sans adresse, hors envoi)` : ''}. Un e-mail séparé par destinataire : personne ne voit les autres. Expéditeur : {email ?? '—'}.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        {batch ? (
          <div className="px-5 py-4 overflow-auto space-y-3">
            <p className="text-sm text-slate-700">{sentCount} / {batch.rows.length} envoyé{sentCount > 1 ? 's' : ''}{sentCount < batch.rows.length && failedRows.length < batch.rows.length - sentCount ? ' — le serveur envoie les autres un par un (toutes les 20 s environ), tu peux fermer cette fenêtre.' : '.'}</p>
            <ul className="text-xs divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {batch.rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                  {r.status === 'sent' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : r.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> : <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
                  <span className="text-slate-800">{r.to_email}</span>
                  <span className="ml-auto text-slate-500">{r.status === 'sent' ? 'envoyé' : r.status === 'failed' ? `échec : ${r.error ?? ''}` : r.status === 'sending' ? 'envoi…' : 'en file'}</span>
                </li>
              ))}
            </ul>
            <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white">Fermer</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid md:grid-cols-[280px_1fr]">
            <div className="border-r border-slate-200 overflow-auto p-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>{recipients.length} coché{recipients.length > 1 ? 's' : ''}</span>
                <span><button onClick={() => setPicked(new Set(withMail.map((c) => c.id)))} className="text-brand-ocean hover:underline">tous</button> · <button onClick={() => setPicked(new Set())} className="text-brand-ocean hover:underline">aucun</button></span>
              </div>
              {withMail.length === 0 && <p className="text-xs text-slate-500">Aucun contact de la sélection n'a d'adresse e-mail.</p>}
              {withMail.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="mt-0.5" />
                  <span className="min-w-0"><span className="block font-medium text-slate-800 truncate">{c.name}</span><span className="block text-slate-500 truncate">{KIND_LABEL[c.kind]} · {COUNTRY_NAMES[c.country] ?? c.country} · {c.email}</span></span>
                </label>
              ))}
            </div>
            <div className="p-4 space-y-3 overflow-auto">
              <label className="block text-xs text-slate-600">Objet
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ex. MC Export – nos arrivages de la semaine" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </label>
              <label className="block text-xs text-slate-600">Texte
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder={'Bonjour {prenom},\n\n…'} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono" />
              </label>
              <p className="text-[11px] text-slate-500">Champs remplis pour chacun : <code>{'{prenom}'}</code> (interlocuteur), <code>{'{societe}'}</code>, <code>{'{ville}'}</code>, <code>{'{pays}'}</code>. Texte brut, sans mise en forme ; ta signature n'est pas ajoutée automatiquement.</p>
              {recipients.length > 0 && subject && body && (
                <div className="text-xs rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500 mb-1">Aperçu pour {recipients[0].name} :</p>
                  <p className="font-medium text-slate-800">{render(subject, recipients[0])}</p>
                  <pre className="whitespace-pre-wrap font-sans text-slate-700 mt-1">{render(body, recipients[0])}</pre>
                </div>
              )}
              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => void send()} disabled={sending || recipients.length === 0 || !subject.trim() || !body.trim()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Envoyer {recipients.length} e-mail{recipients.length > 1 ? 's' : ''}
                </button>
                <button onClick={() => void copyAddresses()} disabled={recipients.length === 0} className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Pour écrire depuis ta messagerie, en Cci">Copier les adresses (Cci)</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
