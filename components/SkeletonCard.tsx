'use client'

const PULSE_STYLE = `
@keyframes qk-pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1; }
}
.qk-skel { animation: qk-pulse 1.5s ease-in-out infinite; }
`

interface SkeletonCardProps {
  rows?: number
  showHeader?: boolean
  style?: React.CSSProperties
}

export default function SkeletonCard({ rows = 5, showHeader = true, style }: SkeletonCardProps) {
  return (
    <>
      <style>{PULSE_STYLE}</style>
      <div style={{
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: 16,
        padding: '24px 20px',
        ...style,
      }}>
        {showHeader && (
          <>
            <div className="qk-skel" style={{ height: 12, width: '40%', background: '#2a2d38', borderRadius: 6, marginBottom: 14 }} />
            <div className="qk-skel" style={{ height: 22, width: '70%', background: '#2a2d38', borderRadius: 6, marginBottom: 20 }} />
          </>
        )}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i < rows - 1 ? 14 : 0 }}>
            <div className="qk-skel" style={{ width: 28, height: 28, borderRadius: 6, background: '#2a2d38', flexShrink: 0 }} />
            <div className="qk-skel" style={{ flex: 1, height: 16, background: '#2a2d38', borderRadius: 6 }} />
            <div className="qk-skel" style={{ width: 48, height: 16, background: '#2a2d38', borderRadius: 6, flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </>
  )
}
