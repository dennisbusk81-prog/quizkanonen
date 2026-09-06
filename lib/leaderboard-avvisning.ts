// ── Hvorfor ble leaderboard-hentingen avvist? ───────────────────────────────
//
// Ren logikk, ingen I/O. Brukt av components/SeasonLeaderboard.tsx
// (6. september 2026).
//
// ── FEILKLASSEN: TRE TILSTANDER, ETT SVAR ───────────────────────────────────
// Komponenten gjorde `if (!res.ok) setLoadError(true)` — én boolsk verdi for
// alle utfall. Visningen valgte deretter tekst ut fra om det fantes en sesjon,
// ikke ut fra hvorfor kallet feilet. Resultatet var råd som ikke kan følges:
//
//   403 (ikke medlem)    → «Noe gikk galt. Prøv å laste siden på nytt.»
//                          Ingen omlasting gjør deg til medlem.
//   401 (ikke innlogget) → «Ingen data ennå. Logg inn for å se din
//                          sesong-plassering.» Riktig ved 401, men samme
//                          tekst traff også en anonym bruker som fikk 500.
//
// Dette er samme klasse som c4e808e løste i questions-ruta: et smalere
// utfallsrom enn virkeligheten gjør diagnosen umulig — ikke bare for
// brukeren, men for den som feilsøker.
//
// Statuskoden er det ENESTE signalet som faktisk vet hvorfor. Sesjonens
// tilstand er en gjetning: en bruker kan ha gyldig sesjon OG få 403, eller
// mangle sesjon OG få 500.

/** Hvorfor serveren sa nei. */
export type Avvisning = 'uinnlogget' | 'ikke-medlem' | 'feil'

/** Hvilken tom skjerm som skal vises. */
export type TomSkjerm = 'logg-inn' | 'ikke-medlem' | 'feil' | 'ingen-data'

/**
 * HTTP-status → årsak.
 *
 * Kun 401 og 403 har egne utfall, fordi kun de to er tilstander brukeren kan
 * gjøre noe med (logge inn / ingenting). Alt annet — 400, 429, 500,
 * nettverksbrudd — er «feil», og der ER «prøv igjen» riktig råd.
 *
 * `/api/toppliste` svarer også 400 «Ugyldig scope». Den havner med vilje i
 * «feil»: den kan kun oppstå ved en programmeringsfeil hos oss, og da er en
 * generisk feilmelding riktigere enn å fortelle brukeren noe om medlemskap.
 */
export function klassifiserAvvisning(status: number): Avvisning {
  if (status === 401) return 'uinnlogget'
  if (status === 403) return 'ikke-medlem'
  return 'feil'
}

/**
 * Årsak → skjerm.
 *
 * Merk at sesjonstilstanden IKKE er med i beslutningen lenger. Fram til nå
 * avgjorde `sessionChecked && !!session` hvilken tekst en feilet henting fikk,
 * slik at en anonym bruker med en 500-feil ble bedt om å logge inn — som ikke
 * hjelper — mens en innlogget bruker med 403 ble bedt om å laste på nytt.
 * Statusen vet; sesjonen gjetter.
 */
export function velgTomSkjerm(avvisning: Avvisning | null): TomSkjerm {
  switch (avvisning) {
    case 'uinnlogget': return 'logg-inn'
    case 'ikke-medlem': return 'ikke-medlem'
    case 'feil': return 'feil'
    // Ingen avvisning, men heller ingen data: hentingen gikk gjennom uten å gi
    // noe. Uendret oppførsel — den nøytrale tomme skjermen med innloggings-CTA.
    default: return 'ingen-data'
  }
}

/**
 * «Ikke medlem» av HVA.
 *
 * Samme ordlyd som `/org/[slug]` allerede bruker, gjenbrukt framfor å finne
 * opp en ny. Liga-varianten er FORESLÅTT (Dennis velger): den finnes ikke
 * noe annet sted å låne fra, og en 403 i liga-scope er den samme situasjonen
 * med et annet substantiv.
 *
 * Global scope har ingen medlemskapsgate og kan derfor ikke gi 403. Skulle
 * det likevel skje, er en nøytral formulering riktigere enn å påstå noe om
 * en bedrift eller liga brukeren ikke er i.
 */
export function ikkeMedlemTekst(scope: 'global' | 'league' | 'organization'): string {
  if (scope === 'organization') return 'Du er ikke medlem av denne bedriften.'
  if (scope === 'league') return 'Du er ikke medlem av denne ligaen.'
  return 'Du har ikke tilgang til denne listen.'
}
