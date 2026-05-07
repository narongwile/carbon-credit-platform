import React, { useState } from 'react';
import { useKeycloak } from '../auth/MockKeycloak';
import { UserCircle2, Mail, Phone, Building2, Save, Activity, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';

export default function Profile() {
  const { keycloak } = useKeycloak();
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [formData, setFormData] = useState({
    firstName: keycloak.tokenParsed?.preferred_username?.split('_')[0] || 'John',
    lastName: keycloak.tokenParsed?.preferred_username?.split('_')[1] || 'Doe',
    email: `${keycloak.tokenParsed?.preferred_username}@carbonbox.local`,
    phone: '+66 123 456 789',
    department: 'Engineering'
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }, 1000);
  };

  const activities = [
    { id: 1, action: 'Exported Refrigeration Report', date: '2 hours ago', icon: Activity },
    { id: 2, action: 'Updated Sensor Thresholds', date: 'Yesterday', icon: Activity },
    { id: 3, action: 'Logged in from new IP', date: '3 days ago', icon: CheckCircle2 },
  ];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header Profile Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 shadow-sm flex flex-col md:flex-row items-center md:items-start space-y-6 md:space-y-0 md:space-x-8">
          <div className="w-32 h-32 bg-brand-100 rounded-full flex items-center justify-center border-4 border-white shadow-lg relative">
            <span className="text-4xl font-bold text-brand-600 uppercase">
              {keycloak.tokenParsed?.preferred_username?.[0]}
            </span>
            <button className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-md border border-gray-100 hover:bg-gray-50 transition-colors">
              <UserCircle2 className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          
          <div className="flex-1 text-center md:text-left">
            <h1 className="text-3xl font-extrabold text-gray-900 capitalize">
              {formData.firstName} {formData.lastName}
            </h1>
            <p className="text-brand-600 font-bold tracking-widest uppercase text-sm mt-1 mb-4">
              {keycloak.tokenParsed?.realm_access?.roles?.[0] || 'User'}
            </p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm text-gray-500 font-medium">
              <div className="flex items-center"><Mail className="w-4 h-4 mr-2" /> {formData.email}</div>
              <div className="flex items-center"><Phone className="w-4 h-4 mr-2" /> {formData.phone}</div>
              <div className="flex items-center"><Building2 className="w-4 h-4 mr-2" /> {formData.department}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Edit Profile Form */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Personal Information</h2>
              {showSuccess && (
                <span className="text-sm font-bold text-emerald-600 flex items-center bg-emerald-50 px-3 py-1 rounded-full">
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Saved Successfully
                </span>
              )}
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">First Name</label>
                  <input 
                    type="text" 
                    value={formData.firstName}
                    onChange={e => setFormData({...formData, firstName: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Last Name</label>
                  <input 
                    type="text" 
                    value={formData.lastName}
                    onChange={e => setFormData({...formData, lastName: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Email Address</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    disabled
                    className="w-full border border-gray-200 bg-gray-50 text-gray-500 rounded-lg px-4 py-2.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Phone Number</label>
                  <input 
                    type="text" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>
              
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex items-center px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg shadow-sm transition-all disabled:opacity-70"
                >
                  {isSaving ? 'Saving...' : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
                </button>
              </div>
            </form>
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Recent Activity</h2>
            </div>
            <div className="p-6">
              <div className="space-y-6">
                {activities.map((act, index) => (
                  <div key={act.id} className="flex relative">
                    {index !== activities.length - 1 && (
                      <div className="absolute top-8 bottom-[-24px] left-[15px] w-px bg-gray-200"></div>
                    )}
                    <div className="w-8 h-8 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0 z-10">
                      <act.icon className="w-4 h-4 text-brand-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-bold text-gray-900">{act.action}</p>
                      <p className="text-xs font-medium text-gray-500 mt-1">{act.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
