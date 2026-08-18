'use client'

import { useState, useEffect, useRef } from 'react'
import { api, useIsLive } from '@/lib/api'
import { Mail, Sparkles, Send, Eye, ShieldAlert, RotateCcw, AlertTriangle, Smartphone, Monitor } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

export interface EmailTemplateConfig {
  subjectTemplate: string
  customHeaderNote?: string
  customFooterSop?: string
  includeActionLink?: boolean
  format?: 'html' | 'text'
}

const DEFAULT_TEMPLATE: EmailTemplateConfig = {
  subjectTemplate: '[{{severity}}] ONEOPS Alert: {{device_name}} - {{param_label}} ({{category}})',
  customHeaderNote: 'Attention: Automated priority alert triggered by ONEOPS Industrial IoT Monitoring System.',
  customFooterSop: 'SOP Protocol: For Critical Alarms (> 90°C / > 115%), contact Substation Control Room at 02-xxx-xxxx immediately and dispatch duty maintenance engineer.',
  includeActionLink: true,
  format: 'html',
}

const DYNAMIC_TOKENS = [
  { key: '{{device_name}}', label: 'Device Name / Asset', desc: 'e.g. TR-SUBSTATION-01' },
  { key: '{{severity}}', label: 'Alarm Severity', desc: 'CRITICAL / WARNING' },
  { key: '{{category}}', label: 'Category', desc: 'e.g. Thermal & Oil, Voltage' },
  { key: '{{param_label}}', label: 'Parameter Label', desc: 'e.g. Top Oil Temperature' },
  { key: '{{value}}', label: 'Trigger Value', desc: 'e.g. 92.5°C' },
  { key: '{{threshold}}', label: 'Alarm Limit', desc: 'e.g. 90.0°C' },
  { key: '{{risk_insight}}', label: 'Risk / Condition', desc: 'Engineering failure risk' },
  { key: '{{time}}', label: 'Timestamp', desc: '18/08/2026, 22:30:00 ICT' },
]

const PRESET_SUBJECTS = [
  { label: 'Standard Enterprise', val: '[{{severity}}] ONEOPS Alert: {{device_name}} - {{param_label}} ({{category}})' },
  { label: 'Urgent Dispatch', val: '🚨 URGENT [{{severity}}]: {{device_name}} reached {{value}} (Limit: {{threshold}})' },
  { label: 'Asset & Category', val: '[ALARM] {{category}} Alert on {{device_name}} - {{param_label}}' },
]

interface EmailTemplateConfiguratorProps {
  orgId: string
  orgName?: string
}

export default function EmailTemplateConfigurator({ orgId, orgName }: EmailTemplateConfiguratorProps) {
  const live = useIsLive()
  const [template, setTemplate] = useState<EmailTemplateConfig>(DEFAULT_TEMPLATE)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile' | 'plain'>('desktop')
  const [simulatedSeverity, setSimulatedSeverity] = useState<'CRITICAL' | 'WARNING'>('CRITICAL')

  const subjectRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLInputElement>(null)
  const sopRef = useRef<HTMLTextAreaElement>(null)
  const [activeField, setActiveField] = useState<'subject' | 'header' | 'sop'>('subject')

  useEffect(() => {
    if (!live) return
    let cancelled = false
    setLoading(true)
    api.emailTemplate(orgId).then((res) => {
      if (cancelled) return
      if (res && res.subjectTemplate) {
        setTemplate({
          subjectTemplate: res.subjectTemplate || DEFAULT_TEMPLATE.subjectTemplate,
          customHeaderNote: res.customHeaderNote ?? DEFAULT_TEMPLATE.customHeaderNote,
          customFooterSop: res.customFooterSop ?? DEFAULT_TEMPLATE.customFooterSop,
          includeActionLink: res.includeActionLink !== false,
          format: res.format || 'html',
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [live, orgId])

  const insertToken = (token: string) => {
    if (activeField === 'subject') {
      const el = subjectRef.current
      if (el) {
        const start = el.selectionStart || el.value.length
        const end = el.selectionEnd || el.value.length
        const next = el.value.slice(0, start) + token + el.value.slice(end)
        setTemplate(t => ({ ...t, subjectTemplate: next }))
        setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) }, 10)
      } else {
        setTemplate(t => ({ ...t, subjectTemplate: t.subjectTemplate + ' ' + token }))
      }
    } else if (activeField === 'header') {
      const el = headerRef.current
      if (el) {
        const start = el.selectionStart || el.value.length
        const end = el.selectionEnd || el.value.length
        const next = el.value.slice(0, start) + token + el.value.slice(end)
        setTemplate(t => ({ ...t, customHeaderNote: next }))
        setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) }, 10)
      } else {
        setTemplate(t => ({ ...t, customHeaderNote: (t.customHeaderNote || '') + ' ' + token }))
      }
    } else if (activeField === 'sop') {
      const el = sopRef.current
      if (el) {
        const start = el.selectionStart || el.value.length
        const end = el.selectionEnd || el.value.length
        const next = el.value.slice(0, start) + token + el.value.slice(end)
        setTemplate(t => ({ ...t, customFooterSop: next }))
        setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) }, 10)
      } else {
        setTemplate(t => ({ ...t, customFooterSop: (t.customFooterSop || '') + ' ' + token }))
      }
    }
  }

  const handleSave = async () => {
    if (!live) {
      toast.success('Email template preferences saved (demo)')
      return
    }
    setSaving(true)
    const res = await api.putEmailTemplate(orgId, template)
    setSaving(false)
    if (res && res.ok) {
      toast.success('Email Notification Template saved successfully!')
    } else {
      toast.error('Failed to save email template')
    }
  }

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      toast.error('Please enter a valid destination email address for testing')
      return
    }
    if (!live) {
      toast.success(`[Demo] Test email simulated to ${testEmail}`)
      return
    }
    setSendingTest(true)
    try {
      const res = await api.testEmailTemplate(orgId, {
        targetEmail: testEmail.trim(),
        subjectTemplate: template.subjectTemplate,
        customHeaderNote: template.customHeaderNote,
        customFooterSop: template.customFooterSop,
        includeActionLink: template.includeActionLink,
        format: template.format,
      })
      setSendingTest(false)
      if (res && res.ok) {
        toast.success(`Test email dispatched successfully to ${testEmail}!`)
      } else {
        toast.error((res as any)?.error || 'Could not send test email. Please check SMTP settings.')
      }
    } catch (err: any) {
      setSendingTest(false)
      toast.error(err?.message || 'Failed to dispatch test email')
    }
  }

  const handleResetDefault = () => {
    setTemplate(DEFAULT_TEMPLATE)
    toast.success('Reset template to standard industrial default')
  }

  // Simulated render variables for preview
  const sampleVars: Record<string, string> = {
    device_name: 'TR-SUBSTATION-01',
    node_id: 'TR-SUBSTATION-01',
    org_id: orgId,
    severity: simulatedSeverity,
    category: simulatedSeverity === 'CRITICAL' ? 'Thermal & Oil' : 'Voltage',
    param_label: simulatedSeverity === 'CRITICAL' ? 'Top Oil Temperature' : 'Phase A Voltage',
    param_key: simulatedSeverity === 'CRITICAL' ? 'oilTemp' : 'voltageA',
    value: simulatedSeverity === 'CRITICAL' ? '92.5°C' : '243.2V',
    threshold: simulatedSeverity === 'CRITICAL' ? '90.0°C' : '241.5V',
    risk_insight: simulatedSeverity === 'CRITICAL' ? 'Winding & insulation degradation risk (>90°C)' : 'Phase A voltage above nominal limit',
    time: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }) + ' (Asia/Bangkok)',
    org_name: orgName || 'ONEOPS Industrial',
  }

  const renderSimulated = (str?: string) => {
    if (!str) return ''
    return str.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => sampleVars[k] ?? '')
  }

  const previewSubject = renderSimulated(template.subjectTemplate)
  const previewHeader = renderSimulated(template.customHeaderNote)
  const previewSop = renderSimulated(template.customFooterSop)
  const sevColor = simulatedSeverity === 'CRITICAL' ? '#ef4444' : '#f59e0b'

  return (
    <div className="rounded-xl p-5 space-y-6" style={surface}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Mail size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Email Alarm Template &amp; Custom Message</h2>
              <span className="text-[10px] px-2 py-0.5 rounded font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 uppercase">
                Enterprise Best Practice
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Customize subject lines, emergency action SOPs, and notification formats with dynamic placeholders.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-all"
            style={inset}
          >
            <RotateCcw size={13} /> Reset Default
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-sm"
            style={gradient}
          >
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>

      {/* Main Grid: Config Form (Left) & Live Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Config Form (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Dynamic Placeholders Toolbar */}
          <div className="rounded-lg p-3 space-y-2" style={inset}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Sparkles size={14} className="text-indigo-400" />
                <span>Dynamic Tokens (Click to insert into active field):</span>
              </div>
              <span className="text-[10px] text-slate-500">Active: <strong className="text-indigo-300 uppercase">{activeField}</strong></span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DYNAMIC_TOKENS.map((token) => (
                <button
                  key={token.key}
                  type="button"
                  onClick={() => insertToken(token.key)}
                  title={`${token.label} — ${token.desc}`}
                  className="px-2.5 py-1 rounded text-xs font-mono font-medium text-indigo-300 bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/40 transition-colors"
                >
                  {token.key}
                </button>
              ))}
            </div>
          </div>

          {/* Subject Line Template */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Email Subject Template
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 mr-1">Presets:</span>
                {PRESET_SUBJECTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setTemplate(t => ({ ...t, subjectTemplate: p.val }))}
                    className="text-[10px] px-2 py-0.5 rounded text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <input
              ref={subjectRef}
              type="text"
              value={template.subjectTemplate}
              onFocus={() => setActiveField('subject')}
              onChange={(e) => setTemplate(t => ({ ...t, subjectTemplate: e.target.value }))}
              placeholder="[{{severity}}] ONEOPS Alert: {{device_name}} - {{param_label}} ({{category}})"
              className="w-full rounded-lg px-3.5 py-2.5 text-sm text-white font-mono placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            />
            <p className="text-[11px] text-slate-500">
              The subject line seen by email clients. Placeholders are dynamically populated on alarm trigger.
            </p>
          </div>

          {/* Custom Header / Notice */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Header Notice / Broadcast Banner (Optional)
            </label>
            <input
              ref={headerRef}
              type="text"
              value={template.customHeaderNote || ''}
              onFocus={() => setActiveField('header')}
              onChange={(e) => setTemplate(t => ({ ...t, customHeaderNote: e.target.value }))}
              placeholder="e.g. Priority Alert from Industrial Substation Monitoring Unit"
              className="w-full rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            />
            <p className="text-[11px] text-slate-500">
              Renders as an announcement strip above the parameter reading table in the email card.
            </p>
          </div>

          {/* Custom SOP / Emergency Action Protocol Message */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-rose-400" />
                Emergency SOP / Action Protocol Message
              </label>
            </div>
            <textarea
              ref={sopRef}
              rows={3}
              value={template.customFooterSop || ''}
              onFocus={() => setActiveField('sop')}
              onChange={(e) => setTemplate(t => ({ ...t, customFooterSop: e.target.value }))}
              placeholder="e.g. SOP: For Critical Alarms (> 90°C / > 115%), contact Substation Control Room at 02-xxx-xxxx immediately."
              className="w-full rounded-lg p-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
              style={inset}
            />
            <p className="text-[11px] text-slate-500">
              Displayed prominently in an emergency alert box inside the email so duty staff know immediate actions.
            </p>
          </div>

          {/* Options: CTA Action Link & Format */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {/* CTA Button Toggle */}
            <div
              onClick={() => setTemplate(t => ({ ...t, includeActionLink: !t.includeActionLink }))}
              className={clsx(
                'flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border',
                template.includeActionLink ? 'border-indigo-500/40 bg-indigo-950/20' : 'border-slate-800 bg-slate-900/30'
              )}
            >
              <div>
                <div className="text-xs font-semibold text-slate-200">Action CTA Button</div>
                <div className="text-[10px] text-slate-400">Direct &quot;Open Device &amp; Ack&quot; link</div>
              </div>
              <input
                type="checkbox"
                checked={template.includeActionLink !== false}
                onChange={() => {}}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
              />
            </div>

            {/* Email Format Mode */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-900/30">
              <div>
                <div className="text-xs font-semibold text-slate-200">Email Format</div>
                <div className="text-[10px] text-slate-400">Card vs Plain text</div>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setTemplate(t => ({ ...t, format: 'html' }))}
                  className={clsx(
                    'px-2.5 py-1 font-semibold transition-colors',
                    template.format !== 'text' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  )}
                >
                  HTML
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate(t => ({ ...t, format: 'text' }))}
                  className={clsx(
                    'px-2.5 py-1 font-semibold transition-colors',
                    template.format === 'text' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  )}
                >
                  Text
                </button>
              </div>
            </div>
          </div>

          {/* Test Email Dispatch Box */}
          <div className="rounded-lg p-3.5 space-y-2 border border-slate-800 bg-slate-900/40">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Send size={13} className="text-indigo-400" />
              Verify &amp; Send Live Test Email
            </label>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="duty.engineer@company.com"
                className="w-full sm:flex-1 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                style={inset}
              />
              <button
                type="button"
                onClick={handleSendTest}
                disabled={sendingTest}
                className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {sendingTest ? 'Sending...' : 'Send Test Alert'}
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              Dispatches a simulated alarm using your configured SMTP service and template.
            </p>
          </div>
        </div>

        {/* Right Column: Live Interactive Email Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye size={15} className="text-indigo-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Live Email Preview</h3>
            </div>
            <div className="flex items-center gap-2">
              {/* Severity Simulator Toggle */}
              <div className="flex rounded-md overflow-hidden border border-slate-800 text-[10px]">
                <button
                  type="button"
                  onClick={() => setSimulatedSeverity('CRITICAL')}
                  className={clsx(
                    'px-2 py-0.5 font-bold transition-colors',
                    simulatedSeverity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border-r border-slate-800' : 'bg-slate-900 text-slate-500'
                  )}
                >
                  CRITICAL
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatedSeverity('WARNING')}
                  className={clsx(
                    'px-2 py-0.5 font-bold transition-colors',
                    simulatedSeverity === 'WARNING' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-900 text-slate-500'
                  )}
                >
                  WARNING
                </button>
              </div>

              {/* View Mode Toggle */}
              <div className="flex rounded-md overflow-hidden border border-slate-800 text-slate-400">
                <button
                  type="button"
                  onClick={() => setPreviewMode('desktop')}
                  title="Desktop View"
                  className={clsx('p-1', previewMode === 'desktop' ? 'bg-indigo-600 text-white' : 'bg-slate-900 hover:text-white')}
                >
                  <Monitor size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('mobile')}
                  title="Mobile View"
                  className={clsx('p-1', previewMode === 'mobile' ? 'bg-indigo-600 text-white' : 'bg-slate-900 hover:text-white')}
                >
                  <Smartphone size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* Email Container Mockup */}
          <div
            className={clsx(
              'rounded-xl border border-slate-800 overflow-hidden shadow-2xl transition-all duration-300 mx-auto',
              previewMode === 'mobile' ? 'max-w-[340px]' : 'w-full'
            )}
            style={{ background: '#070a13' }}
          >
            {/* Email Client Header Bar */}
            <div className="bg-[#0f1422] border-b border-slate-800 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Subject:</span>
                <span className="text-white font-semibold truncate font-mono text-[11px]">{previewSubject || '(Empty Subject)'}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>From: <strong className="text-slate-300">alerts@oneops.local</strong></span>
                <span>To: <strong className="text-slate-300">operations-team@corp.net</strong></span>
              </div>
            </div>

            {/* Email Body Content */}
            {template.format === 'text' || previewMode === 'plain' ? (
              /* Plain text preview */
              <div className="p-4 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed bg-[#0a0e1a]">
                {`[${simulatedSeverity}] ${sampleVars.param_label}
Category: ${sampleVars.category}
Device: ${sampleVars.device_name}
Value: ${sampleVars.value} (Limit: ${sampleVars.threshold})
Risk: ${sampleVars.risk_insight}
Time: ${sampleVars.time}

${previewHeader ? `Notice: ${previewHeader}\n\n` : ''}${previewSop ? `SOP Protocol:\n${previewSop}\n\n` : ''}${template.includeActionLink ? `Open device: https://oneops.app/admin/nodes/detail/?id=${sampleVars.device_name}` : ''}`}
              </div>
            ) : (
              /* HTML Card Preview */
              <div className="p-3 bg-[#0a0e1a]">
                <div className="rounded-lg border border-slate-800 overflow-hidden bg-[#0d1117] shadow-lg">
                  {/* Alarm Card Banner */}
                  <div className="p-3.5 text-white" style={{ background: sevColor }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                      {simulatedSeverity} · {sampleVars.category}
                    </div>
                    <div className="text-base font-extrabold mt-0.5">
                      {sampleVars.param_label}
                    </div>
                  </div>

                  {/* Header Note Strip */}
                  {previewHeader ? (
                    <div className="bg-indigo-950/60 border-b border-indigo-900/50 px-3 py-2 text-xs text-indigo-200 flex items-start gap-1.5">
                      <span className="shrink-0">📌</span>
                      <span className="leading-snug">{previewHeader}</span>
                    </div>
                  ) : null}

                  {/* Metrics Table */}
                  <div className="p-3.5 space-y-2.5 text-xs">
                    <div className="grid grid-cols-3 py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Device Asset</span>
                      <span className="col-span-2 text-white font-mono font-semibold">{sampleVars.device_name}</span>
                    </div>
                    <div className="grid grid-cols-3 py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Trigger Value</span>
                      <span className="col-span-2 font-bold font-mono text-sm" style={{ color: sevColor }}>
                        {sampleVars.value}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Alarm Limit</span>
                      <span className="col-span-2 text-slate-300 font-mono">{sampleVars.threshold}</span>
                    </div>
                    <div className="grid grid-cols-3 py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Risk Insight</span>
                      <span className="col-span-2 text-amber-400 font-medium leading-tight">
                        💡 {sampleVars.risk_insight}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 py-1">
                      <span className="text-slate-400">Timestamp</span>
                      <span className="col-span-2 text-slate-400 text-[11px]">{sampleVars.time}</span>
                    </div>

                    {/* Custom SOP Emergency Callout */}
                    {previewSop ? (
                      <div className="mt-3 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs space-y-1">
                        <div className="font-bold text-rose-400 flex items-center gap-1.5">
                          <ShieldAlert size={14} />
                          Emergency Response / SOP Protocol:
                        </div>
                        <div className="leading-relaxed text-[11px] text-rose-100/90 whitespace-pre-wrap">
                          {previewSop}
                        </div>
                      </div>
                    ) : null}

                    {/* CTA Button */}
                    {template.includeActionLink !== false ? (
                      <div className="mt-3.5 pt-1 text-center">
                        <button
                          type="button"
                          className="w-full py-2 px-4 rounded-lg text-xs font-bold text-white shadow-md transition-transform active:scale-95"
                          style={gradient}
                        >
                          Open Device &amp; Acknowledge
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Footer */}
                  <div className="bg-[#070a12] border-t border-slate-800/80 px-3 py-2 text-[10px] text-slate-500 text-center">
                    Automated alert from ONEOPS Unified Industrial Monitoring Platform.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
