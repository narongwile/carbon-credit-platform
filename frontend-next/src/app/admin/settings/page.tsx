'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import { organizations } from '@/lib/mockData'
import { Save, Upload, Trash2, Building2, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, isLive } from '@/lib/api'
import { getSession } from '@/lib/auth'
import { defaultNodeRule } from '@/lib/alarmParams'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

export default function SettingsPage() {
  const { selectedOrgId, getTransformersByOrg, realtimeEnabled, toggleRealtime, orgLogos, setOrgLogo } = useAppStore()
  const transformers = getTransformersByOrg(selectedOrgId)
  const [selectedId, setSelectedId] = useState(transformers[0]?.id || '')
  const logoRef = useRef<HTMLInputElement>(null)
  const orgName = organizations.find((o) => o.id === selectedOrgId)?.name ?? 'Organization'
  const currentLogo = orgLogos[selectedOrgId]
  const onLogo = (file?: File) => {
    if (!file) return
    if (file.size > 512 * 1024) { toast.error('Logo too large (max 512 KB)'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      setOrgLogo(selectedOrgId, dataUrl)                                  // instant local UX
      if (isLive()) await api.updateOrgBranding(selectedOrgId, dataUrl) // persist per-company
      toast.success('Organization logo updated')
    }
    reader.readAsDataURL(file)
  }
  const removeLogo = async () => {
    setOrgLogo(selectedOrgId, '')
    if (isLive()) await api.updateOrgBranding(selectedOrgId, '')
    toast.success('Logo removed')
  }
  const [thresholds, setThresholds] = useState({
    oilTempWarn: 80,
    oilTempCrit: 95,
    hydrogenWarn: 150,
    hydrogenCrit: 300,
    moistureWarn: 25,
    moistureCrit: 35,
    oilLevelWarn: 70,
    oilLevelCrit: 60,
    loadWarn: 80,
    loadCrit: 95,
  })
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [autoAck, setAutoAck] = useState(false)
  const [saved, setSaved] = useState(false)

  const [orgLat, setOrgLat] = useState<number | null>(null)
  const [orgLng, setOrgLng] = useState<number | null>(null)

  useEffect(() => {
    if (!isLive()) return
    api.orgs().then(orgs => {
      const org = orgs?.find(o => o.id === selectedOrgId)
      if (org && org.lat != null && org.lng != null) {
        setOrgLat(org.lat)
        setOrgLng(org.lng)
      }
    })
  }, [selectedOrgId])

  // Convert the flat threshold form into a real NodeAlarmRule the alarm engine
  // consumes (params[]), starting from the transformer schema defaults so the
  // rule stays complete (windingTemp/direction/unit/rate) and only the edited
  // warn/critical are overridden. Without this the org save would overwrite every
  // node's rule_json with a params-less shape and silence the engine.
  const buildTransformerRule = () => {
    const rule = defaultNodeRule('transformer')
    const overrides: Record<string, { warn: number; critical: number }> = {
      oilTemp: { warn: thresholds.oilTempWarn, critical: thresholds.oilTempCrit },
      hydrogen: { warn: thresholds.hydrogenWarn, critical: thresholds.hydrogenCrit },
      moisture: { warn: thresholds.moistureWarn, critical: thresholds.moistureCrit },
      oilLevel: { warn: thresholds.oilLevelWarn, critical: thresholds.oilLevelCrit },
      load: { warn: thresholds.loadWarn, critical: thresholds.loadCrit },
    }
    return {
      ...rule,
      params: rule.params.map((p) => (overrides[p.key] ? { ...p, ...overrides[p.key] } : p)),
      autoAck,
    }
  }

  const save = async () => {
    try {
      const user = getSession()
      if (!user) throw new Error('Not logged in')
      const ruleRes = await api.updateOrgRule(selectedOrgId, buildTransformerRule())
      if (!ruleRes) throw new Error('Failed to update org rule')
      const res = await api.putMyConfig(user.id, { emailAlerts })
      if (!res) throw new Error('API request failed')
      
      if (isLive() && orgLat != null && orgLng != null) {
        await api.updateOrgLocation(selectedOrgId, orgLat, orgLng)
      }

      setSaved(true)
      toast.success('Settings saved')
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      toast.error(e.message || 'Failed to save settings')
    }
  }

  const inputStyle = {
    background: '#0a0e1a',
    border: '1px solid #1e2433',
    color: 'white',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Organization branding, thresholds and system preferences</p>
      </div>

      {/* Organization logo */}
      <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <h3 className="text-sm font-semibold text-white mb-1">Organization Logo</h3>
        <p className="text-[11px] text-slate-500 mb-4">Upload your organization&apos;s logo. It appears in the sidebar for {orgName}.</p>
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0" style={{ background: currentLogo ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: '1px solid #1e2433' }}>
            {currentLogo ? <img src={currentLogo} alt="logo" className="w-full h-full object-contain" /> : <Building2 size={30} className="text-white" />}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            <button onClick={() => logoRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Upload size={15} /> {currentLogo ? 'Change Logo' : 'Upload Logo'}
            </button>
            {currentLogo && (
              <button onClick={removeLogo} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-red-400" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                <Trash2 size={14} /> Remove
              </button>
            )}
            <span className="text-[10px] text-slate-600">PNG / SVG / JPG · square works best</span>
          </div>
        </div>

        <div className="rounded-xl p-5 md:col-span-2 lg:col-span-1" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={18} className="text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Factory Location</h3>
              <p className="text-xs text-slate-500">Fallback location for Eternity sensors without GPS</p>
            </div>
          </div>
          <LocationPicker 
            lat={orgLat} 
            lng={orgLng} 
            onChange={(lat, lng) => { setOrgLat(lat); setOrgLng(lng) }} 
            height="160px"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          {/* Transformer selector */}
          <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Select Transformer</h3>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              style={inputStyle}
            >
              {transformers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.location}</option>
              ))}
            </select>
          </div>

          {/* Thresholds */}
          <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-4">Alarm Thresholds</h3>
            <div className="space-y-4">
              {[
                { label: 'Oil Temperature', warnKey: 'oilTempWarn', critKey: 'oilTempCrit', unit: '°C' },
                { label: 'Hydrogen H2', warnKey: 'hydrogenWarn', critKey: 'hydrogenCrit', unit: 'ppm' },
                { label: 'Moisture', warnKey: 'moistureWarn', critKey: 'moistureCrit', unit: 'ppm' },
                { label: 'Oil Level (min)', warnKey: 'oilLevelWarn', critKey: 'oilLevelCrit', unit: '%' },
                { label: 'Load', warnKey: 'loadWarn', critKey: 'loadCrit', unit: '%' },
              ].map((item) => (
                <div key={item.label} className="grid grid-cols-3 gap-4 items-center">
                  <div className="text-sm text-slate-300">{item.label}</div>
                  <div>
                    <label className="block text-[10px] text-amber-400 mb-1">Warning ({item.unit})</label>
                    <input
                      type="number"
                      value={thresholds[item.warnKey as keyof typeof thresholds]}
                      onChange={(e) => setThresholds((p) => ({ ...p, [item.warnKey]: +e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-1 focus:ring-amber-500"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-red-400 mb-1">Critical ({item.unit})</label>
                    <input
                      type="number"
                      value={thresholds[item.critKey as keyof typeof thresholds]}
                      onChange={(e) => setThresholds((p) => ({ ...p, [item.critKey]: +e.target.value }))}
                      className="w-full px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-1 focus:ring-red-500"
                      style={inputStyle}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={save}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: saved ? 'rgba(74,222,128,0.2)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: saved ? '#4ade80' : 'white' }}
          >
            <Save size={16} />
            {saved ? 'Saved!' : 'Save Thresholds'}
          </button>
        </div>

        {/* System settings */}
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">System Preferences</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-300">Real-time Data</div>
                  <div className="text-xs text-slate-600">Live sensor updates</div>
                </div>
                <button onClick={toggleRealtime} className="transition-transform hover:scale-110">
                  <div className={`w-10 h-5 rounded-full relative transition-colors ${realtimeEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${realtimeEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-300">Email Alerts</div>
                  <div className="text-xs text-slate-600">Critical alarm emails</div>
                </div>
                <button onClick={() => setEmailAlerts(!emailAlerts)} className="transition-transform hover:scale-110">
                  <div className={`w-10 h-5 rounded-full relative transition-colors ${emailAlerts ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${emailAlerts ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-300">Auto-acknowledge</div>
                  <div className="text-xs text-slate-600">After 24 hours</div>
                </div>
                <button onClick={() => setAutoAck(!autoAck)} className="transition-transform hover:scale-110">
                  <div className={`w-10 h-5 rounded-full relative transition-colors ${autoAck ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoAck ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-3">Data Retention</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Raw sensor data</span>
                <span className="text-white">90 days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Aggregated data</span>
                <span className="text-white">5 years</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Alarm history</span>
                <span className="text-white">Unlimited</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Reports</span>
                <span className="text-white">2 years</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
