import { test, describe, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// ── SINKET, ikke beslutningen ────────────────────────────────────────────────
// Beslutningslogikken felles i lib/analytics-event.test.ts. Denne filen feller
// de tre kravene som bare kan brytes HER, i selve kallet til biblioteket:
//
//   KRAV 1  spor() kan aldri kaste — uansett hva track() gjør
//   KRAV 2  inert uten konfigurasjon, uten støy
//   KRAV 4  ingen latens: spor() returnerer void, ikke en Promise
//
// KRAV 1 er ikke teoretisk. @vercel/analytics v2.0.1 sin egen track() KASTER
// med vilje utenfor en nettleser når NODE_ENV ikke er production:
//     if (!isBrowser()) { ...; if (isProduction()) console.warn(msg)
//                              else throw new Error(msg); return }
//     — node_modules/@vercel/analytics/dist/index.mjs:194-201
// Testene under bruker en mock som kaster, slik at vakten felles uavhengig av
// hvilket miljø testene tilfeldigvis kjører i.

let trackKall: Array<{ navn: string; properties: unknown }> = []
let trackSkalKaste = false

mock.module('@vercel/analytics', {
  namedExports: {
    track: (navn: string, properties: unknown) => {
      trackKall.push({ navn, properties })
      if (trackSkalKaste) throw new Error('[Vercel Web Analytics] simulert feil fra track()')
    },
  },
})

const { spor } = await import('./analytics')

const EKTE_QUIZ = { is_test: false, quiz_type: 'weekly' }
const TESTQUIZ_VIA_FLAGG = { is_test: true, quiz_type: 'weekly' }
const TESTQUIZ_VIA_TYPE = { is_test: false, quiz_type: 'test' }

// spor() går ut med én gang `window` mangler. Nesten alle testene under vil
// forbi den vakten, så vi later som vi er i en nettleser og rydder etter oss.
const settNettleser = () => {
  ;(globalThis as { window?: unknown }).window = { innerWidth: 800 }
}
const fjernNettleser = () => {
  delete (globalThis as { window?: unknown }).window
}

beforeEach(() => {
  trackKall = []
  trackSkalKaste = false
  settNettleser()
})
afterEach(fjernNettleser)

describe('KRAV 1 — spor() kan aldri kaste', () => {
  // MUTASJONSBEVIS: denne testen alene er IKKE nok. Fjerner man hele
  // track()-kallet fra spor(), blir den grønn — en helper som ikke gjør noe
  // kaster heller ikke. Derfor står den sammen med «kallet når faktisk fram»
  // rett under; de to felles av HVER SIN mutasjon.
  test('en track() som kaster propagerer ikke', () => {
    trackSkalKaste = true
    assert.doesNotThrow(() => {
      spor({ hendelse: 'quiz_fullfort', quiz: EKTE_QUIZ, tilgang: 'gratis' })
    })
    // ...og kallet ble faktisk forsøkt. Uten denne linjen ville en tom
    // implementasjon bestått.
    assert.equal(trackKall.length, 1)
  })

  test('kallet når faktisk fram når track() oppfører seg', () => {
    spor({ hendelse: 'quiz_fullfort', quiz: EKTE_QUIZ, tilgang: 'premium' })
    assert.deepEqual(trackKall, [{ navn: 'quiz_fullfort', properties: { tilgang: 'premium' } }])
  })

  test('kaster ikke på noen av de fire hendelsene, med kastende track()', () => {
    trackSkalKaste = true
    for (const hendelse of ['quiz_startet', 'quiz_fullfort', 'premium_cta_vist', 'premium_cta_klikk'] as const) {
      assert.doesNotThrow(() => spor({ hendelse, quiz: EKTE_QUIZ, tilgang: 'org', vindusbredde: 360 }))
    }
    assert.equal(trackKall.length, 4)
  })

  test('kaster ikke på råtten input', () => {
    for (const input of [null, undefined, {}, { hendelse: 'tull' }, { hendelse: 'quiz_startet' }]) {
      assert.doesNotThrow(
        () => spor(input as unknown as Parameters<typeof spor>[0]),
        `input ${JSON.stringify(input)} kastet`,
      )
    }
    // Ingen av dem er en gyldig, ekte quiz — ingenting skal ha blitt sendt.
    assert.equal(trackKall.length, 0)
  })
})

describe('KRAV 2 — inert uten nettleser/konfigurasjon', () => {
  // Dette er lag 1 mot bibliotekets egen throw-sti: kommer vi aldri til
  // track(), kan den heller ikke kaste.
  test('uten window kalles track() ikke i det hele tatt', () => {
    fjernNettleser()
    trackSkalKaste = true
    assert.doesNotThrow(() => spor({ hendelse: 'quiz_startet', quiz: EKTE_QUIZ, tilgang: 'gratis', vindusbredde: 360 }))
    assert.equal(trackKall.length, 0, 'track() skal ikke nås serverside')
  })

  test('ingen støy på stdout/stderr når track() kaster', () => {
    trackSkalKaste = true
    const skrevet: string[] = []
    const origLog = console.log, origWarn = console.warn, origError = console.error
    console.log = (...a: unknown[]) => { skrevet.push(String(a[0])) }
    console.warn = (...a: unknown[]) => { skrevet.push(String(a[0])) }
    console.error = (...a: unknown[]) => { skrevet.push(String(a[0])) }
    try {
      spor({ hendelse: 'quiz_fullfort', quiz: EKTE_QUIZ, tilgang: 'gratis' })
    } finally {
      console.log = origLog; console.warn = origWarn; console.error = origError
    }
    assert.deepEqual(skrevet, [], `helperen logget: ${skrevet.join(' | ')}`)
  })
})

describe('KRAV 3 — testquizer sender NULL hendelser gjennom sinket', () => {
  // Beslutningen er testet i analytics-event.test.ts; her felles at SINKET
  // faktisk respekterer den. Fixturene skiller is_test fra quiz_type, så en
  // implementasjon som bare leser det ene feltet ryker på det andre.
  test('is_test=true når aldri track()', () => {
    for (const hendelse of ['quiz_startet', 'quiz_fullfort', 'premium_cta_vist', 'premium_cta_klikk'] as const) {
      spor({ hendelse, quiz: TESTQUIZ_VIA_FLAGG, tilgang: 'gratis', vindusbredde: 360 })
    }
    assert.equal(trackKall.length, 0)
  })

  test("quiz_type='test' når aldri track()", () => {
    for (const hendelse of ['quiz_startet', 'quiz_fullfort', 'premium_cta_vist', 'premium_cta_klikk'] as const) {
      spor({ hendelse, quiz: TESTQUIZ_VIA_TYPE, tilgang: 'gratis', vindusbredde: 360 })
    }
    assert.equal(trackKall.length, 0)
  })

  test('positiv kontroll: den ekte quizen slipper gjennom samme sink', () => {
    // Uten denne kunne alle testene over vært grønne fordi sinket er ødelagt
    // for ALT — «0 kall» beviser bare noe når vi vet at 4 er oppnåelig.
    for (const hendelse of ['quiz_startet', 'quiz_fullfort', 'premium_cta_vist', 'premium_cta_klikk'] as const) {
      spor({ hendelse, quiz: EKTE_QUIZ, tilgang: 'gratis', vindusbredde: 360 })
    }
    assert.equal(trackKall.length, 4)
  })
})

describe('KRAV 4 — ingen latens i kritisk sti', () => {
  // Den mekaniske garantien: returverdien er ikke thenable, så et kallsted
  // KAN ikke await-e seg til en forsinkelse foran en innsending.
  test('spor() returnerer undefined, ikke en Promise', () => {
    const r = spor({ hendelse: 'quiz_fullfort', quiz: EKTE_QUIZ, tilgang: 'gratis' }) as unknown
    assert.equal(r, undefined)
    assert.equal(typeof (r as { then?: unknown })?.then, 'undefined')
  })
})

describe('properties som faktisk sendes', () => {
  test('quiz_startet bærer tilgang + bredde', () => {
    spor({ hendelse: 'quiz_startet', quiz: EKTE_QUIZ, tilgang: 'gratis', vindusbredde: 360 })
    assert.deepEqual(trackKall, [{ navn: 'quiz_startet', properties: { tilgang: 'gratis', bredde: '<400' } }])
  })

  test('de tre andre bærer kun tilgang', () => {
    for (const hendelse of ['quiz_fullfort', 'premium_cta_vist', 'premium_cta_klikk'] as const) {
      trackKall = []
      spor({ hendelse, quiz: EKTE_QUIZ, tilgang: 'org', vindusbredde: 360 })
      assert.deepEqual(trackKall, [{ navn: hendelse, properties: { tilgang: 'org' } }])
    }
  })
})
