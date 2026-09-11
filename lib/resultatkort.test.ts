// Kjøres med:  npm test
//
// byggResultatkort — de tre utheva kortene på admin-resultatkortet.
//
// BAKGRUNN (11. september 2026)
// Kortet erstatter skjermbildet Dennis i dag tar av den offentlige
// resultatlisten før han deler i Facebook. To ting gjør at det ikke kan ha sin
// egen rangering: bildet og siden ville kunne peke ut hver sin vinner, og en
// spiller som har meldt seg ut av den åpne konkurransen ville kunne havne i et
// Facebook-innlegg. Feltet kommer derfor ferdig rangert og ferdig filtrert fra
// `getPublicSnapshot`, og denne filen PLUKKER kun — den sorterer ikke.
//
// Det testene her vokter er de tre plukkene og kantene rundt dem: at
// «raskest» leses på TID og ikke på plassering, at «midt i feltet» faller bort
// når feltet er lite, og at et navn ikke trykkes to ganger ved siden av seg
// selv.
//
// MUTASJONSBEVIS. Hver mutasjon ble faktisk SKREVET til lib/resultatkort.ts,
// forekomstene talt i fila før og etter skrivingen, testene kjørt, og fila
// gjenopprettet. Tellingen er ikke seremoni: `ceil → floor` ble først forsøkt
// med et perl-uttrykk der en `/` i mønsteret lukket delimiteren, så mutasjonen
// ble aldri påført — og en grønn suite hadde da sett ut som en overlevende.
// Tellingen fanget det; testkjøringen gjorde det ikke.
//
// Baseline 19/19 grønne. Antall FEILENDE tester per mutasjon:
//   • `Math.ceil` → `Math.floor` i midtPlassering        → 5
//     (midtPlassering bor nå i lib/midt-i-feltet.ts og mutasjonstestes der)
//   • `kandidat.totalTidMs < best` → `>` i finnRaskest   → 5
//   • tie-break på rank i finnRaskest fjernet            → 1
//   • rank-kollisjonsvakta erstattet med `true`          → 2
//   • `deltakere >= MIN…` → `deltakere > MIN…`           → 1
//   • `felt.slice(0, 10)` → `felt.slice(0, 3)`           → 2
//   • `if (felt.length === 0) return null` nøytralisert  → 1
//   • `deltakere = felt.length` → `min(felt.length, 10)` → 3

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byggResultatkort,
  formatTid,
  filnavnDato,
  MIN_DELTAKERE_FOR_MIDTEN,
  type KortSpiller,
} from './resultatkort'
// Plasseringen eies ikke lenger av resultatkortet — den deles med
// delingsteksten og admin sin resultatside. Testene under leser den fra
// kilden, så de følger automatisk med hvis definisjonen endres ett sted.
import { midtPlassering } from './midt-i-feltet'

/**
 * Bygg et felt som ALLEREDE er rangert, slik kalleren leverer det.
 * Rask nok tid til at `rank` og tid peker samme vei med mindre en test
 * bevisst vrir på det.
 */
function felt(antall: number): KortSpiller[] {
  return Array.from({ length: antall }, (_, i) => ({
    rank: i + 1,
    navn: `Spiller ${i + 1}`,
    riktige: Math.max(1, 15 - i),
    totalTidMs: 60_000 + i * 1_000,
  }))
}

const bygg = (f: readonly KortSpiller[]) => {
  const kort = byggResultatkort(f)
  if (!kort) throw new Error('forventet et kort, fikk null')
  return kort
}

// ── Tomt felt ───────────────────────────────────────────────────────────────

test('tomt felt gir null — kalleren skal svare feil, ikke rendre et tomt bilde', () => {
  assert.equal(byggResultatkort([]), null)
})

// ── Vinner ──────────────────────────────────────────────────────────────────

test('vinneren er den ferdig rangerte førsteplassen, ikke den raskeste', () => {
  // Rad 3 er klart raskest, men har færrest riktige. Kortet skal ikke
  // «rette opp» rekkefølgen det fikk inn.
  const f = felt(20)
  f[2].totalTidMs = 1_000
  const kort = bygg(f)
  assert.equal(kort.vinner.rank, 1)
  assert.equal(kort.vinner.navn, 'Spiller 1')
})

// ── Raskest ─────────────────────────────────────────────────────────────────

test('raskest leses på TID, ikke på plassering', () => {
  const f = felt(20)
  f[13].totalTidMs = 900
  const kort = bygg(f)
  assert.equal(kort.raskest.rank, 14)
  assert.equal(kort.raskest.navn, 'Spiller 14')
})

test('raskest kan være vinneren selv — det er ikke en feil', () => {
  const f = felt(20)
  f[0].totalTidMs = 100
  const kort = bygg(f)
  assert.equal(kort.raskest.rank, 1)
  assert.equal(kort.vinner.rank, 1)
})

test('lik raskeste tid velges deterministisk: best plassering vinner', () => {
  // Uten tie-breaket ville utfallet hengt på rekkefølgen i inputen, og to
  // renderinger av samme quiz kunne gitt hvert sitt navn på kortet.
  const f = felt(20)
  f[4].totalTidMs = 5_000
  f[11].totalTidMs = 5_000
  assert.equal(bygg(f).raskest.rank, 5)

  // Samme felt, motsatt rekkefølge på de to like: svaret skal ikke flytte seg.
  const omvendt = [...f].reverse()
  assert.equal(bygg(omvendt).raskest.rank, 5)
})

// ── Midt i feltet ───────────────────────────────────────────────────────────

test('midt-kortet peker på raden den delte definisjonen utpeker', () => {
  const kort = bygg(felt(67))
  assert.equal(kort.midten?.rank, midtPlassering(67))
  assert.equal(kort.midten?.rank, 34)
  assert.equal(kort.midten?.navn, 'Spiller 34')
})

test('partall felt: 35 av 68 — samme som delingsteksten, ikke 34', () => {
  // Kortet regnet tidligere ceil(N/2) = 34 her, mens «Midt på treet» i
  // quiz-results-text sa 35. Bildet og teksten i samme Facebook-innlegg kunne
  // dermed oppgi hvert sitt navn. Definisjonen bor nå i lib/midt-i-feltet.ts.
  assert.equal(bygg(felt(68)).midten?.rank, 35)
  assert.equal(bygg(felt(68)).midten?.rank, midtPlassering(68))
})

test('for lite felt dropper midt-kortet helt', () => {
  for (const n of [1, 2, 3, 4]) {
    assert.equal(bygg(felt(n)).midten, null, `N=${n} skulle ikke gitt midt-kort`)
  }
})

test('fem deltakere er nok — grensen er «under fem», ikke «under seks»', () => {
  assert.equal(MIN_DELTAKERE_FOR_MIDTEN, 5)
  const kort = bygg(felt(5))
  assert.equal(kort.midten?.rank, 3)
})

test('midt-kortet droppes når det ville gjentatt den raskeste', () => {
  // 9 deltakere → midten er plass 5. Gjør plass 5 til den raskeste også:
  // da ville RASKEST og MIDT I FELTET stått med samme navn side om side.
  const f = felt(9)
  f[4].totalTidMs = 500
  const kort = bygg(f)
  assert.equal(kort.raskest.rank, 5)
  assert.equal(kort.midten, null)
})

test('midt-kortet står når den raskeste er en ANNEN enn midtmannen', () => {
  const f = felt(9)
  f[7].totalTidMs = 500
  const kort = bygg(f)
  assert.equal(kort.raskest.rank, 8)
  assert.equal(kort.midten?.rank, 5)
})

test('ingen person kan bære alle tre kortene — sveip over hele feltrommet', () => {
  // Vinner + raskest KAN være samme person (bestillingen sier det er greit).
  // Det som aldri skal skje er at midt-kortet gjentar en av de to, og dermed
  // at ett navn står på tre kort.
  //
  // Sveip: alle feltstørrelser opp til 40, med den raskeste flyttet til hver
  // eneste posisjon i feltet.
  for (let n = 1; n <= 40; n++) {
    for (let rask = 0; rask < n; rask++) {
      const f = felt(n)
      f[rask].totalTidMs = 1
      const kort = bygg(f)
      if (kort.midten) {
        assert.notEqual(
          kort.midten.rank, kort.vinner.rank,
          `N=${n}, raskest=${rask + 1}: midt-kortet gjentok vinneren`
        )
        assert.notEqual(
          kort.midten.rank, kort.raskest.rank,
          `N=${n}, raskest=${rask + 1}: midt-kortet gjentok den raskeste`
        )
      }
      const vist = [kort.vinner.rank, kort.raskest.rank, kort.midten?.rank]
        .filter((r): r is number => typeof r === 'number')
      assert.ok(
        new Set(vist).size >= (vist.length === 3 ? 2 : 1),
        `N=${n}, raskest=${rask + 1}: ett navn på tre kort`
      )
    }
  }
})

// ── Topp 10 og deltakertall ─────────────────────────────────────────────────

test('topp 10 er de ti øverste, i den rekkefølgen feltet kom', () => {
  const kort = bygg(felt(67))
  assert.equal(kort.topp10.length, 10)
  assert.deepEqual(kort.topp10.map(r => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('kortere felt gir kortere liste — ingen utfylling', () => {
  assert.equal(bygg(felt(4)).topp10.length, 4)
  assert.equal(bygg(felt(1)).topp10.length, 1)
})

test('deltakere er HELE feltet, ikke lengden på topp 10', () => {
  // Dette er tallet i topplinja. Leses det av `topp10.length`, ville hver
  // eneste fredag stått «10 deltakere».
  assert.equal(bygg(felt(67)).deltakere, 67)
  assert.equal(bygg(felt(3)).deltakere, 3)
})

// ── Formatering ─────────────────────────────────────────────────────────────

test('tiden skrives som på resultatlista — én desimal og s', () => {
  assert.equal(formatTid(63_408), '63.4s')
  assert.equal(formatTid(0), '0.0s')
  assert.equal(formatTid(106_953), '107.0s')
})

test('filnavn-datoen er norsk tid, ikke UTC', () => {
  // 11. september 2026 kl. 23:30 norsk tid er 21:30 UTC samme dag.
  assert.equal(filnavnDato('2026-09-11T21:30:00Z'), '2026-09-11')
  // Men 00:30 norsk tid natt til 12. er 22:30 UTC den 11. — datoen skal
  // følge dagen i Norge.
  assert.equal(filnavnDato('2026-09-11T22:30:00Z'), '2026-09-12')
})

test('filnavn-datoen tåler null og søppel uten å kaste', () => {
  assert.match(filnavnDato(null), /^\d{4}-\d{2}-\d{2}$/)
  assert.match(filnavnDato('ikke en dato'), /^\d{4}-\d{2}-\d{2}$/)
})
