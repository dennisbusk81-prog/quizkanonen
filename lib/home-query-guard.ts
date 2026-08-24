// Feil er ikke tomt — forsidens versjon.
//
// computeSharedHomeData kjørte fram til 24. august 2026 ni rå spørringer uten
// å lese `error`. En feilet spørring gir `data: null`, som falt gjennom
// `?? []`-ene og ble til «ingen aktiv quiz» — og `unstable_cache` skrev den
// nullbundelen som et helt gyldig svar i 60 sekunder. Symptomet var «Ingen quiz
// planlagt akkurat nå» til ALLE som lastet forsiden det minuttet, mens quizen
// faktisk var åpen. Forsiden er nettopp der folk lander når quizen åpner.
//
// De to funksjonene her ER skillet mellom de to degraderingene:
//
//   assertHomeQuery — KRITISK lesing. Kaster. Kalleren (app/page.tsx) fanger og
//     viser en ærlig feiltilstand i stedet for quiz-kortet. Et kast kan
//     dessuten ikke caches: i unstable_cache står `await cb()` FØR
//     `cacheNewResult(...)` på fersk-stien, og bakgrunnsrevalideringen skriver
//     kun inne i `.then(...)`. Verifisert mot next 16.2.1 med den ekte
//     `unstable_cache` i lib/home-cache-poisoning.test.ts — ikke antatt. En
//     transient feil låses derfor ikke i 60 sekunder.
//
//   logHomeQuery — KOSMETISK lesing. Logger, returnerer true, og kalleren
//     degraderer synlig (seksjonen skjules). At deltakerlinja eller
//     «Forrige uke — hvem vant?» mangler er ikke verdt å felle forsiden for —
//     men feilen skal stå i loggen, ikke være forkledd som tomme data. Samme
//     mønster som lib/monthly-standings og lib/home-top3 fikk i cd32f9c.
//
// REGELEN når du legger til en spørring: velg ut fra hva som havner på
// SKJERMEN. Kan et tomt resultat leses som en påstand brukeren vil tro på
// («ingen quiz», «0 quizer gjennomført», «250 av 250 plasser igjen»), er
// lesingen kritisk — eller så må degraderingen føre til at påstanden IKKE
// VISES, aldri til et oppdiktet tall. Å skjule en linje er ærlig; å skrive 0
// er det ikke.

export type QueryErrorLike = { message?: string | null } | null | undefined

export class HomeDataUnavailableError extends Error {
  readonly query: string

  constructor(query: string, detail: string) {
    super(`forsidens delte bundel: «${query}» feilet — ${detail}`)
    this.name = 'HomeDataUnavailableError'
    this.query = query
  }
}

/**
 * KRITISK lesing: kaster ved feil, så et tomt resultat aldri kan bli til en
 * usann påstand på forsiden — og så `unstable_cache` ikke får noe å lagre.
 */
export function assertHomeQuery(query: string, error: QueryErrorLike): void {
  if (!error) return
  throw new HomeDataUnavailableError(query, error.message ?? 'ukjent lesefeil')
}

/**
 * KOSMETISK lesing: logger og sier fra at kalleren må degradere.
 * Returnerer `true` når det FEILET, slik at kallstedet kan skrives som en
 * tidlig retur — `if (logHomeQuery('x', res.error)) return null`.
 */
export function logHomeQuery(query: string, error: QueryErrorLike): boolean {
  if (!error) return false
  console.error(`[forside] ${query} feilet — degraderer synlig:`, error.message ?? error)
  return true
}
