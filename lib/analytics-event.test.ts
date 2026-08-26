import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideAnalyticsEvent,
  bottleggBredde,
  utledTilgang,
  ANALYTICS_HENDELSER,
  TILGANG_VERDIER,
  BREDDE_BOTTER,
  MAKS_PROPERTIES,
  type AnalyticsHendelse,
  type Tilgang,
} from './analytics-event'
import { erEkteQuiz, REAL_QUIZ_TYPES } from './real-quiz-population'

// ── Hva denne filen feller ───────────────────────────────────────────────────
// Fire krav fra oppdraget, pluss paritets-kravet mot spørringsfiltrene:
//   1. testquiz sender NULL hendelser
//   2. ingen forbudt property slipper gjennom — bevist ved UTTØMMING, ikke
//      ved stikkprøver på et utvalg forbudte navn
//   3. quiz_fullfort er ikke spesialbehandlet her; invarianten om at den kun
//      fyrer på bekreftet lagring bor i KALLSTEDET og felles i
//      analytics-call-sites.test.ts
//   4. taket på 2 properties (Vercel Pro) holder
//
// ⚠ FIXTURE-REGEL etter M3-funnet i lib/last-quiz-definition.test.ts:
// en fixture der to felter har samme verdi kan få et filter på FEIL felt til å
// se riktig ut. Derfor SKILLER fixturene under alltid `is_test` fra
// `quiz_type`: EKTE_QUIZ har `is_test: false` + `quiz_type: 'weekly'`, og de to
// kunstige variantene gjør nøyaktig ÉN av dem gal om gangen. En implementasjon
// som bare leser det ene feltet blir da rød på den andre.
const EKTE_QUIZ = { is_test: false, quiz_type: 'weekly' }
const TESTQUIZ_VIA_FLAGG = { is_test: true, quiz_type: 'weekly' }   // admin-bryteren
const TESTQUIZ_VIA_TYPE = { is_test: false, quiz_type: 'test' }     // oppskriftens quiz

describe('erEkteQuiz — paritet med spørringsfiltrene', () => {
  test('ekte quiz slipper gjennom', () => {
    assert.equal(erEkteQuiz(EKTE_QUIZ), true)
    assert.equal(erEkteQuiz({ is_test: false, quiz_type: 'bonus' }), true)
  })

  // De to fixturene skiller: hver av dem er kunstig av EN grunn, og den andre
  // grunnen ser ekte ut. En implementasjon som glemmer ett av leddene består
  // den ene og ryker på den andre.
  test('admin-bryteren (is_test) fanges — selv med quiz_type weekly', () => {
    assert.equal(erEkteQuiz(TESTQUIZ_VIA_FLAGG), false)
  })
  test('oppskriftens quiz (quiz_type) fanges — selv med is_test false', () => {
    assert.equal(erEkteQuiz(TESTQUIZ_VIA_TYPE), false)
  })

  // Speiler `.not('is_test','is',true)`: dekker false OG NULL. `=== false`
  // ville vært strengere enn spørringen — se paritets-kommentaren i
  // real-quiz-population.ts.
  test('is_test NULL/undefined er IKKE kunstig — som .not(is_test, is, true)', () => {
    assert.equal(erEkteQuiz({ is_test: null, quiz_type: 'weekly' }), true)
    assert.equal(erEkteQuiz({ quiz_type: 'weekly' }), true)
  })

  test('arkiv og ukjent type faller ut uten at hvitelisten endres', () => {
    assert.equal(erEkteQuiz({ is_test: false, quiz_type: 'archive' }), false)
    assert.equal(erEkteQuiz({ is_test: false, quiz_type: 'christmas' }), false)
  })

  test('manglende quiz_type matcher ingen IN-liste', () => {
    assert.equal(erEkteQuiz({ is_test: false }), false)
    assert.equal(erEkteQuiz({ is_test: false, quiz_type: null }), false)
  })

  test('null/undefined quiz er ikke ekte', () => {
    assert.equal(erEkteQuiz(null), false)
    assert.equal(erEkteQuiz(undefined), false)
  })

  // Låser at predikatet BYGGER på den delte konstanten og ikke på en kopi:
  // utvides REAL_QUIZ_TYPES, skal predikatet følge med av seg selv.
  test('predikatet følger REAL_QUIZ_TYPES, ikke en lokal kopi', () => {
    for (const t of REAL_QUIZ_TYPES) {
      assert.equal(erEkteQuiz({ is_test: false, quiz_type: t }), true, `${t} skal telle som ekte`)
    }
  })
})

describe('KRAV 3 — testquizer sender INGENTING', () => {
  for (const hendelse of ANALYTICS_HENDELSER) {
    test(`${hendelse}: is_test=true gir ingen hendelse`, () => {
      const b = decideAnalyticsEvent({ hendelse, quiz: TESTQUIZ_VIA_FLAGG, tilgang: 'gratis', vindusbredde: 360 })
      assert.equal(b.send, false)
      assert.equal(b.send === false && b.grunn, 'kunstig-quiz')
    })
    test(`${hendelse}: quiz_type='test' gir ingen hendelse`, () => {
      const b = decideAnalyticsEvent({ hendelse, quiz: TESTQUIZ_VIA_TYPE, tilgang: 'gratis', vindusbredde: 360 })
      assert.equal(b.send, false)
    })
    test(`${hendelse}: ekte quiz sendes`, () => {
      const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang: 'gratis', vindusbredde: 360 })
      assert.equal(b.send, true)
    })
  }

  test('ukjent quiz sender ikke — vet vi ikke, sender vi ikke', () => {
    for (const q of [null, undefined, {}, { is_test: null, quiz_type: null }]) {
      const b = decideAnalyticsEvent({ hendelse: 'quiz_startet', quiz: q, tilgang: 'gratis' })
      assert.equal(b.send, false, `quiz=${JSON.stringify(q)} skulle ikke sendt`)
      assert.equal(b.send === false && b.grunn, 'ukjent-quiz')
    }
  })
})

describe('INGEN FORBUDT PROPERTY — bevist ved uttømming', () => {
  // Kjør ALLE lovlige kombinasjoner og samle hver eneste nøkkel og verdi som
  // noen gang forlater helperen. Da er påstanden «ingenting annet kommer ut»
  // ikke et utvalg stikkprøver, men hele verdirommet.
  const seddeNokler = new Set<string>()
  const seddeVerdier = new Set<string>()
  const bredder = [null, undefined, -1, 0, NaN, Infinity, 320, 360, 399, 400, 767, 768, 1023, 1024, 3840]

  for (const hendelse of ANALYTICS_HENDELSER) {
    for (const tilgang of TILGANG_VERDIER) {
      for (const vindusbredde of bredder) {
        const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang, vindusbredde })
        if (b.send) {
          for (const [k, v] of Object.entries(b.properties)) {
            seddeNokler.add(k)
            seddeVerdier.add(v)
          }
        }
      }
    }
  }

  test('nøklene er nøyaktig { tilgang, bredde }', () => {
    assert.deepEqual([...seddeNokler].sort(), ['bredde', 'tilgang'])
  })

  test('verdiene kommer utelukkende fra de to lukkede settene', () => {
    const lovlige = new Set<string>([...TILGANG_VERDIER, ...BREDDE_BOTTER])
    for (const v of seddeVerdier) {
      assert.ok(lovlige.has(v), `verdien «${v}» er ikke i et lukket sett`)
    }
  })

  test('alle verdier er strings — Vercel tillater kun string/number/boolean/null', () => {
    for (const hendelse of ANALYTICS_HENDELSER) {
      const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang: 'premium', vindusbredde: 800 })
      assert.equal(b.send, true)
      if (b.send) {
        for (const v of Object.values(b.properties)) assert.equal(typeof v, 'string')
      }
    }
  })

  // Selve poenget med bygg-fra-bunnen: et kallsted KAN ikke smugle et felt
  // videre, fordi ingenting kopieres fra input.
  test('ekstra felt på input kopieres ALDRI ut', () => {
    const forurenset = {
      hendelse: 'quiz_startet' as AnalyticsHendelse,
      quiz: EKTE_QUIZ,
      tilgang: 'gratis' as Tilgang,
      vindusbredde: 360,
      // Alt under er nøyaktig det oppdraget forbyr.
      user_id: '11111111-2222-3333-4444-555555555555',
      email: 'dennisbusk81@gmail.com',
      navn: 'Dennis Busk',
      quizId: 'abcdef00-0000-0000-0000-000000000000',
      attemptId: 'fedcba00-0000-0000-0000-000000000000',
      orgSlug: 'elkjop-nordic',
      poengsum: 9,
      plassering: 3,
      ip: '84.212.11.9',
    } as unknown as Parameters<typeof decideAnalyticsEvent>[0]

    const b = decideAnalyticsEvent(forurenset)
    assert.equal(b.send, true)
    if (b.send) {
      assert.deepEqual(Object.keys(b.properties).sort(), ['bredde', 'tilgang'])
      const serialisert = JSON.stringify(b.properties)
      for (const forbudt of ['11111111', 'dennisbusk81', 'Dennis', 'abcdef00', 'fedcba00', 'elkjop', '84.212']) {
        assert.ok(!serialisert.includes(forbudt), `«${forbudt}» lekket ut i ${serialisert}`)
      }
    }
  })

  test('ugyldig tilgang sendes ikke videre som fritekst', () => {
    const b = decideAnalyticsEvent({
      hendelse: 'quiz_startet',
      quiz: EKTE_QUIZ,
      tilgang: 'dennis@example.com' as unknown as Tilgang,
    })
    assert.equal(b.send, false)
    assert.equal(b.send === false && b.grunn, 'ukjent-tilgang')
  })

  test('ukjent hendelsesnavn sendes ikke', () => {
    const b = decideAnalyticsEvent({
      hendelse: 'noe_helt_annet' as unknown as AnalyticsHendelse,
      quiz: EKTE_QUIZ,
      tilgang: 'gratis',
    })
    assert.equal(b.send, false)
    assert.equal(b.send === false && b.grunn, 'ukjent-hendelse')
  })
})

describe('Vercel Pro-taket på 2 properties', () => {
  test('ingen hendelse overstiger MAKS_PROPERTIES', () => {
    for (const hendelse of ANALYTICS_HENDELSER) {
      for (const tilgang of TILGANG_VERDIER) {
        const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang, vindusbredde: 1200 })
        if (b.send) {
          assert.ok(
            Object.keys(b.properties).length <= MAKS_PROPERTIES,
            `${hendelse} hadde ${Object.keys(b.properties).length} properties`,
          )
        }
      }
    }
  })

  test('MAKS_PROPERTIES er 2 — Pro uten Web Analytics Plus', () => {
    assert.equal(MAKS_PROPERTIES, 2)
  })

  test('bredde ligger KUN på quiz_startet', () => {
    for (const hendelse of ANALYTICS_HENDELSER) {
      const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang: 'gratis', vindusbredde: 360 })
      assert.equal(b.send, true)
      if (b.send) {
        if (hendelse === 'quiz_startet') {
          assert.equal(b.properties.bredde, '<400')
        } else {
          assert.ok(!('bredde' in b.properties), `${hendelse} skal ikke ha bredde`)
        }
      }
    }
  })
})

describe('bottleggBredde', () => {
  // Grensene testes på BEGGE sider — en off-by-one i en bøttegrense er
  // usynlig i aggregatet og ville flyttet nettopp 360px-spørsmålet.
  test('grensene treffer riktig bøtte', () => {
    assert.equal(bottleggBredde(1), '<400')
    assert.equal(bottleggBredde(360), '<400')
    assert.equal(bottleggBredde(399), '<400')
    assert.equal(bottleggBredde(400), '400-767')
    assert.equal(bottleggBredde(767), '400-767')
    assert.equal(bottleggBredde(768), '768-1023')
    assert.equal(bottleggBredde(1023), '768-1023')
    assert.equal(bottleggBredde(1024), '>=1024')
    assert.equal(bottleggBredde(3840), '>=1024')
  })

  test('ikke-tall og ugyldige tall gir null — aldri en oppdiktet bøtte', () => {
    for (const v of [null, undefined, 0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(bottleggBredde(v as number), null, `${String(v)} skulle gitt null`)
    }
    assert.equal(bottleggBredde('360' as unknown as number), null)
  })

  // Den ekte garantien er ikke «etiketten inneholder ikke tallet» — to av de
  // fire etikettene ER bygget av grenseverdier (768-1023), så en slik test
  // ville vært rød av feil grunn for w=768. Garantien er at utfallet ALLTID er
  // én av de fire faste etikettene, uansett hvor spesiell bredden er: en
  // uvanlig viewport kan da ikke skille seg ut fra en vanlig.
  test('utfallet er alltid en av de fire faste etikettene — aldri råtallet', () => {
    const lovlige = new Set<string>(BREDDE_BOTTER)
    for (const w of [1, 319, 320, 360, 375, 414, 731, 768, 1440, 2559, 5120]) {
      const b = bottleggBredde(w)
      assert.ok(b !== null && lovlige.has(b), `bredden ${w} ga «${b}», utenfor det lukkede settet`)
    }
  })

  // Beviset på at bøttlegging faktisk KOLLAPSER informasjon: mange ulike
  // bredder må gi samme etikett. Uten dette ville en identitetsfunksjon
  // («returner String(w)») bestått testen over hvis settet var åpent.
  test('ulike bredder kollapser til samme etikett', () => {
    assert.equal(bottleggBredde(320), bottleggBredde(375))
    assert.equal(bottleggBredde(1440), bottleggBredde(3840))
    assert.equal(new Set([1, 319, 360, 375, 414, 731, 768, 1440, 5120].map(bottleggBredde)).size, 4)
  })
})

describe('utledTilgang', () => {
  test('uinnlogget vinner over alt annet', () => {
    assert.equal(utledTilgang({ isLoggedIn: false, isPremium: false, premiumSource: null }), 'uinnlogget')
    assert.equal(utledTilgang({ isLoggedIn: false, isPremium: true, premiumSource: 'org' }), 'uinnlogget')
  })
  test('innlogget uten premium er gratis', () => {
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: false, premiumSource: null }), 'gratis')
    // premiumSource kan henge igjen i cachen etter at dekningen tok slutt —
    // isPremium er det som avgjør, ikke kilden.
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: false, premiumSource: 'org' }), 'gratis')
  })
  test('org skilles fra øvrig premium', () => {
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: 'org' }), 'org')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: 'personal' }), 'premium')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: 'founders' }), 'premium')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: null }), 'premium')
  })
  test('utfallet er alltid i det lukkede settet', () => {
    for (const isLoggedIn of [true, false]) {
      for (const isPremium of [true, false]) {
        for (const premiumSource of ['org', 'personal', 'founders', 'code', null, undefined, 'noe_nytt']) {
          const t = utledTilgang({ isLoggedIn, isPremium, premiumSource })
          assert.ok((TILGANG_VERDIER as readonly string[]).includes(t), `«${t}» er utenfor settet`)
        }
      }
    }
  })
})
