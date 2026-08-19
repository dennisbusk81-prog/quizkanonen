import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextQuizLabel, nextFridayLabel, upcomingQuizDate, formatQuizDate } from './next-quiz-label'

// Sonen PINNES til UTC. Uten dette kjører testene i maskinens egen sone, som
// for Dennis ER Europe/Oslo — og da ville en fjernet `timeZone: OSLO` gitt
// nøyaktig samme streng, altså et grønt mutasjonsbevis på en ekte feil.
// Node leser TZ på nytt når variabelen settes, og hver testfil kjører i sin
// egen prosess, så dette lekker ikke til resten av suiten.
process.env.TZ = 'UTC'

// ── HVA DISSE TESTENE MÅ FELLE ──────────────────────────────────────────────
// Mutasjonene som skal gi rødt (node scripts/mutate.mjs lib/next-quiz-label.ts):
//
//   1. Fjern fremtidsvakten:
//      "return d.getTime() > now.getTime() ? d : null" → "return d"
//      → «passert dato faller tilbake …» og «stale prod-verdien …» feiler.
//   2. Fjern tidssonen fra visningen:
//      "timeZone: OSLO," → ""  (i formatQuizDate)
//      → «formaterer i norsk tid, ikke nettleserens» feiler (kjøres med TZ=UTC).
//   3. Fjern tidssonen fra fallback-regnestykket:
//      "timeZone: OSLO, year:" → "year:"
//      → midnattstesten feiler.
//   4. Fjern kl.12-grensen på fredager:
//      "if (daysUntil === 0 && hour >= QUIZ_HOUR) daysUntil = 7" → ""
//      → «fredag etter 12 peker en uke fram» feiler.

// Testene kjøres med maskinens egen sone. For at «uten timeZone blir det feil»
// skal være observerbart, må de sammenlignes mot en referanse som IKKE er Oslo.
// Node leser TZ ved oppstart, så vi kan ikke bytte sone underveis — i stedet
// velges tidspunkter der Oslo og UTC ligger på hver sin kalenderdato.

test('framtidig dato vises som den er', () => {
  const now = new Date('2026-08-19T09:00:00.000Z')
  const label = nextQuizLabel('2026-08-21T10:00:00.000Z', now)
  assert.match(label, /fredag/)
  assert.match(label, /21\. august/)
  // 10:00 UTC = 12:00 i Oslo (sommertid).
  assert.match(label, /12[:.]00/)
})

test('passert dato faller tilbake på førstkommende fredag', () => {
  const now = new Date('2026-08-19T09:00:00.000Z') // onsdag
  const stale = '2026-08-14T10:00:00.000Z'          // forrige fredag
  assert.equal(nextQuizLabel(stale, now), nextFridayLabel(now))
  assert.equal(nextQuizLabel(stale, now), 'fredag 21. august kl. 12:00')
})

test('den faktiske prod-verdien er ufarlig i dag', () => {
  // Verdien som sto i site_settings.next_quiz_at 19. august 2026. Poenget med
  // hele endringen: uansett hvor gammel den blir, skal den aldri vises.
  const stale = '2026-08-14T10:00:00.000Z'
  for (const iso of ['2026-08-19T09:00:00.000Z', '2026-09-30T22:30:00.000Z', '2027-01-02T08:00:00.000Z']) {
    const now = new Date(iso)
    assert.equal(nextQuizLabel(stale, now), nextFridayLabel(now), iso)
  }
})

test('tom, ugyldig og passert verdi er samme utfall', () => {
  const now = new Date('2026-08-19T09:00:00.000Z')
  const fallback = nextFridayLabel(now)
  assert.equal(nextQuizLabel(null, now), fallback)
  assert.equal(nextQuizLabel(undefined, now), fallback)
  assert.equal(nextQuizLabel('', now), fallback)
  assert.equal(nextQuizLabel('ikke en dato', now), fallback)
  assert.equal(nextQuizLabel('2020-01-01T00:00:00.000Z', now), fallback)
  assert.equal(upcomingQuizDate('2020-01-01T00:00:00.000Z', now), null)
})

test('formaterer i norsk tid, ikke i UTC', () => {
  // 22:30 UTC 30. september = 00:30 Oslo 1. oktober. Faller timeZone bort,
  // leses instansen i UTC (testene kjører med TZ=UTC i CI) og datoen blir
  // 30. september — feil dato OG feil måned.
  const d = new Date('2026-09-30T22:30:00.000Z')
  const label = formatQuizDate(d)
  assert.match(label, /1\. oktober/, `fikk: ${label}`)
  assert.match(label, /torsdag/, `fikk: ${label}`)
  assert.doesNotMatch(label, /september/, `fikk: ${label}`)
})

test('midnatt norsk tid: fallbacken regner på Oslo-datoen, ikke UTC-datoen', () => {
  // Torsdag 20. august 22:30 UTC = fredag 21. august 00:30 i Oslo.
  // I Oslo er det altså allerede fredag, før kl. 12 → quizen er I DAG.
  // Regnes det i UTC, er det fortsatt torsdag, og svaret blir «i morgen» —
  // samme dato ved en tilfeldighet, men gjennom feil resonnement. Derfor
  // testes også søndagsvarianten under, der de to gir ULIK dato.
  assert.equal(
    nextFridayLabel(new Date('2026-08-20T22:30:00.000Z')),
    'fredag 21. august kl. 12:00',
  )
  // Torsdag 20. august 23:59 UTC = fredag 21. 01:59 Oslo, fortsatt før 12.
  assert.equal(
    nextFridayLabel(new Date('2026-08-20T23:59:00.000Z')),
    'fredag 21. august kl. 12:00',
  )
  // Fredag 21. august 22:30 UTC = lørdag 22. 00:30 Oslo → neste fredag 28.
  // Leses dette i UTC er det fredag etter 12 → også 28., men igjen via feil
  // resonnement; neste assert skiller dem.
  assert.equal(
    nextFridayLabel(new Date('2026-08-21T22:30:00.000Z')),
    'fredag 28. august kl. 12:00',
  )
})

test('midnatt: Oslo-datoen og UTC-datoen gir ULIK fredag', () => {
  // Torsdag 27. august 22:30 UTC = fredag 28. august 00:30 Oslo.
  // Oslo-regning → fredag 28. august (i dag). UTC-regning → også 28.
  // Vi trenger et tilfelle der dagen SKIFTER over en fredag-grense:
  // fredag 28. august 22:30 UTC = lørdag 29. 00:30 Oslo.
  //   Oslo: lørdag → 6 dager fram → fredag 4. september.
  //   UTC:  fredag 22:30, etter 12 → 7 dager fram → fredag 4. september.
  // Fortsatt likt. Det skillende tilfellet er timen mellom 22:00 og 24:00 UTC
  // på en TORSDAG kombinert med kl.12-grensen — se under.
  //
  // Torsdag 20. august 10:00 UTC = 12:00 Oslo, torsdag → fredag 21.
  assert.equal(nextFridayLabel(new Date('2026-08-20T10:00:00.000Z')), 'fredag 21. august kl. 12:00')
  // Fredag 21. august 09:00 UTC = 11:00 Oslo → før 12 → I DAG.
  assert.equal(nextFridayLabel(new Date('2026-08-21T09:00:00.000Z')), 'fredag 21. august kl. 12:00')
  // Fredag 21. august 10:30 UTC = 12:30 Oslo → etter 12 → neste uke.
  // Uten Oslo-sonen leses dette som 10:30, altså FØR 12, og svaret blir 21.
  assert.equal(nextFridayLabel(new Date('2026-08-21T10:30:00.000Z')), 'fredag 28. august kl. 12:00')
})

test('månedsskifte: fallbacken ruller over i riktig måned', () => {
  // Onsdag 30. september 2026 → fredag 2. oktober.
  assert.equal(nextFridayLabel(new Date('2026-09-30T09:00:00.000Z')), 'fredag 2. oktober kl. 12:00')
  // Onsdag 29. juli 2026 → fredag 31. juli (ingen overrulling).
  assert.equal(nextFridayLabel(new Date('2026-07-29T09:00:00.000Z')), 'fredag 31. juli kl. 12:00')
  // Lørdag 26. desember 2026 → fredag 1. januar 2027 (år ruller også).
  assert.equal(nextFridayLabel(new Date('2026-12-26T09:00:00.000Z')), 'fredag 1. januar kl. 12:00')
})

test('vintertid: fallbacken bommer ikke over sommertidsovergangen', () => {
  // Sommertiden i Norge slutter søndag 25. oktober 2026 kl. 03:00.
  // Onsdag 28. oktober 2026 (vintertid, UTC+1) → fredag 30. oktober.
  assert.equal(nextFridayLabel(new Date('2026-10-28T09:00:00.000Z')), 'fredag 30. oktober kl. 12:00')
  // Lørdag 24. oktober 23:30 UTC = søndag 25. 01:30 Oslo (fortsatt sommertid)
  // → førstkommende fredag er 30. oktober.
  assert.equal(nextFridayLabel(new Date('2026-10-24T23:30:00.000Z')), 'fredag 30. oktober kl. 12:00')
})
