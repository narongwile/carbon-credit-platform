import React from 'react';
import { RefrigerationHistory, RefrigerationNode } from '../../api/mockRefrigerationData';
import { Settings } from 'lucide-react';

interface Props {
  node: RefrigerationNode;
  history: RefrigerationHistory[];
  globalThreshold: number;
  setGlobalThreshold: (val: number) => void;
}

export default function KpiCards({ node, history, globalThreshold, setGlobalThreshold }: Props) {
  // Compute basic stats from history mock data
  const maxTemp = history.reduce((max, h) => h.temperature > max ? h.temperature : max, -100);
  
  const criticalEvent = node.temperature > globalThreshold 
    ? { title: 'Temp Exceeded', status: 'Warning' } 
    : node.doorOpen 
      ? { title: 'Door Left Open', status: 'Critical' }
      : { title: 'No Events', status: 'System Normal' };

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 h-full mt-6">
      
      {/* MAX TEMP RECORDED */}
      <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent pointer-events-none" />
        <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2 text-center">Max Temp Recorded</span>
        <span className="text-3xl font-extrabold text-red-500 tabular-nums drop-shadow">{maxTemp > -100 ? maxTemp.toFixed(1) : '--'}°C</span>
        <span className="text-[10px] font-semibold text-slate-500 mt-3 text-center tracking-wider">{node.name} - Just now</span>
      </div>

      {/* MAX HEAT DURATION */}
      <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent pointer-events-none" />
        <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2 text-center leading-tight">Max Heat Duration<br/><span className="text-[9px] text-slate-500">(&gt;LIMIT)</span></span>
        <span className="text-2xl font-extrabold text-orange-400 drop-shadow mt-1">-- S</span>
        <span className="text-[10px] font-mono text-slate-600 mt-3 tracking-widest">--:--:-- --:--:--</span>
      </div>

      {/* LONGEST DOOR OPEN */}
      <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-all">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
        <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2 text-center">Longest Door Open</span>
        <span className="text-2xl font-extrabold text-blue-500 drop-shadow mt-1">-- S</span>
        <span className="text-[10px] font-mono text-slate-600 mt-3 tracking-widest">--:--:-- --:--:--</span>
      </div>

      {/* CRITICAL EVENT */}
      <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-all">
        <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2 text-center">Critical Event</span>
        <span className={`text-xl font-extrabold ${criticalEvent.status !== 'System Normal' ? 'text-red-400' : 'text-white'} text-center drop-shadow mt-1`}>
          {criticalEvent.title}
        </span>
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 mt-3">{criticalEvent.status}</span>
      </div>

      {/* GLOBAL SETTINGS */}
      <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col justify-center shadow-lg relative overflow-hidden group transition-all">
        <div className="flex items-center space-x-2 mb-4 border-b border-slate-700 pb-3">
          <span className="text-sm font-extrabold text-white tracking-wide">Global Settings</span>
        </div>
        
        <label className="block text-xs font-bold tracking-wide text-slate-300 mb-2">Max Temp Threshold (°C)</label>
        <div className="relative">
          <input 
            type="number" 
            value={globalThreshold}
            onChange={(e) => setGlobalThreshold(Number(e.target.value))}
            className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-2.5 px-3 text-yellow-500 font-bold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono shadow-inner"
          />
        </div>
        <p className="text-[10px] font-medium text-slate-500 mt-3 leading-tight tracking-wide">
          Applies to all cards immediately.
        </p>
      </div>

    </div>
  );
}
