import React from 'react';
import { RefrigerationNode } from '../../api/mockRefrigerationData';
import { Wifi, DoorOpen, DoorClosed } from 'lucide-react';

interface Props {
  node: RefrigerationNode;
  threshold: number;
  onClick: (id: string) => void;
}

export default function NodeCard({ node, threshold, onClick }: Props) {
  const isWarning = node.temperature > threshold;
  const isCritical = node.doorOpen;

  const borderColor = isCritical 
    ? 'border-red-500' 
    : isWarning 
      ? 'border-[#eab308]' 
      : 'border-slate-700 hover:border-slate-600';
      
  const shadowGlow = isCritical
    ? 'shadow-[0_0_20px_rgba(239,68,68,0.2)]'
    : isWarning
      ? 'shadow-[0_0_20px_rgba(234,179,8,0.2)]'
      : 'shadow-lg hover:shadow-2xl';
  
  const tempColor = isWarning ? 'text-[#eab308]' : 'text-white';

  return (
    <div 
      className={`bg-[#1e293b] rounded-xl border border-b-[3px] ${borderColor} ${shadowGlow} p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 transform hover:-translate-y-1 cursor-pointer`}
      onClick={() => onClick(node.id)}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="font-mono text-[11px] text-slate-500 tracking-widest">
          {node.mac}
        </span>
        <Wifi size={18} className="text-emerald-500" strokeWidth={2.5} />
      </div>

      <div className="flex flex-col items-center justify-center py-4 flex-grow z-10">
        <div className={`text-5xl font-extrabold tracking-tight ${tempColor} tabular-nums drop-shadow-md`}>
          {node.temperature.toFixed(1)}°C
        </div>
        <div className="text-xs font-medium text-slate-400 mt-3 tracking-wider">
          {node.name}
        </div>
      </div>

      <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-700/50 z-10">
        <div className="flex items-center text-sm font-semibold">
          <span className="text-slate-400 mr-2 text-xs">Door: </span>
          {node.doorOpen ? (
            <span className="text-red-500 flex items-center gap-1.5 uppercase font-bold text-xs tracking-wider">
              <DoorOpen size={16} strokeWidth={2.5} /> OPEN
            </span>
          ) : (
            <span className="text-emerald-500 flex items-center gap-1.5 text-xs font-medium">
              <DoorClosed size={16} strokeWidth={2.5} /> Closed
            </span>
          )}
        </div>
        
        <button className="px-3 py-1.5 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 active:bg-blue-600/30 transition-all rounded-md uppercase text-[10px] font-bold tracking-widest border border-blue-500/20 hover:border-blue-500/50">
          View
        </button>
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
