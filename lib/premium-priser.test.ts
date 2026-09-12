// Kjøres med:  npm test
//
// Premium-prisene (lib/premium-priser.ts, 12. september 2026): ÉN kilde.
// Fram til nå sto 399 hardkodet sju steder og 49 enda flere, holdt like på
// ære. Testen binder:
//   • tallene og de avledede tallene (33 per måned, 588 per år, 189 spart)
//   • at hver av de sju flatene importerer kilden
//   • at INGEN side, komponent, e-postmal eller dashbord-ruta har prisen som
//     tekst igjen (aktive linjer — en kommentar som forteller historien
//     teller ikke)
//
// MUTASJONSBEVIS:
//   • `PREMIUM_YEARLY_NOK = 399` → 349                    → talltesten rød
//   • «kr 399/år» skrevet som tekst tilbake på /premium   → «ingen kopi» rød
//   • importen fjernet fra en e-postmal                   → import-testen rød
//   • fallback-linja i premium-cta-tekst.ts får «399» som tekst → CTA-testen rød
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  PREMIUM_MONTHLY_NOK,
  PREMIUM_YEARLY_NOK,
  PREMIUM_YEARLY_AS_MONTHLY_NOK,
  PREMIUM_MONTHLY_AS_YEARLY_NOK,
  PREMIUM_YEARLY_SAVING_NOK,
  PREMIUM_MONTHLY_LABEL,
  PREMIUM_YEARLY_LABEL,
  PREMIUM_PRICES_LABEL,
} from '@/lib/premium-priser'
import { premiumCtaTekster } from '@/lib/premium-cta-tekst'

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/**
 * Kun linjer som faktisk kjører — en utkommentert kopi skal ikke telle.
 * Blokkommentarer strippes FØR linjefilteret: en flerlinjet `{/* … *\/}` i
 * JSX (admin-dashbordets forbehold om «kr 49/mnd … bidrar 33») har linjer
 * som ikke begynner med et kommentartegn, og et rent linjefilter telte dem
 * som tekst publikum ser.
 */
function aktiveLinjer(kropp: string): string {
  return kropp
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

// ── Tallene ─────────────────────────────────────────────────────────────────

describe('tallene', () => {
  test('salgsprisene er 49/mnd og 399/år', () => {
    assert.equal(PREMIUM_MONTHLY_NOK, 49)
    assert.equal(PREMIUM_YEARLY_NOK, 399)
  })

  test('de avledede tallene regnes, ikke skrives', () => {
    assert.equal(PREMIUM_YEARLY_AS_MONTHLY_NOK, 399 / 12)
    assert.equal(Math.round(PREMIUM_YEARLY_AS_MONTHLY_NOK), 33)
    assert.equal(PREMIUM_MONTHLY_AS_YEARLY_NOK, 588)
    assert.equal(PREMIUM_YEARLY_SAVING_NOK, 189)
    const src = aktiveLinjer(les('lib/premium-priser.ts'))
    for (const tall of ['588', '189', '33']) {
      assert.doesNotMatch(src, new RegExp(`= ${tall}\\b`), `${tall} står som tekst — skal regnes fra 49/399`)
    }
  })

  test('etikettene er de flatene faktisk viser', () => {
    assert.equal(PREMIUM_MONTHLY_LABEL, 'kr 49/mnd')
    assert.equal(PREMIUM_YEARLY_LABEL, 'kr 399/år')
    assert.equal(PREMIUM_PRICES_LABEL, 'kr 49/mnd eller kr 399/år')
  })
})

// ── De sju flatene (pluss CTA-linja) leser herfra ───────────────────────────

const SJU: readonly string[] = [
  'app/api/admin/dashboard/route.ts',
  'app/premium/page.tsx',
  'app/slik-fungerer-det/page.tsx',
  'components/AccordionSection.tsx',
  'lib/email-templates.ts',
  // Fallback-linja «Bli Premium — 399 kr/år →» (halvparten av kontoene har
  // brukt opp prøveperioden, så dette er teksten halvparten ser).
  'lib/premium-cta-tekst.ts',
]

describe('flatene importerer kilden', () => {
  for (const fil of SJU) {
    test(`${fil} importerer fra premium-priser`, () => {
      assert.match(aktiveLinjer(les(fil)), /from '(@\/lib|\.)\/premium-priser'/, `${fil} leser ikke prisen fra lib/premium-priser.ts`)
    })
  }

  test('/premium regner omregningene fra kilden', () => {
    const src = aktiveLinjer(les('app/premium/page.tsx'))
    assert.match(src, /PREMIUM_YEARLY_AS_MONTHLY_NOK/)
    assert.match(src, /PREMIUM_YEARLY_SAVING_NOK/)
    assert.match(src, /PREMIUM_MONTHLY_AS_YEARLY_NOK/)
  })

  test('CTA-fallbacken sier prisen, hentet fra kilden', () => {
    const t = premiumCtaTekster({ show: false, days: null })
    assert.equal(t.linje, `Bli Premium — ${PREMIUM_YEARLY_NOK} kr/år →`)
    assert.equal(t.linje, 'Bli Premium — 399 kr/år →')
  })
})

// ── Ingen kopi igjen ────────────────────────────────────────────────────────

/** Prisen som tekst, i alle formene den har stått i. */
const PRIS_SOM_TEKST = /\b399\b|\bkr 49\b|\b49 kr\b|49\/mnd|49 i m(å|&aring;)neden|\b588\b|\b189\b/

function tsFiler(dir: string, ut: string[] = []): string[] {
  for (const navn of readdirSync(dir)) {
    if (navn === 'node_modules' || navn === '.next') continue
    const sti = path.join(dir, navn)
    if (statSync(sti).isDirectory()) tsFiler(sti, ut)
    else if (/\.(ts|tsx)$/.test(navn) && !navn.endsWith('.test.ts')) ut.push(sti.replace(/\\/g, '/'))
  }
  return ut
}

describe('ingen side, komponent, e-postmal eller dashbord-rute har prisen som tekst', () => {
  // Sider og komponenter er det publikum ser; e-postmalene likeså; dashbord-
  // ruta er stedet den rutelokale konstanten bodde. API-ruter ellers (to
  // Sentry-varseltekster i codes/redeem og org/join sier «kr 49» om et
  // abonnement — interne alarmer, ikke salgsflater) er bevisst utenfor.
  const filer = [
    ...tsFiler('app').filter(f => /\/page\.tsx$/.test(f)),
    ...tsFiler('components'),
    'lib/email-templates.ts',
    'app/api/admin/dashboard/route.ts',
    'lib/premium-cta-tekst.ts',
  ]

  test('populasjonen er ikke tom', () => {
    assert.ok(filer.length > 30, `fant bare ${filer.length} filer — er søket brukket?`)
  })

  for (const fil of filer) {
    test(`${fil}`, () => {
      const linjer = aktiveLinjer(les(fil)).split('\n').filter(l => PRIS_SOM_TEKST.test(l))
      assert.deepEqual(linjer, [], `${fil} har prisen som tekst:\n${linjer.join('\n')}`)
    })
  }
})
