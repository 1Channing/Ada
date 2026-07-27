import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Upload, Rocket } from 'lucide-react';
import { CampaignPanel } from '../components/CampaignPanel';
import { Ingestion } from './Ingestion';
import { LinkGenerator } from './LinkGenerator';

/**
 * Atelier mapping — fusion Link Gen + Ingestion (demande Channing 27/07).
 * Pleine largeur, sections dépliables : les campagnes (l'outil quotidien)
 * toujours visibles, l'ingestion ouverte, le générateur manuel replié par
 * défaut (ADA connaît de plus en plus de mappings toute seule).
 * Les routes /ingestion et /link-generator mènent ici toutes les deux —
 * les liens profonds (/ingestion?url=… du centre de résolution) continuent
 * de fonctionner tels quels.
 */
export function Atelier({ initial }: { initial?: 'ingestion' | 'linkgen' }) {
  const deepLinkUrl = new URLSearchParams(window.location.search).get('url');
  const [openIngestion, setOpenIngestion] = useState(initial !== 'linkgen' || !!deepLinkUrl);
  const [openLinkGen, setOpenLinkGen] = useState(initial === 'linkgen');

  return (
    <div className="w-full space-y-6">
      <Section
        icon={<Rocket className="w-5 h-5 text-blue-600" />}
        title="Campagnes de mapping"
        subtitle="ADA explore, confirme et apprend toute seule — l'outil du quotidien."
        open
        fixed
      >
        <CampaignPanel />
      </Section>

      <Section
        icon={<Upload className="w-5 h-5 text-blue-600" />}
        title="Ingestion — apprendre depuis une URL"
        subtitle="Collez une recherche filtrée : ADA confirme chaque critère et ne mémorise que le certain. Sans modèle = découverte de gamme."
        open={openIngestion}
        onToggle={() => setOpenIngestion((v) => !v)}
      >
        <Ingestion embedded />
      </Section>

      <Section
        icon={<Link2 className="w-5 h-5 text-blue-600" />}
        title="Générateur manuel d'URLs (Link Gen)"
        subtitle="Génération ponctuelle multi-marchés — de moins en moins nécessaire à mesure qu'ADA apprend."
        open={openLinkGen}
        onToggle={() => setOpenLinkGen((v) => !v)}
      >
        <LinkGenerator embedded />
      </Section>
    </div>
  );
}

function Section({ icon, title, subtitle, open, onToggle, fixed = false, children }: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle?: () => void;
  fixed?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={fixed ? undefined : onToggle}
        className={`w-full flex items-center gap-3 px-6 py-4 text-left ${fixed ? 'cursor-default' : 'hover:bg-slate-50'}`}
        aria-expanded={open}
      >
        <span className="p-2 bg-blue-100 rounded-lg border border-blue-600/20 shrink-0">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          <span className="block text-xs text-slate-500 truncate">{subtitle}</span>
        </span>
        {!fixed && (open
          ? <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />
          : <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />)}
      </button>
      {open && <div className="px-6 pb-6 border-t border-slate-100 pt-5">{children}</div>}
    </section>
  );
}
