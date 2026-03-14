import { Layout } from './components/Layout';
import { StudiesV2 } from './pages/StudiesV2';
import { Administrative } from './pages/Administrative';

function App() {
  const path = window.location.pathname;

  const renderPage = () => {
    if (path === '/admin') {
      return <Administrative />;
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
