'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

// ── Types ─────────────────────────────────────────────────────────────────────

type OrgInfo = {
  orgId:             string
  orgName:           string
  orgSlug:           string
  isAdmin:           boolean
  allowGlobalLeague: boolean
}

type LoadState = 'loading' | 'ready' | 'notfound' | 'error'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrgLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()

  const [session,   setSession]   = useState<Session | null | undefined>(undefined)
  const [org,       setOrg]       = useState<OrgInfo | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { router.push(`/login?next=/org/${slug}`); return }

    fetch('/api/org/my-orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: session.access_token }),
    })
      .then(r => r.ok ? r.json() : { orgs: [] })
      .then(json => {
        const found = (json.orgs ?? []).find((o: OrgInfo) => o.orgSlug === slug)
        if (!found) { setLoadState('notfound'); return }
        setOrg(found)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [session, slug, router])

  // ── Loading ───────────────────────────────────────────────────────────────

  if (session === undefined || loadState === 'loading') {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  if (loadState === 'notfound') {
    return (
      <>
        <style>{FONT}</style>
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>Ingen tilgang</p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24 }}>Du er ikke medlem av denne bedriften.</p>
            <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Forsiden</Link>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'error') {
    return (
      <>
        <style>{FONT}</style>
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Noe gikk galt. Prøv igjen.</p>
        </div>
      </>
    )
  }

  // ── Ready ─────────────────────────────────────────────────────────────────

  return (
    <>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={{ display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' }}>
              ← Forsiden
            </Link>
          </div>

          {/* Hero */}
          <div style={{ padding: '24px 0 12px', textAlign: 'center' as const }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 }}>
              {org?.orgName}
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(22px, 5vw, 32px)' as string, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Bedrifts<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>topplisten</em>
            </h1>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#7a7873', fontStyle: 'italic' }}>
              Hvem er {org?.orgName}s kanon?
            </p>
            <div style={{ width: '100%', height: 1, background: '#2a2d38', marginTop: 12 }} />
          </div>

          {/* Admin-lenke */}
          {org?.isAdmin && (
            <div style={{ textAlign: 'right' as const, marginBottom: 4 }}>
              <Link href={`/org/${slug}/admin`} style={{ fontSize: 12, color: '#c9a84c', textDecoration: 'none', letterSpacing: '0.04em' }}>
                Admin-panel →
              </Link>
            </div>
          )}

          {/* Sesong-toppliste scopet til bedriften */}
          {org && <SeasonLeaderboard scope="organization" scopeId={org.orgId} loginHref={`/login?next=/org/${slug}`} globalLeagueDisabled={!org.allowGlobalLeague} />}

        </div>
      </div>
    </>
  )
}
