import { Link, Route, Routes, useMatch } from 'react-router-dom';

import Home from './pages/Home';
import OrderPage from './pages/OrderPage';
import AdminPage from './pages/AdminPage';
import PlatformAdminPage from './admin/PlatformAdminPage';
import ActivationPage from './admin/ActivationPage';
import CragExpressPage from './pages/CragExpressPage';
import PublicSalesMenu from './pages/PublicSalesMenu';

function App() {
  const isCragExpress = useMatch('/order/crag-fridge');
  const isPublishedMenu = useMatch('/menu/:menuId');
  const isAdmin = useMatch('/admin/*') || useMatch('/admin');
  const isPlatform = useMatch('/platform/*') || useMatch('/platform');
  const isActivate = useMatch('/activate');

  if (isPublishedMenu) return <PublicSalesMenu menuId={isPublishedMenu.params.menuId!} />;

  if (isCragExpress) {
    return <main className="min-h-screen px-4 py-6"><CragExpressPage /></main>;
  }

  if (isActivate) return <ActivationPage />;

  if (window.location.pathname === '/') return <Home />;

  if (isPlatform) {
    return <PlatformAdminPage />;
  }

  if (isAdmin) {
    return <AdminPage />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">BeanBook</Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/admin" className="hover:underline">Admin</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/order/crag-fridge" element={<CragExpressPage />} />
          <Route path="/order/:eventSlug" element={<OrderPage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="/platform/*" element={<PlatformAdminPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
