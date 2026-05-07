import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { RefrigerationNode, RefrigerationHistory } from '../../api/mockRefrigerationData';
import ControlPanel from './ControlPanel';
import AnalyticsChart from './AnalyticsChart';
import KpiCards from './KpiCards';

interface Props {
  nodes: RefrigerationNode[];
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  onBack: () => void;
  history: RefrigerationHistory[];
  threshold: number;
  setThreshold: (val: number) => void;
}

export default function NodeDetail({ nodes, selectedNodeId, onSelectNode, onBack, history, threshold, setThreshold }: Props) {
  const activeNode = nodes.find(n => n.id === selectedNodeId);

  if (!activeNode) return null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-100px)] pb-8">
      {/* Back Header */}
      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 mb-6">
        <div className="flex items-center space-x-4">
          <button 
            onClick={onBack}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft size={24} />
          </button>
          <h2 className="text-xl sm:text-2xl font-bold text-white truncate">Monitoring: {activeNode.name}</h2>
        </div>
        <span className="text-xs sm:text-sm px-3 py-1 bg-slate-800 text-slate-300 rounded-full font-mono border border-slate-700 self-start sm:self-auto ml-12 sm:ml-0">
          {activeNode.mac}
        </span>
      </div>

      {/* Main Grid: Control Panel + Analytics Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-[400px]">
        {/* Left Col: Controls */}
        <div className="lg:col-span-1">
          <ControlPanel 
            nodes={nodes} 
            selectedNodeId={selectedNodeId} 
            onSelectNode={onSelectNode} 
            history={history}
          />
        </div>

        {/* Right Col: Charts */}
        <div className="lg:col-span-3">
          <AnalyticsChart data={history} nodeName={activeNode.name} />
        </div>
      </div>

      {/* Bottom KPI Row */}
      <KpiCards 
        node={activeNode} 
        history={history} 
        globalThreshold={threshold} 
        setGlobalThreshold={setThreshold} 
      />
    </div>
  );
}
