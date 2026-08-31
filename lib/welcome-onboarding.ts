import type { Loaded } from './fetch-result'

// Beslutningene bak velkomstsiden for nye B2C-brukere (/velkommen).
//
// Ren logikk, ingen I/O — samme grep som lib/org-onboarding.ts, og av samme
// grunn: dette er en gren MIDT I REGISTRERINGSSTIEN. En feil her rammer ikke en
// visning, den rammer brukerens evne til å komme inn i det hele tatt. Da må
// betingelsen kunne kjøres i en test uten å sette opp auth, Supabase og to
// server-ruter.
//
// HVORFOR INGEN NY KOLONNE (i motsetning til org-varianten):
// `ensureProfileForUser` VET allerede om brukeren er ny — den gjør UPDATE først
// og faller til INSERT kun når UPDATE traff 0 rader. Det er nøyaktig den grenen
// velkomst-e-posten allerede henger på, og den nås per definisjon én gang per
// konto. Signalet er altså et biprodukt av en skriving som uansett skjer: null
// nye spørringer i en sti der latency er dyrest, og ingen migrasjon å rulle
// tilbake hvis bryteren slås av.
//
// Prisen er at semantikken er «vist én gang», ikke «vist til den er fullført»:
// lukker brukeren fanen, kommer siden aldri igjen. Bevisst valgt — dette er en
// invitasjon, ikke en port.

export const WELCOME_PATH = '/velkommen'

/**
 * Skal AuthListener la være å fyre navnesjekken (og dermed NameRequiredModal)
 * på denne pathnamen?
 *
 * To flater, én regel:
 *  - /velkommen spør selv om navn, i sitt eget felt.
 *  - Alt under /auth/ er ruter en ny bruker PASSERER på vei til velkomstsiden.
 *    Verifisert i prod 7. august: en fersk konto med sesjon men uten navn fikk
 *    modalen («Hva heter du?») på /auth/bekreft — FØR kontoen engang var
 *    bekreftet, og deretter navnespørsmålet på nytt på /velkommen.
 *
 * Prefiks, ikke navngitte ruter: en framtidig /auth/-rute skal ikke kunne
 * gjeninnføre bugen ved å mangle på en liste. /login og /sett-passord ligger
 * bevisst UTENFOR — recovery-flyten ender på /sett-passord og går aldri videre
 * til velkomstsiden, så der er modalen fortsatt riktig backstop.
 *
 * Kalleren skal IKKE sette dedupe-ref-en når denne sier true: brukeren er
 * fortsatt uhåndtert, og navnesjekken skal kjøre som vanlig på neste side.
 */
export function suppressNameModalOnPath(pathname: string): boolean {
  return pathname === WELCOME_PATH || pathname.startsWith('/auth/')
}

// Nøkkelen WelcomeBanner (forsiden) bruker for «har sett førstegangsbanneret».
// Delt herfra slik at velkomstsiden kan stemple den før den navigerer videre —
// ellers får en fersk bruker banneret rett etter velkomstsiden, som sier omtrent
// det samme en gang til.
export const WELCOME_BANNER_SEEN_KEY = 'qk_welcomed'

/**
 * Av/på-bryteren. Fraværende variabel → av.
 *
 * Allowlisten er med vilje smal: en skrivefeil i Vercel skal gjøre funksjonen
 * INERT, ikke aktiv. Feilretningen er hele poenget med en bryter som sitter i
 * registreringsstien — «av» er alltid det trygge utfallet, siden av betyr at
 * stien oppfører seg nøyaktig som før denne endringen fantes.
 */
export function welcomeOnboardingEnabled(raw: string | undefined | null): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

export type WelcomeGateInput = {
  isNewUser: boolean
  /** Allerede normalisert av safeNextPath() hos kalleren. */
  next: string
  enabled: boolean
}

/**
 * Skal denne innloggingen sendes til velkomstsiden?
 *
 * `next !== '/'` er den viktigste av de tre betingelsene, og den eneste som
 * ikke er åpenbar: et konkret `next` betyr at brukeren er MIDT I NOE —
 * org-invitasjon (/bli-med/<token>), liga-invitasjon, /sett-passord,
 * founders-checkout. Alle er egne flyter med egen onboarding. Å skyte en
 * velkomstside inn foran dem ville avbrutt en reise brukeren allerede er i
 * gang med, og for en invitert ansatt ville den dessuten vært feil side.
 */
export function shouldShowWelcome({ isNewUser, next, enabled }: WelcomeGateInput): boolean {
  if (!enabled) return false
  if (!isNewUser) return false
  return next === '/'
}

/**
 * Målet begge auth-rutene faktisk redirecter til.
 *
 * Finnes som egen funksjon fordi /auth/callback og /api/auth/bekreft ellers
 * ville hatt hver sin kopi av regelen — og de to har allerede måttet rettes
 * hver for seg én gang (rate_limit-redirecten pekte feil sted i callback i
 * flere uker mens bekreft gjorde det riktig).
 */
export function postLoginPath(input: WelcomeGateInput): string {
  return shouldShowWelcome(input) ? WELCOME_PATH : input.next
}

/** Hvor «Kom i gang» sender brukeren. Ingen åpen quiz → forsiden. */
export function welcomeExitPath(activeQuizId: string | null): string {
  return activeQuizId ? `/quiz/${activeQuizId}` : '/'
}

// ── Navn ─────────────────────────────────────────────────────────────────────

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

/**
 * Samme regel som AuthListener og /api/profile/upsert håndhever: tegnsettet
 * OG kravet om fullt navn (mellomrom eller bindestrek — «Anne-Marie» teller).
 *
 * Ligger her, og importeres av AuthListener, for at velkomstsiden og den
 * blokkerende modalen ikke skal kunne være uenige om hvem som mangler navn.
 */
export function isValidDisplayName(name: string | null | undefined): boolean {
  if (!name) return false
  const trimmed = name.trim()
  if (!NAME_RE.test(trimmed)) return false
  return trimmed.includes(' ') || trimmed.includes('-')
}

/**
 * Navnefeltets tilstand — TRE utfall, ikke to.
 *
 * Forgjengeren (shouldAskForName, boolsk) kollapset «vet ikke» til «skjul», og
 * det VAR produksjonsbuggen 6. august: alle veier til `{ ok: false }` i
 * oppstarten (auth-lås-timeout, feilet spørring) skjulte feltet, og backstopen
 * for skjulingen var NameRequiredModal på NESTE side — altså nøyaktig den
 * doble navnespørringen AuthListener-unntaket skulle fjerne. Med tre tilstander
 * kan «vet ikke» få sin egen visning (plassholder) i stedet for å bli
 * bit-identisk med «har navn».
 *
 *   'show'    — vi VET at navnet mangler eller er ugyldig. Vis feltet.
 *   'hide'    — vi VET at brukeren har et gyldig navn. Ikke noe felt.
 *   'pending' — vi vet ikke ennå. Plassholder — ALDRI 'hide', for «vet ikke»
 *               skal aldri bli til «har navn».
 */
export type NameFieldState = 'show' | 'hide' | 'pending'

/**
 * Kilden er de to navnefeltene fra useProfile() — og funksjonen finnes for å
 * DOKUMENTERE hvilket av dem som er lovlig å lese:
 *
 * `displayNameRaw` er den rå kolonneverdien fra profiles.display_name, som en
 * bekreftet henting. `displayName` er visningsverdien for NavAuth og
 * har en FALLBACK TIL E-POSTENS LOKALDEL (ProfileProvider ~linje 144) — for
 * support@quizkanonen.no «heter» brukeren der support. Den duger aldri som
 * «har navn»-signal og tas imot her KUN for at testene skal kunne felle en
 * implementasjon som leser den. Se mutasjonsbeviset i testfilen.
 */
export type WelcomeNameSource = {
  displayNameRaw: Loaded<string | null>
  displayName: string | null
}

export function nameFieldState({ displayNameRaw }: WelcomeNameSource): NameFieldState {
  if (!displayNameRaw.ok) return 'pending'
  return isValidDisplayName(displayNameRaw.value) ? 'hide' : 'show'
}

/** Fornavnet til hilsenen. Tomt navn → null, og hilsenen står uten navn. */
export function greetingName(name: string | null | undefined): string | null {
  if (!isValidDisplayName(name)) return null
  return (name as string).trim().split(' ')[0] || null
}

// ── Statuslinjen ─────────────────────────────────────────────────────────────

/**
 * «Hva skjer nå?» — linjen som gir «Kom i gang»-knappen mening.
 *
 * `null` = svaret fra /api/quiz/active har ikke landet ennå. Den nøytrale
 * varianten rendres da UMIDDELBART — teksten venter aldri på nettverket, den
 * oppgraderes når svaret kommer. `{ ok: false }` (ruten feilet/timet ut) gir
 * samme nøytrale linje: den er sann uansett, og «vet ikke» skal ikke se
 * annerledes ut enn «vet ikke ennå».
 *
 * Klokkeslettet 12 er bevisst hardkodet — samme påstand som
 * /slik-fungerer-det allerede gjør («Hver fredag kl. 12:00»). /api/quiz/active
 * svarer kun {id}, så et datadrevet klokkeslett hadde krevd et endret kall.
 * Endres åpningstiden noen gang, må BEGGE sidene oppdateres.
 *
 * «Ukens quiz er åpen nå» står med vilje (vurdert 31. august 2026): linjen
 * beskriver den quizen /api/quiz/active melder som ÅPEN NÅ, ikke en vilkårlig
 * quiz-id, så «ukens» er sant rundt førti uker i året — og produktets stemme
 * er «hver fredag». Ikke meld den på nytt ved neste ukens-sveip.
 */
export function quizStatusLine(active: Loaded<string | null> | null): string {
  if (active?.ok && active.value) return 'Ukens quiz er åpen nå — 15 spørsmål venter.'
  if (active?.ok) return 'Neste quiz åpner fredag kl. 12.'
  return 'Ny quiz hver fredag kl. 12.'
}

// ── Lagring og navigasjon ────────────────────────────────────────────────────

export type SaveOutcome = 'ok' | 'correctable' | 'failed'

/**
 * Hva slags avvisning fikk vi fra /api/profile/upsert?
 *
 * Skillet er hele feilhåndteringen: en avvisning brukeren KAN rette (navnet er
 * opptatt, mangler etternavn, for kort) fortjener at hen blir stående og får
 * meldingen. Alt annet — 401, 429, 5xx, nettverksbrudd, timeout — er vår feil,
 * ikke brukerens, og skal aldri holde en ny bruker igjen.
 */
export function classifyNameSave(status: number): SaveOutcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 400 || status === 409 || status === 422) return 'correctable'
  return 'failed'
}

export type NavigationInput = {
  nameOutcome: SaveOutcome | 'skipped'
  /** 1 = første trykk på «Kom i gang». */
  attempt: number
}

/**
 * Blir brukeren stående, eller går hen videre?
 *
 * INVARIANTEN: andre trykk navigerer ALLTID. En rettbar feil får ett forsøk på
 * å bli rettet, og deretter slipper vi taket uansett. Uten den grensen ville en
 * bruker med et navn serveren fortsetter å avvise stått fast på siden i det
 * øyeblikket hen er mest utålmodig — og det er verre enn å miste et navn hen
 * kan sette på profilen når som helst.
 *
 * Varselvalget er ikke med i beslutningen i det hele tatt: det får ALDRI
 * blokkere. Derfor er det også et eget kall (se WelcomeScreen) — et opptatt
 * navn skal ikke ta med seg fredagsvarselet i fallet.
 */
export function decideNavigation({ nameOutcome, attempt }: NavigationInput): 'navigate' | 'stay' {
  if (nameOutcome === 'correctable' && attempt <= 1) return 'stay'
  return 'navigate'
}
