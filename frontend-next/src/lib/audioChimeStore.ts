'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ChimeStyle = 'subtle' | 'industrial' | 'urgent'
export type ChimeTriggerType = 'conflict' | 'critical' | 'warning'

export interface OrgAudioSettings {
  enabled: boolean
  volume: number // 0.0 to 1.0 (default 0.3)
  alertOnConflict: boolean
  alertOnCritical: boolean
  alertOnWarning: boolean
  chimeStyle: ChimeStyle
  cooldownSec: number // minimum seconds between chimes to prevent spam
}

export /**
 * One AudioContext for the whole tab, created on first chime.
 *
 * This used to be `new AudioCtx()` on every single chime, with nothing ever
 * calling close(). An AudioContext holds a real audio-hardware connection and
 * browsers cap how many a document may have open (Chrome has long capped it
 * around six); past the cap the constructor throws. The throw landed in the
 * catch below, which returns false silently — so after a handful of alarms the
 * audible annunciator simply stopped working for the rest of the session, with
 * no error surfaced and no way for the operator to know the sound they were
 * relying on had gone away. Reusing one context also keeps the browser's
 * autoplay unlock (the resume() below) rather than needing it per context.
 */
let __sharedAudioCtx: AudioContext | null = null
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (__sharedAudioCtx && __sharedAudioCtx.state !== 'closed') return __sharedAudioCtx
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return null
  try {
    __sharedAudioCtx = new AudioCtx()
  } catch {
    return null
  }
  return __sharedAudioCtx
}

const DEFAULT_AUDIO_SETTINGS: OrgAudioSettings = {
  enabled: true,
  volume: 0.35,
  alertOnConflict: true,
  alertOnCritical: true,
  alertOnWarning: false,
  chimeStyle: 'subtle',
  cooldownSec: 20,
}

interface AudioChimeState {
  // Org ID -> Settings mapping
  orgSettings: Record<string, OrgAudioSettings>
  // Last played timestamp per org to enforce cooldown
  lastPlayedAt: Record<string, number>
  
  // Actions
  getSettingsForOrg: (orgId: string) => OrgAudioSettings
  updateOrgSettings: (orgId: string, patch: Partial<OrgAudioSettings>) => void
  applyToAllOrgs: (sourceOrgId: string, allOrgIds: string[]) => void
  playChime: (orgId: string, type: ChimeTriggerType) => boolean
}

export const useAudioChimeStore = create<AudioChimeState>()(
  persist(
    (set, get) => ({
      orgSettings: {
        'org-1': { ...DEFAULT_AUDIO_SETTINGS },
        'org-2': { ...DEFAULT_AUDIO_SETTINGS },
        'eternity': { ...DEFAULT_AUDIO_SETTINGS },
      },
      lastPlayedAt: {},

      getSettingsForOrg: (orgId: string) => {
        const current = get().orgSettings[orgId]
        if (current) return current
        return { ...DEFAULT_AUDIO_SETTINGS }
      },

      updateOrgSettings: (orgId: string, patch: Partial<OrgAudioSettings>) => {
        set((state) => {
          const prev = state.orgSettings[orgId] || { ...DEFAULT_AUDIO_SETTINGS }
          return {
            orgSettings: {
              ...state.orgSettings,
              [orgId]: { ...prev, ...patch },
            },
          }
        })
      },

      applyToAllOrgs: (sourceOrgId: string, allOrgIds: string[]) => {
        const source = get().getSettingsForOrg(sourceOrgId)
        set((state: AudioChimeState) => {
          const updated = { ...state.orgSettings }
          for (const id of allOrgIds) {
            updated[id] = { ...source }
          }
          return { orgSettings: updated }
        })
      },

      playChime: (orgId: string, type: ChimeTriggerType) => {
        if (typeof window === 'undefined') return false
        const settings = get().getSettingsForOrg(orgId)
        if (!settings.enabled) return false

        // Check trigger filters
        if (type === 'conflict' && !settings.alertOnConflict) return false
        if (type === 'critical' && !settings.alertOnCritical) return false
        if (type === 'warning' && !settings.alertOnWarning) return false

        // Check cooldown
        const now = Date.now()
        const last = get().lastPlayedAt[orgId] || 0
        if (now - last < settings.cooldownSec * 1000) {
          return false // In cooldown period to prevent audio fatigue
        }

        try {
          const ctx = getAudioContext()
          if (!ctx) return false
          if (ctx.state === 'suspended') {
            ctx.resume()
          }

          const nowSec = ctx.currentTime
          const gain = ctx.createGain()
          gain.gain.setValueAtTime(Math.min(1.0, Math.max(0.01, settings.volume)), nowSec)

          if (settings.chimeStyle === 'urgent' || type === 'conflict') {
            // Rapid double-beep: 880Hz -> 660Hz -> 880Hz
            const osc = ctx.createOscillator()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(880, nowSec)
            osc.frequency.setValueAtTime(659.25, nowSec + 0.1)
            osc.frequency.setValueAtTime(880, nowSec + 0.2)
            gain.gain.exponentialRampToValueAtTime(0.001, nowSec + 0.45)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(nowSec)
            osc.stop(nowSec + 0.45)
          } else if (settings.chimeStyle === 'industrial') {
            // Lower, warm industrial bell: 440Hz -> 554.37Hz
            const osc = ctx.createOscillator()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(440, nowSec)
            osc.frequency.setValueAtTime(554.37, nowSec + 0.15)
            gain.gain.exponentialRampToValueAtTime(0.001, nowSec + 0.5)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(nowSec)
            osc.stop(nowSec + 0.5)
          } else {
            // Subtle, clean two-tone chime: 587.33Hz (D5) -> 880Hz (A5)
            const osc = ctx.createOscillator()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(587.33, nowSec)
            osc.frequency.setValueAtTime(880, nowSec + 0.12)
            gain.gain.exponentialRampToValueAtTime(0.001, nowSec + 0.4)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(nowSec)
            osc.stop(nowSec + 0.4)
          }

          set((state: AudioChimeState) => ({
            lastPlayedAt: { ...state.lastPlayedAt, [orgId]: now },
          }))
          return true
        } catch {
          // Autoplay policy or unsupported
          return false
        }
      },
    }),
    {
      name: 'carbon_audio_chime_settings',
      partialize: (state: AudioChimeState) => ({ orgSettings: state.orgSettings }),
    }
  )
)
