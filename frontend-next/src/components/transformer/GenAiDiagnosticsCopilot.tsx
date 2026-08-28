'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  Bot, Sparkles, Send, MessageSquare, AlertTriangle, ShieldCheck,
  CheckCircle2, Copy, Download, Radio, Wrench, RefreshCw, FileText,
  Clock, ArrowRight, Zap, ExternalLink, ChevronRight, X
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

interface GenAiDiagnosticsCopilotProps {
  assetId?: string
  assetName?: string
  orgName?: string
  dgaGases?: {
    h2: number
    ch4: number
    c2h2: number
    c2h4: number
    c2h6: number
    co: number
    co2: number
  }
  duvalVerdict?: string
  rttDays?: number
  oilTemp?: number
  hotSpotTemp?: number
  dtrHeadroomKva?: number
  bushingStatus?: string
  dpAging?: number
  moisturePpm?: number
  /** Real bushing tan-delta (%) from the device, or null when none is fitted. */
  bushingTanDeltaLive?: number | null
  /** Real partial-discharge magnitude (pC) from the device, or null. */
  partialDischargeLive?: number | null
}

interface ChatMessage {
  id: string
  sender: 'user' | 'ai'
  text: string
  timestamp: string
  actionSuggestion?: {
    label: string
    action: () => void
  }
}

export default function GenAiDiagnosticsCopilot({
  assetId = 'TR-01',
  assetName = 'Main Substation TR-01',
  orgName = 'Industrial Substation',
  dgaGases = { h2: 65, ch4: 45, c2h2: 3.2, c2h4: 35, c2h6: 28, co: 420, co2: 3200 },
  duvalVerdict = 'T2 - Thermal Fault (300°C - 700°C)',
  rttDays = 38,
  oilTemp = 64,
  hotSpotTemp = 78,
  dtrHeadroomKva = 1015,
  bushingStatus = 'Phase B Warning (tan δ: 0.82%)',
  dpAging = 590,
  moisturePpm = 22,
  bushingTanDeltaLive = null,
  partialDischargeLive = null,
}: GenAiDiagnosticsCopilotProps) {
  // The bushing answer below quoted tan δ = 0.82%, ΔC1 = +3.6% and PD = 195 pC
  // as this transformer's readings, and concluded "ฉนวนระเบิดได้" (the
  // insulation can explode) within 60 days. Those three numbers were string
  // literals — identical for every asset on the platform, including units with
  // no bushing instrumentation at all. An engineer reading it had no way to
  // tell that their specific transformer was not, in fact, 60 days from a
  // bushing failure. Real readings are used when the device publishes them;
  // otherwise the answer is explicitly labelled as a worked example.
  const tanDeltaKnown = bushingTanDeltaLive != null
  const pdKnown = partialDischargeLive != null
  const tanDeltaTxt = tanDeltaKnown ? `${bushingTanDeltaLive}%` : '0.82% (ตัวอย่างจำลอง)'
  const pdTxt = pdKnown ? `${partialDischargeLive} pC` : '195 pC (ตัวอย่างจำลอง)'
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputQuery, setInputQuery] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'copilot' | 'rca' | 'workorder'>('copilot')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Initial Executive Briefing message from Copilot on load
  useEffect(() => {
    const initialGreeting: ChatMessage = {
      id: 'msg-init',
      sender: 'ai',
      text: `สวัสดีครับวิศวกรผู้ดูแลระบบ ผมคือ **Industrial GenAI Diagnostics Copilot** 🤖 พร้อมช่วยวินิจฉัยสภาพหม้อแปลง **${assetName} (${assetId})** แบบเรียลไทม์\n\n📌 **สรุปสถานะด่วนจาก Telemetry ปัจจุบัน:**\n- **DGA Diagnosis:** ตรวจพบก๊าซ C₂H₂ สะสม ${dgaGases.c2h2} ppm เข้าข่าย **${duvalVerdict}**\n- **พยากรณ์ Time-to-Trip (RTT):** คาดว่าจะแตะระดับขีดอันตรายในอีก **${rttDays} วัน** หากไม่มีการระบายก๊าซ\n- **Bushing Health:** ${tanDeltaKnown ? `tan δ = ${bushingTanDeltaLive}% (ค่าที่วัดได้)` : 'ยังไม่ได้ติดตั้งเซนเซอร์วัดบุชชิ่ง — ไม่มีค่าจริง'}\n- **DTR Headroom:** ขณะนี้ยังมีขีดความสามารถรองรับโหลดได้อีก **+${dtrHeadroomKva.toLocaleString()} kVA** อย่างปลอดภัย\n\nคุณสามารถคลิกคำถามด่วนด้านล่าง หรือสอบถามเจาะจงได้เลยครับ!`,
      timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    }
    setMessages([initialGreeting])
  }, [assetId, assetName, duvalVerdict, rttDays, tanDeltaKnown, bushingTanDeltaLive, dtrHeadroomKva, dgaGases.c2h2])

  // Preset Question Suggestions
  const PRESET_QUERIES = [
    {
      id: 'rca',
      title: '🔍 วิเคราะห์ RootAnalysis (RCA)',
      prompt: 'ช่วยวิเคราะห์ Root Cause Analysis (RCA) ว่าทำไม C2H2 ถึงสะสม และเข้าข่ายความผิดปกติใดตามมาตรฐาน IEEE C57.104?',
    },
    {
      id: 'overload',
      title: '⚡ ขอคำแนะนำการจ่ายโหลด DTR',
      prompt: 'ในสภาพอากาศปัจจุบัน หม้อแปลงลูกนี้สามารถเร่งโหลดเพิ่มขึ้นอีก 300 kVA ได้อย่างปลอดภัยหรือไม่ มีผลต่ออายุฉนวนเท่าไหร่?',
    },
    {
      id: 'bushing',
      title: '🔌 ประเมินความเสี่ยงบุชชิ่ง Phase B',
      prompt: 'ค่า tan delta และ PD ของบุชชิ่ง มีความเสี่ยงที่จะเกิด Flashover หรือไม่ และต้องแก้ไขอย่างไร?',
    },
    {
      id: 'wo',
      title: '📋 ร่างใบสั่งงานซ่อมบำรุง (CMMS)',
      prompt: 'ช่วยร่างใบสั่งงานซ่อมบำรุง (CMMS Work Order) สำหรับส่งทีมช่างเข้าแก้ไขหม้อแปลงลูกนี้แบบครบขั้นตอน',
    },
  ]

  // Intelligent Response Generator (Deterministic Expert System & Natural Language)
  const handleSend = (queryText?: string) => {
    const text = queryText || inputQuery
    if (!text.trim()) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputQuery('')
    setIsTyping(true)

    setTimeout(() => {
      let reply = ''
      let actionSuggestion = undefined

      if (text.includes('RCA') || text.includes('สาเหตุ') || text.includes('C2H2')) {
        reply = `### 🔍 ผลการวิเคราะห์ RootAnalysis (Root Cause Analysis - RCA)\n**อ้างอิงมาตรฐาน IEEE C57.104-2019 & IEC 60599:**\n\n1. **กลไกการเกิดก๊าซ (Gas Generation Mechanism):**\n   - สัดส่วนก๊าซ Acetylene (C₂H₂ = ${dgaGases.c2h2} ppm) ร่วมกับ Ethylene (C₂H₄ = ${dgaGases.c2h4} ppm) ใน Duval Pentagon บ่งชี้ว่าเกิด **ความร้อนสูงเฉพาะจุด (Thermal Hot-Spot > 500°C)**\n   - สาเหตุที่เป็นไปได้สูง: หน้าสัมผัสของชุด Tap Changer (OLTC) หลวม หรือกระแสไหลวน (Circulating Currents) บริเวณแกนเหล็กขดลวด\n\n2. **ความเร่งด่วนและ Time-to-Trip:**\n   - เวกเตอร์ความเร็วในการสะสมก๊าซอยู่ที่ **+0.42 %/วัน** ซึ่งทำให้คาดการณ์ RTT อยู่ที่ **${rttDays} วัน** ก่อนที่สวิตช์ตรวจจับก๊าซจะตัดวงจร (Trip)\n\n3. **ข้อเสนอแนะทางวิศวกรรม:**\n   - สั่งเก็บตัวอย่างน้ำมันไซริงค์ซ้ำใน 7 วัน เพื่อสอบเทียบ Drift (ASTM D3612)\n   - เตรียมต่อเครื่องกรองและไล่ก๊าซน้ำมัน (Degassing Machine) ในแผนซ่อมบำรุงประจำเดือน`
      } else if (text.includes('โหลด') || text.includes('DTR') || text.includes('overload')) {
        reply = `### ⚡ ผลการประเมินการจ่ายโหลดแบบไดนามิก (DTR Assessment)\n**อิงตามมาตรฐาน IEEE C57.115:**\n\n- **สถานะปัจจุบัน:** ขณะนี้หม้อแปลงมี Headroom ปลอดภัยเหลืออยู่ **+${dtrHeadroomKva.toLocaleString()} kVA**\n- **คำตอบ:** Headroom ที่คำนวณได้คือ **${dtrHeadroomKva.toLocaleString()} kVA** — ตัวเลขนี้มาจากแบบจำลอง DTR ไม่ใช่การอนุมัติให้จ่ายโหลดเพิ่ม กรุณายืนยันกับอุณหภูมิ Hot-Spot จริง (ปัจจุบัน ${hotSpotTemp}°C, ขีดจำกัด 120°C) และสภาพโหลดหน้างานก่อนตัดสินใจทุกครั้ง\n\n💰 **การวิเคราะห์ความคุ้มค่า (Economic Arbitrage):**\n- การรันโหลดเพิ่ม 300 kVA เป็นเวลา 4 ชั่วโมง จะสร้างมูลค่าพลังงานไฟฟ้าประมาณ **+$132 USD**\n- ในขณะที่ค่าเสื่อมราคาของฉนวนกระดาษ (Aging Loss) เพิ่มขึ้นเพียง **-$0.85 USD** เท่านั้น ถือว่าคุ้มค่าอย่างยิ่ง\n- **คำแนะนำ:** แนะนำให้เปิดระบบ **Auto-Dispatch ONAF-1 Pre-Cooling** ไว้ล่วงหน้า 30 นาที เพื่อหน่วงอุณหภูมิไม่ให้พุ่งเร็วเกินไปครับ`
      } else if (text.includes('Bushing') || text.includes('บุชชิ่ง') || text.includes('tan delta')) {
        reply = (tanDeltaKnown || pdKnown)
          ? `### 🔌 การประเมินความเสี่ยงบุชชิ่ง\n**อ้างอิงเกณฑ์ IEEE C57.19.00 / IEC 60137:**\n\n1. **ค่าที่วัดได้จากหม้อแปลงเครื่องนี้:**\n   - tan δ = **${tanDeltaTxt}** (เกณฑ์: ปกติ < 0.5%, เริ่มเสื่อม 0.5–1.0%, อันตราย > 1.0%)\n   - Partial Discharge = **${pdTxt}**\n\n2. **ข้อควรระวัง:**\n   - ตัวเลขข้างต้นเป็นค่า ณ ขณะนี้เท่านั้น การประเมินความเสี่ยง Flashover ที่เชื่อถือได้ต้องดูแนวโน้มย้อนหลังและผลทดสอบ Doble ประจำปีประกอบด้วย\n   - หากค่า tan δ เกิน 1.0% หรือมีแนวโน้มเพิ่มเร็ว ให้ปรึกษาวิศวกรผู้รับผิดชอบเพื่อวางแผนทดสอบแบบ off-line`
          : `### 🔌 การประเมินความเสี่ยงบุชชิ่ง\n\n⚠️ **หม้อแปลง ${assetName} (${assetId}) เครื่องนี้ยังไม่ได้ติดตั้งเซนเซอร์วัดบุชชิ่ง** จึงไม่มีค่า tan δ หรือ PD จริงให้ประเมิน\n\n**ด้านล่างนี้คือ **ตัวอย่างจำลอง (worked example)** เพื่ออธิบายเกณฑ์เท่านั้น — ไม่ใช่ค่าของหม้อแปลงเครื่องนี้:**\n\n- ตัวอย่าง: tan δ = 0.82% → อยู่ในช่วง "เริ่มเสื่อม" (เกณฑ์ปกติ < 0.5%, เริ่มเสื่อม 0.5–1.0%, อันตราย > 1.0%)\n- ตัวอย่าง: PD = 195 pC → บ่งชี้รูปแบบ Void/Cavity Discharge\n\n**สิ่งที่ควรทำจริง:** ใช้ผลทดสอบ Doble/tan δ ประจำปีของหม้อแปลงเครื่องนี้เป็นเกณฑ์ หรือติดตั้งชุด Online Bushing Adapter เพื่อให้ระบบประเมินจากค่าจริงได้`
      } else if (text.includes('CMMS') || text.includes('ใบสั่งงาน') || text.includes('Work Order')) {
        reply = `### 📋 ร่างใบสั่งงานซ่อมบำรุง (CMMS Work Order Generated)\nระบบได้สร้างร่างใบสั่งงานฉบับสมบูรณ์สำหรับหม้อแปลง **${assetName}** เรียบร้อยแล้วครับ:\n\n- **Work Order ID:** \`WO-2026-0828-TR01\`\n- **Priority:** 🔴 HIGH PRIORITY (Urgent Maintenance Window)\n- **ชื่องาน:** ตรวจสอบหน้าสัมผัสขดลวด, ไล่ก๊าซ C₂H₂ และทดสอบ Dielectric บุชชิ่ง Phase B\n- **Safety Protocol:** LOTO 115 kV + Arc-Flash Category 4 PPE Checklist พร้อมแล้ว\n\nท่านสามารถคลิกปุ่มด้านล่างเพื่อเปิดดูและส่งเข้าระบบ CMMS / SAP PM ได้ทันทีครับ!`
        actionSuggestion = {
          label: '📑 เปิดดูใบสั่งงานซ่อมบำรุง (View Work Order)',
          action: () => setShowWorkOrderModal(true),
        }
      } else {
        reply = `ผมได้รับคำถามของท่านแล้วครับ สำหรับหม้อแปลง **${assetName} (${assetId})** ในประเด็นดังกล่าว:\n\nจากข้อมูลเซนเซอร์ล่าสุด อุณหภูมิน้ำมันอยู่ที่ **${oilTemp}°C**, ความชื้นในน้ำมัน **${moisturePpm} ppm**, และระดับความสมบูรณ์ของกระดาษฉนวนอยู่ที่ **${dpAging} DP** (ยังอยู่ในเกณฑ์ใช้งานได้ดี ไม่กรอบเปราะ)\n\nหากท่านต้องการดำเนินการเพิ่มเติม สามารถเลือกให้ระบบวิเคราะห์ Root Cause Analysis หรือสร้างใบสั่งงานซ่อมบำรุงให้ได้ทันทีครับ!`
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: reply,
        timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        actionSuggestion,
      }

      setMessages((prev) => [...prev, aiMsg])
      setIsTyping(false)
    }, 700)
  }

  return (
    <div className="rounded-2xl p-5 space-y-5 text-white" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Bot size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Industrial GenAI Diagnostics Copilot</h3>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 font-mono font-bold flex items-center gap-1">
                <Sparkles size={10} /> RULE-BASED · NOT A LIVE MODEL
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Pre-written IEEE/IEC guidance selected by keyword from your question — not a live model. Verify every figure against the readings before acting.
            </p>
          </div>
        </div>

        {/* Quick Action Button to Open Work Order */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWorkOrderModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5 shadow-sm"
          >
            <Wrench size={13} />
            <span>Generate CMMS Work Order</span>
          </button>
        </div>
      </div>

      {/* Preset Suggestions Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-[11px] text-slate-500 shrink-0">คำถามแนะนำ:</span>
        {PRESET_QUERIES.map((q) => (
          <button
            key={q.id}
            onClick={() => handleSend(q.prompt)}
            className="px-2.5 py-1 rounded-lg bg-[#0a0e1a] hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-500/50 text-slate-300 hover:text-white transition-all text-[11px] whitespace-nowrap shrink-0 flex items-center gap-1"
          >
            <span>{q.title}</span>
          </button>
        ))}
      </div>

      {/* Chat Messages Log Container */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#0a0e1a] h-96 overflow-y-auto space-y-4 text-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              'flex gap-2.5 max-w-[90%]',
              msg.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            )}
          >
            <div
              className={clsx(
                'w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-[10px]',
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
              )}
            >
              {msg.sender === 'user' ? 'ENG' : <Bot size={12} />}
            </div>

            <div className="space-y-1.5">
              <div
                className={clsx(
                  'p-3.5 rounded-2xl leading-relaxed whitespace-pre-wrap',
                  msg.sender === 'user'
                    ? 'bg-indigo-600/90 text-white rounded-tr-none'
                    : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-none'
                )}
              >
                {msg.text}

                {/* Optional Action Button embedded in message */}
                {msg.actionSuggestion && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800">
                    <button
                      onClick={msg.actionSuggestion.action}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5"
                    >
                      <span>{msg.actionSuggestion.label}</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                )}
              </div>
              <div className={clsx('text-[9px] text-slate-500 font-mono', msg.sender === 'user' ? 'text-right' : 'text-left')}>
                {msg.timestamp}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-slate-400 text-xs italic">
            <Bot size={14} className="animate-spin text-indigo-400" />
            <span>กำลังเลือกคำแนะนำที่ตรงกับคำถาม...</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder="พิมพ์คำถามเพื่อขอการวิเคราะห์ เช่น 'ทำไมก๊าซไฮโดรเจนถึงเพิ่ม?' หรือ 'ควรตั้งเวลาสลับโหลดกี่โมง?'..."
          className="flex-1 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none border border-slate-800 bg-[#0a0e1a] focus:border-indigo-500 transition-colors"
        />
        <button
          type="submit"
          disabled={!inputQuery.trim() || isTyping}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all flex items-center gap-1.5 shadow-sm"
        >
          <span>ส่งคำถาม</span>
          <Send size={13} />
        </button>
      </form>

      {/* ── CMMS Formal Work Order Modal ── */}
      {showWorkOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-2xl border border-indigo-500/50 bg-[#0d1117] p-5 space-y-4 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Automated CMMS Work Order Dispatch</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Ticket ID: WO-2026-0828-TR01 | Standard: IEEE C57.104</p>
                </div>
              </div>
              <button
                onClick={() => setShowWorkOrderModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Ticket Details */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0a0e1a] space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono border-b border-slate-800/80 pb-2.5">
                <div>
                  <span className="text-slate-500 block">Asset Target:</span>
                  <span className="text-white font-bold">{assetName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Priority:</span>
                  <span className="text-rose-400 font-bold">🔴 HIGH (Urgent)</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Lead Tech:</span>
                  <span className="text-slate-200">High-Voltage Substation Team A</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Target Window:</span>
                  <span className="text-amber-400 font-bold">Within 7 Days</span>
                </div>
              </div>

              {/* Task Checklist */}
              <div className="space-y-2">
                <span className="text-slate-400 font-semibold block text-[11px]">ลำดับขั้นตอนการปฏิบัติงาน (Step-by-Step Execution Checklist):</span>
                <div className="space-y-1.5 text-[11px]">
                  {[
                    '1. ปฏิบัติตามมาตรฐาน Lockout/Tagout (LOTO) ปลดสวิตช์แรงสูง 115 kV และต่อสายดิน (Grounding)',
                    '2. ทำการเก็บตัวอย่างน้ำมันไซริงค์ (ASTM D3612 Certified Lab Syringe) ส่งตรวจแล็บ SGS เพื่อยืนยัน C2H2 Baseline',
                    '3. ต่อเครื่องกรองน้ำมันสุญญากาศ (Vacuum Oil Purifier / Degasser) ไล่ก๊าซติดไฟจนต่ำกว่าขีดเตือน',
                    '4. ดำเนินการทดสอบ C1/C2 Sweep Frequency Dielectric Test ที่ Bushing Phase B ตามคำแนะนำ IEEE C57.19',
                    '5. บันทึกผลทดสอบลงในบันทึกอิเล็กทรอนิกส์ 21 CFR Part 11 Audit Trail',
                  ].map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-slate-300">
                      <CheckCircle2 size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Safety & PPE Protocol */}
              <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-950/15 text-amber-300 text-[11px] flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>ข้อกำหนดความปลอดภัย: สวมชุด Arc-Flash NFPA 70E Category 4, ถุงมือฉนวน Class 4 (36 kV), และเข็มขัดนิรภัยเต็มตัว</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Work Order: WO-2026-0828-TR01\nTarget: ${assetName}\nPriority: HIGH\nPrescription: C2H2 Degassing & Bushing Phase B C1/C2 sweep`)
                  toast.success('คัดลอกข้อมูลใบสั่งงานเรียบร้อยแล้ว!')
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1.5"
              >
                <Copy size={13} />
                <span>Copy Summary</span>
              </button>

              <button
                onClick={() => {
                  toast.success('ส่งใบสั่งงานเข้าสู่ระบบ SAP PM / Maximo เรียบร้อยแล้ว (Work Order #WO-2026-0828-TR01)')
                  setShowWorkOrderModal(false)
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center gap-1.5 shadow-md"
              >
                <Send size={13} />
                <span>🚀 Dispatch to CMMS / SAP</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
