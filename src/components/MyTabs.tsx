/**
 * MES ONGLETS (23/10, Channing : « me permettre, même en compte administrateur, d'enlever ou d'ajouter
 * des onglets ; j'en ai trop, je veux activer ou désactiver selon mon bon vouloir »). Une case par entrée
 * du bandeau à laquelle le compte a droit : décochée = retirée de SON bandeau, pour lui seul, sur tous
 * ses appareils (profiles.hidden_tabs ; ce navigateur en attendant le SQL). Les droits (page Admin)
 * ne bougent pas : un onglet masqué s'ouvre toujours par son adresse.
 *
 * Le même panneau sert deux fois : dans la page Admin (section « Mes onglets », demande du 23/10 soir)
 * et, pour les comptes sans page Admin, dans un petit menu du bandeau.
 */
import { useState } from 'react';
import { useAuth } from '../services/auth';
import { saveHiddenTabs } from '../services/hiddenTabs';

export interface NavChoice { path: string; label: string }

export function MyTabsPanel({ items }: { items: NavChoice[] }) {
  const { hiddenTabs } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const toggle = (path: string) => {
    const next = hiddenTabs.includes(path) ? hiddenTabs.filter((p) => p !== path) : [...hiddenTabs, path];
    void saveHiddenTabs(next).then(setNote);
  };
  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-2">Décoche ce que tu ne veux plus voir dans ton bandeau. Réglage personnel : les droits des comptes ne changent pas, et un onglet masqué reste ouvrable par son adresse.</p>
      <div className="space-y-1 max-h-80 overflow-auto">
        {items.map((it) => (
          <label key={it.path} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">
            <input type="checkbox" checked={!hiddenTabs.includes(it.path)} onChange={() => toggle(it.path)} className="accent-brand-ocean" />
            <span className={hiddenTabs.includes(it.path) ? 'text-slate-400' : ''}>{it.label}</span>
          </label>
        ))}
      </div>
      {note && <p className="text-[11px] text-amber-700 mt-2">{note}</p>}
    </div>
  );
}
