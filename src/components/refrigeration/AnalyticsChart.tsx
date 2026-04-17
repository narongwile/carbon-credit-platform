import React from 'react';
import { RefrigerationHistory } from '../../api/mockRefrigerationData';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface Props {
  data: RefrigerationHistory[];
  nodeName: string;
}

export default function AnalyticsChart({ data, nodeName }: Props) {
  // Use a subset of data for rendering to avoid SVG overload and simulate the timeframe
  const renderData = data.slice(0, 100).reverse(); // show the most recent 100 points

  return (
    <div className="bg-[#1e293b] rounded-xl border border-slate-700 p-6 shadow-lg flex-1 flex flex-col relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/3" />
      
      <div className="flex justify-between items-center mb-6 z-10">
        <h3 className="text-lg font-bold text-white tracking-wide">Performance Analytics</h3>
        <span className="text-xs font-bold text-slate-400 bg-slate-800 px-3 py-1 rounded-full uppercase tracking-widest border border-slate-700">Viewing {nodeName}</span>
      </div>

      <div className="flex-1 grid grid-rows-[2fr_1fr] gap-6 z-10 w-full min-h-[400px]">
        
        {/* Temperature Line Chart */}
        <div className="relative border-b border-slate-700/50 pb-4">
          <h4 className="absolute top-0 right-4 text-[10px] font-bold tracking-widest uppercase text-slate-400 z-10 bg-[#1e293b] px-2">Temperature History (°C)</h4>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={renderData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
              <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickFormatter={(val) => val.split(' ')[0]} minTickGap={30} tickMargin={12} height={30} />
              <YAxis stroke="#64748b" fontSize={11} domain={['dataMin - 0.5', 'dataMax + 0.5']} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                itemStyle={{ color: '#60a5fa', fontWeight: 'bold' }}
                cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '5 5' }}
              />
              <Line type="monotone" dataKey="temperature" stroke="#3b82f6" strokeWidth={3} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Door Status Area Chart */}
        <div className="relative pt-2">
          <h4 className="absolute top-0 right-4 text-[10px] font-bold tracking-widest uppercase text-slate-400 z-10 bg-[#1e293b] px-2">Door Status (1=Open, 0=Closed)</h4>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={renderData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
              <XAxis 
                dataKey="date" 
                stroke="#64748b" 
                fontSize={10} 
                angle={-45} 
                textAnchor="end"
                tickFormatter={(val) => val.substring(0, 16)} 
                minTickGap={20}
                height={60}
                tickMargin={12}
              />
              <YAxis stroke="#64748b" fontSize={11} domain={[0, 1.2]} ticks={[0, 1]} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                itemStyle={{ color: '#ef4444', fontWeight: 'bold' }}
                cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '5 5' }}
              />
              <Area type="stepAfter" dataKey="door_status" stroke="#ef4444" strokeWidth={2} fill="#ef4444" fillOpacity={0.8} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}
