import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useKeycloak } from './auth/MockKeycloak';
import Dashboard from './pages/Dashboard';
import Sensors from './pages/Sensors';
import AISearch from './pages/AISearch';
import SQLGenerator from './pages/SQLGenerator';
import DataQuality from './pages/DataQuality';
import AgencySelection from './pages/AgencySelection';
import RefrigerationMonitor from './pages/RefrigerationMonitor';

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const { initialized } = useKeycloak();

  // DEMO MODE: Always allow Access
  if (!initialized) return children;

  return children;
};

function App() {
  return (
    <Router>
      <div className="min-h-screen">
        <Routes>
          <Route path="/" element={<AgencySelection />} />
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
        </Routes>
      </div>
    </Router>
  );
}

export default App;
