import React from 'react';
import { RefrigerationNode } from '../../api/mockRefrigerationData';
import { ChevronDown, Download, BarChart2 } from 'lucide-react';

interface Props {
  nodes: RefrigerationNode[];
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}

export default function ControlPanel({ nodes, selectedNodeId, onSelectNode }: Props) {
  return (
    <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 flex flex-col h-full shadow-lg">
      <h3 className="text-lg font-bold text-white mb-6 tracking-wide">Control Panel</h3>
      
      <div className="space-y-6">
        {/* Node Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Select Node</label>
          <div className="relative">
            <select 
              value={selectedNodeId}
              onChange={(e) => onSelectNode(e.target.value)}
              className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-3 px-4 text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-sm transition-all shadow-inner"
            >
              {nodes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.mac})
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <ChevronDown className="text-slate-400" size={16} strokeWidth={3} />
            </div>
          </div>
        </div>

        {/* Date Range dummy inputs mimicking the UI */}
        <div>
          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Date Range</label>
          <div className="flex space-x-3">
            <div className="flex-1">
              <span className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Start</span>
              <input type="text" defaultValue="24/02/2026" className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-2 px-3 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono" />
            </div>
            <div className="flex-1">
              <span className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">End</span>
              <input type="text" defaultValue="26/03/2026" className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-2 px-3 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono" />
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="pt-4 space-y-3">
          <button className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 rounded-md transition-all shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transform hover:-translate-y-0.5 border border-blue-400/20 text-sm tracking-wide">
            <BarChart2 size={18} strokeWidth={2.5} />
            <span>Update Charts</span>
          </button>
          <button className="w-full flex items-center justify-center space-x-2 bg-[#1e293b] hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-md border border-slate-600 transition-all hover:border-slate-500 hover:shadow-lg transform hover:-translate-y-0.5 text-sm tracking-wide">
            <Download size={18} strokeWidth={2.5} />
            <span>Export Report (CSV)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
