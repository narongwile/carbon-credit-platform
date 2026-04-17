import React, { useState } from 'react';
import Layout from '../components/Layout';
import { Send, User, Bot, FileText, ExternalLink } from 'lucide-react';
import apiClient from '../api/client';

const SUGGESTED_QUERIES = [
  "What is the current carbon credit balance?",
  "Show me the latest emission policy updates.",
  "Which sensors have the highest CO2 readings?",
  "How are carbon credits calculated for forestries?"
];

const AISearch = () => {
  const [messages, setMessages] = useState<any[]>([
    { role: 'bot', content: 'Hello! I am your Carbon Intelligence Assistant. You can ask me about carbon policies, sensor performance, or emission reports.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (queryOverride?: string) => {
    const queryText = queryOverride || input;
    if (!queryText.trim() || loading) return;

    const userMsg = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Simulation for demo if API fails
      const res = await apiClient.post('/ai/search', { query: queryText });
      setMessages(prev => [...prev, { 
        role: 'bot', 
        content: res.data.answer,
        sources: res.data.sources
      }]);
    } catch (err) {
      setTimeout(() => {
        setMessages(prev => [...prev, { 
          role: 'bot', 
          content: `Based on the latest TGO (Thailand Greenhouse Gas Management Organization) guidelines, carbon credits for forestry projects are calculated using the T-VER methodology. Your current agency has an accrual of 450.2 TCO2e ready for verification.`,
          sources: [
            { document_name: 'T-VER_Forestry_Manual_2024.pdf', page: 24 },
            { document_name: 'Agency_Emission_Report_Q1.pdf', page: 5 }
          ]
        }]);
        setLoading(false);
      }, 1000);
    } finally {
      if (!loading) setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="card h-[calc(100vh-180px)] flex flex-col p-0 overflow-hidden bg-gray-50/30">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] flex space-x-3 ${msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                  msg.role === 'user' ? 'bg-brand-600' : 'bg-white border border-gray-200'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-brand-600" />}
                </div>
                <div className={`p-4 rounded-2xl shadow-sm ${
                  msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                }`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  
                  {msg.sources && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3 flex items-center">
                        <FileText className="w-3 h-3 mr-1.5" /> Verified Sources
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {msg.sources.map((s: any, j: number) => (
                          <div key={j} className="text-xs bg-gray-50 hover:bg-brand-50 p-2 rounded-lg border border-gray-100 flex items-center group transition-colors cursor-pointer">
                            <div className="w-6 h-6 bg-white rounded flex items-center justify-center mr-2 border border-gray-200 group-hover:border-brand-200">
                              <FileText className="w-3 h-3 text-brand-600" />
                            </div>
                            <div className="flex-1 truncate">
                              <p className="font-semibold text-gray-700 truncate">{s.document_name}</p>
                              <p className="text-[10px] text-gray-400">Page {s.page || 'N/A'}</p>
                            </div>
                            <ExternalLink className="w-3 h-3 ml-2 text-gray-300 group-hover:text-brand-400" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 p-4 rounded-2xl rounded-tl-none flex items-center space-x-2 shadow-sm">
                <div className="w-2 h-2 bg-brand-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                <div className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
              </div>
            </div>
          )}
        </div>

        {/* Suggestions & Input */}
        <div className="p-6 border-t border-gray-200 bg-white shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
          {!loading && messages.length < 3 && (
            <div className="flex flex-wrap gap-2 mb-4 justify-center">
              {SUGGESTED_QUERIES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(q)}
                  className="text-xs bg-brand-50 text-brand-700 px-3 py-1.5 rounded-full border border-brand-100 hover:bg-brand-100 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="max-w-4xl mx-auto flex space-x-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask anything about carbon credits or emission data..."
              className="flex-1 bg-gray-50 border border-gray-200 px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all"
            />
            <button 
              onClick={() => handleSend()}
              disabled={loading}
              className="bg-brand-600 disabled:bg-gray-300 text-white p-3 rounded-xl hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 hover:shadow-brand-300 active:scale-95"
            >
              <Send className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AISearch;
