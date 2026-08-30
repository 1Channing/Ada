import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { startCampaignWatcher } from './services/campaignRunner';
import { Home } from './pages/Home';
import { Atelier } from './pages/Atelier';
import { logPageVisit } from './services/usageLog';
import { AdminHistory } from './pages/AdminHistory';
import { IngestionHistory } from './pages/IngestionHistory';
import { MarketIntelligence } from './pages/MarketIntelligence';
import { Workflow } from './pages/Workflow';
import { Ventes } from './pages/Ventes';
import { Veille } from './pages/Veille';
import { TruthCenter } from './pages/TruthCenter';
import { Telemetrie } from './pages/Telemetrie';
import { Login, ResetPassword } from './pages/Login';
import { startAuthWatcher, useAuth, ensureProfile } from './services/auth';

const originalPushState = window.history.pushState.bind(window.history);
window.history.pushState = function(...args) {
  originalPushState(...args);
  window.dispatchEvent(new Event('locationchange'));
};

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const { ready, userId, recovering } = useAuth();

  // Session : garde d'accès — tout ADA vit derrière la connexion.
  useEffect(() => {
    startAuthWatcher();
  }, []);
  useEffect(() => {
    if (userId) void ensureProfile();
  }, [userId]);

  // Campaigns run in the worker; the watcher mirrors the DB state into the
  // store so any page shows live progress (and picks up overnight runs).
  useEffect(() => {
    if (userId) startCampaignWatcher();
  }, [userId]);

  // Journal d'usage : quelles pages servent vraiment au quotidien.
  useEffect(() => {
    void logPageVisit(path);
  }, [path]);

  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname);
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('locationchange', handleLocationChange);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('locationchange', handleLocationChange);
    };
  }, []);

  // ── Navigation interne + KEEP-ALIVE (étage 3, validé Channing 26/08) ──────
  // Chaque page VISITÉE reste montée et simplement masquée quand une autre
  // est active : revenir sur le MI le retrouve exactement comme on l'a
  // laissé (études, filtres, radar déjà chargés), sans rechargement ni
  // nouvelle lecture serveur. /admin et /etudes sont les anciens noms de
  // /ventes et /workflow — même clé, même instance.
  const pageKeyOf = (p: string): string => {
    if (p === '/admin' || p === '/ventes') return 'ventes';
    if (p === '/admin/history') return 'admin-history';
    if (p === '/link-generator') return 'atelier-linkgen';
    if (p === '/ingestion') return 'atelier-ingestion';
    if (p === '/ingestion/history') return 'ingestion-history';
    if (p === '/market') return 'market';
    if (p === '/etudes' || p === '/workflow') return 'workflow';
    if (p === '/veille') return 'veille';
    if (p === '/verite') return 'truth';
    if (p === '/telemetrie') return 'telemetrie';
    return 'home';
  };
  const renderPageFor = (key: string) => {
    switch (key) {
      case 'ventes': return <Ventes />;
      case 'admin-history': return <AdminHistory />;
      case 'atelier-linkgen': return <Atelier initial="linkgen" />;
      case 'atelier-ingestion': return <Atelier initial="ingestion" />;
      case 'ingestion-history': return <IngestionHistory />;
      case 'market': return <MarketIntelligence />;
      case 'workflow': return <Workflow />;
      case 'veille': return <Veille />;
      case 'truth': return <TruthCenter />;
      case 'telemetrie': return <Telemetrie />;
      default: return <Home />;
    }
  };
  const activeKey = pageKeyOf(path);
  const [visited, setVisited] = useState<string[]>([activeKey]);
  useEffect(() => {
    setVisited((v) => (v.includes(activeKey) ? v : [...v, activeKey]));
  }, [activeKey]);

  if (!ready) {
    return <div className="min-h-screen bg-slate-50" />;
  }
  // Lien « mot de passe oublié » : l'écran de nouveau MDP passe avant tout
  // (la session de récupération est active — sans ce garde, l'app s'ouvrirait
  // normalement et le lien semblerait n'avoir rien fait).
  if (recovering) {
    return <ResetPassword />;
  }
  if (!userId) {
    return <Login />;
  }

  return (
    <Layout>
      {(visited.includes(activeKey) ? visited : [...visited, activeKey]).map((k) => (
        <div key={k} style={{ display: k === activeKey ? undefined : 'none' }}>
          {renderPageFor(k)}
        </div>
      ))}
    </Layout>
  );
}

export default App;
