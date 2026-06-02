'use client'

import { useState } from 'react'
import { Thermometer } from 'lucide-react'
import NodeGrid from '@/components/refrigeration/NodeGrid'
import NodeDetail from '@/components/refrigeration/NodeDetail'
import { useRefrigerationData } from '@/lib/mockRefrigerationData'

// Refrigeration Data Logger module — the cold-chain monitoring platform.
// Integrated into the unified operation-management platform as one of the
// provisionable sensor-type modules (see src/lib/platforms.ts).
export default function RefrigerationModule() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const { nodes, threshold, getHistory } = useRefrigerationData()
  const [localThreshold, setLocalThreshold] = useState(threshold)

  return (
    <div className="min-h-full text-slate-200">
      {/* Module header */}
      <header className="flex items-center justify-between px-6 py-5" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <Thermometer size={18} className="text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide">Refrigeration Data Logger</h1>
            <p className="text-xs text-slate-500">Cold-chain temperature & door monitoring</p>
          </div>
        </div>
        <div className="flex items-center text-emerald-400 text-sm font-bold tracking-wide">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-2.5 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse" />
          System Online
        </div>
      </header>

      <main className="p-6">
        {selectedNodeId ? (
          <NodeDetail
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onBack={() => setSelectedNodeId(null)}
            history={getHistory(selectedNodeId)}
            threshold={localThreshold}
            setThreshold={setLocalThreshold}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center text-sm font-medium text-slate-400 border-b border-slate-800 pb-2">
              <h2 className="text-xl font-bold text-white">Refrigeration Nodes</h2>
              <span className="animate-pulse">Updating every 5s…</span>
            </div>
            <NodeGrid nodes={nodes} threshold={localThreshold} onSelectNode={setSelectedNodeId} />
          </div>
        )}
      </main>
    </div>
  )
}
