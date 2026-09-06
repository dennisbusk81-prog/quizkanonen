'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import ErrorBoundary from '@/components/ErrorBoundary'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'
import type React from 'react'
import { decideTopplisteScope } from '@/lib/toppliste-scope'

// Banneret het tidligere ExpiredPremiumBanner og sa «Reaktiver Premium». Begge
// deler påsto en tidligere Premium-tilstand systemet ikke kjenner: `hasScores`
// under teller season_scores, og processQuiz skriver de radene for ALLE
// innloggede deltakere uavhengig av Premium (lib/award-season-points.ts). Testen
// betyr «har spilt minst én gjort opp quiz innlogget», ikke «har hatt Premium»,
// så en gratisbruker som aldri har hatt Premium fikk beskjed om å «reaktivere».
// Det finnes ikke noe pålitelig signal på tidligere Premium å skille på:
// premium_since nullstilles ved kansellering, og stripe_customer_id dekker kun
// B2C-checkout. Teksten er derfor nøytral og sann i begge tilfeller. Samme
// endring som i app/historikk/page.tsx.
function PlacementLockedBanner() {
  // Premium fra delt context (ingen egen premium-status-fetch lenger).
  const { isPremium, userId, loading } = useProfile()
  const [hasScores, setHasScores] = useState(false)

  useEffect(() => {
    // Nullstillingsvakt i en asynkron datahenting: bytter bruker (eller logger
    // ut) må det gamle svaret forkastes før den nye spørringen. Regelen er ment
    // for avledet tilstand, ikke for opprydding rundt I/O.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!userId) { setHasScores(false); return }
    let cancelled = false
    supabase
      .from('season_scores')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('scope_type', 'global')
      .then(({ count }) => { if (!cancelled) setHasScores((count ?? 0) > 0) })
    return () => { cancelled = true }
  }, [userId])

  // Vis kun når premium er avklart (unngå flash før context er lastet).
  if (loading || isPremium || !hasScores) return null
  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 16,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, margin: 0 }}>
        Du har spilt mens du var innlogget, så poengene dine er lagret.
        Nøyaktig plassering krever{' '}
        <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>
          Premium
        </a>.
      </p>
    </div>
  )
}

// ── SCOPE-BRYTER (6. september 2026) ────────────────────────────────────────
//
// MÅLET: en org-ansatt skal kunne bytte mellom bedriftens liste og den
// offentlige med ett klikk, uten å navigere til en annen URL.
//
// HVORFOR TILSTANDEN BOR HER OG IKKE I SeasonLeaderboard:
//   • H1-en må følge scopet. Står «Topplisten» mens bedriftens tall vises,
//     lyver rammen. Overskriften bor på siden, altså må valget gjøre det òg.
//   • /org/[slug] og /liga/[slug] sender faste props og skal være BIT-IDENTISKE.
//     Med valget her rører vi ikke deres kodesti i det hele tatt.
//   • Skinnen må overleve at leaderboardet feiler. SeasonLeaderboard har en
//     tidlig retur ved tom/feilet henting; lå skinnen under den, forsvant
//     veien tilbake nøyaktig når brukeren trenger den.
//
// URL-en ER kilden til sannhet, samme mønster som periodefanene. Da overlever
// scope en periodebytte og omvendt, og visningen er delbar og direktelastbar.
//
// ── URL-EN VALIDERES MOT MEDLEMSKAPENE, IKKE SENDT RÅTT VIDERE ──────────────
// `?scope=organization&scope_id=<id>` kan peke på en hvilken som helst org.
// Gaten i /api/toppliste svarer 403 til en ikke-medlem, så det lekker
// ingenting — men 403-grenen i SeasonLeaderboard viser «Noe gikk galt. Prøv å
// laste siden på nytt», et råd som ALDRI hjelper her. Derfor sender vi aldri
// forespørselen: er id-en ikke blant brukerens egne org-er, faller vi til
// global. En fremmed som klikker en delt lenke får den offentlige lista, ikke
// en feilmelding.
//
// Ventetilstanden finnes fordi `myOrgs` lastes asynkront: uten den ville en
// bokmerket org-lenke først vist «Topplisten» med globale tall, så byttet —
// feil liste og feil overskrift i et halvt sekund, pluss en bortkastet
// henting.
const scopeRailStyle: React.CSSProperties = {
  display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap',
  margin: '0 0 14px',
}

// Aldri gull: den aktive periodefanen rett under ER gull, og to gule
// klikkbare elementer på samme skjerm bryter husregelen. Aktiv markeres med
// kortflaten + border og hvit tekst; inaktiv er brødtekstfargen, ALDRI
// hint-fargen — #918f8a er forbeholdt tekst som ikke skal klikkes.
const scopeTabStyle = (aktiv: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: aktiv ? 600 : 500,
  fontFamily: "var(--font-instrument-sans), sans-serif",
  color: aktiv ? '#ffffff' : '#e8e4dd',
  background: aktiv ? '#21242e' : 'transparent',
  border: `1px solid ${aktiv ? '#2a2d38' : 'transparent'}`,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  // Org-navnet er brukerskrevet (60 tegn tillatt) — samme klemme som i nav-en
  // og på avatar-navnet, av samme grunn.
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TopplisterPage() {
  const { myOrgs, myOrgsLoaded, myOrgsError } = useProfile()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Selve beslutningen er ren og testdekket — se lib/toppliste-scope.ts for
  // hvorfor «ikke landet» og «feilet» er to ULIKE utfall, og hvorfor ingen av
  // dem betyr «ikke medlem».
  const beslutning = decideTopplisteScope({
    scopeParam: searchParams.get('scope'),
    scopeIdParam: searchParams.get('scope_id'),
    myOrgs,
    myOrgsLoaded,
    myOrgsError,
  })
  const valgtOrg = beslutning.valgtOrgId
    ? (myOrgs.find(o => o.orgId === beslutning.valgtOrgId) ?? null)
    : null
  const erOrgScope = beslutning.scope === 'organization'
  const venterPaaMedlemskap = beslutning.venter

  // Bekreftet ukjent org-id ⇒ URL-en peker et sted brukeren ikke hører
  // hjemme. Rydd den, så en delt lenke ikke etterlater en bedriftsoverskrift
  // over globale tall.
  useEffect(() => {
    if (!beslutning.ryddUrl) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('scope')
    params.delete('scope_id')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [beslutning.ryddUrl, searchParams, router, pathname])

  const settScope = useCallback((orgId: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (orgId) {
      params.set('scope', 'organization')
      params.set('scope_id', orgId)
    } else {
      params.delete('scope')
      params.delete('scope_id')
    }
    // `period` beholdes med vilje — scope og periode er uavhengige akser.
    // `hist`/`histKey` slettes: de peker på en åpnet quiz-rad i det GAMLE
    // scopet, akkurat som setPeriod() rydder dem ved fanebytte.
    params.delete('hist')
    params.delete('histKey')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Skinnen vises kun til den som faktisk har noe å bytte MELLOM. En vanlig
  // spiller — og enhver gjest, som aldri har medlemskap — ser ingen bryter.
  const visSkinne = beslutning.visSkinne

  // Overskriften følger scopet. Under ventetilstanden vises org-varianten
  // allerede: URL-en ba om den, og alternativet er å vise feil overskrift
  // først og bytte etterpå.
  const visOrgRamme = beslutning.ramme === 'organization'

  return (
    <>
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ padding: '20px 0 12px', textAlign: 'center' as const }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 }}>
              Quizkanonen · Sesong
            </p>
            {/* Samme form som H1-en på /org/[slug], slik at de to flatene
                heter det samme når de viser det samme. */}
            <h1 style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 'clamp(22px, 5vw, 32px)' as string, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 4 }}>
              {visOrgRamme
                ? <>Bedriftens <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>toppliste</em></>
                : <>Topp<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>listen</em></>}
            </h1>
            {/* Kun FELTET bytter, aldri verbet (Dennis, 6. september 2026).
                «Dominerer» er husets ord for det denne lista måler, og et ord
                som skifter med scopet ville fått to visninger av samme tall
                til å låte som to ulike funksjoner. Derfor «over tid» →
                «blant kollegene», og ikke et nytt verb. */}
            <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 14, color: '#e8e4dd', fontStyle: 'italic' }}>
              {visOrgRamme ? 'Hvem dominerer blant kollegene?' : 'Hvem dominerer over tid?'}
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', marginTop: 6 }}>
              Poeng samles gjennom måneden. Ny sesong starter den 1. hver måned.
            </p>
            <div style={{ width: '100%', height: 1, background: '#2a2d38', marginTop: 12 }} />
          </div>

          <PlacementLockedBanner />

          {/* Scope-skinnen står OVER periodefanene (som er første element inne
              i SeasonLeaderboard) og utenfor ErrorBoundary-en: velter
              leaderboardet, skal veien tilbake til den offentlige lista
              fortsatt finnes. */}
          {visSkinne && (
            <div style={scopeRailStyle}>
              <button
                type="button"
                style={scopeTabStyle(!erOrgScope && !venterPaaMedlemskap)}
                aria-pressed={!erOrgScope && !venterPaaMedlemskap}
                onClick={() => settScope(null)}
              >
                Alle
              </button>
              {/* Org-NAVNET, ikke «Bedriften» — hun kjenner seg igjen i navnet,
                  og med to medlemskap er «Bedriften» tvetydig. */}
              {myOrgs.map(o => (
                <button
                  key={o.orgId}
                  type="button"
                  style={scopeTabStyle(valgtOrg?.orgId === o.orgId)}
                  aria-pressed={valgtOrg?.orgId === o.orgId}
                  onClick={() => settScope(o.orgId)}
                >
                  {o.orgName}
                </button>
              ))}
            </div>
          )}

          <ErrorBoundary>
            {venterPaaMedlemskap ? (
              // URL-en ba om en bedriftsliste, men vi vet ennå ikke om
              // brukeren er medlem. Å rendre global her ville vist feil tall
              // under en org-overskrift og kostet en henting vi kaster.
              <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic', textAlign: 'center', padding: '36px 0' }}>
                Henter bedriften din …
              </p>
            ) : valgtOrg ? (
              <SeasonLeaderboard
                scope="organization"
                scopeId={valgtOrg.orgId}
                orgSlug={valgtOrg.orgSlug}
                globalLeagueDisabled={!valgtOrg.allowGlobalLeague}
              />
            ) : (
              <SeasonLeaderboard scope="global" />
            )}
          </ErrorBoundary>

        </div>
      </div>
    </>
  )
}
