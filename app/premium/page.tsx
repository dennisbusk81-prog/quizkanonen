'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { PENDING_ACTION_KEY } from '@/lib/pendingAction'
import { fetchTrialOffer } from '@/lib/trial-offer-fetch'
import { getSessionIdentity } from '@/lib/session-identity'
import type { TrialOffer } from '@/lib/trial-offer'
import { activationLogLevel, decideActivationNotice } from '@/lib/trial-activation-notice'

// Nøkkelen som bærer «brukeren trykket Prøv gratis, men var ikke innlogget»
// gjennom innloggingen. Samme mekanikk som liga-/org-invitasjonene bruker, og
// samme som den avviklede founders_checkout-flyten brukte.
const PENDING_TRIAL = 'trial_activate'

// To planer, begge tilbys — årsprisen er et tillegg, ikke en erstatning
// (Dennis' beslutning 30. august 2026). priceId er SYMBOLSKE navn; de ekte
// price-ID-ene bor i Vercels env og oversettes av PRICE_ENV_BY_SYMBOL i
// checkout-ruta. Årsplanen står øverst og er forvalgt: gullrammen skal lande
// på den, og begge kortene viser begge tallene (588 på månedskortet, 33 på
// årskortet) slik at sammenligningen kan gjøres uten hoderegning. Begge
// omregningene innledes med «Tilsvarer» — symmetrien er poenget: uten den
// leses «kr 588 i året» som en prislapp i stedet for som et regnestykke, og
// jobber mot at 49 kr/mnd skal føles liten og reversibel.
const PLANS = [
  { id: 'yearly', name: 'Premium årlig', price: 'kr 399/år', desc: 'Tilsvarer kr 33/mnd — spar 189 kr i året', priceId: 'STRIPE_PRICE_PREMIUM_YEARLY' },
  { id: 'monthly', name: 'Premium månedlig', price: 'kr 49/mnd', desc: 'Tilsvarer kr 588 i året — avslutt når du vil', priceId: 'STRIPE_PRICE_PREMIUM_MONTHLY' },
] as const
type PlanId = (typeof PLANS)[number]['id']

const FEATURES = [
  'Nøyaktig plassering på leaderboard',
  'Full sesong-toppliste — søk og bla gjennom alle spillere',
  'Historikk og statistikk — beste plassering, streak og utvikling over tid',
  'Private ligaer med venner',
  'Se nøyaktig hvilke spørsmål du svarte feil på, uke for uke',
  // «hvert spørsmål» var usant: ruten leverer bevisst kun de to letteste + to
  // vanskeligste (sikkerhetsbeslutning 26. juli — HIGHLIGHT_COUNT i
  // answer-distribution/route.ts). Samme ordlyd som svarfordeling-seksjonen
  // på /leaderboard/[id] allerede bruker.
  'Svarfordeling — se hvordan alle svarte på ukens letteste og vanskeligste spørsmål',
  // Arkivet ble bygget 27. august ([ARK-1]) og var fram til nå ikke nevnt i
  // NOEN markedsføringstekst — hverken her, på /slik-fungerer-det eller i
  // oppsalgspanelet på resultatskjermen. Ordlyden er hentet fra flatens egen
  // tekst i app/arkiv/page.tsx, som allerede sier det sant: «som trening»,
  // «teller ikke i sesongen», «hvilken plass du ville fått den uken».
  // Sesong-forbeholdet står MED i punktet, ikke bare på flaten det gjelder —
  // dette er salgssiden, og et arkivresultat som ikke dukker opp på
  // topplisten ville ellers lest som en feil, ikke som funksjonen.
  'Arkivet — spill tidligere quizer på nytt som trening, og se hvilken plass du ville fått den uken (teller ikke i sesongen)',
]

export default function PremiumPage() {
  const [loading, setLoading] = useState(false)
  const [showLoginAlert, setShowLoginAlert] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [planId, setPlanId] = useState<PlanId>('yearly')

  // Prøveperiode-tilbudet. `null` = ikke hentet ennå (vis ingenting framfor å
  // blinke feil tilbud); ellers avgjort av decideTrialOffer.
  const [trialOffer, setTrialOffer] = useState<TrialOffer | null>(null)
  const [trialPhase, setTrialPhase] = useState<'idle' | 'running' | 'done'>('idle')
  // Feilteksten fra ruten vises ordrett. 409-en er ikke en teknisk feil, men
  // det ærlige svaret («du har allerede hatt en prøveperiode …») — den skal
  // leses som informasjon, ikke som at noe gikk i stykker.
  const [trialNotice, setTrialNotice] = useState<string | null>(null)
  // Har brukeren allerede et levende abonnement (active/trialing)? Da vises
  // «Administrer abonnement» i stedet for kjøp — et kjøp til ville gitt doble
  // trekk. `null` = ukjent/ikke hentet → kjøpsflaten vises (visningen faller
  // åpent; checkout-rutens 409 er PORTEN, samme skille som admin-sesjonen).
  const [hasSub, setHasSub] = useState<boolean | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  // Dagtallet vi lovet FØR aktiveringen. Etter suksess svarer ruten
  // eligible=false, så tilbudet forsvinner — bekreftelsen må ha tallet lagret.
  const [activatedDays, setActivatedDays] = useState<number | null>(null)
  // Auto-fortsettelsen skal kjøre én gang per sidevisning, uansett hvor mange
  // auth-events som fyrer (INITIAL_SESSION + TOKEN_REFRESHED er vanlig).
  const pendingHandledRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Hent tilbudet så snart sesjonstilstanden er avgjort — med token når vi har
  // et, uten når vi ikke har (da svarer ruten `eligible: null` = ukjent, og
  // tilbudet vises likevel).
  //
  // Dep-en er den STABILE identiteten, ikke session-objektet — se
  // lib/session-identity.ts, samme grep som org/[slug]/admin. Målt 12. august
  // 2026, i BÅDE `next dev` og produksjonsbygg: en innlogget sidelast gav TO
  // kall hit, 2 ms fra hverandre, med identisk Authorization-header. De to
  // skriverne av `session` (getSession().then under, og onAuthStateChange sin
  // INITIAL_SESSION) leverer samme logiske sesjon som to ULIKE objekter, så
  // React kunne ikke bail-e ut på referanselikhet. Utlogget passerer begge
  // `null` — referanselik — og gav derfor alltid ett kall; buggen bet kun
  // innloggede. StrictMode var ikke forklaringen: prod-bygget gav samme to.
  //
  // Duplikatet var ikke bare et ekstra kall: de to kjørte samtidig og målte
  // 1883 og 3001 ms mot ~500 ms alene. Knappen venter på dette svaret, så
  // kallet betalte sin egen dobling i ventetid.
  //
  // `session` leses fortsatt friskt inne i effekten — identiteten avgjør KUN
  // når den skal kjøre. Effekten fyrer derfor fortsatt på ekte endring
  // (utlogget → innlogget, bytte av bruker, innlogget → utlogget), men ikke
  // på et nytt objekt for samme bruker (TOKEN_REFRESHED ved fane-fokus).
  const sessionIdentity = getSessionIdentity(session)
  useEffect(() => {
    if (sessionIdentity === 'unchecked') return
    let cancelled = false
    fetchTrialOffer(session?.access_token).then(offer => {
      if (!cancelled) setTrialOffer(offer)
    })
    // Abonnementsoppslaget deler denne effekten med vilje: samme livssyklus,
    // samme stabile dep (sessionIdentity — se lib/premium-session-dep.test.ts).
    // Feiler kallet, forblir hasSub null og kjøpsflaten vises — serveren
    // avviser uansett et dobbeltkjøp med 409.
    if (session?.access_token) {
      const bearer = session.access_token
      fetch('/api/stripe/subscription', { headers: { Authorization: `Bearer ${bearer}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (!cancelled && data) setHasSub(data.has_subscription === true) })
        .catch(() => { /* visning faller åpent; 409-porten står */ })
    } else {
      setHasSub(false)
    }
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdentity])

  const runActivate = useCallback(async (accessToken: string, days: number | null) => {
    setTrialPhase('running')
    setTrialNotice(null)
    try {
      const res = await fetch('/api/stripe/founders-activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setActivatedDays(days)
        setTrialPhase('done')
        // Bekreftelsen står øverst på siden; sørg for at den faktisk blir sett
        // også når brukeren kom hit midt i en scrollet visning.
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      // Hvilken tekst som vises bor i lib/trial-activation-notice.ts: rutens
      // egen for statusene der den er skrevet for mennesker (400/409/429/503),
      // vår egen for 500 og alt ukjent. Uten det skillet havnet «Founders
      // price not configured» i UI-et.
      if (!res.ok) {
        // Den tekniske detaljen forsvinner ikke — den flyttes hit, der den
        // hører hjemme, i stedet for å stå i grensesnittet.
        //
        // Nivået avgjøres av activationLogLevel: 409 er sperren som virker,
        // altså normal drift, og logges som info. Alt annet er error.
        const linje = `[premium] founders-activate svarte ${res.status}:`
        const detalj = data?.error ?? '(ingen error i svaret)'
        if (activationLogLevel(res.status) === 'info') console.info(linje, detalj)
        else console.error(linje, detalj)
      }
      setTrialNotice(decideActivationNotice({ status: res.status, error: data?.error }))
      setTrialPhase('idle')
    } catch (err) {
      // Nettverksfeil: ingen status å gå etter. status 0 gir den generiske
      // teksten, samme sted og samme form som alle andre feil.
      console.error('[premium] founders-activate nådde ikke fram:', err)
      setTrialNotice(decideActivationNotice({ status: 0 }))
      setTrialPhase('idle')
    }
  }, [])

  // Auto-fortsettelse: brukeren trykket «Prøv gratis» mens hen var utlogget,
  // logget inn, og er nå tilbake. Kjører aktiveringen uten et nytt klikk.
  // Nøkkelen fjernes FØR kallet — en feil skal ikke kunne gi en løkke der hver
  // sidelast forsøker på nytt.
  //
  // Denne beholder BEVISST hele `session` i dep-lista, i motsetning til
  // effekten over. Samme form, annen klasse: `pendingHandledRef` låser ved
  // første gjennomkjøring og pending-nøkkelen fjernes før kallet, begge
  // synkront i samme kropp — et duplikat-objekt for samme bruker koster her én
  // no-op-kjøring, ikke et kall. `trialOffer` i dep-lista er dessuten ekte
  // sekvensering (vent til dagtallet har landet), ikke et staleness-artefakt.
  // Vurdert og forkastet 12. august 2026: å bytte dep her ville flyttet
  // `session` inn i en closure uten å fjerne noe målbart.
  useEffect(() => {
    if (session === undefined || !session?.access_token) return
    if (pendingHandledRef.current) return
    // Vent til tilbudet har landet. Bekreftelsen skal kunne si «aktiv i N
    // dager», og N kommer herfra. Dette kan ikke låse seg: fetchTrialOffer
    // returnerer `{ show:false, days:null }` også ved feil, altså aldri null —
    // ventingen har en garantert slutt, og teksten faller da tilbake til
    // «Prøveperioden din er aktiv» uten tall.
    if (trialOffer === null) return
    let pending: string | null = null
    try { pending = localStorage.getItem(PENDING_ACTION_KEY) } catch { /* utilgjengelig */ }
    if (pending !== PENDING_TRIAL) return
    // Settes FØR kallet, og nøkkelen fjernes FØR kallet: en feilet aktivering
    // skal ikke kunne gi en løkke der hver sidelast forsøker på nytt.
    pendingHandledRef.current = true
    try { localStorage.removeItem(PENDING_ACTION_KEY) } catch { /* utilgjengelig */ }
    runActivate(session.access_token, trialOffer.days)
  }, [session, trialOffer, runActivate])

  // Klikk på «Prøv gratis i N dager».
  async function handleTrial() {
    if (session === undefined) return
    setTrialNotice(null)
    const days = trialOffer?.days ?? null
    if (!session) {
      // Utlogget: legg igjen sporet og send til innlogging. ?next bringer
      // brukeren hit igjen, og useEffect-en over fullfører flyten.
      try { localStorage.setItem(PENDING_ACTION_KEY, PENDING_TRIAL) } catch { /* utilgjengelig */ }
      window.location.assign(`/login?next=${encodeURIComponent('/premium')}`)
      return
    }
    const { data: { session: fresh } } = await supabase.auth.getSession()
    if (!fresh?.access_token) {
      try { localStorage.setItem(PENDING_ACTION_KEY, PENDING_TRIAL) } catch { /* utilgjengelig */ }
      window.location.assign(`/login?next=${encodeURIComponent('/premium')}`)
      return
    }
    await runActivate(fresh.access_token, days)
  }

  function showError(msg: string) {
    setCheckoutError(msg)
    setTimeout(() => setCheckoutError(null), 5000)
  }

  async function handleCheckout() {
    setCheckoutError(null)
    // Sesjon er ikke lastet ennå — ikke vis feil, bare vent
    if (session === undefined) return
    if (!session) {
      setShowLoginAlert(true)
      return
    }
    setLoading(true)
    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession()
      if (!freshSession?.access_token) {
        setShowLoginAlert(true)
        return
      }
      const plan = PLANS.find(p => p.id === planId) ?? PLANS[0]
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${freshSession.access_token}`,
        },
        body: JSON.stringify({
          priceId: plan.priceId,
          userId: freshSession.user.id,
          email: freshSession.user.email,
        }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        // Serverens egen tekst når den finnes — 409-en fra dobbeltkjøp-vakten
        // sier hva man skal gjøre i stedet, og skal ikke maskeres som en
        // teknisk feil.
        showError(data?.error ?? 'Noe gikk galt. Prøv igjen eller kontakt oss.')
      }
    } catch {
      showError('Noe gikk galt. Prøv igjen eller kontakt oss.')
    } finally {
      setLoading(false)
    }
  }

  // Samme form som handlePortal på /profil: portalen er stedet for å endre,
  // gjenoppta eller legge inn kort på et abonnement som allerede finnes.
  async function handlePortal() {
    if (portalLoading) return
    setPortalLoading(true)
    setPortalError(null)
    try {
      const { data: { session: fresh } } = await supabase.auth.getSession()
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: fresh?.access_token ? { Authorization: `Bearer ${fresh.access_token}` } : {},
      })
      const data = await res.json()
      if (!res.ok) {
        setPortalError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setPortalError('Noe gikk galt. Prøv igjen.')
    } finally {
      setPortalLoading(false)
    }
  }

  // Prøveknappen vises kun når tilbudet er avgjort OG aktivering ikke allerede
  // er fullført i denne visningen. Null her (ikke hentet, ingen dagangivelse,
  // eller bekreftet ikke-kvalifisert) gir dagens kjøpsflate, uendret.
  const trialCta = trialPhase === 'done' || trialOffer?.show !== true ? null : trialOffer
  const showTrial = trialCta !== null

  return (
    <>
      <div style={{
        minHeight: '100vh',
        background: '#1a1c23',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        fontFamily: "var(--font-instrument-sans), sans-serif",
        color: '#e8e4dd',
      }}>
        <div style={{ maxWidth: 480, width: '100%' }}>

          <p style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8,
          }}>
            Quizkanonen
          </p>
          <h1 style={{
            fontFamily: "var(--font-libre-baskerville), serif",
            fontSize: 'clamp(28px, 6vw, 36px)',
            fontWeight: 700, color: '#ffffff',
            letterSpacing: '-0.02em', marginBottom: 32,
          }}>
            Bli <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>Premium</em>
          </h1>

          {/* Bekreftelse etter aktivering. Egen flate, ikke en linje under en
              knapp: kom brukeren hit via auto-fortsettelsen etter innlogging,
              har hen ikke sett noe klikk skje, og en stille tilstandsendring
              ville etterlatt tvil om prøveperioden faktisk startet. */}
          {trialPhase === 'done' && (
            <div style={{
              background: '#21242e', border: '1px solid #c9a84c',
              borderRadius: 16, padding: '24px 20px', marginBottom: 20,
            }}>
              <p style={{
                fontFamily: "var(--font-libre-baskerville), serif",
                fontSize: 20, fontWeight: 700, color: '#ffffff',
                lineHeight: 1.3, marginBottom: 8,
              }}>
                {activatedDays != null
                  ? `Prøveperioden din er aktiv i ${activatedDays} dager`
                  : 'Prøveperioden din er aktiv'}
              </p>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 16 }}>
                Du har full tilgang til Premium fra nå. Vi har sendt deg en bekreftelse på e-post.
              </p>
              {/* Bevisst hard navigasjon: forsiden skal hentes ferskt, slik at
                  Premium-flatene der reflekterer den nye statusen. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ fontSize: 14, fontWeight: 600, color: '#e8e4dd', textDecoration: 'none' }}>
                Til forsiden →
              </a>
            </div>
          )}

          <div style={{
            background: '#21242e', border: '1px solid #2a2d38',
            borderRadius: 20, padding: '32px',
          }}>

            {/* Kjernesetningen — rammer inn hva lista under handler om.
                Bruker sidens eksisterende tittel-typografi (serif), ikke et
                nytt visuelt system. */}
            <p style={{
              fontFamily: "var(--font-libre-baskerville), serif",
              fontSize: 20,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.35,
              margin: '0 0 20px',
            }}>
              Premium for deg som vil mer enn bare svare riktig
            </p>

            {/* Feature list */}
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {FEATURES.map(f => (
                <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 15, color: '#e8e4dd', lineHeight: 1.4 }}>
                  <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Pricing — to valgbare kort. Gull-regelen holdes ved at KUN det
                valgte kortet bærer gullrammen og gullprisen (vei (a), valgt
                30. august 2026): gullantallet er konstant uansett valg, og
                begge prisene står synlige samtidig — en måned/år-toggle ville
                skjult den ene og tatt bort selve sammenligningen. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {PLANS.map(p => {
                const valgt = p.id === planId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    aria-pressed={valgt}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: '#1a1c23',
                      border: valgt ? '2px solid #c9a84c' : '1px solid #2a2d38',
                      // 2px- og 1px-rammen kompenseres i padding, så kortene
                      // ikke hopper 1px når valget flyttes.
                      padding: valgt ? '20px 24px' : '21px 25px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      fontFamily: "var(--font-instrument-sans), sans-serif",
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#ffffff', marginBottom: 3 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: '#e8e4dd' }}>{p.desc}</div>
                      </div>
                      <div style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 20, fontWeight: 700, color: valgt ? '#c9a84c' : '#e8e4dd', flexShrink: 0 }}>
                        {p.price}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {showLoginAlert && (
              <div style={{
                background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                color: '#c9a84c', fontSize: 13,
              }}>
                Du må være innlogget for å kjøpe Premium. Klikk &quot;Logg inn&quot; øverst til høyre.
              </div>
            )}

            {hasSub === true ? (
              /* Levende abonnement: kjøpsflaten byttes ut. To-gule-regelen
                 holdes — prisrammen + denne ene gullknappen, som før. */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
                  Du har allerede et aktivt abonnement, så et nytt kjøp her ville
                  gitt doble trekk. Endre, gjenoppta eller oppdater kort fra
                  abonnementssiden.
                </p>
                <button
                  onClick={handlePortal}
                  disabled={portalLoading}
                  style={{
                    padding: '10px 28px',
                    background: portalLoading ? '#2a2d38' : '#c9a84c',
                    color: portalLoading ? '#918f8a' : '#1a1c23',
                    border: 'none', borderRadius: 10,
                    fontSize: 15, fontWeight: 700,
                    fontFamily: "var(--font-instrument-sans), sans-serif",
                    cursor: portalLoading ? 'not-allowed' : 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => { if (!portalLoading) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                >
                  {portalLoading ? 'Åpner…' : 'Administrer abonnement'}
                </button>
                {portalError && (
                  <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                    {portalError}
                  </p>
                )}
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              {trialCta && (
                <>
                  <button
                    onClick={handleTrial}
                    disabled={trialPhase === 'running'}
                    style={{
                      padding: '10px 28px',
                      background: trialPhase === 'running' ? '#2a2d38' : '#c9a84c',
                      color: trialPhase === 'running' ? '#918f8a' : '#1a1c23',
                      border: 'none', borderRadius: 10,
                      fontSize: 15, fontWeight: 700,
                      fontFamily: "var(--font-instrument-sans), sans-serif",
                      cursor: trialPhase === 'running' ? 'not-allowed' : 'pointer',
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => { if (trialPhase !== 'running') e.currentTarget.style.opacity = '0.88' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    {trialPhase === 'running'
                      ? 'Starter...'
                      : trialNotice
                        ? 'Prøv igjen'
                        : `Prøv gratis i ${trialCta.days} dager`}
                  </button>
                  {/* Meldingen står RETT under knappen som ble trykket, over
                      hint-linja. Lå den under hintet, endte den visuelt inntil
                      «Gå til betaling» og ble lest som om den gjaldt den. */}
                  {trialNotice && (
                    <div style={{
                      background: 'rgba(201,168,76,0.08)',
                      border: '1px solid rgba(201,168,76,0.3)',
                      borderRadius: 10,
                      padding: '12px 16px',
                      color: '#e8e4dd',
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}>
                      {trialNotice}
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                    Ingen kortinformasjon. Én prøveperiode per konto.
                  </p>
                </>
              )}
              {/* Feilet aktiveringen UTEN at prøveknappen vises (utlogget, eller
                  et tilbud som ikke landet), har meldingen ingen knapp å henge
                  under — da står den her, med samme ramme. */}
              {trialNotice && !trialCta && (
                <div style={{
                  background: 'rgba(201,168,76,0.08)',
                  border: '1px solid rgba(201,168,76,0.3)',
                  borderRadius: 10,
                  padding: '12px 16px',
                  color: '#e8e4dd',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {trialNotice}
                </div>
              )}
              <button
                onClick={handleCheckout}
                disabled={loading || session === undefined}
                style={{
                  padding: '10px 28px',
                  // To-gule-regelen: når prøveknappen over er den gule primæren,
                  // faller betalingsknappen tilbake til outline. Uten tilbud er
                  // den fortsatt sidens primærhandling, og beholder gullet.
                  background: showTrial
                    ? 'transparent'
                    : (loading || session === undefined) ? '#2a2d38' : '#c9a84c',
                  color: showTrial
                    ? '#e8e4dd'
                    : (loading || session === undefined) ? '#918f8a' : '#1a1c23',
                  border: showTrial ? '1px solid #e8e4dd' : 'none',
                  borderRadius: 10,
                  fontSize: showTrial ? 14 : 15,
                  fontWeight: showTrial ? 600 : 700,
                  fontFamily: "var(--font-instrument-sans), sans-serif",
                  cursor: (loading || session === undefined) ? 'not-allowed' : 'pointer',
                  opacity: session === undefined ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (!loading && session !== undefined) e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { if (session !== undefined) e.currentTarget.style.opacity = '1' }}
              >
                {session === undefined ? 'Laster...' : loading ? 'Videresender...' : 'Gå til betaling'}
              </button>
              {checkoutError && (
                <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                  {checkoutError}
                </p>
              )}
            </div>
            )}

            {hasSub !== true && (
              <p style={{ fontSize: 12, color: '#e8e4dd', textAlign: 'center', lineHeight: 1.6 }}>
                Du må være innlogget for å kjøpe. Betaling håndteres trygt av Stripe.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
