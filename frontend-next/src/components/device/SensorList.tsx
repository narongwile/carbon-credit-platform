'use client'

// ---------------------------------------------------------------------------
// The compact row a "list"-tier parameter renders as (migrate-v37).
// ---------------------------------------------------------------------------
// A full SensorCard — icon, big number, sparkline, status pill — is the right
// amount of space for the handful of values someone actually watches. A merged
// two-topic transformer reports twenty-odd others that just need to be
// glanceable and checkable, which is what this is: one line, name left, value
// right, click for the same history + threshold editor the cards open.
// ---------------------------------------------------------------------------

export interface ListRowItem {
  key: string
  label: string
  /** Pass a string when the caller already formatted it (FixDashboard's tiles do); a number is formatted here. */
  value: number | string
  unit?: string
  status?: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE'
}

const STATUS_COLOR: Record<NonNullable<ListRowItem['status']>, string> = {
  NORMAL: '#4ade80', WARNING: '#fbbf24', CRITICAL: '#ef4444', OFFLINE: '#6b7280',
}

export default function SensorListSection({
  title, items, onOpen,
}: {
  /** Heading, with the count appended — e.g. "Other parameters". Omit for no heading. */
  title?: string
  items: ListRowItem[]
  onOpen: (key: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
      {title && (
        <div className="px-3 py-2 text-[10px] text-slate-600 uppercase tracking-wider" style={{ borderBottom: '1px solid #1e2433' }}>
          {title} ({items.length})
        </div>
      )}
      {items.map((it) => {
        const flagged = it.status && it.status !== 'NORMAL'
        return (
          <button key={it.key} type="button" onClick={() => onOpen(it.key)}
            title={`Open ${it.label} history`}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
            style={{ borderBottom: '1px solid #1e2433' }}>
            <span className="text-[11px] text-slate-400 truncate min-w-0">{it.label}</span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              {flagged && (
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[it.status!] }} title={it.status} />
              )}
              <span className="text-xs font-semibold text-white tabular-nums">
                {typeof it.value === 'number' ? (Number.isFinite(it.value) ? it.value.toFixed(1) : '—') : it.value}
              </span>
              {it.unit && <span className="text-[10px] text-slate-600">{it.unit}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
