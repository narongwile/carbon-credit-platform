'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { organizations } from '@/lib/mockData'
import {
  Save,
  Upload,
  Trash2,
  Building2,
  MapPin,
  Camera,
  Paperclip,
  Settings2,
  BellRing,
  Mail,
  MessageCircle,
  Send,
  MessagesSquare,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  Sliders,
  Navigation,
  Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { api, isLive, apiImageUrl } from '@/lib/api'
import { getSession } from '@/lib/auth'
import AdminBulkApplyAlarmEditor from '@/components/device/AdminBulkApplyAlarmEditor'
import KindCatalogEditor from '@/components/device/KindCatalogEditor'
import { useKindCatalog } from '@/lib/useKindCatalog'
import { useReverseAddress } from '@/lib/geoAddress'
import { defaultNotificationChannels } from '@/lib/orgData'
import { DOMAIN_META, type SensorDomain } from '@/types/fleet'
import type { KindScope } from '@/lib/api'
import type { NotificationChannelConfig } from '@/types/org'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }

const channelIcon: Record<string, any> = {
  email: Mail,
  line: MessageCircle,
  telegram: Send,
  googlechat: MessagesSquare,
}

export default function SettingsPage() {
  const { selectedOrgId, realtimeEnabled, toggleRealtime, orgLogos, setOrgLogo, setOrgName } = useAppStore()
  const logoRef = useRef<HTMLInputElement>(null)
  const orgName = organizations.find((o) => o.id === selectedOrgId)?.name ?? 'Organization'

  // Tab State
  const [activeTab, setActiveTab] = useState<'branding' | 'alarms' | 'notifications' | 'catalogs'>('branding')

  // Domain selection for alarm baseline
  const [alarmDomain, setAlarmDomain] = useState<SensorDomain>('transformer')

  // Photo/document type catalogs (migrate-v40)
  const [managingScope, setManagingScope] = useState<KindScope | null>(null)
  const photoKinds = useKindCatalog(selectedOrgId, 'photo')
  const docKinds = useKindCatalog(selectedOrgId, 'document')

  // Editable display name
  const [brandName, setBrandName] = useState('')
  const currentLogo = orgLogos[selectedOrgId]

  // Location state
  const [orgLat, setOrgLat] = useState<number | null>(null)
  const [orgLng, setOrgLng] = useState<number | null>(null)
  const [savedLoc, setSavedLoc] = useState(false)
  // Reverse geocoded address verification for factory location
  const { address: factoryAddress, loading: addressLoading } = useReverseAddress(orgLat, orgLng)

  // System preferences state
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [autoAck, setAutoAck] = useState(false)
  const [savedPref, setSavedPref] = useState(false)

  // Notification delivery channels live status
  const [channels, setChannels] = useState<NotificationChannelConfig[]>(defaultNotificationChannels)

  useEffect(() => {
    // Mock fallback so the name field is never blank in demo mode.
    setBrandName(organizations.find((o) => o.id === selectedOrgId)?.name ?? '')
    if (!isLive()) return
    api.orgs().then((orgs) => {
      const org = orgs?.find((o) => o.id === selectedOrgId)
      if (!org) return
      if (org.name) setBrandName(org.name)
      if (org.lat != null && org.lng != null) {
        setOrgLat(org.lat)
        setOrgLng(org.lng)
      }
    })
  }, [selectedOrgId])

  // Load live organization delivery channels
  useEffect(() => {
    if (!isLive() || !selectedOrgId) return
    api.orgChannels(selectedOrgId).then((rows) => {
      if (rows && rows.length > 0) {
        setChannels(
          defaultNotificationChannels.map((dc) => {
            const row = rows.find((r) => r.channel === dc.id)
            if (row) {
              return {
                ...dc,
                enabled: !!row.enabled,
                target: row.target || '',
                minSeverity: (row.min_severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING') as 'WARNING' | 'CRITICAL',
              }
            }
            return dc
          })
        )
      }
    })
  }, [selectedOrgId])

  // Summary badge for delivery channels
  const activeChannelsBadge = useMemo(() => {
    const activeCount = channels.filter((c) => c.enabled).length
    const getStatus = (id: string) => (channels.find((c) => c.id === id)?.enabled ? 'ON' : 'OFF')
    return `${activeCount}/4 Channels Active (Telegram: ${getStatus('telegram')}, Google Chat: ${getStatus('googlechat')}, Email: ${getStatus('email')}, LINE: ${getStatus('line')})`
  }, [channels])

  const onLogo = (file?: File) => {
    if (!file) return
    if (file.size > 512 * 1024) {
      toast.error('Logo too large (max 512 KB)')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      const prev = orgLogos[selectedOrgId]
      setOrgLogo(selectedOrgId, dataUrl)
      if (isLive()) {
        const r = await api.updateOrgBranding(selectedOrgId, { logoUrl: dataUrl })
        if (!r) {
          setOrgLogo(selectedOrgId, prev ?? '')
          toast.error('Failed to save the logo')
          return
        }
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
      if (!r) {
        setOrgLogo(selectedOrgId, prev ?? '')
        toast.error('Failed to remove the logo')
        return
      }
    }
    toast.success('Logo removed')
  }

  // Fast GPS pinning from current position
  const [gettingLoc, setGettingLoc] = useState(false)
  const useCurrentLocationAsFactory = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return
    }
    setGettingLoc(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGettingLoc(false)
        const lat = Number(pos.coords.latitude.toFixed(7))
        const lng = Number(pos.coords.longitude.toFixed(7))
        setOrgLat(lat)
        setOrgLng(lng)
        toast.success(`Pinned factory to current GPS: ${lat}, ${lng}`)
      },
      (err) => {
        setGettingLoc(false)
        toast.error('Could not get GPS location: ' + err.message)
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  const saveLocation = async () => {
    if ((orgLat == null) !== (orgLng == null)) {
      toast.error('Enter both latitude and longitude, or clear both')
      return
    }
    if (isLive()) {
      const r = await api.updateOrgBranding(selectedOrgId, { lat: orgLat, lng: orgLng })
      if (!r) {
        toast.error('Failed to save the factory location')
        return
      }
    }
    setSavedLoc(true)
    setTimeout(() => setSavedLoc(false), 2000)
    // orgLat/orgLng are captured into locals right where the guard above has
    // already confirmed both are set — `orgLat == null` alone doesn't let TS
    // narrow orgLng too, since the two are only linked by the equal-nullness
    // check earlier in the function, not by this expression itself.
    if (orgLat == null || orgLng == null) {
      toast.success('Factory location cleared')
    } else {
      const lat = orgLat, lng = orgLng
      toast.success(
        factoryAddress
          ? `Factory location saved: ${factoryAddress.split(',')[0]} (${lat.toFixed(4)}, ${lng.toFixed(4)})`
          : `Factory location saved (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      )
    }
  }

  const saveBrandName = async () => {
    const name = brandName.trim()
    if (!name) {
      toast.error('Organization name cannot be empty')
      return
    }
    setOrgName(selectedOrgId, name)
    if (isLive()) {
      const r = await api.updateOrgBranding(selectedOrgId, { name })
      if (!r) {
        toast.error('Failed to save organization name')
        return
      }
    }
    toast.success('Organization name updated')
  }

  const saveSystemPreferences = async () => {
    const user = getSession()
    if (!user) {
      toast.error('Not logged in')
      return
    }
    if (isLive()) {
      const current = (await api.getMyConfig(user.id))?.prefs ?? {}
      const ok = await api.putMyConfig(user.id, { ...current, emailAlerts })
      if (!ok) {
        toast.error('Could not save user preferences')
        return
      }
    }
    setSavedPref(true)
    toast.success('System preferences saved')
    setTimeout(() => setSavedPref(false), 2000)
  }

  const inputStyle = {
    background: '#0a0e1a',
    border: '1px solid #1e2433',
    color: 'white',
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings2 className="text-indigo-400" size={22} />
            <span>Settings &amp; Configuration</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Organization branding, factory location, alarm baseline thresholds, and system preferences for{' '}
            <strong className="text-indigo-300">{orgName}</strong>
          </p>
        </div>

        {/* Quick jump to Notifications */}
        <Link
          href="/admin/notifications"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition-all shadow-sm shrink-0"
        >
          <BellRing size={14} className="text-indigo-400" />
          <span>Notification Operations Center</span>
          <ArrowRight size={13} />
        </Link>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        {[
          { id: 'branding', label: 'Branding & Factory', icon: Building2 },
          { id: 'alarms', label: 'Alarm Thresholds Baseline', icon: Sliders },
          { id: 'notifications', label: 'Delivery Channels & System', icon: BellRing },
          { id: 'catalogs', label: 'Photo & Document Types', icon: Camera },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as any)}
            className={clsx(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap',
              activeTab === id
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-850'
            )}
            style={activeTab !== id ? surface : {}}
          >
            <Icon size={14} className={activeTab === id ? 'text-white' : 'text-slate-400'} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: BRANDING & FACTORY */}
      {activeTab === 'branding' && (
        <div className="space-y-6">
          <div className="rounded-xl p-5" style={surface}>
            <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <Building2 size={16} className="text-indigo-400" />
              <span>Organization Branding</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Logo and display name shown in the sidebar for {orgName} — replaces the default platform branding for this
              organization.
            </p>

            {/* Display name */}
            <div className="mb-5 max-w-md">
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider font-semibold">
                Organization Display Name
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  maxLength={120}
                  placeholder="ONEOPS"
                  className="flex-1 px-3 py-2 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  style={inputStyle}
                />
                <button
                  onClick={saveBrandName}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white shadow-sm transition-all"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  <Save size={13} />
                  <span>Save Name</span>
                </button>
              </div>
            </div>

            {/* Logo Upload */}
            <div className="flex items-center gap-5 pt-3 border-t border-slate-800/80">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0"
                style={{
                  background: currentLogo ? '#0a0e1a' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  border: '1px solid #1e2433',
                }}
              >
                {currentLogo ? (
                  <img
                    src={currentLogo.startsWith('/api') ? apiImageUrl(currentLogo) : currentLogo}
                    alt="logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Building2 size={32} className="text-white" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => logoRef.current?.click()}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-white shadow-sm transition-all"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    <Upload size={14} />
                    <span>{currentLogo ? 'Change Logo' : 'Upload Logo'}</span>
                  </button>
                  {currentLogo && (
                    <button
                      onClick={removeLogo}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-rose-400 transition-colors"
                      style={inset}
                    >
                      <Trash2 size={13} />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-slate-500">PNG / SVG / JPG · square format recommended (max 512 KB)</span>
              </div>
            </div>
          </div>

          {/* Factory Location Picker */}
          <div className="rounded-xl p-5" style={surface}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <MapPin size={20} className="text-indigo-400 shrink-0" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white">Factory &amp; Facility Location</h3>
                    {orgLat != null && orgLng != null ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-mono">
                        {orgLat.toFixed(5)}, {orgLng.toFixed(5)}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-800/60 font-medium">
                        No Location Pinned
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fallback coordinates used for asset maps and telemetry devices without GPS sensors.
                  </p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={useCurrentLocationAsFactory}
                  disabled={gettingLoc}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 transition-all shadow-sm disabled:opacity-50"
                  title="Detect GPS position and pin factory here immediately"
                >
                  <Navigation size={13} className={clsx(gettingLoc && 'animate-spin text-cyan-400')} />
                  <span>{gettingLoc ? 'Detecting GPS…' : 'Use Current Location'}</span>
                </button>
                {orgLat != null && (
                  <button
                    type="button"
                    onClick={() => {
                      setOrgLat(null)
                      setOrgLng(null)
                      toast.success('Factory location pin cleared')
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
                    title="Clear pinned location"
                  >
                    <Trash2 size={12} />
                    <span>Clear Pin</span>
                  </button>
                )}
              </div>
            </div>

            {/* LocationPicker with Search, My Location (radar pulse), Satellite & Streets switcher */}
            <LocationPicker
              lat={orgLat}
              lng={orgLng}
              onChange={(lat, lng) => {
                setOrgLat(lat)
                setOrgLng(lng)
              }}
              height="360px"
              showSearch={true}
              showMyLocation={true}
              showLayerSwitcher={true}
              defaultLayer="streets"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-semibold">
                  Latitude
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  min={-90}
                  max={90}
                  value={orgLat ?? ''}
                  onChange={(e) =>
                    setOrgLat(e.target.value === '' ? null : Math.max(-90, Math.min(90, Number(e.target.value))))
                  }
                  placeholder="13.7563000"
                  className="w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-semibold">
                  Longitude
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  min={-180}
                  max={180}
                  value={orgLng ?? ''}
                  onChange={(e) =>
                    setOrgLng(e.target.value === '' ? null : Math.max(-180, Math.min(180, Number(e.target.value))))
                  }
                  placeholder="100.5018000"
                  className="w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Real-time Location Verification Box */}
            {orgLat != null && orgLng != null && (
              <div className="mt-4 p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-white">ข้อมูลสถานที่ที่ปักหมุด (Pinned Location Details)</span>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-mono">
                    {orgLat.toFixed(6)}, {orgLng.toFixed(6)}
                  </span>
                </div>

                <div className="flex items-start gap-2.5 pt-1 text-xs">
                  <MapPin size={16} className="text-indigo-400 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1">
                    {addressLoading ? (
                      <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <Loader2 size={13} className="animate-spin text-cyan-400" />
                        <span>กำลังค้นหาชื่อสถานที่และที่อยู่จริง (Resolving address from GPS)…</span>
                      </div>
                    ) : factoryAddress ? (
                      <>
                        <div className="text-indigo-200 font-semibold text-sm leading-relaxed">
                          📍 {factoryAddress}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-0.5">
                          <span className="text-emerald-400 font-semibold">✓ ข้อมูลสถานที่ถูกต้อง</span>
                          <span>· พิกัดนี้จะถูกนำไปใช้เป็นศูนย์กลางโรงงานสำหรับหม้อแปลงและอุปกรณ์ทุกตัวที่ไม่มี GPS</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-slate-400 text-xs">
                        <span>พิกัด {orgLat.toFixed(6)}, {orgLng.toFixed(6)} (ไม่มีข้อมูลชื่อสถานที่จากฐานข้อมูลแผนที่สาธารณะ)</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-800/80">
              <button
                onClick={saveLocation}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white shadow-sm transition-all"
                style={
                  savedLoc
                    ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' }
                    : { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }
                }
              >
                <Save size={13} />
                <span>{savedLoc ? 'Saved!' : 'Save Factory Location'}</span>
              </button>
              <span className="text-[11px] text-slate-500">
                {orgLat == null
                  ? 'No pin set — GPS-less devices will not appear on the map.'
                  : 'Coordinates safely applied to all devices reporting without native GPS.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALARM THRESHOLDS BASELINE */}
      {activeTab === 'alarms' && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={surface}>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders size={16} className="text-indigo-400" />
                <span>Industrial Fleet Alarm Threshold Baseline</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                ISA-18.2 rationalized parameter catalog and threshold tuning across devices in this organization.
              </p>
            </div>

            {/* Domain Tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
              {(['transformer', 'carbonNode', 'bloodBox', 'automobile'] as const).map((d) => {
                const meta = DOMAIN_META[d]
                const active = alarmDomain === d
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAlarmDomain(d)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                      active ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
                    )}
                  >
                    {meta?.platform || d}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Full-width Admin Bulk Apply Alarm Editor */}
          <div className="rounded-xl p-5" style={surface}>
            <AdminBulkApplyAlarmEditor domain={alarmDomain} orgId={selectedOrgId} />
          </div>
        </div>
      )}

      {/* TAB 3: NOTIFICATION DELIVERY CHANNELS & SYSTEM PREFERENCES */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          {/* Notification Channels Overview Card */}
          <div className="rounded-xl p-5 space-y-4" style={surface}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BellRing size={16} className="text-indigo-400" />
                  <span>Official Notification Delivery Channels</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Live alert delivery destinations (Telegram, Google Chat, LINE, Email) configured for this organization.
                </p>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{activeChannelsBadge}</span>
              </div>
            </div>

            {/* 4 Channels Grid Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {channels.map((ch) => {
                const Icon = channelIcon[ch.id] || Mail
                return (
                  <div
                    key={ch.id}
                    className="p-3 rounded-xl border space-y-1.5 transition-all"
                    style={{
                      background: '#0a0e1a',
                      borderColor: ch.enabled ? '#6366f1' : '#1e2433',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon size={14} className={ch.enabled ? 'text-indigo-400' : 'text-slate-500'} />
                        <span className="text-xs font-semibold text-white">{ch.name}</span>
                      </div>
                      <span
                        className={clsx(
                          'text-[10px] px-1.5 py-0.2 rounded font-bold uppercase',
                          ch.enabled ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-500'
                        )}
                      >
                        {ch.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate" title={ch.target || 'Not configured'}>
                      {ch.target || <span className="italic text-slate-600">No destination set</span>}
                    </p>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-800/60">
                      <span>Min: {ch.minSeverity}</span>
                      {ch.enabled && <CheckCircle2 size={11} className="text-emerald-400" />}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Action Banner to Notifications Page */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30">
              <div className="flex items-center gap-2.5">
                <ShieldCheck size={18} className="text-indigo-400 shrink-0" />
                <span className="text-xs text-indigo-200">
                  Manage department overrides, per-user routing, test triggers, and emergency SOP templates in the dedicated Notification Manager.
                </span>
              </div>
              <Link
                href="/admin/notifications?tab=channels"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all shrink-0"
              >
                <span>Open Notification Manager</span>
                <ExternalLink size={12} />
              </Link>
            </div>
          </div>

          {/* System Preferences Card */}
          <div className="rounded-xl p-5 space-y-4" style={surface}>
            <div className="pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings2 size={16} className="text-indigo-400" />
                <span>System Preferences</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                User session preferences and real-time interface telemetry behavior.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Real-time Data */}
              <div className="p-3.5 rounded-xl border border-slate-800 flex items-center justify-between" style={inset}>
                <div>
                  <div className="text-xs font-semibold text-white">Real-time Data Stream</div>
                  <div className="text-[11px] text-slate-500">Live sensor WebSocket updates</div>
                </div>
                <button type="button" onClick={toggleRealtime} className="transition-transform hover:scale-105">
                  <div
                    className={clsx(
                      'w-9 h-5 rounded-full relative transition-colors',
                      realtimeEnabled ? 'bg-indigo-600' : 'bg-slate-700'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        realtimeEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </button>
              </div>

              {/* Email Alerts */}
              <div className="p-3.5 rounded-xl border border-slate-800 flex items-center justify-between" style={inset}>
                <div>
                  <div className="text-xs font-semibold text-white">Personal Critical Email Alerts</div>
                  <div className="text-[11px] text-slate-500">Direct emails for critical alerts</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailAlerts(!emailAlerts)}
                  className="transition-transform hover:scale-105"
                >
                  <div
                    className={clsx(
                      'w-9 h-5 rounded-full relative transition-colors',
                      emailAlerts ? 'bg-indigo-600' : 'bg-slate-700'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        emailAlerts ? 'translate-x-4.5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </button>
              </div>

              {/* Auto-acknowledge */}
              <div className="p-3.5 rounded-xl border border-slate-800 flex items-center justify-between" style={inset}>
                <div>
                  <div className="text-xs font-semibold text-white">Auto-Acknowledge</div>
                  <div className="text-[11px] text-slate-500">Auto-ack resolved alarms after 24h</div>
                </div>
                <button type="button" onClick={() => setAutoAck(!autoAck)} className="transition-transform hover:scale-105">
                  <div
                    className={clsx(
                      'w-9 h-5 rounded-full relative transition-colors',
                      autoAck ? 'bg-indigo-600' : 'bg-slate-700'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        autoAck ? 'translate-x-4.5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={saveSystemPreferences}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white shadow-sm transition-all"
                style={
                  savedPref
                    ? { background: 'rgba(74,222,128,0.2)', color: '#4ade80', border: '1px solid #4ade80' }
                    : { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }
                }
              >
                <Save size={13} />
                <span>{savedPref ? 'Saved!' : 'Save System Preferences'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PHOTO & DOCUMENT TYPES */}
      {activeTab === 'catalogs' && (
        <div className="rounded-xl p-5" style={surface}>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Camera size={16} className="text-indigo-400" />
            <span>Photo &amp; Document Classification Catalogs</span>
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            The categories offered when operators upload asset photos or maintenance documentation. Built-in types can
            be renamed or hidden; add your own custom categories as needed.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { scope: 'photo' as const, icon: <Camera size={13} />, title: 'Photo types', cat: photoKinds },
              { scope: 'document' as const, icon: <Paperclip size={13} />, title: 'Document types', cat: docKinds },
            ].map(({ scope, icon, title, cat }) => {
              const hidden = cat.all.length - cat.options.length
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setManagingScope(scope)}
                  className="text-left rounded-xl p-4 transition-colors hover:border-indigo-500/50"
                  style={inset}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-indigo-400">{icon}</span>
                    <span className="text-xs font-bold text-white">{title}</span>
                    <span className="ml-auto text-[10px] text-slate-400">
                      {cat.options.length} offered{hidden > 0 ? ` · ${hidden} hidden` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cat.options.slice(0, 8).map((k) => (
                      <span
                        key={k.key}
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ color: '#94a3b8', background: 'rgba(148,163,184,0.1)' }}
                      >
                        {k.label}
                      </span>
                    ))}
                    {cat.options.length > 8 && (
                      <span className="text-[10px] text-slate-500">+{cat.options.length - 8}</span>
                    )}
                  </div>
                  <div className="text-[10px] font-semibold text-indigo-400 mt-3 flex items-center gap-1">
                    <span>Manage Categories</span>
                    <ArrowRight size={11} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {managingScope && (
        <KindCatalogEditor
          orgId={selectedOrgId}
          scope={managingScope}
          onClose={() => setManagingScope(null)}
          onChanged={() => {
            photoKinds.reload()
            docKinds.reload()
          }}
        />
      )}
    </div>
  )
}
