// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: låst-skjermen tilbyr «Legg inn betaling →» KUN til admin.
//
// ── HVILKEN FEIL DENNE FILA FINNES FOR (7. september 2026) ─────────────────
// /api/stripe/org-checkout avviser alle som ikke er admin med 403 «Ingen
// admin-tilgang» (route.ts:48). OrgLockedScreen viste knappen til ALLE
// medlemmer likevel — en ansatt fikk en knapp som garantert feilet. OrgCard
// på forsiden skjuler lenken av nøyaktig den grunnen; mønsteret fantes, det
// var bare ikke brukt her. Nå bærer skjermen `isAdmin`, og en ansatt får
// forklaring i stedet: en administrator må fornye, og hun kan spille som
// vanlig — samme løfter som før.
//
// Hvorfor kildetekst-test: npm test kjører uten jsdom (samme grunn som
// lib/kontomeny-arkivlenke.test.ts).
//
// MUTASJONSBEVIS:
//   • `{isAdmin && (` rundt knappen fjernes → «knappen står inne i isAdmin-gaten» ryker.
//   • Ikke-admin-teksten fjernes → «ikke-admin får en forklaring» ryker.
//   • En kaller slutter å sende isAdmin → tsc OG «begge kallerne sender isAdmin» ryker.
//   • «Forlat organisasjon» havner inne i gaten → «utveiene står utenfor gaten» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function aktivKode(fil: string): string {
  const raw = readFileSync(fil, 'utf8')
  const utenBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return utenBom
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const SKJERM = 'components/OrgLockedScreen.tsx'

test('skjermen tar isAdmin som påkrevd prop', () => {
  const src = aktivKode(SKJERM)
  assert.match(src, /\n  isAdmin: boolean\n/, 'isAdmin er ikke en påkrevd boolean-prop')
  assert.match(src, /accessToken,\n  isAdmin,\n\}/, 'isAdmin destruktureres ikke')
})

test('knappen «Legg inn betaling →» står inne i isAdmin-gaten', () => {
  const src = aktivKode(SKJERM)
  const knapp = src.indexOf("'Legg inn betaling →'")
  assert.notEqual(knapp, -1, 'knappen er borte helt — admin må fortsatt kunne fornye')
  const gate = src.lastIndexOf('{isAdmin && (', knapp)
  assert.notEqual(gate, -1, 'knappen står ikke inne i en isAdmin-gate')
  // Gaten skal omslutte selve <button>, ikke bare stå et sted foran.
  const buttonStart = src.lastIndexOf('<button', knapp)
  assert.ok(gate < buttonStart, 'isAdmin-gaten åpner ikke før <button>')
  const buttonEnd = src.indexOf('</button>', knapp)
  const gateSlutt = src.indexOf(')}', buttonEnd)
  assert.notEqual(gateSlutt, -1, 'gaten lukkes ikke etter knappen')
  // Feilboksen hører til knappen og skal også være gatet.
  assert.match(src, /\{isAdmin && error && \(/, 'feilboksen for betalingskallet vises for ikke-admin')
})

test('ikke-admin får en forklaring: en administrator må fornye', () => {
  const src = aktivKode(SKJERM)
  assert.match(src, /\{isAdmin\n\s*\? 'Bedriftssidene er midlertidig sperret\. Legg inn betaling for å fortsette med bedriftens toppliste og admin-panelet\.'/,
    'admin-teksten er endret eller ikke lenger gatet på rollen')
  assert.match(src, /: `Bedriftssidene er midlertidig sperret\. En administrator i \$\{orgName\} må fornye abonnementet før bedriftens toppliste åpner igjen\.`/,
    'ikke-admin-teksten mangler — en ansatt skal vite hvem som kan handle')
  // Løftene deles av begge rollene og står UTENFOR gaten.
  assert.match(src, /Ansatte kan fortsatt spille den ukentlige quizen som vanlig\./)
  assert.match(src, /Ingenting er slettet — profiler, historikk og poeng består\./)
})

test('utveiene står utenfor gaten: «Forlat organisasjon» og «← Forsiden» for alle', () => {
  const src = aktivKode(SKJERM)
  const gate = src.indexOf('{isAdmin && (')
  const gateSlutt = src.indexOf(')}', src.indexOf('</button>', gate))
  const forlat = src.indexOf('Forlat organisasjon')
  const forside = src.indexOf('← Forsiden')
  assert.ok(forlat > gateSlutt, '«Forlat organisasjon» ligger inne i isAdmin-gaten — en ansatt sitter fast i en låst org')
  assert.ok(forside > gateSlutt, '«← Forsiden» ligger inne i isAdmin-gaten')
})

test('begge kallerne sender isAdmin fra en ekte rolle-kilde', () => {
  const org = aktivKode('app/org/[slug]/page.tsx')
  assert.match(org, /<OrgLockedScreen [^>]*isAdmin=\{org\.isAdmin\}/, '/org/[slug] sender ikke medlemskapets isAdmin')
  const admin = aktivKode('app/org/[slug]/admin/page.tsx')
  assert.match(admin, /isAdmin=\{\(data\.members \?\? \[\]\)\.some\(m => m\.user_id === data\.currentUserId && m\.role === 'admin'\)\}/,
    'bedriftspanelet sender ikke rollen fra admin-data — et hardkodet true ville løyet for et medlem som lander der')
  // Ingen kaller sender en konstant.
  for (const [fil, src] of [['org', org], ['admin', admin]] as const) {
    assert.ok(!/isAdmin=\{(true|false)\}/.test(src), `${fil}: isAdmin er hardkodet`)
  }
})
