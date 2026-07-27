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
import { Login } from './pages/Login';
import { startAuthWatcher, useAuth, ensureProfile } from './services/auth';

const originalPushState = window.history.pushState.bind(window.history);
window.history.pushState = function(...args) {
  originalPushState(...args);
  window.dispatchEvent(new Event('locationchange'));
};

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const { ready, userId } = useAuth();

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

  const renderPage = () => {
    // /admin (ancien nom) et /ventes mènent à la même page Ventes.
    if (path === '/admin' || path === '/ventes') {
      return <Ventes />;
    }
    if (path === '/admin/history') {
      return <AdminHistory />;
    }
    if (path === '/link-generator') {
      return <Atelier initial="linkgen" />;
    }
    if (path === '/ingestion') {
      return <Atelier initial="ingestion" />;
    }
    if (path === '/ingestion/history') {
      return <IngestionHistory />;
    }
    if (path === '/market') {
      return <MarketIntelligence />;
    }
    // /etudes (ancien nom) et /workflow mènent au Workflow personnel.
    if (path === '/etudes' || path === '/workflow') {
      return <Workflow />;
    }
    if (path === '/veille') {
      return <Veille />;
    }
    // Accueil : poste de pilotage (ventes, campagne, nouvelles annonces, veille).
    return <Home />;
  };

  if (!ready) {
    return <div className="min-h-screen bg-slate-50" />;
  }
  if (!userId) {
    return <Login />;
  }

  return (
    <Layout>
      {renderPage()}
    </Layout>
  );
}

export default App;
