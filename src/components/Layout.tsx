import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useKeycloak } from '../auth/MockKeycloak';
import { 
  LayoutDashboard, 
  Radio, 
  Search, 
  Database, 
  ShieldCheck, 
  LogOut,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  Thermometer
} from 'lucide-react';
import { useState } from 'react';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { keycloak } = useKeycloak();
  const location = useLocation();
  const [currentAgency, setCurrentAgency] = useState('RFD');
  const [showAgencySwap, setShowAgencySwap] = useState(false);

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Sensors', icon: Radio, path: '/sensors' },
    { name: 'AI Search', icon: Search, path: '/ai-search' },
    { name: 'SQL AI', icon: Database, path: '/sql-gen' },
    { name: 'Data Quality', icon: ShieldCheck, path: '/quality' },
    { name: 'Refrigeration', icon: Thermometer, path: '/refrigeration' },
  ];

  const agencies = [
    { code: 'RFD', name: 'Royal Forest Dept.' },
    { code: 'TGO', name: 'Greenhouse Gas Org.' },
    { code: 'DNP', name: 'National Parks Dept.' }
  ];
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex bg-gray-50 min-h-screen">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 flex flex-col z-50 transition-transform lg:translate-x-0 lg:static lg:h-screen shadow-sm ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-200">
                <span className="text-white font-bold text-xl">C</span>
              </div>
              <span className="font-extrabold text-2xl tracking-tight text-gray-900">CarbonBox</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          {navItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              onClick={() => setIsSidebarOpen(false)}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
                location.pathname === item.path
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-100 font-bold'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <item.icon className={`w-5 h-5 ${location.pathname === item.path ? 'text-white' : 'text-gray-400'}`} />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <button 
            onClick={() => keycloak.logout()}
            className="flex items-center space-x-3 px-4 py-3 w-full text-gray-400 hover:bg-red-50 hover:text-red-700 rounded-xl transition-all group"
          >
            <LogOut className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-6 lg:mb-8">
          <div className="flex items-center space-x-4">
            {/* Mobile Menu Toggle */}
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 text-gray-400 hover:text-brand-600 lg:hidden"
            >
              <Building2 className="w-6 h-6 rotate-90" />
            </button>

            <h2 className="text-lg lg:text-2xl font-bold text-gray-900 capitalize px-2 lg:px-4 border-l-4 border-brand-600 leading-none">
              {location.pathname.replace('/', '').replace('-', ' ') || 'Dashboard'}
            </h2>
            
            {/* Agency Switcher - Hidden on very small screens, or simplified */}
            <div className="relative hidden md:block">
              <button 
                onClick={() => setShowAgencySwap(!showAgencySwap)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
              >
                <Building2 className="w-3.5 h-3.5 text-brand-600" />
                <span>{currentAgency}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              
              {showAgencySwap && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-50 py-2 border-brand-100">
                  {agencies.map(a => (
                    <button
                      key={a.code}
                      onClick={() => { setCurrentAgency(a.code); setShowAgencySwap(false); }}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-brand-50 ${currentAgency === a.code ? 'text-brand-600 font-bold' : 'text-gray-500'}`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-3 lg:space-x-6">
            <button className="p-2 text-gray-400 hover:text-brand-600 relative transition-colors hidden sm:block">
              <Bell className="w-6 h-6" />
              <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full"></span>
            </button>
            <div className="flex items-center space-x-3 p-1 pl-3 bg-white border border-gray-200 rounded-full shadow-sm pr-1 border-brand-50">
              <div className="hidden md:block text-right">
                <p className="text-xs font-bold text-gray-900 leading-none mb-1">{keycloak.tokenParsed?.preferred_username}</p>
                <p className="text-[10px] text-brand-600 font-bold tracking-tighter uppercase">{keycloak.tokenParsed?.realm_access?.roles?.[0] || 'User'}</p>
              </div>
              <div className="w-8 h-8 lg:w-9 lg:h-9 bg-brand-600 rounded-full flex items-center justify-center font-bold text-white shadow-inner text-sm">
                {keycloak.tokenParsed?.preferred_username?.[0].toUpperCase() || 'U'}
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
