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
    <div className="flex flex-col h-[calc(100vh-100px)]">
      {/* Back Header */}
      <div className="flex items-center space-x-4 mb-6">
        <button 
          onClick={onBack}
          className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-bold text-white">Monitoring: {activeNode.name}</h2>
        <span className="text-sm px-3 py-1 bg-slate-800 text-slate-300 rounded-full font-mono border border-slate-700">
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
