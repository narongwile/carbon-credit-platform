import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import NodeGrid from '../components/refrigeration/NodeGrid';
import NodeDetail from '../components/refrigeration/NodeDetail';
import { useRefrigerationData } from '../api/mockRefrigerationData';

export default function RefrigerationMonitor() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { nodes, threshold, getHistory } = useRefrigerationData();

  // Control global settings threshold locally for UI demonstration
  const [localThreshold, setLocalThreshold] = useState(threshold);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-6 py-5 bg-[#172033] border-b border-slate-800 shadow-sm relative z-50">
        <div className="flex items-center space-x-6">
          <div className="px-6 py-2.5 bg-slate-800/80 rounded border border-slate-700 uppercase tracking-widest text-sm font-bold text-slate-400 shadow-inner">
            Company Logo
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-wide pl-6 border-l-2 border-slate-700/50">
            Industrial IoT Monitor
          </h1>
        </div>
        <div className="flex items-center text-emerald-400 text-sm font-bold tracking-wide">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-2.5 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse"></span>
          System Online
        </div>
      </header>

      {/* Main Content View Switcher */}
      <main className="p-6">
        {selectedNodeId ? (
          <NodeDetail 
            nodes={nodes}
            selectedNodeId={selectedNodeId} 
            onSelectNode={setSelectedNodeId}
            onBack={() => setSelectedNodeId(null)}
            history={getHistory(selectedNodeId)}
            threshold={localThreshold}
            setThreshold={setLocalThreshold}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center text-sm font-medium text-slate-400 border-b border-slate-800 pb-2">
              <h2 className="text-xl font-bold text-white">Refrigeration Nodes</h2>
              <span className="animate-pulse">Updating every 5s...</span>
            </div>
            <NodeGrid 
              nodes={nodes} 
              threshold={localThreshold} 
              onSelectNode={setSelectedNodeId} 
            />
          </div>
        )}
      </main>
    </div>
  );
}
