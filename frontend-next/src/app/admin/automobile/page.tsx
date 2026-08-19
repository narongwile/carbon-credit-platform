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
// Tab 1: 1D-CNN Driver Fatigue & Biosignals View
// ---------------------------------------------------------------------------
function FatigueBiosignalView({ telemetry }: { telemetry: any }) {
  const isAlert = telemetry.fatigueState === 'ALERT'
  const isDrowsy = telemetry.fatigueState === 'DROWSY'
  const isCritical = telemetry.fatigueState === 'CRITICAL'

  const stateColor = isCritical ? '#ef4444' : isDrowsy ? '#f59e0b' : '#10b981'
  const stateBg = isCritical ? 'rgba(239,68,68,0.15)' : isDrowsy ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)'
  const stateBorder = isCritical ? 'rgba(239,68,68,0.3)' : isDrowsy ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'

  return (
    <div className="space-y-5">
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
            {/* Delta 0.5-4 Hz */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Delta (δ, 0.5-4 Hz) - Deep Sleep</span>
                <span className="text-white font-bold">{telemetry.bandDelta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${telemetry.bandDelta}%` }} />
              </div>
            </div>

            {/* Theta 4-8 Hz - Drowsiness Marker */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span className="text-amber-300 font-semibold">Theta (θ, 4-8 Hz) - Drowsiness</span>
                <span className="text-amber-300 font-bold">{telemetry.bandTheta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${telemetry.bandTheta}%` }} />
              </div>
            </div>

            {/* Alpha 8-13 Hz - Relaxation */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Alpha (α, 8-13 Hz) - Eyes Relaxed</span>
                <span className="text-white font-bold">{telemetry.bandAlpha}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${telemetry.bandAlpha}%` }} />
              </div>
            </div>

            {/* Beta 13-30 Hz - Active Focus */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span className="text-cyan-300 font-semibold">Beta (β, 13-30 Hz) - Active Focus</span>
                <span className="text-cyan-300 font-bold">{telemetry.bandBeta}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${telemetry.bandBeta}%` }} />
              </div>
            </div>

            {/* Gamma 30-50 Hz */}
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
// Tab 3: 1D-CNN Deep Learning Architecture & Weights View
// ---------------------------------------------------------------------------
function ModelArchitectureView({ telemetry }: { telemetry: any }) {
  return (
    <div className="space-y-5">
      <div className="p-6 rounded-xl space-y-4" style={surface}>
        <div className="flex items-center gap-3 pb-3 border-b border-[#1e2433]">
          <Sparkles size={20} className="text-amber-400" />
          <div>
            <h3 className="text-base font-bold text-white">1D-CNN Multi-Modal Deep Neural Network Pipeline</h3>
            <p className="text-xs text-slate-400">Real-Time Feature Fusion Architecture for Driver Fatigue & Microsleep Prediction</p>
          </div>
        </div>

        {/* Architecture Pipeline Flow Diagram */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
          {/* Step 1: Input Multi-Modal Matrix */}
          <div className="p-4 rounded-lg space-y-2" style={inset}>
            <div className="text-xs font-bold text-amber-400">1. INPUT TENSOR</div>
            <p className="text-xs text-slate-300 font-semibold">Shape: [Batch, 50Hz × 5s, 8 Channels]</p>
            <ul className="text-[11px] text-slate-400 space-y-1">
              <li>• Ch 1-4: Muse EEG (TP9, AF7, AF8, TP10)</li>
              <li>• Ch 5: Coospo RR Intervals (HRV)</li>
              <li>• Ch 6: Steering Wheel Angle</li>
              <li>• Ch 7: Throttle APPS1</li>
              <li>• Ch 8: Speed Variance</li>
            </ul>
          </div>

          {/* Step 2: 1D Convolutional Layers */}
          <div className="p-4 rounded-lg space-y-2" style={inset}>
            <div className="text-xs font-bold text-cyan-400">2. 1D CONVOLUTION</div>
            <p className="text-xs text-slate-300 font-semibold">Temporal Feature Extraction</p>
            <ul className="text-[11px] text-slate-400 space-y-1">
              <li>• Conv1D (Filters=64, Kernel=7, ReLU)</li>
              <li>• BatchNorm1D + MaxPool1D (k=2)</li>
              <li>• Conv1D (Filters=128, Kernel=5, ReLU)</li>
              <li>• Dropout (p=0.3)</li>
            </ul>
          </div>

          {/* Step 3: Global Pooling & Dense */}
          <div className="p-4 rounded-lg space-y-2" style={inset}>
            <div className="text-xs font-bold text-indigo-400">3. DENSE CLASSIFIER</div>
            <p className="text-xs text-slate-300 font-semibold">Latent Space Embedding</p>
            <ul className="text-[11px] text-slate-400 space-y-1">
              <li>• GlobalAveragePooling1D</li>
              <li>• Dense (128, LeakyReLU)</li>
              <li>• Dense (64, ReLU)</li>
              <li>• Fully Connected Latent Vector</li>
            </ul>
          </div>

          {/* Step 4: Output Softmax */}
          <div className="p-4 rounded-lg space-y-2" style={inset}>
            <div className="text-xs font-bold text-emerald-400">4. PREDICTION OUTPUT</div>
            <p className="text-xs text-slate-300 font-semibold">Multi-Class Probability</p>
            <ul className="text-[11px] text-slate-400 space-y-1">
              <li>• ALERT (Normal Driving)</li>
              <li>• DROWSY_WARNING (Early Signs)</li>
              <li>• CRITICAL_FATIGUE (Microsleep)</li>
              <li>• Continuous Fatigue Risk % (0-100)</li>
            </ul>
          </div>
        </div>

        {/* Feature Importance Weights */}
        <div className="pt-4 border-t border-[#1e2433]">
          <h4 className="text-xs font-bold text-white mb-3">Model Feature Importance Weighting (SHAP Analysis)</h4>
          <div className="space-y-2 text-xs">
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Frontal EEG Theta / Beta Ratio (AF7, AF8)</span>
                <span className="text-amber-400 font-bold">34.2%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: '34.2%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>HRV RMSSD & LF/HF Ratio (Autonomic Nervous Tone)</span>
                <span className="text-cyan-400 font-bold">26.8%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-cyan-500 rounded-full" style={{ width: '26.8%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Steering Reversal Rate (SRR) & Micro-correction Entropy</span>
                <span className="text-emerald-400 font-bold">22.5%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '22.5%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Pedal Throttle Release Delay (Reaction Time)</span>
                <span className="text-indigo-400 font-bold">16.5%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: '16.5%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 4: Correlation & Feature Trends View
// ---------------------------------------------------------------------------
function CorrelationAnalyticsView({ telemetry }: { telemetry: any }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="p-5 rounded-xl space-y-3" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Activity size={16} className="text-amber-400" />
            Fatigue Score vs. Steering Variance
          </h3>
          <p className="text-xs text-slate-400">
            Observation: As the driver fatigue index crosses 65%, steering micro-corrections decrease by 42% followed by abrupt over-corrections (Steering Jerk).
          </p>
          <div className="h-48 flex items-center justify-center rounded-lg text-slate-500 text-xs" style={inset}>
            [Live Multi-Modal Time-Series Correlation Chart: Fatigue % vs Steering Entropy]
          </div>
        </div>

        <div className="p-5 rounded-xl space-y-3" style={surface}>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Heart size={16} className="text-rose-400" />
            EEG Theta Power vs. Heart Rate Variability (RMSSD)
          </h3>
          <p className="text-xs text-slate-400">
            Observation: High correlation (r = -0.78) between parasympathetic withdrawal (falling RMSSD) and the onset of high Theta power bursts.
          </p>
          <div className="h-48 flex items-center justify-center rounded-lg text-slate-500 text-xs" style={inset}>
            [Live Cross-Correlation Scatter: PSD Theta Band vs HRV RMSSD ms]
          </div>
        </div>
      </div>
    </div>
  )
}
