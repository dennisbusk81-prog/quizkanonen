// Kjøres med:  npm test
//
// Premium-CTA-tekstene på resultatskjermen (lib/premium-cta-tekst.ts,
// 12. september 2026): ÉN kilde, lest av topplinja i plasseringskortet og av
// prøveperiode-panelet. Fram til nå sa de to flatene ulike ting om samme
// tilbud. Testen binder tre ting:
//   • innholdet: med tilbud sier alle tre tekstene «gratis» og linja bærer
//     hele framingen (dagtall + «ingen kortinfo»); uten tilbud faller alle
//     tilbake til Premium-ordlyden uten dagtall
//   • flaten: quiz-siden leser herfra og har ingen egen kopi av ordlyden
//     (aktive linjer — en utkommentert kopi teller ikke)
//   • REKKEFØLGEN på resultatskjermen: panelet står FØR delingsknappene og
//     FØR den gylne «Se resultatene»-knappen i kilden. En test som bare
//     krever at panelet FINNES er for svak når kravet er at det SEES
//     (arbeidsregel 9. september 2026).
//
// MUTASJONSBEVIS (12. september 2026):
//   • linja med tilbud → 'Oppgrader til Premium for å se nøyaktig plassering →'
//     → «linja bærer hele framingen» rød
//   • `${stamme}` → hardkodet «14 dager» i linja                → dagtall-testen rød
//   • quiz-siden får «Prøv Premium gratis i …» inline tilbake    → «ingen kopi» rød
//   • panelet flyttes tilbake under «Se resultatene»             → rekkefølge-testen rød
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { premiumCtaTekster, provPremiumGratis, INGEN_KORTINFO } from '@/lib/premium-cta-tekst'
import { decideTrialOffer } from '@/lib/trial-offer'

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** Kun linjer som faktisk kjører — en utkommentert kopi skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const QUIZ_SIDE = 'app/quiz/[id]/page.tsx'
const QUIZ = aktiveLinjer(les(QUIZ_SIDE))

// ── Innholdet ───────────────────────────────────────────────────────────────

describe('med tilbud: gratis, dagtall og «ingen kortinfo» — ikke «Oppgrader»', () => {
  const t = premiumCtaTekster({ show: true, days: 14 })

  test('overskriften er stammen', () => {
    assert.equal(t.overskrift, 'Prøv Premium gratis i 14 dager')
    assert.equal(t.overskrift, provPremiumGratis(14))
  })

  test('knappen er kort (overskriften bærer dagtallet) og sier «ingen kortinfo»', () => {
    assert.equal(t.knapp, 'Prøv gratis — ingen kortinfo →')
    assert.ok(t.knapp.includes(INGEN_KORTINFO))
  })

  test('linja bærer HELE framingen selv — den står alene i plasseringskortet', () => {
    assert.equal(t.linje, 'Prøv Premium gratis i 14 dager — ingen kortinfo →')
    assert.ok(t.linje.startsWith(t.overskrift), 'linja starter ikke med stammen')
    assert.ok(t.linje.includes(INGEN_KORTINFO))
  })

  test('ingen av de tre sier «Oppgrader» eller selger «nøyaktig plassering»', () => {
    for (const tekst of [t.overskrift, t.knapp, t.linje]) {
      assert.doesNotMatch(tekst, /Oppgrader/, `«${tekst}» leser som betal`)
      assert.doesNotMatch(tekst, /nøyaktig plassering/, `«${tekst}» selger den svakeste fordelen`)
    }
  })

  test('dagtallet følger tilbudet — det er ikke skrevet som tekst', () => {
    const sju = premiumCtaTekster({ show: true, days: 7 })
    assert.equal(sju.overskrift, 'Prøv Premium gratis i 7 dager')
    assert.equal(sju.linje, 'Prøv Premium gratis i 7 dager — ingen kortinfo →')
    assert.doesNotMatch(aktiveLinjer(les('lib/premium-cta-tekst.ts')), /14 dager/, '«14» står som tekst i kilden')
  })

  test('tallet kommer fra samme beslutning som flatene bruker (decideTrialOffer)', () => {
    // site_settings.founders_new_trial_days = "14" i prod (verifisert 12. sept.)
    const offer = decideTrialOffer({ trialDays: '14', eligible: true })
    assert.equal(premiumCtaTekster(offer).linje, 'Prøv Premium gratis i 14 dager — ingen kortinfo →')
  })
})

describe('uten tilbud: Premium-ordlyden uten dagtall, som panelet alltid har hatt', () => {
  test('eksplisitt «ikke kvalifisert»', () => {
    const t = premiumCtaTekster({ show: false, days: null })
    assert.equal(t.overskrift, 'Følg fremgangen din uke etter uke')
    assert.equal(t.knapp, 'Oppgrader til Premium →')
    assert.equal(t.linje, 'Oppgrader til Premium →')
  })

  test('ikke hentet (null/undefined) = ingen tilbud — vi lover aldri dager vi ikke har tall for', () => {
    assert.deepEqual(premiumCtaTekster(null), premiumCtaTekster({ show: false, days: null }))
    assert.deepEqual(premiumCtaTekster(undefined), premiumCtaTekster({ show: false, days: null }))
  })

  test('manglende dagtall i site_settings gir også fallbacken', () => {
    const offer = decideTrialOffer({ trialDays: null, eligible: true })
    assert.doesNotMatch(premiumCtaTekster(offer).linje, /gratis i/)
  })
})

// ── Flaten: quiz-siden leser herfra, ingen egen kopi ───────────────────────

describe('quiz-siden har ingen egen kopi av ordlyden', () => {
  test('importerer og kaller premiumCtaTekster(trialOffer)', () => {
    assert.match(QUIZ, /import \{ premiumCtaTekster \} from '@\/lib\/premium-cta-tekst'/)
    assert.match(QUIZ, /const cta = premiumCtaTekster\(trialOffer\)/)
  })

  test('alle tre tekstene brukes — overskrift og knapp i panelet, linja i plasseringskortet', () => {
    assert.match(QUIZ, /\{cta\.overskrift\}/)
    assert.match(QUIZ, /\{cta\.knapp\}/)
    assert.match(QUIZ, /tekst=\{cta\.linje\}/)
  })

  test('ingen inline kopi av noen av strengene (aktive linjer)', () => {
    for (const kopi of ['Prøv Premium gratis', 'ingen kortinfo', 'Oppgrader til Premium', 'Følg fremgangen din', 'nøyaktig plassering →']) {
      assert.ok(!QUIZ.includes(kopi), `«${kopi}» står inline i ${QUIZ_SIDE} — ordlyden skal bo i lib/premium-cta-tekst.ts`)
    }
  })
})

// ── Rekkefølgen på resultatskjermen ─────────────────────────────────────────

describe('panelet står FØR delingsknappene og FØR den gylne utgangen (kildeorden)', () => {
  const kilde = les(QUIZ_SIDE)
  const ctaKolonne = kilde.indexOf('className="qk-result-cta"')
  const panel = kilde.indexOf('className="qk-result-upsell"')
  const delResultatet = kilde.indexOf("'Del resultatet →'")
  const utfordre = kilde.indexOf("'Utfordre en venn →'", ctaKolonne)
  const delKort = kilde.indexOf("'Del resultatkort'")
  // «Se resultatene» finnes også på tidligere faser; resultatskjermens er den
  // siste i filen, og den er gull (qk-btn-primary).
  const seResultatene = kilde.lastIndexOf('>Se resultatene</a>')

  test('ankrene finnes nøyaktig der de skal', () => {
    for (const [navn, idx] of Object.entries({ ctaKolonne, panel, delResultatet, utfordre, delKort, seResultatene })) {
      assert.notEqual(idx, -1, `fant ikke ankeret «${navn}» — er resultatskjermen omskrevet?`)
    }
    assert.equal(kilde.indexOf('className="qk-result-upsell"', panel + 1), -1, 'panelet finnes flere ganger')
  })

  test('panelet ligger inne i CTA-kolonna, øverst', () => {
    assert.ok(panel > ctaKolonne, 'panelet står utenfor CTA-kolonna')
    assert.ok(panel < delResultatet, 'panelet står under «Del resultatet»')
    assert.ok(panel < utfordre, 'panelet står under «Utfordre en venn»')
    assert.ok(panel < delKort, 'panelet står under «Del resultatkort»')
  })

  test('panelet står over den gylne «Se resultatene»-knappen', () => {
    assert.ok(panel < seResultatene, 'tilbudet ligger under sidens visuelle utgang')
    assert.ok(kilde.slice(seResultatene - 200, seResultatene).includes('qk-btn-primary'), 'ankeret er ikke gullknappen')
  })
})
