'use client'

import { useState, useEffect } from 'react'
import {
  Thermometer, DoorOpen, DoorClosed, CheckCircle, AlertTriangle, XCircle, Leaf, Snowflake,
} from 'lucide-react'
import NodeDetail from '@/components/refrigeration/NodeDetail'
import EntitlementGuard from '@/components/EntitlementGuard'
import { useRefrigerationData, type RefrigerationNode } from '@/lib/mockRefrigerationData'
import { useAppStore } from '@/lib/store'
import { useFleetLive } from '@/lib/useFleetLive'
import { api } from '@/lib/api'

// Refrigeration Overview — the CarbonBOX / RefrigerationDataLogger product's
// dashboard, mirroring the ETERNITY transformer overview (summary stats +
// status card grid + recent alarms), with a drill-down to the node monitor.

type NodeStatus = 'NORMAL' | 'WARNING' | 'CRITICAL'
const statusOf = (n: RefrigerationNode, threshold: number): NodeStatus =>
  !n.online ? 'CRITICAL' : n.doorOpen ? 'CRITICAL' : n.temperature > threshold ? 'WARNING' : 'NORMAL'

const STATUS = {
  NORMAL: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.2)' },
  WARNING: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)' },
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
}

function TempBar({ temp, threshold }: { temp: number; threshold: number }) {
  // 0..(threshold+4)°C scaled; green under threshold, amber/red above
  const pct = Math.max(4, Math.min(100, ((temp + 5) / (threshold + 9)) * 100))
  const color = temp > threshold ? '#ef4444' : temp > threshold - 2 ? '#fbbf24' : '#4ade80'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2433' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold w-12 text-right" style={{ color }}>{temp.toFixed(1)}°C</span>
    </div>
  )
}

function NodeCard({ node, threshold, onClick }: { node: RefrigerationNode; threshold: number; onClick: () => void }) {
  const st = statusOf(node, threshold)
  const sc = STATUS[st]
  return (
    <button onClick={onClick} className="text-left rounded-xl p-4 transition-all hover:-translate-y-0.5"
      style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: sc.color, boxShadow: `0 0 6px ${sc.color}` }} />
          <div>
            <div className="text-sm font-bold text-white">{node.name}</div>
            <div className="text-[10px] text-slate-500 font-mono">{node.mac}</div>
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>{st}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
        <div className="flex items-center gap-1.5">
          <Thermometer size={11} className="text-orange-400" />
          <span className="text-[11px] text-slate-500">Temp</span>
          <span className="text-[11px] text-white ml-auto font-medium">{node.temperature.toFixed(1)}°C</span>
        </div>
        <div className="flex items-center gap-1.5">
          {node.doorOpen ? <DoorOpen size={11} className="text-red-400" /> : <DoorClosed size={11} className="text-emerald-400" />}
          <span className="text-[11px] text-slate-500">Door</span>
          <span className="text-[11px] ml-auto font-medium" style={{ color: node.doorOpen ? '#ef4444' : '#94a3b8' }}>{node.doorOpen ? 'OPEN' : 'Closed'}</span>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[10px] mb-1"><span className="text-slate-500">Temperature</span><span className="text-slate-600">limit {threshold}°C</span></div>
        <TempBar temp={node.temperature} threshold={threshold} />
      </div>
    </button>
  )
}

function RefrigerationOverview() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const { nodes: mockNodes, threshold, getHistory, isConnected } = useRefrigerationData()
  const [localThreshold, setLocalThreshold] = useState(threshold)

  // Live overlay: when the backend is reachable, render the real carbonNode
  // fleet from MySQL (id/name/online + latest temp/door); else fall back to mock.
  const { selectedOrgId } = useAppStore()
  const liveFleet = useFleetLive(selectedOrgId || 'org-1', 'carbonNode')
  const [liveNodes, setLiveNodes] = useState<RefrigerationNode[] | null>(null)
  useEffect(() => {
    if (!liveFleet.loaded || liveFleet.byId.size === 0) { setLiveNodes(null); return }
    let cancelled = false
    Promise.all(Array.from(liveFleet.byId.values()).map(async (n) => {
      const lat = await api.latest(n.id)
      const temp = lat?.values.tempHigh ?? lat?.values.tempLow ?? 4
      return { id: n.id, name: n.name, mac: n.fw ?? '', temperature: Number(temp), doorOpen: (lat?.values.door ?? 0) > 0, online: n.online !== 0 } as RefrigerationNode
    })).then((arr) => { if (!cancelled) setLiveNodes(arr) })
    return () => { cancelled = true }
  }, [liveFleet.loaded, liveFleet.byId])
  const nodes = liveNodes ?? mockNodes

  const normal = nodes.filter((n) => statusOf(n, localThreshold) === 'NORMAL').length
  const warning = nodes.filter((n) => statusOf(n, localThreshold) === 'WARNING').length
  const critical = nodes.filter((n) => statusOf(n, localThreshold) === 'CRITICAL').length
  const online = nodes.filter((n) => n.online).length
  const avgTemp = nodes.length ? nodes.reduce((a, n) => a + n.temperature, 0) / nodes.length : 0
  const alarms = nodes
    .map((n) => ({ n, st: statusOf(n, localThreshold) }))
    .filter((x) => x.st !== 'NORMAL')

  if (selectedNodeId) {
    return (
      <div className="min-h-full text-slate-200">
        <main className="p-6">
          <NodeDetail
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onBack={() => setSelectedNodeId(null)}
            history={getHistory(selectedNodeId)}
            threshold={localThreshold}
            setThreshold={setLocalThreshold}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      {/* Header (mirrors Transformer Overview) */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Snowflake size={18} className="text-green-400" /> Refrigeration Overview</h1>
          <p className="text-sm text-slate-500">All cold-chain refrigeration nodes in your organization · CarbonBOX</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs"><CheckCircle size={12} className="text-green-400" /><span className="text-slate-400">{normal} Normal</span></div>
          {warning > 0 && <div className="flex items-center gap-1.5 text-xs"><AlertTriangle size={12} className="text-amber-400" /><span className="text-slate-400">{warning} Warning</span></div>}
          {critical > 0 && <div className="flex items-center gap-1.5 text-xs"><XCircle size={12} className="text-red-400" /><span className="text-red-400 font-semibold">{critical} Critical</span></div>}
          <div className="h-4 w-px bg-slate-700" />
          <div className={`flex items-center gap-1.5 text-xs font-bold ${isConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {isConnected ? 'MQTT Live' : 'Simulated'}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Nodes', value: nodes.length, color: '#22c55e' },
          { label: 'Online', value: online, color: '#4ade80' },
          { label: 'Active Alarms', value: alarms.length, color: alarms.length > 0 ? '#ef4444' : '#4ade80' },
          { label: 'Avg Temperature', value: `${avgTemp.toFixed(1)}°C`, color: '#06b6d4' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="text-xs text-slate-500 mb-1">{s.label}</div>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Node grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} threshold={localThreshold} onClick={() => setSelectedNodeId(n.id)} />
        ))}
      </div>

      {/* Recent alarms (mirrors Transformer Overview) */}
      {alarms.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-red-400" />
            <h3 className="text-sm font-semibold text-white">Active Refrigeration Alarms</h3>
          </div>
          <div className="space-y-2">
            {alarms.slice(0, 5).map(({ n, st }) => {
              const sc = STATUS[st]
              const msg = !n.online ? 'Node offline — connection lost'
                : n.doorOpen ? 'Door left open — cooling loss risk'
                : `Temperature above limit (${n.temperature.toFixed(1)}°C > ${localThreshold}°C)`
              return (
                <button key={n.id} onClick={() => setSelectedNodeId(n.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left"
                  style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc.color }} />
                  <span className="flex-1 text-sm text-slate-300 truncate">{msg}</span>
                  <span className="text-xs text-slate-500">{n.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: sc.color, background: sc.bg }}>{st}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function RefrigerationPage() {
  return (
    <EntitlementGuard platform="refrigerationDataLogger" name="Refrigeration">
      <RefrigerationOverview />
    </EntitlementGuard>
  )
}
