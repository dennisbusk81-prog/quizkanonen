'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AuthForm from '@/components/AuthForm'
import type { Session } from '@supabase/supabase-js'

const STORAGE_KEY = 'qk-bedrift-pending'

const PLANS = [
  { id: 'starter',  label: 'Starter',  price: '499 kr/mnd', desc: 'Opptil 25 ansatte · 1 quiz/uke' },
  { id: 'standard', label: 'Standard', price: '899 kr/mnd', desc: 'Opptil 50 ansatte · egne tidspunkter, statistikk og CSV', featured: true },
]

const AVAILABLE_PLAN_IDS = PLANS.filter(p => !('disabled' in p && p.disabled)).map(p => p.id)

export default function BedriftRegistrerPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [slowSessionLoad, setSlowSessionLoad] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [plan, setPlan] = useState('standard')
  const [loading, setLoading] = useState(false)
  const [trialLoading, setTrialLoading] = useState(false)
  const [error, setError] = useState('')

  // Promo-kode (admin-initiert pilot-trial)
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoValidating, setPromoValidating] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [validatedCode, setValidatedCode] = useState<{ code: string; package: string; trial_days: number } | null>(null)

  useEffect(() => {
    const slowTimer = setTimeout(() => setSlowSessionLoad(true), 7000)
    return () => clearTimeout(slowTimer)
  }, [])

  useEffect(() => {
    // Pick up plan from query string — redirect disabled plans back to /bedrift
    const p = new URLSearchParams(window.location.search).get('plan')
    if (p && !AVAILABLE_PLAN_IDS.includes(p)) {
      router.replace('/bedrift')
      return
    }
    if (p && AVAILABLE_PLAN_IDS.includes(p)) setPlan(p)

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try {
            const saved = JSON.parse(raw)
            if (saved.orgName) setOrgName(saved.orgName)
            if (saved.plan)    setPlan(saved.plan)
            if (saved.promoCode) validatePromo(saved.promoCode)
          } catch { /* ignore */ }
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try {
            const saved = JSON.parse(raw)
            if (saved.orgName) setOrgName(saved.orgName)
            if (saved.plan)    setPlan(saved.plan)
            if (saved.promoCode) validatePromo(saved.promoCode)
          } catch { /* ignore */ }
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Bevar skjemaet over innloggingsrunden. Tidligere ble dette lagret i ett
  // punkt — Google-knappens onClick. Nå kan innloggingen starte fra tre
  // likestilte metoder inne i AuthForm, og passord-innlogging navigerer ikke i
  // det hele tatt, så vi lagrer kontinuerlig mens brukeren er utlogget i stedet
  // for å hekte lagringen på én bestemt knapp.
  //
  // sessionStorage lever per fane. Åpner brukeren en magic link på en ANNEN
  // enhet, er utkastet borte og de fyller inn navnet på nytt — derfor bærer
  // også next= med seg valgt plan, så de i det minste lander riktig sted.
  // `session === null` betyr BEKREFTET utlogget. `undefined` er «vet ikke ennå»
  // og må ikke skrive: da ville første render overskrevet et lagret utkast med
  // et tomt skjema før getSession() rekker å svare og gjenopprette det.
  useEffect(() => {
    if (session !== null) return
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ orgName, plan, promoCode: validatedCode?.code ?? '' }))
  }, [session, orgName, plan, validatedCode])

  const planLabel = (id: string) => PLANS.find(p => p.id === id)?.label ?? id

  const validatePromo = async (rawCode?: string) => {
    const code = (rawCode ?? promoCode).trim().toUpperCase()
    if (!code) { setPromoError('Skriv inn en kode.'); return }
    setPromoValidating(true)
    setPromoError('')
    try {
      const res = await fetch('/api/org/trial-code/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok || !data.valid) {
        setPromoError(data.error ?? 'Ugyldig kode.')
        setValidatedCode(null)
        return
      }
      setPromoOpen(true)
      setPromoCode(code)
      setValidatedCode({ code, package: data.package, trial_days: data.trial_days })
      setPlan(data.package)
    } catch {
      setPromoError('Noe gikk galt. Prøv igjen.')
    } finally {
      setPromoValidating(false)
    }
  }

  const clearPromo = () => {
    setValidatedCode(null)
    setPromoCode('')
    setPromoError('')
  }

  const handleSubmit = async () => {
    if (!orgName.trim()) { setError('Oppgi et bedriftsnavn.'); return }
    // Nås kun via Enter i navnefeltet mens brukeren er utlogget — betalings-
    // knappene rendres ikke da. Peker på skjemaet under i stedet for å starte
    // én bestemt innloggingsmetode på brukerens vegne.
    if (!session) { setError('Logg inn nederst på siden for å fortsette.'); return }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/org-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ organizationName: orgName.trim(), plan }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      if (data.url) window.location.href = data.url
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  const handleTrial = async () => {
    if (!orgName.trim()) { setError('Oppgi et bedriftsnavn.'); return }
    if (!session) { setError('Logg inn nederst på siden for å fortsette.'); return }

    setTrialLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/org-founders-activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          organizationName: orgName.trim(),
          plan,
          ...(validatedCode ? { trialCode: validatedCode.code } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      // Til oppsettet, ikke rett inn i panelet. Trial-veien hoppet tidligere
      // over enhver velkomst — /bedrift/success finnes kun for betalt kjøp — og
      // det er nettopp trial-veien de fleste bedrifter kommer inn gjennom.
      if (data.slug) window.location.href = `/org/${data.slug}/velkommen`
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setTrialLoading(false)
    }
  }

  if (session === undefined) {
    return (
      <>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' }}>Henter kontoen din …</p>
            {slowSessionLoad && (
              <p style={{ fontSize: 13, color: '#918f8a', marginTop: 12 }}>
                Dette tar lengre tid enn vanlig.{' '}
                <a href="/bedrift/registrer" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>Prøv igjen</a>
              </p>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{' * { box-sizing: border-box; }'}</style>
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', padding: '48px 20px 80px' }}>

          <Link href="/bedrift" style={{ display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 32, letterSpacing: '0.04em' }}>
            ← Tilbake
          </Link>

          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
            Quizkanonen for bedrifter
          </p>
          <h1 style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Registrer <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>bedriften</em>
          </h1>
          <p style={{ fontSize: 14, color: '#918f8a', marginBottom: 32, lineHeight: 1.6 }}>
            Velg plan og betal via Stripe. Ingen binding — avslutt når du vil.
          </p>

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px' }}>

            {/* Org name */}
            <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', display: 'block', marginBottom: 8 }}>
              Bedriftsnavn
            </label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Acme AS"
              maxLength={60}
              autoFocus
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '12px 16px', fontSize: 15, color: '#ffffff', fontFamily: "var(--font-instrument-sans), sans-serif", outline: 'none' }}
            />

            {validatedCode ? (
              /* Innløst promo-kode: koden bestemmer pakke og trial-lengde, så
                 planvelger og pris skjules. */
              <div style={{ marginTop: 24 }}>
                <div style={{ background: '#1e1a0e', border: '1.5px solid #c9a84c', borderRadius: 10, padding: '18px 20px' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 6 }}>
                    Promo-kode aktivert
                  </p>
                  <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 20, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
                    {validatedCode.trial_days} dager gratis — {planLabel(validatedCode.package)}
                  </p>
                  <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.5 }}>
                    Ingen kortinfo nødvendig. Koden <strong style={{ color: '#ffffff' }}>{validatedCode.code}</strong> gir full tilgang i prøveperioden.
                  </p>
                  <button
                    onClick={clearPromo}
                    style={{ marginTop: 12, fontSize: 13, color: '#e8e4dd', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif", textDecoration: 'underline' }}
                  >
                    Fjern kode
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Plan selection */}
                <div style={{ marginTop: 24 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', display: 'block', marginBottom: 10 }}>
                    Velg plan
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PLANS.map(p => {
                      const isDisabled = 'disabled' in p && p.disabled
                      const selected = plan === p.id && !isDisabled
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isDisabled && setPlan(p.id)}
                          style={{
                            background: isDisabled ? 'transparent' : selected ? (p.featured ? '#1e1a0e' : 'rgba(201,168,76,0.04)') : '#1a1c23',
                            border: isDisabled ? '1px solid #2a2d38' : selected ? '1.5px solid #c9a84c' : '1px solid #2a2d38',
                            borderRadius: 10,
                            padding: '14px 16px',
                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                            opacity: isDisabled ? 0.4 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                          }}
                        >
                          <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? '#c9a84c' : '#2a2d38'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c9a84c' }} />}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 2 }}>
                              {p.label}{p.featured ? ' — mest populær' : ''}{isDisabled ? ' — kommer snart' : ''}
                            </div>
                            <div style={{ fontSize: 12, color: '#c9a84c', fontWeight: 600 }}>{p.price}</div>
                            <div style={{ fontSize: 11, color: '#918f8a', marginTop: 1 }}>{p.desc}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Promo-kode */}
                <div style={{ marginTop: 20 }}>
                  {!promoOpen ? (
                    <button
                      onClick={() => setPromoOpen(true)}
                      style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif", textDecoration: 'underline' }}
                    >
                      Har du en promo-kode?
                    </button>
                  ) : (
                    <>
                      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', display: 'block', marginBottom: 8 }}>
                        Promo-kode
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          value={promoCode}
                          onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoError('') }}
                          onKeyDown={e => e.key === 'Enter' && validatePromo()}
                          placeholder="F.eks. PILOT-ELKJOP"
                          style={{ flex: 1, minWidth: 0, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '12px 16px', fontSize: 15, color: '#ffffff', fontFamily: "var(--font-instrument-sans), sans-serif", outline: 'none', letterSpacing: '0.04em' }}
                        />
                        <button
                          onClick={() => validatePromo()}
                          disabled={promoValidating || !promoCode.trim()}
                          style={{ background: 'transparent', color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 14, fontWeight: 600, padding: '10px 28px', borderRadius: 10, border: '1px solid #e8e4dd', cursor: promoValidating || !promoCode.trim() ? 'not-allowed' : 'pointer', opacity: promoValidating || !promoCode.trim() ? 0.4 : 1, whiteSpace: 'nowrap' }}
                        >
                          {promoValidating ? 'Sjekker…' : 'Bruk kode'}
                        </button>
                      </div>
                      {promoError && (
                        <p style={{ fontSize: 13, color: '#f87171', marginTop: 8, lineHeight: 1.5 }}>{promoError}</p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            <div style={{ height: 1, background: '#2a2d38', margin: '24px 0' }} />

            {!session ? (
              /* Samme innloggingsskjema som /login og toppnavigasjonen — Google,
                 passord OG magic link. Tidligere sto det kun en Google-knapp her,
                 så en bedrift uten Google-kontoer kunne ikke registrere seg.
                 InAppBrowserWarning ligger inne i AuthForm — ikke dupliser den.
                 next= bærer med seg valgt plan, slik at en magic link åpnet på en
                 annen enhet i det minste lander på riktig plan. */
              <>
                <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20, textAlign: 'center' }}>
                  Logg inn eller opprett en konto for å fortsette.
                </p>
                <AuthForm next={`/bedrift/registrer?plan=${plan}`} onSuccess={() => { /* bli på siden — auth-lytteren over avdekker betalingsvalgene */ }} variant="modal" />
                <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
                  Skjemaet er lagret — du kommer tilbake hit etter innlogging
                </p>
              </>
            ) : validatedCode ? (
              <>
                <button
                  onClick={handleTrial}
                  disabled={loading || trialLoading || !orgName.trim()}
                  style={{ width: '100%', background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, border: 'none', cursor: loading || trialLoading || !orgName.trim() ? 'not-allowed' : 'pointer', opacity: loading || trialLoading || !orgName.trim() ? 0.4 : 1 }}
                >
                  {trialLoading ? 'Starter...' : 'Aktiver prøveperiode →'}
                </button>
                <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                  Bedriftssidene sperres til betaling hvis du ikke fortsetter etter prøveperioden.
                </p>
              </>
            ) : (
              <>
                <button
                  onClick={handleSubmit}
                  disabled={loading || trialLoading || !orgName.trim()}
                  style={{ width: '100%', background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, border: 'none', cursor: loading || trialLoading || !orgName.trim() ? 'not-allowed' : 'pointer', opacity: loading || trialLoading || !orgName.trim() ? 0.4 : 1 }}
                >
                  {loading ? 'Sender...' : 'Gå til betaling →'}
                </button>
                <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                  Betaling håndteres sikkert av Stripe. Ingen binding.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                  <div style={{ flex: 1, height: 1, background: '#2a2d38' }} />
                  <span style={{ fontSize: 11, color: '#918f8a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>eller</span>
                  <div style={{ flex: 1, height: 1, background: '#2a2d38' }} />
                </div>

                <button
                  onClick={handleTrial}
                  disabled={loading || trialLoading || !orgName.trim()}
                  style={{ width: '100%', background: 'transparent', color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 15, fontWeight: 600, padding: '13px', borderRadius: 10, border: '1px solid #e8e4dd', cursor: loading || trialLoading || !orgName.trim() ? 'not-allowed' : 'pointer', opacity: loading || trialLoading || !orgName.trim() ? 0.4 : 1 }}
                >
                  {trialLoading ? 'Starter...' : 'Prøv gratis i 14 dager'}
                </button>
                <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                  Ingen kortinfo nødvendig. Bedriftssidene sperres til betaling hvis du ikke fortsetter etter prøveperioden.
                </p>
              </>
            )}

            {error && (
              <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginTop: 14, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
