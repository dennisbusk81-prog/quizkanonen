'use client'

import { useEffect, useState } from 'react'
import SiteNav from '@/components/SiteNav'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import ErrorBoundary from '@/components/ErrorBoundary'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'

// Banneret het tidligere ExpiredPremiumBanner og sa «Reaktiver Premium». Begge
// deler påsto en tidligere Premium-tilstand systemet ikke kjenner: `hasScores`
// under teller season_scores, og processQuiz skriver de radene for ALLE
// innloggede deltakere uavhengig av Premium (lib/award-season-points.ts). Testen
// betyr «har spilt minst én gjort opp quiz innlogget», ikke «har hatt Premium»,
// så en gratisbruker som aldri har hatt Premium fikk beskjed om å «reaktivere».
// Det finnes ikke noe pålitelig signal på tidligere Premium å skille på:
// premium_since nullstilles ved kansellering, og stripe_customer_id dekker kun
// B2C-checkout. Teksten er derfor nøytral og sann i begge tilfeller. Samme
// endring som i app/historikk/page.tsx.
function PlacementLockedBanner() {
  // Premium fra delt context (ingen egen premium-status-fetch lenger).
  const { isPremium, userId, loading } = useProfile()
  const [hasScores, setHasScores] = useState(false)

  useEffect(() => {
    // Nullstillingsvakt i en asynkron datahenting: bytter bruker (eller logger
    // ut) må det gamle svaret forkastes før den nye spørringen. Regelen er ment
    // for avledet tilstand, ikke for opprydding rundt I/O.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        Du har spilt mens du var innlogget, så poengene dine er lagret.
        Nøyaktig plassering krever{' '}
        <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>
          Premium
        </a>.
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

          <PlacementLockedBanner />
          <ErrorBoundary>
            <SeasonLeaderboard scope="global" />
          </ErrorBoundary>

        </div>
      </div>
    </>
  )
}
