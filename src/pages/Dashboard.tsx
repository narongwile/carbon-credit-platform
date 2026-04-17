import React from 'react';
import Layout from '../components/Layout';
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Leaf, AlertTriangle, CheckCircle } from 'lucide-react';

const data = [
  { name: 'Jan', emissions: 4000, credits: 2400 },
  { name: 'Feb', emissions: 3000, credits: 1398 },
  { name: 'Mar', emissions: 2000, credits: 9800 },
  { name: 'Apr', emissions: 2780, credits: 3908 },
  { name: 'May', emissions: 1890, credits: 4800 },
  { name: 'Jun', emissions: 2390, credits: 3800 },
  { name: 'Jul', emissions: 3490, credits: 4300 },
];

const StatCard = ({ title, value, change, isPositive, icon: Icon }: any) => (
  <div className="card">
    <div className="flex justify-between items-start mb-4">
      <div className="p-2 bg-brand-50 rounded-lg text-brand-600">
        <Icon className="w-6 h-6" />
      </div>
      <div className={`flex items-center text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
        {change}
      </div>
    </div>
    <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
  </div>
);

const Dashboard = () => {
  return (
    <Layout>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Environmental Performance Overview</h1>
          <p className="text-gray-500 text-sm mt-1">Real-time monitoring and carbon credit accrual for this agency.</p>
        </div>
        <div className="flex items-center space-x-2 bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 shadow-sm shadow-brand-50">
          <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse"></div>
          <span className="text-xs font-bold text-brand-700 uppercase tracking-widest">Live: Agency Feed</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="Total Emissions" value="12,450 TCO2e" change="+2.5%" isPositive={false} icon={TrendingDown} />
        <StatCard title="Carbon Credits" value="450.2" change="+12.3%" isPositive={true} icon={Leaf} />
        <StatCard title="Active Sensors" value="84" change="98% Uptime" isPositive={true} icon={CheckCircle} />
        <StatCard title="Active Alerts" value="3" change="2 Critical" isPositive={false} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Emission Trend */}
        <div className="card h-[400px]">
          <h3 className="font-bold text-gray-900 mb-6">Carbon Emission Trend (Scope 1 & 2)</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorEmissions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Area type="monotone" dataKey="emissions" stroke="#10b981" fillOpacity={1} fill="url(#colorEmissions)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Credit Balance */}
        <div className="card h-[400px]">
          <h3 className="font-bold text-gray-900 mb-6">Carbon Credit Issuance History</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="credits" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
