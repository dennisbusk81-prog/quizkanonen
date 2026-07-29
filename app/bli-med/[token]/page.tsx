'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PENDING_ACTION_KEY } from '@/lib/pendingAction'
import AuthForm from '@/components/AuthForm'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type InviteInfo = { valid: true; orgName: string; orgSlug: string } | { valid: false; error: string }

// Invitasjonen peker på en organisasjon som brukeren allerede er sperret fra å
// bli med i (medlem av en ANNEN org). Join-ruten sender med navn og slug på den
// eksisterende orgen, slik at blindveien får en utvei i stedet for bare en rød
// boks — se «Forlat organisasjon» på /org/[slug].
type BlockedByOrg = { orgName: string | null; orgSlug: string | null }

export default function BliMedPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [inviteLoading, setInviteLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [alreadyMember, setAlreadyMember] = useState<BlockedByOrg | null>(null)

  // Load invite info (public, no auth needed)
  useEffect(() => {
    if (!token) return
    fetch(`/api/org/join/${token}`)
      .then(r => r.json())
      .then(d => setInvite(d))
      .catch(() => setInvite({ valid: false, error: 'Kunne ikke hente invitasjon' }))
      .finally(() => setInviteLoading(false))
  }, [token])

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Fallback hvis OAuth-runden mister ?next=. Settes så snart vi VET at brukeren
  // er utlogget — ikke lenger bare i Google-knappens onClick, siden innloggingen
  // nå kan starte fra tre likestilte metoder i AuthForm.
  //
  // Merk at nøkkelen bor i localStorage og derfor kun hjelper i SAMME nettleser.
  // Åpner brukeren en magic link på en annen enhet, er det `next=` i selve
  // lenken (håndtert server-side av /api/auth/bekreft) som tar dem tilbake hit.
  useEffect(() => {
    if (session === null && token) {
      localStorage.setItem(PENDING_ACTION_KEY, `org_join:${token}`)
    }
  }, [session, token])

  const handleJoin = async () => {
    if (!session || !token) return
    setJoining(true)
    setJoinError('')
    try {
      const res = await fetch(`/api/org/join/${token}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (res.status === 409) {
        localStorage.removeItem(PENDING_ACTION_KEY)
        setAlreadyMember({ orgName: data.currentOrgName ?? null, orgSlug: data.currentOrgSlug ?? null })
        return
      }
      if (!res.ok) { setJoinError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      if (data.slug) {
        // Clear pending fallback now that join succeeded
        localStorage.removeItem(PENDING_ACTION_KEY)
        // Fire-and-forget velkomst-e-post
        fetch('/api/org/welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token, orgSlug: data.slug }),
        }).catch(() => {})
        router.push(`/org/${data.slug}`)
      } else {
        setJoinError('Noe gikk galt. Prøv igjen.')
      }
    } catch {
      setJoinError('Noe gikk galt. Prøv igjen.')
    } finally {
      setJoining(false)
    }
  }

  if (inviteLoading || session === undefined) {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  // Invalid invite
  if (!invite || !invite.valid) {
    return (
      <>
        <style>{FONT}</style>
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
              Ugyldig lenke
            </p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24, lineHeight: 1.6 }}>
              {invite && !invite.valid ? (invite as { valid: false; error: string }).error : 'Invitasjonslenken er ikke gyldig.'}
            </p>
            <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
              ← Tilbake til forsiden
            </Link>
          </div>
        </div>
      </>
    )
  }

  const orgName = invite.orgName

  return (
    <>
      <style>{FONT + ' * { box-sizing: border-box; }'}</style>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
        <div style={{ maxWidth: 420, width: '100%' }}>

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 32px' }}>

            {/* Invitasjonskontekst — sentrert, uavhengig av innloggingstilstand */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="#c9a84c" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="9" cy="7" r="4" stroke="#c9a84c" strokeWidth="2"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="#c9a84c" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>

              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
                Invitasjon
              </p>
              <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 8 }}>
                Bli med i<br /><em style={{ fontStyle: 'italic', color: '#c9a84c' }}>{orgName}</em>
              </h1>
              <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 28, lineHeight: 1.6 }}>
                Du inviteres til bedriftens quiz-liga. Alle deltakere får Premium-tilgang inkludert.
              </p>
            </div>

            {alreadyMember ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#f87171', lineHeight: 1.5 }}>
                  {alreadyMember.orgName
                    ? `Du er allerede medlem av ${alreadyMember.orgName}. En konto kan bare være med i én bedrift om gangen.`
                    : 'Du er allerede medlem av en organisasjon. En konto kan bare være med i én bedrift om gangen.'}
                </div>
                {alreadyMember.orgSlug && (
                  <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6 }}>
                    Vil du bytte?{' '}
                    <Link href={`/org/${alreadyMember.orgSlug}`} style={{ color: '#e8e4dd', textDecoration: 'underline' }}>
                      Forlat {alreadyMember.orgName ?? 'organisasjonen'} først
                    </Link>
                    , og åpne denne lenken på nytt.
                  </p>
                )}
              </div>
            ) : !session ? (
              /* Samme innloggingsskjema som /login og toppnavigasjonen — Google,
                 passord OG magic link. Tidligere sto det kun en Google-knapp her,
                 så en ansatt uten Google-konto kom aldri inn i bedriften sin.
                 next= tar brukeren tilbake hit uansett hvilken metode de velger. */
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20, textAlign: 'center' }}>
                  Logg inn eller opprett en konto for å bli med.
                </p>
                <div style={{ height: 1, background: '#2a2d38', marginBottom: 24 }} />
                <AuthForm next={`/bli-med/${token}`} variant="modal" />
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={handleJoin}
                  disabled={joining}
                  style={{ width: '100%', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, border: 'none', cursor: joining ? 'not-allowed' : 'pointer', opacity: joining ? 0.6 : 1, marginBottom: 10 }}
                >
                  {joining ? 'Bli med...' : `Bli med i ${orgName} →`}
                </button>

                {joinError && (
                  <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', lineHeight: 1.5 }}>
                    {joinError}
                  </div>
                )}
              </div>
            )}

          </div>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link href="/" style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none' }}>
              ← Tilbake til forsiden
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
