import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ExternalLink, ChevronDown, ChevronRight, Check, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../services/auth';
import { brandKey, refModelKey } from '../services/marketData';
import { missingUrlCriteria, registryCoveredCriteria } from '../lib/linkgen/grammar';
import { allSiteAdapters } from '../lib/study-core/marketplaces';

/**
 * TRUTH CENTER — brique 2 (validée Channing 26/08) : la fenêtre sur les
 * dossiers de vérité ouverts par le balayage nocturne (truth_sweep) et par
 * les études quotidiennes (trous de dictionnaire, critères hors URL).
 *
 * Principe §10 du plan : l'humain apporte des FAITS (profondeur affichée,
 * conformité champ par champ, URL réelle du site), jamais un diagnostic
 * technique — la comparaison et la cause sont le travail du moteur.
 * L'écran de vérification doit se remplir en moins d'une minute.
 */

interface Dossier {
  id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  signal: string;
  layer: string;
  doubt_score: number;
  priority: number;
  status: string;
  summary: string;
  details: Record<string, unknown>;
  first_detected_at: string;
  last_seen_at: string;
}

const SIGNAL_LABELS: Record<string, string> = {
  profondeur_variation: 'Profondeur inhabituelle',
  profondeur_zero: 'Profondeur à zéro',
  pollution_sample: 'Échantillon pollué',
  mediane_aberrante: 'Médiane aberrante',
  completude_chute: 'Complétude en chute',
  dictionnaire: 'Dictionnaire à apprendre',
  url_incomplete: 'URL incomplète',
};

const LAYER_LABELS: Record<string, string> = {
  dictionnaire: 'dictionnaire marque/modèle',
  url: 'construction d’URL',
  parsing: 'lecture des annonces',
  canonicalisation: 'canonicalisation',
  profondeur: 'profondeur de marché',
  inconnue: 'à déterminer',
};

/** Étude quotidienne (Workflow) : les critères D'ORIGINE de la recherche
 *  mise en doute — affichés avant toute validation (demande Channing 26/08). */
interface StudyRow {
  label: string;
  brand: string;
  model: string | null;
  fuel: string | null;
  trim: string | null;
  trim_target: string | null;
  year_min: number | null;
  year_max: number | null;
  mileage_max: number | null;
  gearbox: string | null;
  power_min: number | null;
  source_country: string;
  target_country: string;
}

function studyForDossier(studies: StudyRow[], d: Dossier): StudyRow | null {
  if (!d.brand) return null;
  const bk = brandKey(d.brand);
  const mk = d.model ? refModelKey(d.brand, d.model) : '';
  const hits = studies.filter((s) =>
    brandKey(s.brand) === bk && (!mk || refModelKey(s.brand, s.model ?? '') === mk));
  if (hits.length === 0) return null;
  // Plusieurs études sur le même modèle : préférer celle dont un pays
  // correspond au dossier.
  return hits.find((s) => d.country && (s.source_country === d.country || s.target_country === d.country)) ?? hits[0];
}

function studyCriteriaChips(s: StudyRow): string[] {
  const out: string[] = [];
  if (s.brand) out.push(`Marque ${s.brand}`);
  if (s.model) out.push(`Modèle ${s.model}`);
  if (s.fuel) out.push(`Carburant ${s.fuel}`);
  if (s.year_min || s.year_max) out.push(`Année ${s.year_min ?? '…'} – ${s.year_max ?? 'max'}`);
  if (s.mileage_max) out.push(`≤ ${s.mileage_max.toLocaleString('fr-FR')} km`);
  if (s.gearbox) out.push(`Boîte ${s.gearbox.toLowerCase()}`);
  if (s.power_min) out.push(`≥ ${s.power_min} ch`);
  if (s.trim || s.trim_target) out.push(`Finition ${s.trim || s.trim_target}`);
  out.push(`${s.source_country} → ${s.target_country}`);
  return out;
}

const STATUS_LABELS: Record<string, string> = {
  detected: 'Détecté',
  needs_evidence: 'Preuve reçue — diagnostic en attente',
  verified: 'Vérifié',
  accepted_variance: 'Écart accepté',
  obsolete: 'Obsolète',
};

// Champs de la conformité « champ par champ » (pilier 2 du plan).
const CRITERIA_FIELDS = ['marque', 'modèle', 'carburant', 'année', 'kilométrage', 'boîte', 'finition'] as const;
type CritState = 'ok' | 'ko' | 'inconnu';

function fmtAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

function segmentTitle(d: Dossier): string {
  const parts = [d.brand, d.model].filter(Boolean).join(' ');
  return parts || d.site || 'Segment global';
}

export function TruthCenter() {
  const { email, isAdmin } = useAuth();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('truth_dossiers')
      .select('*')
      .order('priority', { ascending: true })
      .order('doubt_score', { ascending: false })
      .limit(300);
    if (err) setError(err.message);
    setDossiers(((data ?? []) as unknown as Dossier[]));
    // Les critères RÉELS des études quotidiennes actives — TOUTES équipes
    // confondues via truth_active_studies() (security definer : critères
    // seuls, jamais le propriétaire). L'URL ne sert JAMAIS de référence de
    // critères : c'est l'objet à vérifier (constat Lexus NX 26/08 — le
    // décodage perdait le carburant PHEV). Repli : mes propres études.
    const viaRpc = await supabase.rpc('truth_active_studies' as never);
    if (!viaRpc.error && Array.isArray(viaRpc.data)) {
      setStudies((viaRpc.data as unknown as StudyRow[]));
    } else {
      const st = await supabase
        .from('daily_searches')
        .select('label, brand, model, fuel, trim, trim_target, year_min, year_max, mileage_max, gearbox, power_min, source_country, target_country')
        .eq('active', true)
        .limit(500);
      setStudies(((st.data ?? []) as unknown as StudyRow[]));
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  // « À vérifier » = ce qui attend TES yeux ; « En diagnostic » = ce qui
  // attend le MOTEUR (preuve déposée, cause en cours d'identification) — un
  // dossier corrigé y reste jusqu'à la re-vérification de la vague suivante.
  const open = useMemo(() => dossiers.filter((d) => d.status === 'detected'), [dossiers]);
  const diagnosing = useMemo(() => dossiers.filter((d) => d.status === 'needs_evidence'), [dossiers]);
  const resolved = useMemo(() => dossiers.filter((d) => d.status !== 'detected' && d.status !== 'needs_evidence'), [dossiers]);

  // Réservé à l'admin (demande Channing 26/08) — l'onglet n'apparaît que
  // pour lui, et l'URL directe rend cette page muette pour les autres.
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
        Espace réservé à l'administrateur.
      </div>
    );
  }

  const setStatus = async (d: Dossier, status: string) => {
    const patch = { status, resolved_at: status === 'detected' || status === 'needs_evidence' ? null : new Date().toISOString() };
    const { error: err } = await supabase.from('truth_dossiers').update(patch).eq('id', d.id);
    if (err) { setError(err.message); return; }
    setDossiers((all) => all.map((x) => (x.id === d.id ? { ...x, ...patch } as Dossier : x)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg"><ShieldCheck className="w-6 h-6 text-emerald-700" /></div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Truth Center</h1>
            <p className="text-sm text-slate-500">
              Ce qu'ADA croit voir correspond-il à ce qu'un humain voit ? {open.length} dossier(s) à vérifier.
            </p>
          </div>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <RefreshCw className="w-4 h-4" /> Recharger
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error} — la migration 20260826160000 est-elle appliquée ?
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Chargement des dossiers…
        </div>
      ) : open.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
          Aucun doute en attente — le balayage tourne chaque nuit après les études quotidiennes.
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((d) => (
            <DossierCard
              key={d.id}
              d={d}
              study={studyForDossier(studies, d)}
              isOpen={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              onStatus={(s) => void setStatus(d, s)}
              userEmail={email ?? ''}
            />
          ))}
        </div>
      )}

      {diagnosing.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-sky-800 flex items-center gap-2">
            <Loader2 className="w-4 h-4" /> En diagnostic / correction (moteur) — {diagnosing.length}
          </h2>
          <p className="text-xs text-slate-500 -mt-2">
            Preuve reçue, cause en cours d'identification ou correctif déployé en attente de
            re-vérification à la prochaine vague. Rien à faire de ton côté.
          </p>
          {diagnosing.map((d) => (
            <DossierCard
              key={d.id}
              d={d}
              study={studyForDossier(studies, d)}
              isOpen={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              onStatus={(s) => void setStatus(d, s)}
              userEmail={email ?? ''}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-600"
          >
            {showResolved ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Historique — {resolved.length} dossier(s) traités (la mémoire de qualité du système)
          </button>
          {showResolved && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {resolved.map((d) => (
                <div key={d.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="text-slate-800 font-medium">{segmentTitle(d)}</span>
                  <span className="text-slate-400">{d.site}{d.country ? ` · ${d.country}` : ''}</span>
                  <span className="text-slate-500">{SIGNAL_LABELS[d.signal] ?? d.signal}</span>
                  <span className={`ml-auto text-xs rounded-full px-2 py-0.5 ${d.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABELS[d.status] ?? d.status}
                  </span>
                  {typeof d.details?.diagnosed_by === 'string' && (
                    <span className="text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">
                      diagnostic {String(d.details.diagnosed_by)}
                    </span>
                  )}
                  <button onClick={() => void setStatus(d, 'detected')} className="text-xs text-slate-400 hover:text-slate-700">rouvrir</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * L'URL exacte que l'étude mise en doute a scrapée : les dossiers du worker
 * la portent dans details.url ; ceux du balayage SQL (profondeur, pollution,
 * médiane) non — on la retrouve dans le DERNIER snapshot du segment
 * (source_url), chargé paresseusement à l'ouverture du dossier.
 */
function useAdaUrl(d: Dossier, isOpen: boolean): { url: string | null; scrapedAt: string | null; searching: boolean } {
  const detailUrl = typeof d.details?.url === 'string' ? String(d.details.url) : null;
  const [found, setFound] = useState<{ url: string | null; scrapedAt: string | null } | null>(detailUrl ? { url: detailUrl, scrapedAt: null } : null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!isOpen || found || searching) return;
    setSearching(true);
    (async () => {
      // Le snapshot EXACT qui a déclenché le signal (le balayage stocke son
      // horodatage) — sinon une mise à jour MI ultérieure aux critères
      // différents deviendrait « l'URL d'ADA » (constat X3 26/08 : lien 2024
      // seul ouvert pour juger un dossier bâti sur 2023+/100 000 km).
      const snapAt = typeof d.details?.snapshot_at === 'string' ? String(d.details.snapshot_at) : null;
      if (snapAt) {
        let qe = supabase.from('market_snapshots')
          .select('source_url, scraped_at')
          .eq('scraped_at', snapAt)
          .limit(1);
        if (d.site) qe = qe.eq('site', d.site);
        const exact = (await qe).data?.[0] as { source_url: string | null; scraped_at: string } | undefined;
        if (exact?.source_url) {
          setFound({ url: exact.source_url, scrapedAt: exact.scraped_at });
          setSearching(false);
          return;
        }
      }
      let q = supabase.from('market_snapshots')
        .select('source_url, scraped_at')
        .not('source_url', 'is', null)
        .order('scraped_at', { ascending: false })
        .limit(1);
      if (d.site) q = q.eq('site', d.site);
      if (d.brand) q = q.ilike('brand', d.brand);
      if (d.model) q = q.ilike('model', d.model);
      if (d.fuel) q = q.ilike('fuel', d.fuel);
      let { data } = await q;
      // Repli sans le carburant (les snapshots de campagne peuvent porter un
      // libellé de carburant différent du token du dossier).
      if (!data?.length && d.fuel) {
        let q2 = supabase.from('market_snapshots')
          .select('source_url, scraped_at')
          .not('source_url', 'is', null)
          .order('scraped_at', { ascending: false })
          .limit(1);
        if (d.site) q2 = q2.eq('site', d.site);
        if (d.brand) q2 = q2.ilike('brand', d.brand);
        if (d.model) q2 = q2.ilike('model', d.model);
        data = (await q2).data;
      }
      const row = data?.[0] as { source_url: string | null; scraped_at: string } | undefined;
      setFound({ url: row?.source_url ?? null, scrapedAt: row?.scraped_at ?? null });
      setSearching(false);
    })().catch(() => { setFound({ url: null, scrapedAt: null }); setSearching(false); });
  }, [isOpen, found, searching, d]);
  return { url: found?.url ?? null, scrapedAt: found?.scrapedAt ?? null, searching };
}

function DossierCard({ d, study, isOpen, onToggle, onStatus, userEmail }: {
  d: Dossier;
  study: StudyRow | null;
  isOpen: boolean;
  onToggle: () => void;
  onStatus: (s: string) => void;
  userEmail: string;
}) {
  const { url: adaUrl, scrapedAt, searching } = useAdaUrl(d, isOpen);
  const isGap = d.signal === 'dictionnaire' || d.signal === 'url_incomplete';
  // Pilier 2 en automatique : les critères de l'étude que l'URL d'ADA
  // n'exprime PAS (détecteurs du registre de grammaires) — affiché avant
  // toute validation humaine.
  const notInUrl = useMemo(() => {
    if (!study || !adaUrl) return [];
    try {
      return missingUrlCriteria(adaUrl, {
        brand: study.brand, model: study.model ?? '',
        fuel: study.fuel ?? undefined, trim: (study.trim || study.trim_target) ?? undefined,
        yearFrom: study.year_min ?? undefined, yearTo: study.year_max ?? undefined,
        mileage: study.mileage_max ?? undefined,
        gearbox: study.gearbox ?? undefined,
        minPower: study.power_min ?? undefined,
      });
    } catch { return []; }
  }, [study, adaUrl]);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button onClick={onToggle} className="w-full flex items-start gap-3 p-4 text-left">
        {isOpen ? <ChevronDown className="w-4 h-4 mt-1 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-1 text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900">{segmentTitle(d)}</span>
            {d.site && <span className="text-xs text-slate-500">{d.site}{d.country ? ` · ${d.country}` : ''}</span>}
            {d.fuel && <span className="text-xs text-slate-400">{d.fuel}</span>}
            {d.priority === 1 && (
              <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">étude quotidienne active</span>
            )}
            <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{SIGNAL_LABELS[d.signal] ?? d.signal}</span>
            {d.status === 'needs_evidence' && (
              <span className="text-xs bg-sky-100 text-sky-700 rounded-full px-2 py-0.5">{STATUS_LABELS.needs_evidence}</span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">{d.summary}</p>
          <p className="text-xs text-slate-400 mt-1">
            Doute {Math.round(d.doubt_score)}/100 · couche présumée : {LAYER_LABELS[d.layer] ?? d.layer} · vu {fmtAgo(d.last_seen_at)}
          </p>
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          {typeof d.details?.diagnosis === 'string' && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-900">
              <p className="text-xs font-medium text-violet-600 mb-1">
                Diagnostic{typeof d.details?.diagnosed_by === 'string' ? ` — ${String(d.details.diagnosed_by)}` : ''}
              </p>
              {String(d.details.diagnosis)}
            </div>
          )}
          {study ? (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Critères d'origine de l'étude « {study.label} »</p>
              <div className="flex flex-wrap gap-1.5">
                {studyCriteriaChips(study).map((c) => (
                  <span key={c} className="text-xs bg-white border border-slate-200 text-slate-700 rounded-full px-2.5 py-1">{c}</span>
                ))}
              </div>
              {notInUrl.length > 0 && (() => {
                // Distinction décisive : grammaire au registre = se corrige
                // SEUL à la prochaine vague ; sinon = apprentissage requis.
                const covered = adaUrl ? registryCoveredCriteria(adaUrl) : new Set<string>();
                const auto = notInUrl.filter((c) => covered.has(c));
                const learn = notInUrl.filter((c) => !covered.has(c));
                return (
                  <p className="text-xs text-amber-700 mt-2">
                    ⚠ Non exprimé dans l'URL d'ADA : <b>{notInUrl.join(', ')}</b> — la page du site est plus
                    large que l'étude, la comparaison de profondeur n'a pas de sens pour l'instant.
                    {auto.length > 0 && <> {auto.join(', ')} : grammaire connue → <b>se corrige seul à la prochaine vague</b>, rien à faire.</>}
                    {learn.length > 0 && <> {learn.join(', ')} : grammaire/dictionnaire inconnu → <b>colle l'URL humaine dans Atelier → Ingestion</b>.</>}
                  </p>
                );
              })()}
            </div>
          ) : (
            <UrlDecodedCriteria d={d} adaUrl={adaUrl} />
          )}
          {adaUrl ? (
            <a href={adaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-sky-700 hover:underline break-all">
              <ExternalLink className="w-4 h-4 shrink-0" /> Ouvrir l'URL utilisée par ADA{scrapedAt ? ` (scrapée ${fmtAgo(scrapedAt)})` : ''}
            </a>
          ) : searching ? (
            <p className="text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> Recherche de l'URL scrapée…</p>
          ) : (
            <p className="text-xs text-slate-400">URL scrapée introuvable pour ce segment (snapshot sans source_url).</p>
          )}
          {isGap ? (
            <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
              Ce dossier se résout par l'<b>apprentissage</b> : fais la recherche à la main sur le site,
              copie l'URL produite par la marketplace et colle-la dans <b>Atelier → Ingestion</b> —
              le dictionnaire s'apprend, l'étude retrouvera une URL complète dès la prochaine vague.
              Reviens ensuite marquer ce dossier « Vérifié ».
            </div>
          ) : (
            <EvidenceForm d={d} study={study} userEmail={userEmail} onSubmitted={() => onStatus('needs_evidence')} />
          )}
          <div className="pt-1">
            <p className="text-[11px] text-slate-400 mb-1.5">
              Verdict seulement si l'explication est connue — un écart confirmé mais inexpliqué reste en
              « diagnostic en attente » (enregistre la preuve, le moteur cherche la cause).
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => onStatus('verified')} className="inline-flex items-center gap-1.5 text-sm bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700">
                <Check className="w-4 h-4" /> Vérifié — conforme à la réalité
              </button>
              <button onClick={() => onStatus('accepted_variance')} title="La différence est réelle mais on sait pourquoi (vrai mouvement de marché, périmètre assumé…)" className="inline-flex items-center gap-1.5 text-sm border border-slate-200 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50">
                Écart réel mais compris
              </button>
              <button onClick={() => onStatus('obsolete')} className="inline-flex items-center gap-1.5 text-sm text-slate-400 rounded-lg px-3 py-1.5 hover:text-slate-600">
                <EyeOff className="w-4 h-4" /> Ignorer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Sans étude appariée dans TON Workflow (l'étude appartient à un autre compte
 * — daily_searches est personnel), les critères sont DÉCODÉS de l'URL d'ADA
 * par l'adaptateur du site (prefillCriteriaFromUrl) : ce que la recherche
 * exprimait réellement, à défaut de ce que l'étude demandait.
 */
function UrlDecodedCriteria({ d, adaUrl }: { d: Dossier; adaUrl: string | null }) {
  const { chips, fromUrl } = useMemo(() => {
    // Adaptateur par l'HÔTE de l'URL (les dossiers « médiane » n'ont pas de
    // site — le segment agrège plusieurs sites), repli sur d.site.
    const adapter = allSiteAdapters().find((a) =>
      (adaUrl && a.domain && adaUrl.includes(a.domain)) || (d.site && a.key === d.site));
    if (adaUrl && adapter?.prefillCriteriaFromUrl) {
      try {
        const c = adapter.prefillCriteriaFromUrl(adaUrl);
        const out: string[] = [];
        if (c.brand) out.push(`Marque ${c.brand}`);
        if (c.model) out.push(`Modèle ${c.model}`);
        if (c.fuel) out.push(`Carburant ${c.fuel}`);
        if (c.yearFrom || c.yearTo) out.push(`Année ${c.yearFrom ?? '…'} – ${c.yearTo ?? 'max'}`);
        if (c.mileage) out.push(`≤ ${Number(c.mileage).toLocaleString('fr-FR')} km`);
        if (c.trim) out.push(`Texte « ${c.trim} »`);
        if (out.length > 0) return { chips: out, fromUrl: true };
      } catch { /* URL illisible — repli segment */ }
    }
    // Repli : le segment du dossier lui-même (mieux que rien — dossiers
    // médiane/complétude sans URL décodable).
    const seg: string[] = [];
    if (d.brand) seg.push(`Marque ${d.brand}`);
    if (d.model) seg.push(`Modèle ${d.model}`);
    if (d.fuel) seg.push(`Carburant ${d.fuel}`);
    if (d.country) seg.push(`Pays ${d.country}`);
    return { chips: seg, fromUrl: false };
  }, [adaUrl, d]);
  if (chips.length === 0) return null;
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs font-medium text-slate-500 mb-1.5">
        {fromUrl
          ? "Critères décodés de l'URL d'ADA — aucune étude quotidienne active ne correspond (campagne, historique ou étude désactivée). Décodage partiel possible (les codes enum ne se retraduisent pas tous) : à prendre comme indice, pas comme référence."
          : 'Segment du dossier (agrégé sur les observations — pas de recherche unique derrière)'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className="text-xs bg-white border border-slate-200 text-slate-700 rounded-full px-2.5 py-1">{c}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * L'écran « une minute » : profondeur affichée par le site, conformité champ
 * par champ, URL réelle, commentaire. Tout est facultatif — chaque fait
 * fourni devient une preuve horodatée (truth_evidence).
 */
function EvidenceForm({ d, study, userEmail, onSubmitted }: { d: Dossier; study: StudyRow | null; userEmail: string; onSubmitted: () => void }) {
  // Seuls les critères que l'ÉTUDE définit sont à juger — les autres restent
  // vides (« hors étude ») et sont grisés. Sans étude appariée : tout actif.
  const relevant = useMemo(() => {
    if (!study) return new Set<string>(CRITERIA_FIELDS);
    const r = new Set<string>(['marque']);
    if (study.model) r.add('modèle');
    if (study.fuel) r.add('carburant');
    if (study.year_min || study.year_max) r.add('année');
    if (study.mileage_max) r.add('kilométrage');
    if (study.gearbox) r.add('boîte');
    if (study.trim || study.trim_target) r.add('finition');
    return r;
  }, [study]);
  const [count, setCount] = useState('');
  const [crit, setCrit] = useState<Record<string, CritState>>({});
  const [manualUrl, setManualUrl] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const adaCount = typeof d.details?.listing_count === 'number' ? (d.details.listing_count as number) : null;
  const humanCount = /^\d+$/.test(count.trim()) ? Number(count.trim()) : null;
  const gapPct = adaCount != null && humanCount != null && humanCount > 0
    ? Math.round(Math.abs(adaCount - humanCount) / humanCount * 100)
    : null;

  const cycle = (f: string) => {
    const order: CritState[] = ['ok', 'ko', 'inconnu'];
    setCrit((c) => {
      const cur = c[f];
      const next = order[(order.indexOf(cur ?? 'inconnu') + 1) % order.length];
      return { ...c, [f]: next };
    });
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('truth_evidence').insert({
      dossier_id: d.id,
      kind: 'verification',
      observed_count: humanCount,
      criteria_check: Object.keys(crit).length ? crit : null,
      manual_url: manualUrl.trim() || null,
      comment: comment.trim() || null,
      submitted_by: userEmail,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    onSubmitted();
  };

  if (done) {
    return (
      <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
        Preuve enregistrée{gapPct != null ? ` — écart ADA/site : ${gapPct} %` : ''}.
        {gapPct != null && gapPct >= 20 ? (
          <> Écart significatif : <b>ne choisis pas de verdict</b> — le dossier est passé en
          « diagnostic en attente », le moteur doit identifier la cause (ton travail s'arrête aux faits).</>
        ) : (
          <> Si la page correspond à ce qu'ADA voit, clique « Vérifié » ; sinon laisse le dossier en diagnostic.</>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500">Profondeur affichée par le site (fais la même recherche à la main)</label>
          <input
            value={count}
            onChange={(e) => setCount(e.target.value)}
            inputMode="numeric"
            placeholder={adaCount != null ? `ADA voit ${adaCount}` : 'ex. 1751'}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          {gapPct != null && (
            <p className="text-xs mt-1 text-slate-500">Écart ADA ({adaCount}) vs site ({humanCount}) : <b>{gapPct} %</b></p>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-500">URL réellement produite par le site (facultatif — très précieuse)</label>
          <input
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500">
          Conformité des critères sur la page du site (clique pour basculer ✓ / ✗ / ?) —
          laisse VIDE un critère que l'étude ne demande pas (grisé).
        </label>
        <div className="flex flex-wrap gap-2 mt-1">
          {CRITERIA_FIELDS.map((f) => {
            const isRelevant = relevant.has(f);
            const s = crit[f];
            const cls = s === 'ok' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : s === 'ko' ? 'bg-rose-100 text-rose-700 border-rose-200'
              : s === 'inconnu' ? 'bg-slate-100 text-slate-500 border-slate-200'
              : 'bg-white text-slate-500 border-slate-200';
            const mark = s === 'ok' ? '✓' : s === 'ko' ? '✗' : s === 'inconnu' ? '?' : '·';
            return (
              <button
                key={f}
                onClick={() => cycle(f)}
                title={isRelevant ? undefined : "Hors étude — rien à valider, laisse vide"}
                className={`text-xs border rounded-full px-2.5 py-1 ${cls} ${isRelevant ? '' : 'opacity-40'}`}
              >
                {f} {mark}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-slate-500">Commentaire (facultatif)</label>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-4 py-2 hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer la preuve
        </button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
