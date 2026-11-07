/**
 * DEMANDES DU SITE mc-export.com (07/11, Channing : « traiter les demandes du site directement sur Ada, un onglet
 * dispo uniquement pour les administrateurs, avec la possibilité d'envoyer des mails pour les personnes connectées »).
 *
 * Admin seulement. À gauche la liste (à traiter / traitées / écartées, par profil) ; à droite la demande complète,
 * les notes, le statut, et la réponse par e-mail : mail type dans la langue de la demande (offre de rachat, demande
 * de compléments, prise de contact pro), envoyé par le worker au nom du compte connecté, journal par demande.
 * Passer une demande en « traitée » ou « écartée » coche aussi son rappel dans la cloche.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Inbox, Phone, Mail, Loader2, Check, AlertTriangle, RefreshCw, ExternalLink, Send } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listSiteLeads, setLeadStatus, saveLeadNotes, queueLeadEmail, listLeadEmails, leadsWithEmail, LEAD_STATUS_LABEL, type SiteLeadRow, type LeadStatus, type LeadEmail } from '../services/siteLeads';
import { leadTemplates, leadTemplate, leadTemplateFr, leadLang, renderLeadMail, leadCar, LEAD_TEMPLATE_LABEL, type LeadTemplateKey } from '../lib/leadMail';
import { notifyRemindersChanged } from '../services/userTasks';

const KIND_LABEL: Record<string, string> = { acheteur: 'Acheteur pro', vendeur: 'Vendeur pro', particulier: 'Rachat particulier', autre: 'Demande pro' };
const LANG_LABEL: Record<string, string> = { fr: 'français', en: 'anglais', da: 'danois', nl: 'néerlandais', de: 'allemand', it: 'italien', es: 'espagnol' };
const DETAIL_LABEL: Record<string, string> = { gamme: 'Gamme', marque: 'Marque', modele: 'Modèle', annee: 'Année', km: 'Kilométrage', situation: 'Situation', code_postal: 'Code postal', pays: 'Pays', lien: 'Site', type: 'Type', nombre: 'Nombre de véhicules', volume: 'Volume', delai: 'Délai' };
const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

export function Demandes() {
  const { isAdmin } = useAuth();
  const [leads, setLeads] = useState<SiteLeadRow[]>([]);
  const [mailed, setMailed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'toutes'>('nouvelle');
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const [r, m] = await Promise.all([listSiteLeads(), leadsWithEmail()]);
    setLeads(r.leads); setError(r.error); setMailed(m); setLoading(false);
  };
  useEffect(() => { if (isAdmin) void reload(); }, [isAdmin]);

  const filtered = useMemo(() => leads.filter((l) => (statusFilter === 'toutes' || l.status === statusFilter) && (!kindFilter || l.kind === kindFilter)), [leads, statusFilter, kindFilter]);
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const counts = useMemo(() => ({ nouvelle: leads.filter((l) => l.status === 'nouvelle').length, traitee: leads.filter((l) => l.status === 'traitee').length, ecartee: leads.filter((l) => l.status === 'ecartee').length }), [leads]);
  const kinds = useMemo(() => Object.keys(KIND_LABEL).filter((k) => leads.some((l) => l.kind === k)), [leads]);

  if (!isAdmin) {
    return <div className="p-6 text-sm text-slate-600">Cette page est réservée aux administrateurs.</div>;
  }

  const patch = (id: string, p: Partial<SiteLeadRow>) => setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  return (
    <div className="flex h-[calc(100vh-56px)] max-md:flex-col">
      <aside className="w-[420px] max-md:w-full max-md:h-[45vh] shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-brand-ocean" />
            <h1 className="text-lg font-bold text-slate-900">Demandes du site</h1>
            <button onClick={() => void reload()} className="ml-auto p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="Recharger"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
          <p className="text-xs text-slate-500">Formulaires de mc-export.com (accueil B2B, pages de rachat). Réservé aux administrateurs ; les e-mails partent au nom du compte connecté.</p>
          <div className="flex flex-wrap gap-1.5">
            {(['nouvelle', 'traitee', 'ecartee', 'toutes'] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`text-xs rounded-full px-2.5 py-0.5 border ${statusFilter === s ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                {s === 'toutes' ? 'Toutes' : LEAD_STATUS_LABEL[s]} <span className="opacity-60">{s === 'toutes' ? leads.length : counts[s]}</span>
              </button>
            ))}
          </div>
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <button key={k} onClick={() => setKindFilter((f) => (f === k ? null : k))} className={`text-xs rounded-full px-2 py-0.5 border ${kindFilter === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                  {KIND_LABEL[k]} <span className="opacity-60">{leads.filter((l) => l.kind === k).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {error && <p className="m-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {!loading && !error && filtered.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune demande ici.</p>}
          <ul className="divide-y divide-slate-100">
            {filtered.map((l) => {
              const who = text(l.company) || text(l.name) || text(l.email) || text(l.phone) || 'contact sans nom';
              const car = leadCar(l);
              return (
                <li key={l.id}>
                  <button onClick={() => setSelectedId(l.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selectedId === l.id ? 'bg-brand-ocean/5' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">{who}</span>
                      {mailed.has(l.id) && <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-label="e-mail envoyé" />}
                      <span className={`ml-auto text-[11px] rounded-full px-2 py-0.5 shrink-0 ${l.status === 'nouvelle' ? 'bg-amber-100 text-amber-800' : l.status === 'traitee' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{LEAD_STATUS_LABEL[l.status]}</span>
                    </div>
                    <p className="text-xs text-slate-600 truncate">{KIND_LABEL[l.kind] ?? l.kind}{car ? ` · ${car}` : ''}</p>
                    <p className="text-[11px] text-slate-400">{fmt(l.created_at)} · {LANG_LABEL[l.lang] ?? l.lang}{l.country ? ` · ${l.country}` : ''}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
        {selected ? <LeadDetail key={selected.id} lead={selected} onPatch={(p) => patch(selected.id, p)} onMailed={() => setMailed((s) => new Set(s).add(selected.id))} /> : (
          <div className="h-full grid place-items-center text-sm text-slate-500 p-6">Choisis une demande dans la liste.</div>
        )}
      </main>
    </div>
  );
}

function LeadDetail({ lead, onPatch, onMailed }: { lead: SiteLeadRow; onPatch: (p: Partial<SiteLeadRow>) => void; onMailed: () => void }) {
  const { userId, email, displayName } = useAuth();
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mails, setMails] = useState<LeadEmail[]>([]);
  const templates = leadTemplates(lead);
  const [tplKey, setTplKey] = useState<LeadTemplateKey>(templates[0]);
  const [prix, setPrix] = useState('');
  // Nom + société seulement : la signature Gmail enregistrée de l'expéditeur est ajoutée par le serveur (07/11).
  const signature = `${displayName || email || ''}\nMC Export`;
  const [subject, setSubject] = useState(() => leadTemplate(templates[0], lead).subject);
  const [body, setBody] = useState(() => leadTemplate(templates[0], lead).body);
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const loadMails = async () => setMails(await listLeadEmails(lead.id));
  useEffect(() => { void loadMails(); }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Suivi : relu toutes les 5 s tant qu'un envoi est en file.
  useEffect(() => {
    if (!mails.some((m) => m.status === 'queued' || m.status === 'sending')) return;
    const t = setInterval(() => void loadMails(), 5000);
    return () => clearInterval(t);
  }, [mails]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (k: LeadTemplateKey) => { setTplKey(k); const t = leadTemplate(k, lead); setSubject(t.subject); setBody(t.body); };
  const setStatus = async (s: LeadStatus) => {
    setBusy(true); setErr(null);
    const e = await setLeadStatus(lead.id, s);
    if (e) setErr(e); else { onPatch({ status: s }); notifyRemindersChanged(); }
    setBusy(false);
  };
  const saveNotes = async () => { setSavingNotes(true); const e = await saveLeadNotes(lead.id, notes); if (e) setErr(e); else onPatch({ notes: notes.trim() || null }); setSavingNotes(false); };
  const finalSubject = renderLeadMail(subject, lead, { prix, signature });
  const finalBody = renderLeadMail(body, lead, { prix, signature });
  const needsPrice = tplKey === 'offre' && /\{prix\}/i.test(subject + body) && !prix.trim();
  const foreign = leadLang(lead) !== 'fr';
  const edited = subject !== leadTemplate(tplKey, lead).subject || body !== leadTemplate(tplKey, lead).body;
  const send = async () => {
    if (!lead.email) { setErr('Cette demande n\'a pas d\'adresse e-mail : appelle le contact.'); return; }
    if (!email || !userId) { setErr('Connecte-toi avec ton adresse Google Workspace : le serveur envoie en ton nom.'); return; }
    if (needsPrice) { setErr('Indique le montant de l\'offre avant d\'envoyer.'); return; }
    if (!confirm(`Envoyer cet e-mail à ${lead.email} depuis ${email} ?`)) return;
    setSending(true); setErr(null);
    const r = await queueLeadEmail({ leadId: lead.id, to: lead.email, subject: finalSubject, body: finalBody, senderEmail: email, senderName: displayName || null, sentBy: userId });
    setSending(false);
    if (r.error) { setErr(r.error); return; }
    setComposeOpen(false); onMailed(); await loadMails();
  };

  const d = lead.details ?? {};
  const src = lead.source ?? {};
  const who = text(lead.company) || text(lead.name) || 'Contact sans nom';
  return (
    <div className="p-5 max-w-4xl space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{who}{lead.company && lead.name ? <span className="text-slate-500 font-normal"> · {lead.name}</span> : null}</h2>
            <p className="text-xs text-slate-500">{KIND_LABEL[lead.kind] ?? lead.kind} · {LANG_LABEL[lead.lang] ?? lead.lang}{lead.page ? ` · page ${lead.page}` : ''} · reçue le {fmt(lead.created_at)}{lead.kind === 'particulier' ? ' · offre promise sous 24 h ouvrées' : ''}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {lead.status !== 'traitee' && <button disabled={busy} onClick={() => void setStatus('traitee')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Traitée</button>}
            {lead.status !== 'ecartee' && <button disabled={busy} onClick={() => void setStatus('ecartee')} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">Écarter</button>}
            {lead.status !== 'nouvelle' && <button disabled={busy} onClick={() => void setStatus('nouvelle')} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">Remettre à traiter</button>}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Row label="Téléphone">{lead.phone ? <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="text-brand-ocean hover:underline inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.phone}</a> : '—'}</Row>
          <Row label="E-mail">{lead.email ? <a href={`mailto:${lead.email}`} className="text-brand-ocean hover:underline">{lead.email}</a> : '—'}</Row>
          <Row label="Lieu">{[lead.country, text(d.code_postal)].filter(Boolean).join(', ') || '—'}</Row>
          {leadCar(lead) && <Row label="Voiture">{leadCar(lead)}{text(d.gamme) ? ` (${text(d.gamme).toLowerCase()})` : ''}</Row>}
          {Object.entries(d).filter(([k, v]) => !['marque', 'modele', 'annee', 'km', 'gamme', 'code_postal', 'pays'].includes(k) && text(v)).map(([k, v]) => (
            <Row key={k} label={DETAIL_LABEL[k] ?? k}>{/^https?:\/\//.test(text(v)) ? <a href={text(v)} target="_blank" rel="noreferrer" className="text-brand-ocean hover:underline inline-flex items-center gap-1">{text(v)} <ExternalLink className="w-3 h-3" /></a> : text(v)}</Row>
          ))}
          {Object.keys(src).length > 0 && <Row label="Provenance">{Object.entries(src).filter(([, v]) => text(v)).map(([k, v]) => `${k.replace(/^utm_/, '')} : ${text(v)}`).join(' · ')}</Row>}
        </div>
        {lead.message && <div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">{lead.message}</div>}
        <label className="block text-xs text-slate-600">Notes (appel, suite donnée)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (lead.notes ?? '')) void saveNotes(); }} rows={2} placeholder="ex. appelé le 06/11, rappelle lundi…" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          {savingNotes && <span className="text-[11px] text-slate-400">enregistrement…</span>}
        </label>
        {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Mail className="w-4 h-4 text-brand-ocean" /> Répondre par e-mail</h3>
          <span className="text-xs text-slate-500">au nom de {email ?? '—'}</span>
          {!composeOpen && <button onClick={() => setComposeOpen(true)} disabled={!lead.email} className="ml-auto text-xs px-2.5 py-1.5 rounded-lg bg-brand-ocean text-white hover:bg-brand-encre disabled:opacity-50" title={lead.email ? '' : 'Pas d\'adresse e-mail dans la demande'}>Écrire</button>}
        </div>
        {composeOpen && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Mail type :</span>
              {templates.map((k) => <button key={k} onClick={() => applyTemplate(k)} className={`px-2 py-0.5 rounded-full border ${tplKey === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}>{LEAD_TEMPLATE_LABEL[k]}</button>)}
              <span className="text-slate-400">· langue de la demande : {LANG_LABEL[lead.lang] ?? lead.lang}{!['fr', 'en', 'it', 'es', 'de', 'nl'].includes(lead.lang) ? ' (modèle en anglais)' : ''}</span>
            </div>
            {tplKey === 'offre' && (
              <label className="block text-xs text-slate-600">Montant de l'offre (€)
                <input value={prix} onChange={(e) => setPrix(e.target.value)} placeholder="ex. 18 500" className="mt-1 w-48 px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </label>
            )}
            {/* Demande dans une autre langue : le même mail type en français à droite, pour relire ce qu'on envoie (07/11). */}
            <div className={`grid gap-4 ${foreign ? 'lg:grid-cols-2' : ''}`}>
              <div className="space-y-3 min-w-0">
                <label className="block text-xs text-slate-600">Objet
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                </label>
                <label className="block text-xs text-slate-600">Texte
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
                </label>
              </div>
              {foreign && (
                <div className="min-w-0 text-xs rounded-lg border border-dashed border-slate-300 bg-white p-3 space-y-2">
                  <p className="text-slate-500">Traduction française du mail type « {LEAD_TEMPLATE_LABEL[tplKey]} »{edited ? ' — le texte de gauche a été modifié, cette traduction suit le modèle, pas tes retouches' : ''}</p>
                  <p className="font-medium text-slate-800">{renderLeadMail(leadTemplateFr(tplKey).subject, lead, { prix, signature })}</p>
                  <pre className="whitespace-pre-wrap font-sans text-slate-700">{renderLeadMail(leadTemplateFr(tplKey).body, lead, { prix, signature })}</pre>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">Champs : <code>{'{prenom}'}</code>, <code>{'{voiture}'}</code>, <code>{'{prix}'}</code>, <code>{'{signature}'}</code> (ton nom, MC Export). Ta signature Gmail enregistrée est ajoutée dessous par le serveur.</p>
            <div className="text-xs rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500 mb-1">Aperçu — à {lead.email} :</p>
              <p className="font-medium text-slate-800">{finalSubject}</p>
              <pre className="whitespace-pre-wrap font-sans text-slate-700 mt-1">{finalBody}</pre>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void send()} disabled={sending || needsPrice || !subject.trim() || !body.trim()} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer
              </button>
              <button onClick={() => setComposeOpen(false)} className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Annuler</button>
              {needsPrice && <span className="text-xs text-amber-700">Indique le montant de l'offre.</span>}
            </div>
          </div>
        )}
        {mails.length > 0 && (
          <ul className="text-xs divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {mails.map((m) => (
              <li key={m.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {m.status === 'sent' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : m.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> : <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
                  <span className="font-medium text-slate-800 truncate">{m.subject}</span>
                  <span className="ml-auto text-slate-500 shrink-0">{m.status === 'sent' ? `envoyé le ${fmt(m.sent_at ?? m.created_at)}` : m.status === 'failed' ? `échec : ${m.error ?? ''}` : m.status === 'sending' ? 'envoi…' : 'en file'} · {m.sender_email}</span>
                </div>
                <details className="mt-1"><summary className="cursor-pointer text-slate-500">texte</summary><pre className="whitespace-pre-wrap font-sans text-slate-700 mt-1">{m.body}</pre></details>
              </li>
            ))}
          </ul>
        )}
        {mails.length === 0 && !composeOpen && <p className="text-xs text-slate-500">Aucun e-mail envoyé depuis Ada pour cette demande.</p>}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <p className="text-slate-800"><span className="text-slate-500">{label} : </span>{children}</p>;
}
