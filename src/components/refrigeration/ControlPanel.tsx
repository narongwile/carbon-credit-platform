import React, { useState } from 'react';
import { RefrigerationNode, RefrigerationHistory } from '../../api/mockRefrigerationData';
import { ChevronDown, Download, BarChart2 } from 'lucide-react';

interface Props {
  nodes: RefrigerationNode[];
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  history: RefrigerationHistory[];
}

export default function ControlPanel({ nodes, selectedNodeId, onSelectNode, history }: Props) {
  const formatDate = (date: Date) => date.toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return formatDate(d);
  });
  const [endDate, setEndDate] = useState(() => formatDate(new Date()));
  
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = () => {
    setIsUpdating(true);
    setTimeout(() => setIsUpdating(false), 800);
  };

  const handleExport = () => {
    if (!history || history.length === 0) {
      alert('No data to export.');
      return;
    }

    const start = new Date(startDate).getTime();
    const end = new Date(endDate).setHours(23, 59, 59, 999);

    const filteredData = history.filter(h => {
      // Mock dates format is "YYYY-MM-DD HH:mm", parseable by Date
      const time = new Date(h.date).getTime();
      return time >= start && time <= end;
    });

    if (filteredData.length === 0) {
      alert('No data found for the selected date range.');
      return;
    }

    const headers = ['Date', 'Temperature (C)', 'Door Status (1=Open 0=Closed)'];
    const csvContent = [
      headers.join(','),
      ...filteredData.map(h => `"${h.date}",${h.temperature},${h.door_status}`)
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Node_${selectedNodeId}_Report_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
            <div className="flex-1 min-w-0">
              <span className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Start</span>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-2 px-2 sm:px-3 text-slate-300 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono" 
              />
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">End</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-600 rounded-md py-2 px-2 sm:px-3 text-slate-300 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono" 
              />
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="pt-4 space-y-3">
          <button 
            onClick={handleUpdate}
            className={`w-full flex items-center justify-center space-x-2 bg-gradient-to-r ${isUpdating ? 'from-blue-800 to-blue-700 cursor-wait' : 'from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400'} text-white font-bold py-3 rounded-md transition-all shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transform hover:-translate-y-0.5 border border-blue-400/20 text-sm tracking-wide`}
          >
            <BarChart2 size={18} strokeWidth={2.5} className={isUpdating ? 'animate-pulse' : ''} />
            <span>{isUpdating ? 'Updating...' : 'Update Charts'}</span>
          </button>
          <button 
            onClick={handleExport}
            className="w-full flex items-center justify-center space-x-2 bg-[#1e293b] hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-md border border-slate-600 transition-all hover:border-slate-500 hover:shadow-lg transform hover:-translate-y-0.5 text-sm tracking-wide"
          >
            <Download size={18} strokeWidth={2.5} />
            <span>Export Report (CSV)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
