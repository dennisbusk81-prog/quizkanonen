// Kjøres med:  npm test
//
// SPERRE mot at de to B2B-effektene igjen nøkles på hele Supabase-session-
// OBJEKTET i stedet for den stabile identiteten:
//   • app/org/[slug]/velkommen/page.tsx  (oppsettet, porten inn i onboardingen)
//   • app/bedrift/success/page.tsx       (kvitteringssiden, rett etter betaling)
//
// HVA SOM STÅR PÅ SPILL
// `session` settes begge steder av TO skrivere — getSession().then og
// onAuthStateChange sin INITIAL_SESSION — som leverer SAMME logiske sesjon som
// to ULIKE objekter. Med objektet i dep-lista kan React ikke bail-e ut på
// referanselikhet, og effekten kjørte to ganger for en innlogget bruker. Begge
// treffer /api/org/[slug]/admin-data, som er en tung samlerute; på velkommen-
// siden dobles i tillegg redirect-forsøkene i 403-/låst-grenene.
//
// Utlogget passerer begge skriverne `null` — referanselik — så feilen bet KUN
// innloggede. Det er grunnen til at en utlogget måling ikke kan brukes som
// bevis på at siden er frisk, og til at testene under kjører den innloggede
// sekvensen eksplisitt.
//
// Samme feilklasse og samme fiks som app/premium/page.tsx fikk i 46c7818 — se
// lib/premium-session-dep.test.ts. Denne filen dekker de to gjenstående
// tilfellene av klassen; de sju øvrige kallstedene ble kartlagt 12. august 2026
// og er no-op ved re-kjøring (se «SKRIVER-SIDEN» nederst).
//
// HVORFOR EN SIMULATOR OG IKKE EN RENDER-TEST
// Prosjektet har ingen React-testrigg (`npm test` kjører node:test over
// lib/**/*.test.ts, uten jsdom). Det som faktisk avgjør antall kall er React
// sin `Object.is`-sammenligning per element i dep-lista — liten nok til å
// gjengis eksakt, og da testes beslutningen med den EKTE getSessionIdentity i
// stedet for å påstås. Strukturtestene binder simuleringen til de faktiske
// linjene i de to sidene, slik at en reversering ikke kan la filen stå grønn.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger.
// Alle mutasjonene er KJØRT 12. august 2026, ikke antatt:
//   • Bytt dep-en i velkommen/page.tsx tilbake til `[session, slug, router]`
//     → «velkommen: dep-lista er sessionIdentity» + «velkommen: ingen aktiv
//     [session]-dep» ryker.
//   • Bytt dep-en i bedrift/success/page.tsx tilbake til `[session, orgSlug]`
//     → «success: dep-lista er sessionIdentity» + «success: ingen aktiv
//     [session]-dep» ryker.
//   • Kommenter ut den nye dep-linja og la den gamle stå aktiv (velkommen)
//     → «velkommen: ingen aktiv [session]-dep» ryker (kommentarstrippen er
//     nettopp poenget — begge formene nevnes i prosa i disse filene).
//   • La getSessionIdentity kollapse 'unchecked' inn i 'anon'
//     → KUN «utlogging fyrer begge effektene» ryker, og den ryker på
//     redirect-tellingen, ikke på fetch-tellingen: en uavklart sesjon blir da
//     umulig å skille fra en bekreftet utlogget, så velkommen-siden sender
//     brukeren til login FØR getSession() har svart — og en gang til når den
//     faktisk logger ut. Det er nettopp derfor de tre tilstandene holdes
//     atskilt i lib/session-identity.ts. Målt, ikke antatt: de tre andre
//     testene jeg trodde ville ryke her, overlever (fetch-tellingen er
//     uendret), og det er grunnen til at redirect telles separat fra fetch i
//     denne filen i det hele tatt.
//   • La getSessionIdentity returnere session-objektet i stedet for user.id
//     → «to objekter for samme bruker gir ett kall» (begge sider) og
//     «token-refresh gir ingen nye kall» ryker — altså nøyaktig feilen.
//   • Fjern dedupe-vakten i SeasonLeaderboard sin applySession
//     → «SeasonLeaderboard: skriveren deduper fortsatt» ryker.
//   • Fjern identitets-vakten i leaderboard/[id] sin onAuthStateChange
//     → «leaderboard/[id]: skriveren deduper fortsatt» ryker.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Session } from '@supabase/supabase-js'
import { getSessionIdentity } from './session-identity'

// ── Sesjonsfixtures ────────────────────────────────────────────────────────
// Kun feltene identiteten og effektkroppene faktisk leser. `access_token`
// varierer bevisst mellom objektene for samme bruker der det er poenget: det er
// slik en TOKEN_REFRESHED ser ut, og et refresh skal IKKE utløse nytt kall.
function sesjon(userId: string, token: string): Session {
  return { access_token: token, user: { id: userId } } as unknown as Session
}

const admin = 'a1111111-1111-4111-8111-111111111111'
const annenAdmin = 'b2222222-2222-4222-8222-222222222222'

// De to objektene som de to skriverne faktisk produserer ved mount: samme
// bruker, samme token, to referanser. `Object.is` skiller dem, en
// identitetsstreng gjør det ikke.
const førsteSkriver = sesjon(admin, 'token-1')
const andreSkriver = sesjon(admin, 'token-1')

// ── React sin dep-sammenligning, gjengitt ──────────────────────────────────
// Tilsvarer areHookInputsEqual: samme lengde, Object.is per element. Første
// kjøring (ingen forrige liste) teller alltid som endring.
function depEndret(forrige: readonly unknown[] | null, ny: readonly unknown[]): boolean {
  if (forrige === null) return true
  if (forrige.length !== ny.length) return true
  return ny.some((v, i) => !Object.is(v, forrige[i]))
}

// Hva én gjennomkjøring av effektkroppen endte med. De to sidene har ulik
// «ellers»-gren — velkommen sender til login, success avslutter lastingen — og
// begge må telles, ikke bare fetch-en.
type Utfall = 'fetch' | 'redirect' | 'ingenting'

type Flate = {
  dep: (s: Session | null | undefined) => readonly unknown[]
  kropp: (s: Session | null | undefined) => Utfall
}

function kjør(tilstander: readonly (Session | null | undefined)[], flate: Flate): Utfall[] {
  let forrige: readonly unknown[] | null = null
  const utfall: Utfall[] = []
  for (const s of tilstander) {
    const dep = flate.dep(s)
    if (depEndret(forrige, dep)) utfall.push(flate.kropp(s))
    forrige = dep
  }
  return utfall
}

const tell = (u: Utfall[], hva: Utfall) => u.filter(x => x === hva).length

// ── Dagens form, skrevet nøyaktig som koden den representerer ──────────────

// app/org/[slug]/velkommen/page.tsx:
//   const sessionIdentity = getSessionIdentity(session)
//   if (sessionIdentity === 'unchecked') return
//   if (!session) { router.push(...); return }
//   fetch(`/api/org/${slug}/admin-data`, ...)
const VELKOMMEN: Flate = {
  dep: s => [getSessionIdentity(s), 'slug', 'router'],
  kropp: s => {
    if (getSessionIdentity(s) === 'unchecked') return 'ingenting'
    if (!s) return 'redirect'
    return 'fetch'
  },
}

// app/bedrift/success/page.tsx:
//   const sessionIdentity = getSessionIdentity(session)
//   if (sessionIdentity === 'unchecked' || !orgSlug) return
//   if (!session) { setLoading(false); return }
//   fetch(`/api/org/${orgSlug}/admin-data`, ...)
const SUCCESS: Flate = {
  dep: s => [getSessionIdentity(s), 'org-slug'],
  kropp: s => {
    if (getSessionIdentity(s) === 'unchecked') return 'ingenting'
    if (!s) return 'ingenting'
    return 'fetch'
  },
}

// Formene som var der før 12. august 2026 — beholdt som positiv kontroll, slik
// at testene beviser at fiksen er det som gjør forskjellen, ikke simulatoren.
const VELKOMMEN_GAMMEL: Flate = {
  dep: s => [s, 'slug', 'router'],
  kropp: s => {
    if (s === undefined) return 'ingenting'
    if (!s) return 'redirect'
    return 'fetch'
  },
}

const SUCCESS_GAMMEL: Flate = {
  dep: s => [s, 'org-slug'],
  kropp: s => {
    if (s === undefined) return 'ingenting'
    if (!s) return 'ingenting'
    return 'fetch'
  },
}

// Den innloggede sidelasten som faktisk ble målt: undefined → getSession() sitt
// objekt → onAuthStateChange sitt objekt for samme sesjon.
const INNLOGGET_SIDELAST = [undefined, førsteSkriver, andreSkriver] as const

// ── Selve regelen: én gang per logisk sesjon ───────────────────────────────

test('velkommen: to objekter for samme bruker gir ett admin-data-kall', () => {
  assert.equal(tell(kjør(INNLOGGET_SIDELAST, VELKOMMEN), 'fetch'), 1)
})

test('success: to objekter for samme bruker gir ett admin-data-kall', () => {
  assert.equal(tell(kjør(INNLOGGET_SIDELAST, SUCCESS), 'fetch'), 1)
})

test('den gamle formen gav to kall på samme sekvens (positiv kontroll)', () => {
  // Uten disse kunne testene over vært grønne på en simulator som ikke måler
  // noe. De beviser at de to formene faktisk skiller lag.
  assert.equal(tell(kjør(INNLOGGET_SIDELAST, VELKOMMEN_GAMMEL), 'fetch'), 2)
  assert.equal(tell(kjør(INNLOGGET_SIDELAST, SUCCESS_GAMMEL), 'fetch'), 2)
})

test('token-refresh for samme bruker gir ingen nye kall', () => {
  // TOKEN_REFRESHED ved fane-fokus: nytt objekt, ny access_token, samme bruker.
  const sekvens = [undefined, førsteSkriver, sesjon(admin, 'token-2'), sesjon(admin, 'token-3')]
  assert.equal(tell(kjør(sekvens, VELKOMMEN), 'fetch'), 1)
  assert.equal(tell(kjør(sekvens, SUCCESS), 'fetch'), 1)
})

test('velkommen: utlogget ender i login-redirect, én gang', () => {
  // Utlogget passerer begge skriverne `null`. Redirecten skal skje — men bare
  // én gang, og uten et admin-data-kall.
  const utfall = kjør([undefined, null, null], VELKOMMEN)
  assert.equal(tell(utfall, 'redirect'), 1)
  assert.equal(tell(utfall, 'fetch'), 0)
})

test('success: utlogget gir ingen admin-data-kall', () => {
  const utfall = kjør([undefined, null, null], SUCCESS)
  assert.equal(tell(utfall, 'fetch'), 0)
})

// ── Effekten må fortsatt fyre på EKTE sesjonsendring ───────────────────────
// Halvparten som er lett å ødelegge når man demper en effekt: den slutter å
// kjøre når den skal.

test('innlogging fyrer begge effektene', () => {
  const sekvens = [undefined, null, førsteSkriver]
  assert.equal(tell(kjør(sekvens, VELKOMMEN), 'fetch'), 1)
  assert.equal(tell(kjør(sekvens, SUCCESS), 'fetch'), 1)
})

test('utlogging fyrer begge effektene', () => {
  // Admin logger ut i en åpen fane: velkommen skal sende til login, success
  // skal slutte å vise bedriftsdata.
  const sekvens = [undefined, førsteSkriver, null]
  const v = kjør(sekvens, VELKOMMEN)
  assert.equal(tell(v, 'fetch'), 1)
  assert.equal(tell(v, 'redirect'), 1)
  assert.equal(tell(kjør(sekvens, SUCCESS), 'fetch'), 1)
})

test('bytte av bruker fyrer begge effektene', () => {
  // To ulike admin-kontoer i samme fane. admin-data er per konto (403 for
  // ikke-admin), så et manglende refetch ville vist forrige brukers bedrift.
  const sekvens = [undefined, førsteSkriver, sesjon(annenAdmin, 'token-x')]
  assert.equal(tell(kjør(sekvens, VELKOMMEN), 'fetch'), 2)
  assert.equal(tell(kjør(sekvens, SUCCESS), 'fetch'), 2)
})

// ── Binding til den faktiske kildekoden ────────────────────────────────────
// Simuleringen over er bare sann om sidene faktisk bruker den formen.

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const VELKOMMEN_SRC = readFileSync('app/org/[slug]/velkommen/page.tsx', 'utf8')
const SUCCESS_SRC = readFileSync('app/bedrift/success/page.tsx', 'utf8')
const VELKOMMEN_AKTIV = stripComments(VELKOMMEN_SRC)
const SUCCESS_AKTIV = stripComments(SUCCESS_SRC)

test('kommentarstrippen virker (positiv kontroll)', () => {
  // Begge filene nevner BÅDE `[session]` og `[sessionIdentity]` i prosa. Uten
  // en fungerende strip ville testene under målt kommentarer i stedet for kode
  // — og en ødelagt strip som fjerner alt ville gjort dem grønne på tom input.
  assert.ok(VELKOMMEN_SRC.includes('Dep-en er den STABILE identiteten'), 'ankerkommentar finnes')
  assert.ok(!VELKOMMEN_AKTIV.includes('Dep-en er den STABILE identiteten'), 'kommentar ble strippet')
  assert.ok(VELKOMMEN_AKTIV.includes('admin-data'), 'kode overlevde strippen')
  assert.ok(SUCCESS_AKTIV.includes('admin-data'), 'kode overlevde strippen (success)')
})

test('velkommen: dep-lista er sessionIdentity', () => {
  assert.ok(
    /\}, \[sessionIdentity, slug, router\]\)/.test(VELKOMMEN_AKTIV),
    'fant ingen aktiv `}, [sessionIdentity, slug, router])` — er dep-en reversert?',
  )
  assert.ok(
    /const sessionIdentity = getSessionIdentity\(session\)/.test(VELKOMMEN_AKTIV),
    'sessionIdentity utledes ikke lenger av getSessionIdentity',
  )
  assert.ok(
    /sessionIdentity === 'unchecked'/.test(VELKOMMEN_AKTIV),
    "vakten er ikke lenger sessionIdentity === 'unchecked'",
  )
})

test('velkommen: ingen aktiv [session]-dep', () => {
  assert.ok(
    !/\}, \[session, slug, router\]\)/.test(VELKOMMEN_AKTIV),
    'en aktiv `}, [session, slug, router])` finnes — det er formen som gav to kall',
  )
})

test('success: dep-lista er sessionIdentity', () => {
  assert.ok(
    /\}, \[sessionIdentity, orgSlug\]\)/.test(SUCCESS_AKTIV),
    'fant ingen aktiv `}, [sessionIdentity, orgSlug])` — er dep-en reversert?',
  )
  assert.ok(
    /const sessionIdentity = getSessionIdentity\(session\)/.test(SUCCESS_AKTIV),
    'sessionIdentity utledes ikke lenger av getSessionIdentity',
  )
  assert.ok(
    /sessionIdentity === 'unchecked'/.test(SUCCESS_AKTIV),
    "vakten er ikke lenger sessionIdentity === 'unchecked'",
  )
})

test('success: ingen aktiv [session]-dep', () => {
  assert.ok(
    !/\}, \[session, orgSlug\]\)/.test(SUCCESS_AKTIV),
    'en aktiv `}, [session, orgSlug])` finnes — det er formen som gav to kall',
  )
})

// ── SKRIVER-SIDEN: de to som BEVISST beholder session-objektet ─────────────
// components/SeasonLeaderboard.tsx:456 og app/leaderboard/[id]/page.tsx:558 har
// samme FORM som feilen over, men er trygge fordi beskyttelsen bor hos
// skriveren. Begge har fått en kodekommentar som sier nettopp det — og den
// kommentaren er kun sann så lenge vakten faktisk står. Fjernes vakten, blir
// kommentaren en usannhet OG kallstedet en ekte dobling, uten at noe annet i
// prosjektet merker det. Derfor låses vaktene her.

const SEASON_AKTIV = stripComments(readFileSync('components/SeasonLeaderboard.tsx', 'utf8'))
const LEADERBOARD_AKTIV = stripComments(readFileSync('app/leaderboard/[id]/page.tsx', 'utf8'))

test('SeasonLeaderboard: skriveren deduper fortsatt på access_token', () => {
  assert.ok(
    /setSession\(prev => \(prev\?\.access_token === s\?\.access_token \? prev : s\)\)/.test(SEASON_AKTIV),
    'dedupe-vakten i applySession er borte — da er [session] på rivalries-effekten ikke lenger trygt',
  )
})

test('leaderboard/[id]: skriveren deduper fortsatt på identitet', () => {
  assert.ok(
    /lastSessionIdentityRef\.current = getSessionIdentity\(sess\)/.test(LEADERBOARD_AKTIV),
    'identiteten stemples ikke lenger i loadSession',
  )
  assert.ok(
    /if \(newIdentity === lastSessionIdentityRef\.current\) return/.test(LEADERBOARD_AKTIV),
    'identitets-vakten i onAuthStateChange er borte — da er [session] på browse-effekten ikke lenger trygt',
  )
})
