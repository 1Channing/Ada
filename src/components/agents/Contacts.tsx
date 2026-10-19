/**
 * QUI CONTACTER, SUR LA FICHE (19/10, Channing après le test DMD : « si on
 * n'a pas le contact qui traite, le contact qui décide est déjà
 * excellent » ; « c'est un commercial d'une concession qui nous a donné le
 * contact » ; l'adresse probable : « on garde cette exception »).
 * - Déjà connue de l'équipe : les personnes que la carte, le Workflow, les
 *   copies ou Channing connaissent — pas de premier mail d'office.
 * - Pour démarrer (qui traite au quotidien), pour décider, pour aiguiller :
 *   chacun avec son adresse et ce qu'elle est (la sienne, son service, une
 *   adresse générale), « à confirmer » si la source a plus d'un an, et
 *   l'adresse probable quand le format de la société est prouvé — qu'un
 *   administrateur seul peut choisir.
 * - La recherche LinkedIn toute prête (à ouvrir connecté) quand la personne
 *   qui traite n'est pas trouvée.
 * - « Le bon contact est… » : l'équipe donne le bon interlocuteur ; l'agente
 *   l'enregistre et propose une leçon.
 */
import { useContext, useState } from 'react';
import { Users, UserCheck, Mail, Phone, Linkedin, AlertTriangle, Search, Send, Compass } from 'lucide-react';
import { queueRightContact, queueProbableMail, type ProspectDetail } from '../../services/agents';
import { teamKnownOf } from '../../lib/agents/teamMemory';
import { addressKind, someoneElsesMail, type AddressKind } from '../../lib/agents/qualification';
import { pickRouter } from '../../lib/agents/firstMail';
import { linkedinPeopleSearch } from '../../lib/agents/roles';
import type { DeepPerson, ContactLevel } from '../../lib/agents/deepResearch';
import { AgentsCtx } from './shared';

const KIND_TXT: Record<AddressKind, string> = { personne: 'son adresse', service: 'adresse de son service', generique: 'adresse générale' };
const KIND_CLS: Record<AddressKind, string> = { personne: 'text-emerald-700', service: 'text-sky-700', generique: 'text-amber-700' };
const field = 'rounded-lg border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';

type Line = Pick<DeepPerson, 'nom' | 'fonction' | 'email' | 'telephone' | 'linkedin' | 'a_confirmer' | 'date_source' | 'email_probable' | 'motif'>;

/** Ce que l'équipe sait déjà de l'entreprise (carte, Workflow, copies, Channing). */
export function TeamKnown({ p }: { p: ProspectDetail }) {
  const known = teamKnownOf(p.people) as DeepPerson[];
  if (!known.length) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-xs space-y-0.5">
      <p className="text-emerald-900 font-medium inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Déjà connue de l'équipe</p>
      {known.map((x, i) => (
        <p key={`${x.nom}-${i}`} className="text-slate-800">
          • <span className="font-medium">{x.nom}</span>{x.fonction && x.fonction !== 'contact de l\'équipe' ? ` — ${x.fonction}` : ''}
          {x.email ? <> · <Mail className="inline w-3 h-3 mx-0.5 text-slate-400" />{x.email}</> : null}
          {x.telephone ? <> · <Phone className="inline w-3 h-3 mx-0.5 text-slate-400" />{x.telephone}</> : null}
          <span className="text-slate-500"> ({x.source})</span>
        </p>
      ))}
      <p className="text-emerald-800">Pas de premier mail d'office : l'équipe connaît déjà quelqu'un ici. Rédiger reste possible à la main.</p>
    </div>
  );
}

function PersonLine({ label, x, kind, probable, onProbable }: { label: string; x: Line | null; kind: AddressKind | null; probable: boolean; onProbable?: (email: string, motif: string) => void }) {
  if (!x) return null;
  return (
    <div className="text-sm">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1.5">{label}</span>
      <span className="text-slate-900 font-medium">{x.nom}</span>{x.fonction ? <span className="text-slate-700"> — {x.fonction}</span> : null}
      {x.linkedin && <a href={x.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center ml-1 text-sky-700 hover:text-sky-900" title="Profil LinkedIn (vu dans une page lue)"><Linkedin className="w-3.5 h-3.5" /></a>}
      {x.email && <span className="text-xs"> · <Mail className="inline w-3.5 h-3.5 mx-0.5 text-slate-400" /><span className="font-medium">{x.email}</span>{kind && <span className={`ml-1 ${KIND_CLS[kind]}`}>({someoneElsesMail(x.email, x.nom) ? 'adresse d\'un collègue' : KIND_TXT[kind]})</span>}</span>}
      {x.telephone && <span className="text-xs"> · <Phone className="inline w-3.5 h-3.5 mx-0.5 text-slate-400" /><a href={`tel:${x.telephone}`} className="hover:text-brand-ocean">{x.telephone}</a></span>}
      {x.a_confirmer && <span className="ml-1.5 text-[11px] rounded-full px-1.5 bg-amber-50 text-amber-800 border border-amber-200" title="La page qui le cite a plus d'un an, et rien de récent ne le confirme dans ce poste">à confirmer{x.date_source ? ` (source ${x.date_source})` : ''}</span>}
      {!x.email && x.email_probable && (
        <span className="block text-xs mt-0.5 text-amber-900">
          <AlertTriangle className="inline w-3 h-3 -mt-0.5 mr-0.5" /> Adresse probable, non publiée : <span className="font-medium">{x.email_probable}</span> <span className="text-slate-500">({x.motif})</span>
          {probable && onProbable && (
            <button onClick={() => onProbable(x.email_probable as string, x.motif ?? 'adresse probable')} className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-amber-400 bg-white px-1.5 py-0 text-[11px] text-amber-900 hover:bg-amber-50">
              <Send className="w-3 h-3" /> Écrire à cette adresse
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Pour démarrer, pour décider, pour aiguiller — et la recherche LinkedIn toute prête. */
export function WhoToContact({ p, agentName }: { p: ProspectDetail; agentName: 'Ada' | 'Dana' }) {
  const ctx = useContext(AgentsCtx);
  const best = p.best_contact;
  const kindOf = (e: string | null | undefined, who: string | null | undefined): AddressKind | null =>
    (e && p.emails.some((x) => x.email === e && x.mx) ? addressKind(e, p.emails.find((x) => x.email === e)?.nature, who) : null);
  const fromWeb = p.people.filter((x) => !x.connu);
  const byLevel = (l: ContactLevel): Line | null => {
    if (best?.nom && best.niveau === l) return { ...(fromWeb.find((x) => x.nom === best.nom) ?? {}), ...best, nom: best.nom } as Line;
    return fromWeb.find((x) => x.niveau === l) ?? null;
  };
  const start = byLevel('demarrer');
  const decide = byLevel('decider');
  // Une fiche d'avant le 19/10 : le contact retenu, sans niveau.
  const legacy = !start && !decide && best?.nom ? ({ ...best, nom: best.nom } as Line) : null;
  const direct = !!best?.email && kindOf(best.email, best.nom) !== null && kindOf(best.email, best.nom) !== 'generique';
  // L'équipe connaît déjà quelqu'un ici (« Déjà connue de l'équipe », au-dessus) : ni aiguillage d'office, ni personne à chercher à froid.
  const teamKnows = teamKnownOf(p.people).length > 0;
  const router = direct || teamKnows ? null : pickRouter(p.people, p.emails, best, addressKind);
  const side = agentName === 'Dana' ? 'dana' : 'ada';
  const probable = async (email: string, motif: string) => {
    if (!ctx) return;
    if (!window.confirm(`Écrire à ${email} ?\n\nCette adresse n'est pas publiée : elle est déduite du format de la société (${motif}). Si elle n'existe pas, le mail revient en rebond, et les rebonds abîment la réputation de mc-export.com.\n\n${agentName} prépare le premier mail ; il arrive dans « À valider », marqué « adresse probable ».`)) return;
    const e = await queueProbableMail(ctx.agent, p.id, email, motif, ctx.userId);
    if (e) ctx.onError(e); else ctx.onInfo(`${agentName} prépare le premier mail à ${email} (adresse probable) : il arrive dans « À valider » d'ici une minute.`);
  };
  const canProbable = !!ctx?.isAdmin;
  return (
    <div className="space-y-1">
      <PersonLine label="Pour démarrer" x={start} kind={kindOf(start?.email, start?.nom)} probable={canProbable} onProbable={(e, m) => void probable(e, m)} />
      <PersonLine label="Pour décider" x={decide} kind={kindOf(decide?.email, decide?.nom)} probable={canProbable} onProbable={(e, m) => void probable(e, m)} />
      <PersonLine label="Contact retenu" x={legacy} kind={kindOf(legacy?.email, legacy?.nom)} probable={canProbable} onProbable={(e, m) => void probable(e, m)} />
      {!start && !teamKnows && (
        <p className="text-xs text-slate-500">
          La personne qui traite au quotidien n'est pas encore trouvée{decide ? ' : celle qui décide est déjà un excellent contact' : ''}.{' '}
          <a href={linkedinPeopleSearch(p.group_name || p.name, side, p.country)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-sky-700 hover:underline" title="À ouvrir connecté à LinkedIn : il montre ce que les moteurs de recherche ne montrent pas">
            <Search className="w-3 h-3" /> La chercher sur LinkedIn
          </a>
        </p>
      )}
      {router && (
        <p className="text-xs text-indigo-900">
          <Compass className="inline w-3.5 h-3.5 -mt-0.5 mr-0.5" /> Pas d'adresse directe : {agentName} prépare un mail d'aiguillage à{' '}
          <span className="font-medium">{router.name ? `${router.name}${router.role ? ` (${router.role})` : ''}` : router.email}</span>
          {router.name ? ` — ${router.email}` : router.address === 'service' ? ' (adresse du service)' : router.address === 'personne' ? ' (adresse d\'un collègue)' : ' (adresse générale)'} pour obtenir le contact direct.
        </p>
      )}
    </div>
  );
}

/** « Le bon contact est… » : l'équipe donne le bon interlocuteur (et comment elle l'a eu). */
export function RightContactForm({ p, agentName }: { p: ProspectDetail; agentName: 'Ada' | 'Dana' }) {
  const ctx = useContext(AgentsCtx);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ nom: '', fonction: '', email: '', telephone: '', comment: '', niveau: 'demarrer' as ContactLevel });
  if (!ctx) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-emerald-800 hover:underline" title={`Donnez le bon interlocuteur : ${agentName} l'enregistre sur la fiche et en tire une leçon, que vous validez`}>
        <UserCheck className="w-3.5 h-3.5" /> Le bon contact est…
      </button>
    );
  }
  const submit = async () => {
    if (f.nom.trim().length < 2) { ctx.onError('Le nom du bon contact, au moins.'); return; }
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email.trim())) { ctx.onError(`Adresse illisible : ${f.email}`); return; }
    setBusy(true);
    const e = await queueRightContact(ctx.agent, {
      prospect_id: p.id, nom: f.nom.trim(), fonction: f.fonction.trim() || null, email: f.email.trim() || null, telephone: f.telephone.trim() || null,
      comment: f.comment.trim() || null, niveau: f.niveau,
    }, ctx.userId);
    setBusy(false);
    if (e) { ctx.onError(e); return; }
    ctx.onInfo(`${agentName} enregistre ${f.nom.trim()} comme le bon contact de ${p.name} et en tire une leçon : vous la validerez dans « Ce que ${agentName} sait ».`);
    setOpen(false);
    setF({ nom: '', fonction: '', email: '', telephone: '', comment: '', niveau: 'demarrer' });
  };
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 px-2.5 py-2 space-y-1.5">
      <p className="text-xs font-medium text-emerald-900">Le bon contact pour {p.name}</p>
      <div className="grid sm:grid-cols-2 gap-1.5">
        <input className={field} placeholder="Prénom et nom *" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} autoFocus />
        <input className={field} placeholder="Fonction (commercial VO marchands…)" value={f.fonction} onChange={(e) => setF({ ...f, fonction: e.target.value })} />
        <input className={field} placeholder="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className={field} placeholder="Téléphone" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} />
      </div>
      <input className={`${field} w-full`} placeholder="Comment l'avez-vous eu ? (un commercial d'une concession nous l'a donné…)" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="inline-flex items-center gap-1"><input type="radio" checked={f.niveau === 'demarrer'} onChange={() => setF({ ...f, niveau: 'demarrer' })} /> pour démarrer (qui traite)</label>
        <label className="inline-flex items-center gap-1"><input type="radio" checked={f.niveau === 'decider'} onChange={() => setF({ ...f, niveau: 'decider' })} /> pour décider</label>
        <button disabled={busy} onClick={() => void submit()} className="ml-auto rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 font-medium disabled:opacity-50">Enregistrer</button>
        <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-800">Annuler</button>
      </div>
      <p className="text-[11px] text-slate-500">Ce que {agentName} avait trouvé reste sur la fiche. Pas de premier mail d'office : vous connaissez déjà cette personne.</p>
    </div>
  );
}
