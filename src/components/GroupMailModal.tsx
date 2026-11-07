/**
 * RELANCE GROUPÉE DEPUIS LA CARTE (07/11, Channing : « une fois qu'on peut trier par catégorie / pays / marques,
 * envoyer un mail à plusieurs personnes sans qu'eux puissent voir tous les mails associés, les cc »).
 *
 * Un e-mail PAR destinataire : chacun ne voit que son adresse. Les envois passent par la file d'e-mails des
 * dossiers (dossier_emails), que le worker envoie au nom de la personne connectée, un par un, avec son journal
 * (statut par destinataire ici même). Rien n'est envoyé depuis le navigateur.
 *
 * 07/11 (suite) : « ouvrir un pop avec un mail type pour chaque catégorie sélectionnée ; pour les loueurs un mail
 * type en anglais demandant les listes à jour ». La fenêtre a un onglet par catégorie présente dans la sélection,
 * chacun pré-rempli avec son modèle (loueurs : anglais ; les autres : français pour les pays francophones, anglais
 * sinon, basculable). Chaque destinataire reçoit le texte de SA catégorie, champs remplis pour lui.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Mail, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from '../services/auth';
import { queueContactEmail, listBatchEmails } from '../services/dossierEmails';
import { KIND_LABEL, type NetworkContact, type ContactKind } from '../services/network';
import { COUNTRY_NAMES } from '../data/cities';

type Lang = 'fr' | 'en';
type Draft = { subject: string; body: string; lang: Lang };
const FRENCH_COUNTRIES = new Set(['FR', 'BE', 'LU', 'MC', 'CH']);

/** Modèles par catégorie. {prenom} {societe} {ville} {pays} {signature} sont remplis pour chaque destinataire. */
const TEMPLATES: Record<ContactKind, Record<Lang, { subject: string; body: string }>> = {
  loueur: {
    en: {
      subject: 'MC Export – request for your updated de-fleet vehicle list',
      body: 'Hello {prenom},\n\nMC Export buys de-fleeted vehicles for export, in volume and with fast payment and collection.\n\nCould you please send us your updated list of vehicles currently for sale (make, model, year, mileage, fuel, price)? We can also set up a regular feed if that is easier on your side.\n\nThank you in advance,\n{signature}',
    },
    fr: {
      subject: 'MC Export – votre liste de véhicules à jour',
      body: 'Bonjour {prenom},\n\nMC Export rachète des véhicules de flotte pour l\'export, en volume, avec paiement et enlèvement rapides.\n\nPourriez-vous nous envoyer votre liste à jour des véhicules en vente (marque, modèle, année, kilométrage, énergie, prix) ? Un envoi régulier est aussi possible si c\'est plus simple pour vous.\n\nMerci d\'avance,\n{signature}',
    },
  },
  leasing: {
    fr: {
      subject: 'MC Export – reprise de vos véhicules en fin de contrat',
      body: 'Bonjour {prenom},\n\nMC Export rachète pour l\'export les véhicules en fin de contrat de location ou de leasing, en volume, avec paiement et enlèvement rapides.\n\nAuriez-vous une liste à jour des véhicules restitués disponibles à la vente (marque, modèle, année, kilométrage, énergie, prix) ? Nous pouvons aussi répondre à des appels d\'offres ou des lots.\n\nMerci d\'avance,\n{signature}',
    },
    en: {
      subject: 'MC Export – purchase of your end-of-lease vehicles',
      body: 'Hello {prenom},\n\nMC Export buys end-of-lease and returned vehicles for export, in volume, with fast payment and collection.\n\nDo you have an updated list of returned vehicles available for sale (make, model, year, mileage, fuel, price)? We also take part in tenders and batch sales.\n\nThank you in advance,\n{signature}',
    },
  },
  concession: {
    fr: {
      subject: 'MC Export – vos véhicules d\'occasion disponibles pour l\'export',
      body: 'Bonjour {prenom},\n\nMC Export rachète des véhicules d\'occasion pour l\'export : reprises, stock ancien, véhicules difficiles à vendre localement. Paiement et enlèvement rapides.\n\nPourriez-vous nous envoyer la liste des véhicules que vous souhaitez céder (marque, modèle, année, kilométrage, énergie, prix) ?\n\nMerci d\'avance,\n{signature}',
    },
    en: {
      subject: 'MC Export – your used vehicles available for export',
      body: 'Hello {prenom},\n\nMC Export buys used vehicles for export: trade-ins, ageing stock, cars that are hard to sell locally. Fast payment and collection.\n\nCould you send us the list of vehicles you would like to sell (make, model, year, mileage, fuel, price)?\n\nThank you in advance,\n{signature}',
    },
  },
  trader: {
    fr: {
      subject: 'MC Export – nos arrivages et vos besoins',
      body: 'Bonjour {prenom},\n\nPetit point sur nos arrivages : dites-nous les marques et modèles que vous recherchez en ce moment (année, kilométrage, budget), nous vous enverrons nos véhicules correspondants.\n\nDe notre côté nous restons preneurs de vos listes disponibles à la vente.\n\nBien à vous,\n{signature}',
    },
    en: {
      subject: 'MC Export – our arrivals and your needs',
      body: 'Hello {prenom},\n\nA quick note on our arrivals: let us know the makes and models you are currently looking for (year, mileage, budget) and we will send you our matching vehicles.\n\nWe also remain interested in your lists of vehicles for sale.\n\nBest regards,\n{signature}',
    },
  },
  convoyeur: {
    fr: {
      subject: 'MC Export – disponibilités et tarifs de convoyage',
      body: 'Bonjour {prenom},\n\nPourriez-vous nous confirmer vos disponibilités des prochaines semaines et vos tarifs à jour (plaque W garage, camion, par zone) ?\n\nMerci d\'avance,\n{signature}',
    },
    en: {
      subject: 'MC Export – availability and transport rates',
      body: 'Hello {prenom},\n\nCould you confirm your availability over the coming weeks and your current rates (driven delivery, truck, by area)?\n\nThank you in advance,\n{signature}',
    },
  },
  autre: {
    fr: {
      subject: 'MC Export – prise de contact',
      body: 'Bonjour {prenom},\n\n\n\nBien à vous,\n{signature}',
    },
    en: {
      subject: 'MC Export – getting in touch',
      body: 'Hello {prenom},\n\n\n\nBest regards,\n{signature}',
    },
  },
};

function defaultLang(kind: ContactKind, members: NetworkContact[]): Lang {
  if (kind === 'loueur') return 'en';
  return members.length > 0 && members.every((c) => FRENCH_COUNTRIES.has(c.country)) ? 'fr' : 'en';
}

export function GroupMailModal({ contacts, scope, onClose }: { contacts: NetworkContact[]; scope: string; onClose: () => void }) {
  const { userId, email, displayName } = useAuth();
  const withMail = useMemo(() => contacts.filter((c) => !!(c.email ?? '').trim()), [contacts]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(withMail.map((c) => c.id)));
  // Un brouillon par catégorie présente, pré-rempli avec le modèle de la catégorie.
  const kinds = useMemo(() => (Object.keys(KIND_LABEL) as ContactKind[]).filter((k) => withMail.some((c) => c.kind === k)), [withMail]);
  const [drafts, setDrafts] = useState<Partial<Record<ContactKind, Draft>>>(() => {
    const d: Partial<Record<ContactKind, Draft>> = {};
    for (const k of (Object.keys(KIND_LABEL) as ContactKind[])) {
      const members = withMail.filter((c) => c.kind === k);
      if (members.length === 0) continue;
      const lang = defaultLang(k, members);
      d[k] = { ...TEMPLATES[k][lang], lang };
    }
    return d;
  });
  const [tab, setTab] = useState<ContactKind | null>(kinds[0] ?? null);
  const [sending, setSending] = useState(false);
  const [batch, setBatch] = useState<{ id: string; rows: Array<{ id: string; to_email: string; status: string; error: string | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  // Nom + société seulement : la signature Gmail enregistrée de l'expéditeur est ajoutée par le serveur (07/11).
  const signature = `${displayName || email || ''}\nMC Export`;
  const render = (tpl: string, c: NetworkContact) => tpl
    .replace(/\{prenom\}/gi, firstName(c)).replace(/\{societe\}/gi, c.name).replace(/\{ville\}/gi, c.city ?? '')
    .replace(/\{pays\}/gi, COUNTRY_NAMES[c.country] ?? c.country).replace(/\{signature\}/gi, signature)
    .replace(/^(Bonjour|Hello) ,/m, '$1,');
  const setDraft = (k: ContactKind, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [k]: { ...(d[k] as Draft), ...patch } }));
  const applyTemplate = (k: ContactKind, lang: Lang) => setDraft(k, { ...TEMPLATES[k][lang], lang });
  const missing = kinds.filter((k) => recipients.some((c) => c.kind === k) && (!drafts[k]?.subject.trim() || !drafts[k]?.body.trim()));

  const send = async () => {
    if (!email || !userId) { setError('Connecte-toi avec ton adresse Google Workspace : le serveur envoie en ton nom.'); return; }
    if (recipients.length === 0) { setError('Aucun destinataire coché.'); return; }
    if (missing.length) { setError(`Il manque l'objet ou le texte pour : ${missing.map((k) => KIND_LABEL[k]).join(', ')}.`); return; }
    if (!confirm(`Envoyer ${recipients.length} e-mail${recipients.length > 1 ? 's' : ''} séparés, un par destinataire, depuis ${email} ?`)) return;
    setSending(true); setError(null);
    const batchId = crypto.randomUUID();
    const rows: Array<{ id: string; to_email: string; status: string; error: string | null }> = [];
    for (const c of recipients) {
      const d = drafts[c.kind] as Draft;
      const r = await queueContactEmail({ contactId: c.id, batchId, to: c.email!.trim(), subject: render(d.subject, c), body: render(d.body, c), senderEmail: email, senderName: displayName || null, sentBy: userId });
      if (r.error) { setError(r.error); break; }
      rows.push({ id: r.id!, to_email: c.email!.trim(), status: 'queued', error: null });
    }
    setSending(false);
    if (rows.length) setBatch({ id: batchId, rows });
  };
  const copyAddresses = async () => { try { await navigator.clipboard.writeText(recipients.map((c) => c.email!.trim()).join(', ')); setError(null); alert(`${recipients.length} adresse${recipients.length > 1 ? 's' : ''} copiée${recipients.length > 1 ? 's' : ''} — à coller en Cci dans ta messagerie.`); } catch { setError('Copie impossible dans ce navigateur.'); } };
  const sentCount = batch ? batch.rows.filter((r) => r.status === 'sent').length : 0;
  const failedRows = batch ? batch.rows.filter((r) => r.status === 'failed') : [];
  const current = tab ? drafts[tab] : undefined;
  const previewFor = tab ? recipients.find((c) => c.kind === tab) ?? withMail.find((c) => c.kind === tab) : undefined;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Mail className="w-5 h-5 text-brand-ocean" /> Relance groupée</h2>
            <p className="text-xs text-slate-500 mt-0.5">{scope} · {withMail.length} contact{withMail.length > 1 ? 's' : ''} avec une adresse{contacts.length > withMail.length ? ` (${contacts.length - withMail.length} sans adresse, hors envoi)` : ''}. Un e-mail séparé par destinataire, au nom de <span className="font-medium text-slate-700">{email ?? '—'}</span> : personne ne voit les autres.</p>
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
              {kinds.map((k) => (
                <div key={k}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 mt-2 mb-0.5 px-2">{KIND_LABEL[k]}</p>
                  {withMail.filter((c) => c.kind === k).map((c) => (
                    <label key={c.id} className="flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="mt-0.5" />
                      <span className="min-w-0"><span className="block font-medium text-slate-800 truncate">{c.name}</span><span className="block text-slate-500 truncate">{COUNTRY_NAMES[c.country] ?? c.country} · {c.email}</span></span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="p-4 space-y-3 overflow-auto">
              {kinds.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {kinds.map((k) => { const n = recipients.filter((c) => c.kind === k).length; return (
                    <button key={k} onClick={() => setTab(k)} className={`text-xs rounded-full px-2.5 py-1 border ${tab === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                      {KIND_LABEL[k]} <span className="opacity-60">{n}</span>
                    </button>
                  ); })}
                </div>
              )}
              {tab && current && (<>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Mail type « {KIND_LABEL[tab]} » — modifiable, envoyé aux {recipients.filter((c) => c.kind === tab).length} contact{recipients.filter((c) => c.kind === tab).length > 1 ? 's' : ''} de cette catégorie</span>
                  <span className="flex items-center gap-1">Modèle :
                    {(['fr', 'en'] as Lang[]).map((l) => <button key={l} onClick={() => applyTemplate(tab, l)} className={`px-1.5 py-0.5 rounded border ${current.lang === l ? 'bg-slate-100 border-slate-400 text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="Remplace l'objet et le texte par le modèle">{l.toUpperCase()}</button>)}
                  </span>
                </div>
                <label className="block text-xs text-slate-600">Objet
                  <input value={current.subject} onChange={(e) => setDraft(tab, { subject: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                </label>
                <label className="block text-xs text-slate-600">Texte
                  <textarea value={current.body} onChange={(e) => setDraft(tab, { body: e.target.value })} rows={11} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                </label>
                <p className="text-[11px] text-slate-500">Champs remplis pour chacun : <code>{'{prenom}'}</code> (interlocuteur), <code>{'{societe}'}</code>, <code>{'{ville}'}</code>, <code>{'{pays}'}</code>, <code>{'{signature}'}</code> (ton nom, MC Export). Ta signature Gmail enregistrée est ajoutée dessous par le serveur.</p>
                {previewFor && (
                  <div className="text-xs rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500 mb-1">Aperçu pour {previewFor.name} :</p>
                    <p className="font-medium text-slate-800">{render(current.subject, previewFor)}</p>
                    <pre className="whitespace-pre-wrap font-sans text-slate-700 mt-1">{render(current.body, previewFor)}</pre>
                  </div>
                )}
              </>)}
              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => void send()} disabled={sending || recipients.length === 0 || missing.length > 0} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">
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
