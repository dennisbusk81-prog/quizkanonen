import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideResultPlacementView } from './result-placement'

// ── BUGGEN (7. august 2026): total = 1 ga tomt felt ──────────────────────────
// Disse to testene feller enhver implementasjon som gjeninnfører
// `total > 1`-guarden — de er selve bestillingen.

test('gratis spiller nr. 1 (total=1) får kortet, ikke et tomt felt', () => {
  const v = decideResultPlacementView({
    mode: 'public',
    isPremium: false,
    placement: { rank: 1, total: 1 },
  })
  assert.equal(v, 'free')
})

test('Premium spiller nr. 1 (total=1) mister ALDRI plasseringen sin — får først-ute-varianten', () => {
  const v = decideResultPlacementView({
    mode: 'public',
    isPremium: true,
    placement: { rank: 1, total: 1 },
  })
  assert.equal(v, 'premium-first')
})

// ── Positiv kontroll: spiller nr. 2+ ser NØYAKTIG det de ser i dag ───────────

test('Premium med total=2 får eksakt-varianten, ikke først-ute', () => {
  const v = decideResultPlacementView({
    mode: 'public',
    isPremium: true,
    placement: { rank: 2, total: 2 },
  })
  assert.equal(v, 'premium-exact')
})

test('gratis med total=2 får kortet (ventetekst/spenn avgjøres av page.tsx som før)', () => {
  const v = decideResultPlacementView({
    mode: 'public',
    isPremium: false,
    placement: { rank: 2, total: 2 },
  })
  assert.equal(v, 'free')
})

test('both-modus (org som deltar åpent) behandles som public — begge varianter', () => {
  assert.equal(
    decideResultPlacementView({ mode: 'both', isPremium: true, placement: { rank: 1, total: 1 } }),
    'premium-first',
  )
  assert.equal(
    decideResultPlacementView({ mode: 'both', isPremium: false, placement: { rank: 3, total: 12 } }),
    'free',
  )
})

// ── Mode-gaten står urørt ────────────────────────────────────────────────────

test('internal-only er hidden selv med placement — det interne kortet eier flaten', () => {
  const v = decideResultPlacementView({
    mode: 'internal-only',
    isPremium: true,
    placement: { rank: 1, total: 5 },
  })
  assert.equal(v, 'hidden')
})

test('unknown er hidden selv med placement — retry-mekanismen eier tilstanden', () => {
  const v = decideResultPlacementView({
    mode: 'unknown',
    isPremium: false,
    placement: { rank: 1, total: 5 },
  })
  assert.equal(v, 'hidden')
})

// ── Manglende/ugyldig data ───────────────────────────────────────────────────

test('placement null er hidden — ingen data, ingen påstand', () => {
  const v = decideResultPlacementView({ mode: 'public', isPremium: true, placement: null })
  assert.equal(v, 'hidden')
})

test('total=0 er hidden (defensivt — leaderboard-fallbacken bygger fra to felt)', () => {
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: false, placement: { rank: 1, total: 0 } }),
    'hidden',
  )
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: true, placement: { rank: 1, total: 0 } }),
    'hidden',
  )
})

// ── PARITET MED SERVERENS GATE (P-2, 23. august 2026) ───────────────────────
// `isPremium` her er KLIENTENS mening (ProfileProvider). Serverens mening bæres
// av attempt-tokenet, som utstedes ved quiz-START. Kjøper noen Premium midt i
// en quiz, er de to uenige til neste sidelast — og da kommer `placement.rank`
// som null selv om klienten mener den er Premium.
//
// MUTASJONSBEVIS: fjern `&& input.placement.rank !== null` fra
// decideResultPlacementView, og testen under ryker. I produksjon ville
// premium-kortet da rendret «. plass» — tallet borte, punktumet igjen.

test('premium-klient uten eksakt rank fra serveren faller til gratis-kortet', () => {
  const v = decideResultPlacementView({
    mode: 'public',
    isPremium: true,
    placement: { rank: null, total: 65 },
  })
  assert.equal(v, 'free', 'dataen vinner over antakelsen — gratis-kortet er komplett uten rank')
})

test('positiv kontroll: samme kaller MED rank får premium-kortet', () => {
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: true, placement: { rank: 33, total: 65 } }),
    'premium-exact',
  )
})

test('gratis-klient med rank null er uendret gratis — ingen ny gren', () => {
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: false, placement: { rank: null, total: 65 } }),
    'free',
  )
})

test('alene i feltet: premium-first krever fortsatt en eksakt rank', () => {
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: true, placement: { rank: 1, total: 1 } }),
    'premium-first',
  )
  // Uten tallet er «du er først ute» en påstand vi ikke har dekning for.
  assert.equal(
    decideResultPlacementView({ mode: 'public', isPremium: true, placement: { rank: null, total: 1 } }),
    'free',
  )
})
