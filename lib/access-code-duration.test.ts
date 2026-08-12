// Kjøres med:  npm test
//
// resolveCodeDuration — permanens er et VALG, ikke et tomt felt.
//
// BAKGRUNN (12. august 2026)
// Admin-skjemaet utledet «permanent Premium» av fravær: tomt varighetsfelt ga
// `duration_days: null`. Men det gjorde ENHVER ugyldig verdi også — `parseInt`
// på «seksti» er NaN, og NaN falt samme vei. En skrivefeil ble stille til en
// permanent kode, og `duration_days` kan ikke endres etter opprettelse.
//
// En permanent kode hos en betalende kunde er den ene kombinasjonen uten et
// riktig utfall (rad G i lib/premium-state.ts). Rad G er den bindende vakten;
// denne funksjonen finnes for at feilen helst ikke skal oppstå.
//
// MUTASJONSBEVIS (hver mutasjon faktisk skrevet til lib/access-code-duration.ts,
// `npm test` kjørt, deretter rullet tilbake — se rapporten):
//   • `if (permanent) return …` fjernet         → «avkrysset gir permanent» ryker
//   • tom-streng-grenen fjernet                 → «tomt felt er en FEIL» ryker
//   • `Number` byttet til `parseInt`            → «60dager avvises» ryker
//   • `!Number.isInteger(n)` → `isNaN(n)`       → «desimaltall avvises» ryker
//   • `n < 1` → `n < 0`                         → «0 dager avvises» ryker
//   • taket fjernet                             → «over taket avvises» ryker
//   • permanent-grenen flyttet UNDER parsingen  → «avkrysset ignorerer feltet» ryker

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCodeDuration } from './access-code-duration'
import { DURATION_DAYS_CEILING } from './access-code'

const ok = (r: ReturnType<typeof resolveCodeDuration>) => {
  if (!r.ok) throw new Error(`forventet ok, fikk: ${r.error}`)
  return r
}
const feil = (r: ReturnType<typeof resolveCodeDuration>) => {
  if (r.ok) throw new Error(`forventet feil, fikk durationDays=${r.durationDays}`)
  return r
}

test('avkrysset permanent gir null — det er hele poenget med boksen', () => {
  assert.equal(ok(resolveCodeDuration(true, '')).durationDays, null)
})

test('avkrysset permanent IGNORERER et tall som står igjen i feltet', () => {
  // Brukeren skrev 60, krysset så av for permanent. Valget skal vinne over
  // resten i inputfeltet — ellers ville koden blitt 60 dager stikk i strid med
  // det som står på skjermen.
  assert.equal(ok(resolveCodeDuration(true, '60')).durationDays, null)
})

test('TOMT FELT er nå en FEIL, ikke stille permanent', () => {
  // Kjernen i saken. Før denne endringen ga tomt felt en permanent kode.
  const r = feil(resolveCodeDuration(false, ''))
  assert.match(r.error, /kryss av for permanent/)
})

test('bare mellomrom er også tomt', () => {
  feil(resolveCodeDuration(false, '   '))
})

test('SKRIVEFEIL blir avvist, ikke omtolket til permanent', () => {
  // «seksti» ga `parseInt` → NaN → null → permanent kode, uten noe varsel.
  for (const tull of ['seksti', '6o', 'abc', '-', '--30']) {
    const r = feil(resolveCodeDuration(false, tull))
    assert.match(r.error, /helt antall dager/, `«${tull}» ga feil melding`)
  }
})

test('«60dager» avvises — parseInt ville svelget suffikset', () => {
  feil(resolveCodeDuration(false, '60dager'))
})

test('desimaltall avvises', () => {
  feil(resolveCodeDuration(false, '30.5'))
})

test('0 og negative dager avvises', () => {
  // 0 er spesielt viktig: den regnes som permanent av isPermanentCode i
  // premium-state, så en kode med 0 dager ville vært permanent i praksis.
  feil(resolveCodeDuration(false, '0'))
  feil(resolveCodeDuration(false, '-30'))
})

test('over taket avvises', () => {
  const r = feil(resolveCodeDuration(false, String(DURATION_DAYS_CEILING + 1)))
  assert.match(r.error, new RegExp(String(DURATION_DAYS_CEILING)))
})

test('gyldige dagtall slipper gjennom, inkludert grenseverdiene', () => {
  assert.equal(ok(resolveCodeDuration(false, '1')).durationDays, 1)
  assert.equal(ok(resolveCodeDuration(false, '60')).durationDays, 60)
  assert.equal(ok(resolveCodeDuration(false, '365')).durationDays, 365)
  assert.equal(ok(resolveCodeDuration(false, ' 30 ')).durationDays, 30, 'mellomrom rundt tallet skal tåles')
  assert.equal(ok(resolveCodeDuration(false, String(DURATION_DAYS_CEILING))).durationDays, DURATION_DAYS_CEILING)
})

test('resultatet er alltid noe buildAccessCode godtar', () => {
  // Kontrakten mellom skjemaet og serveren: alt denne funksjonen sier ok til,
  // må serveren også si ok til. Ellers flytter vi bare feilen ett hakk.
  const verdier = ['1', '60', '365', String(DURATION_DAYS_CEILING)]
  for (const v of verdier) {
    const d = ok(resolveCodeDuration(false, v)).durationDays!
    assert.ok(Number.isInteger(d) && d >= 1 && d <= DURATION_DAYS_CEILING)
  }
})
