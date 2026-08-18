// ── Transient GoTrue-feil vs. ugyldig token ─────────────────────────────────
// Ren logikk, ingen I/O. Brukt av spillestien (start-attempt og submit), som
// er de eneste rutene der auth er VALGFRI: et manglende/ugyldig token skal gi
// gjeste-/anon-behandling, men en GoTrue som er NEDE skal ikke gjøre det.
//
// Bakgrunn (18. august 2026): `auth.getUser` ble kalt uten å lese `error`.
// En transient GoTrue-feil ga da userId = null, og ruten behandlet en
// innlogget spiller som anonym — rate-limit-nøkkelen falt fra
// `<rute>:user:<id>` ned i `<rute>:anon:<ip>`-bøtta (20/10 min delt per IP),
// og i submit endte forespørselen i 403 «Ingen tilgang til dette forsøket».
// Med 29 spillere bak ett kontornett (Elkjøp Nordic) kunne én auth-blip på
// fredagskvelden altså 429-e legitime innsendinger, uten ett eneste loggspor.
// Nøyaktig degraderingen CLAUDE.md advarer mot («da blir userId alltid null
// og alle havner i anon-bøtta») — bare utløst av en feil i stedet for en
// flyttet kodelinje.
//
// Statuskodene er verifisert i @supabase/auth-js (dist/main/lib/fetch.js):
//   - ren nettverksfeil            → AuthRetryableFetchError, status 0
//   - 502/503/504/520–524/530      → AuthRetryableFetchError, status = svaret
//   - 500 og 429 er BEVISST utenfor NETWORK_ERROR_CODES i biblioteket (samme
//     faktum som middleware-cookie-vakten hviler på) og kommer som
//     AuthApiError med sin status — men for VÅRT formål er de like
//     forbigående: en GoTrue-500/429 sier ingenting om tokenets gyldighet.
//   - ugyldig/utløpt JWT           → AuthApiError, status 401/403
//
// Mangler status helt (ukjent feilform), behandles feilen BEVISST som
// ikke-transient: da oppfører rutene seg nøyaktig som før denne vakten
// fantes. Fail-closed gjelder kun feilformene vi positivt gjenkjenner som
// forbigående — samme konservative retning som `filterSessionDeletions`.

export function isTransientAuthStatus(status: number | null | undefined): boolean {
  if (typeof status !== 'number') return false
  return status === 0 || status === 429 || status >= 500
}
