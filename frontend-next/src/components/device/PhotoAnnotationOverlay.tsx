'use client'

// ---------------------------------------------------------------------------
// The markers, drawn over the photo — at any size, in any view.
// ---------------------------------------------------------------------------
// Annotations are stored normalised (0..1) against the IMAGE, so this overlay
// only lands on target if it is laid over exactly the image's rendered pixels.
// Two things have to be true for that, and both were originally wrong in the
// panel view (they were right only in the lightbox, which is why a marker
// looked correct when enlarged and floated off the photo when not):
//
//   · The overlay must be sized to the image, not to its container. An
//     `object-contain` image is letterboxed inside a box of a different
//     aspect ratio, and an `inset-0` SVG covers the letterbox bars too — so
//     y=0.3 landed 30% down the CONTAINER, out in the black bar above the
//     photo. Callers must therefore give this component a wrapper that already
//     carries the image's aspect ratio (see aspectBox below).
//
//   · The viewBox must be the image's real proportions, not `0 0 1 1` with
//     preserveAspectRatio="none". A 1×1 box stretched over a 4:3 image scales
//     x and y by different factors, which puts markers in the right PLACE but
//     draws every circle as an ellipse and skews every arrowhead. Using
//     `0 0 W H` makes one unit the same length on both axes, so round things
//     are round.
// ---------------------------------------------------------------------------

import type { PhotoAnnotation } from '@/lib/api'

const DEFAULT_COLOR = '#f43f5e'

/**
 * Style for a wrapper that renders an image at its true aspect ratio, centred
 * and fully visible inside a flex container. Put the <img> and this overlay
 * inside it, both `absolute inset-0 w-full h-full`, and they align exactly.
 */
export const aspectBox = (width?: number | null, height?: number | null): React.CSSProperties => ({
  aspectRatio: `${width || 4} / ${height || 3}`,
  maxWidth: '100%',
  maxHeight: '100%',
  // height drives the size; max-width then shrinks it (and, via aspect-ratio,
  // the height with it) when the image is wider than the box.
  height: '100%',
  width: 'auto',
})

export default function PhotoAnnotationOverlay({
  annotations, width, height, zoom = 1, showLabels = true, className = '',
}: {
  annotations: PhotoAnnotation[]
  /** The image's true pixel dimensions — sets the coordinate space. */
  width?: number | null
  height?: number | null
  /** Current magnification, so a marker keeps constant on-screen thickness as the image is zoomed. */
  zoom?: number
  showLabels?: boolean
  className?: string
}) {
  if (!annotations.length) return null
  const W = width || 4
  const H = height || 3
  // Sizes are a fraction of the long edge, so a marker looks the same on a
  // 4000px nameplate close-up and an 800px overview.
  const unit = Math.max(W, H)
  const sw = (unit * 0.006) / zoom
  const head = (unit * 0.03) / zoom
  const dotR = (unit * 0.018) / zoom
  const fontSize = (unit * 0.028) / zoom

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}>
      {annotations.map((m, i) => {
        const c = m.color || DEFAULT_COLOR
        const x = m.x * W, y = m.y * H
        const x2 = (m.x2 ?? m.x) * W, y2 = (m.y2 ?? m.y) * H
        const label = showLabels && m.label
          // Outlined text stays readable over both a bright sky and a dark tank.
          ? <text x={x + (m.type === 'dot' ? dotR * 1.5 : 0)} y={m.type === 'dot' ? y + sw * 1.5 : y - sw * 2}
              fill={c} fontSize={fontSize} stroke="#000" strokeWidth={sw} style={{ paintOrder: 'stroke' }}>{m.label}</text>
          : null

        if (m.type === 'dot') {
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={dotR} fill="none" stroke={c} strokeWidth={sw} />
              <circle cx={x} cy={y} r={sw} fill={c} />
              {label}
            </g>
          )
        }
        if (m.type === 'box') {
          return (
            <g key={i}>
              <rect x={Math.min(x, x2)} y={Math.min(y, y2)} width={Math.abs(x2 - x)} height={Math.abs(y2 - y)}
                fill="none" stroke={c} strokeWidth={sw} />
              {label}
            </g>
          )
        }
        const a = Math.atan2(y2 - y, x2 - x)
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x2} y2={y2} stroke={c} strokeWidth={sw} />
            <polygon fill={c} points={
              `${x2},${y2} ${x2 - head * Math.cos(a - 0.4)},${y2 - head * Math.sin(a - 0.4)} ${x2 - head * Math.cos(a + 0.4)},${y2 - head * Math.sin(a + 0.4)}`
            } />
            {label}
          </g>
        )
      })}
    </svg>
  )
}
