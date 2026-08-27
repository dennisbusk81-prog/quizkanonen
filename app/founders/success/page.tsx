import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseServer } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { withTimeout } from '@/lib/with-timeout'
import Link from 'next/link'

// Samme frist som middleware.ts bruker på getUser() — se begrunnelsen der.
// Render-budsjettet er 300 s (målt 14. august 2026); uten frist ville et
// hengende Supabase-kall holdt siden til plattformen dreper funksjonen.
const AUTH_TIMEOUT_MS = 3000

const s = {
  page: {
    minHeight: '100vh',
    background: '#1a1c23',
    fontFamily: "var(--font-instrument-sans), sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },
  inner: {
    maxWidth: 520,
    width: '100%',
  },
  eyebrow: {
    fontFamily: "var(--font-instrument-sans), sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#c9a84c',
    marginBottom: 14,
  },
  logo: {
    fontFamily: "var(--font-libre-baskerville), serif",
    fontSize: 'clamp(32px, 7vw, 44px)',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
    marginBottom: 48,
  },
  logoEm: {
    fontStyle: 'italic',
    color: '#c9a84c',
  },
  card: {
    background: '#21242e',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 16,
    padding: '40px 36px',
    textAlign: 'center' as const,
  },
  heading: {
    fontFamily: "var(--font-libre-baskerville), serif",
    fontSize: 'clamp(22px, 5vw, 28px)',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 8,
  },
  activated: {
    fontSize: 13,
    fontWeight: 600,
    color: '#4ade80',
    letterSpacing: '0.04em',
    marginBottom: 24,
  },
  body: {
    fontSize: 15,
    color: '#e8e4dd',
    lineHeight: 1.65,
    marginBottom: 0,
  },
  btn: {
    display: 'inline-block',
    background: '#c9a84c',
    color: '#1a1c23',
    fontFamily: "var(--font-instrument-sans), sans-serif",
    fontSize: 15,
    fontWeight: 700,
    padding: '11px 28px',
    borderRadius: 10,
    textDecoration: 'none',
  },
  btnBack: {
    display: 'inline-block',
    marginTop: 16,
    fontSize: 13,
    color: '#e8e4dd',
    textDecoration: 'none',
  },
}

const features = [
  { label: 'Quizhistorikk og score-utvikling' },
  { label: 'Detaljert statistikk og beste streak' },
  { label: 'Private ligaer med venner og kolleger' },
]

// «Ukjent»-visningen: samme ramme som suksess-siden, men ingen påstander —
// verken «velkommen om bord» eller en redirect til /login//premium. Teksten
// er den samme som forsiden bruker ved ukjent auth (ordlyd godkjent av
// Dennis 16. august 2026).
function UkjentView() {
  return (
    <div style={s.page}>
      <div style={s.inner}>
        <p style={s.eyebrow}>Den ukentlige quizen</p>
        <h1 style={s.logo}>
          Quiz<em style={s.logoEm}>kanonen</em>
        </h1>
        <div style={s.card}>
          <p style={s.body}>
            Vi får ikke kontakt med innloggingen akkurat nå. Er du innlogget, er du det fortsatt — last siden på nytt om litt.
          </p>
          <div>
            <Link href="/" style={s.btnBack}>← Tilbake til forsiden</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default async function FoundersSuccessPage() {
  // Satte middleware `x-qk-auth: unknown`, fikk getUser() der aldri svar —
  // da skal ikke denne siden spørre GoTrue selv og gjenta det hengende
  // kallet. Samme regel som app/page.tsx: ukjent er en tredje tilstand,
  // aldri «utlogget». Headeren kan ikke settes utenfra (middleware stripper
  // innkommende verdi ubetinget).
  const authUnknown = (await headers()).get('x-qk-auth') === 'unknown'
  if (authUnknown) return <UkjentView />

  const supabase = await createSupabaseServer()
  // getUser() her er alltid et nettverkskall mot GoTrue (også med ferskt
  // token — det er hele poenget med metoden). Henger det, skal siden gi opp
  // og vise ukjent — ikke vente på render-budsjettet.
  const userOutcome = await withTimeout(supabase.auth.getUser(), { ms: AUTH_TIMEOUT_MS })
  if (!userOutcome.ok) return <UkjentView />

  const { data: { user }, error: userError } = userOutcome.value
  if (!user) {
    // Skillet som manglet fram til 16. august: `user === null` har TO
    // årsaker, og bare den ene betyr utlogget. Ingen sesjons-cookie
    // (AuthSessionMissingError) → ekte utlogget → /login som før. Alt annet
    // (500/429/nettverksfeil fra GoTrue) betyr «fikk ikke svar» — å
    // redirecte en innlogget bruker til /login på det var samme feilform
    // som forsiden viste «gjest» på.
    if (!userError || userError.name === 'AuthSessionMissingError') redirect('/login')
    return <UkjentView />
  }

  // Les premium_status med service role — RLS blokkerer kolonnen for
  // anon/bruker-klienten (gir undefined), så vi bruker supabaseAdmin her.
  // maybeSingle, ikke single: «rad mangler» er et definitivt svar (ikke
  // premium → /premium), mens en FEIL fra spørringen ikke er det — den
  // sendte tidligere en betalende founders-bruker til salgssiden.
  // `Promise.resolve(...)` fordi byggeren er en thenable, ikke et Promise.
  const profileOutcome = await withTimeout(
    Promise.resolve(
      supabaseAdmin
        .from('profiles')
        .select('premium_status')
        .eq('id', user.id)
        .maybeSingle()
    ),
    { ms: AUTH_TIMEOUT_MS }
  )
  if (!profileOutcome.ok) return <UkjentView />
  const { data: profile, error: profileError } = profileOutcome.value
  if (profileError) return <UkjentView />

  if (!profile?.premium_status) redirect('/premium')

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <p style={s.eyebrow}>Den ukentlige quizen</p>
        <h1 style={s.logo}>
          Quiz<em style={s.logoEm}>kanonen</em>
        </h1>

        <div style={s.card}>
          <h2 style={s.heading}>Velkommen om bord!</h2>
          <p style={s.activated}>Gratis tilgang er aktivert</p>

          {/* Feature list */}
          <div style={{ background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 20px', marginBottom: 28, textAlign: 'left' as const }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', marginBottom: 12, margin: '0 0 12px' }}>
              Du har nå tilgang til
            </p>
            {features.map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 7l4 4 6-7" stroke="#c9a84c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 14, color: '#e8e4dd' }}>{f.label}</span>
              </div>
            ))}
          </div>

          <Link href="/" style={s.btn}>
            Spill ukens quiz →
          </Link>

          {/* Disclaimer */}
          <div style={{ marginTop: 24, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '14px 18px', textAlign: 'left' as const }}>
            <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, margin: '0 0 6px' }}>
              <strong style={{ color: '#e8e4dd' }}>Ingen automatisk trekk</strong> — du bestemmer selv om du vil fortsette etter prøveperioden.
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, margin: 0 }}>
              Vi sender deg en påminnelse på e-post før prøveperioden utløper.
            </p>
          </div>

          <div>
            <Link href="/" style={s.btnBack}>← Tilbake til forsiden</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
