import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useKeycloak } from './auth/MockKeycloak';
import Dashboard from './pages/Dashboard';
import Sensors from './pages/Sensors';
import AISearch from './pages/AISearch';
import SQLGenerator from './pages/SQLGenerator';
import DataQuality from './pages/DataQuality';
import AgencySelection from './pages/AgencySelection';
import RefrigerationMonitor from './pages/RefrigerationMonitor';
import AdminLogin from './pages/auth/AdminLogin';
import UserLogin from './pages/auth/UserLogin';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import LiveMap from './pages/LiveMap';
import AdminPanel from './pages/AdminPanel';
import Reports from './pages/Reports';
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from 'react-hot-toast';

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const { keycloak, initialized } = useKeycloak();

  if (!initialized) return null; // wait until auth state is loaded

  if (!keycloak.authenticated) {
    return <Navigate to="/login/user" replace />;
  }

  return children;
};

function App() {
  return (
    <ThemeProvider>
      <Toaster 
        position="top-right" 
        toastOptions={{
          className: 'dark:bg-slate-800 dark:text-white',
          style: {
            background: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            fontSize: '14px',
            maxWidth: '400px'
          }
        }} 
      />
      <Router>
      <div className="min-h-screen">
        <Routes>
          {/* Public Authentication Routes */}
          <Route path="/login/admin" element={<AdminLogin />} />
          <Route path="/login/user" element={<UserLogin />} />
          
          {/* Default entry redirects to user login if not authenticated, or agency selection if authenticated */}
          <Route 
            path="/" 
            element={
              <PrivateRoute>
                <AgencySelection />
              </PrivateRoute>
            } 
          />

          {/* Protected Routes */}
          <Route 
            path="/dashboard" 
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/sensors" 
            element={
              <PrivateRoute>
                <Sensors />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/ai-search" 
            element={
              <PrivateRoute>
                <AISearch />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/sql-gen" 
            element={
              <PrivateRoute>
                <SQLGenerator />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/quality" 
            element={
              <PrivateRoute>
                <DataQuality />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/refrigeration" 
            element={
              <PrivateRoute>
                <RefrigerationMonitor />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/profile" 
            element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <PrivateRoute>
                <Settings />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/notifications" 
            element={
              <PrivateRoute>
                <Notifications />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/live-map" 
            element={
              <PrivateRoute>
                <LiveMap />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <PrivateRoute>
                <AdminPanel />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/reports" 
            element={
              <PrivateRoute>
                <Reports />
              </PrivateRoute>
            } 
          />
        </Routes>
      </div>
    </Router>
    </ThemeProvider>
  );
}

export default App;
