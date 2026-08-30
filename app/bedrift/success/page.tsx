'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getSessionIdentity } from '@/lib/session-identity'
import type { Session } from '@supabase/supabase-js'

type OrgData = {
  org: { id: string; name: string; plan: string }
  invites: Array<{ id: string; token: string; use_count: number; is_active: boolean; created_at: string }>
}

const STEPS = [
  { n: '1', title: 'Sett opp bedriften', desc: 'To korte valg: om de ansatte skal vises på den åpne topplisten, og når quizen skal stenge hos dere. Deretter er du i bedriftspanelet, der du finner invitasjonslenken og administrerer tilganger.' },
  { n: '2', title: 'Del invitasjonslenken', desc: 'Alle som logger inn via lenken får automatisk Premium-tilgang og havner på bedriftens leaderboard.' },
  { n: '3', title: 'Spill ukens quiz på fredag', desc: 'Quizkanonen sender ut ny quiz hver fredag. Alle med tilgang kan spille og konkurrere om topp-plasseringen i bedriften.' },
]

function SuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgSlug = searchParams.get('org')

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // Bust router cache so fresh data is shown after Stripe redirect
  useEffect(() => { router.refresh() }, [router])

  // Hard timeout — show page after 5s even if session/data is slow
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 5000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Dep-en er den STABILE identiteten, ikke session-objektet — se
  // lib/session-identity.ts, samme grep som /premium og org/[slug]/admin.
  // `session` settes av to skrivere (getSession().then over, og
  // onAuthStateChange sin INITIAL_SESSION) som leverer SAMME logiske sesjon som
  // to ULIKE objekter. Med objektet i dep-lista kan React ikke bail-e ut på
  // referanselikhet, og effekten kjørte to ganger for en innlogget kunde — to
  // samtidige kall mot admin-data, som er en tung samlerute, rett etter
  // betaling. Utlogget passerer begge `null` — referanselik — så feilen bet
  // kun innloggede.
  //
  // `session` leses fortsatt friskt inne i effekten; identiteten avgjør kun NÅR
  // den kjører. Vakten under er uendret i semantikk: 'unchecked' er nøyaktig
  // det `session === undefined` betydde.
  const sessionIdentity = getSessionIdentity(session)
  useEffect(() => {
    if (sessionIdentity === 'unchecked' || !orgSlug) return
    // Avslutter laste-tilstanden når sesjonssjekken er ferdig og ga «ikke
    // innlogget». `session === undefined` (uavklart) og `null` (avklart, ingen)
    // er to ulike tilstander; uten dette ville siden stått og lastet for en
    // utlogget bruker. (Den tidligere `eslint-disable-next-line
    // react-hooks/set-state-in-effect` her er FJERNET fordi den ble ubrukt da
    // dep-en byttet til sessionIdentity — regelen fyrer ikke lenger på denne
    // linja, og en ubrukt direktiv er selv en advarsel.)
    if (!session) { setLoading(false); return }

    fetch(`/api/org/${orgSlug}/admin-data`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdentity, orgSlug])

  const activeInvite = data?.invites.find(i => i.is_active)
  const inviteUrl = activeInvite
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/bli-med/${activeInvite.token}`
    : null

  // true = data lastet ferdig (timeout eller fetch), false = fortsatt venter
  const inviteResolved = !loading

  const copyInvite = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard nektet — ignorer */ }
  }

  if (loading) {
    return (
      <>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{' * { box-sizing: border-box; }'}</style>
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", color: '#e8e4dd' }}>
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
            <h1 style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 8 }}>
              {data ? `Velkommen, ${data.org.name}!` : 'Betaling mottatt!'}
            </h1>
            <p style={{ fontSize: 14, color: '#918f8a', lineHeight: 1.6 }}>
              Bedriftsprofilen er opprettet. Del invitasjonslenken med teamet for å komme i gang.
            </p>
          </div>

          {/* Invite link card — tre tilstander: laster / funnet / ikke funnet */}
          {!inviteResolved ? (
            <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
              <p style={{ fontSize: 13, color: '#918f8a', margin: 0 }}>Henter invitasjonslenke...</p>
            </div>
          ) : inviteUrl ? (
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
                  style={{ background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {copied ? 'Kopiert!' : 'Kopier'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#918f8a', marginTop: 10, lineHeight: 1.5 }}>
                Alle som trykker på lenken og logger inn blir del av teamet og får Premium-tilgang.
              </p>
            </div>
          ) : (
            <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
              <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 8, lineHeight: 1.5 }}>
                Invitasjonslenken din er klar i bedriftspanelet.
              </p>
              {orgSlug && (
                <a href={`/org/${orgSlug}/admin`} style={{ fontSize: 14, color: '#e8e4dd', textDecoration: 'underline', textDecorationColor: 'rgba(232,228,221,0.3)' }}>
                  Gå til bedriftspanelet →
                </a>
              )}
            </div>
          )}

          {/* Steps */}
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 20 }}>
              Kom i gang
            </p>
            {STEPS.map((step, i) => (
              <div key={step.n} style={{ display: 'flex', gap: 16, marginBottom: i < STEPS.length - 1 ? 20 : 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#c9a84c' }}>
                  {step.n}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 3 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.5 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orgSlug && (
              <Link
                href={`/org/${orgSlug}/velkommen`}
                style={{ display: 'block', textAlign: 'center', background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, textDecoration: 'none' }}
              >
                Sett opp bedriften →
              </Link>
            )}
            {orgSlug && (
              <Link
                href={`/org/${orgSlug}`}
                style={{ display: 'block', textAlign: 'center', background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 14, fontWeight: 600, padding: '12px', borderRadius: 10, textDecoration: 'none' }}
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

export default function BedriftSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  )
}
