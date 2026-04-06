'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle } from '@/lib/auth'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type InviteInfo = { valid: true; orgName: string; orgSlug: string } | { valid: false; error: string }

export default function BliMedPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [inviteLoading, setInviteLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [alreadyMember, setAlreadyMember] = useState(false)

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
      if (res.status === 409) { setAlreadyMember(true); return }
      if (!res.ok) { setJoinError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      if (data.slug) router.push(`/org/${data.slug}`)
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
            <Link href="/" style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none' }}>
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

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 32px', textAlign: 'center' }}>

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

            {alreadyMember ? (
              <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#f87171', lineHeight: 1.5 }}>
                Du er allerede medlem av en organisasjon.
              </div>
            ) : !session ? (
              <>
                <button
                  onClick={() => signInWithGoogle(`/bli-med/${token}`)}
                  style={{ width: '100%', background: '#ffffff', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 600, padding: '13px', borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 10 }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
                    <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
                    <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
                    <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
                  </svg>
                  Logg inn med Google
                </button>
                <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>
                  Du sendes tilbake til denne siden etter innlogging
                </p>
              </>
            ) : (
              <>
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
              </>
            )}

          </div>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link href="/" style={{ fontSize: 12, color: '#7a7873', textDecoration: 'none' }}>
              ← Tilbake til forsiden
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
