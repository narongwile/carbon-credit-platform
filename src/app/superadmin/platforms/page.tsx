'use client'

import { useMemo, useState } from 'react'
import {
  PLATFORM_TEMPLATES,
  statusBadge,
  type PlatformTemplate,
  type PlatformType,
} from '@/lib/platforms'
import { organizations } from '@/lib/mockData'
import { getSitesByOrg } from '@/lib/fleetData'
import {
  Thermometer, Droplet, Zap, Plus, X, Check, ChevronLeft, ChevronRight,
  ToggleLeft, ToggleRight, Building2, Layers, CircleCheck, ArrowRight, Boxes, MapPin,
} from 'lucide-react'
import clsx from 'clsx'

const ICONS: Record<string, React.ElementType> = { Thermometer, Droplet, Zap }

function PlatformIcon({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  const Cmp = ICONS[name] ?? Boxes
  return <Cmp size={size} style={{ color }} />
}

// ---------------------------------------------------------------------------
// Provisioning wizard
// ---------------------------------------------------------------------------
type WizardForm = {
  platform: PlatformType | null
  customerMode: 'new' | 'existing'
  orgId: string
  orgName: string
  contactEmail: string
  country: string
  city: string
  licenseTier: 'basic' | 'professional' | 'enterprise'
  siteMode: 'existing' | 'new'
  siteId: string
  siteName: string
  features: Record<string, boolean>
}

const STEPS = ['Sensor Type', 'Customer', 'Features', 'Review'] as const

function ProvisionWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState<WizardForm>({
    platform: null,
    customerMode: 'new',
    orgId: organizations[0]?.id ?? '',
    orgName: '',
    contactEmail: '',
    country: 'Thailand',
    city: '',
    licenseTier: 'professional',
    siteMode: 'existing',
    siteId: '',
    siteName: '',
    features: {},
  })

  const orgSites = useMemo(() => getSitesByOrg(form.orgId), [form.orgId])

  const template = useMemo(
    () => PLATFORM_TEMPLATES.find((p) => p.id === form.platform) ?? null,
    [form.platform],
  )

  const selectPlatform = (p: PlatformTemplate) => {
    setForm((f) => ({
      ...f,
      platform: p.id,
      features: Object.fromEntries(p.features.map((feat, i) => [`${p.id}-f${i + 1}`, feat.defaultEnabled])),
    }))
  }

  const useExistingSite = form.customerMode === 'existing' && form.siteMode === 'existing' && orgSites.length > 0
  const siteChosen = useExistingSite ? !!form.siteId : form.siteName.trim().length > 1

  const canNext =
    step === 0 ? !!form.platform
    : step === 1 ? ((form.customerMode === 'existing' ? !!form.orgId : form.orgName.trim().length > 1) && siteChosen)
    : true

  const customerLabel =
    form.customerMode === 'existing'
      ? organizations.find((o) => o.id === form.orgId)?.name ?? '—'
      : form.orgName || '—'

  const siteLabel = useExistingSite
    ? orgSites.find((s) => s.id === form.siteId)?.name ?? '—'
    : form.siteName || '—'

  const enabledCount = Object.values(form.features).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 sticky top-0 z-10" style={{ background: '#0d1117', borderBottom: '1px solid #1e2433' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Layers size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Provision New Platform</h2>
              <p className="text-xs text-slate-500">Spin up a sensor platform for a customer organization</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="p-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: 'rgba(74,222,128,0.12)' }}>
              <CircleCheck size={34} className="text-green-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Platform Provisioned</h3>
            <p className="text-sm text-slate-400 max-w-sm">
              <span className="text-white font-medium">{template?.name}</span> is now active for{' '}
              <span className="text-white font-medium">{customerLabel}</span> with {enabledCount} feature
              {enabledCount === 1 ? '' : 's'} enabled.
            </p>
            <div className="flex gap-3 mt-7">
              <button onClick={onClose} className="px-6 py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Stepper */}
            <div className="flex items-center gap-2 px-6 py-4" style={{ borderBottom: '1px solid #1e2433' }}>
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 flex-1">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={
                      i < step ? { background: 'rgba(74,222,128,0.15)', color: '#4ade80' }
                      : i === step ? { background: '#6366f1', color: '#fff' }
                      : { background: '#0a0e1a', color: '#475569', border: '1px solid #1e2433' }
                    }
                  >
                    {i < step ? <Check size={12} /> : i + 1}
                  </div>
                  <span className={clsx('text-xs font-medium hidden sm:inline', i === step ? 'text-white' : 'text-slate-500')}>{label}</span>
                  {i < STEPS.length - 1 && <div className="h-px flex-1" style={{ background: '#1e2433' }} />}
                </div>
              ))}
            </div>

            <div className="p-6 min-h-[280px]">
              {/* Step 0 — sensor type */}
              {step === 0 && (
                <div className="space-y-3">
                  <label className="block text-xs text-slate-400 uppercase tracking-wider">Choose a sensor platform type</label>
                  {PLATFORM_TEMPLATES.map((p) => {
                    const active = form.platform === p.id
                    return (
                      <button
                        key={p.id}
                        onClick={() => selectPlatform(p)}
                        className="w-full text-left p-4 rounded-xl flex items-start gap-4 transition-all"
                        style={{ background: '#0a0e1a', border: `1px solid ${active ? p.accent : '#1e2433'}` }}
                      >
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${p.accent}1f` }}>
                          <PlatformIcon name={p.icon} color={p.accent} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{p.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ color: statusBadge[p.status].color, background: statusBadge[p.status].bg }}>
                              {statusBadge[p.status].label}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{p.sensorType}</div>
                        </div>
                        {active && <Check size={18} className="flex-shrink-0" style={{ color: p.accent }} />}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Step 1 — customer */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="flex rounded-lg p-1" style={{ background: '#0a0e1a' }}>
                    {(['new', 'existing'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setForm((f) => ({ ...f, customerMode: mode }))}
                        className={clsx('flex-1 py-2 rounded-md text-xs font-semibold capitalize transition-all', form.customerMode === mode ? 'text-white' : 'text-slate-500')}
                        style={form.customerMode === mode ? { background: '#6366f1' } : {}}
                      >
                        {mode === 'new' ? 'New Customer' : 'Existing Customer'}
                      </button>
                    ))}
                  </div>

                  {form.customerMode === 'existing' ? (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Organization</label>
                      <select
                        value={form.orgId}
                        onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))}
                        className="w-full rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
                        style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
                      >
                        {organizations.map((o) => (
                          <option key={o.id} value={o.id}>{o.name} — {o.city}, {o.country}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Organization Name" className="col-span-2" value={form.orgName} onChange={(v) => setForm((f) => ({ ...f, orgName: v }))} placeholder="e.g. Siriraj Hospital" />
                      <Field label="Contact Email" className="col-span-2" value={form.contactEmail} onChange={(v) => setForm((f) => ({ ...f, contactEmail: v }))} placeholder="ops@customer.com" />
                      <Field label="City" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} placeholder="Bangkok" />
                      <Field label="Country" value={form.country} onChange={(v) => setForm((f) => ({ ...f, country: v }))} />
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">License Tier</label>
                        <div className="flex gap-2">
                          {(['basic', 'professional', 'enterprise'] as const).map((tier) => (
                            <button
                              key={tier}
                              onClick={() => setForm((f) => ({ ...f, licenseTier: tier }))}
                              className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all', form.licenseTier === tier ? 'text-white' : 'text-slate-500')}
                              style={form.licenseTier === tier ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0a0e1a', border: '1px solid #1e2433' }}
                            >
                              {tier}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Target site + domain */}
                  <div className="pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5 uppercase tracking-wider"><MapPin size={12} /> Target Site</label>
                    {form.customerMode === 'existing' && orgSites.length > 0 && (
                      <div className="flex gap-2 mb-2">
                        {(['existing', 'new'] as const).map((m) => (
                          <button key={m} onClick={() => setForm((f) => ({ ...f, siteMode: m }))}
                            className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all', form.siteMode === m ? 'text-white' : 'text-slate-500')}
                            style={form.siteMode === m ? { background: 'rgba(99,102,241,0.2)', border: '1px solid #6366f1' } : { background: '#0a0e1a', border: '1px solid #1e2433' }}>
                            {m === 'existing' ? 'Existing site' : 'New site'}
                          </button>
                        ))}
                      </div>
                    )}
                    {useExistingSite ? (
                      <select value={form.siteId} onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
                        className="w-full rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                        <option value="">Select a site…</option>
                        {orgSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <input value={form.siteName} onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                        placeholder="New site name (e.g. Main Substation)"
                        className="w-full rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }} />
                    )}
                    {template && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-slate-500">Provisioned domain:</span>
                        <span className="px-2 py-0.5 rounded-full font-medium" style={{ color: template.accent, background: `${template.accent}1f` }}>{template.shortName} · {template.sensorType}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2 — features */}
              {step === 2 && template && (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">
                    {template.name} — feature entitlements
                  </label>
                  {template.features.map((feat, i) => {
                    const key = `${template.id}-f${i + 1}`
                    return (
                      <div key={key} className="flex items-center justify-between p-3 rounded-lg" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
                        <div>
                          <div className="text-sm text-slate-200">{feat.name}</div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-600">{feat.category}</div>
                        </div>
                        <button onClick={() => setForm((f) => ({ ...f, features: { ...f.features, [key]: !f.features[key] } }))}>
                          {form.features[key] ? <ToggleRight size={24} className="text-indigo-400" /> : <ToggleLeft size={24} className="text-slate-600" />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Step 3 — review */}
              {step === 3 && template && (
                <div className="space-y-3">
                  <ReviewRow icon={<PlatformIcon name={template.icon} color={template.accent} size={16} />} label="Platform" value={template.name} sub={template.sensorType} />
                  <ReviewRow icon={<Building2 size={16} className="text-indigo-400" />} label="Customer" value={customerLabel} sub={form.customerMode === 'new' ? `${form.licenseTier} · ${form.city || '—'}, ${form.country}` : 'Existing organization'} />
                  <ReviewRow icon={<MapPin size={16} className="text-cyan-400" />} label="Target Site" value={siteLabel} sub={useExistingSite ? 'Existing site' : 'New site will be created'} />
                  <ReviewRow icon={<ToggleRight size={16} className="text-green-400" />} label="Features Enabled" value={`${enabledCount} of ${template.features.length}`} sub={template.features.filter((_, i) => form.features[`${template.id}-f${i + 1}`]).map((f) => f.name).join(', ') || 'None'} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 p-6" style={{ borderTop: '1px solid #1e2433' }}>
              <button
                onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-all"
                style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
              >
                <ChevronLeft size={15} /> {step === 0 ? 'Cancel' : 'Back'}
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  onClick={() => canNext && setStep((s) => s + 1)}
                  disabled={!canNext}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  Next <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  onClick={() => setDone(true)}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)' }}
                >
                  <Check size={15} /> Provision Platform
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}
      />
    </div>
  )
}

function ReviewRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-sm font-semibold text-white">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Catalog page
// ---------------------------------------------------------------------------
export default function PlatformsPage() {
  const [wizard, setWizard] = useState(false)

  const tenantCount = (id: string) =>
    organizations.filter((o) => o.platforms.some((p) => p.platformId === id && p.licensed)).length

  // Map registry ids to the platformId used in mock organization data.
  const legacyId: Record<PlatformType, string> = {
    refrigerationDataLogger: 'carbonbox',
    bloodBox: 'bloodbox',
    eternityTransformers: 'eternity',
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Platform Catalog</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sensor-type platforms available to provision for customer organizations
          </p>
        </div>
        <button
          onClick={() => setWizard(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
        >
          <Plus size={15} /> Provision New Platform
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {PLATFORM_TEMPLATES.map((p) => (
          <div key={p.id} className="rounded-2xl p-5 flex flex-col" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${p.accent}1f` }}>
                <PlatformIcon name={p.icon} color={p.accent} size={20} />
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ color: statusBadge[p.status].color, background: statusBadge[p.status].bg }}>
                {statusBadge[p.status].label}
              </span>
            </div>

            <h3 className="text-sm font-bold text-white">{p.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{p.sensorType}</p>
            <p className="text-xs text-slate-400 mt-3 leading-relaxed flex-1">{p.description}</p>

            <div className="flex flex-wrap gap-1.5 mt-4">
              {p.metrics.map((m) => (
                <span key={m} className="text-[10px] px-2 py-0.5 rounded-md text-slate-400" style={{ background: '#0a0e1a', border: '1px solid #1e2433' }}>{m}</span>
              ))}
            </div>

            <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: '1px solid #1e2433' }}>
              <span className="text-xs text-slate-500">
                <span className="text-white font-semibold">{tenantCount(legacyId[p.id])}</span> tenant{tenantCount(legacyId[p.id]) === 1 ? '' : 's'}
              </span>
              {p.moduleRoute ? (
                <a href={p.moduleRoute} className="flex items-center gap-1 text-xs font-medium" style={{ color: p.accent }}>
                  Open module <ArrowRight size={13} />
                </a>
              ) : (
                <span className="text-xs text-slate-600">Module pending</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {wizard && <ProvisionWizard onClose={() => setWizard(false)} />}
    </div>
  )
}
