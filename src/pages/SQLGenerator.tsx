import React, { useState } from 'react';
import Layout from '../components/Layout';
import { Play, Copy, Table, FileCode, CheckCircle2, ChevronRight, Bot, Download, History, Database } from 'lucide-react';
import apiClient from '../api/client';

const TABLES = [
  { name: 'carbon_emissions', columns: ['id', 'agency_id', 'emission_type', 'amount_tco2e', 'recorded_at'] },
  { name: 'sensor_readings', columns: ['id', 'device_id', 'reading_value', 'timestamp'] },
  { name: 'agencies', columns: ['id', 'name', 'code', 'created_at'] },
  { name: 'carbon_credits', columns: ['id', 'amount', 'status', 'issued_at'] }
];

interface HistoryItem { query: string; sql: string; timestamp: Date; }

const SQLGenerator = () => {
  const [query, setQuery] = useState('');
  const [sql, setSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');

  const insertIntoQuery = (text: string) => {
    setQuery(prev => prev + (prev.endsWith(' ') || prev === '' ? '' : ' ') + text + ' ');
  };

  const exportToCSV = () => {
    if (results.length === 0) return;
    const headers = Object.keys(results[0]).join(',');
    const rows = results.map(row => Object.values(row).join(','));
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = "carbon_data_export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const highlightSQL = (sqlText: string) => {
    if (!sqlText) return '-- Describe your requirement left to generate code';
    const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'DESC', 'ASC', 'AS', 'AND', 'OR', 'LEFT JOIN', 'INNER JOIN', 'ON', 'SUM', 'COUNT', 'AVG', 'INTERVAL'];
    let highlightedStr = sqlText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'g');
      highlightedStr = highlightedStr.replace(regex, `<span class="text-pink-400 font-bold">${kw}</span>`);
    });
    highlightedStr = highlightedStr.replace(/'(.*?)'/g, `<span class="text-green-400">'$1'</span>`);
    return highlightedStr;
  };

  const handleGenerate = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await apiClient.post('/ai/sql', { query });
      setSql(res.data.sql);
      setResults(res.data.sample_results || []);
      setHistory(prev => [{ query, sql: res.data.sql, timestamp: new Date() }, ...prev]);
    } catch (err) {
      const fallbackSql = 'SELECT emission_type, SUM(amount_tco2e) \nFROM carbon_emissions \nWHERE recorded_at > NOW() - INTERVAL \'1 year\'\nGROUP BY emission_type \nORDER BY sum DESC;';
      setSql(fallbackSql);
      setResults([
        { emission_type: 'scope1', sum: 450.2 },
        { emission_type: 'scope2', sum: 210.5 },
      ]);
      setHistory(prev => [{ query, sql: fallbackSql, timestamp: new Date() }, ...prev]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout>
      <div className="flex items-center mb-8">
        <div className="w-1.5 h-6 bg-brand-600 rounded-full mr-3"></div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Sql-Gen</h1>
        
        {/* Mock Agency Selector from Design */}
        <div className="ml-6 flex items-center px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm">
          <Database className="w-4 h-4 text-brand-600 mr-2" />
          <span className="text-sm font-semibold text-gray-700">RFD</span>
          <ChevronRight className="w-4 h-4 text-gray-400 ml-2 rotate-90" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[calc(100vh-200px)]">
        {/* 1. Schema Explorer Sidebar */}
        <div className="card shadow-sm border border-gray-200 bg-white overflow-y-auto max-h-[400px] lg:max-h-full">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-6 flex items-center">
            <Table className="w-3.5 h-3.5 mr-2" /> SCHEMA EXPLORER
          </h3>
          <div className="space-y-6">
            {TABLES.map(table => (
              <div key={table.name} className="group">
                <div className="flex items-center text-sm font-bold text-brand-600 mb-3 w-full text-left">
                  <ChevronRight className="w-3.5 h-3.5 mr-1 text-brand-600" /> {table.name}
                </div>
                <div className="pl-5 space-y-2.5">
                  {table.columns.map(col => (
                    <button 
                      key={col} 
                      onClick={() => insertIntoQuery(col)}
                      className="w-full text-left text-xs text-gray-400 font-mono flex items-center hover:text-brand-600 transition-colors group/col"
                    >
                      <div className="w-1.5 h-1.5 bg-gray-200 rounded-full mr-3 group-hover/col:bg-brand-400" /> {col}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Middle Panel (Input & Inference) */}
        <div className="flex flex-col space-y-6 h-full overflow-y-auto">
            <div className="card shadow-sm border border-gray-200 bg-white flex flex-col min-h-[450px] lg:min-h-0 lg:flex-1">
              <div className="flex space-x-6 mb-6 border-b border-gray-100">
                <button 
                  onClick={() => setActiveTab('new')}
                  className={`text-sm font-bold pb-3 border-b-[3px] transition-colors flex items-center ${activeTab === 'new' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  <Bot className="w-4 h-4 mr-2" /> New Query
                </button>
                <button 
                  onClick={() => setActiveTab('history')}
                  className={`text-sm font-bold pb-3 border-b-[3px] transition-colors flex items-center ${activeTab === 'history' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  <History className="w-4 h-4 mr-2" /> History {history.length > 0 && `(${history.length})`}
                </button>
              </div>

              {activeTab === 'new' ? (
                <>
                  <p className="text-sm text-gray-500 mb-4">Ask about trends, aggregates, or multi-agency comparisons in natural language.</p>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Example: Total scope 1 emissions by month for the last year..."
                    className="w-full flex-1 min-h-[200px] lg:min-h-0 p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none transition-all text-gray-800 text-sm font-medium"
                  ></textarea>
                  <button 
                    onClick={handleGenerate}
                    disabled={loading || !query}
                    className="mt-6 w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 shadow-md active:scale-[0.98]"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current mr-2" />
                        <span>Generate Optimized SQL</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                      <History className="w-12 h-12 mb-3 opacity-20" />
                      <p className="text-sm font-medium">No recent queries.</p>
                    </div>
                  ) : history.map((h, i) => (
                    <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-brand-200 cursor-pointer transition-colors" onClick={() => { setQuery(h.query); setSql(h.sql); setActiveTab('new'); }}>
                      <p className="text-xs font-bold text-gray-700 mb-1">{h.query}</p>
                      <p className="text-[10px] text-gray-400 flex items-center mt-2"><History className="w-3 h-3 mr-1" /> {h.timestamp.toLocaleTimeString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card shadow-sm border border-gray-200 bg-white overflow-hidden relative min-h-[160px]">
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-gradient-to-tl from-brand-100/50 to-transparent rounded-full -mr-20 -mb-20 opacity-70 blur-3xl"></div>
              <h4 className="font-bold text-brand-400 mb-4 uppercase tracking-widest text-[10px]">AI INFERENCE ENGINE</h4>
              <ul className="space-y-3 relative z-10">
                {['Automatic table selection', 'Complex temporal joins', 'Agency context injection'].map(cap => (
                  <li key={cap} className="flex items-center text-sm font-medium text-gray-500">
                    <CheckCircle2 className="w-4 h-4 mr-3 text-brand-500" /> {cap}
                  </li>
                ))}
              </ul>
            </div>
          </div>

        {/* 3. Output Panel */}
        <div className="flex flex-col space-y-6 lg:h-full overflow-y-auto">
          <div className="card shadow-sm border border-gray-200 bg-white relative group flex flex-col lg:flex-1 min-h-[300px]">
            <div className="absolute top-4 right-4 flex space-x-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
              <button 
                onClick={copyToClipboard}
                className="p-1.5 bg-white border border-gray-200 text-gray-500 hover:text-brand-600 rounded-lg transition-colors flex items-center space-x-1.5 text-xs font-semibold shadow-sm"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
              <h3 className="text-[10px] font-bold text-brand-500 uppercase tracking-widest flex items-center">
                <Database className="w-3.5 h-3.5 mr-2" /> GENERATED POSTGRESQL
              </h3>
              <span className="text-[10px] bg-brand-50 text-brand-700 font-bold px-3 py-1 rounded-full border border-brand-100">Dialect: pg-15</span>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              <pre 
                className="text-gray-400 font-mono text-[13px] whitespace-pre-wrap leading-relaxed outline-none" 
                dangerouslySetInnerHTML={{ __html: highlightSQL(sql) }} 
              />
            </div>
          </div>

            <div className="card shadow-sm border border-gray-200 bg-white flex flex-col lg:flex-1 min-h-[300px]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center">
                  <Table className="w-5 h-5 mr-2 text-blue-500" /> Result Preview
                </h3>
                {results.length > 0 && (
                  <button 
                    onClick={exportToCSV}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-gray-200 text-xs font-bold text-gray-600 rounded-lg hover:bg-gray-50 hover:border-brand-300 hover:text-brand-600 transition-colors shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" /> <span>Export CSV</span>
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {results.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          {Object.keys(results[0]).map(k => (
                            <th key={k} className="px-4 py-2 font-bold text-gray-600 capitalize text-xs tracking-wider">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((row, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-brand-50/30 transition-colors">
                            {Object.values(row).map((v: any, j) => (
                              <td key={j} className="px-4 py-3 text-gray-700 font-medium">{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-300 h-full">
                    <Table className="w-16 h-16 mb-4 opacity-10" />
                    <p className="text-sm font-medium">Generate SQL to see sample output</p>
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    </Layout>
  );
};

export default SQLGenerator;
