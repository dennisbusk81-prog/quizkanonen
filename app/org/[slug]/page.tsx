'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type Attempt = {
  id: string
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  rank: number
  user_id: string
  is_team: boolean
  team_size: number | null
}

type DashboardData = {
  org: { name: string; plan: string }
  quiz: { id: string; title: string; is_active: boolean } | null
  attempts: Attempt[]
  userRole: string
  currentUserId: string
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function OrgLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { router.push(`/login?next=/org/${slug}`); return }

    fetch(`/api/org/${slug}/dashboard`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => {
        if (r.status === 403) { setError('Du er ikke medlem av denne organisasjonen.'); return null }
        if (!r.ok) { setError('Kunne ikke laste leaderboard.'); return null }
        return r.json()
      })
      .then(d => { if (d) setData(d) })
      .catch(() => setError('Noe gikk galt.'))
      .finally(() => setLoading(false))
  }, [session, slug, router])

  if (session === undefined || loading) {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{FONT}</style>
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>Ingen tilgang</p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24 }}>{error}</p>
            <Link href="/" style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none' }}>← Forsiden</Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{FONT + ' * { box-sizing: border-box; }'}</style>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={{ fontSize: 12, color: '#7a7873', textDecoration: 'none', letterSpacing: '0.04em' }}>
              ← Forsiden
            </Link>
          </div>

          {/* Header */}
          <div style={{ padding: '40px 0 28px', textAlign: 'center' }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
              {data?.org.name}
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(26px, 6vw, 36px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 }}>
              Bedrifts<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>leaderboard</em>
            </h1>
            {data?.quiz && (
              <p style={{ fontSize: 14, color: '#7a7873', fontStyle: 'italic', fontFamily: "'Libre Baskerville', serif" }}>
                {data.quiz.title}
              </p>
            )}
            <div style={{ width: '100%', height: 1, background: '#2a2d38', marginTop: 24 }} />
          </div>

          {/* Admin link */}
          {data?.userRole === 'admin' && (
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <Link href={`/org/${slug}/admin`} style={{ fontSize: 12, color: '#c9a84c', textDecoration: 'none', letterSpacing: '0.04em' }}>
                Admin-panel →
              </Link>
            </div>
          )}

          {/* No quiz yet */}
          {!data?.quiz && (
            <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center', marginTop: 12 }}>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 }}>Ingen resultater ennå</p>
              <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6 }}>
                Leaderboardet vises etter at teammedlemmer spiller sin første quiz.
              </p>
            </div>
          )}

          {/* Leaderboard rows */}
          {data?.attempts.map(attempt => {
            const isFirst = attempt.rank === 1
            const isMe = attempt.user_id === data.currentUserId
            const pct = attempt.total_questions > 0 ? Math.round((attempt.correct_answers / attempt.total_questions) * 100) : 0
            const initial = (attempt.player_name || '?')[0]?.toUpperCase()

            return (
              <div
                key={attempt.id}
                style={{
                  background: isFirst
                    ? 'linear-gradient(135deg, rgba(201,168,76,0.07) 0%, #21242e 60%)'
                    : isMe
                    ? 'rgba(201,168,76,0.04)'
                    : '#21242e',
                  border: isFirst
                    ? '1px solid rgba(201,168,76,0.22)'
                    : isMe
                    ? '1px solid rgba(201,168,76,0.18)'
                    : '1px solid #2a2d38',
                  borderRadius: 20,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  marginBottom: 8,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {isFirst && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#c9a84c', borderRadius: '3px 0 0 3px' }} />}

                {/* Rank */}
                <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#7a7873' }}>
                    #{attempt.rank}
                  </span>
                </div>

                {/* Avatar */}
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>
                  {initial}
                </div>

                {/* Name + stats */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: isMe ? '#c9a84c' : '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                    {attempt.player_name}{isMe ? ' (deg)' : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#7a7873' }}>
                    {attempt.correct_answers}/{attempt.total_questions} riktige · {formatTime(attempt.total_time_ms)}
                  </div>
                </div>

                {/* Score */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 2 }}>
                    {pct}%
                  </div>
                  <div style={{ fontSize: 10, color: '#7a7873', letterSpacing: '0.04em' }}>RIKTIGE</div>
                </div>
              </div>
            )
          })}

        </div>
      </div>
    </>
  )
}
