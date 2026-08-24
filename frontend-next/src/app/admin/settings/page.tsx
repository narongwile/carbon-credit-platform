'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import { organizations } from '@/lib/mockData'
import { Save, Upload, Trash2, Building2, MapPin, Camera, Paperclip, Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, isLive, apiImageUrl } from '@/lib/api'
import { getSession } from '@/lib/auth'
import AlarmParamConfig from '@/components/device/AlarmParamConfig'
import KindCatalogEditor from '@/components/device/KindCatalogEditor'
import { useKindCatalog } from '@/lib/useKindCatalog'
import type { KindScope } from '@/lib/api'
import type { NodeAlarmRule } from '@/server/alarmEngine'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

export default function SettingsPage() {
  const { selectedOrgId, realtimeEnabled, toggleRealtime, orgLogos, setOrgLogo, setOrgName } = useAppStore()
  const logoRef = useRef<HTMLInputElement>(null)
  const orgName = organizations.find((o) => o.id === selectedOrgId)?.name ?? 'Organization'
  // Photo/document type catalogs (migrate-v40) — org-wide configuration, so
  // this page is their home; the pickers themselves also link straight here
  // via their own "Manage…" button for whoever is standing at the upload.
  const [managingScope, setManagingScope] = useState<KindScope | null>(null)
  const photoKinds = useKindCatalog(selectedOrgId, 'photo')
  const docKinds = useKindCatalog(selectedOrgId, 'document')
  // Editable display name — what the sidebar shows beside the logo instead of
  // "ONEOPS". Seeded from the organizations table (live) or the mock org name.
  const [brandName, setBrandName] = useState('')
  const currentLogo = orgLogos[selectedOrgId]
  // The result of the save was ignored, so a rejected upload still painted the
  // logo and only a refresh revealed it had never been stored — which is exactly
  // how the 64 KB column overflow stayed invisible. Roll back and say so.
  const onLogo = (file?: File) => {
    if (!file) return
    if (file.size > 512 * 1024) { toast.error('Logo too large (max 512 KB)'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      const prev = orgLogos[selectedOrgId]
      setOrgLogo(selectedOrgId, dataUrl)                                  // instant local UX
      if (isLive()) {
        const r = await api.updateOrgBranding(selectedOrgId, { logoUrl: dataUrl })
        if (!r) { setOrgLogo(selectedOrgId, prev ?? ''); toast.error('Failed to save the logo'); return }
        // Re-read what the backend actually stored (a served path, not the data
        // URL), so this session shows the same thing the next reload will.
        const orgs = await api.orgs()
        const mine = orgs?.find((o) => o.id === selectedOrgId)
        if (mine?.logo_url) setOrgLogo(selectedOrgId, mine.logo_url)
      }
      toast.success('Organization logo updated')
    }
    reader.readAsDataURL(file)
  }
  const removeLogo = async () => {
    const prev = orgLogos[selectedOrgId]
    setOrgLogo(selectedOrgId, '')
    if (isLive()) {
      const r = await api.updateOrgBranding(selectedOrgId, { logoUrl: '' })
      if (!r) { setOrgLogo(selectedOrgId, prev ?? ''); toast.error('Failed to remove the logo'); return }
    }
    toast.success('Logo removed')
  }
  // Dropping a pin and typing coordinates both only moved React state — the
  // write happened in the page-wide Save button far below, past the whole
  // thresholds section. That is also inconsistent with the two controls beside
  // it (the logo persists on upload, the name has its own button), so it was
  // easy to set a location, navigate away, and lose it without any warning.
  const [savedLoc, setSavedLoc] = useState(false)
  const saveLocation = async () => {
    if ((orgLat == null) !== (orgLng == null)) { toast.error('Enter both latitude and longitude, or clear both'); return }
    if (isLive()) {
      // updateOrgBranding (partial) rather than updateOrgLocation: it accepts
      // null, so clearing the pin is possible instead of being silently skipped.
      const r = await api.updateOrgBranding(selectedOrgId, { lat: orgLat, lng: orgLng })
      if (!r) { toast.error('Failed to save the factory location'); return }
    }
    setSavedLoc(true); setTimeout(() => setSavedLoc(false), 2000)
    toast.success(orgLat == null ? 'Factory location cleared' : 'Factory location saved')
  }

  const saveBrandName = async () => {
    const name = brandName.trim()
    if (!name) { toast.error('Organization name cannot be empty'); return }
    setOrgName(selectedOrgId, name)                                       // sidebar updates instantly
    if (isLive()) {
      const r = await api.updateOrgBranding(selectedOrgId, { name })
      if (!r) { toast.error('Failed to save organization name'); return }
    }
    toast.success('Organization name updated')
  }
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [autoAck, setAutoAck] = useState(false)
  const [saved, setSaved] = useState(false)

  const [orgLat, setOrgLat] = useState<number | null>(null)
  const [orgLng, setOrgLng] = useState<number | null>(null)

  useEffect(() => {
    // Mock fallback so the name field is never blank in demo mode.
    setBrandName(organizations.find((o) => o.id === selectedOrgId)?.name ?? '')
    if (!isLive()) return
    api.orgs().then(orgs => {
      const org = orgs?.find(o => o.id === selectedOrgId)
      if (!org) return
      if (org.name) setBrandName(org.name)
      if (org.lat != null && org.lng != null) {
        setOrgLat(org.lat)
        setOrgLng(org.lng)
      }
    })
  }, [selectedOrgId])

  // Each write is independent and its result is checked. Before, the factory pin
  // was saved LAST and behind two calls that throw, so a failing alarm-rule write
  // silently discarded the coordinate and reported an unrelated error — and the
  // pin's own result was never looked at, so a rejected save still said "Saved".
  const save = async () => {
    const user = getSession()
    if (!user) { toast.error('Not logged in'); return }
    const failed: string[] = []
    if (isLive()) {
      if (orgLat != null && orgLng != null) {
        if (!(await api.updateOrgLocation(selectedOrgId, orgLat, orgLng))) failed.push('factory location')
      }
      if (!(await api.putMyConfig(user.id, { emailAlerts }))) failed.push('preferences')
    }
    if (failed.length) { toast.error('Could not save: ' + failed.join(', ')); return }
    setSaved(true)
    toast.success('Settings saved')
    setTimeout(() => setSaved(false), 2000)
  }

  // Org-wide alarm baseline, applied across every transformer in this org —
  // same endpoint and pattern as admin/notifications' Alarm & Notify editor.
  const applyOrgRule = async (rule: NodeAlarmRule) => {
    if (isLive()) {
      const r = await api.putOrgRule(selectedOrgId, { rule })
      if (!r) { toast.error('Could not save the alarm thresholds'); return }
    }
    toast.success('Alarm thresholds saved for all transformers')
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

      {/* Photo & document types — the two upload dropdowns, per organization */}
      <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Settings2 size={14} className="text-indigo-400" /> Photo &amp; document types
        </h3>
        <p className="text-[11px] text-slate-500 mb-4">
          The lists offered when someone uploads a photo of a unit or a maintenance document. Built-in types can be
          renamed or hidden; add your own for anything this organization files that is not covered.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([
            { scope: 'photo' as const, icon: <Camera size={13} />, title: 'Photo types', cat: photoKinds },
            { scope: 'document' as const, icon: <Paperclip size={13} />, title: 'Document types', cat: docKinds },
          ]).map(({ scope, icon, title, cat }) => {
            const hidden = cat.all.length - cat.options.length
            return (
              <button key={scope} onClick={() => setManagingScope(scope)}
                className="text-left rounded-lg p-3.5 transition-colors hover:border-indigo-500/40"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-indigo-400">{icon}</span>
                  <span className="text-xs font-medium text-white">{title}</span>
                  <span className="ml-auto text-[10px] text-slate-500">
                    {cat.options.length} offered{hidden > 0 ? ` · ${hidden} hidden` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {cat.options.slice(0, 8).map((k) => (
                    <span key={k.key} className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ color: '#94a3b8', background: 'rgba(148,163,184,0.1)' }}>{k.label}</span>
                  ))}
                  {cat.options.length > 8 && <span className="text-[10px] text-slate-600">+{cat.options.length - 8}</span>}
                </div>
                <div className="text-[10px] text-indigo-400 mt-2">Manage&hellip;</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Organization branding */}
      <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        <h3 className="text-sm font-semibold text-white mb-1">Organization Branding</h3>
        <p className="text-[11px] text-slate-500 mb-4">Logo and display name shown in the sidebar for {orgName} — replaces the ONEOPS default for this organization only.</p>

        {/* Display name */}
        <div className="mb-4 max-w-md">
          <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Organization Name</label>
          <div className="flex items-center gap-2">
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              maxLength={120}
              placeholder="ONEOPS"
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              style={inputStyle}
            />
            <button onClick={saveBrandName} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Save size={13} /> Save
            </button>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0" style={{ background: currentLogo ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: '1px solid #1e2433' }}>
            {currentLogo ? <img src={currentLogo.startsWith('/api') ? apiImageUrl(currentLogo) : currentLogo} alt="logo" className="w-full h-full object-contain" /> : <Building2 size={30} className="text-white" />}
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
          {/* Typed coordinates — surveyors hand over lat/lng as numbers, and a
              map pin alone cannot be entered to that precision. Kept in sync
              with the picker both ways. */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Latitude</label>
              <input
                type="number" step="0.0000001" min={-90} max={90}
                value={orgLat ?? ''}
                onChange={(e) => setOrgLat(e.target.value === '' ? null : Math.max(-90, Math.min(90, Number(e.target.value))))}
                placeholder="13.7563000"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Longitude</label>
              <input
                type="number" step="0.0000001" min={-180} max={180}
                value={orgLng ?? ''}
                onChange={(e) => setOrgLng(e.target.value === '' ? null : Math.max(-180, Math.min(180, Number(e.target.value))))}
                placeholder="100.5018000"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                style={inputStyle}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={saveLocation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
              style={savedLoc ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80' } : { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Save size={13} /> {savedLoc ? 'Saved!' : 'Save Location'}
            </button>
            <span className="text-[10px] text-slate-600">
              {orgLat == null ? 'No pin set — GPS-less devices will not appear on the map.' : 'Applied to Eternity devices that report no GPS.'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          {/* Org-wide alarm baseline — same editor as admin/notifications' Alarm
              & Notify tab, so both pages read/write the one saved rule instead
              of this page silently maintaining its own disconnected copy. */}
          <div className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <h3 className="text-sm font-semibold text-white mb-4">Alarm Thresholds</h3>
            <AlarmParamConfig domain="transformer" orgId={selectedOrgId} onApplyAll={applyOrgRule} />
          </div>

          <button
            onClick={save}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: saved ? 'rgba(74,222,128,0.2)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: saved ? '#4ade80' : 'white' }}
          >
            <Save size={16} />
            {saved ? 'Saved!' : 'Save Preferences'}
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
        </div>
      </div>

      {managingScope && (
        <KindCatalogEditor orgId={selectedOrgId} scope={managingScope}
          onClose={() => setManagingScope(null)}
          onChanged={() => { photoKinds.reload(); docKinds.reload() }} />
      )}
    </div>
  )
}
