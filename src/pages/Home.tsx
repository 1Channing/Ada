import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, BadgeEuro, Rocket, Map, Inbox, Scale, ChevronRight } from 'lucide-react';
import { loadLatestDigest, type TruthDigest } from '../services/truthLoop';
import { supabase } from '../lib/supabase';
import { loadMappingTree, type TreeNode } from '../services/ingestionHistory';
import { MappingRadialTree } from '../components/MappingRadialTree';
import { OpportunityAlerts } from '../components/OpportunityAlerts';
import { inspectOpportunityInMarket } from '../services/marketData';
import { DailyHit, DailySearch, listInboxHits, listDailySearches, inboxToProcess } from '../services/workflow';
import { useAuth } from '../services/auth';

interface DealRow {
  id: string;
  reference: string | null;
  status: string | null;
  transaction_type: string | null;
  sale_price: number | null;
  purchase_price: number | null;
  created_at: string;
  closed_at: string | null;
}

interface CampaignRow {
  id: string;
  label: string | null;
  status: string | null;
  total: number | null;
  done_count: number | null;
  confirmed_count: number | null;
  gap_count: number | null;
  technical_count: number | null;
  created_at: string;
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Accueil — le poste de pilotage (demande Channing 27/07) : dossiers en
 * cours, ventes du mois, bilan de la dernière campagne (avec son heure de
 * fin), opportunités inter-pays repérées, et la cartographie des mappings.
 * Lecture seule : uniquement des données déjà produites ailleurs.
 */
export function Home() {
  const [digest, setDigest] = useState<TruthDigest | null>(null);
  useEffect(() => { void loadLatestDigest().then(setDigest); }, []);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  // Tant que la dernière campagne n'est pas connue, le radar d'opportunités
  // ne doit PAS se lancer : sans portée il chargerait tous les écarts des 30
  // jours, alors que l'accueil ne montre que ceux de la dernière campagne.
  const [campaignLoaded, setCampaignLoaded] = useState(false);
  const [campaignEnd, setCampaignEnd] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [hits, setHits] = useState<DailyHit[]>([]);
  const [mySearches, setMySearches] = useState<DailySearch[]>([]);
  const [legal, setLegal] = useState<Array<{ id: string; country: string; kind: string; title: string; effective_date: string | null; created_at: string }>>([]);
  const { displayName } = useAuth();

  const reloadHits = () => {
    // Même plafond que le Workflow (listAllHits) : deux limites différentes
    // finissent par produire deux compteurs différents dès qu'elles mordent.
    listInboxHits(3000).then(setHits).catch(() => setHits([]));
    listDailySearches().then(setMySearches).catch(() => setMySearches([]));
  };

  useEffect(() => {
    void (async () => {
      const [{ data: dealRows }, { data: campRows }, { data: legalRows }] = await Promise.all([
        supabase
          .from('transactions_admin')
          .select('id, reference, status, transaction_type, sale_price, purchase_price, created_at, closed_at')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('linkgen_campaigns')
          .select('id, label, status, total, done_count, confirmed_count, gap_count, technical_count, created_at')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('legal_watch_entries')
          .select('id, country, kind, title, effective_date, created_at')
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      setDeals((dealRows ?? []) as DealRow[]);
      setLegal((legalRows ?? []) as typeof legal);
      const camp = ((campRows ?? [])[0] ?? null) as CampaignRow | null;
      setCampaign(camp);
      setCampaignLoaded(true);
      if (camp) {
        const { data: lastItem } = await supabase
          .from('linkgen_campaign_items')
          .select('finished_at')
          .eq('campaign_id', camp.id)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1);
        setCampaignEnd((lastItem?.[0] as { finished_at?: string } | undefined)?.finished_at ?? null);
      }
      reloadHits();
      // La carto en dernier : c'est la requête la plus lourde.
      setTree(await loadMappingTree());
    })();
  }, []);

  // Navigation interne sans rechargement (étage 3) — App écoute pushState.
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
  };

  // MÊME définition de « à traiter » que le Workflow (inboxToProcess) : les
  // deux écrans annonçaient des nombres différents faute de règle partagée.
  const toProcess = useMemo(() => inboxToProcess(hits, mySearches), [hits, mySearches]);

  const open = deals.filter((d) => d.status === 'en_cours');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const closedThisMonth = deals.filter((d) => d.status === 'cloturee' && (d.closed_at ?? '') >= monthStart);
  const salesThisMonth = closedThisMonth.filter((d) => d.transaction_type === 'sale');
  const salesAmount = salesThisMonth.reduce((s, d) => s + (d.sale_price ?? 0), 0);

  return (
    <div className="w-full space-y-6">
      {/* Chiffres du jour */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button onClick={() => navigateTo('/admin')} className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-300 transition-colors">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500"><FolderOpen className="w-4 h-4 text-blue-600" />Dossiers en cours</div>
          <div className="text-3xl font-bold tabular-nums mt-1">{open.length}</div>
          <div className="text-xs text-slate-500 mt-1 truncate">
            {open.slice(0, 4).map((d) => d.reference || '—').join(' · ') || 'aucun dossier ouvert'}
          </div>
        </button>
        <button onClick={() => navigateTo('/admin')} className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-300 transition-colors">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500"><BadgeEuro className="w-4 h-4 text-blue-600" />Ventes du mois</div>
          <div className="text-3xl font-bold tabular-nums mt-1">{salesThisMonth.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            {salesAmount > 0 ? fmtEur(salesAmount) : `${closedThisMonth.length} dossier(s) clôturé(s) au total`}
          </div>
        </button>
        <button onClick={() => navigateTo('/ingestion')} className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-300 transition-colors lg:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500"><Rocket className="w-4 h-4 text-blue-600" />Dernière campagne</div>
          {campaign ? (
            <div className="flex items-end gap-5 mt-1 flex-wrap">
              <div><span className="text-3xl font-bold tabular-nums text-emerald-600">{campaign.confirmed_count ?? 0}</span><span className="text-xs text-slate-500 ml-1">confirmées</span></div>
              <div><span className="text-3xl font-bold tabular-nums text-amber-600">{campaign.gap_count ?? 0}</span><span className="text-xs text-slate-500 ml-1">lacunes</span></div>
              <div><span className="text-3xl font-bold tabular-nums text-slate-400">{campaign.done_count ?? 0}/{campaign.total ?? 0}</span><span className="text-xs text-slate-500 ml-1">études</span></div>
              <div className="text-xs text-slate-500 pb-1">
                {campaign.status === 'done'
                  ? (campaignEnd ? `terminée le ${fmtTime(campaignEnd)}` : 'terminée')
                  : `en cours — lancée le ${fmtTime(campaign.created_at)}`}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 mt-2">Aucune campagne pour l'instant.</div>
          )}
        </button>
      </div>

      {/* Routine du matin (Truth Center 3b, GO 03/09) : la santé de la dernière
          vague en une ligne — le détail vit dans le Truth Center. */}
      {digest && (
        <button onClick={() => navigateTo('/verite')} className="w-full text-left bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm hover:border-amber-300 transition-colors flex items-center gap-3 flex-wrap">
          <span className="text-xs uppercase tracking-wide text-slate-500">Ce matin</span>
          <span className="text-sm text-slate-700">{digest.summary}</span>
          {(digest.payload.cas_dores_en_echec?.length ?? 0) > 0 && <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2">régression de grammaire</span>}
        </button>
      )}

      {/* Nouvelles annonces : RÉSUMÉ minimal — le volume de travail du jour,
          une ligne par étude ; le traitement se fait dans le Workflow. */}
      <button
        onClick={() => navigateTo('/workflow')}
        className="w-full text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-300 transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-blue-600" />
            <span className="text-xs uppercase tracking-wide text-slate-500">Nouvelles annonces{displayName ? ` — ${displayName}` : ''}</span>
          </div>
          <span className="text-3xl font-bold tabular-nums">{toProcess.length}</span>
          <span className="text-sm text-slate-500">à traiter
            {toProcess.filter((h) => h.kind === 'price_drop').length > 0 && (
              <> · dont <span className="text-emerald-600 font-medium">{toProcess.filter((h) => h.kind === 'price_drop').length} baisse{toProcess.filter((h) => h.kind === 'price_drop').length > 1 ? 's' : ''}</span></>
            )}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap ml-auto">
            {mySearches
              .map((s) => ({ s, n: toProcess.filter((h) => h.search_id === s.id).length }))
              .filter(({ n }) => n > 0)
              .map(({ s, n }) => (
                <span key={s.id} className="text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
                  {s.label || `${s.brand} ${s.model}`.trim()} · <span className="font-semibold">{n}</span>
                </span>
              ))}
            {toProcess.length === 0 && <span className="text-sm text-slate-400">rien à trier — le scrape quotidien remplit cette case</span>}
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </button>

      {/* Opportunités repérées par la DERNIÈRE campagne uniquement */}
      {campaignLoaded && campaign && (
        <OpportunityAlerts
          onInspect={(o) => inspectOpportunityInMarket(o, navigateTo)}
          touchedSince={campaign.created_at}
        />
      )}

      {/* Veille juridique : dernières entrées publiées */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Veille juridique</h2>
          </div>
          <button onClick={() => navigateTo('/veille')} className="flex items-center gap-1 text-sm text-brand-ocean hover:underline">
            Tout l'historique <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">Lois, taxes et règlements de l'automobile européenne.</p>
        {legal.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">Aucune entrée pour l'instant — la collecte automatique démarre avec le branchement de l'API.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {legal.map((l) => (
              <li key={l.id} className="py-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500 w-8 shrink-0">{l.country}</span>
                <span className={`text-[10px] uppercase font-semibold rounded-full px-2 py-0.5 shrink-0 ${l.kind === 'taxe' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>{l.kind}</span>
                <span className="text-sm text-slate-800 truncate flex-1">{l.title}</span>
                <span className="text-xs text-slate-400 shrink-0">
                  {l.effective_date ? `effet ${new Date(l.effective_date).toLocaleDateString('fr-FR')}` : new Date(l.created_at).toLocaleDateString('fr-FR')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cartographie */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Map className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold">Cartographie des mappings</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">Tout ce qu'ADA sait chercher — bleu : certifié humain, violet : appris par ADA seule.</p>
        {tree ? <MappingRadialTree root={tree} /> : <div className="text-sm text-slate-500 py-10 text-center">Chargement de la carte…</div>}
      </div>
    </div>
  );
}
