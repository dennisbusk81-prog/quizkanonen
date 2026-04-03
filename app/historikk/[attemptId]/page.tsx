'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { AttemptDetail, AttemptAnswerDetail } from '@/lib/history'

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
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function scorePct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590', flexGrow: 1 },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 10 },

  // Header card
  headerCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '28px', marginBottom: 16 },
  quizTitle:   { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', lineHeight: 1.25, marginBottom: 14 },
  metaRow:     { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const, marginBottom: 12 },
  dateText:    { fontSize: 13, color: '#6a6860' },
  rankBadge:   { fontSize: 13, color: '#c9a84c', fontWeight: 600 },
  divider:     { width: 1, height: 14, background: '#2a2d38' },
  scoreRow:    { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const },
  scoreNum:    { fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#c9a84c', lineHeight: 1 },
  scoreOf:     { fontSize: 14, color: '#6a6860' },
  scoreSub:    { fontSize: 13, color: '#6a6860', marginLeft: 2 },

  // Section header
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 12px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  // Question cards
  qCard:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginBottom: 10 },
  qNum:       { fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  qText:      { fontFamily: "'Libre Baskerville', serif", fontSize: 16, color: '#ffffff', lineHeight: 1.45, marginBottom: 14 },

  // Answer rows
  ansCorrect: { background: 'rgba(76,175,77,0.09)', border: '1px solid rgba(76,175,77,0.3)', borderRadius: 10, padding: '10px 14px', color: '#4caf7d', fontSize: 14, lineHeight: 1.4 },
  ansWrong:   { background: 'rgba(201,76,76,0.09)', border: '1px solid rgba(201,76,76,0.3)', borderRadius: 10, padding: '10px 14px', color: '#c94c4c', fontSize: 14, lineHeight: 1.4, marginBottom: 8 },
  ansCorrectHint: { background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 10, padding: '10px 14px', color: '#c9a84c', fontSize: 13, lineHeight: 1.4 },
  ansNoAnswer:{ background: 'rgba(106,104,96,0.12)', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', color: '#6a6860', fontSize: 13, lineHeight: 1.4, marginBottom: 8 },
  ansTime:    { fontSize: 11, color: '#6a6860', marginTop: 10, textAlign: 'right' as const },

  // Empty / error
  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '48px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:   { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 24 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── Answer card ──────────────────────────────────────────────────────────────

function AnswerCard({ a }: { a: AttemptAnswerDetail }) {
  if (a.is_correct) {
    return (
      <div style={s.ansCorrect}>
        ✓ {a.selected_answer_text ?? a.selected_answer ?? '–'}
      </div>
    )
  }

  return (
    <>
      {a.selected_answer ? (
        <div style={s.ansWrong}>
          ✗ {a.selected_answer_text ?? a.selected_answer}
        </div>
      ) : (
        <div style={s.ansNoAnswer}>
          — Svarte ikke
        </div>
      )}
      <div style={s.ansCorrectHint}>
        Riktig svar: {a.correct_answer_text || a.correct_answer}
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'not-found' | 'error'

export default function AttemptDetailPage() {
  const router = useRouter()
  const params = useParams()
  const attemptId = params.attemptId as string

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [detail, setDetail] = useState<AttemptDetail | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (cancelled) return

        if (!session) {
          router.replace(`/login?next=/historikk/${attemptId}`)
          return
        }

        const res = await fetch(`/api/historikk/${attemptId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (cancelled) return

        if (res.status === 401) {
          router.replace(`/login?next=/historikk/${attemptId}`)
          return
        }
        if (res.status === 403) {
          router.replace('/premium')
          return
        }
        if (res.status === 404) {
          setLoadState('not-found')
          return
        }
        if (!res.ok) {
          setLoadState('error')
          return
        }

        const json = await res.json() as AttemptDetail
        if (cancelled) return

        setDetail(json)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [router, attemptId])

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}>
          <p style={s.spinner}>Laster quiz-detaljer…</p>
        </div>
      </>
    )
  }

  if (loadState === 'not-found') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.wrap}>
          <div style={s.page}>
            <div style={{ paddingTop: 28 }}>
              <Link href="/historikk" style={s.back}>← Tilbake til historikk</Link>
            </div>
            <div style={s.empty}>
              <div style={s.emptyTitle}>Ikke funnet</div>
              <p style={s.emptySub}>Dette forsøket finnes ikke eller tilhører ikke deg.</p>
              <Link href="/historikk" style={s.btnGold}>Tilbake til historikk</Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'error' || !detail) {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}>
          <p style={s.spinner}>Noe gikk galt. Prøv igjen.</p>
        </div>
      </>
    )
  }

  const pct = scorePct(detail.correct_answers, detail.total_questions)

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>

          {/* Back link */}
          <div style={{ paddingTop: 28 }}>
            <Link href="/historikk" style={s.back}>← Tilbake til historikk</Link>
          </div>

          {/* Header card */}
          <div style={s.headerCard}>
            <div style={s.eyebrow}>Premium · Gjennomgang</div>
            <div style={s.quizTitle}>{detail.quiz_title}</div>

            <div style={s.metaRow}>
              <span style={s.dateText}>{formatDate(detail.completed_at)}</span>
              {detail.rank !== null && detail.total_players !== null && (
                <>
                  <span style={s.divider} />
                  <span style={s.rankBadge}>Plass {detail.rank} av {detail.total_players}</span>
                </>
              )}
              <span style={s.divider} />
              <span style={s.dateText}>{formatTime(detail.total_time_ms)}</span>
            </div>

            <div style={s.scoreRow}>
              <span style={s.scoreNum}>{detail.correct_answers}</span>
              <span style={s.scoreOf}>av {detail.total_questions} riktige</span>
              <span style={s.scoreSub}>· {pct}%</span>
            </div>
          </div>

          {/* Questions list */}
          {detail.answers.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyTitle}>Ingen svar registrert</div>
              <p style={s.emptySub}>Detaljdata for dette forsøket er ikke tilgjengelig.</p>
            </div>
          ) : (
            <>
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Spørsmål og svar</span>
                <div style={s.sectionLine} />
                <span style={s.sectionCount}>{detail.answers.length}</span>
              </div>

              {detail.answers.map((a, i) => (
                <div key={a.question_id} style={s.qCard}>
                  <div style={s.qNum}>Spørsmål {i + 1}</div>
                  <div style={s.qText}>{a.question_text}</div>
                  <AnswerCard a={a} />
                  <div style={s.ansTime}>{formatTime(a.time_ms)}</div>
                </div>
              ))}
            </>
          )}

        </div>
      </div>
    </>
  )
}
