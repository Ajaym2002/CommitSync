import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Dashboard from './pages/Dashboard';
import Syncs from './pages/Syncs';
import Team from './pages/Team';
import Circles from './pages/Circles';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import GoogleAuthCallback from './pages/GoogleAuthCallback';
import MarketingPage from './pages/MarketingPage';
import NotFound from './pages/NotFound';
import FloatingActions from './components/common/FloatingActions';

const queryClient = new QueryClient();

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  // Redirect unauthenticated users to '/' — the MarketingPage handles auth
  if (!user) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              {/* /login redirects to / — auth is embedded in the MarketingPage */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/auth/google/success" element={<GoogleAuthCallback />} />
              <Route path="/auth/google/error" element={<GoogleAuthCallback />} />
              <Route path="/" element={<MarketingPage />} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/syncs" element={<ProtectedRoute><Syncs /></ProtectedRoute>} />
              <Route path="/circles" element={<ProtectedRoute><Circles /></ProtectedRoute>} />
              <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
              <Route path="/team/:teamId" element={<ProtectedRoute><Team /></ProtectedRoute>} />
              {/* 404 Catch-All Route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

