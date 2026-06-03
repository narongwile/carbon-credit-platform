'use client'

import { useState } from 'react'
import { Send, User, Bot, FileText } from 'lucide-react'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

const SUGGESTED = [
  'What is the current carbon credit balance?',
  'Which sensors have the highest CO2 readings?',
  'Show me the latest emission policy updates.',
  'How are carbon credits calculated for forestries?',
]

interface Msg { role: 'user' | 'bot'; content: string; sources?: { document_name: string; page: number }[] }

export default function AISearchPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'bot', content: 'Hello! I am your Carbon Intelligence Assistant. Ask me about carbon policies, sensor performance, or emission reports.' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const send = (q?: string) => {
    const text = (q ?? input).trim()
    if (!text || loading) return
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    setTimeout(() => {
      setMessages((m) => [...m, {
        role: 'bot',
        content: 'Based on the latest TGO (Thailand Greenhouse Gas Management Organization) guidelines, carbon credits for forestry projects use the T-VER methodology. Your current organization has an accrual of 450.2 TCO₂e ready for verification.',
        sources: [
          { document_name: 'T-VER_Forestry_Manual_2024.pdf', page: 24 },
          { document_name: 'Org_Emission_Report_Q1.pdf', page: 5 },
        ],
      }])
      setLoading(false)
    }, 900)
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">AI Search</h1>
        <p className="text-sm text-slate-500 mt-0.5">Carbon Intelligence assistant over your documents & telemetry</p>
      </div>

      <div className="rounded-2xl flex flex-col h-[calc(100vh-220px)]" style={surface}>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={msg.role === 'user' ? gradient : inset}>
                  {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-indigo-400" />}
                </div>
                <div className="p-4 rounded-2xl text-sm leading-relaxed" style={msg.role === 'user' ? { ...gradient, color: '#fff' } : inset}>
                  <p className="whitespace-pre-wrap text-slate-100">{msg.content}</p>
                  {msg.sources && (
                    <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid #1e2433' }}>
                      {msg.sources.map((s) => (
                        <div key={s.document_name} className="flex items-center gap-2 text-xs text-slate-400">
                          <FileText size={12} className="text-indigo-400" /> {s.document_name} <span className="text-slate-600">· p.{s.page}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {loading && <div className="flex items-center gap-2 text-slate-500 text-sm"><Bot size={16} className="text-indigo-400" /> thinking…</div>}
        </div>

        <div className="p-4" style={{ borderTop: '1px solid #1e2433' }}>
          <div className="flex flex-wrap gap-2 mb-3">
            {SUGGESTED.map((q) => (
              <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full text-slate-300 hover:text-white transition-colors" style={inset}>{q}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask the Carbon Intelligence assistant…"
              className="flex-1 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={inset} />
            <button onClick={() => send()} className="px-4 rounded-lg text-white" style={gradient}><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
