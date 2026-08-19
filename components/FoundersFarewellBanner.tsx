'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'
import { shouldShowFoundersFarewell } from '@/lib/founders-farewell'

// Founders-farvel-flaten (19. august 2026) — engangsmeldingen
// beslutningsdokumentet for Founders-avviklingen spesifiserte, til de
// tidligere Founders-brukerne som ellers nedgraderes stille til gratis-UI.
//
// Gaten (hvem ser flaten, og at den aldri vises igjen etter lukking) bor i
// lib/founders-farewell.ts — ren logikk, mutasjonstestet. Det varige
// «lukket»-stempelet ligger i databasen (profiles.founders_farewell_dismissed_at),
// ikke i localStorage: «vises kun én gang» gjelder per person, ikke per enhet.
// Samme persistens-mønster som GlobalLeagueChoiceBanner sitt besvarte valg.
//
// Teksten er godkjent av Dennis ordrett (19. august 2026) — ikke omformuler.
// ❤️ i overskriften og 🎉 til slutt er bevisste unntak fra emoji-regelen.
export default function FoundersFarewellBanner() {
  const { isPremium, hasUsedTrial, foundersFarewellDismissed, refreshProfile } = useProfile()
  const [closedNow, setClosedNow] = useState(false)

  // Alle tre lukkeveiene (X, «Ikke nå», Premium-CTA) stempler. Flaten skjules
  // umiddelbart og skrivingen går i bakgrunnen: feiler den, vises flaten igjen
  // ved neste innlasting — bedre enn en flate som blir stående etter et klikk,
  // og aldri blokkerende. refreshProfile() etterpå holder contexten i takt ved
  // klientnavigasjon fram og tilbake uten full innlasting.
  function stamp() {
    setClosedNow(true)
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        await fetch('/api/profile/founders-farewell-seen', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          keepalive: true,
        })
        void refreshProfile()
      } catch { /* neste innlasting viser flaten igjen */ }
    })()
  }

  if (closedNow || !shouldShowFoundersFarewell({
    hasUsedTrial,
    isPremium,
    farewellDismissed: foundersFarewellDismissed,
  })) return null

  const body = {
    fontSize: 14,
    color: '#e8e4dd',
    lineHeight: 1.6,
    marginBottom: 12,
  } as const

  const sectionHeading = {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 16,
    fontWeight: 700,
    color: '#ffffff',
    margin: '20px 0 10px',
  } as const

  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 16,
      padding: '28px 24px',
      marginTop: 20,
      position: 'relative',
    }}>
      <button
        onClick={stamp}
        aria-label="Lukk"
        style={{
          position: 'absolute', top: 14, right: 14,
          background: 'none', border: 'none', padding: 4, cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1L13 13M13 1L1 13" stroke="#918f8a" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <h2 style={{
        fontFamily: "'Libre Baskerville', serif",
        fontSize: 20,
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: 14,
        paddingRight: 24,
      }}>
        ❤️ Takk!
      </h2>

      <p style={body}>Tusen takk for at du var med fra starten.</p>

      <p style={body}>
        Da Quizkanonen flyttet fra Kahoot til egen plattform, var det mye som
        gjensto. Du var en av dem som valgte å bli med likevel, teste, komme
        med tilbakemeldinger og være tålmodig når ikke alt fungerte som det
        skulle.
      </p>

      <p style={body}>
        Mange av forbedringene som er på plass i dag, finnes fordi
        Founders-medlemmene tok seg tid til å si ifra. Tusen takk.
      </p>

      <h3 style={sectionHeading}>Hva skjer nå?</h3>

      <p style={body}>
        Founders-perioden er nå over, og kontoen din er tilbake til
        gratisversjonen.
      </p>

      <p style={body}>
        Fredagsquizen vil fortsatt være gratis – akkurat som den alltid har
        vært.
      </p>

      <p style={body}>
        Hvis du ønsker å støtte den videre utviklingen av Quizkanonen, kan du
        velge Premium. Men det er helt valgfritt.
      </p>

      <h3 style={sectionHeading}>Premium</h3>

      <p style={body}>
        Premium er for deg som vil få mer ut av hver quiz. Da får du blant
        annet:
      </p>

      <ul style={{ margin: '0 0 12px', paddingLeft: 22, color: '#e8e4dd', fontSize: 14, lineHeight: 1.7 }}>
        <li>Se din nøyaktige plassering</li>
        <li>Se dine svar og hvordan de fordelte seg i quizen</li>
        <li>Utfordre andre spillere til dueller</li>
        <li>Lage private ligaer</li>
        <li>(flere funksjoner kommer etter hvert)</li>
      </ul>

      <p style={body}>
        Quizkanonen er fortsatt et lite prosjekt som utvikles uke for uke med
        målet om å skape litt glede i hverdagen. Hvert Premium-medlemskap
        bidrar direkte til drift, utvikling og nye funksjoner.
      </p>

      <p style={body}>
        Hvis du velger å bli med videre som Premium-medlem settes det veldig
        stor pris på det, men det viktigste er uansett at du blir med videre
        og har det gøy.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '18px 0 16px' }}>
        <Link
          href="/premium"
          onClick={stamp}
          style={{
            background: '#c9a84c', color: '#1a1c23',
            borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 700,
            fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Fortsett med Premium
        </Link>
        <span style={{ fontSize: 13, color: '#918f8a' }}>eller</span>
        <button
          onClick={stamp}
          style={{
            background: 'none', border: 'none', padding: 0,
            fontSize: 14, color: '#e8e4dd', cursor: 'pointer',
            fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'underline',
          }}
        >
          Ikke nå
        </button>
      </div>

      <p style={body}>
        Fredagsquizen er som sagt fortsatt gratis, og jeg håper du vil spille
        med enten gratis eller som premiummedlem.
      </p>

      <p style={{ ...body, marginBottom: 0 }}>Lykke til med ukens quiz! 🎉</p>
    </div>
  )
}
