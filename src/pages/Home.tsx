import { useEffect, useState } from 'react';
import { FolderOpen, BadgeEuro, Rocket, Map } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { loadMappingTree, type TreeNode } from '../services/ingestionHistory';
import { MappingRadialTree } from '../components/MappingRadialTree';
import { OpportunityAlerts } from '../components/OpportunityAlerts';

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
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [campaignEnd, setCampaignEnd] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ data: dealRows }, { data: campRows }] = await Promise.all([
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
      ]);
      setDeals((dealRows ?? []) as DealRow[]);
      const camp = ((campRows ?? [])[0] ?? null) as CampaignRow | null;
      setCampaign(camp);
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
      // La carto en dernier : c'est la requête la plus lourde.
      setTree(await loadMappingTree());
    })();
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.location.reload();
  };

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

      {/* Opportunités inter-pays repérées (même composant que le MI) */}
      <OpportunityAlerts onInspect={() => navigateTo('/market')} />

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
