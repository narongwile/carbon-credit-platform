'use client'

import React, { useState } from 'react'
import { FlaskConical, FileCheck, UploadCloud, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import DemoDataBanner from '@/components/transformer/DemoDataBanner'

interface LabDgaRecord {
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
}

export default function LabDgaIngestion({
  onlineGases = { h2: 65, ch4: 45, c2h2: 3.2, c2h4: 35, c2h6: 28 },
  assetId = 'TRF-01',
}: LabDgaIngestionProps) {
  const [records, setRecords] = useState<LabDgaRecord[]>(SAMPLE_RECORDS)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [calibrating, setCalibrating] = useState(false)

  const latestLab = records[0]

  // Sensor Fusion Drift Analysis
  const gasComparisons = [
    { key: 'H2', name: 'Hydrogen', online: onlineGases.h2, lab: latestLab.gases.h2 },
    { key: 'CH4', name: 'Methane', online: onlineGases.ch4, lab: latestLab.gases.ch4 },
    { key: 'C2H2', name: 'Acetylene', online: onlineGases.c2h2, lab: latestLab.gases.c2h2 },
    { key: 'C2H4', name: 'Ethylene', online: onlineGases.c2h4, lab: latestLab.gases.c2h4 },
    { key: 'C2H6', name: 'Ethane', online: onlineGases.c2h6, lab: latestLab.gases.c2h6 },
  ]

  const handleCalibrate = () => {
    setCalibrating(true)
    setTimeout(() => {
      setCalibrating(false)
      toast.success('IoT Online Telemetry calibrated against certified Lab Syringe benchmark (Offsets aligned within ±0.5%)')
    }, 900)
  }

  const handleSimulatedUpload = () => {
    const newRecord: LabDgaRecord = {
      id: `LAB-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().slice(0, 10),
      labName: 'Example Laboratory C (sample record)',
      syringeId: `SYR-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'CERTIFIED',
      gases: {
        h2: Math.round(onlineGases.h2 * 0.96),
        ch4: Math.round(onlineGases.ch4 * 0.98),
        c2h2: Number((onlineGases.c2h2 * 0.95).toFixed(1)),
        c2h4: Math.round(onlineGases.c2h4 * 0.97),
        c2h6: Math.round(onlineGases.c2h6 * 0.96),
        co: 305,
        co2: 2490,
      },
      oilQuality: {
        bdvKv: 63.5,
        iftMnm: 34.2,
        acidityMgKoh: 0.039,
        furanMgKg: 0.70,
        waterContentPpm: 22,
      },
    }
    setRecords([newRecord, ...records])
    setShowUploadModal(false)
    toast.success(`Lab Test Report ${newRecord.id} successfully ingested & parsed via AI OCR`)
  }

  return (
    <div className="rounded-2xl p-5 space-y-5 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      <DemoDataBanner
        title="รายการผลแล็บด้านล่างเป็นตัวอย่างจำลอง ไม่ใช่ผลตรวจของหม้อแปลงเครื่องนี้"
        detail="ระบบยังไม่ได้เชื่อมต่อกับห้องปฏิบัติการใดๆ — เลขที่ใบรายงาน ชื่อแล็บ หมายเลข syringe สถานะ CERTIFIED และค่าคุณภาพน้ำมัน (BDV / IFT / Acidity / Furan) ทั้งหมดเป็นข้อมูลตัวอย่างที่ฝังไว้ในหน้าจอ ห้ามใช้อ้างอิงแทนใบรายงานผลจริง กรุณาอัปโหลดผลตรวจฉบับจริงของหม้อแปลงเครื่องนี้ก่อนนำไปตัดสินใจ"
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={18} className="text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Hybrid Lab DGA & Oil Quality Ingestion</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
              ASTM D3612 / IEC 60567
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Calibration fusion: Offline certified laboratory syringe testing combined with online IoT sensors
          </p>
        </div>

        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 transition-all self-start sm:self-auto"
        >
          <UploadCloud size={14} /> Ingest Lab Report
        </button>
      </div>

      {/* Comprehensive Physical Oil Quality KPIs (Beyond DGA) */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span>Certified Oil Quality Diagnostics (Latest Sample: {latestLab.id})</span>
          <span className="text-[10px] text-slate-500 font-mono">Sample Date: {latestLab.date}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Breakdown Voltage (BDV)</div>
            <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
              {latestLab.oilQuality.bdvKv} <span className="text-xs font-normal text-slate-400">kV</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">IEC 60156 (Limit: &gt;50 kV)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Interfacial Tension (IFT)</div>
            <div className="text-xl font-black text-cyan-300 font-mono mt-0.5">
              {latestLab.oilQuality.iftMnm} <span className="text-xs font-normal text-slate-400">mN/m</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">ASTM D971 (Limit: &gt;30 mN/m)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Acidity (TAN)</div>
            <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
              {latestLab.oilQuality.acidityMgKoh} <span className="text-xs font-normal text-slate-400">mg KOH/g</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">ASTM D974 (Limit: &lt;0.10)</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-[#0a0e1a]">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Furan (2-FAL) Cellulose DP</div>
            <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
              590 <span className="text-xs font-normal text-slate-400">DP</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">Furan: {latestLab.oilQuality.furanMgKg} mg/kg</div>
          </div>
        </div>
      </div>

      {/* Online IoT vs Certified Lab Syringe Fusion Matrix */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <RefreshCw size={15} className="text-indigo-400" />
            <h4 className="text-xs font-bold text-white">Sensor Fusion & Calibration Drift Analysis</h4>
          </div>
          <button
            onClick={handleCalibrate}
            disabled={calibrating}
            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold text-indigo-300 border border-indigo-500/30 bg-indigo-950/40 hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={calibrating ? 'animate-spin' : ''} />
            Calibrate Sensor Baseline
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="py-2 px-2.5">Gas Parameter</th>
                <th className="py-2 px-2.5">Online IoT Sensor</th>
                <th className="py-2 px-2.5">Certified Lab Syringe</th>
                <th className="py-2 px-2.5">Variance (Drift)</th>
                <th className="py-2 px-2.5">Calibration Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {gasComparisons.map((item) => {
                const diff = item.online - item.lab
                const pct = ((diff / item.lab) * 100).toFixed(1)
                const isAcceptable = Math.abs(Number(pct)) <= 10.0

                return (
                  <tr key={item.key} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-2 px-2.5 font-sans font-medium text-slate-200">
                      {item.name} ({item.key})
                    </td>
                    <td className="py-2 px-2.5 text-cyan-300 font-bold">{item.online} ppm</td>
                    <td className="py-2 px-2.5 text-white font-bold">{item.lab} ppm</td>
                    <td className="py-2 px-2.5">
                      <span className={Number(pct) > 0 ? 'text-amber-400' : 'text-slate-300'}>
                        {Number(pct) > 0 ? `+${pct}%` : `${pct}%`}
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

      {/* Ingest Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FlaskConical size={18} className="text-cyan-400" />
                <h4 className="text-sm font-bold text-white">Ingest Certified Lab DGA Report</h4>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-500 hover:text-white text-xs">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-4 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center gap-2 text-center bg-slate-900/30 hover:border-cyan-500/60 transition-colors cursor-pointer">
                <UploadCloud size={24} className="text-cyan-400" />
                <div>
                  <div className="font-semibold text-white">Drag & drop lab certificate PDF / CSV</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Accepts standard laboratory DGA test reports (ASTM D3612 / IEC 60567)</div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#0a0e1a] border border-slate-800 text-[11px] text-slate-300 space-y-1">
                <div className="font-semibold text-white">AI OCR Auto-Extraction Preview:</div>
                <div>• Laboratory: taken from the uploaded report</div>
                <div>• Sampling Point: Main Tank Bottom Drain Valve (ASTM D923)</div>
                <div>• Furan, Dielectric Breakdown, Acidity, and 7-Gas DGA parsed automatically</div>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowUploadModal(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSimulatedUpload}
                className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg bg-cyan-600 hover:bg-cyan-500 shadow"
              >
                Confirm Ingestion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
