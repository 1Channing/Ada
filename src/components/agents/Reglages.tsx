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
 * 17/10 (Channing : « ce n'est pas notre lexique ») : le travail de chaque
 * jour en trois étapes, avec les mots de l'équipe — chercher des
 * entreprises, préparer leur fiche, écrire le premier mail.
 * 17/10 : un seul « Enregistrer » pour tous les réglages de l'agente (les
 * deux colonnes), toujours en vue ; ses jours et heures de travail valent
 * pour le travail automatique comme pour l'envoi (00:00 à 00:00 = toute la
 * journée).
 * 18/10 : les marques à cocher dans un menu déroulant (plus de saisie) ; une
 * étape de plus, « aller plus loin » sur les grands comptes à compléter
 * (recherches approfondies d'office par jour, gardées dans targets) ; à qui
 * part le bilan du jour (les comptes MC Export cochés, targets.recapTo).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Link2, Unlink, Save, Ban, Trash2, Plug, Sparkles } from 'lucide-react';
import {
  oauthUrl, disconnectMailbox, updateSettings, listSuppressions, addSuppression, removeSuppression, updateAiSettings, updateMailSettings, updateResearchSettings, listMcExportAccounts, QUALIF_SQL_HINT, MAILS_SQL_HINT, RECHERCHE_SQL_HINT,
  type AgentKey, type AgentSettings, type EditableSettings, type Suppression, type AiSpend, type TeamAccount,
} from '../../services/agents';
import { normalizeTargets, ADA_SCORE_HELP, REACH_SCORE_HELP, AI_ADJUST, type ScoreLine } from '../../lib/agents/qualification';
import { normalizeDanaTargets, DANA_SCORE_HELP } from '../../lib/agents/sourcing';
import { accountScoreHelp, RESEARCH_COUNTRIES } from '../../lib/agents/research';
import { DISCOVERY_SITES } from '../../lib/agents/discovery';
import { HOME_COUNTRY } from '../../lib/agents/qualification';
import { fmtUsd } from '../../lib/agents/aiCost';
import { listAssignees, type Assignee } from '../../services/userTasks';
import { fmtDateTime, fmtRelative, workHoursLabel, deName } from './helpers';
import { toMinutes, endMinutes, suppressionMatch } from '../../lib/agents/sendPolicy';
import { recapToOf } from '../../lib/agents/recap';
import { InfoTip, CheckDropdown } from './shared';
import { CAR_BRANDS, VAN_BRANDS, brandChoices } from '../../lib/agents/brands';
import { deepPerDayOf } from '../../lib/agents/deepResearch';

const DAYS = [{ d: 1, l: 'L' }, { d: 2, l: 'M' }, { d: 3, l: 'M' }, { d: 4, l: 'J' }, { d: 5, l: 'V' }, { d: 6, l: 'S' }, { d: 7, l: 'D' }];
const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40 disabled:bg-slate-50 disabled:text-slate-500';
const REASONS: Record<Suppression['reason'], string> = { stop: 'Demande d\'arrêt', refus: 'Pas intéressé', rebond: 'Adresse morte', plainte: 'Plainte', manuel: 'Ajout manuel' };

interface Props { agent: AgentKey; settings: AgentSettings[]; isAdmin: boolean; userId: string | null; refreshKey: number; spend: AiSpend | null; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }

/** Ce que chaque colonne des Réglages donne au bouton « Enregistrer » commun : un contrôle, puis l'enregistrement (null = tout va bien). */
interface FormHandle { check: () => string | null; save: () => Promise<string | null> }
/** Un clic sur une pastille à cocher (jours, pays) ou sur « Tout cocher / Tout décocher » d'un menu : une modification. */
const toggled = (e: React.MouseEvent) => !!(e.target as HTMLElement).closest('button[aria-pressed], button[data-modifie]');

const COUNTRY_LABEL: Record<string, string> = {
  FR: '🇫🇷 France', DE: '🇩🇪 Allemagne', NL: '🇳🇱 Pays-Bas', BE: '🇧🇪 Belgique', ES: '🇪🇸 Espagne', IT: '🇮🇹 Italie', DK: '🇩🇰 Danemark', SE: '🇸🇪 Suède', HU: '🇭🇺 Hongrie',
  LU: '🇱🇺 Luxembourg', AT: '🇦🇹 Autriche', PT: '🇵🇹 Portugal', PL: '🇵🇱 Pologne',
};
const MARKET_CHOICES = ['NL', 'DK', 'BE', 'DE', 'ES', 'IT', 'SE', 'AT'];
const MARKET_LABEL = COUNTRY_LABEL;
const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)));
/** Où Dana cherche : les pays de ses recherches web et ceux dont ADA relève les annonces, la France d'abord. */
const DANA_COUNTRIES = [...new Set([...RESEARCH_COUNTRIES, ...Object.keys(DISCOVERY_SITES)])];

/** Comment se calcule la note d'une fiche (le « i » à côté de la note minimale) : les barèmes du calcul, tels quels. */
function ScoreHelp({ dana, name }: { dana: boolean; name: string }) {
  const rows = (title: string, lines: ScoreLine[]) => (
    <div className="space-y-1">
      <p className="font-semibold text-slate-900">{title}</p>
      {lines.map(([l, p, d]) => (
        <div key={l} className="flex items-baseline gap-4">
          <span className="flex-1">{l}{d && <span className="block text-xs text-slate-500">{d}</span>}</span>
          <span className="shrink-0 tabular-nums font-medium text-violet-800">{p}</span>
        </div>
      ))}
    </div>
  );
  const minus = (n: number) => `−${Math.abs(n)}`;
  return (
    <div className="space-y-2.5">
      <p className="font-semibold text-slate-900">Comment se calcule la note (sur 100)</p>
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div className="space-y-2.5">
          {rows(dana ? 'Garage avec des lots (onglet Sourcing)' : 'Garage de l\'annuaire (onglet Acheteurs)', dana ? DANA_SCORE_HELP : ADA_SCORE_HELP)}
          {rows('Entreprise trouvée sur le web (onglet Recherche)', accountScoreHelp(dana ? 'dana' : 'ada'))}
        </div>
        <div className="space-y-2.5">
          {rows('Pour toutes, si on peut la joindre', REACH_SCORE_HELP)}
          <div className="space-y-1">
            <p className="font-medium text-slate-900">Puis l'avis {deName(name)}, après lecture du site : de&nbsp;{minus(AI_ADJUST.min)} à&nbsp;+{AI_ADJUST.max}</p>
            <p>{dana
              ? 'Par exemple +10 pour un groupe, un loueur, un leasing ou une flotte (volumes réguliers), +5 pour un interlocuteur VO ou remarketing identifié, −10 pour une très petite structure, −20 si l\'activité principale n\'est pas le VO récent.'
              : 'Par exemple +10 pour une concession officielle de nos marques ou un spécialiste utilitaires, +5 pour un groupe ou un interlocuteur VO identifié, −10 pour une très petite structure, −20 si l\'activité principale n\'est pas le VO.'}
            </p>
            <p>Hors cible (un concurrent, par exemple) : la fiche est écartée, note 0.</p>
          </div>
          <p className="text-slate-500">La note ne dépasse pas 100. À partir de la note minimale : premier mail automatique et ajout à la carte.</p>
        </div>
      </div>
    </div>
  );
}

/** Une étape du travail de chaque jour : combien, ce qu'elle fait, ce qu'elle coûte. */
function Step({ n, title, unit, value, max, ro, onChange, help, extra }: { n: number; title: string; unit: string; value: number; max: number; ro: boolean; onChange: (v: number) => void; help: string; extra?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5 w-5 h-5 shrink-0 rounded-full bg-violet-600 text-white text-[11px] font-bold flex items-center justify-center">{n}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium text-slate-800">{title}</span>
          <input disabled={ro} type="number" min={0} max={max} className={`${input} w-20`} value={value} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="text-slate-600">{unit}</span>
        </div>
        <p className="text-xs text-slate-500">{help}</p>
        {extra}
      </div>
    </div>
  );
}

/** Le travail d'Ada ou de Dana par l'IA : cibles, budget, automatismes, premiers contacts. */
const AiForm = forwardRef<FormHandle, { s: AgentSettings; isAdmin: boolean; userId: string | null; spend: AiSpend | null; team: TeamAccount[] }>(function AiForm({ s, isAdmin, userId, spend, team }, ref) {
  const dana = s.agent === 'dana';
  const t = normalizeTargets(s.targets);
  const dt = normalizeDanaTargets(s.targets);
  const [minLot, setMinLot] = useState(dt.minLot);
  const [markets, setMarkets] = useState<string[]>(dt.markets);
  // Les marques à cocher (18/10) : la liste, plus celles déjà enregistrées qui n'y sont pas.
  const [danaChoice] = useState(() => brandChoices(CAR_BRANDS, dt.brands));
  const [carChoice] = useState(() => brandChoices(CAR_BRANDS, t.brands));
  const [vanChoice] = useState(() => brandChoices(VAN_BRANDS, t.vanBrands));
  const [danaBrands, setDanaBrands] = useState<string[]>(danaChoice.selected);
  const [countries, setCountries] = useState<string[]>(t.countries);
  const [brands, setBrands] = useState<string[]>(carChoice.selected);
  const [vanBrands, setVanBrands] = useState<string[]>(vanChoice.selected);
  const [deepPerDay, setDeepPerDay] = useState(deepPerDayOf(s.targets));
  const [multibrand, setMultibrand] = useState(t.multibrand);
  const [budget, setBudget] = useState(Number(s.daily_budget_usd ?? 3));
  const [autoDisc, setAutoDisc] = useState(!!s.auto_discovery);
  const [autoQual, setAutoQual] = useState(s.auto_qualify_per_day ?? 0);
  const [mapAdd, setMapAdd] = useState(s.map_auto_add ?? true);
  const [mapScore, setMapScore] = useState(s.map_min_score ?? 70);
  const [instructions, setInstructions] = useState(s.instructions ?? '');
  const [autoDraft, setAutoDraft] = useState(s.auto_draft_per_day ?? 0);
  const [autoResearch, setAutoResearch] = useState(s.auto_research_per_day ?? 0);
  // Le bilan du jour : les comptes cochés (null = jamais choisis : toute l'équipe).
  const [recapTo, setRecapTo] = useState<string[] | null>(recapToOf(s.targets));
  const teamIds = team.map((p) => p.id);
  const researchReady = s.auto_research_per_day !== undefined;
  const mailsReady = s.instructions !== undefined;
  const aiReady = s.daily_budget_usd !== undefined;
  const ro = !isAdmin;
  useImperativeHandle(ref, () => ({
    check: () => (aiReady && dana && markets.length === 0 ? 'Cochez au moins un pays où nous revendons : c\'est là que Dana compare le prix des lots.'
      : aiReady && dana && autoDisc && danaBrands.length === 0 ? 'Cochez au moins une marque pour les relevés d\'annonces de Dana (ou décochez « Relever aussi les annonces »).'
        : aiReady && !dana && brands.length === 0 && vanBrands.length === 0 ? 'Cochez au moins une marque (voitures ou utilitaires) : c\'est ce qu\'Ada cherche chez les garages.' : null),
    save: async () => {
      if (!aiReady) return null;
      const e = await updateAiSettings(s.agent, {
        // Les clés que ce formulaire ne connaît pas restent (rien ne se perd à l'enregistrement).
        targets: {
          ...(s.targets ?? {}),
          ...(dana ? { minLot, markets, brands: danaBrands, deepPerDay: clampInt(deepPerDay, 0, 20) } : { countries, brands, vanBrands, multibrand, deepPerDay: clampInt(deepPerDay, 0, 20) }),
          ...(recapTo ? { recapTo: team.length ? recapTo.filter((id) => teamIds.includes(id)) : recapTo } : {}),
        },
        daily_budget_usd: Math.max(0, Math.min(100, Math.round(budget * 100) / 100)),
        auto_discovery: autoDisc, auto_qualify_per_day: Math.max(0, Math.min(500, Math.round(autoQual))),
        map_auto_add: mapAdd, map_min_score: Math.max(0, Math.min(100, Math.round(mapScore))),
      }, userId);
      if (e) return e;
      const e2 = mailsReady ? await updateMailSettings(s.agent, { instructions: instructions.trim(), auto_draft_per_day: Math.max(0, Math.min(200, Math.round(autoDraft))) }, userId) : null;
      if (e2) return e2;
      return researchReady ? updateResearchSettings(s.agent, Math.max(0, Math.min(20, Math.round(autoResearch))), userId) : null;
    },
  }));
  if (!aiReady) return <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-4 text-xs text-slate-500">{QUALIF_SQL_HINT}</div>;
  const today = spend?.[s.agent];
  return (
    <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="w-4 h-4 text-violet-700" />
        <p className="text-xs uppercase tracking-wide text-violet-800">Travail {deName(s.display_name)} (IA)</p>
        <span className="ml-auto text-xs text-slate-500">Dépensé : {fmtUsd(today?.today ?? 0)} aujourd'hui{today?.bench_today ? ` (dont ${fmtUsd(today.bench_today)} de banc d'essai, hors plafond)` : ''} · {fmtUsd(today?.month ?? 0)} ce mois</span>
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
            <span className="text-xs text-slate-500">Où Dana cherche : la France d'abord, puis toute l'Europe</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DANA_COUNTRIES.map((c) => <span key={c} className="text-xs rounded-full px-2 py-0.5 border border-slate-200 bg-slate-50 text-slate-700">{COUNTRY_LABEL[c] ?? c}</span>)}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-slate-500">Où nous revendons : Dana y compare le prix de chaque lot (l'écart de prix), quel que soit le pays où elle l'a trouvé</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {MARKET_CHOICES.map((c) => (
                <button key={c} disabled={ro} aria-pressed={markets.includes(c)} onClick={() => setMarkets(markets.includes(c) ? markets.filter((x) => x !== c) : [...markets, c])}
                  className={`text-xs rounded-full px-2 py-0.5 border ${markets.includes(c) ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-200 text-slate-600'}`}>{MARKET_LABEL[c] ?? c}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1"><span className="block text-xs text-slate-500">Marques de ses relevés d'annonces (ce que MC Export achète surtout)</span>
            <CheckDropdown disabled={ro} className="w-full" options={danaChoice.options.map((b) => ({ key: b, label: b }))} selected={danaBrands} onChange={setDanaBrands}
              allLabel="Toutes les marques" emptyLabel="Aucune marque cochée" unit="marques" /></div>
          <p className="text-[11px] text-slate-400">Les garages aux plus gros lots d'abord, puis aux meilleurs écarts, hors contacts que l'équipe connaît déjà (carte, fournisseurs du Workflow).</p>
        </div>
      ) : (<>
      <div className="space-y-1 text-sm">
        <span className="text-xs text-slate-500">Pays visés</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button disabled={ro} aria-pressed={countries.length === 0} onClick={() => setCountries([])} className={`text-xs rounded-full px-2 py-0.5 border ${countries.length === 0 ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-slate-200 text-slate-600'}`}>Pays de nos ventes (automatique)</button>
          {Object.keys(DISCOVERY_SITES).filter((c) => c !== HOME_COUNTRY).map((c) => (
            <button key={c} disabled={ro} aria-pressed={countries.includes(c)} onClick={() => setCountries(countries.includes(c) ? countries.filter((x) => x !== c) : [...countries, c])}
              className={`text-xs rounded-full px-2 py-0.5 border ${countries.includes(c) ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-slate-200 text-slate-600'}`}>{COUNTRY_LABEL[c]}</button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">Ada vend à l'export : jamais la France, votre pays d'achat (ses garages sont des fournisseurs possibles, pour Dana — onglet Sourcing). Les découvertes passent par tous les sites du pays (AutoScout24, Marktplaats, Gaspedaal, mobile.de, coches.net, Subito, Bilbasen, Blocket, Jófogás) ; les utilitaires par AutoScout24.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1 text-sm"><span className="block text-xs text-slate-500">Marques (voitures)</span>
          <CheckDropdown disabled={ro} className="w-full" options={carChoice.options.map((b) => ({ key: b, label: b }))} selected={brands} onChange={setBrands}
            allLabel="Toutes les marques" emptyLabel="Aucune marque cochée" unit="marques" /></div>
        <div className="space-y-1 text-sm"><span className="block text-xs text-slate-500">Marques d'utilitaires</span>
          <CheckDropdown disabled={ro} className="w-full" options={vanChoice.options.map((b) => ({ key: b, label: b }))} selected={vanBrands} onChange={setVanBrands}
            allLabel="Toutes les marques" emptyLabel="Aucune marque cochée" unit="marques" /></div>
      </div>
      <label className="inline-flex items-center gap-1.5 text-sm text-slate-700"><input disabled={ro} type="checkbox" checked={multibrand} onChange={(e) => setMultibrand(e.target.checked)} /> Les multimarques comptent aussi</label>
      </>)}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-slate-600">Budget IA par jour :</span>
        <input disabled={ro} type="number" min={0} max={100} step={0.5} className={`${input} w-20`} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        <span className="text-slate-600">$</span>
        <span className="text-xs text-slate-400">Atteint → {s.display_name} s'arrête jusqu'au lendemain.</span>
      </div>
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3 space-y-3">
        <p className="text-xs font-medium text-violet-900">Chaque jour de travail, toute seule ({workHoursLabel(s)}) · 0 = seulement quand vous cliquez</p>
        {researchReady ? (
          <Step n={1} title="Chercher de nouvelles entreprises" unit="recherches par jour" max={20} ro={ro} value={autoResearch} onChange={setAutoResearch}
            help={`Sur le web : ${dana ? 'sociétés de leasing, loueurs, flottes, groupes, négociants B2B, un type dans un pays à chaque fois (la France d\'abord, puis toute l\'Europe).' : 'groupes de concessions, revendeurs, flottes qui renouvellent, un type dans un de ses pays d\'export à chaque fois.'} Ce qu'elle trouve arrive dans l'onglet Recherche. Environ 0,05 $ la recherche, au plus une toutes les 90 minutes.`}
            extra={<label className="flex items-center gap-1.5 text-sm text-slate-700"><input disabled={ro} type="checkbox" checked={autoDisc} onChange={(e) => setAutoDisc(e.target.checked)} /> {dana
              ? 'Relever aussi les annonces (la France d\'abord, puis toute l\'Europe), dans ses marques, pour trouver de nouveaux lots : jusqu\'à 8 relevés par jour, sans IA'
              : 'Relever aussi les annonces de ses pays, pour trouver de nouveaux garages : jusqu\'à 8 relevés par jour, sans IA'}</label>} />
        ) : <p className="text-xs text-slate-500">{RECHERCHE_SQL_HINT}</p>}
        <Step n={2} title="Préparer la fiche des entreprises trouvées" unit="fiches par jour" max={500} ro={ro} value={autoQual} onChange={setAutoQual}
          help={`Qui décide, e-mail et téléphone publiés, LinkedIn s'il est trouvé, note sur 100. D'abord les entreprises de l'onglet Recherche, puis ${dana ? 'les garages aux plus gros lots (Sourcing)' : 'les meilleurs garages de l\'annuaire (Acheteurs)'}. De 0,002 à 0,04 $ la fiche.`} />
        <Step n={3} title="Aller plus loin sur les grands comptes à compléter" unit="par jour" max={20} ro={ro} value={deepPerDay} onChange={setDeepPerDay}
          help={`Quand la fiche d'un grand compte n'a ni la personne qui décide ni e-mail publié : à qui appartient l'entreprise, qui décide${dana ? ' des ventes en lots ou du de-fleet' : ' des achats'} (au niveau du groupe d'abord), les e-mails et téléphones publiés, des pistes pour l'approcher. Une fois par compte et par mois ; aussi à la demande, depuis chaque fiche. Environ 0,10 $ la recherche.`} />
        {mailsReady && (
          <Step n={4} title="Écrire le premier mail" unit="mails par jour" max={200} ro={ro} value={autoDraft} onChange={setAutoDraft}
            help={`Pour les fiches notées au moins ${mapScore}/100. Ils attendent votre validation dans «\u00a0Workflow\u00a0›\u00a0Fiches\u00a0» : rien ne part tout seul. De 0,03 à 0,08 $ le mail.`} />
        )}
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-600">Note minimale d'une bonne fiche :</span>
          <input disabled={ro} type="number" min={0} max={100} className={`${input} w-16`} value={mapScore} onChange={(e) => setMapScore(Number(e.target.value))} />
          <span className="text-slate-600">/100</span>
          <InfoTip wide label="Comment se calcule la note"><ScoreHelp dana={dana} name={s.display_name} /></InfoTip>
          <span className="text-xs text-slate-400">En dessous, ni mail automatique ni ajout à la carte.</span>
        </div>
        <label className="flex items-center gap-1.5 text-slate-700"><input disabled={ro} type="checkbox" checked={mapAdd} onChange={(e) => setMapAdd(e.target.checked)} /> Ajouter les bonnes fiches à la carte du réseau, comme {dana ? 'vendeurs' : 'acheteurs'} (badge «&nbsp;IA · {s.display_name}&nbsp;», avec un e-mail vérifié ou un téléphone)</label>
      </div>
      {mailsReady ? (
        <div className="space-y-2 border-t border-violet-100 pt-3">
          <p className="text-xs uppercase tracking-wide text-violet-800">Premiers mails (rien ne part sans vous)</p>
          <p className="text-[11px] text-slate-500">
            Petit compte avec un e-mail publié et vérifié : {dana ? 'le mail d\'achat de Dana (aucun prix ni estimation : la négociation passe par vous)' : 'le mail de vente d\'Ada'}, dans « Workflow › Fiches », envoyé depuis {s.mailbox} — jamais plus de deux jours d'envois en attente.
            Grand compte (groupe, loueur, leasing, flotte) : tout le plan, préparé dans « Workflow › Fiches » — l'aiguillage s'il n'y a pas d'adresse directe, le mail (à l'adresse publiée de la personne, sinon à son adresse probable, que seul un administrateur envoie), une note d'invitation LinkedIn par personne du plan et la fiche d'appel ; « Envoyer » fait partir le mail de {s.mailbox}, signé {s.display_name} (ou vous l'envoyez de votre boîte) ; les notes LinkedIn et l'appel restent à vous ; jamais plus de 10 en attente.
          </p>
          <label className="block space-y-1 text-sm"><span className="text-xs text-slate-500">Vos consignes à {s.display_name} — elle n'affirme aucune condition qui n'est pas écrite ici</span>
            <textarea disabled={ro} className={`${input} w-full min-h-[110px]`} value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder={dana
                ? 'Ex. : Nous reprenons des lots entiers ou partiels, paiement par virement à l\'enlèvement.\nEnlèvement par notre convoyeur, partout en Europe.\nVéhicules récents seulement (moins de 4 ans), carnet d\'entretien.\nNe jamais citer de prix : je rappelle moi-même.'
                : 'Ex. : Paiement par virement à la commande, enlèvement ou livraison par notre convoyeur (devis à part).\nVéhicules contrôlés, carnet d\'entretien et deux clés.\nNe jamais donner de prix ferme au premier mail.\nNe pas démarcher les concessions du groupe X.'} />
          </label>
        </div>
      ) : <p className="text-xs text-slate-500 border-t border-violet-100 pt-3">{MAILS_SQL_HINT}</p>}
      <div className="space-y-1.5 border-t border-violet-100 pt-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-violet-800">Bilan du jour par mail</p>
        {team.length > 0 ? (
          <CheckDropdown disabled={ro} className="w-full" options={team.map((p) => ({ key: p.id, label: p.name, hint: p.email }))}
            selected={(recapTo ?? teamIds).filter((id) => teamIds.includes(id))} onChange={setRecapTo}
            allLabel={`Toute l'équipe MC Export (${team.length})`} emptyLabel="Personne : pas de bilan" unit="personnes" />
        ) : <p className="text-xs text-slate-500">{isAdmin ? 'Liste de l\'équipe illisible pour l\'instant.' : 'Un administrateur choisit qui le reçoit.'}</p>}
        <p className="text-[11px] text-slate-500">Une fois par jour, dès que {s.display_name} a fini sa journée (sinon à la fin de ses heures, jamais avant 7 h), depuis {s.mailbox} : ses recherches, ses fiches, ce qu'elle a préparé, ce qui vous attend. Ni les boîtes des agentes ni les adresses de « Ne plus contacter » ne sont proposées.</p>
      </div>
    </div>
  );
});

const AgentForm = forwardRef<FormHandle, { s: AgentSettings; isAdmin: boolean; userId: string | null; people: Assignee[]; onChanged: () => void; onError: (m: string) => void; onInfo: (m: string) => void }>(function AgentForm({ s, isAdmin, userId, people, onChanged, onError, onInfo }, ref) {
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
  useImperativeHandle(ref, () => ({
    check: () => {
      if (endMinutes(f.send_to) <= toMinutes(f.send_from)) return 'L\'heure de fin doit suivre l\'heure de début (00:00 en fin = minuit ; 00:00 à 00:00 = toute la journée).';
      return null;
    },
    save: () => updateSettings(s.agent, {
      ...f, daily_first_contact_cap: Math.max(0, Math.min(200, Math.round(f.daily_first_contact_cap))),
      min_gap_seconds: Math.max(0, Math.round(f.min_gap_seconds)), max_gap_seconds: Math.max(0, Math.round(f.max_gap_seconds)),
    }, userId),
  }));

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
      <div className="space-y-1">
        <p className="text-xs text-slate-500">Dans chaque mail qui part de {s.mailbox}, le logo remplace cette signature (image jointe au mail, pas un lien) :</p>
        <img src={`/signatures/${s.agent}.png`} alt={`Signature ${deName(s.display_name)}`} width={300} className="max-w-full h-auto rounded-lg border border-slate-200 bg-white" />
      </div>

      <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Horaires et rythme anti-spam</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-600">Jours et heures de travail :</span>
            {DAYS.map((d) => (
              <button key={d.d} disabled={ro} aria-pressed={f.send_days.includes(d.d)} onClick={() => set('send_days', f.send_days.includes(d.d) ? f.send_days.filter((x) => x !== d.d) : [...f.send_days, d.d].sort())}
                className={`w-7 h-7 rounded-full border text-xs ${f.send_days.includes(d.d) ? 'border-brand-ocean bg-blue-50 text-brand-encre font-semibold' : 'border-slate-200 text-slate-400'}`}>{d.l}</button>
            ))}
            <span className="text-slate-600 ml-2">de</span>
            <input disabled={ro} type="time" className={input} value={f.send_from} onChange={(e) => set('send_from', e.target.value)} />
            <span className="text-slate-600">à</span>
            <input disabled={ro} type="time" className={input} value={f.send_to} onChange={(e) => set('send_to', e.target.value)} />
            <span className="text-xs text-slate-400">(heure de Paris)</span>
          </div>
          <p className="text-xs text-slate-400">{s.display_name} cherche, prépare ses fiches, écrit et envoie dans ces horaires. 00:00 en fin = minuit ; 00:00 à 00:00 = toute la journée.</p>
          {f.send_days.length === 0 && (
            <p className="text-xs text-amber-700">Aucun jour coché : {s.display_name} ne travaille plus d'elle-même, et les mails que vous validez attendent qu'un jour soit coché. Pour un simple arrêt, le bouton « Mettre en pause » en haut suffit : les mails validés, eux, continuent de partir.</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Premiers contacts et relances par jour :</span>
          <input disabled={ro} type="number" min={0} max={200} className={`${input} w-20`} value={f.daily_first_contact_cap} onChange={(e) => set('daily_first_contact_cap', Number(e.target.value))} />
          <span className="text-xs text-slate-400">10 la 1re semaine, puis 20, puis 30 à 40 au plus. Les réponses ne sont pas plafonnées.</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-slate-600">Écart entre deux premiers contacts : de</span>
          <input disabled={ro} type="number" min={0} className={`${input} w-20`} value={Math.round(f.min_gap_seconds / 60)} onChange={(e) => set('min_gap_seconds', Number(e.target.value) * 60)} />
          <span className="text-slate-600">à</span>
          <input disabled={ro} type="number" min={0} className={`${input} w-20`} value={Math.round(f.max_gap_seconds / 60)} onChange={(e) => set('max_gap_seconds', Number(e.target.value) * 60)} />
          <span className="text-slate-600">minutes (au hasard)</span>
        </div>
      </div>
    </div>
  );
});

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
  // Les destinataires possibles du bilan : l'équipe MC Export, sans les boîtes des agentes ni les adresses mortes.
  const [team, setTeam] = useState<TeamAccount[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([listMcExportAccounts(), listSuppressions()]).then(([acc, sup]) => {
      const boxes = new Set(settings.map((x) => x.mailbox.toLowerCase()));
      const dead = sup.rows.map((r) => r.email);
      setTeam(acc.rows.filter((p) => !boxes.has(p.email) && !suppressionMatch([p.email], dead)));
    });
  }, [isAdmin, settings, refreshKey]);
  const s = settings.find((x) => x.agent === agent);
  // Les formulaires repartent des valeurs enregistrées après chaque enregistrement (ou connexion de la boîte).
  const key = s ? `${agent}-${s.updated_at}-${s.gmail_connected_at ?? ''}` : agent;
  const left = useRef<FormHandle>(null);
  const right = useRef<FormHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDirty(false), [key]);
  const name = s?.display_name ?? agent;
  const saveAll = async () => {
    const problem = left.current?.check() ?? right.current?.check() ?? null;
    if (problem) { onError(problem); return; }
    setSaving(true);
    const e = (await left.current?.save()) ?? (await right.current?.save()) ?? null;
    setSaving(false);
    if (e) { onError(e); return; }
    setDirty(false);
    onInfo(`Réglages ${deName(name)} enregistrés.`);
    onChanged();
  };
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid xl:grid-cols-2 gap-4 items-start" onChangeCapture={() => setDirty(true)} onClickCapture={(e) => { if (toggled(e)) setDirty(true); }}>
          <AgentForm ref={left} key={key} s={s} isAdmin={isAdmin} userId={userId} people={people} onChanged={onChanged} onError={onError} onInfo={onInfo} />
          <AiForm ref={right} key={`ia-${key}`} s={s} isAdmin={isAdmin} userId={userId} spend={spend} team={team} />
        </div>
      )}
      {s && (isAdmin ? (
        <div className="sticky bottom-3 z-20 flex items-center gap-3 flex-wrap rounded-2xl border border-slate-200 bg-white/95 backdrop-blur px-4 py-2.5 shadow-lg">
          <span className={`text-sm ${dirty ? 'font-medium text-amber-700' : 'text-slate-500'}`}>{dirty ? 'Modifications non enregistrées' : `Réglages ${deName(name)} à jour`}</span>
          <span className="hidden md:inline text-xs text-slate-400">Copilote : chaque mail {deName(name)} part seulement après la validation d'un administrateur.</span>
          <button disabled={saving} onClick={() => void saveAll()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : `Enregistrer les réglages ${deName(name)}`}
          </button>
        </div>
      ) : <p className="text-xs text-slate-500">Seul un administrateur modifie ces réglages.</p>)}
      <Suppressions userId={userId} refreshKey={refreshKey} onError={onError} />
    </div>
  );
}
