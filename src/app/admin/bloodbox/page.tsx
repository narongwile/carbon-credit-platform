'use client'

import { useMemo, useState } from 'react'
import {
  Droplet, Box, Thermometer, BatteryFull, Clock, MapPin, Phone, AlertTriangle,
  Building2, Activity, ArrowUp, CheckCircle2, ChevronUp, Hospital, Truck, Signal,
} from 'lucide-react'
import clsx from 'clsx'
import {
  bloodBoxTransits, buildingFloors, getJourney, isExcursion, type BloodBoxTransit,
} from '@/lib/bloodboxData'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const RED = '#ef4444'

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 80, h = 26
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / r) * (h - 4) - 2}`).join(' ')
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export default function BloodBoxModule() {
  const [tab, setTab] = useState<'transit' | 'indoor'>('transit')
  const [selectedId, setSelectedId] = useState(bloodBoxTransits[0].id)
  const selected = bloodBoxTransits.find((t) => t.id === selectedId)!
  const sorted = useMemo(() => [...bloodBoxTransits].sort((a, b) => a.etaMin - b.etaMin), [])

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)' }}><Droplet size={18} className="text-red-400" /></div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide">BloodBOX — Cold-Chain Tracking</h1>
            <p className="text-xs text-slate-500">ระบบติดตามกล่องเลือด (ขนส่ง + ภายในอาคาร)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400" style={inset}>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> สัญญาณ IoT (BLE/Barometer): ปกติ
        </div>
      </header>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-1 p-1 rounded-lg w-fit" style={inset}>
          {([['transit', 'ขนส่ง (Transit)', Truck], ['indoor', 'ติดตามในอาคาร (Indoor)', Building2]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={clsx('flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition-all', tab === id ? 'text-white' : 'text-slate-500')} style={tab === id ? { background: '#6366f1' } : {}}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'transit' ? <TransitView sorted={sorted} selected={selected} onSelect={setSelectedId} /> : <IndoorView selected={selected} />}
    </div>
  )
}

// --- Transit Map view -------------------------------------------------------
function TransitView({ sorted, selected, onSelect }: { sorted: BloodBoxTransit[]; selected: BloodBoxTransit; onSelect: (id: string) => void }) {
  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">กำลังเดินทาง ({sorted.length})</h2>
          <span className="text-xs text-indigo-400">เรียงตาม ETA</span>
        </div>
        {sorted.map((t) => {
          const exc = isExcursion(t)
          const active = selected.id === t.id
          return (
            <button key={t.id} onClick={() => onSelect(t.id)} className="w-full text-left rounded-xl p-4 transition-all"
              style={{ background: exc ? 'rgba(239,68,68,0.06)' : '#0d1117', border: `1px solid ${active ? '#6366f1' : exc ? 'rgba(239,68,68,0.3)' : '#1e2433'}` }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-bold text-white">{t.boxCode}</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5"><MapPin size={10} /> {t.courier}</div>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-md font-bold" style={t.status === 'delayed' ? { background: 'rgba(239,68,68,0.12)', color: RED } : { background: '#0a0e1a', color: '#94a3b8', border: '1px solid #1e2433' }}>ETA: {t.etaMin} นาที</span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1.5"><Thermometer size={13} style={{ color: exc ? RED : '#60a5fa' }} /><span className="text-base font-bold" style={{ color: exc ? RED : '#fff' }}>{t.currentTempC.toFixed(1)}°C</span></div>
                <Spark data={t.tempHistory} color={exc ? RED : '#3b82f6'} />
              </div>
              {exc && <div className="mt-3 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: RED }}><AlertTriangle size={12} /> อุณหภูมิสูงเกินกำหนด (Max {t.maxTempC}°C)</div>}
            </button>
          )
        })}
      </div>

      {/* Map + detail */}
      <div className="lg:col-span-2 rounded-xl relative overflow-hidden" style={{ ...surface, minHeight: '520px', backgroundImage: 'linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
        {/* hospital center */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#0a0e1a', border: '2px solid #6366f1' }}><Hospital size={22} className="text-indigo-400" /></div>
          <span className="text-[10px] text-slate-400 mt-1">รพ.ศูนย์</span>
        </div>
        {/* vehicles */}
        {bloodBoxTransits.map((t) => {
          const exc = isExcursion(t)
          const active = selected.id === t.id
          const color = exc ? RED : active ? '#3b82f6' : '#475569'
          return (
            <button key={t.id} onClick={() => onSelect(t.id)} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${t.x}%`, top: `${t.y}%` }}>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold text-white mb-1" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>{t.etaMin} นาที</span>
              <span className="relative w-10 h-10 rounded-full flex items-center justify-center" style={{ background: color }}>
                {exc && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color, opacity: 0.4 }} />}
                <Truck size={18} className="text-white relative" />
              </span>
            </button>
          )
        })}

        {/* detail card */}
        <div className="absolute left-4 right-4 bottom-4 rounded-xl p-4" style={{ background: 'rgba(13,17,23,0.95)', border: '1px solid #1e2433', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}><Box size={20} className="text-indigo-400" /></div>
              <div>
                <div className="text-base font-bold text-white">{selected.boxCode}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1"><MapPin size={10} /> {selected.courier}</span>
                  <span className="flex items-center gap-1"><Phone size={10} /> {selected.courierPhone}</span>
                  <span className="flex items-center gap-1"><BatteryFull size={10} className="text-green-400" /> แบตเตอรี่ {selected.battery}%</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500">อุณหภูมิปัจจุบัน</div>
              <div className="text-3xl font-extrabold" style={{ color: isExcursion(selected) ? RED : '#fff' }}>{selected.currentTempC.toFixed(1)}<span className="text-sm text-slate-500"> °C</span></div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid #1e2433' }}>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Signal size={11} className="text-emerald-400" /> เชื่อมต่อล่าสุด: {selected.lastConnection} ({selected.signal4g})</span>
            <button className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300">ดูประวัติอุณหภูมิแบบเต็ม →</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Indoor Tracking view ---------------------------------------------------
function IndoorView({ selected }: { selected: BloodBoxTransit }) {
  const [floor, setFloor] = useState(selected.currentFloor)
  const journey = getJourney(selected.id)
  const goUp = () => setFloor((f) => Math.min(selected.targetFloor, f + 1))

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Cross-section */}
      <div className="rounded-xl p-5 flex flex-col" style={surface}>
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-5"><Activity size={16} className="text-indigo-400" /> ภาพตัดขวางอาคาร (Cross-section)</h2>
        <div className="flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
          {buildingFloors.map((fl) => {
            const here = fl.number === floor
            return (
              <div key={fl.number} className="grid grid-cols-[64px_1fr] items-stretch" style={{ borderBottom: fl.number > 1 ? '1px solid #1e2433' : 'none', minHeight: '74px' }}>
                <div className="flex items-center justify-center text-sm font-bold text-slate-400" style={{ background: '#0a0e1a', borderRight: '1px solid #1e2433' }}>{fl.number}F</div>
                <div className="relative flex items-center px-4">
                  {fl.number === 5 && <Droplet size={14} className="text-red-400 mr-2" />}
                  {fl.number === 1 && <Box size={14} className="text-amber-700 mr-2" />}
                  <span className="text-xs text-slate-500 truncate">{fl.label}</span>
                  {/* elevator shaft */}
                  <div className="absolute left-1/2 -translate-x-1/2 inset-y-0 w-14 flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.04)', borderLeft: '1px dashed #1e2433', borderRight: '1px dashed #1e2433' }}>
                    {here && (
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-all" style={{ background: '#3b82f6', boxShadow: '0 0 16px rgba(59,130,246,0.6)' }}>
                        <Box size={18} className="text-white" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button onClick={goUp} disabled={floor >= selected.targetFloor}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
          <ChevronUp size={16} /> จำลองการถือกล่องขึ้นลิฟต์
        </button>
      </div>

      {/* Status + timeline */}
      <div className="space-y-5">
        <div className="rounded-xl p-5" style={surface}>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded text-indigo-300" style={{ background: 'rgba(99,102,241,0.12)' }}>ID: {selected.boxCode}</span>
          <h3 className="text-lg font-bold text-white mt-2">ถึงหน้าคลังเลือด ชั้น {selected.targetFloor} (รอสแกนรับเข้า)</h3>
          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={11} /> พิกัดความสูงปัจจุบัน: ชั้น {floor}</p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl p-4 flex items-center gap-3" style={inset}>
              <Thermometer size={18} style={{ color: isExcursion(selected) ? RED : '#60a5fa' }} />
              <div><div className="text-[10px] text-slate-500">อุณหภูมิ</div><div className="text-lg font-bold text-white">{selected.currentTempC.toFixed(1)}°C</div></div>
            </div>
            <div className="rounded-xl p-4 flex items-center gap-3" style={inset}>
              <BatteryFull size={18} className="text-green-400" />
              <div><div className="text-[10px] text-slate-500">แบตเตอรี่</div><div className="text-lg font-bold text-white">{selected.battery}%</div></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4"><Clock size={15} className="text-indigo-400" /> ไทม์ไลน์การเข้าอาคาร</h3>
          <div className="relative pl-7">
            <div className="absolute left-[10px] top-1 bottom-1 w-px" style={{ background: '#1e2433' }} />
            {journey.map((e) => (
              <div key={e.id} className="relative mb-4 last:mb-0">
                <span className="absolute -left-7 top-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={e.done ? { background: '#22c55e' } : { background: '#3b82f6' }}>
                  {e.done ? <CheckCircle2 size={12} className="text-white" /> : <ArrowUp size={12} className="text-white" />}
                </span>
                <div className="rounded-lg p-3" style={{ background: e.done ? '#0a0e1a' : 'rgba(59,130,246,0.08)', border: `1px solid ${e.done ? '#1e2433' : 'rgba(59,130,246,0.3)'}` }}>
                  <div className="text-sm font-semibold text-white">{e.label}</div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <span>{e.time}</span>
                    <span className="px-1.5 py-0.5 rounded" style={{ background: '#0d1117', color: '#94a3b8' }}>{e.signal}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
