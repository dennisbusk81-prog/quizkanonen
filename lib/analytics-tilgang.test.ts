// Kjøres med:  npm test
//
// POPULASJONEN MÅ KUNNE SKILLES (12. september 2026).
//
// premium_cta_vist og premium_cta_klikk henger fra 12. september på den
// øverste CTA-en på resultatskjermen, som også vises for GJESTER. Tallet er
// derfor ikke sammenlignbart med de 42 fra 11. september (panelet, kun
// innloggede gratis) — MED MINDRE hver hendelse bærer tilgangsbøtta, slik at
// Vercel-dashbordet kan splittes på den. Denne filen binder at bøtta ALLTID
// er med, aldri undefined, og at verdien er én av de fire lukkede:
//
//   'uinnlogget'  gjest (ikke innlogget)
//   'gratis'      innlogget uten Premium   ← populasjonen fra 11. september
//   'premium'     personlig Premium
//   'org'         Premium via bedrift
//
// To lag, begge felt av testene her:
//   1. BESLUTNINGEN (lib/analytics-event.ts): properties bygges fra bunnen
//      med `tilgang` som første og eneste obligatoriske nøkkel. En kaller
//      som utelater eller forfalsker tilgang får `send: false` — hendelsen
//      går ikke ut uten bøtta, den går ikke ut i det hele tatt.
//   2. KALLSTEDET (app/quiz/[id]/page.tsx): begge kallene i
//      PlasseringPremiumCta sender `tilgang`, prop-en er typet `Tilgang`, og
//      QuizPage utleder verdien med utledTilgang() — ikke en håndskrevet
//      streng.
//
// MUTASJONSBEVIS:
//   • `const properties = { tilgang: input.tilgang }` → `{}`      → lag 1 rød
//   • vakten `TILGANG_VERDIER.includes(input.tilgang)` fjernet   → «avvises» rød
//   • `spor({ hendelse: 'premium_cta_vist', quiz })` (uten tilgang) → lag 2 rød
//   • `tilgang={tilgang}` → `tilgang="gratis"` i QuizPage          → «utledes» rød
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  decideAnalyticsEvent,
  TILGANG_VERDIER,
  utledTilgang,
  type SporingsInput,
  type Tilgang,
} from '@/lib/analytics-event'

const EKTE_QUIZ = { is_test: false, quiz_type: 'weekly' }
const CTA_HENDELSER = ['premium_cta_vist', 'premium_cta_klikk'] as const

describe('lag 1 — beslutningen sender ALLTID tilgang, og bare gyldige verdier', () => {
  for (const hendelse of CTA_HENDELSER) {
    for (const tilgang of TILGANG_VERDIER) {
      test(`${hendelse} med '${tilgang}' bærer nøyaktig den bøtta`, () => {
        const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang })
        assert.equal(b.send, true)
        if (!b.send) return
        assert.equal(typeof b.properties.tilgang, 'string')
        assert.equal(b.properties.tilgang, tilgang)
        // Kun tilgang på disse to: bredde sendes bare på quiz_startet.
        assert.deepEqual(Object.keys(b.properties), ['tilgang'])
      })
    }

    test(`${hendelse} uten tilgang sendes IKKE (undefined slipper aldri ut)`, () => {
      const uten = { hendelse, quiz: EKTE_QUIZ } as unknown as SporingsInput
      const b = decideAnalyticsEvent(uten)
      assert.equal(b.send, false)
      if (!b.send) assert.equal(b.grunn, 'ukjent-tilgang')
    })

    test(`${hendelse} med oppdiktet tilgang sendes IKKE`, () => {
      const b = decideAnalyticsEvent({ hendelse, quiz: EKTE_QUIZ, tilgang: 'gjest' as Tilgang })
      assert.equal(b.send, false)
    })
  }

  test('de fire bøttene er nøyaktig uinnlogget/gratis/premium/org', () => {
    assert.deepEqual([...TILGANG_VERDIER], ['uinnlogget', 'gratis', 'premium', 'org'])
  })

  test('utledTilgang dekker alle fire, og gjest heter «uinnlogget»', () => {
    assert.equal(utledTilgang({ isLoggedIn: false, isPremium: false, premiumSource: null }), 'uinnlogget')
    assert.equal(utledTilgang({ isLoggedIn: false, isPremium: true, premiumSource: 'stripe' }), 'uinnlogget')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: false, premiumSource: null }), 'gratis')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: 'stripe' }), 'premium')
    assert.equal(utledTilgang({ isLoggedIn: true, isPremium: true, premiumSource: 'org' }), 'org')
  })
})

describe('lag 2 — kallstedet sender tilgang, og verdien er utledet', () => {
  const raw = readFileSync('app/quiz/[id]/page.tsx', 'utf8')
  const SRC = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  test('begge kallene i PlasseringPremiumCta sender tilgang', () => {
    assert.match(SRC, /spor\(\{ hendelse: 'premium_cta_vist', quiz, tilgang \}\)/)
    assert.match(SRC, /spor\(\{ hendelse: 'premium_cta_klikk', quiz, tilgang \}\)/)
  })

  test('prop-en er typet Tilgang (lukket union), ikke string', () => {
    const decl = SRC.indexOf('function PlasseringPremiumCta(')
    assert.notEqual(decl, -1)
    const props = SRC.slice(decl, SRC.indexOf('}) {', decl))
    assert.match(props, /tilgang: Tilgang\b/, 'tilgang-prop-en er ikke typet Tilgang')
  })

  test('QuizPage sender den utledede verdien, ikke en håndskrevet streng', () => {
    assert.match(SRC, /const tilgang = useMemo\(\s*\(\) => utledTilgang\(\{ isLoggedIn, isPremium, premiumSource \}\)/)
    const bruk = SRC.match(/<PlasseringPremiumCta [^>]*\/>/g) ?? []
    assert.equal(bruk.length, 2)
    for (const b of bruk) assert.match(b, /tilgang=\{tilgang\}/, `bruket sender ikke den utledede verdien: ${b}`)
  })
})
