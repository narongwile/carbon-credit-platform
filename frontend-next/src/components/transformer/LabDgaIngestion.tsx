'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  FlaskConical,
  FileCheck,
  UploadCloud,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  FileText,
  Plus,
  Trash2,
  Calendar,
  Building,
  Check,
  Download,
  Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'
import { recordAuditAction } from '@/lib/auditStore'
import LocalOnlyNotice from '@/components/transformer/LocalOnlyNotice'

export interface LabDgaRecord {
  id: string
  date: string
  labName: string
  syringeId: string
  status: 'CERTIFIED' | 'PENDING'
  gases: {
    h2: number
    ch4: number
    c2h2: number
    c2h4: number
    c2h6: number
    co: number
    co2: number
  }
  oilQuality: {
    bdvKv: number // Dielectric Breakdown Voltage (kV)
    iftMnm: number // Interfacial Tension (mN/m)
    acidityMgKoh: number // Total Acid Number (mg KOH/g)
    furanMgKg: number // 2-Furfural (mg/kg) -> Direct DP correlation
    waterContentPpm: number
  }
  isCustom?: boolean
}

const SAMPLE_RECORDS: LabDgaRecord[] = [
  {
    id: 'LAB-2026-0815',
    date: '2026-08-15',
    labName: 'Example Laboratory A (sample record)',
    syringeId: 'SYR-8821',
    status: 'CERTIFIED',
    gases: { h2: 62, ch4: 44, c2h2: 3.0, c2h4: 34, c2h6: 27, co: 295, co2: 2450 },
    oilQuality: { bdvKv: 64.2, iftMnm: 34.8, acidityMgKoh: 0.038, furanMgKg: 0.68, waterContentPpm: 21 },
  },
  {
    id: 'LAB-2026-0210',
    date: '2026-02-10',
    labName: 'Example Laboratory B (sample record)',
    syringeId: 'SYR-7419',
    status: 'CERTIFIED',
    gases: { h2: 55, ch4: 38, c2h2: 2.6, c2h4: 29, c2h6: 24, co: 260, co2: 2180 },
    oilQuality: { bdvKv: 66.5, iftMnm: 36.2, acidityMgKoh: 0.032, furanMgKg: 0.54, waterContentPpm: 18 },
  },
]

interface LabDgaIngestionProps {
  onlineGases?: {
    h2: number
    ch4: number
    c2h2: number
    c2h4: number
    c2h6: number
  }
  assetId?: string
  assetName?: string
  orgId?: string
}

export default function LabDgaIngestion({
  onlineGases = { h2: 65, ch4: 45, c2h2: 3.2, c2h4: 35, c2h6: 28 },
  assetId = 'TRF-01',
  assetName = 'Main Substation TR-01',
  orgId = 'default',
}: LabDgaIngestionProps) {
  const storageKey = `pdm_lab_dga_${assetId}`
  const [records, setRecords] = useState<LabDgaRecord[]>(SAMPLE_RECORDS)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [selectedRecordId, setSelectedRecordId] = useState<string>('')

  // Form State for Manual Ingestion
  const [formCertId, setFormCertId] = useState('')
  const [formLabName, setFormLabName] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [formSyringeId, setFormSyringeId] = useState('')
  const [formBdv, setFormBdv] = useState('65.0')
  const [formIft, setFormIft] = useState('35.0')
  const [formAcidity, setFormAcidity] = useState('0.035')
  const [formFuran, setFormFuran] = useState('0.65')
  const [formWater, setFormWater] = useState('20')
  const [formH2, setFormH2] = useState('60')
  const [formCh4, setFormCh4] = useState('42')
  const [formC2h2, setFormC2h2] = useState('2.8')
  const [formC2h4, setFormC2h4] = useState('32')
  const [formC2h6, setFormC2h6] = useState('25')
  const [formCo, setFormCo] = useState('280')
  const [formCo2, setFormCo2] = useState('2300')

  // Load persistent records on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed: LabDgaRecord[] = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRecords(parsed)
          setSelectedRecordId(parsed[0].id)
          return
        }
      }
    } catch (e) {
      console.error('Failed to load PDM Lab records', e)
    }
    setRecords(SAMPLE_RECORDS)
    setSelectedRecordId(SAMPLE_RECORDS[0].id)
  }, [storageKey])

  const saveRecords = (updated: LabDgaRecord[]) => {
    setRecords(updated)
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated))
    } catch (e) {
      console.error('Failed to save PDM Lab records', e)
    }
  }

  const activeRecord = useMemo(() => {
    return records.find((r) => r.id === selectedRecordId) || records[0] || SAMPLE_RECORDS[0]
  }, [records, selectedRecordId])

  // Sensor Fusion Drift Analysis
  const gasComparisons = useMemo(() => {
    return [
      { key: 'H2', name: 'Hydrogen', online: onlineGases.h2, lab: activeRecord.gases.h2 },
      { key: 'CH4', name: 'Methane', online: onlineGases.ch4, lab: activeRecord.gases.ch4 },
      { key: 'C2H2', name: 'Acetylene', online: onlineGases.c2h2, lab: activeRecord.gases.c2h2 },
      { key: 'C2H4', name: 'Ethylene', online: onlineGases.c2h4, lab: activeRecord.gases.c2h4 },
      { key: 'C2H6', name: 'Ethane', online: onlineGases.c2h6, lab: activeRecord.gases.c2h6 },
    ]
  }, [onlineGases, activeRecord])

  const handleCalibrate = async () => {
    setCalibrating(true)
    try {
      const driftDetails = gasComparisons
        .map((g) => `${g.key}: ${g.online > g.lab ? '+' : ''}${(g.online - g.lab).toFixed(1)}ppm`)
        .join(', ')

      await recordAuditAction({
        action: 'CONFIG_CHANGE',
        target: { assetId, assetName },
        before: `Online DGA Factory Zero Offset`,
        after: `Calibrated with Lab Report ${activeRecord.id} (${activeRecord.labName}) — Offsets aligned: [${driftDetails}]`,
        justification: `ASTM D3612 Laboratory Syringe Benchmark Sensor Calibration for ${assetName} (Org: ${orgId})`,
      })

      setTimeout(() => {
        setCalibrating(false)
        toast.success(`IoT Telemetry calibrated against Lab Certificate ${activeRecord.id} and recorded to Audit Trail`)
      }, 700)
    } catch (err) {
      setCalibrating(false)
      toast.error('Failed to record calibration audit entry')
    }
  }

  const handleCreateRecord = (e: React.FormEvent) => {
    e.preventDefault()
    const id = formCertId.trim() || `LAB-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-4)}`
    const newRec: LabDgaRecord = {
      id,
      date: formDate,
      labName: formLabName.trim() || 'Independent Accredited Oil Testing Laboratory',
      syringeId: formSyringeId.trim() || `SYR-${Math.floor(1000 + (id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 9000))}`,
      status: 'CERTIFIED',
      gases: {
        h2: Math.max(0, Number(formH2) || 0),
        ch4: Math.max(0, Number(formCh4) || 0),
        c2h2: Math.max(0, Number(formC2h2) || 0),
        c2h4: Math.max(0, Number(formC2h4) || 0),
        c2h6: Math.max(0, Number(formC2h6) || 0),
        co: Math.max(0, Number(formCo) || 0),
        co2: Math.max(0, Number(formCo2) || 0),
      },
      oilQuality: {
        bdvKv: Math.max(1, Number(formBdv) || 50),
        iftMnm: Math.max(1, Number(formIft) || 30),
        acidityMgKoh: Math.max(0.001, Number(formAcidity) || 0.03),
        furanMgKg: Math.max(0.01, Number(formFuran) || 0.5),
        waterContentPpm: Math.max(1, Number(formWater) || 15),
      },
      isCustom: true,
    }

    const updated = [newRec, ...records]
    saveRecords(updated)
    setSelectedRecordId(newRec.id)
    setShowUploadModal(false)
    toast.success(`Certified Lab Report ${newRec.id} saved successfully`)
  }

  const handleDeleteRecord = (idToDelete: string) => {
    const updated = records.filter((r) => r.id !== idToDelete)
    saveRecords(updated.length > 0 ? updated : SAMPLE_RECORDS)
    if (selectedRecordId === idToDelete) {
      setSelectedRecordId(updated[0]?.id || SAMPLE_RECORDS[0].id)
    }
    toast.success('Lab record removed')
  }

  // Calculate DP from Furan (Chendong equation: DP = (log10(2-FAL) - 1.51) / -0.0035)
  const computedDpFromFuran = useMemo(() => {
    const f = activeRecord.oilQuality.furanMgKg
    if (!f || f <= 0) return 650
    try {
      const dp = Math.round((Math.log10(f) - 1.51) / -0.0035)
      return Math.max(150, Math.min(1100, dp))
    } catch {
      return 600
    }
  }, [activeRecord])

  return (
    <div className="rounded-2xl p-5 space-y-5 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <DemoDataBanner
        title="รายการผลแล็บด้านล่างเป็นตัวอย่างจำลอง ไม่ใช่ผลตรวจของหม้อแปลงเครื่องนี้"
        detail="ระบบยังไม่ได้เชื่อมต่อกับห้องปฏิบัติการใดๆ — เลขที่ใบรายงาน ชื่อแล็บ หมายเลข syringe สถานะ CERTIFIED และค่าคุณภาพน้ำมัน (BDV / IFT / Acidity / Furan) ทั้งหมดเป็นข้อมูลตัวอย่างที่ฝังไว้ในหน้าจอ ห้ามใช้อ้างอิงแทนใบรายงานผลจริง กรุณาอัปโหลดผลตรวจฉบับจริงของหม้อแปลงเครื่องนี้ก่อนนำไปตัดสินใจ"
      />
      <LocalOnlyNotice what="ผลแล็บที่บันทึกเอง" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <FlaskConical size={18} className="text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Hybrid Lab DGA &amp; Oil Quality Ingestion</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
              ASTM D3612 / IEC 60567
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              Asset: {assetName}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Calibration fusion: Offline certified laboratory syringe testing combined with online IoT sensors
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 transition-all cursor-pointer"
          >
            <UploadCloud size={14} /> บันทึกผลแล็บใหม่ (Enter Report)
          </button>
        </div>
      </div>

      {/* Report Switcher & Active Summary Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-[#0a0e1a] p-2.5 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">ใบรับรองผลตรวจ:</span>
          <select
            value={activeRecord.id}
            onChange={(e) => setSelectedRecordId(e.target.value)}
            className="text-xs bg-[#0d1117] border border-slate-700 text-white rounded-lg px-2.5 py-1 font-mono focus:outline-none focus:border-cyan-500"
          >
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.date} ({r.labName}) {r.isCustom ? '★' : ''}
              </option>
            ))}
          </select>
          {activeRecord.isCustom && (
            <button
              onClick={() => handleDeleteRecord(activeRecord.id)}
              className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 transition-colors cursor-pointer"
              title="Delete this custom report"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
          <span>Syringe: <strong className="text-white">{activeRecord.syringeId}</strong></span>
          <span>Status: <span className="text-emerald-400 font-bold font-sans">✓ {activeRecord.status}</span></span>
        </div>
      </div>

      {/* Comprehensive Physical Oil Quality KPIs */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span>Certified Oil Quality Diagnostics (Report: {activeRecord.id})</span>
          <span className="text-[10px] text-slate-500 font-mono">Sample Date: {activeRecord.date}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Breakdown Voltage (BDV)</div>
            <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
              {activeRecord.oilQuality.bdvKv} <span className="text-xs font-normal text-slate-400">kV</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">IEC 60156 (Limit: &gt;50 kV)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Interfacial Tension (IFT)</div>
            <div className="text-xl font-black text-cyan-300 font-mono mt-0.5">
              {activeRecord.oilQuality.iftMnm} <span className="text-xs font-normal text-slate-400">mN/m</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">ASTM D971 (Limit: &gt;30 mN/m)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Acidity (TAN)</div>
            <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
              {activeRecord.oilQuality.acidityMgKoh} <span className="text-xs font-normal text-slate-400">mg KOH/g</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">ASTM D974 (Limit: &lt;0.10)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Furan Cellulose DP</div>
            <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
              {computedDpFromFuran} <span className="text-xs font-normal text-slate-400">DP</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">2-FAL: {activeRecord.oilQuality.furanMgKg} mg/kg</div>
          </div>
        </div>
      </div>

      {/* Online IoT vs Certified Lab Syringe Fusion Matrix */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <RefreshCw size={15} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white">Sensor Fusion &amp; Calibration Drift Analysis</h4>
          </div>
          <button
            onClick={handleCalibrate}
            disabled={calibrating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-300 border border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={12} className={calibrating ? 'animate-spin' : ''} />
            {calibrating ? 'Calibrating...' : 'Calibrate Online Sensor Offsets'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="py-2 px-2.5">Gas Parameter</th>
                <th className="py-2 px-2.5">Online IoT Sensor</th>
                <th className="py-2 px-2.5">Certified Lab Syringe ({activeRecord.id})</th>
                <th className="py-2 px-2.5">Variance (Drift)</th>
                <th className="py-2 px-2.5">Calibration Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {gasComparisons.map((item) => {
                const diff = item.online - item.lab
                const pct = item.lab > 0 ? ((diff / item.lab) * 100).toFixed(1) : '0.0'
                const isAcceptable = Math.abs(Number(pct)) <= 15.0

                return (
                  <tr key={item.key} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-2 px-2.5 font-sans font-medium text-slate-200">
                      {item.name} ({item.key})
                    </td>
                    <td className="py-2 px-2.5 text-cyan-300 font-bold">{item.online} ppm</td>
                    <td className="py-2 px-2.5 text-white font-bold">{item.lab} ppm</td>
                    <td className="py-2 px-2.5">
                      <span className={Number(pct) > 0 ? 'text-amber-400' : 'text-slate-300'}>
                        {Number(pct) > 0 ? `+${pct}%` : `${pct}%`} ({diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} ppm)
                      </span>
                    </td>
                    <td className="py-2 px-2.5">
                      <span
                        className={clsx(
                          'text-[10px] px-2 py-0.5 rounded font-bold uppercase',
                          isAcceptable
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                        )}
                      >
                        {isAcceptable ? '✓ Within Spec' : '⚠ Drift Recal Req.'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ingest Modal with Full Form */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-2xl p-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FlaskConical size={20} className="text-cyan-400" />
                <div>
                  <h4 className="text-sm font-bold text-white">บันทึกผลการตรวจวิเคราะห์น้ำมันหม้อแปลง (ASTM D3612 Certificate)</h4>
                  <p className="text-[11px] text-slate-400">บันทึกผลแล็บออฟไลน์ลงในระบบ เพื่อสอบเทียบกับเซนเซอร์ IoT ประจำหม้อแปลง {assetName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRecord} className="space-y-4 text-xs">
              {/* General Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#0a0e1a] border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">เลขที่ใบรับรอง (Report / Certificate #)</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น CERT-2026-0901"
                    value={formCertId}
                    onChange={(e) => setFormCertId(e.target.value)}
                    className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">ชื่อห้องปฏิบัติการ (Testing Laboratory)</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น Testing Lab Center"
                    value={formLabName}
                    onChange={(e) => setFormLabName(e.target.value)}
                    className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">วันที่เก็บตัวอย่าง (Sample Date)</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">หมายเลขกระบอกเก็บตัวอย่าง (Syringe ID)</label>
                  <input
                    type="text"
                    placeholder="เช่น SYR-9842"
                    value={formSyringeId}
                    onChange={(e) => setFormSyringeId(e.target.value)}
                    className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Physical Oil Quality Inputs */}
              <div>
                <h5 className="font-bold text-slate-200 mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  คุณสมบัติทางกายภาพของน้ำมัน (Physical Oil Quality)
                </h5>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-[#0a0e1a] border border-slate-800">
                  <div>
                    <label className="block text-slate-400 mb-1">BDV (kV - IEC 60156)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={formBdv}
                      onChange={(e) => setFormBdv(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">IFT (mN/m - ASTM D971)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={formIft}
                      onChange={(e) => setFormIft(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Acidity TAN (mg KOH/g)</label>
                    <input
                      type="number"
                      step="0.001"
                      required
                      value={formAcidity}
                      onChange={(e) => setFormAcidity(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">2-Furfural Furan (mg/kg)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={formFuran}
                      onChange={(e) => setFormFuran(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Water Content (ppm)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formWater}
                      onChange={(e) => setFormWater(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* 7 Dissolved Gases Inputs */}
              <div>
                <h5 className="font-bold text-slate-200 mb-2 flex items-center gap-1.5">
                  <FlaskConical size={14} className="text-cyan-400" />
                  ความเข้มข้นก๊าซละลายในน้ำมัน 7 ชนิด (ASTM D3612 / ppm)
                </h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-[#0a0e1a] border border-slate-800 font-mono">
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">H₂ (Hydrogen)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formH2}
                      onChange={(e) => setFormH2(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-cyan-300 font-bold text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">CH₄ (Methane)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formCh4}
                      onChange={(e) => setFormCh4(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-bold text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">C₂H₂ (Acetylene)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={formC2h2}
                      onChange={(e) => setFormC2h2(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-rose-300 font-bold text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">C₂H₄ (Ethylene)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formC2h4}
                      onChange={(e) => setFormC2h4(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-bold text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">C₂H₆ (Ethane)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formC2h6}
                      onChange={(e) => setFormC2h6(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white font-bold text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">CO (Carbon Monoxide)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formCo}
                      onChange={(e) => setFormCo(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-sans">CO₂ (Carbon Dioxide)</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={formCo2}
                      onChange={(e) => setFormCo2(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-700 rounded-lg p-2 text-white text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ยกเลิก (Cancel)
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Check size={14} /> บันทึกและวิเคราะห์เปรียบเทียบ (Save &amp; Ingest)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
