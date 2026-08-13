import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideHero,
  decideRecords,
  pickBesteResultat,
  type Hero,
  type HeroInput,
  type RecordsInput,
} from './historikk-oversikt'

type SynligHero = Extract<Hero, { kind: 'rekke' | 'total' }>

/** Smalner Hero til den synlige varianten, så testene kan lese tall og tekst. */
function synlig(h: Hero): SynligHero {
  assert.notEqual(h.kind, 'empty', 'forventet en synlig hero, fikk tomtilstand')
  return h as SynligHero
}

const hero = (o: Partial<HeroInput>) =>
  decideHero({ totalAttempts: 0, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 0, ...o })

const records = (o: Partial<RecordsInput>) =>
  decideRecords({
    besteResultat: null,
    bestStreak: 0,
    lengsteDeltakelsesrekke: 0,
    totalAttempts: 0,
    heroViserRekke: false,
    ...o,
  })

// ── Hero: de åtte tilstandene, med prod-tallene fra 13. august 2026 ──────────

test('A3 — hele historikken ligger i den løpende rekken (14 spillere)', () => {
  // Kevin Lu m.fl.: 8 av 8 fredager, aldri stått over.
  const h = synlig(hero({ totalAttempts: 8, deltakelsesrekke: 8, lengsteDeltakelsesrekke: 8 }))
  assert.equal(h.kind, 'rekke')
  assert.equal(h.tall, 8)
  assert.equal(h.sub, 'Du har ikke stått over en eneste fredag siden du startet')
})

test('A1 — løpende rekke under rekorden (8 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 7, deltakelsesrekke: 3, lengsteDeltakelsesrekke: 4 }))
  assert.equal(h.kind, 'rekke')
  assert.equal(h.tall, 3)
  assert.equal(h.sub, '7 quizer til sammen · rekorden din er 4')
})

test('A2 — rekorden settes akkurat nå (18 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 7, deltakelsesrekke: 4, lengsteDeltakelsesrekke: 4 }))
  assert.equal(h.sub, '7 quizer til sammen · dette er rekorden din')
})

test('A1 med rekord lik totalen dropper «til sammen»-leddet', () => {
  // Ser uåpnelig ut, men vakten står og skal stå: uten den ville setningen
  // båret samme siffer to ganger med to ulike betydninger.
  const h = synlig(hero({ totalAttempts: 3, deltakelsesrekke: 2, lengsteDeltakelsesrekke: 3 }))
  assert.equal(h.sub, 'Rekorden din er 3')
})

test('B1 — første quiz, rekken er i gang (4 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 1, deltakelsesrekke: 1, lengsteDeltakelsesrekke: 1 }))
  assert.equal(h.kind, 'total')
  assert.equal(h.tall, 1)
  assert.equal(h.label, 'quiz spilt')
  assert.equal(h.sub, 'Du er i gang — spiller du neste fredag også, har du to på rad')
})

test('B2 — tilbake etter opphold (18 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 5, deltakelsesrekke: 1, lengsteDeltakelsesrekke: 2 }))
  assert.equal(h.kind, 'total')
  assert.equal(h.label, 'quizer spilt')
  assert.equal(h.sub, 'Du er i gang igjen — spiller du neste fredag også, har du to på rad')
})

test('B3 — brutt rekke, største gruppa (72 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 7, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 7 }))
  assert.equal(h.kind, 'total')
  assert.equal(h.tall, 7)
  assert.equal(h.sub, 'Spill neste fredagsquiz, så er du i gang igjen')
})

test('B4 — ett forsøk, ingen rekord (3 spillere)', () => {
  const h = synlig(hero({ totalAttempts: 1, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 0 }))
  assert.equal(h.sub, 'Velkommen — spill neste fredagsquiz, så starter rekken din')
})

test('B5 — flere forsøk, aldri en rekke (0 spillere i prod, grenen finnes)', () => {
  const h = synlig(hero({ totalAttempts: 3, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 0 }))
  assert.equal(h.sub, 'Spill neste fredagsquiz, så starter rekken din')
})

test('C — ingen forsøk gir tomtilstand', () => {
  assert.deepEqual(hero({ totalAttempts: 0 }), { kind: 'empty' })
})

// ── Hero: sannhetskravet per gren ────────────────────────────────────────────

test('en løpende rekke får ALDRI høre at rekken skal starte', () => {
  // Regel 1: teksten må være sann i enhver tilstand som utløser grenen.
  // «Så starter rekken din» til noen som står på 1 er direkte usant, og
  // gjaldt 22 av 137 spillere i prod.
  for (let total = 1; total <= 10; total++) {
    const h = synlig(hero({ totalAttempts: total, deltakelsesrekke: 1, lengsteDeltakelsesrekke: 1 }))
    assert.equal(h.sub.includes('starter rekken din'), false)
    assert.equal(h.sub.includes('starter en ny rekke'), false)
  }
})

test('en brutt rekke får ikke løfte om at en ny rekke starter', () => {
  const h = synlig(hero({ totalAttempts: 6, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 4 }))
  assert.equal(h.sub.includes('starter en ny rekke'), false)
})

test('ordet «kveld» står ikke i noen hero-tekst', () => {
  // 130 av 488 forsøk i prod ligger i lunsjtimen — «kveld» er feil ord.
  for (let total = 0; total <= 12; total++) {
    for (let rekke = 0; rekke <= total; rekke++) {
      for (let rekord = rekke; rekord <= total; rekord++) {
        const h = hero({
          totalAttempts: total,
          deltakelsesrekke: rekke,
          lengsteDeltakelsesrekke: rekord,
        })
        if (h.kind === 'empty') continue
        assert.equal(
          /kveld/i.test(h.sub) || /kveld/i.test(h.label),
          false,
          `kveld i tilstand total=${total} rekke=${rekke} rekord=${rekord}`,
        )
      }
    }
  }
})

test('labelen på totalen sier aldri «fredag» — populasjonen er ikke filtrert på det', () => {
  // total_attempts telles uten is_test/quiz_type-filter, i motsetning til
  // deltakelsesrekken. Første bonusquiz gjør «fredagsquizer» usant.
  for (const total of [1, 2, 7]) {
    const h = synlig(hero({ totalAttempts: total, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 0 }))
    assert.equal(/fredag/i.test(h.label), false)
  }
})

test('entall/flertall på totalen', () => {
  assert.equal(synlig(hero({ totalAttempts: 1 })).label, 'quiz spilt')
  assert.equal(
    synlig(hero({ totalAttempts: 2, deltakelsesrekke: 0, lengsteDeltakelsesrekke: 0 })).label,
    'quizer spilt',
  )
})

// ── Hero: regel 2 — samme siffer aldri to ganger ─────────────────────────────

test('ingen hero-tekst gjentar tallet heroen selv viser', () => {
  // Uttømmende over alle nåbare kombinasjoner. Dette er testen som feller
  // A3-grenen hvis noen fjerner den: uten den ville «8 quizer til sammen»
  // stått under et hero-tall på 8.
  for (let total = 1; total <= 12; total++) {
    for (let rekke = 0; rekke <= total; rekke++) {
      for (let rekord = rekke; rekord <= total; rekord++) {
        const h = hero({
          totalAttempts: total,
          deltakelsesrekke: rekke,
          lengsteDeltakelsesrekke: rekord,
        })
        if (h.kind === 'empty') continue
        const tallIsub: string[] = h.sub.match(/\d+/g) ?? []
        assert.equal(
          tallIsub.includes(String(h.tall)),
          false,
          `hero-tallet ${h.tall} gjentas i sub «${h.sub}» (total=${total} rekke=${rekke} rekord=${rekord})`,
        )
      }
    }
  }
})

test('sub-teksten gjentar heller ikke et tall inni seg selv', () => {
  for (let total = 1; total <= 12; total++) {
    for (let rekke = 0; rekke <= total; rekke++) {
      for (let rekord = rekke; rekord <= total; rekord++) {
        const h = hero({
          totalAttempts: total,
          deltakelsesrekke: rekke,
          lengsteDeltakelsesrekke: rekord,
        })
        if (h.kind === 'empty') continue
        const tall = h.sub.match(/\d+/g) ?? []
        assert.equal(new Set(tall).size, tall.length, `duplikat i «${h.sub}»`)
      }
    }
  }
})

// ── Hero: bufret svar fra en tidligere deploy ────────────────────────────────
// Samme feilklasse som lib/kategori-tall.ts fanger: /historikk bufrer hele
// API-svaret i sessionStorage, og et blob fra en eldre deploy mangler felt.
// `undefined` faller gjennom `>= 2` og `> 0` uten å kaste.

test('manglende felt i et bufret blob gir tomtilstand, ikke NaN', () => {
  const bufret = {} as HeroInput
  assert.deepEqual(decideHero(bufret), { kind: 'empty' })
})

test('total finnes, rekkefeltene mangler → total-hero uten NaN', () => {
  const bufret = { totalAttempts: 4 } as HeroInput
  const h = synlig(decideHero(bufret))
  assert.equal(h.kind, 'total')
  assert.equal(h.tall, 4)
  assert.equal(h.sub.includes('NaN'), false)
  assert.equal(h.sub.includes('undefined'), false)
})

// ── Rekorder-kortet ──────────────────────────────────────────────────────────

test('alle tre radene når heroen viser totalen', () => {
  const r = records({
    besteResultat: { riktige: 13, totalt: 15, tittel: 'Fredagsquiz 19.06.2026' },
    bestStreak: 6,
    lengsteDeltakelsesrekke: 5,
    totalAttempts: 7,
    heroViserRekke: false,
  })
  assert.deepEqual(r, [
    { label: 'Beste resultat', verdi: '13 av 15 · Fredagsquiz 19.06.2026' },
    { label: 'Lengste svar-rekke', verdi: '6 riktige på rad' },
    { label: 'Lengste deltakelsesrekke', verdi: '5 fredager på rad' },
  ])
})

test('deltakelsesrekord utelates når heroen alt viser rekken', () => {
  const r = records({
    besteResultat: { riktige: 11, totalt: 15, tittel: 'Fredagsquiz 24.07.2026' },
    bestStreak: 5,
    lengsteDeltakelsesrekke: 4,
    totalAttempts: 7,
    heroViserRekke: true,
  })
  assert.equal(r.length, 2)
  assert.equal(r.some((x) => x.label === 'Lengste deltakelsesrekke'), false)
})

test('deltakelsesrekord utelates når den er lik antall spilte quizer', () => {
  // 45 av de 72 B3-spillerne i prod. Heroen viser 4, og «4 fredager på rad»
  // ville vært samme siffer med en annen etikett.
  const r = records({
    bestStreak: 5,
    lengsteDeltakelsesrekke: 4,
    totalAttempts: 4,
    heroViserRekke: false,
  })
  assert.equal(r.some((x) => x.label === 'Lengste deltakelsesrekke'), false)
})

test('rekker på 1 er ikke rekker (59 spillere har deltakelsesrekord 1)', () => {
  const r = records({
    bestStreak: 1,
    lengsteDeltakelsesrekke: 1,
    totalAttempts: 3,
    heroViserRekke: false,
  })
  assert.deepEqual(r, [])
})

test('tomt kort for den som aldri leverte inn (3 spillere)', () => {
  // submitted_at NULL, 0 av 15, correct_streak 0.
  const r = records({
    besteResultat: { riktige: 0, totalt: 15, tittel: 'Fredagsquiz 19.06.2026' },
    bestStreak: 0,
    lengsteDeltakelsesrekke: 0,
    totalAttempts: 1,
    heroViserRekke: false,
  })
  assert.deepEqual(r, [])
})

test('beste resultat utelates når historikken ikke er komplett', () => {
  const r = records({
    besteResultat: null,
    bestStreak: 4,
    lengsteDeltakelsesrekke: 3,
    totalAttempts: 60,
    heroViserRekke: false,
  })
  assert.equal(r.some((x) => x.label === 'Beste resultat'), false)
  assert.equal(r.length, 2)
})

test('nevneren leses fra forsøket, ikke hardkodet til 15', () => {
  const r = records({
    besteResultat: { riktige: 9, totalt: 10, tittel: 'Bonusquiz' },
    bestStreak: 0,
    lengsteDeltakelsesrekke: 0,
    totalAttempts: 1,
    heroViserRekke: false,
  })
  assert.equal(r[0].verdi, '9 av 10 · Bonusquiz')
})

test('entall på svar-rekka kan ikke oppstå, men bøyes riktig om terskelen endres', () => {
  const r = records({ bestStreak: 2, lengsteDeltakelsesrekke: 0, totalAttempts: 3 })
  assert.equal(r[0].verdi, '2 riktige på rad')
})

test('ordet «kveld» står ikke i noen rad', () => {
  const r = records({
    besteResultat: { riktige: 13, totalt: 15, tittel: 'Fredagsquiz 19.06.2026' },
    bestStreak: 6,
    lengsteDeltakelsesrekke: 5,
    totalAttempts: 7,
    heroViserRekke: false,
  })
  for (const rad of r) {
    assert.equal(/kveld/i.test(rad.label) || /kveld/i.test(rad.verdi), false, rad.label)
  }
})

test('manglende felt i et bufret blob gir tomt kort, ikke NaN-rader', () => {
  const r = decideRecords({ besteResultat: null, heroViserRekke: false } as RecordsInput)
  assert.deepEqual(r, [])
})

// ── pickBesteResultat ────────────────────────────────────────────────────────

const kandidat = (riktige: number, dato: string, tittel = 'Quiz') => ({
  correct_answers: riktige,
  total_questions: 15,
  quiz_title: tittel,
  completed_at: dato,
})

test('velger det høyeste resultatet', () => {
  const r = pickBesteResultat([
    kandidat(8, '2026-08-07T18:00:00Z', 'A'),
    kandidat(13, '2026-06-19T18:00:00Z', 'B'),
    kandidat(11, '2026-07-24T18:00:00Z', 'C'),
  ])
  assert.deepEqual(r, { riktige: 13, totalt: 15, tittel: 'B' })
})

test('uavgjort brytes på nyeste (29 spillere har uavgjort i prod)', () => {
  const r = pickBesteResultat([
    kandidat(11, '2026-06-19T18:00:00Z', 'gammel'),
    kandidat(11, '2026-08-07T18:00:00Z', 'fersk'),
  ])
  assert.equal(r?.tittel, 'fersk')
})

test('uavgjort gir samme svar uansett hvilken rekkefølge lista kommer i', () => {
  // Uten et eksplisitt tie-break ville svaret fulgt sorteringen på inn-lista.
  const a = kandidat(11, '2026-06-19T18:00:00Z', 'gammel')
  const b = kandidat(11, '2026-08-07T18:00:00Z', 'fersk')
  assert.equal(pickBesteResultat([a, b])?.tittel, 'fersk')
  assert.equal(pickBesteResultat([b, a])?.tittel, 'fersk')
})

test('tom liste gir null', () => {
  assert.equal(pickBesteResultat([]), null)
})

test('0 riktige er et ekte resultat her — kortet filtrerer det, ikke plukkeren', () => {
  const r = pickBesteResultat([kandidat(0, '2026-06-19T18:00:00Z', 'A')])
  assert.deepEqual(r, { riktige: 0, totalt: 15, tittel: 'A' })
  // ... og decideRecords slipper den ikke gjennom:
  assert.deepEqual(
    records({ besteResultat: r, bestStreak: 0, lengsteDeltakelsesrekke: 0, totalAttempts: 1 }),
    [],
  )
})

test('rader uten tall hoppes over i stedet for å gi NaN', () => {
  const skadet = [
    { quiz_title: 'ødelagt', completed_at: '2026-08-07T18:00:00Z' },
    kandidat(7, '2026-06-19T18:00:00Z', 'ekte'),
  ] as Parameters<typeof pickBesteResultat>[0]
  assert.deepEqual(pickBesteResultat(skadet), { riktige: 7, totalt: 15, tittel: 'ekte' })
})
