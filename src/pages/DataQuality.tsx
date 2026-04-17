import React, { useState } from 'react';
import Layout from '../components/Layout';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { ShieldCheck, AlertCircle, RefreshCw, Layers, CheckCircle2, TrendingUp } from 'lucide-react';

const qualityData = [
  { Day: 'Mon', Bronze: 95, Silver: 98, Gold: 100 },
  { Day: 'Tue', Bronze: 92, Silver: 97, Gold: 100 },
  { Day: 'Wed', Bronze: 98, Silver: 99, Gold: 100 },
  { Day: 'Thu', Bronze: 88, Silver: 95, Gold: 99 },
  { Day: 'Fri', Bronze: 94, Silver: 98, Gold: 100 },
  { Day: 'Sat', Bronze: 97, Silver: 99, Gold: 100 },
  { Day: 'Sun', Bronze: 99, Silver: 100, Gold: 100 },
];

const DataQuality = () => {
  const [activeLayer, setActiveLayer] = useState('Silver');

  const layers = [
    { name: 'Bronze', status: 'Healthy', quality: '98%', records: '1.2M', icon: Layers, color: 'text-amber-600', bg: 'bg-amber-50', barColor: '#d97706' },
    { name: 'Silver', status: 'Scanning', quality: '99.5%', records: '850K', icon: ShieldCheck, color: 'text-blue-600', bg: 'bg-blue-50', barColor: '#2563eb' },
    { name: 'Gold', status: 'Healthy', quality: '100%', records: '45K', icon: CheckCircle2, color: 'text-brand-600', bg: 'bg-brand-50', barColor: '#16a34a' },
  ];

  return (
    <Layout>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {layers.map((layer) => (
          <div
            key={layer.name}
            onClick={() => setActiveLayer(layer.name)}
            className={`card group cursor-pointer border-2 transition-all ${
              activeLayer === layer.name ? 'border-brand-500 ring-4 ring-brand-50 shadow-lg' : 'border-gray-100 hover:border-gray-200'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${layer.bg} ${layer.color}`}>
                <layer.icon className="w-6 h-6" />
              </div>
              <TrendingUp className={`w-5 h-5 ${layer.color}`} />
            </div>
            <h3 className="text-xl font-bold text-gray-900">{layer.name} Layer</h3>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 font-medium">Data Health</span>
                <span className={`font-bold ${layer.status === 'Healthy' ? 'text-green-600' : 'text-blue-600'}`}>{layer.status}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 font-medium">Quality Score</span>
                <span className="font-extrabold text-gray-900">{layer.quality}</span>
              </div>
            </div>
            <div className="mt-6 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000`}
                style={{ width: layer.quality, backgroundColor: layer.barColor }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Trend Chart */}
        <div className="card lg:col-span-2 shadow-sm border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Quality Trend: {activeLayer} Layer</h3>
              <p className="text-sm text-gray-500">Validation success rate over last 7 days</p>
            </div>
            <select className="bg-gray-50 border border-gray-200 text-sm rounded-lg px-2 py-1 outline-none">
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={qualityData}>
                <defs>
                  <linearGradient id="colorQuality" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={layers.find(l => l.name === activeLayer)?.barColor} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={layers.find(l => l.name === activeLayer)?.barColor} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="Day" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} />
                <YAxis domain={[80, 100]} axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area
                  type="monotone"
                  dataKey={activeLayer}
                  stroke={layers.find(l => l.name === activeLayer)?.barColor}
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorQuality)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Validation Logs */}
        <div className="card shadow-sm border-gray-100 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Great Expectations</h3>
            <span className="bg-red-50 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-100">
              2 Alerts
            </span>
          </div>

          <div className="space-y-4 flex-1 overflow-y-auto pr-1">
            {[
              { tag: 'Silver', msg: 'Null check failed for sensor_id (34 records)', time: '10m ago', type: 'error' },
              { tag: 'Bronze', msg: 'CO2 values > 2000ppm detected in Zone A', time: '1h ago', type: 'warning' },
              { tag: 'Gold', msg: 'Daily summary verified for Agency RFD', time: '2h ago', type: 'success' },
              { tag: 'Silver', msg: 'Semantic mapping completed for Energy sensors', time: '4h ago', type: 'success' },
            ].map((log, i) => (
              <div key={i} className="flex gap-3 group cursor-pointer">
                <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  log.type === 'error' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                  log.type === 'warning' ? 'bg-amber-500' : 'bg-green-500'
                }`}></div>
                <div className="flex-1 pb-4 border-b border-gray-50 group-last:border-none">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">{log.tag} Layer</span>
                    <span className="text-[10px] text-gray-400">{log.time}</span>
                  </div>
                  <p className="text-xs font-semibold text-gray-700 leading-snug group-hover:text-brand-600 transition-colors">
                    {log.msg}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 py-2 bg-gray-50 text-gray-500 text-xs font-bold rounded-lg hover:bg-gray-100 transition-colors">
            View All Reports
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default DataQuality;
