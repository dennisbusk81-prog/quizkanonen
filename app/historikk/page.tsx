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
    return { tekst: 'Godt start! Kom tilbake neste uke for å se utviklingen din', variant: 'neutral' }
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
    tekst: p.type === 'early' ? 'Du er på samme nivå som da du startet' : 'Stabilt nivå de siste 4 ukene',
    variant: 'neutral',
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590', flexGrow: 1 },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 60px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  // Hero section
  hero:         { padding: '16px 0 12px', textAlign: 'center' as const },
  heroEyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#6a6860', marginBottom: 4 },
  heroNum:      { fontFamily: "'Libre Baskerville', serif", fontSize: 64, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 4 },
  heroNumLabel: { fontSize: 12, color: '#6a6860', letterSpacing: '0.06em', marginBottom: 10 },
  heroSub:      { fontSize: 13, color: '#6a6860' },
  heroRule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 12 },

  // Graph card — progresjon msg inside
  graphCard:    { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px 10px', marginBottom: 10, marginTop: 10 },
  graphHeader:  { marginBottom: 10 },
  graphLabel:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860' },
  progPositive: { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(76,175,77,0.08)', border: '1px solid rgba(76,175,77,0.2)', color: '#4caf7d' },
  progNegative: { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(201,76,76,0.08)', border: '1px solid rgba(201,76,76,0.2)', color: '#c94c4c' },
  progNeutral:  { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(106,104,96,0.1)', border: '1px solid #2a2d38', color: '#6a6860' },
  graphEmpty:   { padding: '20px 0', textAlign: 'center' as const, fontSize: 13, color: '#6a6860', fontStyle: 'italic' as const },

  // Stats — featured row + small grid
  featuredRow:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 },
  featuredCard: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px' },
  featuredNum:  { fontFamily: "'Libre Baskerville', serif", fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 4 },
  featuredLbl:  { fontSize: 11, fontWeight: 600, color: '#9a9590', marginBottom: 2 },
  featuredCtx:  { fontSize: 10, color: '#6a6860', lineHeight: 1.4 },

  smallGrid:    { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 },
  smallCard:    { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '12px 8px', textAlign: 'center' as const },
  smallNum:     { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 4 },
  smallLbl:     { fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6a6860', lineHeight: 1.3 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  // Quiz rows
  rowBase:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, textDecoration: 'none', cursor: 'pointer' as const },
  rowHover: { background: '#252836', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, textDecoration: 'none', cursor: 'pointer' as const },
  rowLeft:  { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 2, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  rowMeta:  { fontSize: 11, color: '#6a6860' },
  rowRight: { textAlign: 'right' as const, flexShrink: 0 },
  rowRank:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 2 },
  rowScore: { fontSize: 11, color: '#9a9590', marginBottom: 1 },
  rowSub:   { fontSize: 10, color: '#6a6860' },

  btnMore: { width: '100%', padding: '10px 0', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#9a9590', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4 },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 24px', textAlign: 'center' as const, marginTop: 24 },
  emptyIcon:  { fontSize: 36, marginBottom: 12, opacity: 0.5 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 6 },
  emptySub:   { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 20 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

// SVG graph dimensions
const GW = 600
const GH = 160
const GP = { top: 16, right: 16, bottom: 40, left: 40 }

// ─── Score graph ──────────────────────────────────────────────────────────────

type GraphPoint = { x: number; y: number; score: number; title: string; date: string }

function ScoreGraph({ history, progMsg }: { history: HistoryAttempt[]; progMsg: ProgMsg | null }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

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

  const gridYValues = [0, 50, 100]
  const labelEvery = Math.max(1, Math.ceil(n / 6))

  const linePts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaBottomY = (GP.top + plotH).toFixed(1)
  const areaPts = [
    `${GP.left.toFixed(1)},${areaBottomY}`,
    ...points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${(GW - GP.right).toFixed(1)},${areaBottomY}`,
  ].join(' ')

  const TW = 140, TH = 42
  const tooltip = hoveredIdx !== null ? (() => {
    const p = points[hoveredIdx]
    const tx = Math.max(0, Math.min(p.x - TW / 2, GW - TW))
    const ty = p.y < GP.top + 56 ? p.y + 12 : p.y - TH - 8
    const label = p.title.length > 20 ? p.title.slice(0, 18) + '…' : p.title
    return (
      <g style={{ pointerEvents: 'none' }}>
        <rect x={tx} y={ty} width={TW} height={TH} rx={6} fill="#21242e" stroke="#c9a84c" strokeWidth={1} />
        <text x={tx + TW / 2} y={ty + 13} textAnchor="middle" fontSize={10} fill="#9a9590"
          style={{ fontFamily: "'Instrument Sans', sans-serif" }}>{label}</text>
        <text x={tx + TW / 2} y={ty + 30} textAnchor="middle" fontSize={13} fill="#c9a84c"
          style={{ fontFamily: "'Libre Baskerville', serif", fontWeight: 700 }}>
          {p.score}% · {p.date}
        </text>
      </g>
    )
  })() : null

  const progStyle = progMsg?.variant === 'positive' ? s.progPositive
    : progMsg?.variant === 'negative' ? s.progNegative
    : s.progNeutral

  return (
    <div style={s.graphCard}>
      <div style={s.graphHeader}>
        <span style={s.graphLabel}>Utvikling</span>
      </div>
      {n < 2 ? (
        <div style={s.graphEmpty}>Spill flere quizer for å se utviklingen din</div>
      ) : (
        <svg viewBox={`0 0 ${GW} ${GH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
          {gridYValues.map((v) => (
            <g key={v}>
              <line x1={GP.left} y1={getY(v)} x2={GW - GP.right} y2={getY(v)} stroke="#2a2d38" strokeWidth={1} />
              <text x={GP.left - 6} y={getY(v)} textAnchor="end" dominantBaseline="middle"
                fontSize={9} fill="#6a6860" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
                {v}%
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            (i % labelEvery === 0 || i === n - 1) ? (
              <text key={i} x={p.x} y={GH - GP.bottom + 14} textAnchor="middle"
                fontSize={9} fill="#6a6860" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
                {p.date}
              </text>
            ) : null
          )}
          <polygon points={areaPts} fill="rgba(201,168,76,0.06)" stroke="none" />
          <polyline points={linePts} fill="none" stroke="#c9a84c" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 5 : 3}
              fill={hoveredIdx === i ? '#c9a84c' : '#21242e'} stroke="#c9a84c" strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
          {tooltip}
        </svg>
      )}
      {progMsg && <div style={progStyle}>{progMsg.tekst}</div>}
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
    const CACHE_TTL = 5 * 60 * 1000

    async function load() {
      // Retry once if Supabase hasn't initialised session from localStorage yet
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        session = data.session
      }

      if (cancelled) return

      if (!session) {
        router.replace('/login?next=/historikk')
        return
      }

      const CACHE_KEY = `qk_historikk_${session.user.id}`

      try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw) as {
            fetchedAt: number
            data: { history: HistoryAttempt[]; stats: PlayerStats }
          }
          if (Date.now() - cached.fetchedAt < CACHE_TTL) {
            if (!cancelled) {
              setHistory(cached.data.history)
              setStats(cached.data.stats)
              setLoadState('ready')
            }
            return
          }
        }
      } catch {
        // sessionStorage unavailable — continue to fetch
      }

      const res = await fetch('/api/historikk', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (cancelled) return

      if (res.status === 403) { router.replace('/premium'); return }
      if (!res.ok) { if (!cancelled) setLoadState('error'); return }

      const json = await res.json() as { history: HistoryAttempt[]; stats: PlayerStats }

      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: json }))
      } catch { /* ignore */ }

      if (cancelled) return
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
        <div style={s.centered}><p style={s.spinner}>Laster historikk…</p></div>
      </>
    )
  }

  if (loadState === 'error') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}><p style={s.spinner}>Noe gikk galt. Prøv igjen.</p></div>
      </>
    )
  }

  const shown = history.slice(0, visible)
  const hasMore = visible < history.length
  const progMsg = stats?.progresjon ? toProgMsg(stats.progresjon) : null

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>

          {/* Back */}
          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          {/* Hero */}
          <div style={s.hero}>
            <div style={s.heroEyebrow}>Din historikk · Premium</div>
            {stats && stats.beste_plassering !== null ? (
              <>
                <div style={s.heroNum}>#{stats.beste_plassering}</div>
                <div style={s.heroNumLabel}>din beste plassering</div>
              </>
            ) : (
              <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 10 }}>
                Din historikk
              </div>
            )}
            {stats && stats.total_attempts > 0 && (
              <div style={s.heroSub}>
                {stats.total_attempts} {stats.total_attempts === 1 ? 'quiz spilt' : 'quizer spilt'}
                {' · '}snitt {stats.avg_score_pct}%
              </div>
            )}
            <div style={s.heroRule} />
            {history.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Link
                  href={`/leaderboard/${history[0].quiz_id}`}
                  style={{ fontSize: 12, color: '#6a6860', textDecoration: 'none', letterSpacing: '0.02em' }}
                >
                  Se ukens leaderboard →
                </Link>
              </div>
            )}
          </div>

          {/* Graph with inline progresjon */}
          <ScoreGraph history={history} progMsg={progMsg} />

          {/* Stats — featured + small */}
          {stats && stats.total_attempts > 0 && (
            <>
              <div style={s.featuredRow}>
                <div style={s.featuredCard}>
                  <div style={s.featuredNum}>
                    {stats.bedre_enn_prosent !== null ? `${stats.bedre_enn_prosent}%` : '—'}
                  </div>
                  <div style={s.featuredLbl}>Bedre enn andre</div>
                  <div style={s.featuredCtx}>av alle deltakere siste 3 mnd</div>
                </div>
                <div style={s.featuredCard}>
                  <div style={s.featuredNum}>
                    {stats.raskere_enn_prosent !== null ? `${stats.raskere_enn_prosent}%` : '—'}
                  </div>
                  <div style={s.featuredLbl}>Raskere enn andre</div>
                  <div style={s.featuredCtx}>av alle deltakere siste 3 mnd</div>
                </div>
              </div>

              <div style={s.smallGrid}>
                <div style={s.smallCard}>
                  <div style={s.smallNum}>{stats.total_attempts}</div>
                  <div style={s.smallLbl}>Quizer spilt</div>
                </div>
                <div style={s.smallCard}>
                  <div style={s.smallNum}>{stats.avg_score_pct}%</div>
                  <div style={s.smallLbl}>Snitt score</div>
                </div>
                <div style={s.smallCard}>
                  <div style={s.smallNum}>{stats.best_streak}</div>
                  <div style={s.smallLbl}>Beste streak</div>
                </div>
                <div style={s.smallCard}>
                  <div style={s.smallNum}>
                    {stats.beste_plassering !== null ? `#${stats.beste_plassering}` : '—'}
                  </div>
                  <div style={s.smallLbl}>Beste plassering</div>
                </div>
              </div>
            </>
          )}

          {/* Quiz list */}
          {history.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>📋</div>
              <div style={s.emptyTitle}>Ingen historikk ennå</div>
              <p style={s.emptySub}>Spill en quiz mens du er innlogget, så dukker den opp her.</p>
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
                      {attempt.rank !== null && attempt.total_players !== null ? (
                        <div style={s.rowRank}>#{attempt.rank} av {attempt.total_players}</div>
                      ) : (
                        <div style={s.rowRank}>{attempt.correct_answers}/{attempt.total_questions}</div>
                      )}
                      <div style={s.rowScore}>
                        {attempt.correct_answers} av {attempt.total_questions} riktige
                      </div>
                      <div style={s.rowSub}>{pct}% · {formatTime(attempt.total_time_ms)}</div>
                    </div>
                  </Link>
                )
              })}

              {hasMore && (
                <button style={s.btnMore} onClick={() => setVisible((v) => v + PAGE_SIZE)}>
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
