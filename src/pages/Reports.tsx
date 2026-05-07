import React, { useState } from 'react';
import Layout from '../components/Layout';
import { FileText, Download, Filter, Calendar, Building2, CheckCircle2, Trash2 } from 'lucide-react';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export default function Reports() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(1);
  const [dateRange, setDateRange] = useState('Last 30 Days');
  const [agency, setAgency] = useState('All Agencies (Global)');
  
  const [history, setHistory] = useState([
    { id: 1, name: 'RFD_Q1_Emission.pdf', date: 'Today, 09:30 AM', size: '2.4 MB' },
    { id: 2, name: 'Sensors_Log_March.csv', date: 'Yesterday, 14:15 PM', size: '15.1 MB' },
    { id: 3, name: 'TGO_Audit_2024.pdf', date: 'May 1, 2024', size: '4.8 MB' },
  ]);

  const templates = [
    { id: 1, name: 'Carbon Emission Summary', desc: 'Aggregated total CO2 equivalent emissions.', type: 'PDF' },
    { id: 2, name: 'T-VER Compliance Report', desc: 'Formatted for Thailand Greenhouse Gas Organization.', type: 'PDF' },
    { id: 3, name: 'Sensor Health & Diagnostics', desc: 'Raw data export of all connected IoT sensors.', type: 'CSV' },
  ];

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setShowSuccess(true);
      
      const template = templates.find(t => t.id === selectedTemplateId);
      const ext = template?.type.toLowerCase() || 'pdf';
      const agencyPrefix = agency === 'All Agencies (Global)' ? 'Global' : agency.split(' ')[0];
      const newReportName = `${agencyPrefix}_${template?.name.replace(/\s+/g, '_')}_${new Date().getTime()}.${ext}`;
      
      const newHistoryItem = {
        id: Date.now(),
        name: newReportName,
        date: 'Just now',
        size: `${(Math.random() * 5 + 1).toFixed(1)} MB`
      };
      
      setHistory([newHistoryItem, ...history]);

      // Generate actual file based on type
      if (ext === 'csv') {
        const csvContent = "Date,Sensor ID,Location,Type,Value,Unit,Status\n" +
          "2024-05-01 08:00,SN-001,Zone A,CO2,450,ppm,Healthy\n" +
          "2024-05-01 08:15,SN-001,Zone A,CO2,455,ppm,Healthy\n" +
          "2024-05-01 08:30,SN-002,Zone B,CO2,500,ppm,Warning\n" +
          "2024-05-01 08:45,SN-003,Main Bldg,Energy,120,kWh,Healthy\n" +
          "2024-05-01 09:00,SN-004,Nursery 1,Temperature,28.5,C,Healthy\n";
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", newReportName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const doc = new jsPDF();
        
        // Add Header
        doc.setFontSize(20);
        doc.setTextColor(22, 163, 74); // Brand color
        doc.text("CarbonBox Platform", 14, 22);
        
        doc.setFontSize(14);
        doc.setTextColor(30, 30, 30);
        doc.text(template?.name || 'Report', 14, 32);
        
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 40);
        doc.text(`Agency: ${agency}`, 14, 46);
        doc.text(`Date Range: ${dateRange}`, 14, 52);
        
        // Add Table
        autoTable(doc, {
          startY: 60,
          head: [['Date', 'Metric', 'Value', 'Status']],
          body: [
            ['2024-05-01', 'Total CO2 Emissions', '1,240 tons', 'Verified'],
            ['2024-05-02', 'Total CO2 Emissions', '1,215 tons', 'Verified'],
            ['2024-05-03', 'Total CO2 Emissions', '1,190 tons', 'Pending'],
            ['2024-05-04', 'Total CO2 Emissions', '1,185 tons', 'Pending'],
          ],
          theme: 'striped',
          headStyles: { fillColor: [22, 163, 74] }
        });
        
        // Add Footer
        const pageCount = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.text(
            `Page ${i} of ${pageCount}`,
            doc.internal.pageSize.width / 2,
            doc.internal.pageSize.height - 10,
            { align: 'center' }
          );
        }
        
        doc.save(newReportName);
      }

      setTimeout(() => setShowSuccess(false), 5000);
    }, 2000);
  };

  const handleDeleteHistory = (id: number) => {
    setHistory(history.filter(h => h.id !== id));
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center">
              <FileText className="w-6 h-6 mr-3 text-brand-600" />
              Report Builder
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">Generate custom reports for compliance and internal review.</p>
          </div>
        </div>

        {showSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center">
              <CheckCircle2 className="w-5 h-5 mr-3 text-emerald-600 dark:text-emerald-400" />
              <span className="font-bold text-sm">Report generated successfully! Your download has started.</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration Form */}
          <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                <Filter className="w-5 h-5 mr-2 text-gray-400" /> Report Configuration
              </h2>
            </div>
            
            <div className="p-6 space-y-6 flex-1">
              {/* Template Selection */}
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Select Template</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(tpl => (
                    <div 
                      key={tpl.id} 
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`border-2 rounded-xl p-4 cursor-pointer transition-all group relative ${
                        selectedTemplateId === tpl.id 
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/10 shadow-sm' 
                          : 'border-gray-100 dark:border-gray-800 hover:border-brand-300 dark:hover:border-brand-700'
                      }`}
                    >
                      {selectedTemplateId === tpl.id && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="w-5 h-5 text-brand-600 dark:text-brand-500" />
                        </div>
                      )}
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`font-bold text-sm transition-colors ${
                          selectedTemplateId === tpl.id ? 'text-brand-700 dark:text-brand-400' : 'text-gray-900 dark:text-white group-hover:text-brand-600'
                        }`}>
                          {tpl.name}
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded shadow-sm inline-block mb-2">{tpl.type}</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium leading-relaxed pr-6">{tpl.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                {/* Date Range */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-gray-400" /> Date Range
                  </label>
                  <select 
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-brand-500 outline-none"
                  >
                    <option>Last 30 Days</option>
                    <option>This Quarter</option>
                    <option>Year to Date (YTD)</option>
                    <option>Custom Range...</option>
                  </select>
                </div>
                {/* Target Agency */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                    <Building2 className="w-4 h-4 mr-2 text-gray-400" /> Target Agency
                  </label>
                  <select 
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-brand-500 outline-none"
                  >
                    <option>All Agencies (Global)</option>
                    <option>Royal Forest Dept. (RFD)</option>
                    <option>Greenhouse Gas Org. (TGO)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end">
              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className="flex items-center px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg shadow-sm transition-all disabled:opacity-70 disabled:cursor-wait"
              >
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Generate Report</>
                )}
              </button>
            </div>
          </div>

          {/* Recent Reports History */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col h-[600px]">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center justify-between">
                <span>Recent Exports</span>
                <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-1 rounded-md">{history.length}</span>
              </h2>
            </div>
            <div className="p-0 flex-1 overflow-y-auto">
              {history.length > 0 ? history.map((file) => (
                <div key={file.id} className="p-4 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors flex items-center justify-between group">
                  <div className="flex items-center overflow-hidden cursor-pointer" onClick={() => alert('Simulating downloading: ' + file.name)}>
                    <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0 mr-3 border border-brand-100 dark:border-brand-800">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{file.name}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-1">{file.date} • {file.size}</p>
                    </div>
                  </div>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => alert('Simulating downloading: ' + file.name)} className="p-1.5 text-gray-400 hover:text-brand-600 transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteHistory(file.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
                  <FileText className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm font-medium">No recent exports found</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
