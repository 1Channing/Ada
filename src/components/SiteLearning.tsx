import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../services/auth';
import { allSiteAdapters, getSiteAdapter } from '../lib/study-core/marketplaces';
import { applyVariableCriteria, missingUrlCriteria } from '../lib/linkgen/grammar';
import {
  CLAUDE_INSTRUCTIONS, CRITERION_LABEL, LEARNABLE_CRITERIA, codedFamilyPresent, criterionParams, lineInstruction,
  type LearnableCriterion, type LearningParams,
} from '../lib/linkgen/learning';
import {
  decide, describeRule, ignoreItem, listLearnedRules, listLearningItems, markAbsent, proposeLabel, proposeUrl, retireRule,
  type Evaluation, type LearnedRule, type LearningItem,
} from '../services/siteLearning';

/**
 * ATELIER › APPRENTISSAGE DES SITES (30/10, Channing : « pour chaque ligne je veux le site, marque et modèle
 * OU / ET le critère appris, et le lien pour vérifier que les critères sont bien sélectionnés »).
 *
 * - « À chercher » : la file de Claude (extension Chrome sur le Mac de Channing) — la consigne à copier, puis
 *   par ligne « Ouvrir sur le site », « Adresse obtenue » + « Proposer », ou « Absent du site ». Les libellés
 *   sont ceux de la consigne : Claude les retrouve tels quels.
 * - « À valider » : chaque proposition contrôlée par le worker (adresse de Claude et adresse construite par
 *   ADA), le lien « Vérifier sur le site », Valider / Refuser (administrateurs).
 * - « Appris » : les règles validées, re-testées chaque semaine, retirables.
 * - « Couverture » : pour chaque site et chaque critère, codé, appris, à chercher ou absent.
 */
type Tab = 'chercher' | 'valider' | 'appris' | 'couverture';

const siteName = (key: string) => getSiteAdapter(key)?.displayName ?? key;
const SOURCE_LABEL: Record<string, string> = {
  offre: 'offre', etude: 'étude', recherche: 'recherche du jour', campagne: 'campagne ou re-scan',
  campagne_echec: 'campagne : le site n\'a pas appliqué le modèle',
};
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

const VERDICT: Record<Evaluation['verdict'], { label: string; cls: string }> = {
  ok: { label: 'conforme', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  echec: { label: 'en échec', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  humain: { label: 'à juger sur la page', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  impossible: { label: 'contrôle impossible', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};
const Chip = ({ v }: { v: Evaluation['verdict'] }) => (
  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${VERDICT[v]?.cls ?? VERDICT.impossible.cls}`}>{VERDICT[v]?.label ?? v}</span>
);

/** Ce qu'une ligne apprend, en une ligne (site, modèle et/ou critère). */
function whatOf(it: Pick<LearningItem, 'kind' | 'brand' | 'model' | 'criterion' | 'value'>): string {
  if (it.kind === 'modele') return `Modèle ${it.brand} « ${it.model} »`;
  const label = CRITERION_LABEL[it.criterion as LearnableCriterion] ?? it.criterion;
  const value = /^\d{4,}$/.test(it.value) && !/^year/.test(it.criterion) ? Number(it.value).toLocaleString('fr-FR') : it.value;
  return `${label[0].toUpperCase()}${label.slice(1)} · ${value}`;
}

export function SiteLearning({ initialTab = 'chercher' }: { initialTab?: Tab }) {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [rules, setRules] = useState<LearnedRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [site, setSite] = useState('');
  const [shown, setShown] = useState(30);

  const refresh = useCallback(async () => {
    const [a, b] = await Promise.all([
      listLearningItems(['a_chercher', 'proposee', 'a_valider', 'absente']),
      listLearnedRules(),
    ]);
    setItems(a.items);
    setRules(b.rules);
    setError(a.error ?? b.error);
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const done = useCallback(async (msg: string | null, ok: string) => {
    if (msg) { setError(msg); setInfo(null); } else { setInfo(ok); setError(null); }
    await refresh();
  }, [refresh]);

  const bySite = (xs: LearningItem[]) => (site ? xs.filter((x) => x.site === site) : xs);
  const toFind = bySite(items.filter((x) => x.status === 'a_chercher'));
  const checking = bySite(items.filter((x) => x.status === 'proposee'));
  const toValidate = bySite(items.filter((x) => x.status === 'a_valider'));
  const sites = [...new Set(items.map((x) => x.site))].sort();

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'chercher', label: `À chercher (${toFind.length})` },
    { key: 'valider', label: `À valider (${toValidate.length})` },
    { key: 'appris', label: `Appris (${rules.length})` },
    { key: 'couverture', label: 'Couverture' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Quand une étude, une offre ou une recherche du jour demande un modèle ou un filtre qu&apos;ADA ne sait pas écrire sur un site,
        une ligne arrive ici toute seule. ADA essaie d&apos;abord seule ; sinon Claude (extension Chrome) lit sur le site le nom exact du
        modèle, et ADA en construit l&apos;adresse et la contrôle sur deux adresses. Contrôles parfaits (100 % des annonces, au moins 5 sur chacune) : validé automatiquement. Sinon, la ligne
        attend un administrateur dans « À valider ».
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`${btn} border ${tab === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
        <span className="flex-1" />
        {sites.length > 1 && (tab === 'chercher' || tab === 'valider') && (
          <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" aria-label="Filtrer par site">
            <option value="">Tous les sites</option>
            {sites.map((s) => <option key={s} value={s}>{siteName(s)}</option>)}
          </select>
        )}
        <button onClick={() => void refresh()} className={`${btn} text-slate-600 hover:bg-slate-100`} title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}
      {info && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</div>}
      {loading ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</p> : (
        <>
          {tab === 'chercher' && (
            <div className="space-y-3">
              <Instructions />
              {toFind.length === 0
                ? <p className="text-sm text-slate-500">Rien à chercher pour l&apos;instant : ADA sait écrire tout ce qu&apos;on lui a demandé.</p>
                : (
                  <ul className="space-y-3">
                    {toFind.slice(0, shown).map((it) => <ToFindRow key={it.id} it={it} onDone={done} />)}
                  </ul>
                )}
              {toFind.length > shown && <button onClick={() => setShown((n) => n + 30)} className={`${btn} border border-slate-200 text-slate-700`}>Afficher 30 lignes de plus</button>}
            </div>
          )}
          {tab === 'valider' && (
            <div className="space-y-3">
              {checking.length > 0 && (
                <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {checking.length} proposition(s) en cours de contrôle par ADA (environ une minute chacune).</p>
              )}
              {toValidate.length === 0
                ? <p className="text-sm text-slate-500">Aucune proposition à valider : tout ce qui a été contrôlé à 100 % est déjà validé (onglet « Appris »).</p>
                : <ul className="space-y-3">{toValidate.map((it) => <ToValidateRow key={it.id} it={it} isAdmin={isAdmin} onDone={done} />)}</ul>}
            </div>
          )}
          {tab === 'appris' && (
            rules.length === 0
              ? <p className="text-sm text-slate-500">Aucune règle apprise pour l&apos;instant.</p>
              : <ul className="space-y-2">{rules.map((r) => <LearnedRow key={r.id} r={r} isAdmin={isAdmin} onDone={done} />)}</ul>
          )}
          {tab === 'couverture' && <Coverage rules={rules} items={items} />}
        </>
      )}
    </div>
  );
}

function Instructions() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(CLAUDE_INSTRUCTIONS); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };
  return (
    <details className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-blue-900">Consigne pour Claude (extension Chrome)</summary>
      <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700 font-sans">{CLAUDE_INSTRUCTIONS}</pre>
      <button onClick={() => void copy()} className={`${btn} mt-2 bg-blue-600 text-white hover:bg-blue-700`}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Consigne copiée' : 'Copier la consigne'}
      </button>
    </details>
  );
}

function ToFindRow({ it, onDone }: { it: LearningItem; onDone: (msg: string | null, ok: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [showUrl, setShowUrl] = useState(it.kind === 'filtre');
  const [absent, setAbsent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const instruction = lineInstruction(it);
  const propose = async () => {
    setBusy(true);
    await onDone(await proposeUrl(it.id, url), `Adresse proposée pour ${siteName(it.site)} : ADA la contrôle (environ une minute).`);
    setBusy(false);
  };
  const sendLabel = async () => {
    setBusy(true);
    await onDone(await proposeLabel(it.id, label), `${siteName(it.site)} : nom « ${label.trim()} » envoyé — ADA construit et vérifie l'adresse (environ une minute).`);
    setBusy(false);
  };
  const absentOk = async () => {
    setBusy(true);
    await onDone(await markAbsent(it.id, absent ?? ''), `${siteName(it.site)} : « absent du site » envoyé à la validation.`);
    setBusy(false);
  };
  const sources = it.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ');
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 space-y-2" aria-label={`${siteName(it.site)} — ${instruction}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="font-semibold text-slate-800">{siteName(it.site)}</span>
        <span>· {it.kind === 'modele' ? 'modèle' : 'filtre'}</span>
        <span>· vu {it.hits} fois{sources ? ` (${sources})` : ''}</span>
        <span>· dernière fois {fmtDate(it.last_seen_at)}</span>
      </div>
      <p className="text-sm font-medium text-slate-900">{instruction}</p>
      {it.decision_note && <p className="text-xs text-amber-700">Dernier retour : {it.decision_note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {it.start_url
          ? <a href={it.start_url} target="_blank" rel="noreferrer" className={`${btn} border border-blue-200 text-blue-700 hover:bg-blue-50`}>Ouvrir sur le site <ExternalLink className="w-3.5 h-3.5" /></a>
          : <span className="text-xs text-slate-400">page de départ indisponible</span>}
        {it.kind === 'modele' && (
          <>
            <label htmlFor={`label-${it.id}`} className="sr-only">Nom exact sur le site</label>
            <input id={`label-${it.id}`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom exact sur le site (ex. Classe CLS)"
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            <button onClick={() => void sendLabel()} disabled={busy || !label.trim()} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Envoyer le nom</button>
          </>
        )}
        <button onClick={() => setAbsent('')} disabled={busy} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Absent du site</button>
        {it.kind === 'modele' && !showUrl && <button onClick={() => setShowUrl(true)} className="text-xs text-slate-500 hover:underline">ou coller une adresse</button>}
      </div>
      {showUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`url-${it.id}`} className="sr-only">Adresse obtenue</label>
          <input id={`url-${it.id}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse obtenue (https://…)"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <button onClick={() => void propose()} disabled={busy || !/^https:\/\/\S+$/.test(url.trim())} className={`${btn} bg-slate-700 text-white hover:bg-slate-800`}>Proposer</button>
        </div>
      )}
      {absent !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`absent-${it.id}`} className="sr-only">Ce que le site propose à la place</label>
          <input id={`absent-${it.id}`} value={absent} onChange={(e) => setAbsent(e.target.value)} placeholder="Ce que le site propose à la place"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <button onClick={() => void absentOk()} disabled={busy} className={`${btn} bg-slate-700 text-white hover:bg-slate-800`}>Confirmer « absent du site »</button>
          <button onClick={() => setAbsent(null)} className={`${btn} text-slate-500`}>Annuler</button>
        </div>
      )}
    </li>
  );
}

function EvalLine({ who, ev, linkLabel }: { who: string; ev: Evaluation | undefined; linkLabel: string }) {
  if (!ev) return null;
  return (
    <div className="text-xs text-slate-600 space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">{who}</span><Chip v={ev.verdict} />
        <span>{ev.sample} annonce(s) lue(s) — {ev.detail}</span>
        {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">{linkLabel} <ExternalLink className="w-3 h-3" /></a>}
      </div>
      {ev.titles?.length > 0 && <div className="text-slate-500">Exemples : {ev.titles.join(' · ')}</div>}
    </div>
  );
}

function ToValidateRow({ it, isAdmin, onDone }: { it: LearningItem; isAdmin: boolean; onDone: (msg: string | null, ok: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const c = it.check_result;
  const absent = Boolean(it.learned?.absent);
  const blocked = !absent && (c?.verdict === 'echec' || c?.conflict === true);
  const act = async (validate: boolean) => {
    setBusy(true);
    await onDone(await decide(it, validate, note), validate ? `${siteName(it.site)} : ${whatOf(it)} — validé, ADA s'en sert dès maintenant.` : `${siteName(it.site)} : refusé, la ligne repart à chercher.`);
    setBusy(false);
  };
  const ignore = async () => {
    setBusy(true);
    await onDone(await ignoreItem(it.id, note), `${siteName(it.site)} : ligne ignorée.`);
    setBusy(false);
  };
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-slate-900">{siteName(it.site)}</span>
        <span className="text-sm text-slate-700">· {whatOf(it)}</span>
        {!absent && c && <Chip v={c.verdict} />}
        <span className="text-xs text-slate-400">proposé le {fmtDate(it.proposed_at)}</span>
      </div>
      {absent ? (
        <p className="text-sm text-slate-700">
          Claude dit : <strong>absent du site</strong>{it.absent_note ? ` — « ${it.absent_note} »` : ''}.
          {it.start_url && <> <a href={it.start_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">Vérifier sur le site <ExternalLink className="w-3 h-3" /></a></>}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-700">Appris : <strong>{describeRule(it.learned?.rule)}</strong>{c?.change ? <span className="text-xs text-slate-500"> ({c.change})</span> : null}</p>
          {c?.conflict && <p className="text-xs text-rose-700">Conflit : une règle active existe déjà pour ce cas — retirez-la d&apos;abord (onglet Appris) si celle-ci est la bonne.</p>}
          {c?.warning && <p className="text-xs text-amber-700">{c.warning}</p>}
          <EvalLine who="Adresse de Claude" ev={c?.claude} linkLabel="Ouvrir" />
          <EvalLine who="Adresse construite par ADA" ev={c?.ada} linkLabel="Vérifier sur le site" />
          {!c?.ada?.url && it.verify_url && (
            <a href={it.verify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">Vérifier sur le site <ExternalLink className="w-3 h-3" /></a>
          )}
        </>
      )}
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`note-${it.id}`} className="sr-only">Motif ou remarque</label>
          <input id={`note-${it.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motif (refus) ou remarque"
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <button onClick={() => void act(true)} disabled={busy || blocked} title={blocked ? 'Contrôle en échec ou conflit : non validable' : undefined}
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><Check className="w-4 h-4" /> Valider</button>
          <button onClick={() => void act(false)} disabled={busy} className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}><X className="w-4 h-4" /> Refuser</button>
          <button onClick={() => void ignore()} disabled={busy} className={`${btn} text-slate-500 hover:bg-slate-100`}>Ignorer</button>
        </div>
      ) : <p className="text-xs text-slate-400">Validation réservée aux administrateurs.</p>}
    </li>
  );
}

function LearnedRow({ r, isAdmin, onDone }: { r: LearnedRule; isAdmin: boolean; onDone: (msg: string | null, ok: string) => Promise<void> }) {
  const [note, setNote] = useState<string | null>(null);
  const what = r.kind === 'modele' ? `Modèle ${r.brand} « ${r.model} »`
    : `${CRITERION_LABEL[r.criterion as LearnableCriterion] ?? r.criterion}${r.value_key === '*' ? ' (toutes valeurs)' : ` · ${r.value}`}`;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 text-sm space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-900">{siteName(r.site)}</span>
        <span className="text-slate-700">· {what}</span>
        {r.validated_by === null && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">validée automatiquement</span>}
        {r.status === 'suspendue' && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">suspendue</span>}
      </div>
      <div className="text-xs text-slate-600">{describeRule(r.rule)} · validée le {fmtDate(r.validated_at)} · dernier contrôle {fmtDate(r.last_check_at)}{r.fail_count ? ` · ${r.fail_count} échec(s)` : ''}</div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {r.proof_url && <a href={r.proof_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">Preuve (adresse de Claude) <ExternalLink className="w-3 h-3" /></a>}
        {r.verify_url && <a href={r.verify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">Vérifier sur le site <ExternalLink className="w-3 h-3" /></a>}
        {isAdmin && note === null && <button onClick={() => setNote('')} className="text-rose-700 hover:underline">Retirer</button>}
      </div>
      {isAdmin && note !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pourquoi la retirer ?" aria-label="Pourquoi la retirer ?"
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <button onClick={() => void retireRule(r.id, note).then((m) => onDone(m, 'Règle retirée : ADA ne s\'en sert plus, la ligne repart à chercher.'))}
            className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>Confirmer le retrait</button>
          <button onClick={() => setNote(null)} className={`${btn} text-slate-500`}>Annuler</button>
        </div>
      )}
    </li>
  );
}

const SAMPLE: Record<LearnableCriterion, string> = {
  yearFrom: '2020', yearTo: '2024', mileageMin: '20000', mileageMax: '90000', powerFrom: '150', fuel: 'HYBRIDE', gearbox: 'AUTOMATIQUE', vehicleType: 'SUV',
};
const SHORT: Record<LearnableCriterion, string> = {
  yearFrom: 'année min', yearTo: 'année max', mileageMin: 'km min', mileageMax: 'km max', powerFrom: 'puissance', fuel: 'carburant', gearbox: 'boîte', vehicleType: 'carrosserie',
};

/** Couverture indicative : ce que chaque site sait écrire, par le code (registre et adaptateur) ou par une règle apprise. */
function Coverage({ rules, items }: { rules: LearnedRule[]; items: LearningItem[] }) {
  const rows = useMemo(() => allSiteAdapters().map((a) => {
    const cells = LEARNABLE_CRITERIA.map((c) => {
      let coded = false;
      try {
        const params: LearningParams = { brand: 'TOYOTA', model: '', ...criterionParams(c, SAMPLE[c]) };
        const url = applyVariableCriteria(a.buildSearchUrl(params).url, params);
        coded = Boolean(url) && codedFamilyPresent(c, new Set(missingUrlCriteria(url, params)), url);
      } catch { coded = false; }
      const learned = rules.some((r) => r.site === a.key && r.kind === 'filtre' && r.criterion === c && r.status === 'active');
      const open = items.some((x) => x.site === a.key && x.kind === 'filtre' && x.criterion === c && x.status !== 'absente');
      const absent = items.some((x) => x.site === a.key && x.kind === 'filtre' && x.criterion === c && x.status === 'absente');
      return { c, state: coded ? 'codé' : learned ? 'appris' : open ? 'à chercher' : absent ? 'absent' : '—' };
    });
    const models = {
      learned: rules.filter((r) => r.site === a.key && r.kind === 'modele' && r.status === 'active').length,
      open: items.filter((x) => x.site === a.key && x.kind === 'modele' && x.status !== 'absente').length,
    };
    return { key: a.key, name: a.displayName, cells, models };
  }), [rules, items]);
  const cls: Record<string, string> = {
    codé: 'text-slate-700', appris: 'text-emerald-700 font-medium', 'à chercher': 'text-amber-700 font-medium', absent: 'text-slate-400', '—': 'text-slate-300',
  };
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1.5 pr-3">Site</th>
            {LEARNABLE_CRITERIA.map((c) => <th key={c} className="py-1.5 pr-3 font-medium">{SHORT[c]}</th>)}
            <th className="py-1.5 pr-3 font-medium">modèles appris / à chercher</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 font-medium text-slate-800">{r.name}</td>
              {r.cells.map((x) => <td key={x.c} className={`py-1.5 pr-3 ${cls[x.state]}`}>{x.state}</td>)}
              <td className="py-1.5 pr-3 text-slate-700">{r.models.learned} / {r.models.open}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">« codé » : ADA l&apos;écrit déjà par son code ; « appris » : par une règle validée ici ; « à chercher » : une ligne attend Claude ; « absent » : le site n&apos;a pas ce filtre.</p>
    </div>
  );
}
