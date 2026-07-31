'use client'

// Enkel SVG-graf for admin-dashboardet. Bevisst håndrullet: appen har ikke noe
// chart-bibliotek fra før, og å dra inn recharts/d3 (~50–150 kB) for én graf
// på én intern side er ikke verdt vekten. Bruker kun designsystemets farger.
//
// Søyler  = ukentlige aktive spillere (hovedserie, gull)
// Linje   = retention % for quizen som åpnet den uken (sekundærserie, brødtekst-
//           farge). Uker uten quiz får brudd i linjen — ingen quiz er ikke det
//           samme som 0 % retention.

export type WeekPoint = {
  weekStart: string
  activePlayers: number
  retentionPct: number | null
}

const W = 720
const H = 220
const PAD_L = 34
const PAD_R = 34
const PAD_T = 14
const PAD_B = 30

const GOLD = '#c9a84c'
const BODY = '#e8e4dd'
const HINT = '#918f8a'

function formatWeek(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}`
}

export default function WeeklyActivityChart({ data }: { data: WeekPoint[] }) {
  if (data.length === 0) {
    return <p style={{ fontSize: 13, color: HINT }}>Ingen data ennå.</p>
  }

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const maxPlayers = Math.max(...data.map(d => d.activePlayers), 1)
  // Rund opp til nærmeste 10 så y-aksen får lesbare merker i stedet for et
  // toppmerke på f.eks. 71.
  const yMax = Math.max(10, Math.ceil(maxPlayers / 10) * 10)

  const slot = plotW / data.length
  const barW = Math.min(30, slot * 0.55)

  const yFor = (v: number) => PAD_T + plotH - (v / yMax) * plotH
  const xCenter = (i: number) => PAD_L + slot * i + slot / 2

  // Retention deler x-akse, men har sin egen 0–100-skala på høyre side.
  const yForPct = (p: number) => PAD_T + plotH - (p / 100) * plotH

  // Linjen brytes der retentionPct er null (uke uten quiz).
  const segments: Array<Array<{ x: number; y: number; pct: number; week: string }>> = []
  let current: Array<{ x: number; y: number; pct: number; week: string }> = []
  data.forEach((d, i) => {
    if (d.retentionPct === null) {
      if (current.length > 0) { segments.push(current); current = [] }
      return
    }
    current.push({ x: xCenter(i), y: yForPct(d.retentionPct), pct: d.retentionPct, week: d.weekStart })
  })
  if (current.length > 0) segments.push(current)

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMax * f))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Ukentlige aktive spillere og retention siste 12 uker"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Gridlines + venstre y-akse (aktive spillere) */}
      {gridValues.map(v => (
        <g key={v}>
          <line
            x1={PAD_L} x2={W - PAD_R}
            y1={yFor(v)} y2={yFor(v)}
            stroke={HINT} strokeOpacity={0.22} strokeWidth={1}
          />
          <text
            x={PAD_L - 8} y={yFor(v) + 3}
            textAnchor="end" fontSize={10} fill={HINT}
            fontFamily="'Instrument Sans', sans-serif"
          >
            {v}
          </text>
        </g>
      ))}

      {/* Høyre y-akse (retention %) */}
      {[0, 50, 100].map(p => (
        <text
          key={p}
          x={W - PAD_R + 8} y={yForPct(p) + 3}
          textAnchor="start" fontSize={10} fill={HINT}
          fontFamily="'Instrument Sans', sans-serif"
        >
          {p}%
        </text>
      ))}

      {/* Søyler — aktive spillere */}
      {data.map((d, i) => {
        const y = yFor(d.activePlayers)
        const h = PAD_T + plotH - y
        return (
          <g key={d.weekStart}>
            <rect
              x={xCenter(i) - barW / 2}
              y={y}
              width={barW}
              height={Math.max(h, d.activePlayers > 0 ? 2 : 0)}
              rx={3}
              fill={GOLD}
              fillOpacity={0.85}
            >
              <title>{`Uke fra ${formatWeek(d.weekStart)}: ${d.activePlayers} aktive spillere`}</title>
            </rect>
            <text
              x={xCenter(i)} y={H - PAD_B + 16}
              textAnchor="middle" fontSize={10} fill={HINT}
              fontFamily="'Instrument Sans', sans-serif"
            >
              {formatWeek(d.weekStart)}
            </text>
          </g>
        )
      })}

      {/* Retention-linje */}
      {segments.map((seg, si) => (
        <polyline
          key={si}
          points={seg.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={BODY}
          strokeWidth={1.5}
          strokeOpacity={0.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {segments.flat().map(p => (
        <circle key={`${p.week}-dot`} cx={p.x} cy={p.y} r={2.5} fill={BODY}>
          <title>{`Uke fra ${formatWeek(p.week)}: ${p.pct} % retention`}</title>
        </circle>
      ))}
    </svg>
  )
}
