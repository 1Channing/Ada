/**
 * Réglages d'Ada et Dana (16/10) : la boîte Gmail (connexion par l'écran
 * Google, admin), l'expéditeur et la signature, le rythme anti-spam
 * (plafond du jour, jours et heures d'envoi, écart entre deux premiers
 * contacts), le responsable des alertes — et la liste « ne plus contacter »
 * commune aux deux agentes. Phase 2.2 (17/10) : le travail d'Ada par l'IA
 * (cibles, budget par jour, découvertes et qualifications automatiques,
 * ajout à la carte au-delà d'un score). Dana (17/10) : la taille d'un lot,
 * nos pays de vente (pour les écarts), le même budget, les mêmes
 * automatismes ; ses découvertes se lancent depuis l'onglet Sourcing.
 * 17/10 : une agente à la fois (celle choisie en haut de la page) — sa
 * boîte et son rythme d'envoi à gauche, son travail par l'IA à droite.
 */
import { useEffect, useState } from 'react';
import { Link2, Unlink, Save, Ban, Trash2, Plug, Sparkles } from 'lucide-react';
import {
  oauthUrl, disconnectMailbox, updateSettings, listSuppressions, addSuppression, removeSuppression, updateAiSettings, updateMailSettings, updateResearchSettings, QUALIF_SQL_HINT, MAILS_SQL_HINT, RECHERCHE_SQL_HINT,
  type AgentKey, type AgentSettings, type EditableSettings, type Suppression, type AiSpend,
} from '../../services/agents';
import { normalizeTargets } from '../../lib/agents/qualification';
import { normalizeDanaTargets } from '../../lib/agents/sourcing';
import { DISCOVERY_SITES } from '../../lib/agents/discovery';
import { HOME_COUNTRY } from '../../lib/agents/qualification';
import { fmtUsd } from '../../lib/agents/aiCost';
import { listAssignees, type Assignee } from '../../services/userTasks';
import { fmtDateTime, fmtRelative } from './helpers';

const DAYS = [{ d: 1, l: 'L' }, { d: 2, l: 'M' }, { d: 3, l: 'M' }, { d: 4, l: 'J' }, { d: 5, l: 'V' }, { d: 6, l: 'S' }, { d: 7, l: 'D' }];
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40 disabled:bg-slate-50 disabled:text-slate-500';
const REASONS: Record<Suppression['reason'], string> = { stop: 'Demande d\'arrêt', refus: 'Pas intéressé', rebond: 'Adresse morte', plainte: 'Plainte', manuel: 'Ajout manuel' };

interface Props { agent: AgentKey; settings: AgentSettings[]; isAdmin: boolean; userId: string | null; refreshKey: number; spend: AiSpend | null; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }

const COUNTRY_LABEL: Record<string, string> = { FR: '🇫🇷 France', DE: '🇩🇪 Allemagne', NL: '🇳🇱 Pays-Bas', BE: '🇧🇪 Belgique', ES: '🇪🇸 Espagne', IT: '🇮🇹 Italie', DK: '🇩🇰 Danemark', SE: '🇸🇪 Suède', HU: '🇭🇺 Hongrie' };
const listOf = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const MARKET_CHOICES = ['NL', 'DK', 'BE', 'DE', 'ES', 'IT', 'SE', 'AT'];
const MARKET_LABEL: Record<string, string> = { ...COUNTRY_LABEL, AT: '🇦🇹 Autriche' };

/** Le travail d'Ada ou de Dana par l'IA : cibles, budget, automatismes, premiers contacts. */
function AiForm({ s, isAdmin, userId, spend, onChanged, onError, onInfo }: { s: AgentSettings; isAdmin: boolean; userId: string | null; spend: AiSpend | null; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }) {
  const dana = s.agent === 'dana';
  const t = normalizeTargets(s.targets);
  const dt = normalizeDanaTargets(s.targets);
  const [minLot, setMinLot] = useState(dt.minLot);
  const [markets, setMarkets] = useState<string[]>(dt.markets);
  const [countries, setCountries] = useState<string[]>(t.countries);
  const [brands, setBrands] = useState(t.brands.join(', '));
  const [vanBrands, setVanBrands] = useState(t.vanBrands.join(', '));
  const [multibrand, setMultibrand] = useState(t.multibrand);
  const [budget, setBudget] = useState(Number(s.daily_budget_usd ?? 3));
  const [autoDisc, setAutoDisc] = useState(!!s.auto_discovery);
  const [autoQual, setAutoQual] = useState(s.auto_qualify_per_day ?? 0);
  const [mapAdd, setMapAdd] = useState(s.map_auto_add ?? true);
  const [mapScore, setMapScore] = useState(s.map_min_score ?? 70);
  const [instructions, setInstructions] = useState(s.instructions ?? '');
  const [autoDraft, setAutoDraft] = useState(s.auto_draft_per_day ?? 0);
  const [autoResearch, setAutoResearch] = useState(s.auto_research_per_day ?? 0);
  const researchReady = s.auto_research_per_day !== undefined;
  const [busy, setBusy] = useState(false);
  const mailsReady = s.instructions !== undefined;
  const ro = !isAdmin;
  if (s.daily_budget_usd === undefined) return <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-4 text-xs text-slate-500">{QUALIF_SQL_HINT}</div>;
  const today = spend?.[s.agent];
  const save = async () => {
    setBusy(true);
    if (dana && markets.length === 0) { setBusy(false); onError('Cochez au moins un pays de vente : c\'est là que Dana mesure les écarts.'); return; }
    const e = await updateAiSettings(s.agent, {
      targets: dana ? { minLot, markets } : { countries, brands: listOf(brands), vanBrands: listOf(vanBrands), multibrand },
      daily_budget_usd: Math.max(0, Math.min(100, Math.round(budget * 100) / 100)),
      auto_discovery: autoDisc, auto_qualify_per_day: Math.max(0, Math.min(500, Math.round(autoQual))),
      map_auto_add: mapAdd, map_min_score: Math.max(0, Math.min(100, Math.round(mapScore))),
    }, userId);
    const e2 = !e && mailsReady ? await updateMailSettings(s.agent, { instructions: instructions.trim(), auto_draft_per_day: Math.max(0, Math.min(200, Math.round(autoDraft))) }, userId) : null;
    const e3 = !e && !e2 && researchReady ? await updateResearchSettings(s.agent, Math.max(0, Math.min(20, Math.round(autoResearch))), userId) : null;
    setBusy(false);
    if (e || e2 || e3) onError((e ?? e2 ?? e3) as string); else { onInfo(`Travail de ${s.display_name} enregistré.`); onChanged(); }
  };
  return (
    <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="w-4 h-4 text-violet-700" />
        <p className="text-xs uppercase tracking-wide text-violet-800">Travail de {s.display_name} (IA)</p>
        <span className="ml-auto text-xs text-slate-500">Dépensé : {fmtUsd(today?.today ?? 0)} aujourd'hui · {fmtUsd(today?.month ?? 0)} ce mois</span>
      </div>
      {dana ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-600">Un lot, c'est à partir de</span>
            <select disabled={ro} className={input} value={minLot} onChange={(e) => setMinLot(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-slate-600">véhicules identiques (marque, modèle, année) chez un même garage.</span>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-slate-500">Nos pays de vente (Dana y mesure l'écart brut de chaque lot)</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {MARKET_CHOICES.map((c) => (
                <button key={c} disabled={ro} onClick={() => setMarkets(markets.includes(c) ? markets.filter((x) => x !== c) : [...markets, c])}
                  className={`text-xs rounded-full px-2 py-0.5 border ${markets.includes(c) ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-600'}`}>{MARKET_LABEL[c] ?? c}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Dana cherche dans toute l'Europe, la France comprise : les garages aux plus gros lots d'abord, puis aux meilleurs écarts, hors contacts que l'équipe connaît déjà (carte, fournisseurs du Workflow). Ses découvertes se lancent depuis l'onglet Sourcing.</p>
        </div>
      ) : (<>
      <div className="space-y-1 text-sm">
        <span className="text-xs text-slate-500">Pays visés</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button disabled={ro} onClick={() => setCountries([])} className={`text-xs rounded-full px-2 py-0.5 border ${countries.length === 0 ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-slate-200 text-slate-600'}`}>Pays de nos ventes (automatique)</button>
          {Object.keys(DISCOVERY_SITES).filter((c) => c !== HOME_COUNTRY).map((c) => (
            <button key={c} disabled={ro} onClick={() => setCountries(countries.includes(c) ? countries.filter((x) => x !== c) : [...countries, c])}
              className={`text-xs rounded-full px-2 py-0.5 border ${countries.includes(c) ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-slate-200 text-slate-600'}`}>{COUNTRY_LABEL[c]}</button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">Ada vend à l'export : jamais la France, votre pays d'achat (ses garages sont des fournisseurs possibles, pour Dana — onglet Sourcing). Les découvertes passent par tous les sites du pays (AutoScout24, Marktplaats, Gaspedaal, mobile.de, coches.net, Subito, Bilbasen, Blocket, Jófogás) ; les utilitaires par AutoScout24.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-sm"><span className="text-xs text-slate-500">Marques (voitures)</span>
          <input disabled={ro} className={`${input} w-full`} value={brands} onChange={(e) => setBrands(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-xs text-slate-500">Marques d'utilitaires</span>
          <input disabled={ro} className={`${input} w-full`} value={vanBrands} onChange={(e) => setVanBrands(e.target.value)} /></label>
      </div>
      <label className="inline-flex items-center gap-1.5 text-sm text-slate-700"><input disabled={ro} type="checkbox" checked={multibrand} onChange={(e) => setMultibrand(e.target.checked)} /> Les multimarques comptent aussi</label>
      </>)}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-slate-600">Budget IA par jour :</span>
        <input disabled={ro} type="number" min={0} max={100} step={0.5} className={`${input} w-20`} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        <span className="text-slate-600">$</span>
        <span className="text-xs text-slate-400">Atteint → {s.display_name} s'arrête jusqu'au lendemain. Une qualification coûte de 0,002 à 0,03 $.</span>
      </div>
      {!dana && <label className="flex items-center gap-1.5 text-sm text-slate-700"><input disabled={ro} type="checkbox" checked={autoDisc} onChange={(e) => setAutoDisc(e.target.checked)} /> Découvertes automatiques (jusqu'à 8 par jour, 3 pages chacune, en rotation sur les sites des pays cibles, du lundi au vendredi 8 h-19 h) — sans IA</label>}
      {researchReady ? (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Recherches de comptes d'office par jour :</span>
          <input disabled={ro} type="number" min={0} max={20} className={`${input} w-20`} value={autoResearch} onChange={(e) => setAutoResearch(Number(e.target.value))} />
          <span className="text-xs text-slate-400">{dana ? 'Sociétés de leasing, loueurs, flottes, groupes, négociants B2B, dans toute l\'Europe (la France d\'abord)' : 'Groupes, revendeurs, flottes qui renouvellent, dans ses pays d\'export'}, en rotation ; chaque recherche, environ 0,05 $. 0 = seulement à la demande (onglet Comptes). Les comptes trouvés sont qualifiés avant l'annuaire.</span>
        </div>
      ) : <p className="text-xs text-slate-500">{RECHERCHE_SQL_HINT}</p>}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-slate-600">Garages qualifiés d'office par jour :</span>
        <input disabled={ro} type="number" min={0} max={500} className={`${input} w-20`} value={autoQual} onChange={(e) => setAutoQual(Number(e.target.value))} />
        <span className="text-xs text-slate-400">0 = seulement à la demande (bouton « Qualifier »). {dana ? 'Les plus gros lots d\'abord.' : 'Les meilleurs de l\'annuaire d\'abord.'} Du lundi au vendredi, 8 h-19 h.</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <label className="inline-flex items-center gap-1.5 text-slate-700"><input disabled={ro} type="checkbox" checked={mapAdd} onChange={(e) => setMapAdd(e.target.checked)} /> Ajouter à la carte du réseau{dana ? ', comme vendeurs,' : ''} les garages qualifiés à partir de</label>
        <input disabled={ro || !mapAdd} type="number" min={0} max={100} className={`${input} w-16`} value={mapScore} onChange={(e) => setMapScore(Number(e.target.value))} />
        <span className="text-slate-600">/100</span>
        <span className="text-xs text-slate-400">avec le badge « IA · {s.display_name} », et un e-mail vérifié ou un téléphone.</span>
      </div>
      {mailsReady ? (
        <div className="space-y-2 border-t border-violet-100 pt-3">
          <p className="text-xs uppercase tracking-wide text-violet-800">Premiers contacts (Opus 5.5, rien ne part tout seul)</p>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-600">Rédigés d'office par jour :</span>
            <input disabled={ro} type="number" min={0} max={200} className={`${input} w-20`} value={autoDraft} onChange={(e) => setAutoDraft(Number(e.target.value))} />
            <span className="text-xs text-slate-400">pour les garages au-dessus du seuil. 0 = seulement à la demande. Environ 0,03 à 0,08 $ le mail.</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Petit compte avec un e-mail publié et vérifié : {dana ? 'le mail d\'achat de Dana (aucun prix ni estimation : la négociation passe par vous)' : 'le mail de vente d\'Ada'}, dans « À valider », envoyé depuis {s.mailbox} — jamais plus de deux jours d'envois en attente.
            Grand compte (groupe, loueur, leasing, flotte) : le mail (s'il y a un e-mail publié), la note d'invitation LinkedIn et la fiche d'appel, préparés à votre nom dans « À valider › Pour vous » — vous envoyez vous-même ; jamais plus de 10 en attente.
          </p>
          <label className="block space-y-1 text-sm"><span className="text-xs text-slate-500">Vos consignes à {s.display_name} — elle n'affirme aucune condition qui n'est pas écrite ici</span>
            <textarea disabled={ro} className={`${input} w-full min-h-[110px]`} value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder={dana
                ? 'Ex. : Nous reprenons des lots entiers ou partiels, paiement par virement à l\'enlèvement.\nEnlèvement par notre convoyeur, partout en Europe.\nVéhicules récents seulement (moins de 4 ans), carnet d\'entretien.\nNe jamais citer de prix : je rappelle moi-même.'
                : 'Ex. : Paiement par virement à la commande, enlèvement ou livraison par notre convoyeur (devis à part).\nVéhicules contrôlés, carnet d\'entretien et deux clés.\nNe jamais donner de prix ferme au premier mail.\nNe pas démarcher les concessions du groupe X.'} />
          </label>
        </div>
      ) : <p className="text-xs text-slate-500 border-t border-violet-100 pt-3">{MAILS_SQL_HINT}</p>}
      {isAdmin && <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> Enregistrer le travail de {s.display_name}</button>}
    </div>
  );
}

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
        <span className="text-xs text-slate-500">Copilote : chaque mail de {s.display_name} part seulement après la validation d'un administrateur.</span>
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

export function Reglages({ agent, settings, isAdmin, userId, refreshKey, spend, onChanged, onError, onInfo }: Props) {
  const [people, setPeople] = useState<Assignee[]>([]);
  useEffect(() => { void listAssignees().then(setPeople); }, []);
  const s = settings.find((x) => x.agent === agent);
  // Les formulaires repartent des valeurs enregistrées après chaque enregistrement (ou connexion de la boîte).
  const key = s ? `${agent}-${s.updated_at}-${s.gmail_connected_at ?? ''}` : agent;
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid xl:grid-cols-2 gap-4 items-start">
          <AgentForm key={key} s={s} isAdmin={isAdmin} userId={userId} people={people} onChanged={onChanged} onError={onError} onInfo={onInfo} />
          <AiForm key={`ia-${key}`} s={s} isAdmin={isAdmin} userId={userId} spend={spend} onChanged={onChanged} onError={onError} onInfo={onInfo} />
        </div>
      )}
      <Suppressions userId={userId} refreshKey={refreshKey} onError={onError} />
    </div>
  );
}
