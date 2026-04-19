'use client'

import Link from 'next/link'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TopplisterPage() {
  return (
    <>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={{ display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' }}>
              ← Tilbake til forsiden
            </Link>
          </div>

          <div style={{ padding: '24px 0 12px', textAlign: 'center' as const }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 }}>
              Quizkanonen · Sesong
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(22px, 5vw, 32px)' as string, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Sesong<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>topplisten</em>
            </h1>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#7a7873', fontStyle: 'italic' }}>
              Hvem dominerer over tid?
            </p>
            <div style={{ width: '100%', height: 1, background: '#2a2d38', marginTop: 12 }} />
          </div>

          <SeasonLeaderboard scope="global" />

        </div>
      </div>
    </>
  )
}
