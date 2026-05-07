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
  Thermometer,
  UserCircle2,
  Settings,
  Moon,
  Sun,
  Map,
  Shield,
  FileText
} from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { keycloak } = useKeycloak();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [currentAgency, setCurrentAgency] = useState('RFD');
  const [showAgencySwap, setShowAgencySwap] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = [
    { id: 1, title: 'Critical Temperature Alert', message: 'Refrigeration Node #1 exceeded max threshold (5.2°C).', time: '10 mins ago', type: 'critical' },
    { id: 2, title: 'System Warning', message: 'Door left open for more than 30 minutes on Node #2.', time: '1 hour ago', type: 'warning' },
    { id: 3, title: 'Weekly Report', message: 'Your weekly carbon footprint report is ready to download.', time: '1 day ago', type: 'info' },
  ];

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Live Map', icon: Map, path: '/live-map' },
    { name: 'Sensors', icon: Radio, path: '/sensors' },
    { name: 'Reports', icon: FileText, path: '/reports' },
    { name: 'AI Search', icon: Search, path: '/ai-search' },
    { name: 'SQL AI', icon: Database, path: '/sql-gen' },
    { name: 'Data Quality', icon: ShieldCheck, path: '/quality' },
    { name: 'Refrigeration', icon: Thermometer, path: '/refrigeration' },
    { name: 'Notifications', icon: Bell, path: '/notifications' },
  ];

  const isAdmin = keycloak.tokenParsed?.realm_access?.roles?.includes('admin');
  const displayedNavItems = isAdmin 
    ? [...navItems, { name: 'Admin Panel', icon: Shield, path: '/admin' }]
    : navItems;

  const agencies = [
    { code: 'RFD', name: 'Royal Forest Dept.' },
    { code: 'TGO', name: 'Greenhouse Gas Org.' },
    { code: 'DNP', name: 'National Parks Dept.' }
  ];
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex bg-gray-50 dark:bg-gray-950 min-h-screen transition-colors duration-200">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col z-50 transition-transform lg:translate-x-0 lg:static lg:h-screen shadow-sm ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-200 dark:shadow-none">
                <span className="text-white font-bold text-xl">C</span>
              </div>
              <span className="font-extrabold text-2xl tracking-tight text-gray-900 dark:text-white">CarbonBox</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto">
          {displayedNavItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              onClick={() => setIsSidebarOpen(false)}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
                location.pathname === item.path
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-100 dark:shadow-none font-bold'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <item.icon className={`w-5 h-5 ${location.pathname === item.path ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`} />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <button 
            onClick={() => keycloak.logout()}
            className="flex items-center space-x-3 px-4 py-3 w-full text-gray-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-400 rounded-xl transition-all group"
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
              className="p-2 -ml-2 text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 lg:hidden"
            >
              <Building2 className="w-6 h-6 rotate-90" />
            </button>

            <h2 className="text-lg lg:text-2xl font-bold text-gray-900 dark:text-white capitalize px-2 lg:px-4 border-l-4 border-brand-600 leading-none">
              {location.pathname.replace('/', '').replace('-', ' ') || 'Dashboard'}
            </h2>
            
            {/* Agency Switcher - Hidden on very small screens, or simplified */}
            <div className="relative hidden md:block">
              <button 
                onClick={() => setShowAgencySwap(!showAgencySwap)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm"
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
          
          <div className="flex items-center space-x-3 lg:space-x-4">
            {/* Theme Toggle */}
            <button 
              onClick={toggleTheme}
              className="p-2 text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors focus:outline-none"
              title="Toggle Dark Mode"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notification Bell */}
            <div className="relative hidden sm:block">
              <button 
                onClick={() => { setShowNotifications(!showNotifications); setShowProfileMenu(false); }}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 relative transition-colors focus:outline-none"
              >
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 border-2 border-white dark:border-gray-900 rounded-full shadow-sm"></span>
              </button>

              {showNotifications && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                    <h3 className="font-bold text-gray-900 dark:text-white">Notifications</h3>
                    <button className="text-xs text-brand-600 dark:text-brand-400 font-medium hover:text-brand-700 dark:hover:text-brand-300 transition-colors">Mark all as read</button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map(note => (
                      <div key={note.id} className="p-4 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer flex items-start group">
                        <div className={`w-2 h-2 rounded-full mt-1.5 mr-3 shrink-0 shadow-sm ${
                          note.type === 'critical' ? 'bg-red-500 shadow-red-200 dark:shadow-red-900/50' : 
                          note.type === 'warning' ? 'bg-amber-500 shadow-amber-200 dark:shadow-amber-900/50' : 'bg-brand-500 shadow-brand-200 dark:shadow-brand-900/50'
                        }`} />
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{note.title}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{note.message}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 font-medium">{note.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 text-center border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                    <Link 
                      to="/notifications" 
                      onClick={() => setShowNotifications(false)}
                      className="text-xs font-bold text-brand-600 dark:text-brand-400 block w-full"
                    >
                      View All Notifications
                    </Link>
                  </div>
                </div>
              )}
            </div>
            {/* User Profile Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center space-x-3 p-1 pl-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full shadow-sm pr-1 border-brand-50 dark:hover:bg-gray-800 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
              >
                <div className="hidden md:block text-right">
                  <p className="text-xs font-bold text-gray-900 dark:text-white leading-none mb-1">{keycloak.tokenParsed?.preferred_username}</p>
                  <p className="text-[10px] text-brand-600 dark:text-brand-400 font-bold tracking-tighter uppercase">{keycloak.tokenParsed?.realm_access?.roles?.[0] || 'User'}</p>
                </div>
                <div className="w-8 h-8 lg:w-9 lg:h-9 bg-brand-600 rounded-full flex items-center justify-center font-bold text-white shadow-inner text-sm">
                  {keycloak.tokenParsed?.preferred_username?.[0].toUpperCase() || 'U'}
                </div>
              </button>
              
              {showProfileMenu && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-xl z-50 py-2">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 md:hidden">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{keycloak.tokenParsed?.preferred_username}</p>
                    <p className="text-xs text-brand-600 dark:text-brand-400 font-medium capitalize">{keycloak.tokenParsed?.realm_access?.roles?.[0] || 'User'} Account</p>
                  </div>
                  
                  <Link 
                    to="/profile"
                    onClick={() => setShowProfileMenu(false)}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-brand-50 dark:hover:bg-gray-800 hover:text-brand-700 dark:hover:text-brand-400 transition-colors flex items-center"
                  >
                    <UserCircle2 className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500" />
                    My Profile
                  </Link>
                  <Link 
                    to="/settings"
                    onClick={() => setShowProfileMenu(false)}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-brand-50 dark:hover:bg-gray-800 hover:text-brand-700 dark:hover:text-brand-400 transition-colors flex items-center"
                  >
                    <Settings className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500" />
                    Account Settings
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-800 my-1"></div>
                  <button 
                    onClick={() => {
                      setShowProfileMenu(false);
                      keycloak.logout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center font-medium"
                  >
                    <LogOut className="w-4 h-4 mr-3 text-red-500 dark:text-red-400" />
                    Sign Out
                  </button>
                </div>
              )}
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
