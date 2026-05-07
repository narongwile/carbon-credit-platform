import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import RegisterSensorModal from '../components/RegisterSensorModal';
import SensorDetailsModal from '../components/SensorDetailsModal';
import { 
  Plus, Search, Filter, MoreHorizontal, 
  Wifi, WifiOff, AlertCircle, MapPin, ChevronDown,
  Eye, RefreshCw, Trash2
} from 'lucide-react';
import apiClient from '../api/client';

const Sensors = () => {
  const [sensors, setSensors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  useEffect(() => {
    const fetchSensors = async () => {
      try {
        const res = await apiClient.get('/sensors');
        setSensors(res.data.data);
      } catch (err) {
        console.error(err);
        // Fallback for demo
        setSensors([
          { id: '1', device_serial: 'RFD-SN-001', type: 'CO2', status: 'online', location_name: 'Zone A, Forest 1' },
          { id: '2', device_serial: 'RFD-SN-002', type: 'CO2', status: 'offline', location_name: 'Zone B, Forest 1' },
          { id: '3', device_serial: 'RFD-SN-003', type: 'Energy', status: 'online', location_name: 'Main Building' },
          { id: '4', device_serial: 'TGO-SN-501', type: 'CO2', status: 'online', location_name: 'Bangkok Station' },
          { id: '5', device_serial: 'RFD-SN-004', type: 'Temperature', status: 'online', location_name: 'Nursery 1' },
        ]);
      } finally {
        setLoading(false);
      }
    };
    fetchSensors();
  }, []);

  const handleRegister = async (data: any) => {
    try {
      const newSensor = { 
        ...data, 
        id: Math.random().toString(), 
        status: 'online' 
      };
      setSensors([newSensor, ...sensors]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestart = (id: string) => {
    // Optimistic restart logic
    setSensors(prev => prev.map(s => s.id === id ? { ...s, status: 'restarting' } : s));
    setOpenDropdownId(null);
    
    // Simulate node coming back online after 3 seconds
    setTimeout(() => {
      setSensors(prev => prev.map(s => s.id === id ? { ...s, status: 'online' } : s));
    }, 3000);
  };

  const handleViewDetails = (sensor: any) => {
    setSelectedSensor(sensor);
    setIsDetailsModalOpen(true);
    setOpenDropdownId(null);
  };

  const handleDelete = (id: string) => {
    // Optimistic delete
    setSensors(sensors.filter(s => s.id !== id));
    setOpenDropdownId(null);
  };

  const filteredSensors = sensors.filter(s => {
    const matchesSearch = s.device_serial.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         s.location_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'All' || s.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search serial or location..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all shadow-sm dark:text-white"
          />
        </div>
        <div className="flex space-x-3 w-full md:w-auto">
          <div className="relative">
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 bg-white dark:bg-gray-900 px-4 py-2 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm dark:text-white"
            >
              <Filter className="w-4 h-4" />
              <span>{filterType === 'All' ? 'Filter' : filterType}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            
            {showFilters && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-xl z-10 py-2 animate-in fade-in slide-in-from-top-2">
                {['All', 'CO2', 'Energy', 'Temperature', 'Humidity'].map(type => (
                  <button
                    key={type}
                    onClick={() => { setFilterType(type); setShowFilters(false); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${filterType === type ? 'text-brand-600 dark:text-brand-400 font-bold' : 'text-gray-600 dark:text-gray-400'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn-primary flex items-center space-x-2 shadow-md flex-1 md:flex-none justify-center"
          >
            <Plus className="w-4 h-4" />
            <span>Register Sensor</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto min-h-[350px]">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Device Serial</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Location</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Sync</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filteredSensors.length > 0 ? filteredSensors.map((sensor, index) => (
                <tr key={sensor.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                  <td className="px-6 py-4 font-mono text-sm font-semibold text-gray-900 dark:text-white">{sensor.device_serial}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-bold rounded-full border ${
                      sensor.type === 'CO2' ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' :
                      sensor.type === 'Energy' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' :
                      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
                    }`}>
                      {sensor.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      {sensor.status === 'online' ? (
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                      ) : sensor.status === 'restarting' ? (
                        <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                      )}
                      <span className={`text-sm font-medium ${
                        sensor.status === 'online' ? 'text-green-700 dark:text-green-500' : 
                        sensor.status === 'restarting' ? 'text-amber-600 dark:text-amber-500' : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {sensor.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    <div className="flex items-center">
                      <MapPin className="w-4 h-4 mr-1.5 text-gray-400 dark:text-gray-500" />
                      {sensor.location_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 italic">Just now</td>
                  <td className="px-6 py-4 text-right relative">
                    <button 
                      onClick={() => setOpenDropdownId(openDropdownId === sensor.id ? null : sensor.id)}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors focus:outline-none"
                    >
                      <MoreHorizontal className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-brand-600 dark:group-hover:text-brand-400" />
                    </button>
                    
                    {openDropdownId === sensor.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenDropdownId(null)}></div>
                        <div className={`absolute right-8 ${index >= filteredSensors.length - 2 ? 'bottom-10 mb-2' : 'top-10'} w-48 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-xl z-20 py-2 animate-in fade-in zoom-in-95 duration-100`}>
                          <button 
                            onClick={() => handleViewDetails(sensor)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center transition-colors"
                          >
                            <Eye className="w-4 h-4 mr-3 text-gray-400" /> View Details
                          </button>
                          <button 
                            onClick={() => handleRestart(sensor.id)}
                            disabled={sensor.status === 'restarting'}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className={`w-4 h-4 mr-3 text-gray-400 ${sensor.status === 'restarting' ? 'animate-spin' : ''}`} /> 
                            {sensor.status === 'restarting' ? 'Restarting...' : 'Restart Node'}
                          </button>
                          <div className="border-t border-gray-100 dark:border-gray-800 my-1"></div>
                          <button 
                            onClick={() => handleDelete(sensor.id)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center transition-colors"
                          >
                            <Trash2 className="w-4 h-4 mr-3 text-red-500 dark:text-red-400" /> Deregister
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                    <div className="flex flex-col items-center">
                      <AlertCircle className="w-12 h-12 mb-2 opacity-20" />
                      <span>No sensors found matching your criteria</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RegisterSensorModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onRegister={handleRegister} 
      />

      <SensorDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        sensor={selectedSensor}
      />
    </Layout>
  );
};

export default Sensors;
