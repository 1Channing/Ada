import { Layout } from './components/Layout';
import { StudiesV2 } from './pages/StudiesV2';
import { Administrative } from './pages/Administrative';
import { AdminHistory } from './pages/AdminHistory';

function App() {
  const path = window.location.pathname;

  const renderPage = () => {
    if (path === '/admin') {
      return <Administrative />;
    }
    if (path === '/admin/history') {
      return <AdminHistory />;
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
