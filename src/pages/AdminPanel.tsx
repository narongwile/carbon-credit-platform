import React, { useState } from 'react';
import Layout from '../components/Layout';
import { useKeycloak } from '../auth/MockKeycloak';
import { Shield, UserPlus, MoreVertical, Search, Edit2, Ban, CheckCircle, RefreshCcw } from 'lucide-react';

export default function AdminPanel() {
  const { keycloak } = useKeycloak();
  const isAdmin = keycloak.tokenParsed?.realm_access?.roles?.includes('admin');

  const [users, setUsers] = useState([
    { id: 1, name: 'Somchai Jaidee', username: 'admin_user', role: 'admin', agency: 'Global', status: 'Active' },
    { id: 2, name: 'Somsri M.', username: 'standard_user', role: 'user', agency: 'RFD', status: 'Active' },
    { id: 3, name: 'John Doe', username: 'auditor_01', role: 'auditor', agency: 'TGO', status: 'Active' },
    { id: 4, name: 'Jane Smith', username: 'dnp_agent', role: 'user', agency: 'DNP', status: 'Suspended' },
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('All Roles');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Form states
  const [formData, setFormData] = useState({ name: '', username: '', role: 'user', agency: 'RFD' });

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <Shield className="w-16 h-16 text-red-500 mb-4 opacity-50" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2">You do not have administrative privileges to view this page.</p>
        </div>
      </Layout>
    );
  }

  // Filter Logic
  const filteredUsers = users.filter(user => {
    const matchSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) || user.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchRole = roleFilter === 'All Roles' || user.role.toLowerCase() === roleFilter.toLowerCase();
    return matchSearch && matchRole;
  });

  const handleToggleStatus = (id: number) => {
    setUsers(users.map(u => {
      if (u.id === id) {
        return { ...u, status: u.status === 'Active' ? 'Suspended' : 'Active' };
      }
      return u;
    }));
  };

  const openAddModal = () => {
    setModalMode('add');
    setFormData({ name: '', username: '', role: 'user', agency: 'RFD' });
    setIsModalOpen(true);
  };

  const openEditModal = (user: any) => {
    setModalMode('edit');
    setSelectedUser(user);
    setFormData({ name: user.name, username: user.username, role: user.role, agency: user.agency });
    setIsModalOpen(true);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (modalMode === 'add') {
      const newUser = {
        id: Date.now(),
        ...formData,
        status: 'Active'
      };
      setUsers([...users, newUser]);
    } else if (modalMode === 'edit' && selectedUser) {
      setUsers(users.map(u => u.id === selectedUser.id ? { ...u, ...formData } : u));
    }
    setIsModalOpen(false);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center">
              <Shield className="w-6 h-6 mr-3 text-indigo-600" />
              User & Role Management
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">Manage platform access, assign roles, and configure agency boundaries.</p>
          </div>
          
          <button onClick={openAddModal} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors">
            <UserPlus className="w-4 h-4 mr-2" />
            Add New User
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
            <div className="relative w-72">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search users by name or ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>
            <div className="flex space-x-2">
              <select 
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm rounded-lg px-3 py-2 outline-none dark:text-white focus:ring-2 focus:ring-indigo-500"
              >
                <option>All Roles</option>
                <option>Admin</option>
                <option>User</option>
                <option>Auditor</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 text-xs uppercase font-bold tracking-wider border-b border-gray-100 dark:border-gray-800">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Agency</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredUsers.length > 0 ? filteredUsers.map(user => (
                  <tr key={user.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group ${user.status === 'Suspended' ? 'opacity-70 grayscale' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs mr-3 shadow-inner">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900 dark:text-white text-sm">{user.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800' :
                        user.role === 'auditor' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">{user.agency}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className={`w-2 h-2 rounded-full mr-2 ${user.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}></div>
                        <span className={`text-sm font-medium ${user.status === 'Active' ? 'text-gray-700 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}`}>{user.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(user)} className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-sm transition-colors" title="Edit User">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {user.status === 'Active' ? (
                          <button onClick={() => handleToggleStatus(user.id)} className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-sm transition-colors" title="Suspend User">
                            <Ban className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => handleToggleStatus(user.id)} className="p-1.5 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-sm transition-colors" title="Restore User">
                            <RefreshCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                      <Shield className="w-12 h-12 mb-3 opacity-20 mx-auto" />
                      <p className="text-sm font-medium">No users found matching your filters</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 font-medium">
            <span>Showing {filteredUsers.length} of {users.length} users</span>
          </div>
        </div>
      </div>

      {/* Add/Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 dark:bg-gray-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {modalMode === 'add' ? 'Add New User' : 'Edit User Profile'}
              </h3>
            </div>
            <form onSubmit={handleSaveUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Username</label>
                <input 
                  required
                  type="text" 
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value})}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  disabled={modalMode === 'edit'}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Role</label>
                  <select 
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="auditor">Auditor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Agency</label>
                  <select 
                    value={formData.agency}
                    onChange={(e) => setFormData({...formData, agency: e.target.value})}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  >
                    <option value="RFD">RFD</option>
                    <option value="TGO">TGO</option>
                    <option value="DNP">DNP</option>
                    <option value="Global">Global</option>
                  </select>
                </div>
              </div>
              <div className="flex space-x-3 pt-4 border-t border-gray-100 dark:border-gray-800 mt-6">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
