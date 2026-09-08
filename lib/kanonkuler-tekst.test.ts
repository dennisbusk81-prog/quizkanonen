// Kjøres med:  npm test
//
// Tekst-tilstandene på kanonkule-kortet, skrevet ut som tabell. «Teksten må
// være sann i hver tilstand som utløser den» (QK_3) — så hver tilstand står
// her med den eksakte strengen, ikke bare et regex-treff.
//
// MUTASJONSBEVIS (8. september 2026):
//   • `n === 1` → `n === 0` i kanonkuleOrd        → «1 kanonkule igjen»-testene + sveipet røde
//   • `remaining >= GENERATION_QUOTA.premium` → `> 0` (tildeling for alle) → «premium 29 → igjen»-testen rød
//   • premium-«igjen» → `${remaining} kanonkuler igjen` → «premium 8»-testen rød (ordlyden er Dennis')
//   • `plan === 'free' ? upsell : null` → alltid upsell → «premium tom → INGEN oppsalg»-testen rød
//   • `remaining <= 0` → `< 0`                    → «0 igjen er tom»-testene røde
//   • fjern `Math.max(0, …)` i kanonkulerRemaining → «senket kvote»-testen rød
//   • `Teknologi` fjernet fra GENERATOR_HIDDEN_CATEGORIES → tolv-testen rød
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GENERATION_QUOTA,
  GENERATOR_HIDDEN_CATEGORIES,
  generatorCategoryOptions,
} from '@/lib/generated-quiz-rules'
import { QUIZ_CATEGORIES } from '@/lib/quiz-categories'
import {
  KANONKULER_FREE_CONFIRM_TEXT,
  kanonkuleOrd,
  kanonkulerRemaining,
  kanonkulerStatus,
} from '@/lib/kanonkuler-tekst'

const LABEL = '1. oktober'
const status = (plan: 'free' | 'premium', remaining: number) =>
  kanonkulerStatus({ plan, remaining, nextMonthLabel: LABEL })

// ── Tabellen: hver tilstand, eksakt tekst ───────────────────────────────────

test('gratis 2 igjen → «2 kanonkuler igjen» (forbruk)', () => {
  assert.deepEqual(status('free', 2), { kind: 'igjen', text: '2 kanonkuler igjen' })
})

test('gratis 1 igjen → «1 kanonkule igjen» — ENTALL', () => {
  assert.deepEqual(status('free', 1), { kind: 'igjen', text: '1 kanonkule igjen' })
})

test('gratis 0 igjen → tom, «Neste kanonkule 1. oktober», MED oppsalg', () => {
  assert.deepEqual(status('free', 0), {
    kind: 'tom',
    text: 'Neste kanonkule 1. oktober',
    upsell: 'Få 30 med Premium og velg kategori',
  })
})

test('premium 30 igjen (ingen brukt) → «30 kanonkuler denne måneden» — tildelingen er hel', () => {
  assert.equal(GENERATION_QUOTA.premium, 30)
  assert.deepEqual(status('premium', 30), { kind: 'tildeling', text: '30 kanonkuler denne måneden' })
})

test('premium 29 igjen (én brukt) → «29 igjen denne måneden» — tildelingspåstanden står bare så lenge den er hel', () => {
  assert.deepEqual(status('premium', 29), { kind: 'igjen', text: '29 igjen denne måneden' })
})

test('premium 25 igjen → «25 igjen denne måneden», ALDRI «25 kanonkuler denne måneden»', () => {
  assert.deepEqual(status('premium', 25), { kind: 'igjen', text: '25 igjen denne måneden' })
})

test('premium 8 igjen → «8 igjen denne måneden»', () => {
  assert.deepEqual(status('premium', 8), { kind: 'igjen', text: '8 igjen denne måneden' })
})

test('premium 1 igjen → «1 igjen denne måneden» (ingen substantiv å bøye)', () => {
  assert.deepEqual(status('premium', 1), { kind: 'igjen', text: '1 igjen denne måneden' })
})

test('premium 0 igjen → tom, INGEN oppsalg (hun har allerede Premium)', () => {
  assert.deepEqual(status('premium', 0), {
    kind: 'tom',
    text: 'Neste kanonkule 1. oktober',
    upsell: null,
  })
})

test('negativt (kvoten senket etter forbruk) → tom, ikke «-3 kanonkuler igjen»', () => {
  assert.equal(status('free', -3).kind, 'tom')
  assert.equal(status('premium', -3).kind, 'tom')
})

test('etiketten går rett inn — «1. januar» i desember', () => {
  const s = kanonkulerStatus({ plan: 'free', remaining: 0, nextMonthLabel: '1. januar' })
  assert.equal(s.text, 'Neste kanonkule 1. januar')
})

// ── Sveip: entall/flertall stemmer for HVERT tall, begge planer ─────────────

test('sveip 0..30, begge planer: aldri «1 kanonkuler», aldri «N kanonkule» for N≠1', () => {
  for (const plan of ['free', 'premium'] as const) {
    for (let n = 0; n <= GENERATION_QUOTA.premium; n++) {
      const s = status(plan, n)
      assert.doesNotMatch(s.text, /\b1 kanonkuler\b/, `${plan} ${n}: «1 kanonkuler»`)
      assert.doesNotMatch(s.text, /\b(?!1\b)\d+ kanonkule\b/, `${plan} ${n}: flertall uten -r`)
      if (n === 0) assert.equal(s.kind, 'tom', `${plan} 0 skal være tom`)
      else assert.match(s.text, new RegExp(`^${n} `), `${plan} ${n}: tallet mangler`)
    }
  }
})

test('sveip premium 1..29: «N igjen denne måneden» — tildelingspåstanden finnes KUN ved hel kvote', () => {
  for (let n = 1; n < GENERATION_QUOTA.premium; n++) {
    const s = status('premium', n)
    assert.equal(s.kind, 'igjen', `premium ${n}`)
    assert.equal(s.text, `${n} igjen denne måneden`)
    assert.doesNotMatch(s.text, /kanonkuler denne måneden/, `premium ${n}: leser som en tildeling på ${n}`)
  }
})

test('sveip: premium ser aldri ordet Premium (ingen oppsalg til en som har det)', () => {
  for (let n = 0; n <= GENERATION_QUOTA.premium; n++) {
    const s = status('premium', n)
    assert.doesNotMatch(s.text, /Premium/)
    if (s.kind === 'tom') assert.equal(s.upsell, null)
  }
})

test('sveip: gratis ser oppsalg KUN når tom — «igjen»-linja selger ikke', () => {
  for (let n = 1; n <= GENERATION_QUOTA.free; n++) {
    assert.doesNotMatch(status('free', n).text, /Premium/)
  }
})

// ── Beholdningen ────────────────────────────────────────────────────────────

test('kanonkulerRemaining: kvote minus brukt, klemt til 0', () => {
  assert.equal(kanonkulerRemaining('free', 0), 2)
  assert.equal(kanonkulerRemaining('free', 1), 1)
  assert.equal(kanonkulerRemaining('free', 2), 0)
  assert.equal(kanonkulerRemaining('free', 5), 0, 'senket kvote skal gi 0, ikke -3')
  assert.equal(kanonkulerRemaining('premium', 12), 18)
})

test('kanonkuleOrd: kun 1 er entall', () => {
  assert.equal(kanonkuleOrd(1), 'kanonkule')
  assert.equal(kanonkuleOrd(0), 'kanonkuler')
  assert.equal(kanonkuleOrd(2), 'kanonkuler')
})

// ── Bekreftelsessteget binder ordet «to» til kvoten ─────────────────────────

test('«én av to» er sant kun så lenge gratis-kvoten er 2 — endres kvoten, må teksten endres', () => {
  assert.equal(KANONKULER_FREE_CONFIRM_TEXT, 'Dette bruker én av to kanonkuler.')
  assert.equal(
    GENERATION_QUOTA.free, 2,
    'GENERATION_QUOTA.free er ikke lenger 2 — KANONKULER_FREE_CONFIRM_TEXT sier fortsatt «to»',
  )
})

test('oppsalget sier tallet fra kvoten, ikke et hardkodet 30', () => {
  const s = status('free', 0)
  assert.equal(s.kind, 'tom')
  assert.ok(s.kind === 'tom' && s.upsell?.startsWith(`Få ${GENERATION_QUOTA.premium} `))
})

// ── Kategorivelgeren: tolv av fjorten, som FILTRERING av den ene lista ──────

test('velgeren tilbyr tolv: alle fjorten minus Teknologi og Diverse, i samme rekkefølge', () => {
  const options = generatorCategoryOptions()
  assert.deepEqual(GENERATOR_HIDDEN_CATEGORIES, ['Teknologi', 'Diverse'])
  assert.equal(options.length, 12)
  assert.deepEqual([...options], QUIZ_CATEGORIES.filter((c) => c !== 'Teknologi' && c !== 'Diverse'))
  assert.deepEqual([...options], [
    'Film & TV', 'Geografi', 'Historie', 'Kunst & Kultur', 'Litteratur', 'Mat & Drikke',
    'Merker & Bedrifter', 'Musikk', 'Politikk & Samfunn', 'Språk & Ord', 'Sport', 'Vitenskap & Natur',
  ])
})

test('de skjulte finnes fortsatt i QUIZ_CATEGORIES (de ligger i puljen for blandet)', () => {
  for (const c of GENERATOR_HIDDEN_CATEGORIES) {
    assert.ok(QUIZ_CATEGORIES.includes(c), `${c} er borte fra QUIZ_CATEGORIES — da filtrerer vi ingenting`)
  }
})
