// Kjøres med:  npm test
//
// HVA DENNE TESTEN ER — OG IKKE ER
// Den autoritative implementasjonen er SQL: public.delete_question_and_renumber
// i supabase/migrations/20260824000000_delete_question_and_renumber.sql. Node
// kan ikke kjøre plpgsql, så testen modellerer i stedet egenskapen ved
// Postgres som DIKTERTE designet — at UNIQUE (quiz_id, order_index) sjekkes
// PER RAD i uspesifisert rekkefølge under en UPDATE — og beviser at
// to-fase-planen (parker alle på +MAX, tildel så 1..N) aldri kan kollidere,
// uansett radrekkefølge, mens en direkte tildeling av 1..N kan. Samme rolle
// som lib/question-order-swap.test.ts har for swap-RPC-en.
//
// Den empiriske verifiseringen mot ekte database (inkl. vaktene last_question
// og question_played) ligger i scripts/verify-delete-renumber.mjs.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fase 1 (parkeringen) fjernes fra planen → «direkte tildeling av 1..N kan
//     kollidere» viser interleaving-en som feller den, og «to-fase-planen
//     kolliderer aldri …» ryker når planen bygges uten parkering.
//   • Offset mindre enn MAX → «parkeringssonen er garantert ledig» ryker.
//   • Fase 2 sorterer på noe annet enn (order_index, id) → «relativ rekkefølge
//     bevares» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'

type Row = { id: string; orderIndex: number }

// Samme modell som lib/question-order-swap.test.ts: hver enkelt skriving
// avvises umiddelbart hvis en annen levende rad har verdien.
class UniqueIndexedTable {
  rows: Row[]

  constructor(rows: Row[]) {
    this.rows = rows.map(r => ({ ...r }))
  }

  update(id: string, orderIndex: number): void {
    const row = this.rows.find(r => r.id === id)
    if (!row) throw new Error(`ukjent rad ${id}`)
    const clash = this.rows.find(r => r.id !== id && r.orderIndex === orderIndex)
    if (clash) {
      throw new Error('duplicate key value violates unique constraint "questions_quiz_order_index_unique"')
    }
    row.orderIndex = orderIndex
  }

  indexes(): number[] {
    return this.rows.map(r => r.orderIndex).sort((a, b) => a - b)
  }

  byRelativeOrder(): string[] {
    return this.rows
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
      .map(r => r.id)
  }
}

/** Skrivingene RPC-ens to faser gjør, i SQL-ens egne termer. */
function twoPhasePlan(rows: Row[]): Array<{ id: string; to: number }> {
  const max = rows.reduce((m, r) => Math.max(m, r.orderIndex), 0)
  const parked = rows.map(r => ({ id: r.id, to: r.orderIndex + max }))
  const assigned = rows
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
    .map((r, p) => ({ id: r.id, to: p + 1 }))
  return [...parked, ...assigned]
}

/** Alle permutasjoner — radrekkefølgen i én UPDATE er uspesifisert. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]),
  )
}

const etterSletting = (n: number, deleted: number): Row[] => {
  const rows: Row[] = []
  for (let v = 1; v <= n; v++) {
    if (v !== deleted) rows.push({ id: `rad-${String(v).padStart(2, '0')}`, orderIndex: v })
  }
  return rows
}

test('MUTASJONSBEVIS: direkte tildeling av 1..N kan kollidere — radrekkefølgen er uspesifisert', () => {
  // Slett spørsmål 1 av 4: gjenværende [2,3,4] skal bli [1,2,3]. Skriver
  // Postgres raden med orden 4 først (→ 3), treffer den raden som fortsatt
  // holder 3. Én lovlig rekkefølge som feiler er nok til å felle planen.
  const rows = etterSletting(4, 1)
  const direkte = rows
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((r, p) => ({ id: r.id, to: p + 1 }))

  const failing = permutations(direkte).filter(perm => {
    const t = new UniqueIndexedTable(rows)
    try {
      for (const step of perm) t.update(step.id, step.to)
      return false
    } catch {
      return true
    }
  })

  assert.ok(failing.length > 0, 'minst én radrekkefølge må felle den direkte planen — ellers er to-fasen unødvendig')
})

test('to-fase-planen kolliderer aldri, uansett radrekkefølge innen hver fase', () => {
  // Fase-grensen er det eneste SQL-en garanterer (to separate UPDATE-setninger).
  // Innenfor hver fase prøver vi alle permutasjoner.
  const rows = etterSletting(4, 1)
  const max = 4 // MAX(order_index) etter slettingen er [2,3,4] → 4
  const parked = rows.map(r => ({ id: r.id, to: r.orderIndex + max }))
  const assigned = rows
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
    .map((r, p) => ({ id: r.id, to: p + 1 }))

  for (const p1 of permutations(parked)) {
    for (const p2 of permutations(assigned)) {
      const t = new UniqueIndexedTable(rows)
      assert.doesNotThrow(() => {
        for (const step of p1) t.update(step.id, step.to)
        for (const step of p2) t.update(step.id, step.to)
      })
      assert.deepEqual(t.indexes(), [1, 2, 3])
    }
  }
})

test('parkeringssonen er garantert ledig: alle parkerte verdier > MAX, parvis ulike, positive', () => {
  // Egenskapen fase 1 hviler på — også fra en tilstand med hull.
  const medHull: Row[] = [
    { id: 'a', orderIndex: 1 },
    { id: 'b', orderIndex: 2 },
    { id: 'c', orderIndex: 16 }, // formen fra Fredagsquiz 07.08.2026
  ]
  const max = 16
  const parked = medHull.map(r => r.orderIndex + max)

  assert.ok(parked.every(v => v > max), 'en parkert verdi ≤ MAX kan treffe en uflyttet rad')
  assert.equal(new Set(parked).size, parked.length, 'to like parkerte verdier kolliderer med hverandre')
  assert.ok(parked.every(v => v > 0), 'en eventuell CHECK (order_index > 0) må overleve')
})

test('renummereringen er ren kompaktering: relativ rekkefølge bevares, hull heles', () => {
  // Dette ER regelen fra 24. august 2026: rekkefølge er en visningsdetalj.
  // En fasitretting rekonstruerer spillerens rekkefølge fra order_index
  // (correct_streak i /api/admin/correct-answer) — bytter kompakteringen om
  // på to rader, kan en SENERE retting regne en annen streak enn spilleren
  // faktisk hadde. Bevart relativ rekkefølge er det som gjør Del 4 trygg.
  const medHull: Row[] = [
    { id: 'x', orderIndex: 3 },
    { id: 'y', orderIndex: 7 },
    { id: 'z', orderIndex: 16 },
  ]
  const t = new UniqueIndexedTable(medHull)
  const relativFør = t.byRelativeOrder()

  for (const step of twoPhasePlan(medHull)) t.update(step.id, step.to)

  assert.deepEqual(t.indexes(), [1, 2, 3], 'hullene skal være helet til 1..N')
  assert.deepEqual(t.byRelativeOrder(), relativFør, 'to rader har byttet plass — det er ikke lenger en kompaktering')
})

test('alle sletteposisjoner i en full quiz ender som 1..N-1', () => {
  for (let deleted = 1; deleted <= 15; deleted++) {
    const rows = etterSletting(15, deleted)
    const t = new UniqueIndexedTable(rows)
    const relativFør = t.byRelativeOrder()

    assert.doesNotThrow(() => {
      for (const step of twoPhasePlan(rows)) t.update(step.id, step.to)
    }, `sletting av posisjon ${deleted} skulle renummerere uten kollisjon`)
    assert.deepEqual(t.indexes(), Array.from({ length: 14 }, (_, p) => p + 1))
    assert.deepEqual(t.byRelativeOrder(), relativFør)
  }
})
