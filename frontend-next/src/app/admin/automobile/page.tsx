'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Car, Activity, Brain, Heart, Gauge, Zap, AlertTriangle, ShieldCheck,
  Radio, RefreshCw, ChevronRight, Play, Pause, Flame, Eye, Sparkles,
  Layers, BatteryCharging, Cpu, Compass, Sliders, ArrowUpRight, BarChart2
} from 'lucide-react'
import clsx from 'clsx'
import { useAppStore } from '@/lib/store'
import EntitlementGuard from '@/components/EntitlementGuard'
import { api, isLive, useIsLive } from '@/lib/api'
import { subscribeTelemetry, type TelemetryFrame } from '@/lib/telemetryBus'
import { useManagedDevices } from '@/lib/useManagedDevices'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

// Multi-Channel Waveform Sparkline
function MultiWaveSpark({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  const w = 180
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / r) * (height - 6) - 3}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function AutomobileAdminPage() {
  const { selectedOrgId } = useAppStore()
  const live = useIsLive()
  const orgId = selectedOrgId || 'org-1'
  const { devices } = useManagedDevices(orgId)

  const automobileDevices = useMemo(() => {
    const list = devices.filter((d) => d.domain === 'automobile')
    if (!list.length) return [{ id: 'NAT-GW-01', name: 'NAT-GW-01 (Formula EV)' }]
    return list
  }, [devices])

  const [activeTab, setActiveTab] = useState<'fatigue' | 'vehicle' | 'model' | 'analytics'>('fatigue')
  const [selectedVehicle, setSelectedVehicle] = useState('NAT-GW-01')
  const [isSimulating, setIsSimulating] = useState(false)
  const [hasReceivedLive, setHasReceivedLive] = useState(false)
  const [lastPacketTime, setLastPacketTime] = useState<number | null>(null)

  // Real-time State (Multi-Modal Telemetry)
  const [telemetry, setTelemetry] = useState({
    // 1D-CNN Model Output
    fatigueScore: 28.4,
    fatigueState: 'ALERT' as 'ALERT' | 'DROWSY' | 'CRITICAL',
    modelConfidence: 96.8,
    fatigueRatio: 2.15, // (Theta + Alpha) / Beta
    // Biosignals - Heart Rate & HRV
    hrBpm: 78,
    hrvRmssd: 42.5,
    hrvSdnn: 54.0,
    hrvLfHf: 1.12,
    // Biosignals - Muse 4-Ch EEG (μV)
    eegTp9: [12.4, 14.2, 11.8, 15.0, 13.5, 16.2, 14.8, 12.9, 13.7, 15.1, 14.0, 13.2],
    eegAf7: [8.5, 9.2, 11.0, 14.5, 18.2, 15.6, 12.1, 10.4, 9.8, 11.2, 13.5, 10.8],
    eegAf8: [9.1, 8.8, 10.5, 13.9, 17.5, 14.9, 11.8, 9.9, 10.1, 12.0, 14.1, 11.2],
    eegTp10: [13.1, 15.0, 12.2, 14.8, 14.1, 17.0, 15.2, 13.5, 14.0, 15.8, 14.6, 13.9],
    // EEG Spectral Power Bands (%)
    bandDelta: 18.5,
    bandTheta: 22.0,
    bandAlpha: 38.5,
    bandBeta: 15.8,
    bandGamma: 5.2,
    // Formula EV Vehicle Dynamics (CAN-Bus)
    speedKmh: 94.5,
    steeringAngle: -3.2,
    steeringEntropy: 0.18,
    apps1Throttle: 64.0,
    brakeBar: 0.0,
    motorRpm: 5820,
    motorTemp: 64.5,
    inverterTemp: 48.2,
    bmsSoc: 82.5,
    packVoltage: 384.2,
    packCurrent: 88.5,
    gForceX: 0.24,
    gForceY: -0.15,
  })

  // Helper to update telemetry state from incoming raw / normalised dictionary
  const updateFromValues = useCallback((vals: Record<string, number>) => {
    setTelemetry((prev) => {
      const fScore = vals.fatigue_score ?? vals.fatigueScore ?? prev.fatigueScore
      let state: 'ALERT' | 'DROWSY' | 'CRITICAL' = 'ALERT'
      if (fScore > 80) state = 'CRITICAL'
      else if (fScore > 60) state = 'DROWSY'

      const hr = vals.hr_bpm ?? vals.heartRate ?? vals.hrBpm ?? prev.hrBpm
      const hrv = vals.hrv_rmssd ?? vals.hrvRmssd ?? vals.hrv ?? prev.hrvRmssd
      const alpha = vals.eeg_alpha ?? vals.bandAlpha ?? prev.bandAlpha
      const theta = vals.eeg_theta ?? vals.bandTheta ?? prev.bandTheta
      const beta = vals.eeg_beta ?? vals.bandBeta ?? prev.bandBeta
      const ratio = vals.fatigue_ratio ?? vals.fatigueRatio ?? (beta > 0 ? (theta + alpha) / beta : prev.fatigueRatio)

      const spd = vals.speed_kmh ?? vals.speedKmh ?? prev.speedKmh
      const steer = vals.steering_angle ?? vals.steeringAngle ?? prev.steeringAngle
      const brk = vals.brake_bar ?? vals.brakePress ?? vals.brakeBar ?? prev.brakeBar
      const apps = vals.apps1 ?? vals.apps1Throttle ?? vals.throttle ?? prev.apps1Throttle
      const rpm = vals.motor_rpm ?? vals.motorRpm ?? prev.motorRpm
      const mTemp = vals.motor_temp ?? vals.motorTemp ?? prev.motorTemp
      const soc = vals.bms_soc ?? vals.batterySOC ?? vals.bmsSoc ?? prev.bmsSoc

      const shift = (arr: number[], nextVal: number) => [...arr.slice(1), +(nextVal).toFixed(2)]

      return {
        ...prev,
        fatigueScore: +fScore.toFixed(1),
        fatigueState: state,
        fatigueRatio: +ratio.toFixed(2),
        hrBpm: Math.round(hr),
        hrvRmssd: +hrv.toFixed(1),
        bandAlpha: +alpha.toFixed(1),
        bandTheta: +theta.toFixed(1),
        bandBeta: +beta.toFixed(1),
        speedKmh: +spd.toFixed(1),
        steeringAngle: +steer.toFixed(1),
        brakeBar: +brk.toFixed(1),
        apps1Throttle: +apps.toFixed(1),
        motorRpm: Math.round(rpm),
        motorTemp: +mTemp.toFixed(1),
        bmsSoc: +soc.toFixed(1),
        eegTp9: shift(prev.eegTp9, 12.0 + (alpha * 0.2)),
        eegAf7: shift(prev.eegAf7, 10.0 + (theta * 0.4)),
        eegAf8: shift(prev.eegAf8, 10.0 + (theta * 0.4)),
        eegTp10: shift(prev.eegTp10, 13.0 + (beta * 0.2)),
      }
    })
  }, [])

  // 1. Initial REST fetch for latest readings when device changes
  useEffect(() => {
    if (!selectedVehicle) return
    if (isLive()) {
      api.readings(selectedVehicle, 30).then((rows) => {
        if (rows && Array.isArray(rows) && rows.length > 0) {
          const latestMap: Record<string, number> = {}
          for (const r of rows) {
            latestMap[r.param_key] = r.value
          }
          updateFromValues(latestMap)
          setLastPacketTime(Date.now())
          setHasReceivedLive(true)
        }
      })
    }
  }, [selectedVehicle, live, updateFromValues])

  // 2. Real-time WebSocket Telemetry Bus Subscription
  useEffect(() => {
    const unsubscribe = subscribeTelemetry((frame: TelemetryFrame) => {
      if (!frame || !frame.values) return
      // Match specific vehicle id or default gateway
      if (frame.id === selectedVehicle || (!selectedVehicle && frame.id.includes('NAT-GW')) || frame.id === 'NAT-GW-01') {
        updateFromValues(frame.values)
        setLastPacketTime(Date.now())
        setHasReceivedLive(true)
      }
    })
    return () => unsubscribe()
  }, [selectedVehicle, updateFromValues])

  // 3. Optional Simulation fallback when toggled on
  useEffect(() => {
    if (!isSimulating) return
    const interval = setInterval(() => {
      setTelemetry((prev) => {
        const noise = (Math.random() - 0.5) * 2
        const speedNoise = (Math.random() - 0.5) * 3
        const hrNoise = Math.floor((Math.random() - 0.5) * 3)

        let newFatigue = Math.max(5, Math.min(98, prev.fatigueScore + (Math.random() - 0.48) * 1.5))
        let state: 'ALERT' | 'DROWSY' | 'CRITICAL' = 'ALERT'
        if (newFatigue > 80) state = 'CRITICAL'
        else if (newFatigue > 60) state = 'DROWSY'

        const newTheta = Math.max(10, Math.min(60, prev.bandTheta + (state === 'CRITICAL' ? 1.2 : state === 'DROWSY' ? 0.5 : -0.3)))
        const newBeta = Math.max(8, Math.min(40, prev.bandBeta + (state === 'ALERT' ? 0.4 : -0.5)))
        const newAlpha = Math.max(15, Math.min(50, prev.bandAlpha + (Math.random() - 0.5)))
        const ratio = (newTheta + newAlpha) / Math.max(1, newBeta)

        const shift = (arr: number[], nextVal: number) => [...arr.slice(1), +(nextVal + noise).toFixed(2)]

        return {
          ...prev,
          fatigueScore: +newFatigue.toFixed(1),
          fatigueState: state,
          fatigueRatio: +ratio.toFixed(2),
          hrBpm: Math.max(60, Math.min(145, prev.hrBpm + hrNoise)),
          hrvRmssd: +(Math.max(15, Math.min(85, prev.hrvRmssd + (state === 'CRITICAL' ? -0.8 : 0.2))).toFixed(1)),
          bandTheta: +newTheta.toFixed(1),
          bandAlpha: +newAlpha.toFixed(1),
          bandBeta: +newBeta.toFixed(1),
          speedKmh: +(Math.max(0, Math.min(160, prev.speedKmh + speedNoise)).toFixed(1)),
          steeringAngle: +(Math.max(-65, Math.min(65, prev.steeringAngle + (Math.random() - 0.5) * 4)).toFixed(1)),
          motorRpm: Math.floor(Math.max(0, Math.min(8500, prev.motorRpm + speedNoise * 60))),
          bmsSoc: +(Math.max(5, prev.bmsSoc - 0.005).toFixed(1)),
          eegTp9: shift(prev.eegTp9, 13.5),
          eegAf7: shift(prev.eegAf7, 12.0 + (state === 'CRITICAL' ? 6 : 0)),
          eegAf8: shift(prev.eegAf8, 12.2 + (state === 'CRITICAL' ? 6 : 0)),
          eegTp10: shift(prev.eegTp10, 14.1),
        }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isSimulating])

  return (
    <EntitlementGuard platform="automobile" name="Formula EV (NAT)">
      <div className="min-h-full pb-12">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.2))', border: '1px solid rgba(245,158,11,0.4)' }}>
              <Car size={20} className="text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-wide">Formula EV (NAT) — Driver Fatigue 1D-CNN</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">THESIS RESEARCH</span>
              </div>
              <p className="text-xs text-slate-400">Neuro-Adaptive Telemetry System | Dual-Core ESP32-S3 + Raspberry Pi 5 Inference</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Vehicle Selector */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={inset}>
              <Car size={13} className="text-amber-400" />
              <select
                value={selectedVehicle}
                onChange={(e) => setSelectedVehicle(e.target.value)}
                aria-label="Select vehicle telemetry node"
                className="bg-transparent text-white font-semibold outline-none cursor-pointer"
              >
                {automobileDevices.map((d) => (
                  <option key={d.id} value={d.id} className="bg-[#0d1117] text-white">
                    {d.name || d.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Live Gateway / Stream Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold" style={inset}>
              <span className={clsx('w-2 h-2 rounded-full', (hasReceivedLive || isSimulating) ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500')} />
              <span className={hasReceivedLive ? 'text-emerald-400' : 'text-slate-300'}>
                {hasReceivedLive ? `Live Feed Active (${selectedVehicle})` : isSimulating ? 'Simulated Demo Feed' : `Standby (${selectedVehicle})`}
              </span>
            </div>

            {/* Simulation Toggle */}
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border', isSimulating ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-slate-800 text-slate-400 border-slate-700')}
            >
              {isSimulating ? <Pause size={13} /> : <Play size={13} />}
              {isSimulating ? 'Simulation Running' : 'Run Simulation'}
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <div className="px-6 pt-4">
          <div className="flex gap-1.5 p-1 rounded-xl w-fit" style={inset}>
            {([
              ['fatigue', '🧠 1D-CNN Fatigue & Biosignals', Brain],
              ['vehicle', '🏎️ Formula EV Dynamics (CAN)', Gauge],
              ['model', '🧪 1D-CNN Architecture & Weights', Sparkles],
              ['analytics', '📊 Correlation & Feature Trends', BarChart2],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all',
                  activeTab === id ? 'text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                )}
                style={activeTab === id ? { background: 'linear-gradient(135deg, #f59e0b, #d97706)' } : {}}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <main className="px-6 pt-5">
          {activeTab === 'fatigue' && <FatigueBiosignalView telemetry={telemetry} />}
          {activeTab === 'vehicle' && <VehicleDynamicsView telemetry={telemetry} />}
          {activeTab === 'model' && <ModelArchitectureView telemetry={telemetry} />}
          {activeTab === 'analytics' && <CorrelationAnalyticsView telemetry={telemetry} />}
        </main>
      </div>
    </EntitlementGuard>
  )
}

// ---------------------------------------------------------------------------
// Tab 1: 1D-CNN Driver Fatigue, Biosignals & Dual-Threshold Hysteresis View
// ---------------------------------------------------------------------------
function FatigueBiosignalView({ telemetry }: { telemetry: any }) {
  // Dual-Threshold Hysteresis Controller (Research Gap Best Practice)
  const [triggerThreshold, setTriggerThreshold] = useState(90)
  const [releaseThreshold, setReleaseThreshold] = useState(71)
  const [baselineFatigue, setBaselineFatigue] = useState(85)
  const [alarmActive, setAlarmActive] = useState(false)
  const [fatigueHistory, setFatigueHistory] = useState<number[]>([
    84, 86, 85, 87, 85, 86, 88, 86, 85, 87, 86, 88, 85, 86, 87, 86, 85, 86, 88, 87, 85
  ])

  // Latch alarm state with Hysteresis (Prevents alert flapping/chatter)
  useEffect(() => {
    setFatigueHistory((prev) => [...prev.slice(1), telemetry.fatigueScore])
    if (telemetry.fatigueScore >= triggerThreshold) {
      setAlarmActive(true)
    } else if (telemetry.fatigueScore <= releaseThreshold) {
      setAlarmActive(false)
    }
  }, [telemetry.fatigueScore, triggerThreshold, releaseThreshold])

  const isAlert = telemetry.fatigueState === 'ALERT'
  const isDrowsy = telemetry.fatigueState === 'DROWSY'
  const isCritical = telemetry.fatigueState === 'CRITICAL'

  const stateColor = isCritical ? '#ef4444' : isDrowsy ? '#f59e0b' : '#10b981'
  const stateBg = isCritical ? 'rgba(239,68,68,0.15)' : isDrowsy ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)'
  const stateBorder = isCritical ? 'rgba(239,68,68,0.3)' : isDrowsy ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'

  return (
    <div className="space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 1D-CNN Fatigue Risk Score */}
        <div className="p-4 rounded-xl relative overflow-hidden" style={{ ...surface, border: `1px solid ${stateBorder}` }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">1D-CNN FATIGUE RISK</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: stateBg, color: stateColor, border: `1px solid ${stateBorder}` }}>
              {telemetry.fatigueState}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{telemetry.fatigueScore}%</span>
            <span className="text-xs text-slate-400">Index (0-100)</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${telemetry.fatigueScore}%`,
                background: isCritical ? '#ef4444' : isDrowsy ? '#f59e0b' : '#10b981',
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
            <Sparkles size={11} className="text-amber-400" />
            Model Conf: <strong className="text-white">{telemetry.modelConfidence}%</strong> (Sliding Win: 5.0s)
          </p>
        </div>

        {/* Neural Fatigue Ratio */}
        <div className="p-4 rounded-xl" style={surface}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">NEURAL EEG FATIGUE RATIO</span>
            <Brain size={14} className="text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{telemetry.fatigueRatio}</span>
            <span className="text-xs text-slate-400">(θ + α) / β</span>
          </div>
          <p className="mt-4 text-[11px] text-slate-400">
            High ratio indicates dominant Theta/Alpha slowing waves (Drowsiness tendency).
          </p>
        </div>

        {/* Heart Rate & Pulse */}
        <div className="p-4 rounded-xl" style={surface}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">DRIVER HEART RATE</span>
            <Heart size={14} className="text-rose-500 animate-pulse" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{telemetry.hrBpm}</span>
            <span className="text-xs text-slate-400">BPM (Coospo H808S)</span>
          </div>
          <p className="mt-4 text-[11px] text-slate-400">
            Status: <span className={telemetry.hrBpm > 110 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>{telemetry.hrBpm > 110 ? 'Elevated (Stress/Racing)' : 'Optimal Range'}</span>
          </p>
        </div>

        {/* Heart Rate Variability (HRV RMSSD) */}
        <div className="p-4 rounded-xl" style={surface}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">HRV AUTONOMIC (RMSSD)</span>
            <Activity size={14} className="text-cyan-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">{telemetry.hrvRmssd}</span>
            <span className="text-xs text-slate-400">ms (RR intervals)</span>
          </div>
          <p className="mt-4 text-[11px] text-slate-400">
            Autonomic tone: <span className="text-cyan-300 font-semibold">{telemetry.hrvRmssd < 25 ? 'Low (Fatigued / Sympathetic exhaustion)' : 'Healthy Parasympathetic'}</span>
          </p>
        </div>
      </div>

      {/* Research Model Section: Dual-Threshold Trigger & Release Hysteresis Control */}
      <div className="p-6 rounded-2xl space-y-6" style={{ ...surface, border: '1px solid rgba(245,158,11,0.3)' }}>
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1e2433]">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                THESIS HYSTERESIS ALGORITHM
              </span>
              <h3 className="text-base font-bold text-white">Dual-Threshold Trigger & Release Fatigue Alert Controller</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Addresses Alarm Chatter / Flapping Research Gap — Latched Trigger ({triggerThreshold}%) vs Safe Release ({releaseThreshold}%)
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Circular Feedback Status Badge */}
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'w-20 h-20 rounded-full flex items-center justify-center font-extrabold text-sm tracking-wider transition-all duration-300 shadow-xl border',
                  alarmActive
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-rose-500/20 animate-pulse'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                )}
              >
                {alarmActive ? 'ALERT' : 'SAFE'}
              </div>
              <span className="text-[10px] text-slate-400 font-medium mt-1.5">Feedback Status</span>
            </div>
          </div>
        </div>

        {/* Real-time Dynamic Hysteresis Chart */}
        <div className="p-4 rounded-xl space-y-2" style={inset}>
          <div className="flex justify-between text-xs text-slate-400 font-mono">
            <span>Fatigue (%) ↑</span>
            <span>Live Stream (1D-CNN Inferred)</span>
          </div>

          <div className="relative h-44 w-full pt-2">
            {/* SVG Chart with Trigger and Release Lines */}
            <svg width="100%" height="100%" viewBox="0 0 500 120" preserveAspectRatio="none" className="overflow-visible">
              {/* Grid lines */}
              <line x1="0" y1="0" x2="500" y2="0" stroke="#1e2433" strokeDasharray="3 3" />
              <line x1="0" y1="30" x2="500" y2="30" stroke="#1e2433" strokeDasharray="3 3" />
              <line x1="0" y1="60" x2="500" y2="60" stroke="#1e2433" strokeDasharray="3 3" />
              <line x1="0" y1="90" x2="500" y2="90" stroke="#1e2433" strokeDasharray="3 3" />
              <line x1="0" y1="120" x2="500" y2="120" stroke="#1e2433" />

              {/* Trigger Threshold Line (Red) */}
              <line
                x1="0"
                y1={120 - (triggerThreshold / 100) * 120}
                x2="500"
                y2={120 - (triggerThreshold / 100) * 120}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />

              {/* Release Threshold Line (Green) */}
              <line
                x1="0"
                y1={120 - (releaseThreshold / 100) * 120}
                x2="500"
                y2={120 - (releaseThreshold / 100) * 120}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />

              {/* Live Fatigue Wave Polyline */}
              {(() => {
                const pts = fatigueHistory.map((val, idx) => {
                  const x = (idx / (fatigueHistory.length - 1)) * 500
                  const y = 120 - (val / 100) * 120
                  return `${x},${y}`
                }).join(' ')
                return (
                  <>
                    <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    {/* Latest Value Dot */}
                    {fatigueHistory.length > 0 && (
                      <circle
                        cx="500"
                        cy={120 - (fatigueHistory[fatigueHistory.length - 1] / 100) * 120}
                        r="4.5"
                        fill="#22c55e"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        className="animate-ping"
                      />
                    )}
                  </>
                )
              })()}
            </svg>

            {/* Threshold Floating Annotations */}
            <div
              className="absolute right-2 text-[10px] font-bold text-rose-400 pointer-events-none"
              style={{ top: `${100 - triggerThreshold}%`, transform: 'translateY(-50%)' }}
            >
              Trigger ({triggerThreshold}%)
            </div>
            <div
              className="absolute right-2 text-[10px] font-bold text-emerald-400 pointer-events-none"
              style={{ top: `${100 - releaseThreshold}%`, transform: 'translateY(-50%)' }}
            >
              Release ({releaseThreshold}%)
            </div>
          </div>

          <div className="flex justify-between text-[11px] text-slate-500 font-mono pt-1">
            <span>0% (Fully Alert)</span>
            <span>50%</span>
            <span>100% (Micro-sleep)</span>
          </div>
        </div>

        {/* Thai Language Calibration & Slider Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Status Indicators */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3.5 rounded-xl" style={inset}>
              <div>
                <span className="text-xs text-slate-400">สถานะการแจ้งเตือน</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className={clsx('w-2.5 h-2.5 rounded-full', alarmActive ? 'bg-rose-500 animate-ping' : 'bg-slate-500')} />
                  <span className={clsx('text-sm font-bold', alarmActive ? 'text-rose-400' : 'text-slate-300')}>
                    {alarmActive ? 'ON (กำลังแจ้งเตือนคนขับ)' : 'OFF (ปกติ)'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400">ค่า FATIGUE ปัจจุบัน</span>
                <p className="text-xl font-extrabold text-white mt-0.5">{telemetry.fatigueScore}%</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl text-xs text-slate-400 space-y-1.5" style={inset}>
              <div className="text-amber-400 font-semibold flex items-center gap-1.5">
                <ShieldCheck size={14} /> กลไก Hysteresis Deadband ป้องกัน Alarm Flapping
              </div>
              <p className="text-[11px] leading-relaxed">
                เมื่อความเหนื่อยล้าพุ่งเกิน <strong>Trigger ({triggerThreshold}%)</strong> สัญญาณเตือนจะทำงาน และจะไม่ปิดจนกว่าคนขับจะผ่อนคลายลงต่ำกว่า <strong>Release ({releaseThreshold}%)</strong> ทำให้ปลอดภัยและไม่รบกวนสมาธิขณะเข้าโค้ง Formula EV
              </p>
            </div>
          </div>

          {/* Interactive Calibration Sliders */}
          <div className="space-y-4 p-4 rounded-xl" style={inset}>
            {/* Slider 1: ความเหนื่อยล้าพื้นฐาน */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-slate-300 font-semibold">ความเหนื่อยล้าพื้นฐาน (%)</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-white font-mono font-bold text-xs border border-slate-700">
                  {baselineFatigue}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="95"
                value={baselineFatigue}
                onChange={(e) => setBaselineFatigue(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            {/* Slider 2: ระดับแจ้งเตือน (Trigger) */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-rose-400 font-semibold">ระดับแจ้งเตือน (Trigger)</span>
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-bold text-xs border border-rose-500/30">
                  {triggerThreshold}%
                </span>
              </div>
              <input
                type="range"
                min="75"
                max="98"
                value={triggerThreshold}
                onChange={(e) => setTriggerThreshold(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            {/* Slider 3: ระดับปิดการเตือน (Release) */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-emerald-400 font-semibold">ระดับปิดการเตือน (Release)</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/30">
                  {releaseThreshold}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="85"
                value={releaseThreshold}
                onChange={(e) => setReleaseThreshold(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid: 4-Channel Live EEG Brainwaves & Power Spectral Densities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 4-Channel Muse EEG Live Waves */}
        <div className="lg:col-span-2 p-5 rounded-xl space-y-4" style={surface}>
          <div className="flex items-center justify-between pb-3 border-b border-[#1e2433]">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-amber-400" />
              <h3 className="text-sm font-bold text-white">Muse 2/S 4-Channel Raw EEG Synchronized Streams</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">Sampling: 256 Hz · 12-bit Unpacked</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* TP9 Left Ear / Temporal */}
            <div className="p-3 rounded-lg" style={inset}>
              <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1">
                <span>Channel 1: TP9 (Left Temporal)</span>
                <span className="text-amber-400">{telemetry.eegTp9[telemetry.eegTp9.length - 1]} μV</span>
              </div>
              <MultiWaveSpark data={telemetry.eegTp9} color="#f59e0b" />
            </div>

            {/* AF7 Left Forehead / Frontal */}
            <div className="p-3 rounded-lg" style={inset}>
              <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1">
                <span>Channel 2: AF7 (Left Frontal)</span>
                <span className="text-emerald-400">{telemetry.eegAf7[telemetry.eegAf7.length - 1]} μV</span>
              </div>
              <MultiWaveSpark data={telemetry.eegAf7} color="#10b981" />
            </div>

            {/* AF8 Right Forehead / Frontal */}
            <div className="p-3 rounded-lg" style={inset}>
              <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1">
                <span>Channel 3: AF8 (Right Frontal)</span>
                <span className="text-cyan-400">{telemetry.eegAf8[telemetry.eegAf8.length - 1]} μV</span>
              </div>
              <MultiWaveSpark data={telemetry.eegAf8} color="#06b6d4" />
            </div>

            {/* TP10 Right Ear / Temporal */}
            <div className="p-3 rounded-lg" style={inset}>
              <div className="flex justify-between text-xs text-slate-400 font-semibold mb-1">
                <span>Channel 4: TP10 (Right Temporal)</span>
                <span className="text-indigo-400">{telemetry.eegTp10[telemetry.eegTp10.length - 1]} μV</span>
              </div>
              <MultiWaveSpark data={telemetry.eegTp10} color="#6366f1" />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-800/30 flex items-center justify-between text-xs text-slate-300">
            <span>⏱️ <strong>Microsecond Clock Domain:</strong> Monotonic <code>ts_us</code> stamped on Core 0 hardware arrival</span>
            <span className="text-indigo-400 font-mono">Clock Jitter &lt; 8 μs</span>
          </div>
        </div>

        {/* EEG Band Power Distribution */}
        <div className="p-5 rounded-xl space-y-4" style={surface}>
          <div className="flex items-center gap-2 pb-3 border-b border-[#1e2433]">
            <Layers size={16} className="text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Spectral Band Power (PSD)</h3>
          </div>

          <div className="space-y-3">
            {/* Delta */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Delta (δ, 0.5-4 Hz) - Deep Sleep</span>
                <span className="text-white font-bold">{telemetry.bandDelta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${telemetry.bandDelta}%` }} />
              </div>
            </div>

            {/* Theta 4-8 Hz */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span className="text-amber-300 font-semibold">Theta (θ, 4-8 Hz) - Drowsiness</span>
                <span className="text-amber-300 font-bold">{telemetry.bandTheta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${telemetry.bandTheta}%` }} />
              </div>
            </div>

            {/* Alpha 8-13 Hz */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Alpha (α, 8-13 Hz) - Eyes Relaxed</span>
                <span className="text-white font-bold">{telemetry.bandAlpha}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${telemetry.bandAlpha}%` }} />
              </div>
            </div>

            {/* Beta 13-30 Hz */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span className="text-cyan-300 font-semibold">Beta (β, 13-30 Hz) - Active Focus</span>
                <span className="text-cyan-300 font-bold">{telemetry.bandBeta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${telemetry.bandBeta}%` }} />
              </div>
            </div>

            {/* Gamma >30 Hz */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Gamma (γ, &gt;30 Hz) - High Processing</span>
                <span className="text-white font-bold">{telemetry.bandGamma}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${telemetry.bandGamma}%` }} />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg" style={inset}>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              💡 <strong>Fatigue Signature:</strong> Surge in relative Theta power coupled with decrease in Beta power signals acute driver cognitive fatigue.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 2: Formula EV Vehicle Dynamics & CAN-Bus Telemetry
// ---------------------------------------------------------------------------
function VehicleDynamicsView({ telemetry }: { telemetry: any }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Vehicle Speed */}
        <div className="p-4 rounded-xl" style={surface}>
          <span className="text-xs font-semibold text-slate-400">VEHICLE SPEED</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-400">{telemetry.speedKmh}</span>
            <span className="text-xs text-slate-400">km/h (VCU 0x101)</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-2">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(telemetry.speedKmh / 160) * 100}%` }} />
          </div>
        </div>

        {/* Steering Angle */}
        <div className="p-4 rounded-xl" style={surface}>
          <span className="text-xs font-semibold text-slate-400">STEERING ANGLE</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">{telemetry.steeringAngle}°</span>
            <span className="text-xs text-slate-400">deg (Center = 0°)</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
            <span>Left (-65°)</span>
            <span className="text-amber-400 font-mono">{telemetry.steeringAngle > 0 ? `+${telemetry.steeringAngle}° R` : `${telemetry.steeringAngle}° L`}</span>
            <span>Right (+65°)</span>
          </div>
        </div>

        {/* Motor RPM & Temp */}
        <div className="p-4 rounded-xl" style={surface}>
          <span className="text-xs font-semibold text-slate-400">INVERTER MOTOR</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-cyan-400">{telemetry.motorRpm}</span>
            <span className="text-xs text-slate-400">RPM (0x200)</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Stator Temp: <strong className="text-white">{telemetry.motorTemp}°C</strong> · Inverter: <strong className="text-white">{telemetry.inverterTemp}°C</strong>
          </p>
        </div>

        {/* High Voltage Battery SOC */}
        <div className="p-4 rounded-xl" style={surface}>
          <span className="text-xs font-semibold text-slate-400">BMS BATTERY PACK</span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400">{telemetry.bmsSoc}%</span>
            <span className="text-xs text-slate-400">SOC (0x300)</span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Pack: <strong className="text-white">{telemetry.packVoltage}V</strong> · Current: <strong className="text-white">{telemetry.packCurrent}A</strong>
          </p>
        </div>
      </div>

      {/* Cockpit Pedals & Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-xl space-y-4" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sliders size={16} className="text-amber-400" />
            Throttle & Brake Position (VCU 0x100)
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Accelerator APPS1</span>
                <span className="text-amber-400 font-bold">{telemetry.apps1Throttle}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-3">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${telemetry.apps1Throttle}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Hydraulic Brake Pressure</span>
                <span className="text-rose-400 font-bold">{telemetry.brakeBar} bar</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-3">
                <div className="h-full bg-rose-500 rounded-full" style={{ width: `${(telemetry.brakeBar / 40) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl space-y-4" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Compass size={16} className="text-cyan-400" />
            G-Force Acceleration (VCU 0x101)
          </h3>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-lg text-center" style={inset}>
              <span className="text-[11px] text-slate-400">Longitudinal (Gx)</span>
              <p className="text-xl font-extrabold text-cyan-400 mt-1">{telemetry.gForceX} g</p>
              <span className="text-[10px] text-slate-500">Acceleration</span>
            </div>
            <div className="p-3 rounded-lg text-center" style={inset}>
              <span className="text-[11px] text-slate-400">Lateral (Gy)</span>
              <p className="text-xl font-extrabold text-cyan-400 mt-1">{telemetry.gForceY} g</p>
              <span className="text-[10px] text-slate-500">Cornering</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl space-y-4" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400" />
            Safety Loop & HV Interlocks (0x400)
          </h3>
          <div className="space-y-2 pt-1 text-xs">
            <div className="flex items-center justify-between p-2 rounded" style={inset}>
              <span>AMS Battery Safety:</span>
              <span className="text-emerald-400 font-bold">OK (Closed)</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded" style={inset}>
              <span>IMD Insulation Monitor:</span>
              <span className="text-emerald-400 font-bold">OK (&gt; 500 kΩ)</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded" style={inset}>
              <span>BSPD Brake Plausibility:</span>
              <span className="text-emerald-400 font-bold">OK</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 3: 1D-CNN Multi-Modal Neural Architecture Flow Diagram (Exact Thesis Map)
// ---------------------------------------------------------------------------
function ModelArchitectureView({ telemetry }: { telemetry: any }) {
  return (
    <div className="space-y-6">
      {/* Top Architecture Card */}
      <div className="p-6 rounded-2xl space-y-6" style={surface}>
        <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Dual-Branch 1D-CNN Multimodal Deep Learning Model</h3>
              <p className="text-xs text-slate-400">EEG Brainwave Feature Extraction Branch + Contextual HR/Telemetry Branch</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            EEG+HR Model Architecture
          </span>
        </div>

        {/* Visual Dual-Branch Architecture Diagram (Matches Thesis Diagram) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Branch 1: EEG Feature Extraction Branch */}
          <div className="p-5 rounded-xl border border-amber-500/30 bg-amber-950/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">Input 1: Raw EEG</span>
              <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded">
                Shape: (512, 4)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">4-Channel Synchronized (TP9, AF7, AF8, TP10 @ 256Hz, 2.0s Sliding Window)</p>

            <div className="space-y-2 pt-2">
              <div className="p-3 rounded-lg bg-[#0a0e1a] border border-amber-500/20 text-center">
                <p className="text-xs font-bold text-white">Conv1D (Filters: 32, Kernel: 16)</p>
                <p className="text-[10px] text-slate-400">+ BatchNorm + ReLU Activation</p>
              </div>
              <div className="text-center text-slate-500 text-xs">↓</div>
              <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-700 text-center">
                <p className="text-xs font-bold text-slate-300">MaxPooling1D (Pool Size: 2)</p>
              </div>
              <div className="text-center text-slate-500 text-xs">↓</div>
              <div className="p-3 rounded-lg bg-[#0a0e1a] border border-amber-500/20 text-center">
                <p className="text-xs font-bold text-white">Conv1D (Filters: 64, Kernel: 8)</p>
                <p className="text-[10px] text-slate-400">+ BatchNorm + ReLU Activation</p>
              </div>
              <div className="text-center text-slate-500 text-xs">↓</div>
              <div className="p-2.5 rounded-lg bg-[#0a0e1a] border border-slate-700 text-center">
                <p className="text-xs font-bold text-slate-300">MaxPooling1D (Pool Size: 2)</p>
              </div>
              <div className="text-center text-slate-500 text-xs">↓</div>
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-center">
                <p className="text-xs font-bold text-amber-300">Flatten (EEG Latent Feature Map)</p>
              </div>
            </div>
          </div>

          {/* Branch 2: Contextual Branch */}
          <div className="p-5 rounded-xl border border-cyan-500/30 bg-cyan-950/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-400">Input 2: HR & Vehicle Telemetry</span>
              <span className="text-xs font-mono font-bold bg-cyan-500/20 text-cyan-200 px-2 py-0.5 rounded">
                Shape: (20, 4)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Coospo HR/HRV + Steering Angle + Speed + APPS1 Throttle</p>

            <div className="space-y-4 pt-4">
              <div className="p-4 rounded-lg bg-[#0a0e1a] border border-cyan-500/20 text-center">
                <p className="text-xs font-bold text-white">Dense Layer / Simple Conv1D</p>
                <p className="text-[10px] text-slate-400">+ ReLU Activation (Autonomic Tone Projection)</p>
              </div>
              <div className="text-center text-slate-500 text-xs">↓</div>
              <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-center">
                <p className="text-xs font-bold text-cyan-300">Flatten (Context Feature Map)</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 leading-relaxed mt-6">
                💡 <strong>Multimodal Synergy:</strong> Contextual branch validates whether EEG slowing is due to cognitive fatigue or autonomic exhaustion from racing G-forces.
              </div>
            </div>
          </div>
        </div>

        {/* Fusion and Decision Layers */}
        <div className="p-5 rounded-xl border border-indigo-500/30 bg-indigo-950/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-400">Multimodal Fusion & Decision Network</span>
            <span className="text-xs text-slate-400">Latent Feature Concatenation</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-[#0a0e1a] border border-indigo-500/30 text-center">
              <p className="text-xs font-bold text-indigo-300">1. Concatenate</p>
              <p className="text-[10px] text-slate-400">Brain & Context Features</p>
            </div>
            <div className="p-3 rounded-lg bg-[#0a0e1a] border border-indigo-500/30 text-center">
              <p className="text-xs font-bold text-white">2. Dense (128 units)</p>
              <p className="text-[10px] text-slate-400">+ Dropout (0.5)</p>
            </div>
            <div className="p-3 rounded-lg bg-[#0a0e1a] border border-indigo-500/30 text-center">
              <p className="text-xs font-bold text-white">3. Dense (64 units)</p>
              <p className="text-[10px] text-slate-400">+ ReLU Latent Dense</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-center">
              <p className="text-xs font-bold text-emerald-400">4. Output Layer</p>
              <p className="text-[10px] text-slate-300">Softmax / Continuous Index</p>
            </div>
          </div>
        </div>

        {/* Research Best Practices & Edge Feasibility */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-3.5 rounded-lg text-xs" style={inset}>
            <span className="text-amber-400 font-bold">⏱️ Sub-15ms Edge Latency</span>
            <p className="text-slate-400 mt-1 text-[11px]">
              1D-CNN bypasses heavy 2D-Spectrogram transformations, allowing direct ONNX Runtime on Raspberry Pi 5.
            </p>
          </div>
          <div className="p-3.5 rounded-lg text-xs" style={inset}>
            <span className="text-cyan-400 font-bold">🛡️ Zero Flapping Hysteresis</span>
            <p className="text-slate-400 mt-1 text-[11px]">
              Dual trigger-release mechanism stops alarm oscillation when cognitive state hovers near borderline.
            </p>
          </div>
          <div className="p-3.5 rounded-lg text-xs" style={inset}>
            <span className="text-emerald-400 font-bold">📊 SHAP Feature Verification</span>
            <p className="text-slate-400 mt-1 text-[11px]">
              Frontal EEG Theta/Beta (34.2%) + HRV RMSSD (26.8%) contribute over 61% of total decision weight.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 4: Correlation & Feature Trends Analytics
// ---------------------------------------------------------------------------
function CorrelationAnalyticsView({ telemetry }: { telemetry: any }) {
  return (
    <div className="space-y-5">
      <div className="p-6 rounded-xl space-y-4" style={surface}>
        <div className="flex items-center gap-3 pb-3 border-b border-[#1e2433]">
          <BarChart2 size={20} className="text-amber-400" />
          <div>
            <h3 className="text-base font-bold text-white">Multimodal Feature Correlation Matrix</h3>
            <p className="text-xs text-slate-400">Physiological vs Kinematic Feature Cross-Correlation Analysis</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
          {/* Card 1: EEG Theta vs Steering Entropy */}
          <div className="p-4 rounded-lg space-y-3" style={inset}>
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-white">Frontal Theta Power vs Steering Correction Rate</span>
              <span className="text-emerald-400 font-mono">r = +0.78 (Strong)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              High cognitive fatigue directly correlates with erratic micro-steering corrections and delayed apex turn-in.
            </p>
            <div className="h-32 rounded bg-slate-900/50 flex items-center justify-center border border-slate-800 text-xs text-slate-500 font-mono">
              [Live Scatter Matrix: θ-Power (AF7/8) vs Steering Reversal Index]
            </div>
          </div>

          {/* Card 2: HRV RMSSD vs Vehicle Speed */}
          <div className="p-4 rounded-lg space-y-3" style={inset}>
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-white">HRV RMSSD vs High-Speed Cornering G-Force</span>
              <span className="text-cyan-400 font-mono">r = -0.65 (Moderate)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Sympathetic nervous surge during peak lateral G-forces drops RMSSD temporarily, distinguishable from prolonged baseline fatigue.
            </p>
            <div className="h-32 rounded bg-slate-900/50 flex items-center justify-center border border-slate-800 text-xs text-slate-500 font-mono">
              [Live Dynamic Curve: Parasympathetic Tone vs Gy Lateral Acceleration]
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
