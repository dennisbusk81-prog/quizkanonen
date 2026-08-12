// Kjøres med:  npm test
//
// SPERRE mot at trial-offer-effekten på /premium igjen nøkles på hele
// Supabase-session-OBJEKTET i stedet for den stabile identiteten.
//
// HVA SOM STÅR PÅ SPILL
// Målt 12. august 2026, i BÅDE `next dev` og produksjonsbygg: en innlogget
// sidelast av /premium gav TO kall til /api/premium/trial-offer, 2 ms fra
// hverandre, med identisk Authorization-header. Årsaken er at `session` settes
// av to skrivere (getSession().then og onAuthStateChange sin INITIAL_SESSION)
// som leverer SAMME logiske sesjon som to ULIKE objekter. Med objektet i
// dep-lista kan React ikke bail-e ut på referanselikhet, og effekten kjører to
// ganger. Utlogget passerer begge `null` — referanselik — og gav derfor alltid
// ett kall; feilen bet kun innloggede. StrictMode var IKKE forklaringen:
// prod-bygget gav nøyaktig samme to.
//
// Duplikatet er selvforsterkende: de to kallene kjørte samtidig og målte 1883
// og 3001 ms, mot ~500 ms alene. Prøveknappen venter på svaret.
//
// HVORFOR EN SIMULATOR OG IKKE EN RENDER-TEST
// Prosjektet har ingen React-testrigg (`npm test` kjører node:test over
// lib/**/*.test.ts, uten jsdom). Det som faktisk avgjør antall kall er
// React sin `Object.is`-sammenligning per element i dep-lista — den er liten
// nok til å gjengis eksakt, og da tester vi beslutningen med den EKTE
// getSessionIdentity i stedet for å påstå den. Strukturtesten nederst binder
// simuleringen til den faktiske linja i app/premium/page.tsx, slik at en
// framtidig reversering ikke kan la denne fila stå grønn.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger.
// Alle mutasjonene er KJØRT 12. august 2026, ikke antatt:
//   • Bytt dep-en i app/premium/page.tsx tilbake til `[session]`
//     → «dep-lista er sessionIdentity» + «ingen aktiv [session]-dep» ryker.
//   • Kommenter ut den nye dep-linja og la den gamle stå aktiv
//     → «ingen aktiv [session]-dep» ryker (kommentarstrippen er poenget).
//   • La getSessionIdentity kollapse 'anon' og 'unchecked' til samme verdi
//     → «utlogget sidelast gir ett kall» + «innlogging fyrer» + «utlogging
//     fyrer» ryker (tre stykker: en utlogget bruker blir da usynlig for
//     effekten, og begge overgangene mot `null` forsvinner).
//   • La getSessionIdentity returnere session-objektet i stedet for user.id
//     → «to objekter for samme bruker gir ett kall» + «token-refresh gir
//     ingen nye kall» ryker — altså nøyaktig feilen fiksen fjernet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Session } from '@supabase/supabase-js'
import { getSessionIdentity } from './session-identity'

// ── Sesjonsfixtures ────────────────────────────────────────────────────────
// Kun feltene identiteten og effektkroppen faktisk leser. `access_token`
// varierer bevisst mellom de to objektene for samme bruker: det er nettopp
// slik en TOKEN_REFRESHED ser ut, og et refresh skal IKKE utløse et nytt kall.
function sesjon(userId: string, token: string): Session {
  return { access_token: token, user: { id: userId } } as unknown as Session
}

const bruker = 'a1111111-1111-4111-8111-111111111111'
const annenBruker = 'b2222222-2222-4222-8222-222222222222'

// De to objektene som faktisk ble målt i browseren: samme bruker, samme token,
// to referanser. `Object.is` skiller dem, en identitetsstreng gjør det ikke.
const førsteSkriver = sesjon(bruker, 'token-1')
const andreSkriver = sesjon(bruker, 'token-1')

// ── React sin dep-sammenligning, gjengitt ──────────────────────────────────
// Tilsvarer areHookInputsEqual: samme lengde, og Object.is per element.
// Første kjøring (ingen forrige liste) teller alltid som endring.
function depEndret(forrige: readonly unknown[] | null, ny: readonly unknown[]): boolean {
  if (forrige === null) return true
  if (forrige.length !== ny.length) return true
  return ny.some((v, i) => !Object.is(v, forrige[i]))
}

// Kjører sekvensen av session-tilstander gjennom komponenten og teller hvor
// mange ganger fetchTrialOffer ville blitt kalt. `depOf` er dep-lista,
// `guard` er den tidlige returen i effektkroppen — de to må høre sammen, og
// begge variantene under er skrevet nøyaktig som koden de representerer.
function tellKall(
  tilstander: readonly (Session | null | undefined)[],
  depOf: (s: Session | null | undefined) => readonly unknown[],
  guard: (s: Session | null | undefined) => boolean,
): number {
  let forrige: readonly unknown[] | null = null
  let kall = 0
  for (const s of tilstander) {
    const dep = depOf(s)
    if (depEndret(forrige, dep)) {
      if (!guard(s)) kall++
    }
    forrige = dep
  }
  return kall
}

// Dagens form (etter fiksen).
const NY_DEP = (s: Session | null | undefined) => [getSessionIdentity(s)]
const NY_GUARD = (s: Session | null | undefined) => getSessionIdentity(s) === 'unchecked'

// Formen som var der før 12. august 2026 — beholdt for å vise at testen
// faktisk skiller de to. Uten denne kunne fiksen vært et no-op.
const GAMMEL_DEP = (s: Session | null | undefined) => [s]
const GAMMEL_GUARD = (s: Session | null | undefined) => s === undefined

// ── Selve regelen ──────────────────────────────────────────────────────────

test('to objekter for samme bruker gir ett kall (den målte sidelasten)', () => {
  // Nøyaktig sekvensen ved en innlogget sidelast: undefined → getSession()
  // sitt objekt → onAuthStateChange sitt objekt for samme sesjon.
  const sekvens = [undefined, førsteSkriver, andreSkriver]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 1)
})

test('den gamle formen gav to kall på samme sekvens', () => {
  // Positiv kontroll: beviser at testen over måler noe, og at fiksen er den
  // som gjør forskjellen — ikke simulatoren.
  const sekvens = [undefined, førsteSkriver, andreSkriver]
  assert.equal(tellKall(sekvens, GAMMEL_DEP, GAMMEL_GUARD), 2)
})

test('token-refresh for samme bruker gir ingen nye kall', () => {
  // TOKEN_REFRESHED ved fane-fokus: nytt objekt, ny access_token, samme bruker.
  const sekvens = [undefined, førsteSkriver, sesjon(bruker, 'token-2'), sesjon(bruker, 'token-3')]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 1)
})

test('utlogget sidelast gir ett kall', () => {
  // `eligible: null` = ukjent — tilbudet skal fortsatt hentes uten token.
  const sekvens = [undefined, null, null]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 1)
})

// ── Effekten må fortsatt fyre på EKTE sesjonsendring ───────────────────────
// Dette er halvparten som er lett å ødelegge når man demper en effekt: den
// slutter å kjøre når den skal.

test('innlogging fyrer effekten', () => {
  const sekvens = [undefined, null, førsteSkriver]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 2)
})

test('utlogging fyrer effekten', () => {
  const sekvens = [undefined, førsteSkriver, null]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 2)
})

test('bytte av bruker fyrer effekten', () => {
  // To ulike kontoer i samme fane. Tilbudet er per konto (has_used_trial), så
  // et manglende refetch her ville vist forrige brukers tilbud.
  const sekvens = [undefined, førsteSkriver, sesjon(annenBruker, 'token-x')]
  assert.equal(tellKall(sekvens, NY_DEP, NY_GUARD), 2)
})

// ── Binding til den faktiske kildekoden ────────────────────────────────────
// Simuleringen over er bare sann om siden faktisk bruker den formen. Uten
// denne delen kunne dep-en reverteres uten at noen test ble rød.

const SIDE = readFileSync('app/premium/page.tsx', 'utf8')

// Kommentarer fjernes FØR matching. Fila er tungt kommentert, og både
// `[session]` og `[sessionIdentity]` nevnes i prosa flere steder — uten
// strippen ville testene under målt kommentarer i stedet for kode.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const AKTIV = stripComments(SIDE)

test('kommentarstrippen virker (positiv kontroll)', () => {
  // Uten denne kunne en ødelagt strip gjort alle testene under grønne ved å
  // fjerne hele fila. To ankere: ett fra prosa som SKAL forsvinne, ett fra
  // kode som SKAL overleve.
  assert.ok(SIDE.includes('Dep-en er den STABILE identiteten'), 'ankerkommentaren finnes i fila')
  assert.ok(!AKTIV.includes('Dep-en er den STABILE identiteten'), 'kommentar ble strippet')
  assert.ok(AKTIV.includes('fetchTrialOffer('), 'kode overlevde strippen')
})

test('trial-offer-effekten har sessionIdentity som dep-liste', () => {
  assert.ok(
    /\}, \[sessionIdentity\]\)/.test(AKTIV),
    'fant ingen aktiv `}, [sessionIdentity])` — er dep-en reversert?',
  )
  assert.ok(
    /const sessionIdentity = getSessionIdentity\(session\)/.test(AKTIV),
    'sessionIdentity utledes ikke lenger av getSessionIdentity',
  )
})

test('ingen aktiv [session]-dep på trial-offer-effekten', () => {
  // `}, [session])` med session ALENE er den reverterte formen. Auto-
  // fortsettelsen lenger nede har `[session, trialOffer, runActivate]` og
  // treffes bevisst ikke av dette mønsteret — den beholder objektet med
  // vilje (se kommentaren over den effekten).
  assert.ok(
    !/\}, \[session\]\)/.test(AKTIV),
    'en aktiv `}, [session])` finnes — det er formen som gav to kall',
  )
})

test('auto-fortsettelsen står urørt med sin egen dep-liste', () => {
  // Sperren over skal ikke friste noen til å «rydde» denne også. Låsen er
  // pendingHandledRef, ikke dep-lista.
  assert.ok(
    /\}, \[session, trialOffer, runActivate\]\)/.test(AKTIV),
    'auto-fortsettelsens dep-liste er endret — den var bevisst uendret 12. august 2026',
  )
  assert.ok(
    /pendingHandledRef\.current = true/.test(AKTIV),
    'låsen som gjør duplikat-kjøringer harmløse er borte',
  )
})
