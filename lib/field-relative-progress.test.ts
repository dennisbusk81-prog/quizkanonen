import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeFieldProgress,
  averageCorrectByQuiz,
  NEUTRAL_BAND,
  type FieldEntry,
} from './field-relative-progress'

const NOW = new Date('2026-08-13T12:00:00Z').getTime()
const DAG = 24 * 60 * 60 * 1000

/** Forsøk for `dagerSiden` dager siden, med gitt diff mot feltet. */
const e = (dagerSiden: number, diff: number, felt = 9): FieldEntry => ({
  correct: felt + diff,
  fieldAvgCorrect: felt,
  completedAt: new Date(NOW - dagerSiden * DAG).toISOString(),
})

const prog = (entries: FieldEntry[]) => computeFieldProgress(entries, NOW)

// ── Under to forsøk: ingen tekst, kortet skjules ────────────────────────────

test('ingen forsøk gir null', () => {
  assert.equal(prog([]), null)
})

test('ett forsøk gir null — heroen bærer oppfordringen, ikke et tomt kort', () => {
  // 36 av 137 spillere i prod. Det gamle «God start!»-kortet sto her.
  assert.equal(prog([e(3, 2)]), null)
})

// ── 2–3 forsøk: telling, ikke trend (41 spillere) ───────────────────────────

test('to av to over feltet', () => {
  assert.deepEqual(prog([e(10, 1), e(3, 2)]), {
    tekst: 'Du har truffet over feltets snitt begge gangene',
    variant: 'positive',
  })
})

test('tre av tre over feltet', () => {
  assert.deepEqual(prog([e(20, 1), e(10, 2), e(3, 1)]), {
    tekst: 'Du har truffet over feltets snitt alle 3 gangene',
    variant: 'positive',
  })
})

test('to av tre over feltet', () => {
  assert.deepEqual(prog([e(20, 1), e(10, -2), e(3, 1)]), {
    tekst: 'Du har truffet over feltets snitt 2 av 3 ganger',
    variant: 'neutral',
  })
})

test('null av to — nøytral, ikke rød dom over to forsøk (8 spillere)', () => {
  assert.deepEqual(prog([e(10, -1), e(3, -2)]), {
    tekst: 'Du har ikke truffet over feltets snitt ennå',
    variant: 'neutral',
  })
})

test('nøyaktig på feltets snitt teller ikke som over', () => {
  // d === 0 er ikke «over». Grensen må være streng, ellers ville teksten
  // påstått en forskjell som ikke finnes.
  assert.deepEqual(prog([e(10, 0), e(3, 0)]), {
    tekst: 'Du har ikke truffet over feltets snitt ennå',
    variant: 'neutral',
  })
})

test('«begge gangene» ved to, «alle N gangene» ved tre', () => {
  assert.match(prog([e(10, 1), e(3, 1)])!.tekst, /begge gangene$/)
  assert.match(prog([e(20, 1), e(10, 1), e(3, 1)])!.tekst, /alle 3 gangene$/)
})

// ── 4+ forsøk, begge perioder har data (59 spillere) ────────────────────────

test('over nå, under før — ekte tall fra Emil Moen i prod', () => {
  const r = prog([e(40, -0.9), e(35, -0.9), e(10, 0.6), e(3, 0.6)])
  assert.deepEqual(r, {
    tekst: 'Siste 4 uker: 0,6 riktige svar over feltets snitt per quiz — før lå du 0,9 under',
    variant: 'positive',
  })
})

test('under nå, tydelig over før', () => {
  const r = prog([e(40, 1.2), e(35, 1.4), e(10, -1.8), e(3, -1.8)])
  assert.equal(
    r?.tekst,
    'Siste 4 uker: 1,8 riktige svar under feltets snitt per quiz — før lå du 1,3 over',
  )
  assert.equal(r?.variant, 'negative')
})

test('dag harald Næss i prod: P=0,34 ligger INNE i båndet', () => {
  // Ekte tall. Den forrige perioden hans lå 0,34 over feltet, altså i praksis
  // på linje. Teksten skal da IKKE trykke «0,3 over» — et tall så nær null
  // leses som en påstand om en forskjell som ikke finnes. Denne testen er her
  // fordi jeg først skrev forventningen feil selv.
  const r = prog([e(40, 0.3), e(35, 0.4), e(10, -1.8), e(3, -1.8)])
  assert.equal(
    r?.tekst,
    'Siste 4 uker: 1,8 riktige svar under feltets snitt per quiz — før lå du på linje med feltet',
  )
  assert.equal(r?.variant, 'negative')
})

test('under begge perioder, men mindre under nå → positiv utvikling', () => {
  // Line Sundli: R=-0,9 P=-2,0. Teksten er ærlig om nivået, fargen om
  // retningen.
  const r = prog([e(40, -2), e(35, -2), e(10, -0.9), e(3, -0.9)])
  assert.equal(
    r?.tekst,
    'Siste 4 uker: 0,9 riktige svar under feltets snitt per quiz — før lå du 2,0 under',
  )
  assert.equal(r?.variant, 'positive')
})

// ── Fargen skal ALDRI motsi setningen ───────────────────────────────────────
// Funnet ved å kjøre den ekte lib-koden mot prod: Håkon Lorentsen lå 1,6 over
// feltet nå mot 2,1 før, og fikk en RØD ramme rundt setningen «1,6 riktige
// svar OVER feltets snitt». Rødt påstår at noe er galt; det gjorde det ikke.

test('nedgang mens man fortsatt ligger over feltet er ikke rødt', () => {
  const r = prog([e(40, 3), e(35, 3), e(10, 1.5), e(3, 1.5)])
  assert.match(r!.tekst, /^Siste 4 uker: 1,5 riktige svar over/)
  assert.notEqual(r?.variant, 'negative')
})

test('Håkon Lorentsen i prod: 1,6 over nå mot 2,1 før → ikke rødt', () => {
  const r = prog([e(40, 2.1), e(35, 2.1), e(10, 1.6), e(3, 1.6)])
  assert.match(r!.tekst, /1,6 riktige svar over feltets snitt/)
  assert.notEqual(r?.variant, 'negative')
})

test('nedgang TIL under feltet er rødt', () => {
  const r = prog([e(40, 0.1), e(35, 0.1), e(10, -2.4), e(3, -2.4)])
  assert.equal(r?.variant, 'negative')
  assert.match(r!.tekst, /2,4 riktige svar under feltets snitt/)
})

test('nedgang til akkurat innenfor båndet er ikke rødt', () => {
  // Teksten sier «rundt feltets snitt». Rødt ville motsagt den.
  const r = prog([e(40, 2), e(35, 2), e(10, -0.3), e(3, -0.3)])
  assert.match(r!.tekst, /rundt feltets snitt/)
  assert.notEqual(r?.variant, 'negative')
})

test('framgang er grønt på ethvert nivå — grønt kan ikke motsi teksten', () => {
  // Fortsatt under feltet, men kraftig framgang. Sven Vidar Stenhammer i prod
  // gikk fra 4,2 under til rundt snittet.
  const r = prog([e(40, -4.2), e(35, -4.2), e(10, -0.3), e(3, -0.3)])
  assert.equal(r?.variant, 'positive')
})

test('ingen rød tekst inneholder ordet «over» om egen plassering', () => {
  // Uttømmende: en rød ramme skal aldri stå rundt en setning som sier at
  // spilleren ligger over feltet.
  for (const gammel of [-4, -2, -0.4, 0, 0.4, 2, 4]) {
    for (const ny of [-4, -2, -0.4, 0, 0.4, 2, 4]) {
      const r = prog([e(40, gammel), e(35, gammel), e(10, ny), e(3, ny)])
      if (r?.variant !== 'negative') continue
      assert.equal(
        /riktige svar over feltets snitt/.test(r.tekst),
        false,
        `rød ramme rundt «over»-setning: ${r.tekst}`,
      )
    }
  }
})

// ── Nøytralbåndet, alle fire kombinasjoner ──────────────────────────────────

test('begge perioder i båndet → «stabilt», og ALLTID nøytral farge', () => {
  // Kritisk: R=0,49 og P=-0,49 gir en endring på 0,98, som ellers ville
  // farget kortet grønt under ordet «stabilt».
  const r = prog([e(40, -0.49), e(35, -0.49), e(10, 0.49), e(3, 0.49)])
  assert.deepEqual(r, { tekst: 'Du ligger stabilt rundt feltets snitt', variant: 'neutral' })
})

test('siste periode i båndet → «rundt feltets snitt», forrige oppgis med tall', () => {
  const r = prog([e(40, -2), e(35, -2), e(10, 0.2), e(3, 0.2)])
  assert.deepEqual(r, {
    tekst: 'Siste 4 uker ligger du rundt feltets snitt — før lå du 2,0 riktige svar under',
    variant: 'positive',
  })
})

test('forrige periode i båndet → «på linje med feltet»', () => {
  const r = prog([e(40, 0.1), e(35, 0.1), e(10, 1.7), e(3, 1.7)])
  assert.deepEqual(r, {
    tekst:
      'Siste 4 uker: 1,7 riktige svar over feltets snitt per quiz — før lå du på linje med feltet',
    variant: 'positive',
  })
})

test('ingen tekst trykker et tall under båndet på leseren', () => {
  // Alle verdier under 0,5 skal beskrives med ord, ikke med «0,2 over».
  for (let v = -0.4; v <= 0.4; v += 0.1) {
    const r = prog([e(40, v), e(35, v), e(10, v), e(3, v)])
    assert.equal(/0,[0-4] riktige/.test(r!.tekst), false, `lekket tall for v=${v}: ${r!.tekst}`)
  }
})

// ── Fallback: bare én periode har data (1 spiller i prod) ───────────────────

test('alle forsøk i siste periode → nivå uten sammenligning', () => {
  const r = prog([e(20, -1.6), e(15, -1.6), e(10, -1.6), e(3, -1.6)])
  assert.deepEqual(r, {
    tekst: 'Du ligger i snitt 1,6 riktige svar under feltets snitt',
    variant: 'neutral',
  })
})

test('alle forsøk i siste periode og på linje med feltet', () => {
  const r = prog([e(20, 0.1), e(15, 0.1), e(10, 0.1), e(3, 0.1)])
  assert.deepEqual(r, { tekst: 'Du ligger stabilt rundt feltets snitt', variant: 'neutral' })
})

test('alle forsøk eldre enn åtte uker → fallback, ikke krasj', () => {
  const r = prog([e(200, 1.2), e(190, 1.2), e(180, 1.2), e(170, 1.2)])
  assert.equal(r?.variant, 'neutral')
  assert.match(r!.tekst, /^Du ligger i snitt 1,2 riktige svar over/)
})

test('fallback melder aldri en utvikling — ingen endring er målt', () => {
  for (const v of [-3, -1, 0, 1, 3]) {
    const r = prog([e(20, v), e(15, v), e(10, v), e(3, v)])
    assert.equal(r?.variant, 'neutral', `v=${v} fikk farge uten at endring er målt`)
  }
})

// ── Sannhets- og formkrav på tvers av alle grener ───────────────────────────

const alleTekster = (): string[] => {
  const ut: string[] = []
  for (const n of [2, 3, 4, 6]) {
    for (const gammel of [-3, -2, -0.4, 0, 0.4, 2, 3]) {
      for (const ny of [-3, -2, -0.4, 0, 0.4, 2, 3]) {
        const entries: FieldEntry[] = []
        for (let i = 0; i < n; i++) {
          entries.push(i < n / 2 ? e(40 - i, gammel) : e(10 - i, ny))
        }
        const r = computeFieldProgress(entries, NOW)
        if (r) ut.push(r.tekst)
      }
    }
  }
  return ut
}

test('ordet «kveld» står ikke i noen progresjonstekst', () => {
  for (const t of alleTekster()) {
    assert.equal(/kveld/i.test(t), false, `kveld i: ${t}`)
  }
})

test('ordet «poeng» brukes ikke — det er opptatt av sesongpoeng', () => {
  for (const t of alleTekster()) {
    assert.equal(/poeng/i.test(t), false, `poeng i: ${t}`)
  }
})

test('ingen tekst inneholder prosent — enheten er riktige svar', () => {
  for (const t of alleTekster()) {
    assert.equal(t.includes('%'), false, `prosent i: ${t}`)
    assert.equal(/prosentpoeng/i.test(t), false, `prosentpoeng i: ${t}`)
  }
})

test('ingen tekst inneholder NaN, undefined eller punktum-desimal', () => {
  for (const t of alleTekster()) {
    assert.equal(/NaN|undefined/.test(t), false, `ødelagt tall i: ${t}`)
    assert.equal(/\d\.\d/.test(t), false, `punktum-desimal i: ${t}`)
  }
})

test('teksten står aldri med negativt fortegn — retningen sies med ord', () => {
  for (const t of alleTekster()) {
    assert.equal(/-\d/.test(t), false, `minustegn i: ${t}`)
  }
})

// ── Robusthet mot bufrede og skadde svar ────────────────────────────────────

test('rader uten tall hoppes over i stedet for å gi NaN', () => {
  const skadet = [
    { completedAt: new Date(NOW - 10 * DAG).toISOString() },
    e(20, 1),
    e(3, 1),
  ] as FieldEntry[]
  const r = computeFieldProgress(skadet, NOW)
  assert.equal(r?.tekst.includes('NaN'), false)
  assert.deepEqual(r, {
    tekst: 'Du har truffet over feltets snitt begge gangene',
    variant: 'positive',
  })
})

test('for få gyldige rader etter filtrering gir null', () => {
  const skadet = [{ completedAt: 'x' }, e(3, 1)] as FieldEntry[]
  assert.equal(computeFieldProgress(skadet, NOW), null)
})

test('båndet er eksportert og brukes som terskel', () => {
  assert.equal(NEUTRAL_BAND, 0.5)
  // Rett under båndet → ord. Rett over → tall.
  const under = prog([e(40, 0), e(35, 0), e(10, 0.49), e(3, 0.49)])
  assert.match(under!.tekst, /rundt feltets snitt|stabilt/)
  const over = prog([e(40, 0), e(35, 0), e(10, 0.6), e(3, 0.6)])
  assert.match(over!.tekst, /0,6 riktige svar over/)
})

// ── averageCorrectByQuiz ────────────────────────────────────────────────────

test('snitt per quiz, spilleren selv inkludert', () => {
  const r = averageCorrectByQuiz([
    { quiz_id: 'a', correct_answers: 10 },
    { quiz_id: 'a', correct_answers: 8 },
    { quiz_id: 'b', correct_answers: 3 },
  ])
  assert.deepEqual(r, { a: 9, b: 3 })
})

test('snittet avrundes ikke — grafen og teksten skal dele nøyaktig samme tall', () => {
  const r = averageCorrectByQuiz([
    { quiz_id: 'a', correct_answers: 10 },
    { quiz_id: 'a', correct_answers: 9 },
    { quiz_id: 'a', correct_answers: 9 },
  ])
  assert.equal(r.a, 28 / 3)
})

test('tom liste gir tomt objekt, ikke krasj', () => {
  assert.deepEqual(averageCorrectByQuiz([]), {})
})

test('rader uten tall hoppes over', () => {
  const r = averageCorrectByQuiz([
    { quiz_id: 'a', correct_answers: 10 },
    { quiz_id: 'a' } as { quiz_id: string; correct_answers: number },
  ])
  assert.equal(r.a, 10)
})

test('0 riktige er et ekte tall og trekker snittet ned', () => {
  const r = averageCorrectByQuiz([
    { quiz_id: 'a', correct_answers: 10 },
    { quiz_id: 'a', correct_answers: 0 },
  ])
  assert.equal(r.a, 5)
})

test('prod-tallene reproduseres — 17. juli var feltets snitt 6,43 av 15', () => {
  // Den uka dagens tekst ville kalt «du ble dårligere». Snittet er lavere enn
  // alle andre uker med nesten fire riktige svar.
  const rader = [
    ...Array(20).fill({ quiz_id: 'q', correct_answers: 6 }),
    ...Array(20).fill({ quiz_id: 'q', correct_answers: 7 }),
  ]
  assert.equal(averageCorrectByQuiz(rader).q, 6.5)
})
