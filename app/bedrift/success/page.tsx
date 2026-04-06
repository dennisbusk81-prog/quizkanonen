'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type OrgData = {
  org: { id: string; name: string; plan: string }
  invites: Array<{ id: string; token: string; use_count: number; is_active: boolean; created_at: string }>
}

const STEPS = [
  { n: '1', title: 'Kopier invitasjonslenken', desc: 'Del lenken med alle ansatte — den gir direkte tilgang til teamet.' },
  { n: '2', title: 'Ansatte logger inn', desc: 'De trykker på lenken, logger inn med Google eller e-post, og er med på sekunder.' },
  { n: '3', title: 'Spill neste quiz', desc: 'Alle ser eget leaderboard — kun for din bedrift. Premium inkludert for alle.' },
]

export default function BedriftSuccessPage() {
  const searchParams = useSearchParams()
  const orgSlug = searchParams.get('org')

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined || !orgSlug) return
    if (!session) { setLoading(false); return }

    fetch(`/api/org/${orgSlug}/admin-data`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [session, orgSlug])

  const activeInvite = data?.invites.find(i => i.is_active)
  const inviteUrl = activeInvite
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/bli-med/${activeInvite.token}`
    : null

  const copyInvite = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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

  return (
    <>
      <style>{FONT + ' * { box-sizing: border-box; }'}</style>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 20px 80px' }}>

          {/* Success header */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L19 7" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
              Betaling fullført
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 8 }}>
              {data ? `Velkommen, ${data.org.name}!` : 'Betaling mottatt!'}
            </h1>
            <p style={{ fontSize: 14, color: '#7a7873', lineHeight: 1.6 }}>
              Bedriftsprofilen er opprettet. Del invitasjonslenken med teamet for å komme i gang.
            </p>
          </div>

          {/* Invite link card */}
          {inviteUrl && (
            <div style={{ background: '#1e1a0e', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 12 }}>
                Invitasjonslenke
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#e8e4dd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inviteUrl}
                </div>
                <button
                  onClick={copyInvite}
                  style={{ background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {copied ? 'Kopiert!' : 'Kopier'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#7a7873', marginTop: 10, lineHeight: 1.5 }}>
                Alle som trykker på lenken og logger inn blir del av teamet og får Premium-tilgang.
              </p>
            </div>
          )}

          {/* Steps */}
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 20 }}>
              Kom i gang
            </p>
            {STEPS.map((step, i) => (
              <div key={step.n} style={{ display: 'flex', gap: 16, marginBottom: i < STEPS.length - 1 ? 20 : 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#c9a84c' }}>
                  {step.n}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 3 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.5 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orgSlug && (
              <Link
                href={`/org/${orgSlug}/admin`}
                style={{ display: 'block', textAlign: 'center', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, textDecoration: 'none' }}
              >
                Gå til admin-panelet →
              </Link>
            )}
            {orgSlug && (
              <Link
                href={`/org/${orgSlug}`}
                style={{ display: 'block', textAlign: 'center', background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 600, padding: '12px', borderRadius: 10, textDecoration: 'none' }}
              >
                Se bedrifts-leaderboard
              </Link>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
