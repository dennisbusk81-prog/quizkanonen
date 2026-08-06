// Kjøres med:  npm test
//
// Låser den ene invarianten profilsiden brøt: en FEILET henting og en TOM rad
// må gi to forskjellige utfall. Fram til 6. august 2026 ga de bit-identisk
// skjerm — ni felt fylt med `??`-fallbacks, `loadState = 'ready'`, ingen
// feilmelding — og brukeren fikk defaultverdier presentert som sine egne
// lagrede innstillinger.
//
// MUTASJONSBEVIS (verifisert manuelt — hver mutasjon er den naive koden):
//
//   * Fjern `if (res.error) return { ok: false }` i toLoadedRow, altså gå
//     tilbake til å lese kun `.data` slik `app/profil/page.tsx:257` gjorde:
//     → 5 tester feiler, blant dem «feilet henting og tom rad gir ULIKE
//       utfall» — de to kollapser da igjen til nøyaktig samme verdi, som er
//       hele buggen.
//
//   * La deriveProfileScreen returnere `{ state: 'error', fields: {...} }`
//     med defaultene også på feilgrenen (den «hjelpsomme» varianten):
//     → 3 av de 4 testene under «Strukturell sperre mot skrivestien» feiler.
//       Den fjerde («felter er utilgjengelige uten å ha sjekket state først»)
//       overlever med vilje: den speiler kallstedet, som gater på `state` og
//       derfor forblir trygt selv om nyttelasten skulle snike seg inn. De tre
//       andre vokter selve formen, så mutasjonen fanges uansett.
//
//   * Bytt `?? false` til `?? true` for emailReminders (tilstanden før 89c0b27):
//     → «email_reminders faller tilbake på AV» feiler.
//
//   * Bytt `??` til `||` i deriveProfileScreen:
//     → «lagret false forblir false» feiler — en bruker som HAR skrudd av
//       aktivitetspåminnelse ville fått den vist som på igjen.
//
//   * Erstatt withTimeout med `Promise.race([...]).catch(() => ({ data: null }))`:
//     → «timeout gir vet-ikke» feiler (den ga ok:true med tom rad).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toLoadedRow,
  toLoadedProfile,
  loadProfileRow,
  deriveProfileScreen,
  type ProfileRow,
  type ProfileScreen,
} from '@/lib/profile-load'
import type { TimerApi } from '@/lib/with-timeout'

// Samme manuelle timer-kontroll som lib/with-timeout.test.ts — ingen ventetid,
// og timeouten kan utløses presist.
function fakeTimers() {
  const pending = new Map<number, () => void>()
  let next = 1
  const timers: TimerApi = {
    setTimeout(fn) { const id = next++; pending.set(id, fn); return id },
    clearTimeout(handle) { pending.delete(handle as number) },
  }
  return { timers, fire() { for (const fn of [...pending.values()]) fn() } }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

// En ekte, fullt utfylt rad — verdiene er bevisst valgt til å være DET MOTSATTE
// av hver fallback, så en test som ved et uhell leser fallbacken ikke består.
const fullRow: ProfileRow = {
  display_name: 'Dennis Busk',
  nickname: 'Kanonen',
  member_number: 7,
  show_member_number: true,
  email_reminders: true,
  email_reengagement: false,
  email_duel_notifications: false,
  created_at: '2026-04-01T10:00:00.000Z',
  avatar_color: '#c9a84c',
}

// ── toLoadedRow: hva som er «vet» og hva som er «vet ikke» ───────────────────

test('rad funnet → bekreftet verdi', () => {
  const r = toLoadedProfile({ data: fullRow, error: null })
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, fullRow)
})

test('ingen rad (data null, error null) → bekreftet TOM, ikke feil', () => {
  // Dette er et ekte, kjent utfall: en innlogget bruker uten profilrad ennå.
  // Raden opprettes med kolonnenes DEFAULT ved første skriving, så defaultene
  // ER sannheten her.
  const r = toLoadedProfile({ data: null, error: null })
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.value, null)
})

test('spørringsfeil (RLS-avslag/500/nettverk) → vet ikke, ALDRI tom rad', () => {
  const r = toLoadedProfile({ data: null, error: { message: 'permission denied' } })
  assert.equal(r.ok, false)
})

test('feil OG data satt → feil vinner', () => {
  const r = toLoadedProfile({ data: fullRow, error: { message: 'delvis' } })
  assert.equal(r.ok, false)
})

test('toLoadedRow er generisk — samme sperre for ProfileProvider sitt display_name-oppslag', () => {
  type NameRow = { display_name: string | null }
  assert.equal(toLoadedRow<NameRow>({ data: null, error: { message: 'nede' } }).ok, false)

  const funnet = toLoadedRow<NameRow>({ data: { display_name: 'Dennis Busk' }, error: null })
  assert.equal(funnet.ok, true)
  assert.deepEqual(funnet.ok && funnet.value, { display_name: 'Dennis Busk' })

  const tom = toLoadedRow<NameRow>({ data: null, error: null })
  assert.equal(tom.ok, true)
  assert.equal(tom.ok && tom.value, null)
})

// ── Tidsgrensen ─────────────────────────────────────────────────────────────

test('svar innen fristen → bekreftet verdi', async () => {
  const t = fakeTimers()
  const r = await loadProfileRow(
    Promise.resolve({ data: fullRow, error: null }),
    { ms: 5000, timers: t.timers },
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, fullRow)
})

test('en thenable (supabase sin spørringsbygger) godtas som den er', async () => {
  // supabase-js returnerer ikke et ekte Promise, men et objekt med .then().
  // Uten Promise.resolve-innpakningen i loadProfileRow ville dette knekt både
  // i typene og i withTimeout sin Promise.race.
  const t = fakeTimers()
  const inner = Promise.resolve({ data: fullRow as unknown, error: null as unknown })
  // Et objekt som IKKE er en Promise-instans — det har kun .then, som er alt
  // supabase-byggeren tilbyr.
  const builder: PromiseLike<{ data: unknown; error: unknown }> = {
    then: (onFulfilled, onRejected) => inner.then(onFulfilled, onRejected),
  }
  assert.equal(builder instanceof Promise, false)
  const r = await loadProfileRow(builder, { ms: 5000, timers: t.timers })
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, fullRow)
})

test('timeout gir vet-ikke — ikke en tom rad med fallbacks', async () => {
  const t = fakeTimers()
  // Et oppslag som aldri settles: nøyaktig den situasjonen 5-sekunders-racet
  // fantes for.
  const aldri = new Promise<{ data: unknown; error: unknown }>(() => {})
  const p = loadProfileRow(aldri, { ms: 5000, timers: t.timers })
  t.fire()
  assert.equal((await p).ok, false)
})

test('sent svar ETTER timeout endrer ikke utfallet', async () => {
  const t = fakeTimers()
  let settle: (v: { data: unknown; error: unknown }) => void = () => {}
  const sen = new Promise<{ data: unknown; error: unknown }>(res => { settle = res })
  const p = loadProfileRow(sen, { ms: 5000, timers: t.timers })
  t.fire()
  settle({ data: fullRow, error: null })
  await flush()
  assert.equal((await p).ok, false)
})

test('oppslaget rejecter → vet ikke, ingen uhåndtert rejection', async () => {
  const t = fakeTimers()
  const r = await loadProfileRow(
    Promise.reject(new Error('offline')),
    { ms: 5000, timers: t.timers },
  )
  assert.equal(r.ok, false)
})

test('timeout kaller onTimeout (abort-kroken) — og bare da', async () => {
  const t1 = fakeTimers()
  let abortedVedTimeout = 0
  const p = loadProfileRow(new Promise<never>(() => {}), {
    ms: 5000, timers: t1.timers, onTimeout: () => { abortedVedTimeout++ },
  })
  t1.fire()
  await p
  assert.equal(abortedVedTimeout, 1)

  const t2 = fakeTimers()
  let abortedVedSvar = 0
  await loadProfileRow(Promise.resolve({ data: fullRow, error: null }), {
    ms: 5000, timers: t2.timers, onTimeout: () => { abortedVedSvar++ },
  })
  assert.equal(abortedVedSvar, 0)
})

// ── Kjernen: de to utfallene som var identiske ──────────────────────────────

test('feilet henting og tom rad gir ULIKE utfall (de var bit-identiske før)', () => {
  const feilet = deriveProfileScreen(toLoadedProfile({ data: null, error: { message: 'timeout' } }))
  const tom    = deriveProfileScreen(toLoadedProfile({ data: null, error: null }))

  assert.notDeepEqual(feilet, tom)
  assert.equal(feilet.state, 'error')
  assert.equal(tom.state, 'ready')
})

// ── Strukturell sperre mot skrivestien ──────────────────────────────────────
//
// Skrivestien på profilsiden (savePref, handleSaveNickname,
// handleToggleShowMember) sender de samme verdiene tilbake til serveren. Kravet
// er at en feilet henting ikke bare i praksis, men STRUKTURELT, ikke kan
// produsere dem — altså ikke via tilfeldige gates som `memberNumber !== null`
// eller en disabled Lagre-knapp.

// Alle måtene en henting kan mislykkes på.
const alleFeilinnganger: { navn: string; res: { data: unknown; error: unknown } }[] = [
  { navn: 'spørringsfeil',   res: { data: null, error: { message: 'permission denied' } } },
  { navn: 'feil med data',   res: { data: fullRow, error: { message: 'delvis' } } },
  { navn: 'error som streng', res: { data: null, error: 'boom' } },
]

test('ingen feilinngang gir felter å skrive tilbake', () => {
  for (const { navn, res } of alleFeilinnganger) {
    const screen = deriveProfileScreen(toLoadedProfile(res))
    assert.equal(screen.state, 'error', navn)
    // Selve sperren: feilgrenen har ingen `fields` i det hele tatt. Det finnes
    // ikke et sett fallback-verdier å plukke opp «ved et uhell».
    assert.equal('fields' in screen, false, navn)
  }
})

test('timeout gir heller ingen felter', async () => {
  const t = fakeTimers()
  const p = loadProfileRow(new Promise<never>(() => {}), { ms: 5000, timers: t.timers })
  t.fire()
  const screen = deriveProfileScreen(await p)
  assert.equal(screen.state, 'error')
  assert.equal('fields' in screen, false)
})

test('feilgrenen har KUN state — ingen skjult nyttelast', () => {
  const screen = deriveProfileScreen({ ok: false })
  assert.deepEqual(Object.keys(screen), ['state'])
})

test('felter er utilgjengelige uten å ha sjekket state først', () => {
  // Speiler nøyaktig det profilsiden gjør: den ENESTE veien fra et hentet
  // resultat til en state-setter går gjennom denne grenen. Feiler hentingen,
  // kjører ikke kroppen, og ingen setter blir kalt.
  const skrevet: string[] = []
  function anvend(screen: ProfileScreen) {
    if (screen.state !== 'ready') return
    for (const [k, v] of Object.entries(screen.fields)) skrevet.push(`${k}=${String(v)}`)
  }

  anvend(deriveProfileScreen({ ok: false }))
  assert.deepEqual(skrevet, [], 'en feilet henting skal ikke skrive ett eneste felt')

  anvend(deriveProfileScreen({ ok: true, value: fullRow }))
  assert.equal(skrevet.length, 8, 'en bekreftet henting skriver alle åtte feltene')
})

// ── Fallbackene, der de fortsatt gjelder ────────────────────────────────────

test('bekreftet rad: alle verdier kommer fra raden, ingen fallback slår inn', () => {
  const screen = deriveProfileScreen({ ok: true, value: fullRow })
  assert.equal(screen.state, 'ready')
  assert.deepEqual(screen.state === 'ready' && screen.fields, {
    displayName: 'Dennis Busk',
    nickname: 'Kanonen',
    avatarColor: '#c9a84c',
    showMemberNumber: true,
    emailReminders: true,
    emailReengagement: false,
    emailDuelNotifications: false,
    createdAt: '2026-04-01T10:00:00.000Z',
  })
})

test('lagret false forblir false — fallbacken gjelder kun NULL', () => {
  // Feller en `||`-implementasjon: `false || true` ville vist
  // aktivitetspåminnelse som PÅ for en bruker som har skrudd den AV.
  const screen = deriveProfileScreen({
    ok: true,
    value: { ...fullRow, email_reengagement: false, email_duel_notifications: false, show_member_number: false },
  })
  assert.equal(screen.state === 'ready' && screen.fields.emailReengagement, false)
  assert.equal(screen.state === 'ready' && screen.fields.emailDuelNotifications, false)
  assert.equal(screen.state === 'ready' && screen.fields.showMemberNumber, false)
})

test('email_reminders faller tilbake på AV (opt-in, jf. 89c0b27)', () => {
  // profiles.email_reminders er NOT NULL DEFAULT false, og send-reminders-cronen
  // henter kun på `= true`. En fallback på true ville fått bryteren til å påstå
  // det motsatte av det cronen gjør.
  const tomRad = deriveProfileScreen({ ok: true, value: null })
  assert.equal(tomRad.state === 'ready' && tomRad.fields.emailReminders, false)

  const nullFelt = deriveProfileScreen({ ok: true, value: { ...fullRow, email_reminders: null } })
  assert.equal(nullFelt.state === 'ready' && nullFelt.fields.emailReminders, false)
})

test('email_reengagement og duel faller tilbake på PÅ (opt-out, motsatt semantikk)', () => {
  const tomRad = deriveProfileScreen({ ok: true, value: null })
  assert.equal(tomRad.state === 'ready' && tomRad.fields.emailReengagement, true)
  assert.equal(tomRad.state === 'ready' && tomRad.fields.emailDuelNotifications, true)
})

test('tom rad: navn og kallenavn er tomme, men det er en BEKREFTET tomhet', () => {
  const screen = deriveProfileScreen({ ok: true, value: null })
  assert.equal(screen.state, 'ready')
  assert.equal(screen.state === 'ready' && screen.fields.displayName, '')
  assert.equal(screen.state === 'ready' && screen.fields.nickname, '')
  assert.equal(screen.state === 'ready' && screen.fields.createdAt, null)
})
