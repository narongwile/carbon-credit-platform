import React, { useState } from 'react';
import { X, Cpu, MapPin, Tag, Shield } from 'lucide-react';

interface RegisterSensorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (data: any) => void;
}

const RegisterSensorModal: React.FC<RegisterSensorModalProps> = ({ isOpen, onClose, onRegister }) => {
  const [formData, setFormData] = useState({
    device_serial: '',
    type: 'CO2',
    location_name: '',
    metadata: '{}'
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRegister(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-xl font-bold text-gray-900 flex items-center">
            <Cpu className="w-5 h-5 mr-2 text-brand-600" /> Register New Sensor
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center">
              <Tag className="w-4 h-4 mr-1 text-gray-400" /> Device Serial Number
            </label>
            <input
              required
              type="text"
              placeholder="e.g. SN-RFD-2024-001"
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all font-mono text-sm"
              value={formData.device_serial}
              onChange={(e) => setFormData({ ...formData, device_serial: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Sensor Type</label>
              <select
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              >
                <option value="CO2">CO2 Concentration</option>
                <option value="Humidity">Humidity</option>
                <option value="Temperature">Temperature</option>
                <option value="Energy">Energy Meter</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center">
                <MapPin className="w-4 h-4 mr-1 text-gray-400" /> Location
              </label>
              <input
                required
                type="text"
                placeholder="e.g. Zone A (North)"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                value={formData.location_name}
                onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center">
              <Shield className="w-4 h-4 mr-1 text-gray-400" /> Metadata (JSON)
            </label>
            <textarea
              className="w-full h-24 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all font-mono text-xs"
              placeholder='{ "calibration_date": "2024-01-01" }'
              value={formData.metadata}
              onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
            ></textarea>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary"
            >
              Register Device
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterSensorModal;
