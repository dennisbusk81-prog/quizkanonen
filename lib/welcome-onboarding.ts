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
 * Skal navnefeltet vises?
 *
 * `{ ok: false }` → NEI. En feilet henting er «vet ikke», aldri «mangler navn»
 * (lib/fetch-result.ts). Å vise feltet da ville bedt en Google-bruker som
 * allerede HAR navn om å skrive det på nytt — nøyaktig det bestillingen ber oss
 * unngå. NameRequiredModal er backstop for den som faktisk mangler navn, så
 * ingen faller mellom stolene.
 */
export function shouldAskForName(loaded: Loaded<string | null>): boolean {
  if (!loaded.ok) return false
  return !isValidDisplayName(loaded.value)
}

/** Fornavnet til hilsenen. Tomt navn → null, og hilsenen står uten navn. */
export function greetingName(name: string | null | undefined): string | null {
  if (!isValidDisplayName(name)) return null
  return (name as string).trim().split(' ')[0] || null
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
