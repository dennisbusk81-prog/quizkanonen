'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { HistoryAttempt, PlayerStats } from '@/lib/history'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('no-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function scorePct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// ─── styles ─────────────────────────────────────────────────────────────────

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590' },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  header:   { padding: '48px 0 36px', textAlign: 'center' as const },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(26px, 6vw, 36px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#6a6860', fontStyle: 'italic' as const },
  rule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 28 },

  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 32 },
  statCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '18px 14px', textAlign: 'center' as const },
  statNum:   { fontFamily: "'Libre Baskerville', serif", fontSize: 26, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#6a6860' },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  row:       { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 },
  rowLeft:   { flex: 1, minWidth: 0 },
  rowTitle:  { fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#ffffff', marginBottom: 3, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  rowMeta:   { fontSize: 12, color: '#6a6860' },
  rowRight:  { textAlign: 'right' as const, flexShrink: 0 },
  rowScore:  { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 3 },
  rowSub:    { fontSize: 11, color: '#6a6860' },

  btnMore:  { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#9a9590', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4 },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 24 },
  btnGold:   { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── page items per "load more" page ────────────────────────────────────────

const PAGE_SIZE = 20

// ─── component ──────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'error'

export default function HistorikkPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [history, setHistory] = useState<HistoryAttempt[]>([])
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.replace('/login?next=/historikk')
        return
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

          {/* Stats */}
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
                <div style={s.statNum}>{stats.total_correct}</div>
                <div style={s.statLabel}>Riktige</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.best_streak}</div>
                <div style={s.statLabel}>Beste streak</div>
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
                return (
                  <div key={attempt.id} style={s.row}>
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
                        {attempt.correct_answers}/{attempt.total_questions}
                      </div>
                      <div style={s.rowSub}>
                        {pct}% · {formatTime(attempt.total_time_ms)}
                      </div>
                    </div>
                  </div>
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
