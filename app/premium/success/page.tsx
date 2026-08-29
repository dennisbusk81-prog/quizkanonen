'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/SiteNav'

// Samme form som «Hard timeout — show page after 5s» i app/bedrift/success:
// 'verifying' skal ikke kunne stå for alltid. Fristen kan være stram fordi et
// sent, vellykket svar fortsatt oppgraderer til kvitteringen ('ukjent' → 'paid'
// er lov; timeren nedgraderer aldri noe annet enn 'verifying').
const HARD_TIMEOUT_MS = 5000

const s = {
  page: { minHeight: '100vh', background: '#1a1c23', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "var(--font-instrument-sans), sans-serif" },
  card: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: '16px', padding: '40px', maxWidth: '500px', width: '100%', textAlign: 'center' as const },
  icon: { width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
  title: { fontFamily: "var(--font-libre-baskerville), serif", fontSize: '1.75rem', color: '#ffffff', marginBottom: '8px' },
  subtitle: { color: '#e8e4dd', marginBottom: '32px', fontSize: '1rem', lineHeight: 1.6 },
  loadingTitle: { fontFamily: "var(--font-libre-baskerville), serif", fontSize: '1.75rem', color: '#ffffff', marginBottom: '8px' },
  loadingSub: { color: '#918f8a', fontSize: '0.95rem', lineHeight: 1.6, fontStyle: 'italic' as const },
  btn: { display: 'inline-block', padding: '11px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', fontFamily: "var(--font-instrument-sans), sans-serif" },
  btnSecondary: { display: 'inline-block', marginTop: 16, fontSize: '0.9rem', color: '#e8e4dd', textDecoration: 'underline', textDecorationColor: 'rgba(232,228,221,0.3)' },
}

const CheckIcon = (
  <div style={s.icon}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M5 12l5 5L19 7" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </div>
)

function PremiumSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  // Dette er en KVITTERINGSSIDE: kunden har betalt, Stripe har sendt henne
  // hit. Ingen av feiltilstandene får derfor sende henne til /premium — en
  // salgsside med «kr 49/mnd» er en påstand om at betalingen ikke skjedde.
  // «Vet ikke» er ikke «nei» (samme regel som app/quiz/[id]/page.tsx:
  // «'feil' — 'vet ikke', med Prøv igjen — aldri forkledd som 'ingen'»).
  //   'ukjent'    = verifiseringen feilet eller rakk ikke fram i tide
  //   'nosession' = ingen innlogging i denne fanen — kan ikke kalle
  //                 verify-session (krever Bearer), men betalingen står
  const [loadState, setLoadState] = useState<'verifying' | 'paid' | 'ukjent' | 'nosession'>('verifying')
  const [attempt, setAttempt] = useState(0)

  // Verifiser betalingen direkte mot Stripe via session_id — ikke avhengig av at
  // webhooken har rukket å sette premium_status i DB (unngår race condition).
  useEffect(() => {
    let cancelled = false

    // Hard timeout: uansett hvor verifiseringen henger (getSession, fetch)
    // skal 'Aktiverer Premium…' avløses. Kun 'verifying' røres — et svar som
    // allerede har landet ('paid'/'nosession') nedgraderes aldri.
    const hardTimer = setTimeout(() => {
      if (!cancelled) setLoadState(prev => (prev === 'verifying' ? 'ukjent' : prev))
    }, HARD_TIMEOUT_MS)

    async function verify() {
      // Uten session_id er dette ikke en retur fra Stripe (checkout-ruten
      // legger alltid på {CHECKOUT_SESSION_ID}) — direkte besøk sendes til
      // salgssiden. Dette er den ENESTE redirecten i fila, og den skal
      // forbli det: lib/premium-success-verify.test.ts teller.
      if (!sessionId) { router.replace('/premium'); return }
      try {
        // getSession() ligger INNE i try: kaster den, skal utfallet bli
        // 'ukjent' — ikke en evig 'verifying'. Omforsøket etter 500 ms er
        // samme form som /historikk og /liga: Supabase kan ennå ikke ha
        // hydrert sesjonen fra localStorage rett etter redirecten fra Stripe.
        let { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          await new Promise<void>(resolve => setTimeout(resolve, 500))
          if (cancelled) return
          const { data } = await supabase.auth.getSession()
          session = data.session
        }
        if (cancelled) return
        if (!session?.access_token) { setLoadState('nosession'); return }

        const res = await fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = res.ok ? await res.json() : { paid: false }
        if (cancelled) return
        // Et sent 'paid' overstyrer med vilje en 'ukjent' som hard-timeren
        // rakk å vise — verifisert er verifisert.
        if (data.paid) setLoadState('paid')
        else setLoadState('ukjent')
      } catch {
        if (!cancelled) setLoadState('ukjent')
      }
    }
    verify()
    return () => { cancelled = true; clearTimeout(hardTimer) }
  }, [sessionId, router, attempt])

  const retry = () => { setLoadState('verifying'); setAttempt(a => a + 1) }
  const loginNext = sessionId ? `/login?next=${encodeURIComponent(`/premium/success?session_id=${sessionId}`)}` : '/login'

  if (loadState === 'verifying') {
    return (
      <>
        <SiteNav />
        <div style={s.page}>
          <div style={s.card}>
            {CheckIcon}
            <div style={s.loadingTitle}>Aktiverer Premium…</div>
            <div style={s.loadingSub}>Vi bekrefter betalingen din. Et øyeblikk.</div>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'ukjent') {
    return (
      <>
        <SiteNav />
        <div style={s.page}>
          <div style={s.card}>
            {CheckIcon}
            <div style={s.title}>Betalingen er mottatt</div>
            <div style={s.subtitle}>
              Vi fikk ikke bekreftet aktiveringen akkurat nå. Det påvirker ikke
              betalingen din — kvitteringen kommer på e-post fra Stripe, og
              Premium aktiveres som regel i løpet av et øyeblikk.
            </div>
            <button onClick={retry} style={s.btn}>Prøv igjen</button>
            <div>
              <Link href="/" style={s.btnSecondary}>Til forsiden</Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'nosession') {
    return (
      <>
        <SiteNav />
        <div style={s.page}>
          <div style={s.card}>
            {CheckIcon}
            <div style={s.title}>Betalingen er mottatt</div>
            <div style={s.subtitle}>
              Vi finner ingen innlogging i denne fanen, så vi får ikke vist
              kvitteringen her. Betalingen er registrert hos Stripe. Logg inn
              med kontoen du betalte med, så finner du kvitteringen igjen.
            </div>
            <Link href={loginNext} style={s.btn}>Logg inn</Link>
            <div>
              <Link href="/" style={s.btnSecondary}>Til forsiden</Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'paid') {
    return (
      <>
        <SiteNav />
        <div style={s.page}>
          <div style={s.card}>
            {CheckIcon}
            <div style={s.title}>Velkommen til Premium!</div>
            <div style={s.subtitle}>
              Betalingen gikk gjennom. Du har nå full tilgang til alle Premium-funksjoner på Quizkanonen.
            </div>
            <Link href="/" style={s.btn}>
              Gå til forsiden
            </Link>
          </div>
        </div>
      </>
    )
  }

  // Kan ikke nås — alle fire tilstandene er håndtert over. Finnes for at en
  // NY tilstand ikke skal falle stille inn i en av kvitteringene: uten egen
  // gren rendres ingenting, som oppdages umiddelbart.
  return null
}

export default function PremiumSuccessPage() {
  return (
    <Suspense fallback={null}>
      <PremiumSuccessContent />
    </Suspense>
  )
}
