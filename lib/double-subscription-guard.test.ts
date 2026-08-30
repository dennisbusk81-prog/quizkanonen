// Kjøres med:  npm test
//
// VISNINGSSIDEN av dobbeltkjøp-vakten (30. august 2026). Selve PORTEN — 409 i
// /api/stripe/checkout når brukeren allerede har et levende abonnement — felles
// behavioralt av lib/checkout-route.test.ts. Denne fila feller visningen som
// gjør at en ærlig bruker aldri MØTER porten:
//
//   - /api/stripe/subscription svarer has_subscription, utledet av NØYAKTIG
//     samme oppslag som getStripeCoverage bak 409-en (active ?? trialing,
//     limit 1). Klient og server skal tolke samme kilde identisk — samme regel
//     som admin-sesjonens readTokenExpiry/verifyAdminToken-paritet.
//   - /premium henter feltet og bytter kjøpsflaten mot «Administrer
//     abonnement» når det er sant.
//   - handleCheckout viser serverens egen 409-melding, ikke «Noe gikk galt».
//
// Hvorfor kildetekst-test: npm test kjører uten jsdom, og /premium er en
// klientkomponent — samme begrunnelse som lib/premium-session-dep.test.ts,
// som allerede pinner andre former i samme fil.
//
// MUTASJONSBEVIS:
//   - fjernes `has_subscription: true` fra ruten (eller flippes til false),
//     ryker tellingene i rutetestene under.
//   - fjernes fetch-en eller render-gaten fra /premium, ryker sidetestene.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Samme kommentar-stripping som lib/premium-session-dep.test.ts: begge filene
// er tungt kommenterte, og ankrene under nevnes i prosa. CRLF normaliseres
// først (core.autocrlf kan gi \r\n i arbeidskopien).
function renKode(kilde: string): string {
  return kilde
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

function antall(s: string, del: string): number {
  let n = 0
  for (let i = s.indexOf(del); i !== -1; i = s.indexOf(del, i + del.length)) n++
  return n
}

const SIDE = renKode(readFileSync('app/premium/page.tsx', 'utf8'))
const RUTE = renKode(readFileSync('app/api/stripe/subscription/route.ts', 'utf8'))

test('kommentarstrippen virker (positiv kontroll)', () => {
  // Uten denne kunne en ødelagt strip gjort alt under grønt ved å tømme fila.
  const raaRute = readFileSync('app/api/stripe/subscription/route.ts', 'utf8')
  assert.ok(raaRute.includes('visningsgrunnlaget for /premium'), 'ankerkommentaren finnes i ruta')
  assert.ok(!RUTE.includes('visningsgrunnlaget for /premium'), 'kommentar ble strippet')
  assert.ok(RUTE.includes('stripe.subscriptions.list'), 'kode overlevde strippen')
  assert.ok(SIDE.includes('handleCheckout'), 'kode overlevde strippen på siden')
})

// ── Ruta: has_subscription på alle svarstier ────────────────────────────────

test('ruta svarer has_subscription: true nøyaktig én gang — når et abonnement finnes', () => {
  assert.equal(
    antall(RUTE, 'has_subscription: true'), 1,
    'grenen som fant et abonnement bærer ikke lenger has_subscription: true',
  )
})

test('alle tre nei-stiene svarer has_subscription: false', () => {
  // Ingen kunde, kunde uten abonnement, og resource_missing i catch — alle tre
  // skal svare eksplisitt false, ikke utelate feltet (utelatt felt leses som
  // undefined og faller riktig i dag, men da beviser ingenting at stien var
  // vurdert).
  assert.equal(
    antall(RUTE, 'has_subscription: false'), 3,
    'en av nei-stiene (ingen kunde / ingen sub / ukjent kunde) mistet has_subscription: false',
  )
})

test('oppslaget deler definisjon med porten: active OG trialing, ikke en ny liste', () => {
  // isStripeLive = ['active', 'trialing']. Snevres ruta til bare 'active',
  // ville en Founders-trial sett kjøpsflaten mens porten avviser henne.
  assert.equal(antall(RUTE, "status: 'active'"), 1)
  assert.equal(antall(RUTE, "status: 'trialing'"), 1)
})

// ── Siden: henter feltet, bytter flate, viser serverens melding ─────────────

test('/premium henter abonnementsstatus fra samme rute', () => {
  assert.equal(
    antall(SIDE, "fetch('/api/stripe/subscription'"), 1,
    'siden henter ikke lenger /api/stripe/subscription — visningen er blind for et levende abonnement',
  )
  assert.equal(
    antall(SIDE, 'data.has_subscription === true'), 1,
    'svaret tolkes ikke lenger via has_subscription',
  )
})

test('kjøpsflaten byttes mot Administrer abonnement når abonnementet finnes', () => {
  assert.equal(
    antall(SIDE, 'hasSub === true ?'), 1,
    'render-gaten på hasSub er borte — kjøpsknappen vises da også for abonnenter',
  )
  assert.equal(
    antall(SIDE, 'Administrer abonnement'), 1,
    'portal-knappen «Administrer abonnement» er borte fra siden',
  )
})

test('utlogget settes eksplisitt til false — ukjent er ikke det samme som nei', () => {
  assert.equal(
    antall(SIDE, 'setHasSub(false)'), 1,
    'utlogget-grenen setter ikke lenger hasSub — da kan en tidligere true bli hengende',
  )
})

test('handleCheckout viser serverens egen feilmelding, ikke bare den generiske', () => {
  // 409-en fra dobbeltkjøp-vakten sier hva man skal gjøre i stedet. Maskeres
  // den som «Noe gikk galt», står brukeren uten veien videre.
  assert.equal(
    antall(SIDE, 'showError(data?.error ??'), 1,
    'serverens error-tekst når ikke lenger fram til brukeren ved avvist kjøp',
  )
})
