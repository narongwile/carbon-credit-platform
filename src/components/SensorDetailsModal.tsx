import React from 'react';
import { X, Activity, Battery, Wifi, Cpu, Clock, Terminal } from 'lucide-react';

interface SensorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sensor: any;
}

const SensorDetailsModal: React.FC<SensorDetailsModalProps> = ({ isOpen, onClose, sensor }) => {
  if (!isOpen || !sensor) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 dark:bg-gray-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
              <Activity className="w-5 h-5 mr-2 text-brand-600" /> Sensor Diagnostics
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">{sensor.device_serial}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors focus:outline-none">
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* Status Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center text-gray-500 dark:text-gray-400 mb-2">
                <Battery className="w-4 h-4 mr-2" /> <span className="text-xs font-bold uppercase tracking-wider">Battery</span>
              </div>
              <div className="text-lg font-black text-gray-900 dark:text-white">87%</div>
              <div className="text-[10px] text-emerald-500 font-bold mt-1">Good Condition</div>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center text-gray-500 dark:text-gray-400 mb-2">
                <Wifi className="w-4 h-4 mr-2" /> <span className="text-xs font-bold uppercase tracking-wider">Signal</span>
              </div>
              <div className="text-lg font-black text-gray-900 dark:text-white">-65 dBm</div>
              <div className="text-[10px] text-emerald-500 font-bold mt-1">Excellent</div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center text-gray-500 dark:text-gray-400 mb-2">
                <Cpu className="w-4 h-4 mr-2" /> <span className="text-xs font-bold uppercase tracking-wider">Firmware</span>
              </div>
              <div className="text-lg font-black text-gray-900 dark:text-white">v2.4.1</div>
              <div className="text-[10px] text-brand-500 font-bold mt-1">Up to date</div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center text-gray-500 dark:text-gray-400 mb-2">
                <Clock className="w-4 h-4 mr-2" /> <span className="text-xs font-bold uppercase tracking-wider">Uptime</span>
              </div>
              <div className="text-lg font-black text-gray-900 dark:text-white">45d 12h</div>
              <div className="text-[10px] text-gray-400 font-bold mt-1">Since last reboot</div>
            </div>
          </div>

          {/* Configuration & Meta */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">Device Information</h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Type</span>
                  <span className="font-bold text-gray-900 dark:text-white">{sensor.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Location</span>
                  <span className="font-bold text-gray-900 dark:text-white">{sensor.location_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Current Status</span>
                  <span className={`font-bold ${sensor.status === 'online' ? 'text-emerald-500' : sensor.status === 'restarting' ? 'text-amber-500' : 'text-gray-500'}`}>
                    {sensor.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">MAC Address</span>
                  <span className="font-mono text-gray-900 dark:text-white">00:1B:44:11:3A:B7</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-100 dark:border-gray-800 pb-2">Recent Telemetry</h4>
              <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto text-xs font-mono text-emerald-400 leading-relaxed shadow-inner">
                <div>[12:44:01] PUBLISH topic: telemetry/{sensor.type.toLowerCase()}</div>
                <div>{`{ "val": 450, "unit": "ppm", "bat": 87 }`}</div>
                <div className="text-gray-500 mt-2">------------------------</div>
                <div className="mt-2">[12:34:01] PUBLISH topic: telemetry/{sensor.type.toLowerCase()}</div>
                <div>{`{ "val": 448, "unit": "ppm", "bat": 87 }`}</div>
                <div className="text-gray-500 mt-2">------------------------</div>
                <div className="mt-2">[12:24:01] PUBLISH topic: telemetry/{sensor.type.toLowerCase()}</div>
                <div>{`{ "val": 445, "unit": "ppm", "bat": 88 }`}</div>
              </div>
            </div>
          </div>
          
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Close Dialog
          </button>
        </div>

      </div>
    </div>
  );
};

export default SensorDetailsModal;
