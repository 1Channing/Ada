import { GraduationCap } from 'lucide-react';
import { LearningBox } from '../components/LearningBox';
import { useAuth } from '../services/auth';

/**
 * BOÎTE À APPRENDRE — page admin dédiée (01/10, demande Channing : « un accès
 * spécial admin parmi ces options », à côté du Truth Center, de la
 * télémétrie et de l'équipe). Même contenu que l'onglet « À apprendre » du
 * Centre de vérité ; l'icône de l'en-tête porte le compte des cas ouverts.
 */
export function Apprendre() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return <div className="p-6 text-sm text-slate-500">Page réservée à l'administrateur.</div>;
  }
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2"><GraduationCap className="w-5 h-5 text-emerald-600" /> Boîte à apprendre</h1>
        <p className="text-sm text-slate-500 mt-1">
          Les cas qu'ADA a rencontrés sans savoir les traiter, enregistrés au moment où ils se présentent. On les règle ensemble, puis on marque « Fait » avec une ligne de résolution. Différente de la boîte noire technique du worker.
        </p>
      </div>
      <LearningBox />
    </div>
  );
}
