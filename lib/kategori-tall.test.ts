import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kategoriTall } from './kategori-tall'

test('alle tre tallene finnes → vises', () => {
  assert.deepEqual(kategoriTall(25, 1, 4), { prosent: 25, riktige: 1, besvart: 4 })
})

test('0 er et ekte tall i alle tre posisjonene', () => {
  // Svakeste kategori er ofte 0 av N. En vakt som sjekker falsy i stedet for
  // null ville skjult nettopp den raden — og 0 % er hele poenget med
  // «svakeste».
  assert.deepEqual(kategoriTall(0, 0, 3), { prosent: 0, riktige: 0, besvart: 3 })
})

test('null i alle tre → ingenting vises', () => {
  assert.equal(kategoriTall(null, null, null), null)
})

// ── REGRESJON: bufret svar fra en tidligere deploy ──────────────────────────
// Feilen 4. august 2026. Feltene ble lagt til i PlayerStats, men /historikk
// bufrer hele API-svaret i sessionStorage — et blob skrevet av forrige deploy
// har dem ikke i det hele tatt. Vakten var `!== null`, som er SANN for
// undefined, så linja ble rendret med tomme hull: «% riktige ( av )».

test('undefined i alle tre → ingenting vises (ikke «% riktige ( av )»)', () => {
  assert.equal(kategoriTall(undefined, undefined, undefined), null)
})

test('et bufret PlayerStats-blob uten de nye feltene gir ingen linje', () => {
  // Nøyaktig formen som lå i sessionStorage: kategorien finnes, tallene ikke.
  const bufret: Record<string, unknown> = { sterkeste_kategori: 'Geografi' }
  assert.equal(
    kategoriTall(
      bufret.sterkeste_kategori_prosent as number | undefined,
      bufret.sterkeste_kategori_riktige as number | undefined,
      bufret.sterkeste_kategori_besvart as number | undefined,
    ),
    null,
  )
})

// ── MUTASJONSBEVIS: delvis data er ikke data ────────────────────────────────
// Mellomtilstanden d92a356 hadde prosent, men ikke antall. Et bufret svar fra
// NØYAKTIG den deployen ville ellers gitt «100% riktige ( av )».

test('prosent uten antall → ingenting vises', () => {
  assert.equal(kategoriTall(100, undefined, undefined), null)
  assert.equal(kategoriTall(100, null, null), null)
})

test('antall uten prosent → ingenting vises', () => {
  assert.equal(kategoriTall(undefined, 3, 3), null)
})

test('hvert enkelt manglende felt er nok til å skjule linja', () => {
  const komplett: [number, number, number] = [50, 2, 4]
  for (const i of [0, 1, 2]) {
    for (const mangler of [null, undefined]) {
      const args = [...komplett] as (number | null | undefined)[]
      args[i] = mangler
      assert.equal(
        kategoriTall(args[0], args[1], args[2]), null,
        `felt ${i} = ${mangler} slapp gjennom vakten`,
      )
    }
  }
})
