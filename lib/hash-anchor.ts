// «Skal vi hoppe til ankeret nå?» — den rene halvdelen av hash-navigasjon på
// en side som fyller seg ut asynkront.
//
// ── Hvorfor dette trengs (målt 9. september 2026) ───────────────────────────
// `/profil#varsler` og `/profil#abonnement` landet begge på toppen av siden.
// Årsaken er IKKE at kortet skled nedover etter hoppet: `app/profil/page.tsx`
// returnerer SKJELETTER så lenge `loadState === 'loading'`, så ved første
// render finnes ikke elementet med id-en i DOM-en i det hele tatt. Nettleseren
// leter, finner ingenting, og prøver aldri igjen — hash-navigasjon er en
// engangshendelse ved lasting. `#abonnement` har hatt samme feil siden det ble
// lagt inn; det er MÅLET for «Abonnement»-lenken i brukermenyen
// (subscriptionMenuHref i lib/subscription-entry.ts), så feilen har vært live
// på en lenke folk faktisk bruker.
//
// Derfor: ingen setTimeout. En timeout gjetter på når siden er ferdig, og
// gjetter feil på trege forbindelser — nøyaktig den forbindelsen der hoppet
// bommer i dag. Beslutningen henger i stedet på tilstanden som allerede
// finnes (`loadState === 'ready'`), og kallstedet prøver på nytt ved hver
// relevante tilstandsendring til elementet faktisk FINNES. Kortene har ulike
// gater — `#abonnement` rendres bak `abonnement !== 'none'`, som kommer fra
// ProfileProvider og kan lande etter `loadState` — så «innholdet er inne» og
// «akkurat dette kortet er rendret» er to spørsmål. Det andre svares av
// getElementById hos kalleren, ikke her.

/** Høyden på den klebrige topplinjen (SiteNav: 54 px) + litt luft. */
export const ANCHOR_SCROLL_OFFSET = 68

export type HashScrollDecision =
  | { jump: false }
  | { jump: true; targetId: string }

// En id vi er villige til å slå opp. Hash-en kommer fra URL-en, altså utenfra:
// hviteliste, ikke svarteliste. Samme holdning som safeNextPath i
// lib/admin-fetch.ts har til `next`.
const GYLDIG_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export function decideHashScroll(input: {
  /** `window.location.hash`, f.eks. `#varsler`. Tom streng når det ikke er noe. */
  hash: string
  /** Er profildata inne? (`loadState === 'ready'`) */
  contentReady: boolean
  /** Har vi allerede hoppet FERDIG til denne hash-en? */
  alreadyJumped: boolean
}): HashScrollDecision {
  // Rekkefølgen er med vilje: readiness sjekkes FØR vi bryr oss om hash-en, så
  // et hopp aldri kan skje mens skjelettene står der. Det er hele feilen.
  if (!input.contentReady) return { jump: false }
  // Ett hopp per sidevisning. Uten dette ville et hvilket som helst senere
  // re-render dratt brukeren tilbake til ankeret midt i at hun scroller.
  if (input.alreadyJumped) return { jump: false }

  const rå = input.hash.startsWith('#') ? input.hash.slice(1) : input.hash
  if (rå === '') return { jump: false }

  let id: string
  try {
    id = decodeURIComponent(rå)
  } catch {
    // Ugyldig prosent-koding er ikke et anker vi kan slå opp.
    return { jump: false }
  }
  if (!GYLDIG_ID.test(id)) return { jump: false }

  return { jump: true, targetId: id }
}
