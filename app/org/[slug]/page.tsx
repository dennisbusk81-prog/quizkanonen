'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/SiteNav'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import OrgLockedScreen from '@/components/OrgLockedScreen'
import LeaveOrgModal from '@/components/LeaveOrgModal'
import { isOrgLocked } from '@/lib/org-access'
import { deriveOrgLoadState, type OrgLoadState } from '@/lib/org-membership-state'
import { useProfile } from '@/components/ProfileProvider'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

// ── Types ─────────────────────────────────────────────────────────────────────

type OrgInfo = {
  orgId:              string
  orgName:            string
  orgSlug:            string
  isAdmin:            boolean
  subscriptionStatus: string
  allowGlobalLeague:  boolean
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrgLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()

  // Org-data kommer nå fra den delte ProfileProvider-contexten (ett
  // /api/org/my-orgs-kall per sesjon) i stedet for et eget kall her — speiler
  // migreringen gjort i components/OrgCard.tsx (commit df99071).
  const { myOrgs, myOrgsLoaded, myOrgsError, refreshMyOrgs } = useProfile()

  const [session,   setSession]   = useState<Session | null | undefined>(undefined)
  const [slowLoad, setSlowLoad] = useState(false)
  const [leaveModal, setLeaveModal] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const slowTimer = setTimeout(() => setSlowLoad(true), 7000)
    return () => clearTimeout(slowTimer)
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { router.push(`/login?next=/org/${slug}`); return }
  }, [session, slug, router])

  const org: OrgInfo | null = myOrgs.find(o => o.orgSlug === slug) ?? null
  // Gatet på myOrgsLoaded, IKKE på profileLoading. Se lib/org-membership-state.ts
  // for hvorfor: `loading` ble satt til false av grener som ikke hadde hentet
  // org-listen i det hele tatt, og «ikke medlem» ble derfor vist til ekte
  // ansatte mens hentingen fortsatt pågikk.
  const loadState: OrgLoadState = deriveOrgLoadState({
    session: session === undefined ? 'unchecked' : session ? 'authenticated' : 'anonymous',
    hasOrg: org !== null,
    myOrgsLoaded,
    myOrgsError,
  })

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Henter bedriften din …</p>
            {slowLoad && (
              <p style={{ fontSize: 13, color: '#7a7873', marginTop: 12 }}>
                Dette tar lengre tid enn vanlig.{' '}
                <a href={`/org/${slug}`} style={{ color: '#e8e4dd', textDecoration: 'underline' }}>Prøv igjen</a>
              </p>
            )}
          </div>
        </div>
      </>
    )
  }

  // ── Feil ──────────────────────────────────────────────────────────────────
  // Egen skjerm, ikke «Ingen tilgang». Et 401/500 fra my-orgs betyr at vi ikke
  // VET om brukeren er medlem — å påstå at hen ikke er det, er både feil og en
  // blindvei (samme skille som org-admin allerede gjør med errorKind).
  if (loadState === 'error') {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>
              Kunne ikke hente bedriften din
            </p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24, lineHeight: 1.6 }}>
              Vi fikk ikke kontakt akkurat nå. Medlemskapet ditt er uendret.
            </p>
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => { void refreshMyOrgs() }}
                style={{
                  padding: '10px 28px', background: '#c9a84c', color: '#1a1c23',
                  border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                  fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                }}
              >
                Prøv igjen
              </button>
            </div>
            <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Forsiden</Link>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'notfound') {
    return (
      <>
        <style>{FONT}</style>
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

  // ── Låst org (utløpt trial uten betaling) ──────────────────────────────────
  if (org && session && isOrgLocked(org)) {
    return <OrgLockedScreen orgName={org.orgName} orgId={org.orgId} orgSlug={slug} accessToken={session.access_token} />
  }

  // ── Ready ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{FONT}</style>

      <SiteNav />

      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 80px' }}>

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

          {/* Sesong-toppliste scopet til bedriften */}
          {org && <SeasonLeaderboard scope="organization" scopeId={org.orgId} orgSlug={slug} loginHref={`/login?next=/org/${slug}`} globalLeagueDisabled={!org.allowGlobalLeague} />}

          {/* Medlemskap — eneste stedet en vanlig ansatt kan melde seg ut selv.
              Uten dette var en konto låst til én bedrift for alltid: en
              invitasjon fra en ny arbeidsgiver ga bare «Du er allerede medlem av
              en organisasjon», uten noen vei videre. */}
          {org && session && (
            <div style={{
              background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16,
              padding: '24px 20px', marginTop: 40,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 6 }}>
                  Medlemskap
                </p>
                <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6 }}>
                  Du er med i {org.orgName}. Forlater du bedriften, beholder du kontoen,
                  quizhistorikken og poengene dine — du fortsetter som vanlig bruker.
                </p>
              </div>
              <button
                onClick={() => setLeaveModal(true)}
                style={{
                  padding: '10px 28px', background: 'transparent',
                  border: '1px solid rgba(248,113,113,0.4)', borderRadius: 10,
                  fontSize: 13, fontWeight: 600, color: '#f87171',
                  fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                  transition: 'background 0.15s', flexShrink: 0, whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                Forlat organisasjon
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Siste-admin-sperren håndheves av ruten (409 last_admin) — denne siden
          kjenner ikke antall administratorer, så modalen viser forklaringen
          når svaret kommer. */}
      {leaveModal && org && session && (
        <LeaveOrgModal
          orgName={org.orgName}
          orgSlug={slug}
          accessToken={session.access_token}
          onClose={() => setLeaveModal(false)}
        />
      )}
    </>
  )
}
