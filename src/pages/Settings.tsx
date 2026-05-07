import React, { useState } from 'react';
import { Lock, Bell, Shield, Globe, Save, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';

export default function Settings() {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }, 800);
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">Account Settings</h1>
            <p className="text-sm text-gray-500 mt-1 font-medium">Manage your security preferences and notifications.</p>
          </div>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center px-5 py-2.5 bg-gray-900 hover:bg-black text-white font-bold rounded-lg shadow-sm transition-all disabled:opacity-70"
          >
            {isSaving ? 'Applying...' : <><Save className="w-4 h-4 mr-2" /> Apply Changes</>}
          </button>
        </div>

        {showSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center shadow-sm">
            <CheckCircle2 className="w-5 h-5 mr-3 text-emerald-600" />
            <span className="font-bold text-sm">Settings have been successfully updated.</span>
          </div>
        )}

        {/* Security Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center">
            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center mr-4">
              <Lock className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Security & Authentication</h2>
              <p className="text-sm text-gray-500 font-medium">Update your password and secure your account.</p>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Current Password</label>
                <input type="password" placeholder="••••••••" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
              <div className="hidden md:block"></div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">New Password</label>
                <input type="password" placeholder="••••••••" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Confirm New Password</label>
                <input type="password" placeholder="••••••••" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
            </div>
            
            <div className="pt-6 border-t border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center"><Shield className="w-4 h-4 mr-2 text-indigo-500"/> Two-Factor Authentication</h3>
                <p className="text-xs text-gray-500 mt-1 font-medium">Add an extra layer of security to your account.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Notifications Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mr-4">
              <Bell className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Notification Preferences</h2>
              <p className="text-sm text-gray-500 font-medium">Choose what you want to be notified about.</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {['Critical System Alerts', 'Weekly Analytics Reports', 'New Sensor Registrations', 'Marketing & Updates'].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <span className="text-sm font-bold text-gray-700">{item}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 2} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Regional Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center">
            <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center mr-4">
              <Globe className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Regional Settings</h2>
              <p className="text-sm text-gray-500 font-medium">Customize your timezone and display formats.</p>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Timezone</label>
              <select className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white font-medium text-gray-700">
                <option>Asia/Bangkok (GMT+7)</option>
                <option>UTC (GMT+0)</option>
                <option>America/New_York (GMT-5)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Date Format</label>
              <select className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white font-medium text-gray-700">
                <option>DD/MM/YYYY</option>
                <option>MM/DD/YYYY</option>
                <option>YYYY-MM-DD</option>
              </select>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
