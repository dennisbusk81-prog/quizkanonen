/**
 * Hvilken linje topplistesiden skal vise om org-scopet — utledet av HVA SOM
 * FAKTISK BLE HENTET, ikke av en tilstand noen setter og glemmer.
 *
 * Bakgrunn (19. august 2026): `orgScopeDegraded` var en boolean som ble satt
 * true når sesjonsoppslaget tidsavbrøt, og aldri satt tilbake. Den var klebrig:
 * kom auth seg igjen (loadSession kjøres på nytt ved auth-events, fetchData
 * gjør det ikke), sto meldingen «Vi fikk ikke bekreftet bedriftstilhørigheten
 * din» igjen på en side der medlemskapet nå VAR bekreftet.
 *
 * Den nærliggende fiksen — nullstill flagget når auth kommer seg — er verre
 * enn problemet, og det er verdt å skrive ned hvorfor:
 *
 *   Linja «Resultater blant kollegene dine» er gatet på det SAMME flagget.
 *   Nullstiller vi det uten å hente listen på nytt, får vi «Resultater blant
 *   kollegene dine» over den NASJONALE lista. Vi bytter da en melding som er
 *   litt foreldet mot en som er direkte usann — og usann i den retningen som
 *   faktisk lurer brukeren, siden hun tror hun ser kollegene sine.
 *
 * Rotårsaken er at flagget beskrev feil ting. Det beskrev en HENDELSE
 * («oppslaget feilet»), mens skjermen trenger å vite en TILSTAND («hvilke data
 * ligger her nå»). Derfor er flagget byttet ut med `servedOrgSlug` — org-scopet
 * hentingen faktisk brukte — og linja utledes av det.
 *
 * Da forsvinner spørsmålet om nullstilling helt: det finnes ingenting å
 * nullstille. Kommer auth seg uten at listen hentes på nytt, er det fortsatt
 * den nasjonale lista som ligger der, og teksten sier fortsatt sant. Hentes
 * den på nytt med scope, følger teksten med av seg selv — samme skriving.
 *
 * Ren logikk, ingen React. Testdekket i lib/org-scope-notice.test.ts.
 */

export type OrgScopeNotice =
  /** Nasjonal visning — ingen org var etterspurt. Ingen linje. */
  | 'none'
  /** Org var etterspurt OG servert. «Resultater blant kollegene dine». */
  | 'colleagues'
  /** Org var etterspurt, men IKKE servert. Degraderingslinja. */
  | 'degraded'

export function decideOrgScopeNotice(input: {
  /** Org-slug fra URL-en — hva brukeren ba om. */
  requestedOrg: string | null
  /** Org-slug hentingen FAKTISK brukte. null = hentet uten scope. */
  servedOrg: string | null
}): OrgScopeNotice {
  // Ingen org etterspurt: nasjonal visning er ikke en degradering, den er
  // det brukeren ba om. Denne grenen må komme først — ellers ville en
  // nasjonal visning (begge null) blitt lest som «etterspurt, ikke servert».
  if (!input.requestedOrg) return 'none'

  // Likhet, ikke bare «servedOrg finnes». Serverte vi en ANNEN org enn den
  // som ble bedt om, er «kollegene dine» feil ord uansett hvilke kolleger.
  return input.servedOrg === input.requestedOrg ? 'colleagues' : 'degraded'
}
