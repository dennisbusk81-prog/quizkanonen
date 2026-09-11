// Kjøres med:  npm test
//
// Overskriftslinja i delingsteksten — datoen skal stå ÉN gang.
//
// BAKGRUNN (12. september 2026)
// Ruten limte alltid på en formatert `closes_at` bak tittelen, og tittelen bar
// allerede datoen: «Resultat Fredagsquiz 11.09.2026 11.09.2026».
//
// Datoen kunne ikke bare fjernes. Målt mot prod 12. september 2026, 18 ulike
// titler: 16 har `dd.mm.åååå` i seg, 2 har det ikke («Månedsquiz August 2026»
// og «Tilfeldig quiz»). For de to er den påklistrede datoen den eneste
// opplysningen om når quizen ble spilt.
//
// MUTASJONSBEVIS. Hver mutasjon faktisk skrevet til fila, forekomstene talt
// før og etter, testene kjørt (denne fila + lib/quiz-results-text-kilde),
// deretter rullet tilbake. Baseline 23/23 grønne. Antall FEILENDE:
//   • betingelsen snudd (`!DATO_I_TITTEL.test`)      → 7
//   • `\b\d{2}\.\d{2}\.\d{4}\b` → `\d{4}`            → 2
//   • alltid legg på dato (testen droppet)           → 5
//   • bindestrek tilbake i «Midt på treet»-linja     → 1
//   • `resultatOverskrift` byttet mot den gamle
//     `Resultat ${title} ${dateStr}`                 → 1
//
// TRE av dem ble FØRST aldri påført: perl tolker `$` i erstatningen, og
// `\Q..\E` dekker bare mønsteret. Tellingen fanget det; testkjøringen ville
// vist grønt og sett ut som fem overlevende mutasjoner. Påført til slutt med
// literal `split/join` i node, og regex-literalen bygget med
// `String.fromCharCode(92)` for å holde backslashene i live gjennom skallet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultatOverskrift } from './resultat-overskrift'

const DATO = '11.09.2026'

test('tittel med dato får den IKKE på nytt — den ekte 11.09-saken', () => {
  assert.equal(
    resultatOverskrift('Fredagsquiz 11.09.2026', DATO),
    'Resultat Fredagsquiz 11.09.2026',
  )
})

test('alle 16 fredagstitlene i prod har samme form og skal behandles likt', () => {
  for (const dag of ['03.07.2026', '19.06.2026', '02.10.2026', '28.08.2026']) {
    assert.equal(
      resultatOverskrift(`Fredagsquiz ${dag}`, DATO),
      `Resultat Fredagsquiz ${dag}`,
      `datoen ble gjentatt for ${dag}`,
    )
  }
})

test('tittel UTEN dato får datoen bakpå — ellers aldres innlegget dårlig', () => {
  // De to ekte tilfellene fra prod.
  assert.equal(
    resultatOverskrift('Månedsquiz August 2026', '01.09.2026'),
    'Resultat Månedsquiz August 2026 01.09.2026',
  )
  assert.equal(
    resultatOverskrift('Tilfeldig quiz', DATO),
    'Resultat Tilfeldig quiz 11.09.2026',
  )
})

test('«2026» alene i tittelen teller IKKE som dato', () => {
  // Mønsteret må kreve dd.mm.åååå. Et løsere mønster ville sett årstallet i
  // «Månedsquiz August 2026» og droppet datoen — altså fjernet den ENESTE
  // tidsangivelsen fra nettopp den tittelen som trenger den.
  assert.ok(resultatOverskrift('Månedsquiz August 2026', DATO).endsWith(DATO))
})

test('tittel med en ANNEN dato enn closes_at får ikke to datoer', () => {
  // En arkivkopi eller en flyttet quiz. To ULIKE datoer etter hverandre er
  // verre enn to like: da må leseren gjette hvilken som gjelder.
  assert.equal(
    resultatOverskrift('Fredagsquiz 04.09.2026', '11.09.2026'),
    'Resultat Fredagsquiz 04.09.2026',
  )
})

test('tom eller blank tittel gir ikke dobbelt mellomrom', () => {
  assert.equal(resultatOverskrift('', DATO), `Resultat ${DATO}`)
  assert.equal(resultatOverskrift('   ', DATO), `Resultat ${DATO}`)
})

test('tittelen trimmes', () => {
  assert.equal(
    resultatOverskrift('  Fredagsquiz 11.09.2026  ', DATO),
    'Resultat Fredagsquiz 11.09.2026',
  )
})
