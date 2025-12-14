import { useState } from 'react';
import { FileText, PlayCircle, BarChart3, MessageSquare } from 'lucide-react';
import { StudiesV2MakesStudies } from './StudiesV2MakesStudies';
import { StudiesV2RunSearches } from './StudiesV2RunSearches';
import { StudiesV2Results } from './StudiesV2Results';
import { StudiesV2Negotiations } from './StudiesV2Negotiations';

type Tab = 'makes' | 'run' | 'results' | 'negotiations';

export function StudiesV2() {
  const [activeTab, setActiveTab] = useState<Tab>('makes');

  const tabs = [
    { id: 'makes' as Tab, label: 'Makes Studies', icon: FileText },
    { id: 'run' as Tab, label: 'Run Searches', icon: PlayCircle },
    { id: 'results' as Tab, label: 'Results', icon: BarChart3 },
    { id: 'negotiations' as Tab, label: 'Negotiations', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-zinc-100">Ada</h1>
        <p className="text-zinc-400 mt-2">
          Automated sourcing analysis for target and source markets
        </p>
      </div>

      <div className="border-b border-zinc-800">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-zinc-400 hover:text-zinc-300'
                }`}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {activeTab === 'makes' && <StudiesV2MakesStudies />}
        {activeTab === 'run' && <StudiesV2RunSearches />}
        {activeTab === 'results' && <StudiesV2Results />}
        {activeTab === 'negotiations' && <StudiesV2Negotiations />}
      </div>
    </div>
  );
}
