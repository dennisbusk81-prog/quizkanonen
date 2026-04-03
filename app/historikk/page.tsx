'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { HistoryAttempt, PlayerStats, Progresjon } from '@/lib/history'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('no-NO', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('no-NO', {
    day: 'numeric', month: 'short',
  })
}

function scorePct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// ─── Progresjon text ──────────────────────────────────────────────────────────

type ProgVariant = 'positive' | 'negative' | 'neutral'
type ProgMsg = { tekst: string; variant: ProgVariant }

function toProgMsg(p: Progresjon): ProgMsg {
  if (p.type === 'first') {
    return {
      tekst: 'Godt start! Kom tilbake neste uke for å se utviklingen din',
      variant: 'neutral',
    }
  }
  if (p.diff > 0) {
    return {
      tekst: p.type === 'early'
        ? `Du er ${p.diff}% bedre enn da du startet`
        : `Du har blitt ${p.diff}% bedre de siste 4 ukene`,
      variant: 'positive',
    }
  }
  if (p.diff < 0) {
    const abs = Math.abs(p.diff)
    return {
      tekst: p.type === 'early'
        ? `Du er ${abs}% dårligere enn da du startet`
        : `Du har blitt ${abs}% dårligere de siste 4 ukene`,
      variant: 'negative',
    }
  }
  return {
    tekst: p.type === 'early'
      ? 'Du er på samme nivå som da du startet'
      : 'Stabilt nivå de siste 4 ukene',
    variant: 'neutral',
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590', flexGrow: 1 },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  header:   { padding: '48px 0 28px', textAlign: 'center' as const },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(26px, 6vw, 36px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#6a6860', fontStyle: 'italic' as const },
  rule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 20 },

  // Graph
  graphCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px 12px', marginBottom: 12 },
  graphLabel: { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', marginBottom: 14 },
  graphEmpty: { padding: '28px 0', textAlign: 'center' as const, fontSize: 13, color: '#6a6860', fontStyle: 'italic' as const },

  // Progresjon banner — three full self-contained styles
  progPositive: { borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, fontWeight: 500, background: 'rgba(76,175,77,0.1)', border: '1px solid rgba(76,175,77,0.25)', color: '#4caf7d' },
  progNegative: { borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, fontWeight: 500, background: 'rgba(201,76,76,0.1)', border: '1px solid rgba(201,76,76,0.25)', color: '#c94c4c' },
  progNeutral:  { borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, fontWeight: 500, background: 'rgba(106,104,96,0.12)', border: '1px solid #2a2d38', color: '#9a9590' },

  // Stats grid — 2 rows × 3 columns
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 },
  statCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '18px 12px', textAlign: 'center' as const },
  statNum:   { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 5 },
  statLabel: { fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: '#6a6860', lineHeight: 1.4 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  // Rows — two variants (normal / hovered)
  rowBase:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, textDecoration: 'none', cursor: 'pointer' as const },
  rowHover: { background: '#252836', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, textDecoration: 'none', cursor: 'pointer' as const },
  rowLeft:  { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#ffffff', marginBottom: 3, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  rowMeta:  { fontSize: 12, color: '#6a6860' },
  rowRight: { textAlign: 'right' as const, flexShrink: 0 },
  rowScore: { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 2 },
  rowRank:  { fontSize: 11, color: '#c9a84c', fontWeight: 600, marginBottom: 2 },
  rowSub:   { fontSize: 11, color: '#6a6860' },

  btnMore: { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#9a9590', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4 },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon:  { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:   { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 24 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

// SVG graph dimensions
const GW = 600      // viewBox width
const GH = 200      // viewBox height
const GP = { top: 20, right: 20, bottom: 48, left: 44 } // padding

// ─── Score graph ──────────────────────────────────────────────────────────────

type GraphPoint = {
  x: number
  y: number
  score: number
  title: string
  date: string
}

function ScoreGraph({ history }: { history: HistoryAttempt[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // Sort chronologically, cap at 50 for readability
  const chrono = [...history]
    .sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime())
    .slice(-50)

  const n = chrono.length
  const plotW = GW - GP.left - GP.right
  const plotH = GH - GP.top - GP.bottom

  const getX = (i: number): number =>
    n > 1 ? GP.left + (i / (n - 1)) * plotW : GP.left + plotW / 2

  const getY = (score: number): number =>
    GP.top + (1 - score / 100) * plotH

  const points: GraphPoint[] = chrono.map((a, i) => ({
    x: getX(i),
    y: getY(scorePct(a.correct_answers, a.total_questions)),
    score: scorePct(a.correct_answers, a.total_questions),
    title: a.quiz_title,
    date: formatDateShort(a.completed_at),
  }))

  const gridYValues = [0, 25, 50, 75, 100]
  const labelEvery = Math.max(1, Math.ceil(n / 7))

  const linePts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaBottomY = (GP.top + plotH).toFixed(1)
  const areaPts = [
    `${GP.left.toFixed(1)},${areaBottomY}`,
    ...points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${(GW - GP.right).toFixed(1)},${areaBottomY}`,
  ].join(' ')

  // Tooltip
  const TW = 150, TH = 44
  const tooltip = hoveredIdx !== null ? (() => {
    const p = points[hoveredIdx]
    const tx = Math.max(0, Math.min(p.x - TW / 2, GW - TW))
    const ty = p.y < GP.top + 60 ? p.y + 14 : p.y - TH - 10
    const label = p.title.length > 20 ? p.title.slice(0, 18) + '…' : p.title
    return (
      <g style={{ pointerEvents: 'none' }}>
        <rect x={tx} y={ty} width={TW} height={TH} rx={6}
          fill="#21242e" stroke="#c9a84c" strokeWidth={1} />
        <text x={tx + TW / 2} y={ty + 14} textAnchor="middle" fontSize={10} fill="#9a9590"
          style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
          {label}
        </text>
        <text x={tx + TW / 2} y={ty + 32} textAnchor="middle" fontSize={13} fill="#c9a84c"
          style={{ fontFamily: "'Libre Baskerville', serif", fontWeight: 700 }}>
          {p.score}% · {p.date}
        </text>
      </g>
    )
  })() : null

  return (
    <div style={s.graphCard}>
      <div style={s.graphLabel}>Utvikling</div>
      {n < 2 ? (
        <div style={s.graphEmpty}>
          Spill flere quizer for å se utviklingen din
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${GW} ${GH}`}
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        >
          {/* Horizontal grid lines + Y-axis labels */}
          {gridYValues.map((v) => (
            <g key={v}>
              <line
                x1={GP.left} y1={getY(v)} x2={GW - GP.right} y2={getY(v)}
                stroke="#2a2d38" strokeWidth={1}
              />
              <text
                x={GP.left - 6} y={getY(v)}
                textAnchor="end" dominantBaseline="middle"
                fontSize={10} fill="#6a6860"
                style={{ fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {v}%
              </text>
            </g>
          ))}

          {/* X-axis date labels */}
          {points.map((p, i) =>
            (i % labelEvery === 0 || i === n - 1) ? (
              <text
                key={i}
                x={p.x} y={GH - GP.bottom + 16}
                textAnchor="middle" fontSize={10} fill="#6a6860"
                style={{ fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {p.date}
              </text>
            ) : null
          )}

          {/* Area fill */}
          <polygon points={areaPts} fill="rgba(201,168,76,0.06)" stroke="none" />

          {/* Line */}
          <polyline
            points={linePts}
            fill="none"
            stroke="#c9a84c"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Data point circles */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x} cy={p.y}
              r={hoveredIdx === i ? 6 : 4}
              fill={hoveredIdx === i ? '#c9a84c' : '#21242e'}
              stroke="#c9a84c"
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}

          {/* Tooltip */}
          {tooltip}
        </svg>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'error'

export default function HistorikkPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [history, setHistory] = useState<HistoryAttempt[]>([])
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const CACHE_KEY = 'qk_historikk'
    const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.replace('/login?next=/historikk')
        return
      }

      // Restore from cache for instant back-navigation
      try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw) as {
            userId: string
            fetchedAt: number
            data: { history: HistoryAttempt[]; stats: PlayerStats }
          }
          if (cached.userId === session.user.id && Date.now() - cached.fetchedAt < CACHE_TTL) {
            if (!cancelled) {
              setHistory(cached.data.history)
              setStats(cached.data.stats)
              setLoadState('ready')
            }
            return
          }
        }
      } catch {
        // sessionStorage unavailable or corrupt — continue to fetch
      }

      const res = await fetch('/api/historikk', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (cancelled) return

      if (res.status === 403) {
        router.replace('/premium')
        return
      }

      if (!res.ok) {
        setLoadState('error')
        return
      }

      const json = await res.json() as { history: HistoryAttempt[]; stats: PlayerStats }

      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          userId: session.user.id,
          fetchedAt: Date.now(),
          data: json,
        }))
      } catch {
        // sessionStorage full or unavailable — ignore
      }

      setHistory(json.history)
      setStats(json.stats)
      setLoadState('ready')
    }

    load()
    return () => { cancelled = true }
  }, [router])

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}>
          <p style={s.spinner}>Laster historikk…</p>
        </div>
      </>
    )
  }

  if (loadState === 'error') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}>
          <p style={s.spinner}>Noe gikk galt. Prøv igjen.</p>
        </div>
      </>
    )
  }

  const shown = history.slice(0, visible)
  const hasMore = visible < history.length

  // Progresjon message
  const progMsg = stats?.progresjon ? toProgMsg(stats.progresjon) : null
  const progStyle = progMsg?.variant === 'positive' ? s.progPositive
    : progMsg?.variant === 'negative' ? s.progNegative
    : s.progNeutral

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>

          {/* Back link */}
          <div style={{ paddingTop: 28 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          {/* Header */}
          <div style={s.header}>
            <div style={s.eyebrow}>Premium</div>
            <h1 style={s.title}>Din historikk</h1>
            {stats && stats.total_attempts > 0 && (
              <p style={s.subtitle}>
                {stats.total_attempts} {stats.total_attempts === 1 ? 'quiz spilt' : 'quizer spilt'}
              </p>
            )}
            <div style={s.rule} />
          </div>

          {/* Score graph */}
          <ScoreGraph history={history} />

          {/* Progresjon message */}
          {progMsg && (
            <div style={progStyle}>{progMsg.tekst}</div>
          )}

          {/* Stats grid — 2 rows × 3 */}
          {stats && stats.total_attempts > 0 && (
            <div style={s.statsGrid}>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.total_attempts}</div>
                <div style={s.statLabel}>Spilt</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.avg_score_pct}%</div>
                <div style={s.statLabel}>Snitt</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>
                  {stats.beste_plassering !== null ? `#${stats.beste_plassering}` : '—'}
                </div>
                <div style={s.statLabel}>Beste plassering</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.best_streak}</div>
                <div style={s.statLabel}>Beste streak</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>
                  {stats.bedre_enn_prosent !== null ? `${stats.bedre_enn_prosent}%` : '—'}
                </div>
                <div style={s.statLabel}>Bedre enn snitt</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>
                  {stats.raskere_enn_prosent !== null ? `${stats.raskere_enn_prosent}%` : '—'}
                </div>
                <div style={s.statLabel}>Raskere enn snitt</div>
              </div>
            </div>
          )}

          {/* History list */}
          {history.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>📋</div>
              <div style={s.emptyTitle}>Ingen historikk ennå</div>
              <p style={s.emptySub}>
                Spill en quiz mens du er innlogget, så dukker den opp her.
              </p>
              <Link href="/" style={s.btnGold}>Finn en quiz</Link>
            </div>
          ) : (
            <>
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Siste quizer</span>
                <div style={s.sectionLine} />
                <span style={s.sectionCount}>{history.length}</span>
              </div>

              {shown.map((attempt) => {
                const pct = scorePct(attempt.correct_answers, attempt.total_questions)
                const isHovered = hoveredRowId === attempt.id
                return (
                  <Link
                    key={attempt.id}
                    href={`/historikk/${attempt.id}`}
                    style={isHovered ? s.rowHover : s.rowBase}
                    onMouseEnter={() => setHoveredRowId(attempt.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    <div style={s.rowLeft}>
                      <div style={s.rowTitle}>{attempt.quiz_title}</div>
                      <div style={s.rowMeta}>
                        {formatDate(attempt.completed_at)}
                        {attempt.correct_streak !== null && attempt.correct_streak > 1 && (
                          <> · {attempt.correct_streak} på rad</>
                        )}
                      </div>
                    </div>
                    <div style={s.rowRight}>
                      <div style={s.rowScore}>
                        {attempt.correct_answers} av {attempt.total_questions}
                      </div>
                      {attempt.rank !== null && attempt.total_players !== null && (
                        <div style={s.rowRank}>
                          Plass {attempt.rank} av {attempt.total_players}
                        </div>
                      )}
                      <div style={s.rowSub}>
                        {pct}% · {formatTime(attempt.total_time_ms)}
                      </div>
                    </div>
                  </Link>
                )
              })}

              {hasMore && (
                <button
                  style={s.btnMore}
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                >
                  Vis {Math.min(PAGE_SIZE, history.length - visible)} eldre
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </>
  )
}
