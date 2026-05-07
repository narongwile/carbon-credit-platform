import React, { useState } from 'react';
import { X, Cpu, MapPin, Tag, Shield, CheckCircle2, Copy, Terminal, Key } from 'lucide-react';

interface RegisterSensorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (data: any) => void;
}

const RegisterSensorModal: React.FC<RegisterSensorModalProps> = ({ isOpen, onClose, onRegister }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [credentials, setCredentials] = useState<{ apiKey: string, mqttTopic: string, clientId: string } | null>(null);
  
  const [formData, setFormData] = useState({
    device_serial: '',
    mac_address: '',
    type: 'CO2',
    location_name: '',
    metadata: '{}'
  });

  if (!isOpen) return null;

  const resetStateAndClose = () => {
    setStep(1);
    setCredentials(null);
    setFormData({ device_serial: '', mac_address: '', type: 'CO2', location_name: '', metadata: '{}' });
    onClose();
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    
    // Simulate API call to generate credentials
    setTimeout(() => {
      const generatedApiKey = `cbx_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      const generatedTopic = `telemetry/${formData.type.toLowerCase()}/${formData.mac_address.replace(/:/g, '').toLowerCase() || 'unknown'}`;
      const generatedClientId = `node_${formData.device_serial}`;
      
      setCredentials({
        apiKey: generatedApiKey,
        mqttTopic: generatedTopic,
        clientId: generatedClientId
      });
      setIsGenerating(false);
      setStep(2);
    }, 1500);
  };

  const handleFinish = () => {
    onRegister(formData);
    resetStateAndClose();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    // In a real app, you might show a toast here
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-gray-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
        
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
            {step === 1 ? (
              <><Cpu className="w-5 h-5 mr-2 text-brand-600" /> Register New Sensor</>
            ) : (
              <><CheckCircle2 className="w-5 h-5 mr-2 text-emerald-500" /> Registration Successful</>
            )}
          </h3>
          <button onClick={resetStateAndClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors focus:outline-none">
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {step === 1 ? (
          <form onSubmit={handleGenerate} className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center">
                  <Tag className="w-4 h-4 mr-1 text-gray-400" /> Device Serial
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. SN-RFD-001"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all font-mono text-sm dark:text-white"
                  value={formData.device_serial}
                  onChange={(e) => setFormData({ ...formData, device_serial: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center">
                  <Cpu className="w-4 h-4 mr-1 text-gray-400" /> MAC Address
                </label>
                <input
                  required
                  type="text"
                  placeholder="00:1B:44:11:3A:B7"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all font-mono text-sm dark:text-white uppercase"
                  value={formData.mac_address}
                  onChange={(e) => setFormData({ ...formData, mac_address: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Sensor Type</label>
                <select
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
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
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center">
                  <MapPin className="w-4 h-4 mr-1 text-gray-400" /> Location
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Zone A (North)"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
                  value={formData.location_name}
                  onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center">
                <Shield className="w-4 h-4 mr-1 text-gray-400" /> Metadata (JSON)
              </label>
              <textarea
                className="w-full h-20 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none transition-all font-mono text-xs dark:text-white"
                placeholder='{ "firmware": "v1.2", "calibration": "2024-05-01" }'
                value={formData.metadata}
                onChange={(e) => setFormData({ ...formData, metadata: e.target.value })}
              ></textarea>
            </div>

            <div className="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={resetStateAndClose}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGenerating}
                className="flex-1 btn-primary flex justify-center items-center disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <span className="flex items-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div> Generating...</span>
                ) : (
                  "Generate Credentials"
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-6">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center">
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-400">
                Sensor successfully provisioned.
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
                Please copy these credentials to your physical device. They will not be shown again.
              </p>
            </div>

            <div className="space-y-4">
              {/* MQTT Topic */}
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 flex items-center uppercase tracking-wider">
                  <Terminal className="w-3 h-3 mr-1" /> MQTT Topic
                </label>
                <div className="flex">
                  <div className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-l-lg px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200 overflow-x-auto border-r-0">
                    {credentials?.mqttTopic}
                  </div>
                  <button 
                    onClick={() => handleCopy(credentials?.mqttTopic || '')}
                    className="px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-r-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
              </div>

              {/* Client ID */}
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 flex items-center uppercase tracking-wider">
                  <Tag className="w-3 h-3 mr-1" /> Client ID
                </label>
                <div className="flex">
                  <div className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-l-lg px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200 overflow-x-auto border-r-0">
                    {credentials?.clientId}
                  </div>
                  <button 
                    onClick={() => handleCopy(credentials?.clientId || '')}
                    className="px-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-r-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 flex items-center uppercase tracking-wider">
                  <Key className="w-3 h-3 mr-1" /> API Key (Secret)
                </label>
                <div className="flex">
                  <div className="flex-1 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-l-lg px-3 py-2 font-mono text-xs text-red-800 dark:text-red-400 overflow-x-auto border-r-0">
                    {credentials?.apiKey}
                  </div>
                  <button 
                    onClick={() => handleCopy(credentials?.apiKey || '')}
                    className="px-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-900/30 rounded-r-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors focus:outline-none"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={handleFinish}
              className="w-full btn-primary font-bold py-2.5 mt-2"
            >
              I have saved these credentials (Done)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisterSensorModal;
