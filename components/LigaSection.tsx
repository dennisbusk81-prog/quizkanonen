'use client'
import { useEffect, useState } from 'react'
import { supabase, supabaseData } from '@/lib/supabase'

type LeagueEntry = {
  id: string
  name: string
  slug: string
  member_count: number
}

type SisteQuizResult = {
  rank: number
  user_id: string
  display_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
}

type SisteQuiz = {
  quiz_id: string
  quiz_title: string | null
  results: SisteQuizResult[]
}

type LeagueData = {
  league: LeagueEntry
  sisteQuiz: SisteQuiz | null
  memberCount: number
  quizOpen: boolean
  userHasPlayed: boolean
  playedCount: number
}

const s = {
  widget: {
    background: '#1a1c23',
    border: '1px solid #2a2d38',
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  widgetHeader: {
    padding: '12px 16px 10px',
    borderBottom: '1px solid #2a2d38',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  widgetLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#6a6860',
  },
  widgetLink: {
    fontSize: 11,
    fontWeight: 600,
    color: '#c9a84c',
    textDecoration: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid #2a2d38',
  },
  rank: {
    fontSize: 11,
    fontWeight: 700,
    color: '#6a6860',
    width: 16,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'rgba(106,104,96,0.12)',
    border: '1.5px solid rgba(106,104,96,0.22)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#9a9590',
    flexShrink: 0,
  },
  avatarGold: {
    background: 'rgba(201,168,76,0.15)',
    border: '1.5px solid rgba(201,168,76,0.4)',
    color: '#c9a84c',
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  score: { fontSize: 11, color: '#6a6860', marginTop: 1 },
  footer: {
    padding: '10px 16px',
    borderTop: '1px solid #2a2d38',
  },
  footerLink: {
    fontSize: 12,
    fontWeight: 600,
    color: '#c9a84c',
    textDecoration: 'none',
  },
  ctaWrap: {
    background: '#1a1c23',
    border: '1px solid #2a2d38',
    borderRadius: 16,
    padding: '20px 20px',
    textAlign: 'center' as const,
  },
  ctaText: { fontSize: 13, color: '#6a6860', marginBottom: 12, lineHeight: 1.5 },
  ctaLink: {
    display: 'inline-block',
    background: '#c9a84c',
    color: '#0f0f10',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 13,
    fontWeight: 700,
    padding: '9px 18px',
    borderRadius: 10,
    textDecoration: 'none',
  },
  pendingRow: {
    padding: '14px 16px',
    fontSize: 13,
    color: '#9a9590',
    lineHeight: 1.5,
    borderBottom: '1px solid #2a2d38',
  },
  pendingCount: { color: '#c9a84c', fontWeight: 700 },
}

function formatTime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function LeagueWidget({ data }: { data: LeagueData }) {
  const { league, sisteQuiz, memberCount, quizOpen, userHasPlayed, playedCount } = data
  const showPending = quizOpen && !userHasPlayed

  return (
    <div style={s.widget}>
      <div style={s.widgetHeader}>
        <span style={s.widgetLabel}>{league.name}</span>
        <a href={`/liga/${league.slug}`} style={s.widgetLink}>Se liga →</a>
      </div>

      {showPending ? (
        <div style={s.pendingRow}>
          <span style={s.pendingCount}>{playedCount} av {memberCount}</span>
          {' '}medlemmer har spilt — spill du også!
        </div>
      ) : sisteQuiz && sisteQuiz.results.length > 0 ? (
        sisteQuiz.results.slice(0, 3).map((r, i) => {
          const isGold = r.rank === 1
          return (
            <div key={r.user_id} style={{ ...s.row, borderBottom: i < Math.min(2, sisteQuiz.results.length - 1) ? '1px solid #2a2d38' : 'none' }}>
              <span style={s.rank}>{r.rank}</span>
              <div style={{ ...s.avatar, ...(isGold ? s.avatarGold : {}) }}>
                {initials(r.display_name)}
              </div>
              <div style={s.info}>
                <div style={s.name}>{r.display_name}</div>
                <div style={s.score}>{r.correct_answers}/{r.total_questions} riktige · {formatTime(r.total_time_ms)}</div>
              </div>
            </div>
          )
        })
      ) : (
        <div style={{ ...s.pendingRow, borderBottom: 'none' }}>
          Ingen har spilt ennå — vær den første!
        </div>
      )}

      <div style={s.footer}>
        <a href={`/liga/${league.slug}`} style={s.footerLink}>Se hele ligaen →</a>
      </div>
    </div>
  )
}

export default function LigaSection() {
  const [ready, setReady] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [leagueData, setLeagueData] = useState<LeagueData[]>([])

  useEffect(() => {
    const timeout = setTimeout(() => setReady(true), 3000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'INITIAL_SESSION') return
      clearTimeout(timeout)

      if (!session?.access_token) {
        setReady(true)
        return
      }

      const token = session.access_token
      setAccessToken(token)

      try {
        const res = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setReady(true); return }

        const json = await res.json()
        const leagues: LeagueEntry[] = (json.leagues ?? []).slice(0, 2)

        if (leagues.length === 0) { setReady(true); return }

        const results = await Promise.all(
          leagues.map(async (league) => {
            const lbRes = await fetch(`/api/leagues/${league.id}/leaderboard`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            const lbJson = lbRes.ok ? await lbRes.json() : null
            const sisteQuiz: SisteQuiz | null = lbJson?.siste_quiz ?? null

            let quizOpen = false
            if (sisteQuiz?.quiz_id) {
              const { data: quizRow } = await supabaseData
                .from('quizzes')
                .select('closes_at, opens_at')
                .eq('id', sisteQuiz.quiz_id)
                .maybeSingle()
              if (quizRow) {
                const now = new Date()
                quizOpen = new Date(quizRow.opens_at) <= now && new Date(quizRow.closes_at) >= now
              }
            }

            const userHasPlayed = sisteQuiz?.quiz_id
              ? !!localStorage.getItem(`qk_played_${sisteQuiz.quiz_id}`)
              : false

            const playedCount = sisteQuiz?.results.length ?? 0

            return {
              league,
              sisteQuiz,
              memberCount: league.member_count,
              quizOpen,
              userHasPlayed,
              playedCount,
            } satisfies LeagueData
          })
        )

        setLeagueData(results)
      } catch { /* vis ingenting ved feil */ }

      setReady(true)
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  if (!ready || !accessToken) return null

  if (leagueData.length === 0) {
    return (
      <div style={s.ctaWrap}>
        <p style={s.ctaText}>Opprett en liga og konkurrer mot venner, familie eller kolleger uke etter uke.</p>
        <a href="/liga" style={s.ctaLink}>Opprett en liga →</a>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {leagueData.map(d => <LeagueWidget key={d.league.id} data={d} />)}
    </div>
  )
}
