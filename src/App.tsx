import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { startCampaignWatcher } from './services/campaignRunner';
import { StudiesV2 } from './pages/StudiesV2';
import { Administrative } from './pages/Administrative';
import { AdminHistory } from './pages/AdminHistory';
import { LinkGenerator } from './pages/LinkGenerator';
import { Ingestion } from './pages/Ingestion';
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
      return <LinkGenerator />;
    }
    if (path === '/ingestion') {
      return <Ingestion />;
    }
    if (path === '/ingestion/history') {
      return <IngestionHistory />;
    }
    if (path === '/market') {
      return <MarketIntelligence />;
    }
    return <StudiesV2 />;
  };

  return (
    <Layout>
      {renderPage()}
    </Layout>
  );
}

export default App;
