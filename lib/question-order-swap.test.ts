// Kjøres med:  npm test
//
// HVA DENNE TESTEN ER — OG IKKE ER
// Den autoritative implementasjonen av byttet er SQL:
// public.swap_question_order i
// supabase/migrations/20260731000000_swap_question_order_rpc.sql. Node kan
// ikke kjøre plpgsql, så denne testen kjører IKKE den virkelige funksjonen.
//
// Det den gjør, er å modellere den ene egenskapen ved Postgres som gjorde den
// gamle koden umulig — at UNIQUE (quiz_id, order_index) er en vanlig indeks som
// sjekkes PER RAD under skriving, ikke ved slutten av setningen — og bevise at
// den gamle to-stegs-planen bryter den mens tre-stegs-planen ikke gjør det.
// Altså et vakthold om DESIGNVALGET, ikke om SQL-teksten.
//
// Den empiriske verifiseringen mot ekte database (både at det gamle mønsteret
// faktisk feiler med 23505, og at RPC-en faktisk bytter) ligger i
// scripts/verify-question-order-swap.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'

type Row = { id: string; quizId: string; orderIndex: number }

/**
 * Minimal modell av en tabell med UNIQUE (quiz_id, order_index) som en vanlig,
 * IKKE-DEFERRABLE indeks: hver enkelt skriving avvises umiddelbart hvis en
 * annen levende rad allerede har verdien. Det er nøyaktig semantikken som
 * felte det gamle mønsteret.
 */
class UniqueIndexedTable {
  // Eksplisitt felt, ikke en parameter-property: testene kjøres av Node sin
  // strip-only TypeScript-modus, som ikke støtter `constructor(private x)`.
  rows: Row[]

  constructor(rows: Row[]) {
    this.rows = rows
  }

  update(id: string, orderIndex: number): void {
    const row = this.rows.find(r => r.id === id)
    if (!row) throw new Error(`ukjent rad ${id}`)
    const clash = this.rows.find(
      r => r.id !== id && r.quizId === row.quizId && r.orderIndex === orderIndex
    )
    if (clash) {
      throw new Error(
        `duplicate key value violates unique constraint "questions_quiz_order_index_unique"`
      )
    }
    row.orderIndex = orderIndex
  }

  orderOf(id: string): number {
    return this.rows.find(r => r.id === id)!.orderIndex
  }

  maxOrder(quizId: string): number {
    return Math.max(...this.rows.filter(r => r.quizId === quizId).map(r => r.orderIndex))
  }
}

const freshTable = () =>
  new UniqueIndexedTable([
    { id: 'a', quizId: 'q1', orderIndex: 1 },
    { id: 'b', quizId: 'q1', orderIndex: 2 },
    { id: 'c', quizId: 'q1', orderIndex: 3 },
  ])

test('MUTASJONSBEVIS: det gamle to-stegs-byttet bryter unique-indeksen', () => {
  const t = freshTable()
  const orderA = t.orderOf('a')
  const orderB = t.orderOf('b')

  // Nøyaktig det gamle moveQuestion() gjorde: to skrivinger, hver til den
  // andre radens NÅVÆRENDE verdi. Den første feiler allerede.
  assert.throws(
    () => {
      t.update('a', orderB)
      t.update('b', orderA)
    },
    /questions_quiz_order_index_unique/
  )

  // Og rekkefølgen står igjen uendret — ingen delvis skade, men heller ingen
  // flytting. Det er akkurat det admin så: en liste som ikke rørte seg.
  assert.equal(t.orderOf('a'), 1)
  assert.equal(t.orderOf('b'), 2)
})

test('den omvendte skriverekkefølgen feiler også — problemet er ikke rekkefølgen', () => {
  const t = freshTable()
  assert.throws(
    () => {
      t.update('b', t.orderOf('a'))
      t.update('a', t.orderOf('b'))
    },
    /questions_quiz_order_index_unique/
  )
})

test('tre-stegs bytte via sentinel lykkes og bytter faktisk plassene', () => {
  const t = freshTable()
  const orderA = t.orderOf('a')
  const orderB = t.orderOf('b')
  const sentinel = t.maxOrder('q1') + 1

  // Samme sekvens som swap_question_order kjører i SQL.
  t.update('a', sentinel)
  t.update('b', orderA)
  t.update('a', orderB)

  assert.equal(t.orderOf('a'), orderB)
  assert.equal(t.orderOf('b'), orderA)
})

test('sentinelen er alltid ledig og positiv, også for det siste spørsmålet', () => {
  // Grensetilfellet: bytter man de to SISTE spørsmålene, er den ene allerede
  // på maks. max+1 må fortsatt være ledig — og positiv, slik at en eventuell
  // CHECK (order_index > 0) ikke ville brytes.
  const t = freshTable()
  const sentinel = t.maxOrder('q1') + 1
  assert.ok(sentinel > 0)
  assert.doesNotThrow(() => t.update('c', sentinel))
})

test('et bytte rører ikke de andre spørsmålene i quizen', () => {
  const t = freshTable()
  const orderA = t.orderOf('a')
  const orderB = t.orderOf('b')
  const sentinel = t.maxOrder('q1') + 1

  t.update('a', sentinel)
  t.update('b', orderA)
  t.update('a', orderB)

  assert.equal(t.orderOf('c'), 3)
})
