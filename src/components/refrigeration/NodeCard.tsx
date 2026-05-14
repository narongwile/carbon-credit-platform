import React from 'react';
import { RefrigerationNode } from '../../api/mockRefrigerationData';
import { Wifi, WifiOff, DoorOpen, DoorClosed, BarChart2 } from 'lucide-react';

interface Props {
  node: RefrigerationNode;
  threshold: number;
  onClick: (id: string) => void;
}

export default function NodeCard({ node, threshold, onClick }: Props) {
  const isWarning = node.temperature > threshold;
  const isCritical = node.doorOpen;
  const isOffline = !node.online;

  const borderColor = isOffline
    ? 'border-slate-800'
    : isCritical
      ? 'border-red-500'
      : isWarning
        ? 'border-[#eab308]'
        : 'border-slate-700 hover:border-slate-600';

  const shadowGlow = isOffline
    ? 'shadow-none opacity-60 grayscale-[0.3]'
    : isCritical
      ? 'shadow-[0_0_20px_rgba(239,68,68,0.2)]'
      : isWarning
        ? 'shadow-[0_0_20px_rgba(234,179,8,0.2)]'
        : 'shadow-lg hover:shadow-2xl';

  const tempColor = isOffline ? 'text-slate-600' : isWarning ? 'text-[#eab308]' : 'text-white';

  return (
    <div
      className={`bg-[#1e293b] rounded-xl border border-b-[3px] ${borderColor} ${shadowGlow} p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 transform ${isOffline ? 'opacity-80' : 'hover:-translate-y-1 cursor-pointer'}`}
      onClick={() => { if (!isOffline) onClick(node.id); }}
    >
      <div className="flex justify-between items-start mb-2">
        <span className={`font-mono text-[11px] tracking-widest ${isOffline ? 'text-slate-600' : 'text-slate-500'}`}>
          {node.mac}
        </span>
        {isOffline ? (
          <WifiOff size={18} className="text-slate-600" strokeWidth={2.5} />
        ) : (
          <Wifi size={18} className="text-emerald-500" strokeWidth={2.5} />
        )}
      </div>

      <div className="flex flex-col items-center justify-center py-4 flex-grow z-10">
        <div className={`text-5xl font-extrabold tracking-tight ${tempColor} tabular-nums drop-shadow-md`}>
          {isOffline ? '--.-°C' : `${node.temperature.toFixed(1)}°C`}
        </div>
        <div className={`text-xs font-medium mt-3 tracking-wider ${isOffline ? 'text-slate-600 font-bold' : 'text-slate-400'}`}>
          {isOffline ? 'DISCONNECTED' : node.name}
        </div>
      </div>

      <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-700/50 z-10">
        <div className="flex items-center text-sm font-semibold">
          <span className={`mr-2 text-xs ${isOffline ? 'text-slate-600' : 'text-slate-400'}`}>Door: </span>
          {isOffline ? (
            <span className="text-slate-600 flex items-center gap-1.5 text-xs font-medium">
              --
            </span>
          ) : node.doorOpen ? (
            <span className="text-red-500 flex items-center gap-1.5 uppercase font-bold text-xs tracking-wider">
              <DoorOpen size={16} strokeWidth={2.5} /> OPEN
            </span>
          ) : (
            <span className="text-emerald-500 flex items-center gap-1.5 text-xs font-medium">
              <DoorClosed size={16} strokeWidth={2.5} /> Closed
            </span>
          )}
        </div>

        <div className="flex space-x-2 z-20 relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Replace with your actual Grafana URL structure
              const grafanaUrl = node.id === '1'
                ? `http://203.154.158.103:3000/d/bf3iqmg9cjxfke/refri001?orgId=10&from=1778735042329&to=1778736266218&timezone=Asia%2FBangkok&refresh=5m&var-node=${node.mac}`
                : `http://203.154.158.103:3000/d/cfatbwykoix34c/oie-monitoring?orgId=1&refresh=5m&timezone=Asia%2FBangkok&refresh=1m&var-node=${node.mac}`;
              window.open(grafanaUrl, '_blank');
            }}
            className="px-2 py-1.5 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30 transition-all rounded-md uppercase text-[10px] font-bold tracking-widest border border-orange-500/20 hover:border-orange-500/50 flex items-center"
            title="Open Grafana Dashboard"
          >
            <BarChart2 size={12} className="mr-1" strokeWidth={3} />
            Grafana
          </button>

          <button className="px-3 py-1.5 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 active:bg-blue-600/30 transition-all rounded-md uppercase text-[10px] font-bold tracking-widest border border-blue-500/20 hover:border-blue-500/50">
            View
          </button>
        </div>
      </div>

      {isCritical && (
        <div className="absolute inset-0 bg-red-500/5 pointer-events-none rounded-xl" />
      )}
      {isWarning && !isCritical && (
        <div className="absolute inset-0 bg-yellow-500/5 pointer-events-none rounded-xl" />
      )}
    </div>
  );
}
