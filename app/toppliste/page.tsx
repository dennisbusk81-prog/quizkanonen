'use client'

import { useEffect, useState } from 'react'
import SiteNav from '@/components/SiteNav'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import ErrorBoundary from '@/components/ErrorBoundary'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'

function ExpiredPremiumBanner() {
  // Premium fra delt context (ingen egen premium-status-fetch lenger).
  const { isPremium, userId, loading } = useProfile()
  const [hasScores, setHasScores] = useState(false)

  useEffect(() => {
    if (!userId) { setHasScores(false); return }
    let cancelled = false
    supabase
      .from('season_scores')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('scope_type', 'global')
      .then(({ count }) => { if (!cancelled) setHasScores((count ?? 0) > 0) })
    return () => { cancelled = true }
  }, [userId])

  // Vis kun når premium er avklart (unngå flash før context er lastet).
  if (loading || isPremium || !hasScores) return null
  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 16,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, margin: 0 }}>
        Poengene dine er lagret.{' '}
        <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>
          Reaktiver Premium
        </a>
        {' '}for å se din plassering.
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TopplisterPage() {
  return (
    <>
      <SiteNav />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ padding: '20px 0 12px', textAlign: 'center' as const }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 }}>
              Quizkanonen · Sesong
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(22px, 5vw, 32px)' as string, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Sesong<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>topplisten</em>
            </h1>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#e8e4dd', fontStyle: 'italic' }}>
              Hvem dominerer over tid?
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', marginTop: 6 }}>
              Poeng samles gjennom måneden. Ny sesong starter den 1. hver måned.
            </p>
            <div style={{ width: '100%', height: 1, background: '#2a2d38', marginTop: 12 }} />
          </div>

          <ExpiredPremiumBanner />
          <ErrorBoundary>
            <SeasonLeaderboard scope="global" />
          </ErrorBoundary>

        </div>
      </div>
    </>
  )
}
