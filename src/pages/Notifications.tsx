import React, { useState } from 'react';
import { Bell, CheckCircle2, AlertTriangle, Info, ShieldAlert, Check } from 'lucide-react';
import Layout from '../components/Layout';

interface Notification {
  id: number;
  title: string;
  message: string;
  time: string;
  type: 'critical' | 'warning' | 'info';
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: 1, title: 'Critical Temperature Alert', message: 'Refrigeration Node #1 exceeded max threshold (5.2°C). Immediate action required.', time: '10 mins ago', type: 'critical', read: false },
  { id: 2, title: 'System Warning', message: 'Door left open for more than 30 minutes on Node #2. Potential cooling loss.', time: '1 hour ago', type: 'warning', read: false },
  { id: 3, title: 'Weekly Report', message: 'Your weekly carbon footprint report is ready to download from the analytics dashboard.', time: '1 day ago', type: 'info', read: true },
  { id: 4, title: 'Sensor Offline', message: 'Connection lost to Node #4. Attempting automatic reconnection...', time: '2 days ago', type: 'warning', read: true },
  { id: 5, title: 'System Update', message: 'Platform updated to version v2.4.1 successfully.', time: '3 days ago', type: 'info', read: true },
  { id: 6, title: 'Power Surge Detected', message: 'Main supply experienced a brief surge. Backup systems initiated properly.', time: '1 week ago', type: 'critical', read: true },
];

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');

  const handleMarkAsRead = (id: number) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'critical') return n.type === 'critical';
    return true;
  });

  const getIcon = (type: string) => {
    switch(type) {
      case 'critical': return <ShieldAlert className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      default: return <Info className="w-5 h-5 text-brand-500" />;
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 flex items-center">
              <Bell className="w-6 h-6 mr-3 text-brand-600" />
              Notifications
            </h1>
            <p className="text-sm text-gray-500 mt-1 font-medium">Stay updated with system alerts and activities.</p>
          </div>
          
          <button 
            onClick={handleMarkAllRead}
            className="flex items-center px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-bold rounded-lg shadow-sm transition-colors"
          >
            <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
            Mark all as read
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
          {/* Filters */}
          <div className="flex border-b border-gray-100 p-2">
            {['all', 'unread', 'critical'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-6 py-2.5 text-sm font-bold capitalize rounded-lg transition-colors ${
                  filter === f 
                    ? 'bg-brand-50 text-brand-700' 
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400">
                <Bell className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-lg font-medium">No notifications found.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filteredNotifications.map(note => (
                  <div 
                    key={note.id} 
                    className={`p-6 flex items-start transition-colors group ${
                      !note.read ? 'bg-brand-50/30 hover:bg-brand-50/50' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="shrink-0 mt-1 mr-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${
                        note.type === 'critical' ? 'bg-red-50 border border-red-100' : 
                        note.type === 'warning' ? 'bg-amber-50 border border-amber-100' : 
                        'bg-brand-50 border border-brand-100'
                      }`}>
                        {getIcon(note.type)}
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className={`text-sm font-bold ${!note.read ? 'text-gray-900' : 'text-gray-700'}`}>
                          {note.title}
                        </h3>
                        <span className="text-xs font-medium text-gray-400 whitespace-nowrap ml-4">
                          {note.time}
                        </span>
                      </div>
                      <p className={`text-sm leading-relaxed ${!note.read ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                        {note.message}
                      </p>
                    </div>

                    {!note.read && (
                      <button 
                        onClick={() => handleMarkAsRead(note.id)}
                        className="shrink-0 ml-2 p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors tooltip relative"
                        title="Mark as read"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
