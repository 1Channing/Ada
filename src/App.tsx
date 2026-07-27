import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { startCampaignWatcher } from './services/campaignRunner';
import { StudiesV2 } from './pages/StudiesV2';
import { Home } from './pages/Home';
import { Atelier } from './pages/Atelier';
import { logPageVisit } from './services/usageLog';
import { Administrative } from './pages/Administrative';
import { AdminHistory } from './pages/AdminHistory';
import { IngestionHistory } from './pages/IngestionHistory';
import { MarketIntelligence } from './pages/MarketIntelligence';

const originalPushState = window.history.pushState.bind(window.history);
window.history.pushState = function(...args) {
  originalPushState(...args);
  window.dispatchEvent(new Event('locationchange'));
};

function App() {
  const [path, setPath] = useState(window.location.pathname);

  // Campaigns run in the worker; the watcher mirrors the DB state into the
  // store so any page shows live progress (and picks up overnight runs).
  useEffect(() => {
    startCampaignWatcher();
  }, []);

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
    if (path === '/admin') {
      return <Administrative />;
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
    if (path === '/etudes') {
      return <StudiesV2 />;
    }
    // Accueil : poste de pilotage (carto, dossiers, dernière campagne).
    return <Home />;
  };

  return (
    <Layout>
      {renderPage()}
    </Layout>
  );
}

export default App;
