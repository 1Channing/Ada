/**
 * Garde-fou de page (07/09, constat Channing : « page blanche » sur la carte).
 * Un plantage de rendu React démontait toute l'application sans un mot. Ici
 * la page fautive affiche l'erreur (message + où), le bandeau et les autres
 * pages restent utilisables, et un bouton relance la page. L'erreur part
 * aussi dans la console pour la télémétrie du navigateur.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { name: string; children: ReactNode }
interface State { error: Error | null; info: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PAGE ${this.props.name}] plantage de rendu :`, error, info.componentStack);
    this.setState({ info: (info.componentStack ?? '').split('\n').filter(Boolean).slice(0, 4).join('\n') });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <div className="max-w-2xl mx-auto my-10 bg-white border border-rose-200 rounded-2xl shadow-sm p-6 space-y-3">
        <div className="flex items-center gap-2 text-rose-700">
          <AlertTriangle className="w-5 h-5" />
          <h2 className="font-semibold">La page « {this.props.name} » a planté</h2>
        </div>
        <p className="text-sm text-slate-600">ADA reste utilisable : les autres pages fonctionnent. Copie ce message à Channing pour que la cause soit corrigée.</p>
        <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-slate-700">{e.name}: {e.message}{'\n'}{(e.stack ?? '').split('\n').slice(1, 4).join('\n')}{this.state.info ? `\n— composants :\n${this.state.info}` : ''}</pre>
        <button onClick={() => this.setState({ error: null, info: '' })} className="flex items-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-3 py-2 text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Relancer la page
        </button>
      </div>
    );
  }
}
