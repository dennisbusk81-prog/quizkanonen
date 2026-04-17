'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
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
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd', flexGrow: 1 },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 60px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },
  backBtn:  { display: 'inline-block', fontSize: 12, color: '#e8e4dd', background: 'none', border: 'none', padding: 0, marginBottom: 14, letterSpacing: '0.04em', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" },

  // Hero card
  heroCard:    { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px', marginBottom: 12 },
  heroEyebrow: { fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', marginBottom: 6 },
  heroTitle:   { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#ffffff', lineHeight: 1.25, marginBottom: 12 },
  heroDate:    { fontSize: 12, color: '#6a6860', marginBottom: 14 },

  // Three key numbers row
  statsRow:   { display: 'flex', gap: 0, borderTop: '1px solid #2a2d38', paddingTop: 14 },
  statCell:   { flex: 1, textAlign: 'center' as const },
  statDivider:{ width: 1, background: '#2a2d38', margin: '0 4px' },
  statBig:    { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 3 },
  statBigGrey:{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 3 },
  statLbl:    { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6a6860' },
  heroSub:    { fontSize: 12, color: '#6a6860', textAlign: 'center' as const, marginTop: 10 },

  // Section
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  // Question cards
  qCardCorrect: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '12px 16px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 10 },
  qCardWrong:   { background: '#21242e', border: '1px solid rgba(201,76,76,0.25)', borderRadius: 14, padding: '12px 16px', marginBottom: 6 },
  qCardNoAns:   { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '10px 16px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 10, opacity: 0.7 },

  // Correct card elements
  checkIcon:  { fontSize: 14, color: '#4caf7d', marginTop: 1, flexShrink: 0 },
  qTextShort: { fontSize: 13, color: '#e8e4dd', lineHeight: 1.4, marginBottom: 2, flex: 1 },
  ansTextOk:  { fontSize: 13, color: '#4caf7d', fontWeight: 500 },
  ansTime:    { fontSize: 10, color: '#6a6860', marginTop: 6, textAlign: 'right' as const },

  // Wrong card elements
  wrongTop:     { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  xIcon:        { fontSize: 14, color: '#c94c4c', marginTop: 1, flexShrink: 0 },
  qTextWrong:   { fontSize: 13, color: '#e8e4dd', lineHeight: 1.4, flex: 1 },
  wrongAnswers: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  ansWrong:     { fontSize: 12, color: '#c94c4c', background: 'rgba(201,76,76,0.08)', border: '1px solid rgba(201,76,76,0.2)', borderRadius: 8, padding: '6px 10px' },
  ansGold:      { fontSize: 12, color: '#c9a84c', background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 8, padding: '6px 10px' },
  wrongTime:    { fontSize: 10, color: '#6a6860', marginTop: 6, textAlign: 'right' as const },

  // No-answer elements
  dashIcon:   { fontSize: 14, color: '#6a6860', marginTop: 1, flexShrink: 0 },
  qTextGrey:  { fontSize: 12, color: '#6a6860', lineHeight: 1.4, flex: 1 },

  // Not found / error
  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 24px', textAlign: 'center' as const, marginTop: 24 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 6 },
  emptySub:   { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 20 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── Answer cards ─────────────────────────────────────────────────────────────

function CorrectCard({ a, num }: { a: AttemptAnswerDetail; num: number }) {
  return (
    <div style={s.qCardCorrect}>
      <span style={s.checkIcon}>✓</span>
      <div style={{ flex: 1 }}>
        <div style={s.qTextShort}>
          <span style={{ fontSize: 10, color: '#6a6860', marginRight: 6 }}>Q{num}</span>
          {a.question_text}
        </div>
        <div style={s.ansTextOk}>{a.selected_answer_text ?? a.selected_answer ?? '–'}</div>
        <div style={s.ansTime}>{formatTime(a.time_ms)}</div>
      </div>
    </div>
  )
}

function WrongCard({ a, num }: { a: AttemptAnswerDetail; num: number }) {
  return (
    <div style={s.qCardWrong}>
      <div style={s.wrongTop}>
        <span style={s.xIcon}>✗</span>
        <div style={s.qTextWrong}>
          <span style={{ fontSize: 10, color: '#6a6860', marginRight: 6 }}>Q{num}</span>
          {a.question_text}
        </div>
      </div>
      <div style={s.wrongAnswers}>
        {a.selected_answer ? (
          <div style={s.ansWrong}>Ditt svar: {a.selected_answer_text ?? a.selected_answer}</div>
        ) : (
          <div style={{ ...s.ansWrong, color: '#6a6860' }}>— Svarte ikke</div>
        )}
        <div style={s.ansGold}>Riktig: {a.correct_answer_text || a.correct_answer}</div>
      </div>
      <div style={s.wrongTime}>{formatTime(a.time_ms)}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'not-found' | 'error' | 'timeout'

export default function AttemptDetailPage() {
  const router = useRouter()
  const params = useParams()
  const attemptId = params.attemptId as string

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [detail, setDetail] = useState<AttemptDetail | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // Read cache before first paint — if prefetch already ran, skip loading state entirely.
  useLayoutEffect(() => {
    const CACHE_TTL = 10 * 60 * 1000
    try {
      const raw = sessionStorage.getItem(`qk_attempt_${attemptId}`)
      if (!raw) return
      const cached = JSON.parse(raw) as { fetchedAt: number; data: AttemptDetail }
      if (Date.now() - cached.fetchedAt < CACHE_TTL) {
        setDetail(cached.data)
        setLoadState('ready')
      }
    } catch { /* sessionStorage unavailable */ }
  }, [attemptId])

  // Scroll to top on mount (prevents inheriting scroll position from list page)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false
    const CACHE_KEY = `qk_attempt_${attemptId}`
    const CACHE_TTL = 10 * 60 * 1000 // 10 min — attempt data is immutable
    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 12000)

    async function load() {
      try {
        // Get session — retry once if Supabase hasn't initialised from localStorage yet
        let { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500))
          if (cancelled) return
          const { data } = await supabase.auth.getSession()
          session = data.session
        }

        if (cancelled) return

        if (!session) {
          router.replace(`/login?next=/historikk/${attemptId}`)
          return
        }

        // Serve from cache for instant client-side navigation
        try {
          const raw = sessionStorage.getItem(CACHE_KEY)
          if (raw) {
            const cached = JSON.parse(raw) as { fetchedAt: number; data: AttemptDetail }
            if (Date.now() - cached.fetchedAt < CACHE_TTL) {
              clearTimeout(fetchTimeout)
              if (!cancelled) {
                setDetail(cached.data)
                setLoadState('ready')
              }
              return
            }
          }
        } catch { /* sessionStorage unavailable — continue to fetch */ }

        const res = await fetch(`/api/historikk/${attemptId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
        })

        clearTimeout(fetchTimeout)
        if (cancelled) return

        if (res.status === 401) { router.replace(`/login?next=/historikk/${attemptId}`); return }
        if (res.status === 403) { router.replace('/premium'); return }
        if (res.status === 404) { setLoadState('not-found'); return }
        if (!res.ok) { setLoadState('error'); return }

        const json = await res.json() as AttemptDetail
        if (cancelled) return

        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: json }))
        } catch { /* ignore */ }

        setDetail(json)
        setLoadState('ready')
      } catch (err) {
        clearTimeout(fetchTimeout)
        if (!cancelled) {
          setLoadState((err as Error).name === 'AbortError' ? 'timeout' : 'error')
        }
      }
    }

    load()
    return () => { cancelled = true; clearTimeout(fetchTimeout); controller.abort() }
  }, [router, attemptId, retryKey])

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}><p style={s.spinner}>Laster quiz-detaljer…</p></div>
      </>
    )
  }

  if (loadState === 'not-found') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.wrap}>
          <div style={s.page}>
            <div style={{ paddingTop: 20 }}>
              <button onClick={() => router.back()} style={s.backBtn}>← Tilbake</button>
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

  if (loadState === 'timeout') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.wrap}>
          <div style={s.page}>
            <div style={{ paddingTop: 20 }}>
              <button onClick={() => router.back()} style={s.backBtn}>← Tilbake</button>
            </div>
            <div style={s.empty}>
              <div style={s.emptyTitle}>Tok for lang tid</div>
              <p style={s.emptySub}>Serveren svarte ikke i tide. Dette kan skje rett etter at tjenesten har vært inaktiv.</p>
              <button
                onClick={() => { setLoadState('loading'); setRetryKey(k => k + 1) }}
                style={{ ...s.btnGold, background: 'none', border: '1px solid #c9a84c', color: '#c9a84c', cursor: 'pointer' }}
              >
                Prøv igjen
              </button>
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
        <div style={s.wrap}>
          <div style={s.page}>
            <div style={{ paddingTop: 20 }}>
              <button onClick={() => router.back()} style={s.backBtn}>← Tilbake</button>
            </div>
            <div style={s.empty}>
              <div style={s.emptyTitle}>Noe gikk galt</div>
              <p style={s.emptySub}>Kunne ikke laste quiz-detaljene.</p>
              <button
                onClick={() => { setLoadState('loading'); setRetryKey(k => k + 1) }}
                style={{ ...s.btnGold, background: 'none', border: '1px solid #c9a84c', color: '#c9a84c', cursor: 'pointer' }}
              >
                Prøv igjen
              </button>
            </div>
          </div>
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

          {/* Back */}
          <div style={{ paddingTop: 20 }}>
            <button onClick={() => router.back()} style={s.backBtn}>← Tilbake</button>
          </div>

          {/* Hero card */}
          <div style={s.heroCard}>
            <div style={s.heroEyebrow}>Premium · Gjennomgang</div>
            <div style={s.heroTitle}>{detail.quiz_title}</div>
            <div style={s.heroDate}>{formatDate(detail.completed_at)}</div>

            <div style={s.statsRow}>
              {detail.rank !== null && detail.total_players !== null ? (
                <div style={s.statCell}>
                  <div style={s.statBig}>#{detail.rank}</div>
                  <div style={s.statLbl}>Plassering</div>
                </div>
              ) : (
                <div style={s.statCell}>
                  <div style={s.statBig}>—</div>
                  <div style={s.statLbl}>Plassering</div>
                </div>
              )}
              <div style={s.statDivider} />
              <div style={s.statCell}>
                <div style={s.statBigGrey}>{pct}%</div>
                <div style={s.statLbl}>Score</div>
              </div>
              <div style={s.statDivider} />
              <div style={s.statCell}>
                <div style={s.statBigGrey}>{formatTime(detail.total_time_ms)}</div>
                <div style={s.statLbl}>Tid</div>
              </div>
            </div>

            <div style={s.heroSub}>
              {detail.correct_answers} av {detail.total_questions} riktige
              {detail.rank !== null && detail.total_players !== null && (
                <> · av {detail.total_players} deltakere</>
              )}
            </div>
          </div>

          {/* Questions */}
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

              {detail.answers.map((a, i) =>
                a.is_correct
                  ? <CorrectCard key={a.question_id} a={a} num={i + 1} />
                  : <WrongCard key={a.question_id} a={a} num={i + 1} />
              )}
            </>
          )}

        </div>
      </div>
    </>
  )
}
