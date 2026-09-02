'use client'

import { MonitorSmartphone } from 'lucide-react'

/**
 * For a studio panel that SAVES what the engineer types, but saves it to
 * localStorage.
 *
 * a96fe4cc / 91dae605 "productionize[d]" the PdM studios "for multi-tenant
 * customer go-live" by giving five of them editable inputs — lab DGA
 * certificates, bushing nameplate baselines, RUL service hours, the TOU tariff
 * — persisted with localStorage.setItem and no API call anywhere. Those are the
 * inputs the studios turn into engineering verdicts: fault type, remaining life
 * in years, replacement budget, daily profit.
 *
 * localStorage cannot support any part of that claim. It is per BROWSER, not
 * per organization, so a colleague opening the same transformer sees the
 * built-in samples instead of the certificate their teammate entered; it is
 * lost when site data is cleared or the engineer uses another device; and
 * nothing server-side records who entered what.
 *
 * The DemoDataBanner beside this one says the SAMPLE rows are fabricated. That
 * was true before these commits and is still true. This says the separate thing
 * the edit forms introduced: what YOU save here does not leave this browser. An
 * engineer who types in a real lab certificate will otherwise reasonably assume
 * they have configured the platform.
 *
 * Remove this the moment the panel writes through an API instead — it is a
 * disclosure of a limitation, not a design.
 */
export default function LocalOnlyNotice({ what }: {
  /** What the operator is editing, in a few words, e.g. "ผลแล็บที่บันทึกเอง". */
  what: string
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3 text-[11px]"
      style={{ background: 'rgba(30,41,59,0.55)', border: '1px solid rgba(148,163,184,0.3)' }}
    >
      <div className="p-1.5 rounded-md text-slate-300 mt-0.5 flex-shrink-0" style={{ background: 'rgba(148,163,184,0.15)' }}>
        <MonitorSmartphone size={14} />
      </div>
      <div className="text-slate-300 leading-relaxed">
        <span className="font-semibold text-slate-200">{what} ถูกเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น</span>{' '}
        ยังไม่ได้บันทึกขึ้นระบบส่วนกลาง — เพื่อนร่วมงานที่เปิดหม้อแปลงเครื่องเดียวกันจะไม่เห็นข้อมูลนี้
        และข้อมูลจะหายเมื่อล้างข้อมูลเว็บไซต์หรือเปลี่ยนเครื่อง กรุณาเก็บสำเนาต้นฉบับไว้ต่างหาก
        และอย่าถือว่าค่านี้เป็นบันทึกอย่างเป็นทางการขององค์กร
      </div>
    </div>
  )
}
